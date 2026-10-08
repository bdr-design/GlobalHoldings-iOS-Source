// Fleet Core v4.2 — fleet store (gh-fleet-store-v3), built for up to
// 1,000,000 assets.
//
// One asset is one 128-byte record in a single ArrayBuffer. The fields every
// event reads and writes share the record's two adjacent cache lines, so an
// event on a random asset costs one or two memory fetches instead of one per
// field, and a row is copied (journal, compaction, persistence) as one block.
// Fields that are constant for a purchase batch (owner, model, specs, crew,
// lease, delivery refs…) live in one shared, interned "profile" value; fields
// derived from the assigned route live in one interned "binding" value. Every
// asset still owns its own values from the player's point of view: writing one
// asset's specs re-interns a new profile for that asset only. Rare or
// non-conforming fields are kept verbatim per asset in `extras`, so ingest →
// materialize preserves every JSON value of the original asset object.
//
// Scale rules:
// - Rows never move inside a transaction. Removal marks a row dead (O(1));
//   order-preserving compaction runs only between transactions.
// - Rollback uses a log of row preimages (one block copy per touched row) plus
//   whole-field copies for mass writes; nothing is cloned per transaction. A
//   rollback costs O(rows written): it restores those rows, un-interns the
//   values the transaction added and reports the rows as changed; revision
//   and structure only ever grow, so no cache keyed by them can mistake old
//   data for new.
// - Interned values that no live row references are reclaimed onto a free list
//   between transactions, so the value table stays bounded at any speed.
// - Rows written since the last save are tracked per chunk of 32,768 rows.
(()=>{
  'use strict';
  const VERSION='4.2.0',SCHEMA='gh-fleet-store-v3';
  const CHUNK_SHIFT=15,CHUNK_ROWS=1<<CHUNK_SHIFT,DIRTY_LOG_LIMIT=1<<16;
  const ALIVE=1,EXTRAS=2;
  const PROFILE_FIELDS=Object.freeze(['ownerCompanyId','assetMode','assetClass','operationProfileId','type','icon','model','year','catalogId','specs','ownership','monthlyLease','leaseTermMonths','leaseStartSeconds','purchasePrice','companyName','deliveryOrderId','requestRef','paymentRef','deliveryStatus','deliveredDay','deliveredAtSeconds','staffing']);
  const BINDING_FIELDS=Object.freeze(['routeSignature','from','to','distanceKm','tripSeconds','effectiveSpeedKmh','dwellHours','load']);
  // Hot fields own a record slot. Kinds: pattern (interned prefix + uint32
  // number), ref (interned value), f64, f32x (exactly representable in
  // float32), i32, bool. A value that does not fit its kind is kept verbatim
  // in extras. Materialization always uses one stable physical field order;
  // JSON object key insertion order is presentation detail, not save state.
  const HOT_FIELDS=Object.freeze([
    ['id','pattern'],['name','pattern'],['routeId','ref'],['baseFacility','ref'],['phase','ref'],
    ['progress','f64'],['fuel','f64'],['condition','f64'],['dwellRemaining','f64'],['reverse','bool'],
    ['routeSlot','i32'],['departureScheduled','bool'],['departureScheduledAt','f64'],['crewBlocked','bool'],
    ['releaseExclusiveRouteOnArrival','bool'],['simCarrySeconds','f64'],['lastTransitionGuardDay','i32'],['lastTrip','ref'],
    ['flightHours','f32x'],['flightCycles','f32x'],['nextCheckHours','f32x']
  ]);
  if(HOT_FIELDS.length>32)throw new Error('fleet-store-presence-mask-overflow');
  const HOT_KIND=new Map(HOT_FIELDS.map(([name,kind])=>[name,kind]));
  const HOT_BIT=Object.freeze(Object.fromEntries(HOT_FIELDS.map(([name],index)=>[name,(1<<index)>>>0])));
  const PROFILE_SET=new Set(PROFILE_FIELDS),BINDING_SET=new Set(BINDING_FIELDS);

  // ---------------------------------------------------------- record layout ---
  // Five views share the buffer: f64 (16 per row), u32 / i32 / f32 (32 per
  // row, one word space) and u8 (128 per row). Each slot is [view, index in
  // the row]. Bytes 0–63 hold what every event touches; `flags` holds
  // ALIVE/EXTRAS and `at` is the simulation time at which progress, fuel,
  // condition and dwellRemaining hold (neither is an asset field).
  const STRIDE=128,F64_PER_ROW=16,WORDS_PER_ROW=32,I32_NULL=-2147483648;
  const SLOTS=Object.freeze({
    at:['f64',0],progress:['f64',1],fuel:['f64',2],condition:['f64',3],dwellRemaining:['f64',4],departureScheduledAt:['f64',5],
    present:['u32',12],phase:['u32',13],routeId:['u32',14],baseFacility:['u32',15],
    simCarrySeconds:['f64',8],profile:['u32',18],binding:['u32',19],lastTrip:['u32',20],routeSlot:['i32',21],
    idPattern:['u32',22],idNumber:['u32',23],namePattern:['u32',24],nameNumber:['u32',25],lastTransitionGuardDay:['i32',26],
    flightHours:['f32',27],flightCycles:['f32',28],nextCheckHours:['f32',29],
    flags:['u8',120],reverse:['u8',121],departureScheduled:['u8',122],crewBlocked:['u8',123],releaseExclusiveRouteOnArrival:['u8',124]
  });
  const SLOT_NAMES=Object.freeze(Object.keys(SLOTS));
  const PER_ROW={f64:F64_PER_ROW,u32:WORDS_PER_ROW,i32:WORDS_PER_ROW,f32:WORDS_PER_ROW,u8:STRIDE};
  const BYTES={f64:8,u32:4,i32:4,f32:4,u8:1};
  (()=>{const used=new Uint8Array(STRIDE);for(const [view,k] of Object.values(SLOTS)){const start=k*BYTES[view];for(let b=start;b<start+BYTES[view];b++){if(b>=STRIDE||used[b])throw new Error('fleet-store-layout-overlap');used[b]=1;}}})();
  // Constant row offsets for owners that read and write records directly.
  const O=Object.freeze(Object.fromEntries(SLOT_NAMES.map(name=>[name,SLOTS[name][1]])));
  const PATTERN_SLOTS=Object.freeze({id:['idPattern','idNumber'],name:['namePattern','nameNumber']});
  const own=(value,key)=>Object.prototype.hasOwnProperty.call(value,key);
  const isObject=value=>!!value&&typeof value==='object'&&!Array.isArray(value);
  function defineData(target,key,value){Object.defineProperty(target,key,{value,writable:true,enumerable:true,configurable:true});}

  // --------------------------------------------------------------- runtime ---
  // Runtime-only indexes, rebuilt from the persisted data when missing. `epoch`
  // changes whenever rows may have moved (compaction, a restored snapshot);
  // caches compare it.
  const runtime=new WeakMap();
  let epochCounter=0;
  function makeViews(buffer){return {buffer,f64:new Float64Array(buffer),u32:new Uint32Array(buffer),i32:new Int32Array(buffer),f32:new Float32Array(buffer),u8:new Uint8Array(buffer)};}
  function rt(store){
    let r=runtime.get(store);
    if(!r||r.values!==store.values||r.views.buffer!==store.rows){
      r={values:store.values,views:makeViews(store.rows),index:new Map(),indexedTo:0,free:[],ids:null,profileGroups:null,leaseGroups:null,payrollGroups:null,
        dirty:[],dirtyFrom:store.revision,dirtyLost:false,dirtyColumns:null,suppressDirtyLog:false,
        dirtyChunks:new Uint8Array(Math.max(1,Math.ceil(store.capacity/CHUNK_ROWS))),allDirty:true,journal:null,epoch:++epochCounter,valuesGeneration:++epochCounter,
        uid:++epochCounter,chunkVersions:new Uint32Array(Math.max(1,Math.ceil(store.capacity/CHUNK_ROWS))),staticVersions:new Uint32Array(Math.max(1,Math.ceil(store.capacity/CHUNK_ROWS))),massVersion:0};
      runtime.set(store,r);
    }
    if(r.indexedTo>store.values.length){r.index=new Map();r.indexedTo=0;r.free=[];r.valuesGeneration=++epochCounter;}
    if(r.indexedTo<store.values.length){
      for(let ref=Math.max(1,r.indexedTo);ref<store.values.length;ref++){const stored=store.values[ref];if(stored===null||stored===undefined){r.free.push(ref);continue;}const key=valueKey(stored);if(!r.index.has(key))r.index.set(key,ref);}
      r.indexedTo=store.values.length;
    }
    return r;
  }
  // Typed views of the record buffer (valid until the next capacity change).
  function views(store){const r=runtime.get(store);return r!==undefined&&r.views.buffer===store.rows&&r.values===store.values?r.views:rt(store).views;}
  function epoch(store){return rt(store).epoch;}
  // Changes whenever an interned ref may now hold a different value (a reclaimed
  // slot, a rolled-back table); owners caching per-ref data compare it.
  function valuesGeneration(store){return rt(store).valuesGeneration;}
  function bumpEpoch(store){const r=rt(store);r.epoch=++epochCounter;r.ids=null;return r.epoch;}
  function invalidateProfiles(store){const r=runtime.get(store);if(r){r.profileGroups=null;r.leaseGroups=null;r.payrollGroups=null;}}
  // Generic slot access (owners on hot paths use views() with O offsets).
  function slot(store,name,index){const [view,k]=SLOTS[name];return views(store)[view][index*PER_ROW[view]+k];}
  function setSlot(store,name,index,value){const [view,k]=SLOTS[name];views(store)[view][index*PER_ROW[view]+k]=value;}

  // ---------------------------------------------------------------- values ---
  // values[0] is null; any other null slot is free. Strings and JSON values are
  // interned by their JSON text so equal values share one ref. Interned values
  // are never mutated (materialize returns copies; peek is read-only by contract).
  function valueKey(value){return typeof value==='string'?`s${value}`:`j${JSON.stringify(value)}`;}
  function jsonCopy(value){return value===undefined?undefined:JSON.parse(JSON.stringify(value));}
  function intern(store,value){
    if(value===null||value===undefined)return 0;
    const r=rt(store),key=valueKey(value),found=r.index.get(key);if(found!==undefined)return found;
    const stored=typeof value==='string'?value:jsonCopy(value);let ref;
    if(r.free.length){ref=r.free.pop();store.values[ref]=stored;if(r.journal&&r.journal.active)r.journal.reused.push(ref);}
    else{ref=store.values.length;store.values.push(stored);r.indexedTo=store.values.length;}
    r.index.set(key,ref);return ref;
  }
  function value(store,ref){return ref===0?null:store.values[ref];}
  function copyValue(value){return value&&typeof value==='object'?jsonCopy(value):value;}

  // -------------------------------------------------------------- patterns ---
  // "N-ROAD-00000006" → {p:"N-ROAD-",w:8} + 6. Anything that does not
  // round-trip exactly, or whose number exceeds uint32, stays in extras.
  function splitPattern(text){
    if(typeof text!=='string')return null;const match=/^([\s\S]*?)(\d{1,10})$/.exec(text);if(!match)return null;
    const digits=match[2],number=Number(digits),width=digits.length>1&&digits[0]==='0'?digits.length:0;
    if(!(number>=0&&number<=0xFFFFFFFF))return null;const pattern={p:match[1],w:width};
    return joinPattern(pattern,number)===text?{pattern,number}:null;
  }
  function joinPattern(pattern,number){const digits=String(number);return pattern.p+(pattern.w?digits.padStart(pattern.w,'0'):digits);}

  // --------------------------------------------------------------- storage ---
  function create(capacity=0){
    const cap=Math.max(0,Math.floor(Number(capacity)||0));
    return {schema:SCHEMA,version:VERSION,length:0,live:0,capacity:cap,structure:0,revision:0,values:[null],rows:new ArrayBuffer(cap*STRIDE),extras:{}};
  }
  function isStore(store){return isObject(store)&&store.schema===SCHEMA&&store.rows instanceof ArrayBuffer&&Array.isArray(store.values);}
  function resize(store,cap){
    const next=new ArrayBuffer(cap*STRIDE);new Uint8Array(next).set(new Uint8Array(store.rows,0,Math.min(store.length,cap)*STRIDE));
    store.rows=next;store.capacity=cap;
    const r=runtime.get(store);if(r)r.views=makeViews(next);
    return r;
  }
  function ensureCapacity(store,needed){
    if(needed<=store.capacity)return;let cap=Math.max(16,store.capacity);while(cap<needed)cap=Math.ceil(cap*1.5);
    const r=resize(store,cap);
    if(r){
      const chunks=Math.max(1,Math.ceil(cap/CHUNK_ROWS));if(r.dirtyChunks.length<chunks){const next=new Uint8Array(chunks);next.set(r.dirtyChunks);r.dirtyChunks=next;}
      if(r.chunkVersions.length<chunks){const next=new Uint32Array(chunks);next.set(r.chunkVersions);r.chunkVersions=next;}
      if(r.staticVersions.length<chunks){const next=new Uint32Array(chunks);next.set(r.staticVersions);r.staticVersions=next;}
      if(r.journal&&r.journal.active&&r.journal.seen.length<cap){const seen=new Uint8Array(cap);seen.set(r.journal.seen);r.journal.seen=seen;}
    }
  }
  function trimCapacity(store){if(store.capacity!==store.length)resize(store,store.length);return store;}
  function isAlive(store,index){return index>=0&&index<store.length&&(views(store).u8[index*STRIDE+O.flags]&ALIVE)!==0;}
  function markDirty(r,index){const chunk=index>>>CHUNK_SHIFT;r.dirtyChunks[chunk]=1;r.chunkVersions[chunk]++;r.staticVersions[chunk]++;}
  // The event engine's fast path (toucher) writes only ENGINE_FIELDS (and `at`): it leaves staticVersions alone, so
  // class tables over other fields stay valid while the fleet moves.
  function markEngineDirty(r,index){const chunk=index>>>CHUNK_SHIFT;r.dirtyChunks[chunk]=1;r.chunkVersions[chunk]++;}
  // Chunks with rows changed since the last persistence checkpoint.
  function dirtyChunks(store){const r=rt(store),chunks=Math.ceil(store.length/CHUNK_ROWS),out=[];for(let chunk=0;chunk<chunks;chunk++)if(r.allDirty||r.dirtyChunks[chunk])out.push(chunk);return out;}
  function clearDirtyChunks(store){const r=rt(store);r.dirtyChunks.fill(0);r.allDirty=false;}
  // Build 358: write versions per chunk for any number of independent consumers (dirtyChunks has one owner). A chunk's
  // bytes are unchanged while (runtime, massVersion, its version) are unchanged; a new runtime (decoded or restored
  // store, replaced values table) or a mass write (column write, column rollback, compaction) changes every chunk.
  function chunkStamp(store){const r=rt(store);return {runtime:r.uid,mass:r.massVersion,versions:r.chunkVersions};}

  // --------------------------------------------------------------- journal ---
  // One journal per store per transaction (Transaction Core forbids nesting).
  // A log keeps the first preimage of every pre-existing row written (one
  // 128-byte block, copied as 32-bit words so every bit survives); rows
  // appended inside the transaction need none (rollback truncates). A mass
  // writer may snapshot one field of every row instead; rows logged after that
  // snapshot never restore that field from their block. Interned slots reused
  // from the free list are returned to it on rollback, values appended are
  // removed from the index, and id lookups changed inside the transaction are
  // repaired row by row.
  function newLog(capacity){return {count:0,capacity,rows:new Int32Array(capacity),words:new Uint32Array(capacity*WORDS_PER_ROW),extras:new Array(capacity)};}
  function growLog(log){
    const capacity=Math.max(64,log.capacity*2),rows=new Int32Array(capacity),words=new Uint32Array(capacity*WORDS_PER_ROW);
    rows.set(log.rows);words.set(log.words);log.rows=rows;log.words=words;log.extras.length=capacity;log.capacity=capacity;
  }
  function beginJournal(store){
    const r=rt(store);if(r.journal&&r.journal.active)return r.journal;
    const journal={store,runtime:r,length:store.length,live:store.live,structure:store.structure,revision:store.revision,high:store.revision,highStructure:store.structure,valuesLength:store.values.length,reused:[],
      log:newLog(64),seen:new Uint8Array(Math.max(16,store.capacity)),fields:new Map(),ids:r.ids,idOps:[],idCollision:false,active:true};
    r.journal=journal;return journal;
  }
  function journalFor(store){
    const r=rt(store);if(r.journal&&r.journal.active)return r.journal;
    const tx=globalThis.GH_TRANSACTION_CORE;
    if(tx?.isActive?.()&&typeof tx.registerUndo==='function'){
      const journal=beginJournal(store);
      tx.registerUndo(()=>rollbackJournal(journal),()=>endJournal(journal));
      return journal;
    }
    return null;
  }
  function logRow(journal,store,r,index){
    if(index>=journal.length||journal.seen[index])return;
    journal.seen[index]=1;const log=journal.log;if(log.count===log.capacity)growLog(log);
    const slotIndex=log.count++,words=log.words,from=r.views.u32,src=index*WORDS_PER_ROW,dst=slotIndex*WORDS_PER_ROW;
    log.rows[slotIndex]=index;
    for(let k=0;k<WORDS_PER_ROW;k++)words[dst+k]=from[src+k];
    log.extras[slotIndex]=(r.views.u8[index*STRIDE+O.flags]&EXTRAS)&&own(store.extras,index)?store.extras[index]:undefined;
  }
  // Changed-row log for incremental owners (the event queue). An owner drains
  // it; `complete` is false when a change could not be logged (overflow,
  // compaction), and mass field writes are reported by field name.
  function logDirty(r,index){
    if(r.suppressDirtyLog||r.dirtyLost)return;
    if(r.dirty.length>=DIRTY_LOG_LIMIT){r.dirtyLost=true;r.dirty=[];}else r.dirty.push(index);
  }
  // First write to a row: journal its preimage (inside a transaction), bump the
  // revision, log it for incremental owners and mark its chunk dirty.
  function remember(store,index){
    const journal=journalFor(store),r=rt(store);if(journal)logRow(journal,store,r,index);
    store.revision++;if(journal)journal.high=store.revision;logDirty(r,index);markDirty(r,index);
  }
  // remember() for a hot loop: the journal is resolved once, on first use.
  function toucher(store){
    const r=rt(store);let journal=null,resolved=false;
    return index=>{
      if(!resolved){journal=journalFor(store);resolved=true;}
      if(journal!==null&&journal.active&&index<journal.length&&journal.seen[index]===0)logRow(journal,store,r,index);
      store.revision++;if(journal!==null)journal.high=store.revision;
      if(!r.suppressDirtyLog)logDirty(r,index);
      markEngineDirty(r,index);
    };
  }
  // Mass writers (one field of very many rows) snapshot that field once.
  function gatherField(store,name){const [view,k]=SLOTS[name],per=PER_ROW[view],source=views(store)[view],copy=new source.constructor(store.length);for(let index=0;index<store.length;index++)copy[index]=source[index*per+k];return copy;}
  // quiet: the column change is not reported to the dirty-log owner (the event engine). Only for a write that cannot
  // change what that owner tracks (columnWriter setting presence bits of fields the engine never schedules on).
  function rememberColumn(store,name,{quiet=false}={}){
    if(!own(SLOTS,name))throw new RangeError(`fleet-store-column:${name}`);
    const journal=journalFor(store);if(journal&&!journal.fields.has(name))journal.fields.set(name,{copy:gatherField(store,name),logCount:journal.log.count});
    const r=rt(store);r.allDirty=true;r.massVersion++;store.revision++;if(journal)journal.high=store.revision;
    if(!quiet&&!r.suppressDirtyLog){if(!r.dirtyColumns)r.dirtyColumns=new Set();r.dirtyColumns.add(name);}
  }
  function bumpStructure(store){store.structure++;const r=runtime.get(store);if(r&&r.journal&&r.journal.active&&store.structure>r.journal.highStructure)r.journal.highStructure=store.structure;}
  function unindexValue(r,stored,ref){if(stored===null||stored===undefined)return;const key=valueKey(stored);if(r.index.get(key)===ref)r.index.delete(key);}
  function rollbackJournal(journal){
    if(!journal.active)return;const store=journal.store;
    // Transaction Core restores a full-state snapshot before running owner
    // undos: the store then already holds its preimage in a new buffer. Only
    // the counters move (past every value seen inside the transaction); the
    // runtime indexes are rebuilt from the restored data on next use.
    const current=runtime.get(store);
    if(!current||current!==journal.runtime||current.views.buffer!==store.rows||current.values!==store.values){
      store.revision=Math.max(store.revision,journal.high)+1;store.structure=Math.max(store.structure,journal.highStructure)+1;
      endJournal(journal);return;
    }
    if(journal.length>store.capacity)ensureCapacity(store,journal.length);
    const r=rt(store),v=r.views,log=journal.log;invalidateProfiles(store);
    // Id lookups: drop every mapping the transaction touched while the values
    // it interned still resolve, re-add the restored ids below.
    const idsKept=r.ids!==null&&r.ids===journal.ids&&!journal.idCollision;
    if(idsKept)for(const [index,id] of journal.idOps)idsUnmap(store,r,index,id);
    else r.ids=null;
    // Values interned inside the transaction leave the table and the index.
    const valuesChanged=store.values.length>journal.valuesLength||journal.reused.length>0;
    for(let ref=journal.valuesLength;ref<store.values.length;ref++)unindexValue(r,store.values[ref],ref);
    for(let k=journal.reused.length-1;k>=0;k--){const ref=journal.reused[k];unindexValue(r,store.values[ref],ref);store.values[ref]=null;r.free.push(ref);}
    if(store.values.length>journal.valuesLength)store.values.length=journal.valuesLength;
    r.indexedTo=store.values.length;
    // Field snapshots first, then logged rows (a field snapshotted before a
    // row was logged is restored from that row's block, otherwise from the
    // snapshot).
    const snaps=[...journal.fields].map(([name,snap])=>{const [view,k]=SLOTS[name];return {target:v[view],per:PER_ROW[view],k,copy:snap.copy,logCount:snap.logCount};});
    for(const s of snaps){const n=Math.min(s.copy.length,store.capacity);for(let index=0;index<n;index++)s.target[index*s.per+s.k]=s.copy[index];}
    const words=v.u32;
    for(let slotIndex=0;slotIndex<log.count;slotIndex++){
      const index=log.rows[slotIndex],src=slotIndex*WORDS_PER_ROW,dst=index*WORDS_PER_ROW;
      for(let k=0;k<WORDS_PER_ROW;k++)words[dst+k]=log.words[src+k];
      for(const s of snaps)if(slotIndex>=s.logCount&&index<s.copy.length)s.target[index*s.per+s.k]=s.copy[index];
      const extras=log.extras[slotIndex];if(extras===undefined)delete store.extras[index];else store.extras[index]=extras;
      markDirty(r,index);logDirty(r,index);
    }
    for(let index=journal.length;index<store.length;index++){delete store.extras[index];v.u8[index*STRIDE+O.flags]=0;markDirty(r,index);logDirty(r,index);}
    const structureChanged=store.structure!==journal.structure;
    store.length=journal.length;store.live=journal.live;
    // Counters only grow: a value seen during the transaction is never reused.
    if(structureChanged)store.structure++;
    store.revision++;
    if(journal.fields.size){r.allDirty=true;r.massVersion++;if(!r.dirtyColumns)r.dirtyColumns=new Set();for(const name of journal.fields.keys())r.dirtyColumns.add(name);}
    if(idsKept){const rows=new Set();for(const [index] of journal.idOps)rows.add(index);for(const index of rows){if(isAlive(store,index)&&!idsMap(store,r,index,idAt(store,index))){r.ids=null;break;}}}
    if(valuesChanged)r.valuesGeneration=++epochCounter;
    endJournal(journal);
  }
  function endJournal(journal){
    if(!journal.active)return;journal.active=false;
    const log=journal.log;for(let slotIndex=0;slotIndex<log.count;slotIndex++)journal.seen[log.rows[slotIndex]]=0;
    const r=runtime.get(journal.store);if(r&&r.journal===journal)r.journal=null;
  }
  function journalStats(store){const r=rt(store),j=r.journal;return j&&j.active?{rows:j.log.count,columns:[...j.fields.keys()],reused:j.reused.length}:null;}

  // ----------------------------------------------------------- read/write ---
  function presentBit(field){return HOT_BIT[field];}
  function presentOf(store,index){return views(store).u32[index*WORDS_PER_ROW+O.present];}
  function isPresent(store,index,field){return (presentOf(store,index)&presentBit(field))!==0;}
  function flagsOf(store,index){return views(store).u8[index*STRIDE+O.flags];}
  function hotFits(kind,value){
    if(kind==='f64')return typeof value==='number';
    if(kind==='f32x')return typeof value==='number'&&Object.is(Math.fround(value),value);
    // null is held in the slot as I32_NULL (purchased assets carry routeSlot:null, which used to put every one of them
    // in extras); the integer I32_NULL itself goes to extras.
    if(kind==='i32')return value===null||Number.isInteger(value)&&value>I32_NULL&&value<=2147483647&&!Object.is(value,-0);
    if(kind==='bool')return typeof value==='boolean';
    if(kind==='pattern')return splitPattern(value)!==null;
    return value!==undefined;
  }
  function writeHot(store,index,field,kind,value){
    if(kind==='pattern'){const [ps,ns]=PATTERN_SLOTS[field],split=splitPattern(value),ref=intern(store,split.pattern),w=views(store).u32;w[index*WORDS_PER_ROW+O[ps]]=ref;w[index*WORDS_PER_ROW+O[ns]]=split.number;}
    else if(kind==='ref'){const ref=intern(store,value);views(store).u32[index*WORDS_PER_ROW+O[field]]=ref;}
    else if(kind==='bool')views(store).u8[index*STRIDE+O[field]]=value?1:0;
    else if(kind==='f64')views(store).f64[index*F64_PER_ROW+O[field]]=value;
    else if(kind==='f32x')views(store).f32[index*WORDS_PER_ROW+O[field]]=value;
    else views(store).i32[index*WORDS_PER_ROW+O[field]]=value===null?I32_NULL:value;
    views(store).u32[index*WORDS_PER_ROW+O.present]|=presentBit(field);
  }
  function clearHot(store,index,field){views(store).u32[index*WORDS_PER_ROW+O.present]&=~presentBit(field);}
  function readHot(store,index,field,kind){
    const v=views(store);
    if(kind==='pattern'){const [ps,ns]=PATTERN_SLOTS[field];return joinPattern(store.values[v.u32[index*WORDS_PER_ROW+O[ps]]],v.u32[index*WORDS_PER_ROW+O[ns]]);}
    if(kind==='ref')return copyValue(value(store,v.u32[index*WORDS_PER_ROW+O[field]]));
    if(kind==='bool')return v.u8[index*STRIDE+O[field]]===1;
    if(kind==='f64')return v.f64[index*F64_PER_ROW+O[field]];
    if(kind==='f32x')return v.f32[index*WORDS_PER_ROW+O[field]];
    const stored=v.i32[index*WORDS_PER_ROW+O[field]];return stored===I32_NULL?null:stored;
  }
  function peekHot(store,index,field,kind){return kind==='ref'?value(store,views(store).u32[index*WORDS_PER_ROW+O[field]]):readHot(store,index,field,kind);}
  function extrasOf(store,index){return (flagsOf(store,index)&EXTRAS)!==0&&own(store.extras,index)?store.extras[index]:null;}
  function groupObject(store,ref){const out=value(store,ref);return isObject(out)?out:{};}
  function groupRef(store,index,group){return views(store).u32[index*WORDS_PER_ROW+O[group]];}
  function setGroupField(store,index,group,field,value){
    const current=groupObject(store,groupRef(store,index,group)),next={};
    let placed=false;for(const key of Object.keys(current)){if(key===field){placed=true;if(value!==undefined)next[key]=value;}else next[key]=current[key];}
    if(!placed&&value!==undefined)next[field]=value;
    const ref=intern(store,next);views(store).u32[index*WORDS_PER_ROW+O[group]]=ref;if(group==='profile')invalidateProfiles(store);
  }
  function physicalKeys(store,index){
    const out=[],seen=new Set(),present=presentOf(store,index),push=key=>{if(!seen.has(key)){seen.add(key);out.push(key);}};
    if(present&1)push('id');
    for(const key of Object.keys(groupObject(store,groupRef(store,index,'profile'))))push(key);
    for(let i=1;i<HOT_FIELDS.length;i++)if(present&(1<<i))push(HOT_FIELDS[i][0]);
    for(const key of Object.keys(groupObject(store,groupRef(store,index,'binding'))))push(key);
    const extras=extrasOf(store,index);if(extras)for(const key of Object.keys(extras))push(key);
    return out;
  }
  function setExtra(store,index,field,value){
    const current=extrasOf(store,index),next={...(current||{})},u8=views(store).u8;
    if(value===undefined)delete next[field];else defineData(next,field,jsonCopy(value));
    if(Object.keys(next).length){store.extras[index]=next;u8[index*STRIDE+O.flags]|=EXTRAS;}else{delete store.extras[index];u8[index*STRIDE+O.flags]&=~EXTRAS;}
  }
  function checkRow(store,index){if(!isAlive(store,index))throw new RangeError(`fleet-store-row:${index}`);}
  // Write one asset field exactly as a plain object assignment would (undefined
  // deletes, as JSON drops it). All writes are journaled inside a transaction.
  function set(store,index,field,value){
    checkRow(store,index);remember(store,index);
    const idBefore=field==='id'?idAt(store,index):undefined;
    const hot=HOT_KIND.get(field)||null,extras=extrasOf(store,index);
    if(extras&&own(extras,field))setExtra(store,index,field,undefined);
    if(hot){if(value===undefined)clearHot(store,index,field);else if(hotFits(hot,value))writeHot(store,index,field,hot,value);else{clearHot(store,index,field);setExtra(store,index,field,value);}}
    else if(PROFILE_SET.has(field))setGroupField(store,index,'profile',field,value);
    else if(BINDING_SET.has(field))setGroupField(store,index,'binding',field,value);
    else setExtra(store,index,field,value);
    if(field==='id'){bumpStructure(store);idsMove(store,index,idBefore,idAt(store,index));}
  }
  // Build 358 (million-asset): one owner pass writing a few numeric hot fields of very many rows (the daily flight
  // counters) journals each field's column once (rememberColumn) instead of every row (128 bytes per row, 128 MB at a
  // million rows). put(index,field,value) leaves the row exactly as set() would: a field not yet present, held in the
  // row's extras or a value its slot cannot hold exactly goes through set() (row journal, extras); every other write
  // goes into the column, and a field not yet present gets its presence bit through the journaled presence column (once
  // per pass; the event engine is not told, these fields never move a schedule). Each put bumps the revision and marks
  // the chunk, like a row write; a column is journaled on its first write, so a pass that writes nothing changes nothing.
  const ENGINE_SCHEDULE_FREE=new Set(['flightHours','flightCycles','nextCheckHours']);
  function columnWriter(store,fields){
    const kinds=new Map(),remembered=new Set();
    for(const field of fields){const kind=HOT_KIND.get(field);if(kind!=='f64'&&kind!=='f32x'&&kind!=='i32')throw new RangeError(`fleet-store-column-writer:${field}`);kinds.set(field,kind);}
    return (index,field,value)=>{
      const kind=kinds.get(field);if(!kind)throw new RangeError(`fleet-store-column-writer:${field}`);
      // checkRow, extrasOf, isPresent and writeHot with the runtime resolved once (this runs for every row of a pass).
      const r=rt(store),v=r.views,flags=index>=0&&index<store.length?v.u8[index*STRIDE+O.flags]:0;if(!(flags&ALIVE))throw new RangeError(`fleet-store-row:${index}`);
      const extras=(flags&EXTRAS)&&own(store.extras,index)?store.extras[index]:null,word=index*WORDS_PER_ROW+O.present,bit=presentBit(field),present=(v.u32[word]&bit)!==0;
      if(!hotFits(kind,value)||(extras&&own(extras,field))||(!present&&!ENGINE_SCHEDULE_FREE.has(field))){set(store,index,field,value);return;}
      if(!present&&!remembered.has('present')){rememberColumn(store,'present',{quiet:true});remembered.add('present');}
      if(!remembered.has(field)){rememberColumn(store,field);remembered.add(field);}
      if(!present)v.u32[word]|=bit;
      const journal=journalFor(store);store.revision++;if(journal)journal.high=store.revision;markDirty(r,index);
      if(kind==='f64')v.f64[index*F64_PER_ROW+O[field]]=value;else if(kind==='f32x')v.f32[index*WORDS_PER_ROW+O[field]]=value;else v.i32[index*WORDS_PER_ROW+O[field]]=value===null?I32_NULL:value;
    };
  }
  // Hot-path entry for owners that write records directly (the event engine):
  // journal the row once, bump the revision, mark its chunk dirty.
  function touch(store,index){remember(store,index);}
  // Rows written since the owner's last drain. `complete` is false when the log
  // cannot explain every change since `sinceRevision` (another drainer, an
  // overflow, a compaction): the owner then rebuilds instead of patching.
  // `columns` names fields rewritten wholesale (mass writes, their rollback).
  function drainDirty(store,sinceRevision){
    const r=rt(store),complete=r.dirtyFrom===sinceRevision&&!r.dirtyLost,indices=r.dirty,columns=r.dirtyColumns?[...r.dirtyColumns]:[];
    r.dirty=[];r.dirtyFrom=store.revision;r.dirtyLost=false;r.dirtyColumns=null;
    return {complete,indices,columns,revision:store.revision,epoch:r.epoch};
  }
  // The owner of the dirty log runs `fn` writing rows it tracks itself (the
  // event engine). When the log was fully drained before, it stays in sync.
  function withoutDirtyLog(store,fn){
    const r=rt(store),previous=r.suppressDirtyLog,clean=r.dirtyFrom===store.revision&&r.dirty.length===0&&!r.dirtyLost&&!r.dirtyColumns;
    r.suppressDirtyLog=true;
    try{return fn();}
    finally{
      r.suppressDirtyLog=previous;
      if(clean&&r.dirty.length===0&&!r.dirtyLost&&!r.dirtyColumns)r.dirtyFrom=store.revision;
      else if(r.dirtyFrom!==store.revision)r.dirtyLost=true;
    }
  }
  function patch(store,index,fields){for(const field of Object.keys(fields))set(store,index,field,fields[field]);return index;}
  function get(store,index,field){
    const extras=extrasOf(store,index);if(extras&&own(extras,field))return copyValue(extras[field]);
    const kind=HOT_KIND.get(field);if(kind)return isPresent(store,index,field)?readHot(store,index,field,kind):undefined;
    if(PROFILE_SET.has(field)){const group=groupObject(store,groupRef(store,index,'profile'));return own(group,field)?copyValue(group[field]):undefined;}
    if(BINDING_SET.has(field)){const group=groupObject(store,groupRef(store,index,'binding'));return own(group,field)?copyValue(group[field]):undefined;}
    return undefined;
  }
  // Shared read without copying — only for read-only paths.
  function peek(store,index,field){
    if(flagsOf(store,index)&EXTRAS){const extras=store.extras[index];if(extras&&own(extras,field))return extras[field];}
    const kind=HOT_KIND.get(field);
    if(kind){if(!isPresent(store,index,field))return undefined;return peekHot(store,index,field,kind);}
    if(PROFILE_SET.has(field))return groupObject(store,groupRef(store,index,'profile'))[field];
    if(BINDING_SET.has(field))return groupObject(store,groupRef(store,index,'binding'))[field];
    return undefined;
  }

  // ------------------------------------------------------ ingest/materialize ---
  function ingestRow(store,index,asset,at){
    const profile={},binding={},extras={};
    {const v=views(store),w=index*WORDS_PER_ROW;for(let k=0;k<WORDS_PER_ROW;k++)v.u32[w+k]=0;v.f64[index*F64_PER_ROW+O.at]=Number.isFinite(at)?at:0;v.u8[index*STRIDE+O.flags]=ALIVE;}
    for(const key of Object.keys(asset)){
      const value=asset[key];if(value===undefined||typeof value==='function'||typeof value==='symbol')continue;
      const hot=HOT_KIND.get(key)||null;
      if(hot){if(hotFits(hot,value))writeHot(store,index,key,hot,value);else defineData(extras,key,jsonCopy(value));}
      else if(PROFILE_SET.has(key))defineData(profile,key,value);
      else if(BINDING_SET.has(key))defineData(binding,key,value);
      else defineData(extras,key,jsonCopy(value));
    }
    const profileRef=intern(store,profile),bindingRef=intern(store,binding),v=views(store),w=index*WORDS_PER_ROW;
    v.u32[w+O.profile]=profileRef;v.u32[w+O.binding]=bindingRef;invalidateProfiles(store);
    if(Object.keys(extras).length){store.extras[index]=extras;v.u8[index*STRIDE+O.flags]|=EXTRAS;}else delete store.extras[index];
  }
  function add(store,asset,{at=0}={}){
    if(!isObject(asset))throw new TypeError('fleet-store-asset-object-required');
    const index=store.length;ensureCapacity(store,index+1);remember(store,index);store.length=index+1;store.live++;bumpStructure(store);
    ingestRow(store,index,asset,at);idsMove(store,index,undefined,idAt(store,index));return index;
  }
  // Replace one row with a whole asset object (every field rewritten, like
  // assigning a fresh object at the same position).
  function replace(store,index,asset,{at=0}={}){
    checkRow(store,index);if(!isObject(asset))throw new TypeError('fleet-store-asset-object-required');
    const previousId=idAt(store,index);remember(store,index);ingestRow(store,index,asset,at);
    const nextId=idAt(store,index);if(nextId!==previousId){bumpStructure(store);idsMove(store,index,previousId,nextId);}return index;
  }
  // Removal marks rows dead (O(1) each, rows never move). Iteration skips dead
  // rows, so array order is preserved; compactRows() reclaims them later.
  function removeMany(store,indices){
    const unique=new Set();for(const index of indices){checkRow(store,index);unique.add(index);}
    for(const index of unique){const id=idAt(store,index);remember(store,index);views(store).u8[index*STRIDE+O.flags]&=~ALIVE;store.live--;idsMove(store,index,id,undefined);}
    if(unique.size){bumpStructure(store);invalidateProfiles(store);}
    return unique.size;
  }
  function remove(store,index){return removeMany(store,[index])===1;}
  function materialize(store,index){
    const out={},present=presentOf(store,index),profile=groupObject(store,groupRef(store,index,'profile')),binding=groupObject(store,groupRef(store,index,'binding'));
    if(present&1)out.id=readHot(store,index,'id','pattern');
    for(const key of Object.keys(profile))defineData(out,key,copyValue(profile[key]));
    for(let i=1;i<HOT_FIELDS.length;i++){if(present&(1<<i)){const [field,kind]=HOT_FIELDS[i];out[field]=readHot(store,index,field,kind);}}
    for(const key of Object.keys(binding))defineData(out,key,copyValue(binding[key]));
    const extras=extrasOf(store,index);if(extras)for(const key of Object.keys(extras))defineData(out,key,copyValue(extras[key]));
    const result={};for(const key of Object.keys(out))defineData(result,key,out[key]);return result;
  }
  // Own keys of the materialized asset, in materialize order, without building it.
  function keys(store,index){
    return physicalKeys(store,index);
  }
  function fromAssets(assets,{at=0}={}){
    const list=Array.isArray(assets)?assets:[],store=create(list.length);
    for(let index=0;index<list.length;index++){store.length=index+1;store.live++;ingestRow(store,index,list[index],at);}
    store.structure=1;return store;
  }
  // Build 358: peek() for many fields of every live row (save validation). The field kinds are resolved once per call and
  // a row's profile and binding groups once per row; each value is exactly what peek(store,index,field) returns.
  function forEachPeek(store,fields,fn){
    const plan=(Array.isArray(fields)?fields:[]).map(field=>({field,inherited:field in Object.prototype,kind:HOT_KIND.get(field)||null,profile:PROFILE_SET.has(field),binding:BINDING_SET.has(field)}));
    const length=store.length;
    for(let index=0;index<length;index++){
      if(!isAlive(store,index))continue;
      const extras=(flagsOf(store,index)&EXTRAS)?store.extras[index]:null,row={};let profile=null,binding=null;
      for(let k=0;k<plan.length;k++){
        const step=plan[k],field=step.field;let value;
        // `in` equals own() here: extras are plain data objects and no planned field is an Object.prototype name.
        if(extras&&(step.inherited?own(extras,field):field in extras))value=extras[field];
        else if(step.kind){if(isPresent(store,index,field))value=peekHot(store,index,field,step.kind);}
        else if(step.profile){if(profile===null)profile=groupObject(store,groupRef(store,index,'profile'));value=profile[field];}
        else if(step.binding){if(binding===null)binding=groupObject(store,groupRef(store,index,'binding'));value=binding[field];}
        if(value!==undefined)row[field]=value;
      }
      fn(row,index);
    }
  }
  // Build 358 (million-asset validation): validation classes. Live rows without extras that agree on everything the
  // requested fields read form one class: the presence bits of the requested hot fields, their refs / bools / i32 /
  // f32 values, the profile and binding groups and, for a pattern field (id, name), the prefix ref and the digit count
  // of the number. fn(row,count,info) runs once per class with the first member's projection (exactly what
  // forEachPeek gives that row) and the class size, then once per extreme of the `numeric` fields (count 0): every
  // numeric field at its class minimum, at its maximum, and (when one occurs) a NaN. Rows whose extras hold a requested
  // field are visited one by one (count 1). info.forEachMember(cb) visits the class rows with their exact projections (a scan of the class
  // map; meant for failure paths).
  // Contract for exactness: a validator's result for a row may depend on a numeric field only through checks of that
  // field alone that fail on an interval's outside (non-finite, below a bound, above a bound), and on a pattern field
  // only through its characters' classes and its length (both identical for one prefix and one digit count). Then the
  // set of results over the representatives equals the set over the rows.
  function digitCount(n){return n<10?1:n<100?2:n<1e3?3:n<1e4?4:n<1e5?5:n<1e6?6:n<1e7?7:n<1e8?8:n<1e9?9:10;}
  function projectRow(store,index,plan){
    const extras=(flagsOf(store,index)&EXTRAS)?store.extras[index]:null,row={};let profile=null,binding=null;
    for(let k=0;k<plan.length;k++){
      const step=plan[k],field=step.field;let value;
      if(extras&&(step.inherited?own(extras,field):field in extras))value=extras[field];
      else if(step.kind){if(isPresent(store,index,field))value=peekHot(store,index,field,step.kind);}
      else if(step.profile){if(profile===null)profile=groupObject(store,groupRef(store,index,'profile'));value=profile[field];}
      else if(step.binding){if(binding===null)binding=groupObject(store,groupRef(store,index,'binding'));value=binding[field];}
      if(value!==undefined)row[field]=value;
    }
    return row;
  }
  // Build 358 (million-asset): validators, integrity checks and capacity checks ask for the same classes several times
  // per command while the fleet does not change. A result is kept per field set on the store's runtime (dropped with a
  // new buffer or value table) and reused while revision, length and structure are unchanged: every writer bumps the
  // revision before it writes (remember, toucher, rememberColumn, rollback, compaction).
  // When the fleet did change, only the chunks (CHUNK_ROWS rows) written since are scanned again: each chunk keeps its
  // own class table, valid while the chunk's write version is unchanged, and the tables merge in chunk order (classes
  // in order of first row, counts summed, extremes taken with the same strict comparisons in row order, singles in row
  // order), which is exactly the result of one pass. A field set without ENGINE_FIELDS uses staticVersions, which the
  // event engine's fast path does not bump, so those tables survive a moving fleet (the Company Platform asset checks).
  const ENGINE_FIELDS=new Set(['phase','progress','fuel','condition','dwellRemaining','departureScheduled','departureScheduledAt','crewBlocked','reverse','lastTrip','baseFacility',...BINDING_FIELDS]);
  function classScan(store,names,numericSet){
    const r=rt(store),signature=JSON.stringify([names,[...numericSet].sort()]),cache=r.classCache||(r.classCache=new Map()),cached=cache.get(signature);
    if(cached&&cached.revision===store.revision&&cached.length===store.length&&cached.structure===store.structure)return cached;
    const versions=names.some(field=>ENGINE_FIELDS.has(field))?r.chunkVersions:r.staticVersions,stamp=`${r.epoch}:${r.massVersion}:${r.valuesGeneration}`;
    const priorTables=cached&&cached.stamp===stamp?cached.chunkTables:null,chunkTables=[];
    const plan=names.map(field=>({field,inherited:field in Object.prototype,kind:HOT_KIND.get(field)||null,profile:PROFILE_SET.has(field),binding:BINDING_SET.has(field)}));
    let mask=0;const keyed=[],nums=[];
    for(const step of plan){
      if(!step.kind)continue;mask=(mask|HOT_BIT[step.field])>>>0;
      if(step.kind==='f64'&&numericSet.has(step.field))nums.push({field:step.field,slot:O[step.field],bit:HOT_BIT[step.field]});
      else keyed.push({field:step.field,kind:step.kind,bit:HOT_BIT[step.field],slot:step.kind==='pattern'?PATTERN_SLOTS[step.field]:O[step.field]});
    }
    const useProfile=plan.some(step=>!step.kind&&step.profile),useBinding=plan.some(step=>!step.kind&&step.binding);
    const v=views(store),u8=v.u8,W=v.u32,F=v.f64,V=store.values,EX=store.extras,length=store.length,width=2+keyed.length*2+(useProfile?1:0)+(useBinding?1:0);
    const comps=[],first=[],counts=[],key=new Uint32Array(width),previous=new Uint32Array(width);
    // Hot-loop builtins as locals: global lookups are slow where the game runs inside a vm context (Node tests).
    const imul=Math.imul,larger=Math.max;
    const nCount=nums.length,mins=[],maxs=[],nans=[],requested=new Set(plan.filter(step=>!step.inherited).map(step=>step.field)),inheritedSteps=plan.filter(step=>step.inherited);
    const keyedCount=keyed.length,keyedKind=keyed.map(step=>step.kind==='pattern'?0:step.kind==='bool'?1:step.kind==='f64'?2:3),keyedBit=keyed.map(step=>step.bit),keyedSlot=keyed.map(step=>step.kind==='pattern'?0:step.slot),keyedRef=keyed.map(step=>step.kind==='pattern'?O[step.slot[0]]:0),keyedNumber=keyed.map(step=>step.kind==='pattern'?O[step.slot[1]]:0);
    // The class key of a live row into `key`; false when the row is a single (its extras hold a requested field).
    const fill=index=>{
      if(u8[index*STRIDE+O.flags]&EXTRAS){const extras=EX[index];if(extras){let relevant=false;for(const field in extras)if(requested.has(field)){relevant=true;break;}if(!relevant)for(const step of inheritedSteps)if(own(extras,step.field)){relevant=true;break;}if(relevant)return false;}}
      const w=index*WORDS_PER_ROW,present=W[w+O.present]&mask;let at=0;key[at++]=present;
      for(let k=0;k<keyedCount;k++){
        let a=0,b=0;
        if(present&keyedBit[k]){
          const kind=keyedKind[k];
          if(kind===0){const ref=W[w+keyedRef[k]],number=W[w+keyedNumber[k]],pattern=V[ref];a=ref;b=larger(pattern&&pattern.w||0,digitCount(number));}
          else if(kind===1)a=u8[index*STRIDE+keyedSlot[k]];
          else if(kind===2){const f=index*F64_PER_ROW+keyedSlot[k];a=W[f*2];b=W[f*2+1];}
          else a=W[w+keyedSlot[k]];
        }
        key[at++]=a;key[at++]=b;
      }
      if(useProfile)key[at++]=W[w+O.profile];if(useBinding)key[at++]=W[w+O.binding];key[at++]=0;
      return true;
    };
    // The class of `key` in a table, created (with empty extremes) when new.
    const classOf=(table,source)=>{
      let h=0x811c9dc5;for(let k=0;k<width;k++)h=imul(h^source[k],0x01000193);
      const list=table.buckets.get(h);
      if(list)for(const candidate of list){const c=table.comps[candidate];let same=true;for(let k=0;k<width;k++)if(c[k]!==source[k]){same=false;break;}if(same)return candidate;}
      const id=table.comps.length;table.comps.push(source.slice());table.first.push(-1);table.counts.push(0);if(list)list.push(id);else table.buckets.set(h,[id]);
      for(let k=0;k<nCount;k++){table.mins.push(Infinity);table.maxs.push(-Infinity);table.nans.push(false);}
      return id;
    };
    const scanChunk=(start,end)=>{
      const table={buckets:new Map(),comps:[],first:[],counts:[],mins:[],maxs:[],nans:[],singles:[]};let previousId=-1;
      for(let index=start;index<end;index++){
        const flags=u8[index*STRIDE+O.flags];if(!(flags&ALIVE))continue;
        // Extras only matter when they hold a requested field (purchased assets carry routeSlot:null there, for example).
        if(!fill(index)){table.singles.push(index);continue;}
        const present=key[0];
        // Rows of one purchase batch are contiguous: a row with the previous row's key joins its class without a lookup.
        let id=-1;
        if(previousId>=0){id=previousId;for(let k=0;k<width;k++)if(previous[k]!==key[k]){id=-1;break;}}
        if(id<0){id=classOf(table,key);if(table.first[id]<0)table.first[id]=index;previous.set(key);previousId=id;}
        table.counts[id]++;
        for(let k=0;k<nCount;k++){const step=nums[k];if(!(present&step.bit))continue;const x=F[index*F64_PER_ROW+step.slot],slot=id*nCount+k;if(x!==x){table.nans[slot]=true;continue;}if(x<table.mins[slot])table.mins[slot]=x;if(x>table.maxs[slot])table.maxs[slot]=x;}
      }
      table.buckets=null;return table;
    };
    const merged={buckets:new Map(),comps,first,counts,mins,maxs,nans},singles=[];
    for(let chunk=0,start=0;start<length;chunk++,start+=CHUNK_ROWS){
      const end=Math.min(length,start+CHUNK_ROWS),version=versions[chunk],prior=priorTables&&priorTables[chunk];
      const table=prior&&prior.version===version&&prior.end===end?prior:Object.assign(scanChunk(start,end),{version,end});
      chunkTables.push(table);
      for(let local=0;local<table.comps.length;local++){
        const id=classOf(merged,table.comps[local]);if(first[id]<0)first[id]=table.first[local];counts[id]+=table.counts[local];
        for(let k=0;k<nCount;k++){const from=local*nCount+k,to=id*nCount+k;if(table.nans[from])nans[to]=true;if(table.mins[from]<mins[to])mins[to]=table.mins[from];if(table.maxs[from]>maxs[to])maxs[to]=table.maxs[from];}
      }
      for(const index of table.singles)singles.push(index);
    }
    // Members of a class (failure paths only): the rows whose key equals the class key, found by a second scan, so
    // the common path keeps no per-row class map.
    const members=id=>cb=>{const c=comps[id];for(let index=0;index<length;index++){if(!(u8[index*STRIDE+O.flags]&ALIVE)||!fill(index))continue;let same=true;for(let k=0;k<width;k++)if(c[k]!==key[k]){same=false;break;}if(same)cb(projectRow(store,index,plan),index);}};
    const scan={revision:store.revision,length:store.length,structure:store.structure,stamp,chunkTables,plan,comps,first,counts,mins,maxs,nans,nums,nCount,singles,members};
    if(cache.size>=16)cache.clear();cache.set(signature,scan);return scan;
  }
  // Build 358 (million-asset): the distinct truthy values of a hot ref field (routeId, baseFacility) over live rows, in
  // order of first occurrence; with whereField (a profile field) only rows whose profile holds whereValue there. Rows
  // with extras are read as views read them (peek). Each chunk keeps its own ordered list, valid while the chunk's
  // static version is unchanged (the event engine's fast path writes no ref field, profile or extras), and the lists
  // merge in chunk order, which is the order of one pass. Returns a new array.
  function distinctRefs(store,field,whereField=null,whereValue){
    if(HOT_KIND.get(field)!=='ref')throw new RangeError(`fleet-distinct-ref-field:${field}`);
    if(whereField&&!PROFILE_SET.has(whereField))throw new RangeError(`fleet-distinct-where-field:${whereField}`);
    const r=rt(store),signature=JSON.stringify([field,whereField,whereValue===undefined?null:[typeof whereValue,whereValue]]),cache=r.distinctCache||(r.distinctCache=new Map()),stamp=`${r.epoch}:${r.massVersion}:${r.valuesGeneration}`;
    let entry=cache.get(signature);if(!entry||entry.stamp!==stamp){entry={stamp,tables:[]};if(cache.size>=16)cache.clear();cache.set(signature,entry);}
    const v=views(store),u8=v.u8,W=v.u32,V=store.values,bit=HOT_BIT[field]>>>0,slot=O[field],length=store.length,profileMatch=new Map();
    const scanChunk=(start,end)=>{
      const values=[],seenRefs=new Set(),seenValues=new Set();
      for(let index=start;index<end;index++){
        const flags=u8[index*STRIDE+O.flags];if(!(flags&ALIVE))continue;
        if(flags&EXTRAS){const value=peek(store,index,field);if(value&&(!whereField||peek(store,index,whereField)===whereValue)&&!seenValues.has(value)){seenValues.add(value);values.push(value);}continue;}
        const w=index*WORDS_PER_ROW;if(!(W[w+O.present]&bit))continue;const ref=W[w+slot];if(ref===0||seenRefs.has(ref))continue;
        if(whereField){const profileRef=W[w+O.profile];let match=profileMatch.get(profileRef);if(match===undefined){const profile=V[profileRef];match=!!profile&&typeof profile==='object'&&profile[whereField]===whereValue;profileMatch.set(profileRef,match);}if(!match)continue;}
        const value=V[ref];if(!value)continue;seenRefs.add(ref);if(!seenValues.has(value)){seenValues.add(value);values.push(value);}
      }
      return values;
    };
    const out=[],seen=new Set();
    for(let chunk=0,start=0;start<length;chunk++,start+=CHUNK_ROWS){
      const end=Math.min(length,start+CHUNK_ROWS),version=r.staticVersions[chunk];let table=entry.tables[chunk];
      if(!table||table.version!==version||table.end!==end){table={version,end,values:scanChunk(start,end)};entry.tables[chunk]=table;}
      for(const value of table.values)if(!seen.has(value)){seen.add(value);out.push(value);}
    }
    entry.tables.length=Math.ceil(length/CHUNK_ROWS);
    return out;
  }
  function forEachClass(store,fields,fn,{numeric=[]}={}){
    const names=Array.isArray(fields)?fields:[],numericSet=new Set(numeric);
    const {plan,comps,first,counts,mins,maxs,nans,nums,nCount,singles,members}=classScan(store,names,numericSet);
    for(let id=0;id<comps.length;id++){
      const row=projectRow(store,first[id],plan),info={index:first[id],members:counts[id],forEachMember:members(id)};
      fn(row,counts[id],info);
      if(!nCount)continue;
      const variant=pick=>{const out={...row};let changed=false;for(let k=0;k<nCount;k++){const field=nums[k].field;if(!own(row,field))continue;const x=pick(id*nCount+k);if(x===undefined)continue;if(!Object.is(out[field],x)){out[field]=x;changed=true;}}return changed?out:null;};
      const low=variant(slot=>mins[slot]===Infinity?undefined:mins[slot]),high=variant(slot=>maxs[slot]===-Infinity?undefined:maxs[slot]),nan=variant(slot=>nans[slot]?NaN:undefined);
      for(const extra of [low,high,nan])if(extra)fn(extra,0,info);
    }
    for(const index of singles)fn(projectRow(store,index,plan),1,{index,members:1,forEachMember:cb=>cb(projectRow(store,index,plan),index)});
    return {classes:comps.length,singles:singles.length};
  }
  // Exact duplicate / missing id check over live rows, without building one string per row. A pattern id is
  // prefix + digits; when the prefix does not end in a digit the trailing digit run is exactly those digits, so the id
  // is identified by (prefix, number, digit count). Ids with a longer trailing digit run (the prefix then ends in a
  // digit), ids in extras and non-string ids are compared as values. Both sets are disjoint by construction.
  // Ids are written only through set/add/replace/remove (never by the event engine's fast path), so the result stands
  // while no chunk's static version moved (and no mass write, compaction or new value table happened).
  function idCollisions(store){
    const r=rt(store),cached=r.idCollisionCache,stamp=`${r.epoch}:${r.massVersion}:${r.valuesGeneration}:${store.length}:${store.structure}`,chunks=Math.ceil(store.length/CHUNK_ROWS);
    if(cached&&cached.stamp===stamp){let same=true;for(let chunk=0;chunk<chunks;chunk++)if(cached.versions[chunk]!==r.staticVersions[chunk]){same=false;break;}if(same)return {...cached.result};}
    const result=scanIdCollisions(store);r.idCollisionCache={stamp,versions:r.staticVersions.slice(0,chunks),result};return {...result};
  }
  function scanIdCollisions(store){
    const v=views(store),u8=v.u8,W=v.u32,V=store.values,EX=store.extras,length=store.length,groups=new Map(),exact=new Set(),larger=Math.max,digitTail=/\d$/;let missing=false,duplicate=false;
    const addKey=(prefix,number,digits)=>{let g=groups.get(prefix);if(!g){g={keys:new Float64Array(64),n:0,sorted:true};groups.set(prefix,g);}if(g.n===g.keys.length){const next=new Float64Array(g.keys.length*2);next.set(g.keys);g.keys=next;}const key=number*16+digits;if(g.n&&g.keys[g.n-1]>=key)g.sorted=false;g.keys[g.n++]=key;};
    const addValue=id=>{if(typeof id==='string'){const m=/^([\s\S]*?)(\d*)$/.exec(id),run=m[2];if(run.length>=1&&run.length<=10){addKey(m[1],Number(run),run.length);return;}}if(exact.has(id))duplicate=true;else exact.add(id);};
    for(let index=0;index<length&&!duplicate;index++){
      const flags=u8[index*STRIDE+O.flags];if(!(flags&ALIVE))continue;
      const extras=(flags&EXTRAS)?EX[index]:null;
      if(extras&&own(extras,'id')){if(extras.id===undefined)missing=true;else addValue(extras.id);continue;}
      const w=index*WORDS_PER_ROW;if(!(W[w+O.present]&HOT_BIT.id)){missing=true;continue;}
      const pattern=V[W[w+O.idPattern]],number=W[w+O.idNumber],prefix=pattern.p,digits=larger(pattern.w||0,digitCount(number));
      if(digits<=10&&!digitTail.test(prefix))addKey(prefix,number,digits);else addValue(joinPattern(pattern,number));
    }
    if(!duplicate)for(const g of groups.values()){const keys=g.keys.subarray(0,g.n);if(!g.sorted)keys.sort();for(let k=1;k<keys.length;k++)if(keys[k]===keys[k-1]){duplicate=true;break;}if(duplicate)break;}
    return {duplicate,missing};
  }
  function forEachLive(store,fn){const u8=views(store).u8;for(let index=0;index<store.length;index++)if(u8[index*STRIDE+O.flags]&ALIVE)fn(index);}
  // Immutable, interned profiles are shared by rows from the same purchase
  // batch. Cache their live multiplicities so daily batch-level accounting can
  // visit profiles instead of materializing one view per asset.
  // Live rows per profile ref, in order of first row. Build 358 (million-asset): rows of one purchase share a profile
  // and sit together, so runs of one ref are counted before touching the map (a few operations per row at a million).
  function profileRefCounts(store){
    const r=rt(store);if(r.profileGroups)return r.profileGroups;
    const groups=new Map(),u8=r.views.u8,W=r.views.u32;let run=-1,runCount=0;
    for(let index=0;index<store.length;index++){
      if(!(u8[index*STRIDE+O.flags]&ALIVE))continue;const ref=W[index*WORDS_PER_ROW+O.profile];
      if(ref===run){runCount++;continue;}if(runCount)groups.set(run,(groups.get(run)||0)+runCount);run=ref;runCount=1;
    }
    if(runCount)groups.set(run,(groups.get(run)||0)+runCount);
    r.profileGroups=groups;return groups;
  }
  function forEachProfile(store,fn){
    for(const [ref,count] of profileRefCounts(store))if(ref!==0&&count>0)fn(value(store,ref),count,ref);
  }
  // Groups of profiles keyed by fields of the profile, in order of first row, with summed row counts (the per-row
  // grouping these replace kept the same order and counts).
  function forEachLeaseGroup(store,fn){
    const r=rt(store);
    if(!r.leaseGroups){const groups=new Map();for(const [ref,count] of profileRefCounts(store)){
      if(!ref)continue;const profile=value(store,ref);if(profile?.ownership!=='lease')continue;
      const company=String(profile.ownerCompanyId||profile.companyId||''),monthlyLease=Number(profile.monthlyLease)||0;if(!company||monthlyLease<=0)continue;const key=`${company}\u0000${monthlyLease}`;let row=groups.get(key);if(!row){row={ownerCompanyId:company,monthlyLease,count:0};groups.set(key,row);}row.count+=count;
    }r.leaseGroups=groups;}
    for(const row of r.leaseGroups.values())if(row.count>0)fn(row,row.count);
  }
  function forEachPayrollGroup(store,fn){
    const r=rt(store);
    if(!r.payrollGroups){const groups=new Map();for(const [ref,count] of profileRefCounts(store)){
      if(!ref)continue;const profile=value(store,ref),staff=profile?.staffing;if(staff?.ready!==true)continue;
      const ownerCompanyId=String(profile.ownerCompanyId||profile.companyId||''),monthlyPayroll=Number(staff.monthlyPayroll)||0,headcount=Number(staff.total)||0;if(!ownerCompanyId)continue;const key=`${ownerCompanyId}\u0000${monthlyPayroll}\u0000${headcount}`;let row=groups.get(key);if(!row){row={ownerCompanyId,monthlyPayroll,headcount,count:0};groups.set(key,row);}row.count+=count;
    }r.payrollGroups=groups;}
    for(const row of r.payrollGroups.values())if(row.count>0)fn(row,row.count);
  }
  function toAssets(store){const out=[];forEachLive(store,index=>out.push(materialize(store,index)));return out;}

  // ---------------------------------------------------------------- lookup ---
  // Ids are found through one map per interned id pattern (number → row), built
  // once from the records and then maintained by every structural write.
  function idAt(store,index){return isPresent(store,index,'id')?readHot(store,index,'id','pattern'):(extrasOf(store,index)?.id);}
  function buildIds(store){
    const v=views(store),patterns=new Map(),strings=new Map();
    for(let index=0;index<store.length;index++){
      if(!(v.u8[index*STRIDE+O.flags]&ALIVE))continue;const w=index*WORDS_PER_ROW;
      if(v.u32[w+O.present]&1){const ref=v.u32[w+O.idPattern];let map=patterns.get(ref);if(!map){map=new Map();patterns.set(ref,map);}const number=v.u32[w+O.idNumber];if(!map.has(number))map.set(number,index);}
      else{const id=extrasOf(store,index)?.id;if(id!==undefined&&!strings.has(id))strings.set(id,index);}
    }
    return {patterns,strings};
  }
  function idKey(store,id){const split=splitPattern(id);if(!split)return null;const ref=rt(store).index.get(valueKey(split.pattern));return ref===undefined?null:{ref,number:split.number};}
  // Remove the lookup id → index (only if it points at this row).
  function idsUnmap(store,r,index,id){
    if(id===undefined||!r.ids)return;
    const key=idKey(store,id);if(key){const map=r.ids.patterns.get(key.ref);if(map&&map.get(key.number)===index)map.delete(key.number);}
    if(r.ids.strings.get(id)===index)r.ids.strings.delete(id);
  }
  // Add the lookup id → index; false when another row already holds the id.
  function idsMap(store,r,index,id){
    if(id===undefined||!r.ids)return true;
    const key=idKey(store,id);
    if(key&&(presentOf(store,index)&1)){let map=r.ids.patterns.get(key.ref);if(!map){map=new Map();r.ids.patterns.set(key.ref,map);}const held=map.get(key.number);if(held===undefined){map.set(key.number,index);return true;}return held===index;}
    const held=r.ids.strings.get(id);if(held===undefined){r.ids.strings.set(id,index);return true;}return held===index;
  }
  function idsMove(store,index,before,after){
    const r=runtime.get(store);if(!r||!r.ids)return;
    const journal=r.journal&&r.journal.active&&r.journal.ids===r.ids?r.journal:null;
    if(journal){if(before!==undefined)journal.idOps.push([index,before]);if(after!==undefined)journal.idOps.push([index,after]);}
    idsUnmap(store,r,index,before);
    if(!idsMap(store,r,index,after)&&journal)journal.idCollision=true;
  }
  function indexOf(store,id){
    const r=rt(store);if(!r.ids)r.ids=buildIds(store);
    const key=idKey(store,id);let index;
    if(key)index=r.ids.patterns.get(key.ref)?.get(key.number);
    if(index===undefined||!isAlive(store,index)||idAt(store,index)!==id)index=r.ids.strings.get(id);
    return index!==undefined&&isAlive(store,index)&&idAt(store,index)===id?index:-1;
  }
  function buildIndex(store){const r=rt(store);if(!r.ids)r.ids=buildIds(store);return r.ids;}
  function find(store,id){const index=indexOf(store,id);return index<0?null:materialize(store,index);}

  // ------------------------------------------------------------ maintenance ---
  // Order-preserving removal of dead rows. Rows move, so it runs only between
  // transactions; every row-keyed cache is invalidated through the epoch.
  function compactRows(store){
    const r=rt(store);if(r.journal&&r.journal.active)throw new Error('fleet-store-compact-inside-transaction');
    const length=store.length;if(store.live===length)return {removed:0,length};
    const u8=r.views.u8,dead=[];let write=0,read=0;
    // Live rows move down in runs: one block move per run.
    while(read<length){
      while(read<length&&!(u8[read*STRIDE+O.flags]&ALIVE))dead.push(read++);
      const start=read;while(read<length&&(u8[read*STRIDE+O.flags]&ALIVE))read++;
      if(read>start){if(write!==start)u8.copyWithin(write*STRIDE,start*STRIDE,read*STRIDE);write+=read-start;}
    }
    u8.fill(0,write*STRIDE,length*STRIDE);
    const extras={};
    for(const key of Object.keys(store.extras)){
      const index=Number(key);let lo=0,hi=dead.length;while(lo<hi){const mid=(lo+hi)>>1;if(dead[mid]<index)lo=mid+1;else hi=mid;}
      if(lo<dead.length&&dead[lo]===index)continue;extras[index-lo]=store.extras[key];
    }
    store.extras=extras;const removed=length-write;store.length=write;store.live=write;store.structure++;store.revision++;
    r.allDirty=true;r.massVersion++;r.dirty=[];r.dirtyLost=true;bumpEpoch(store);return {removed,length:write};
  }
  // Reclaim interned values no live row references (mark and sweep) onto the
  // free list. Refs never move, so rows and caches of live refs stay valid.
  function collectValues(store){
    const r=rt(store);if(r.journal&&r.journal.active)throw new Error('fleet-store-gc-inside-transaction');
    const v=r.views,u32=v.u32,u8=v.u8,used=new Uint8Array(store.values.length);used[0]=1;
    const B=HOT_BIT;
    for(let index=0;index<store.length;index++){
      if(!(u8[index*STRIDE+O.flags]&ALIVE))continue;const w=index*WORDS_PER_ROW,present=u32[w+O.present];
      used[u32[w+O.profile]]=1;used[u32[w+O.binding]]=1;
      if(present&B.id)used[u32[w+O.idPattern]]=1;if(present&B.name)used[u32[w+O.namePattern]]=1;
      if(present&B.routeId)used[u32[w+O.routeId]]=1;if(present&B.baseFacility)used[u32[w+O.baseFacility]]=1;if(present&B.phase)used[u32[w+O.phase]]=1;if(present&B.lastTrip)used[u32[w+O.lastTrip]]=1;
    }
    let freed=0;const freedRefs=[];
    for(let ref=1;ref<store.values.length;ref++){
      const stored=store.values[ref];if(used[ref]||stored===null||stored===undefined)continue;
      const key=valueKey(stored);if(r.index.get(key)===ref)r.index.delete(key);store.values[ref]=null;r.free.push(ref);freedRefs.push(ref);freed++;
    }
    // Build 358 (million-asset): a freed ref is held by no live row. Every cache valid now was computed from rows that
    // have not changed since (class tables, id checks and distinct lists per chunk version), so none holds a freed ref
    // and they all stay valid; the id index only forgets id patterns no live row uses. (Dropping the index and every
    // cached scan here cost a full rebuild after each daily maintenance.)
    if(freed&&r.ids)for(const ref of freedRefs){const map=r.ids.patterns.get(ref);if(!map)continue;if(map.size){r.ids=null;break;}r.ids.patterns.delete(ref);}
    return {freed,values:store.values.length,free:r.free.length};
  }
  // The mark phase is read-only and may span frames. A fleet/value-table write while it is paused invalidates the mark;
  // the caller retries instead of sweeping from a mixed snapshot. Sweeping is intentionally one bounded value-table
  // pass: it mutates the free list and therefore must not yield halfway through.
  function* collectValuesStages(store,{rowSlice=4096}={}){
    const r=rt(store);if(r.journal&&r.journal.active)throw new Error('fleet-store-gc-inside-transaction');
    rowSlice=Math.max(256,Math.floor(Number(rowSlice)||4096));
    const revision=store.revision,length=store.length,valuesLength=store.values.length,generation=r.valuesGeneration;
    const v=r.views,u32=v.u32,u8=v.u8,used=new Uint8Array(valuesLength);used[0]=1;const B=HOT_BIT;
    for(let from=0;from<length;from+=rowSlice){
      const to=Math.min(length,from+rowSlice);
      for(let index=from;index<to;index++){
        if(!(u8[index*STRIDE+O.flags]&ALIVE))continue;const w=index*WORDS_PER_ROW,present=u32[w+O.present];
        used[u32[w+O.profile]]=1;used[u32[w+O.binding]]=1;
        if(present&B.id)used[u32[w+O.idPattern]]=1;if(present&B.name)used[u32[w+O.namePattern]]=1;
        if(present&B.routeId)used[u32[w+O.routeId]]=1;if(present&B.baseFacility)used[u32[w+O.baseFacility]]=1;if(present&B.phase)used[u32[w+O.phase]]=1;if(present&B.lastTrip)used[u32[w+O.lastTrip]]=1;
      }
      if(to<length)yield {stage:'mark',rows:to,total:length};
    }
    if(store.revision!==revision||store.length!==length||store.values.length!==valuesLength||r.valuesGeneration!==generation)return {stale:true,freed:0,values:store.values.length,free:r.free.length};
    let freed=0;const freedRefs=[];
    for(let ref=1;ref<valuesLength;ref++){
      const stored=store.values[ref];if(used[ref]||stored===null||stored===undefined)continue;
      const key=valueKey(stored);if(r.index.get(key)===ref)r.index.delete(key);store.values[ref]=null;r.free.push(ref);freedRefs.push(ref);freed++;
    }
    if(freed&&r.ids)for(const ref of freedRefs){const map=r.ids.patterns.get(ref);if(!map)continue;if(map.size){r.ids=null;break;}r.ids.patterns.delete(ref);}
    return {stale:false,freed,values:store.values.length,free:r.free.length};
  }
  function stats(store){
    const r=rt(store),bytes=STRIDE*store.length;
    return {length:store.length,live:store.live,capacity:store.capacity,values:store.values.length,freeValues:r.free.length,extras:Object.keys(store.extras).length,columnBytes:bytes,bytesPerAsset:store.length?STRIDE:0};
  }

  // ------------------------------------------------------------- replica ---
  // Build 358 (fleet engine thread): a Worker keeps a replica of the store and runs the event engine on it; the main
  // thread replays the result. Rows travel as whole 128-byte records; values are mirrored by reference number in both
  // directions, so a row's references mean the same values on both sides whatever order each free list holds.
  // The store's counters, value table, extras and a copy of its rows: a replica starts from this.
  function exportReplica(store){
    return {schema:store.schema,version:store.version,length:store.length,live:store.live,structure:store.structure,revision:store.revision,
      values:store.values.map(value=>value===undefined?null:value),extras:{...store.extras},rows:store.rows.slice(0,store.length*STRIDE)};
  }
  function importReplica(payload){
    const length=Math.max(0,Math.floor(Number(payload?.length)||0));
    if(!(payload?.rows instanceof ArrayBuffer)||payload.rows.byteLength!==length*STRIDE||!Array.isArray(payload.values))throw new Error('fleet-replica-invalid');
    return {schema:SCHEMA,version:VERSION,length,live:Math.max(0,Math.floor(Number(payload.live)||0)),capacity:length,structure:Number(payload.structure)||0,revision:Number(payload.revision)||0,
      values:payload.values,rows:payload.rows,extras:isObject(payload.extras)?payload.extras:{}};
  }
  // Value-table changes since `previous` (a copy of store.values taken at the last exchange): [ref, value|null] pairs.
  function valueChanges(store,previous){
    const values=store.values,changes=[],n=Math.max(values.length,previous.length);
    for(let ref=1;ref<n;ref++){const a=ref<values.length?values[ref]??null:null,b=ref<previous.length?previous[ref]??null:null;if(a!==b)changes.push([ref,a]);}
    return {length:values.length,changes};
  }
  // Replica side, outside any journal: sets values by reference number, then rebuilds the free list in ascending order.
  function applyValueChanges(store,{length,changes}){
    const r=rt(store),values=store.values;
    for(const [ref,value] of changes){
      if(ref<values.length)unindexValue(r,values[ref],ref);
      while(values.length<ref)values.push(null);
      values[ref]=value===undefined?null:value;
      if(values[ref]!==null){const key=valueKey(values[ref]);if(!r.index.has(key))r.index.set(key,ref);}
    }
    if(values.length>length){for(let ref=length;ref<values.length;ref++)unindexValue(r,values[ref],ref);values.length=length;}
    while(values.length<length)values.push(null);
    r.free=[];for(let ref=1;ref<values.length;ref++)if(values[ref]===null)r.free.push(ref);
    r.indexedTo=values.length;r.valuesGeneration=++epochCounter;
  }
  // Main side: interns `value` at the reference another realm's intern() gave it. Journaled like intern() (an appended
  // value is removed and a reused slot freed again on rollback). False when that reference holds another value or is not
  // the next slot: the replicas disagree and the caller must not use the result.
  function internAt(store,ref,value){
    if(value===null||value===undefined)return ref===0;
    const r=rt(store),key=valueKey(value),found=r.index.get(key);
    if(found!==undefined)return found===ref;
    const stored=typeof value==='string'?value:jsonCopy(value);
    if(ref===store.values.length){store.values.push(stored);r.indexedTo=store.values.length;r.index.set(key,ref);r.valuesGeneration=++epochCounter;return true;}
    if(!(ref>0&&ref<store.values.length)||(store.values[ref]!==null&&store.values[ref]!==undefined))return false;
    const at=r.free.lastIndexOf(ref);if(at<0)return false;
    r.free.splice(at,1);store.values[ref]=stored;if(r.journal&&r.journal.active)r.journal.reused.push(ref);r.index.set(key,ref);r.valuesGeneration=++epochCounter;return true;
  }
  // Build 359: whole columns (a field of every row) for the other side, when the main thread rewrote them wholesale (the
  // daily fleet pass writes flight hours, cycles and the next check of every asset). Before, any column write sent the
  // whole store again (67 ms at 24,000 assets on iPhone); a column is one number per row.
  function readColumns(store,names){
    const columns=[];for(const name of names){if(!own(SLOTS,name))throw new RangeError(`fleet-store-column:${name}`);columns.push([name,gatherField(store,name).buffer]);}
    return {length:store.length,columns};
  }
  // Replica side, outside any journal: writes those columns and reports them as the main side's rememberColumn did
  // (`reported`: the names its dirty log carried; a quiet presence write stays quiet here too).
  function writeColumns(store,{length,columns},{reported=[]}={}){
    if(length!==store.length)throw new Error('fleet-replica-columns-length');
    const v=views(store);
    for(const [name,buffer] of columns){
      if(!own(SLOTS,name))throw new RangeError(`fleet-store-column:${name}`);
      const [view,k]=SLOTS[name],per=PER_ROW[view],target=v[view],source=new target.constructor(buffer);
      if(source.length!==length)throw new Error('fleet-replica-columns-invalid');
      for(let index=0;index<length;index++)target[index*per+k]=source[index];
    }
    const r=rt(store);r.allDirty=true;r.massVersion++;store.revision++;invalidateProfiles(store);
    const loud=new Set(reported);for(const [name] of columns)if(loud.has(name)&&!r.suppressDirtyLog){if(!r.dirtyColumns)r.dirtyColumns=new Set();r.dirtyColumns.add(name);}
  }
  // Copies of whole records and their extras, for the rows listed (to send to the other side).
  function readRows(store,indices){
    const bytes=new ArrayBuffer(indices.length*STRIDE),dst=new Uint32Array(bytes),src=views(store).u32,extras=new Array(indices.length);
    for(let k=0;k<indices.length;k++){const index=indices[k];for(let w=0,from=index*WORDS_PER_ROW,to=k*WORDS_PER_ROW;w<WORDS_PER_ROW;w++)dst[to+w]=src[from+w];extras[k]=own(store.extras,index)?store.extras[index]:undefined;}
    return {bytes,extras};
  }
  // Writes whole records computed by the other side, each row through the toucher as the event engine's own writes go
  // (journaled once inside a transaction, marked for the engine and the dirty log), then moves the revision by at least
  // `revisionDelta` (the writer's own count). `staticRows`: the writes may reach fields outside the engine's (the general
  // path), so class tables over those rows are invalidated too.
  function writeRows(store,indices,bytes,extras,{revisionDelta=0,staticRows=false}={}){
    const before=store.revision,touch=toucher(store),src=new Uint32Array(bytes),dst=views(store).u32;
    if(src.length!==indices.length*WORDS_PER_ROW)throw new Error('fleet-replica-rows-invalid');
    for(let k=0;k<indices.length;k++){
      const index=indices[k];if(!(index>=0&&index<store.length))throw new Error('fleet-replica-row-out-of-range');
      touch(index);for(let w=0,from=k*WORDS_PER_ROW,to=index*WORDS_PER_ROW;w<WORDS_PER_ROW;w++)dst[to+w]=src[from+w];
      const extra=extras?.[k];if(extra===undefined||extra===null)delete store.extras[index];else store.extras[index]=extra;
    }
    const r=rt(store);
    if(staticRows&&indices.length){invalidateProfiles(store);for(let k=0;k<indices.length;k++){const chunk=indices[k]>>>CHUNK_SHIFT;r.staticVersions[chunk]++;}}
    const target=before+Math.max(0,Math.floor(Number(revisionDelta)||0));if(store.revision<target)store.revision=target;
    if(r.journal&&r.journal.active)r.journal.high=Math.max(r.journal.high,store.revision);
  }

  const API=Object.freeze({VERSION,SCHEMA,CHUNK_SHIFT,CHUNK_ROWS,ALIVE,EXTRAS,I32_NULL,PROFILE_FIELDS,BINDING_FIELDS,HOT_FIELDS,HOT_BIT,STRIDE,F64_PER_ROW,WORDS_PER_ROW,SLOTS,SLOT_NAMES,O,
    create,isStore,ensureCapacity,trimCapacity,isAlive,add,replace,remove,removeMany,set,patch,touch,toucher,remember,rememberColumn,readColumns,writeColumns,drainDirty,withoutDirtyLog,get,peek,keys,setGroupField,materialize,fromAssets,toAssets,forEachLive,buildIndex,indexOf,find,idAt,
    views,slot,setSlot,columnWriter,intern,value,valueKey,forEachPeek,splitPattern,joinPattern,compactRows,collectValues,collectValuesStages,distinctRefs,stats,epoch,valuesGeneration,bumpEpoch,beginJournal,journalFor,rollbackJournal,endJournal,journalStats,isPresent,extrasOf,dirtyChunks,clearDirtyChunks,chunkStamp,exportReplica,importReplica,valueChanges,applyValueChanges,internAt,readRows,writeRows,forEachClass,idCollisions,forEachProfile,forEachLeaseGroup,forEachPayrollGroup});
  globalThis.GH_FLEET_STORE=API;
  if(globalThis.window&&globalThis.window!==globalThis)globalThis.window.GH_FLEET_STORE=API;
  if(typeof module!=='undefined'&&module.exports)module.exports=API;
})();

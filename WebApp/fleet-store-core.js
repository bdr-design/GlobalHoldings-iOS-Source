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
  // in extras. Order is the materialized key order after the profile fields.
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
  const STRIDE=128,F64_PER_ROW=16,WORDS_PER_ROW=32;
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
      r={values:store.values,views:makeViews(store.rows),index:new Map(),indexedTo:0,free:[],ids:null,
        dirty:[],dirtyFrom:store.revision,dirtyLost:false,dirtyColumns:null,suppressDirtyLog:false,
        dirtyChunks:new Uint8Array(Math.max(1,Math.ceil(store.capacity/CHUNK_ROWS))),allDirty:true,journal:null,epoch:++epochCounter,valuesGeneration:++epochCounter};
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
      if(r.journal&&r.journal.active&&r.journal.seen.length<cap){const seen=new Uint8Array(cap);seen.set(r.journal.seen);r.journal.seen=seen;}
    }
  }
  function trimCapacity(store){if(store.capacity!==store.length)resize(store,store.length);return store;}
  function isAlive(store,index){return index>=0&&index<store.length&&(views(store).u8[index*STRIDE+O.flags]&ALIVE)!==0;}
  function markDirty(r,index){r.dirtyChunks[index>>>CHUNK_SHIFT]=1;}
  // Chunks with rows changed since the last persistence checkpoint.
  function dirtyChunks(store){const r=rt(store),chunks=Math.ceil(store.length/CHUNK_ROWS),out=[];for(let chunk=0;chunk<chunks;chunk++)if(r.allDirty||r.dirtyChunks[chunk])out.push(chunk);return out;}
  function clearDirtyChunks(store){const r=rt(store);r.dirtyChunks.fill(0);r.allDirty=false;}

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
      r.dirtyChunks[index>>>CHUNK_SHIFT]=1;
    };
  }
  // Mass writers (one field of very many rows) snapshot that field once.
  function gatherField(store,name){const [view,k]=SLOTS[name],per=PER_ROW[view],source=views(store)[view],copy=new source.constructor(store.length);for(let index=0;index<store.length;index++)copy[index]=source[index*per+k];return copy;}
  function rememberColumn(store,name){
    if(!own(SLOTS,name))throw new RangeError(`fleet-store-column:${name}`);
    const journal=journalFor(store);if(journal&&!journal.fields.has(name))journal.fields.set(name,{copy:gatherField(store,name),logCount:journal.log.count});
    const r=rt(store);r.allDirty=true;store.revision++;if(journal)journal.high=store.revision;
    if(!r.suppressDirtyLog){if(!r.dirtyColumns)r.dirtyColumns=new Set();r.dirtyColumns.add(name);}
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
    const r=rt(store),v=r.views,log=journal.log;
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
    if(journal.fields.size){r.allDirty=true;if(!r.dirtyColumns)r.dirtyColumns=new Set();for(const name of journal.fields.keys())r.dirtyColumns.add(name);}
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
    if(kind==='i32')return Number.isInteger(value)&&value>=-2147483648&&value<=2147483647&&!Object.is(value,-0);
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
    else views(store).i32[index*WORDS_PER_ROW+O[field]]=value;
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
    return v.i32[index*WORDS_PER_ROW+O[field]];
  }
  function peekHot(store,index,field,kind){return kind==='ref'?value(store,views(store).u32[index*WORDS_PER_ROW+O[field]]):readHot(store,index,field,kind);}
  function extrasOf(store,index){return (flagsOf(store,index)&EXTRAS)!==0&&own(store.extras,index)?store.extras[index]:null;}
  function groupObject(store,ref){const out=value(store,ref);return isObject(out)?out:{};}
  function groupRef(store,index,group){return views(store).u32[index*WORDS_PER_ROW+O[group]];}
  function setGroupField(store,index,group,field,value){
    const current=groupObject(store,groupRef(store,index,group)),next={};
    let placed=false;for(const key of Object.keys(current)){if(key===field){placed=true;if(value!==undefined)next[key]=value;}else next[key]=current[key];}
    if(!placed&&value!==undefined)next[field]=value;
    const ref=intern(store,next);views(store).u32[index*WORDS_PER_ROW+O[group]]=ref;
  }
  function setExtra(store,index,field,value){
    const current=extrasOf(store,index),next={...(current||{})},u8=views(store).u8;
    if(value===undefined)delete next[field];else next[field]=jsonCopy(value);
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
      if(hot){if(hotFits(hot,value))writeHot(store,index,key,hot,value);else extras[key]=jsonCopy(value);}
      else if(PROFILE_SET.has(key))profile[key]=value;
      else if(BINDING_SET.has(key))binding[key]=value;
      else extras[key]=jsonCopy(value);
    }
    const profileRef=intern(store,profile),bindingRef=intern(store,binding),v=views(store),w=index*WORDS_PER_ROW;
    v.u32[w+O.profile]=profileRef;v.u32[w+O.binding]=bindingRef;
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
    if(unique.size)bumpStructure(store);
    return unique.size;
  }
  function remove(store,index){return removeMany(store,[index])===1;}
  function materialize(store,index){
    const out={},present=presentOf(store,index),profile=groupObject(store,groupRef(store,index,'profile')),binding=groupObject(store,groupRef(store,index,'binding'));
    if(present&1)out.id=readHot(store,index,'id','pattern');
    for(const key of Object.keys(profile))out[key]=copyValue(profile[key]);
    for(let i=1;i<HOT_FIELDS.length;i++){if(present&(1<<i)){const [field,kind]=HOT_FIELDS[i];out[field]=readHot(store,index,field,kind);}}
    for(const key of Object.keys(binding))out[key]=copyValue(binding[key]);
    const extras=extrasOf(store,index);if(extras)for(const key of Object.keys(extras))out[key]=copyValue(extras[key]);
    return out;
  }
  // Own keys of the materialized asset, in materialize order, without building it.
  function keys(store,index){
    const out=[],seen=new Set(),present=presentOf(store,index),push=key=>{if(!seen.has(key)){seen.add(key);out.push(key);}};
    if(present&1)push('id');
    for(const key of Object.keys(groupObject(store,groupRef(store,index,'profile'))))push(key);
    for(let i=1;i<HOT_FIELDS.length;i++)if(present&(1<<i))push(HOT_FIELDS[i][0]);
    for(const key of Object.keys(groupObject(store,groupRef(store,index,'binding'))))push(key);
    const extras=extrasOf(store,index);if(extras)for(const key of Object.keys(extras))push(key);
    return out;
  }
  function fromAssets(assets,{at=0}={}){
    const list=Array.isArray(assets)?assets:[],store=create(list.length);
    for(let index=0;index<list.length;index++){store.length=index+1;store.live++;ingestRow(store,index,list[index],at);}
    store.structure=1;return store;
  }
  function forEachLive(store,fn){const u8=views(store).u8;for(let index=0;index<store.length;index++)if(u8[index*STRIDE+O.flags]&ALIVE)fn(index);}
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
    r.allDirty=true;r.dirty=[];r.dirtyLost=true;bumpEpoch(store);return {removed,length:write};
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
    let freed=0;
    for(let ref=1;ref<store.values.length;ref++){
      const stored=store.values[ref];if(used[ref]||stored===null||stored===undefined)continue;
      const key=valueKey(stored);if(r.index.get(key)===ref)r.index.delete(key);store.values[ref]=null;r.free.push(ref);freed++;
    }
    if(freed){r.ids=null;r.valuesGeneration=++epochCounter;}
    return {freed,values:store.values.length,free:r.free.length};
  }
  function stats(store){
    const r=rt(store),bytes=STRIDE*store.length;
    return {length:store.length,live:store.live,capacity:store.capacity,values:store.values.length,freeValues:r.free.length,extras:Object.keys(store.extras).length,columnBytes:bytes,bytesPerAsset:store.length?STRIDE:0};
  }

  const API=Object.freeze({VERSION,SCHEMA,CHUNK_SHIFT,CHUNK_ROWS,ALIVE,EXTRAS,PROFILE_FIELDS,BINDING_FIELDS,HOT_FIELDS,HOT_BIT,STRIDE,F64_PER_ROW,WORDS_PER_ROW,SLOTS,SLOT_NAMES,O,
    create,isStore,ensureCapacity,trimCapacity,isAlive,add,replace,remove,removeMany,set,patch,touch,toucher,remember,rememberColumn,drainDirty,withoutDirtyLog,get,peek,keys,setGroupField,materialize,fromAssets,toAssets,forEachLive,indexOf,find,idAt,
    views,slot,setSlot,intern,value,valueKey,splitPattern,joinPattern,compactRows,collectValues,stats,epoch,valuesGeneration,bumpEpoch,beginJournal,journalFor,rollbackJournal,endJournal,journalStats,isPresent,extrasOf,dirtyChunks,clearDirtyChunks});
  globalThis.GH_FLEET_STORE=API;
  if(globalThis.window&&globalThis.window!==globalThis)globalThis.window.GH_FLEET_STORE=API;
  if(typeof module!=='undefined'&&module.exports)module.exports=API;
})();

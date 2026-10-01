// Fleet Core v4 — compact columnar fleet store (gh-fleet-store-v1).
// One asset is one row across typed-array columns instead of a ~2.3 KB object.
// Fields that are constant for a purchase batch (owner, model, specs, crew,
// lease, delivery refs…) live in one shared, interned "profile" object; fields
// derived from the assigned route live in one interned "binding" object. Every
// asset still owns its own values from the player's point of view: writing one
// asset's specs re-interns a new profile for that asset only. Rare or
// non-conforming fields are kept verbatim per asset in `extras`, so ingest →
// materialize preserves every JSON value of the original asset object.
(()=>{
  'use strict';
  const VERSION='4.0.0',SCHEMA='gh-fleet-store-v1';
  const PROFILE_FIELDS=Object.freeze(['ownerCompanyId','assetMode','assetClass','operationProfileId','type','icon','model','year','catalogId','specs','ownership','monthlyLease','leaseTermMonths','leaseStartSeconds','purchasePrice','companyName','deliveryOrderId','requestRef','paymentRef','deliveryStatus','deliveredDay','deliveredAtSeconds','staffing']);
  const BINDING_FIELDS=Object.freeze(['routeSignature','from','to','distanceKm','tripSeconds','effectiveSpeedKmh','dwellHours','load']);
  // Hot fields own a column. Kinds: pattern (prefix+number string), ref (interned
  // value), f64, i32, bool. Order is the materialized key order after profile.
  const HOT_FIELDS=Object.freeze([
    ['id','pattern'],['name','pattern'],['routeId','ref'],['baseFacility','ref'],['phase','ref'],
    ['progress','f64'],['fuel','f64'],['condition','f64'],['dwellRemaining','f64'],['reverse','bool'],
    ['routeSlot','i32'],['departureScheduled','bool'],['departureScheduledAt','f64'],['crewBlocked','bool'],
    ['releaseExclusiveRouteOnArrival','bool'],['simCarrySeconds','f64'],['lastTransitionGuardDay','i32'],['lastTrip','ref']
  ]);
  if(HOT_FIELDS.length>32)throw new Error('fleet-store-presence-mask-overflow');
  const HOT_INDEX=new Map(HOT_FIELDS.map(([name],index)=>[name,index]));
  const PROFILE_SET=new Set(PROFILE_FIELDS),BINDING_SET=new Set(BINDING_FIELDS);
  // Physical columns. `at` is the simulation checkpoint time at which progress,
  // fuel, condition and dwellRemaining hold; it is not an asset field.
  const COLUMN_TYPES=Object.freeze({
    present:Uint32Array,profile:Uint32Array,binding:Uint32Array,extra:Uint8Array,at:Float64Array,
    idPattern:Uint32Array,idNumber:Float64Array,namePattern:Uint32Array,nameNumber:Float64Array,
    routeId:Uint32Array,baseFacility:Uint32Array,phase:Uint32Array,progress:Float64Array,fuel:Float64Array,condition:Float64Array,
    dwellRemaining:Float64Array,reverse:Uint8Array,routeSlot:Int32Array,departureScheduled:Uint8Array,departureScheduledAt:Float64Array,
    crewBlocked:Uint8Array,releaseExclusiveRouteOnArrival:Uint8Array,simCarrySeconds:Float64Array,lastTransitionGuardDay:Int32Array,lastTrip:Uint32Array
  });
  const COLUMN_NAMES=Object.freeze(Object.keys(COLUMN_TYPES));
  const PATTERN_COLUMNS=Object.freeze({id:['idPattern','idNumber'],name:['namePattern','nameNumber']});
  const own=(value,key)=>Object.prototype.hasOwnProperty.call(value,key);
  const isObject=value=>!!value&&typeof value==='object'&&!Array.isArray(value);

  // ---------------------------------------------------------------- values ---
  // values[0] is null. Strings and JSON values are interned by their JSON text so
  // equal values share one ref. Interned objects are append-only and never mutated
  // (materialize returns copies; peek is read-only by contract). They are not
  // frozen so Transaction Core can restore the table in place.
  const runtime=new WeakMap();
  function rt(store){
    let r=runtime.get(store);
    if(!r||r.values!==store.values){r={values:store.values,index:new Map(),indexedTo:0,ids:null,idsStructure:-1,dirty:[],dirtyFrom:store.revision};runtime.set(store,r);}
    if(r.indexedTo<store.values.length){for(let ref=r.indexedTo;ref<store.values.length;ref++){const key=valueKey(store.values[ref]);if(!r.index.has(key))r.index.set(key,ref);}r.indexedTo=store.values.length;}
    return r;
  }
  function valueKey(value){return typeof value==='string'?`s${value}`:`j${JSON.stringify(value)}`;}
  function jsonCopy(value){return value===undefined?undefined:JSON.parse(JSON.stringify(value));}
  function intern(store,value){
    if(value===null||value===undefined)return 0;
    const r=rt(store),key=valueKey(value),found=r.index.get(key);if(found!==undefined)return found;
    const stored=typeof value==='string'?value:jsonCopy(value),ref=store.values.length;
    store.values.push(stored);r.index.set(key,ref);r.indexedTo=store.values.length;return ref;
  }
  function value(store,ref){return ref===0?null:store.values[ref];}
  function copyValue(value){return value&&typeof value==='object'?jsonCopy(value):value;}

  // -------------------------------------------------------------- patterns ---
  // "N-ROAD-00000006" → {p:"N-ROAD-",w:8} + 6. Anything that does not
  // round-trip exactly stays verbatim in extras.
  function splitPattern(text){
    if(typeof text!=='string')return null;const match=/^([\s\S]*?)(\d{1,15})$/.exec(text);if(!match)return null;
    const digits=match[2],number=Number(digits),width=digits.length>1&&digits[0]==='0'?digits.length:0;
    if(!Number.isSafeInteger(number))return null;const pattern={p:match[1],w:width};
    return joinPattern(pattern,number)===text?{pattern,number}:null;
  }
  function joinPattern(pattern,number){const digits=String(number);return pattern.p+(pattern.w?digits.padStart(pattern.w,'0'):digits);}

  // --------------------------------------------------------------- storage ---
  function create(capacity=0){
    const columns={},cap=Math.max(0,Math.floor(Number(capacity)||0));for(const name of COLUMN_NAMES)columns[name]=new COLUMN_TYPES[name](cap);
    return {schema:SCHEMA,version:VERSION,length:0,capacity:cap,structure:0,revision:0,values:[null],columns,extras:{}};
  }
  function isStore(store){return isObject(store)&&store.schema===SCHEMA&&isObject(store.columns)&&Array.isArray(store.values);}
  function ensureCapacity(store,needed){
    if(needed<=store.capacity)return;let cap=Math.max(16,store.capacity);while(cap<needed)cap=Math.ceil(cap*1.5);
    for(const name of COLUMN_NAMES){const next=new COLUMN_TYPES[name](cap);next.set(store.columns[name].subarray(0,store.length));store.columns[name]=next;}
    store.capacity=cap;
  }
  function trimCapacity(store){
    if(store.capacity===store.length)return store;
    for(const name of COLUMN_NAMES)store.columns[name]=store.columns[name].slice(0,store.length);
    store.capacity=store.length;return store;
  }

  // --------------------------------------------------------------- journal ---
  // A journal keeps the first preimage of every row it touches plus the
  // pre-transaction length, so a rollback is O(rows touched), never a fleet clone.
  let activeJournal=null;
  function beginJournal(store){
    const journal={store,length:store.length,structure:store.structure,revision:store.revision,valuesLength:store.values.length,rows:new Map(),columns:null,extras:null,active:true,parent:activeJournal};
    activeJournal=journal;return journal;
  }
  function journalFor(store){
    for(let journal=activeJournal;journal;journal=journal.parent)if(journal.store===store&&journal.active)return journal;
    const tx=globalThis.GH_TRANSACTION_CORE;
    if(tx?.isActive?.()&&typeof tx.registerUndo==='function'){
      const journal=beginJournal(store);
      tx.registerUndo(()=>rollbackJournal(journal),()=>endJournal(journal));
      return journal;
    }
    return null;
  }
  function readRow(store,index){
    const row={};for(const name of COLUMN_NAMES)row[name]=store.columns[name][index];
    row.extras=own(store.extras,index)?store.extras[index]:undefined;return row;
  }
  function writeRow(store,index,row){
    for(const name of COLUMN_NAMES)store.columns[name][index]=row[name];
    if(row.extras===undefined)delete store.extras[index];else store.extras[index]=row.extras;
  }
  function remember(store,index){
    const journal=journalFor(store);if(!journal||journal.columns||journal.rows.has(index))return;
    journal.rows.set(index,index<store.length?readRow(store,index):null);
  }
  // An order-preserving removal moves every later row. The journal then keeps
  // one copy of the columns (a memcpy per column) instead of row preimages;
  // rows remembered before that copy are still applied on rollback.
  function rememberColumns(store){
    const journal=journalFor(store);if(!journal||journal.columns)return;
    const columns={};for(const name of COLUMN_NAMES)columns[name]=store.columns[name].slice(0,store.length);
    journal.columns=columns;journal.columnsLength=store.length;journal.extras={...store.extras};
  }
  function rollbackJournal(journal){
    if(!journal.active)return;const store=journal.store;
    if(journal.columns){
      if(journal.columnsLength>store.capacity)ensureCapacity(store,journal.columnsLength);
      for(const name of COLUMN_NAMES)store.columns[name].set(journal.columns[name],0);
      store.extras=journal.extras;store.length=journal.columnsLength;
    }
    if(journal.length>store.capacity)ensureCapacity(store,journal.length);
    for(const [index,row] of journal.rows){if(row)writeRow(store,index,row);}
    for(let index=journal.length;index<store.length;index++)delete store.extras[index];
    store.length=journal.length;store.structure=journal.structure;store.revision=journal.revision;
    if(store.values.length>journal.valuesLength){store.values.length=journal.valuesLength;const r=runtime.get(store);if(r){r.index=new Map();r.indexedTo=0;}}
    endJournal(journal);
  }
  function endJournal(journal){
    journal.active=false;
    if(activeJournal===journal)activeJournal=journal.parent;
    else for(let cursor=activeJournal;cursor;cursor=cursor.parent)if(cursor.parent===journal){cursor.parent=journal.parent;break;}
  }

  // ----------------------------------------------------------- read/write ---
  function presentBit(field){return 1<<HOT_INDEX.get(field);}
  function isPresent(store,index,field){return (store.columns.present[index]&presentBit(field))!==0;}
  function hotFits(kind,value){
    if(kind==='f64')return typeof value==='number';
    if(kind==='i32')return Number.isInteger(value)&&value>=-2147483648&&value<=2147483647&&!Object.is(value,-0);
    if(kind==='bool')return typeof value==='boolean';
    if(kind==='pattern')return splitPattern(value)!==null;
    return value!==undefined;
  }
  function writeHot(store,index,field,kind,value){
    const c=store.columns,bit=presentBit(field);
    if(kind==='pattern'){const [pc,nc]=PATTERN_COLUMNS[field],split=splitPattern(value);c[pc][index]=intern(store,split.pattern);c[nc][index]=split.number;}
    else if(kind==='ref')c[field][index]=intern(store,value);
    else if(kind==='bool')c[field][index]=value?1:0;
    else c[field][index]=value;
    c.present[index]|=bit;
  }
  function clearHot(store,index,field){store.columns.present[index]&=~presentBit(field);}
  function readHot(store,index,field,kind){
    const c=store.columns;
    if(kind==='pattern'){const [pc,nc]=PATTERN_COLUMNS[field];return joinPattern(store.values[c[pc][index]],c[nc][index]);}
    if(kind==='ref')return copyValue(value(store,c[field][index]));
    if(kind==='bool')return c[field][index]===1;
    return c[field][index];
  }
  function groupObject(store,ref){const out=value(store,ref);return isObject(out)?out:{};}
  function setGroupField(store,index,column,field,value){
    const current=groupObject(store,store.columns[column][index]),next={};
    let placed=false;for(const key of Object.keys(current)){if(key===field){placed=true;if(value!==undefined)next[key]=value;}else next[key]=current[key];}
    if(!placed&&value!==undefined)next[field]=value;
    store.columns[column][index]=intern(store,next);
  }
  function setExtra(store,index,field,value){
    const current=own(store.extras,index)?store.extras[index]:null,next={...(current||{})};
    if(value===undefined)delete next[field];else next[field]=jsonCopy(value);
    if(Object.keys(next).length){store.extras[index]=next;store.columns.extra[index]=1;}else{delete store.extras[index];store.columns.extra[index]=0;}
  }
  // Write one asset field exactly as a plain object assignment would (undefined
  // deletes, as JSON drops it). All writes are journaled inside a transaction.
  function set(store,index,field,value){
    if(!(index>=0&&index<store.length))throw new RangeError(`fleet-store-index:${index}`);
    remember(store,index);store.revision++;rt(store).dirty.push(index);
    if(field==='id')store.structure++;
    const hot=HOT_INDEX.has(field)?HOT_FIELDS[HOT_INDEX.get(field)][1]:null;
    if(own(store.extras,index)&&own(store.extras[index],field))setExtra(store,index,field,undefined);
    if(hot){if(value===undefined){clearHot(store,index,field);return;}if(hotFits(hot,value)){writeHot(store,index,field,hot,value);return;}clearHot(store,index,field);setExtra(store,index,field,value);return;}
    if(PROFILE_SET.has(field)){setGroupField(store,index,'profile',field,value);return;}
    if(BINDING_SET.has(field)){setGroupField(store,index,'binding',field,value);return;}
    setExtra(store,index,field,value);
  }
  // Hot-path entry for owners that write columns directly (the event engine):
  // journal the row once, bump the revision, then write typed columns.
  function touch(store,index){remember(store,index);store.revision++;rt(store).dirty.push(index);}
  // Rows written since the last drain, valid only when no unexplained revision
  // change happened (a snapshot restore or a durable publish): then `complete` is
  // false and event owners rebuild instead of patching.
  function drainDirty(store,sinceRevision){
    const r=rt(store),complete=r.dirtyFrom===sinceRevision&&store.revision-sinceRevision===r.dirty.length,indices=r.dirty;
    r.dirty=[];r.dirtyFrom=store.revision;return {complete,indices,revision:store.revision};
  }
  function patch(store,index,fields){for(const field of Object.keys(fields))set(store,index,field,fields[field]);return index;}
  function get(store,index,field){
    if(own(store.extras,index)&&own(store.extras[index],field))return copyValue(store.extras[index][field]);
    if(HOT_INDEX.has(field))return isPresent(store,index,field)?readHot(store,index,field,HOT_FIELDS[HOT_INDEX.get(field)][1]):undefined;
    if(PROFILE_SET.has(field)){const group=groupObject(store,store.columns.profile[index]);return own(group,field)?copyValue(group[field]):undefined;}
    if(BINDING_SET.has(field)){const group=groupObject(store,store.columns.binding[index]);return own(group,field)?copyValue(group[field]):undefined;}
    return undefined;
  }
  // Shared (frozen) read without copying — only for read-only hot paths.
  function peek(store,index,field){
    if(own(store.extras,index)&&own(store.extras[index],field))return store.extras[index][field];
    if(HOT_INDEX.has(field)){if(!isPresent(store,index,field))return undefined;const kind=HOT_FIELDS[HOT_INDEX.get(field)][1];return kind==='ref'?value(store,store.columns[field][index]):readHot(store,index,field,kind);}
    if(PROFILE_SET.has(field))return groupObject(store,store.columns.profile[index])[field];
    if(BINDING_SET.has(field))return groupObject(store,store.columns.binding[index])[field];
    return undefined;
  }

  // ------------------------------------------------------ ingest/materialize ---
  function ingestRow(store,index,asset,at){
    const c=store.columns,profile={},binding={},extras={};c.present[index]=0;c.at[index]=Number.isFinite(at)?at:0;c.extra[index]=0;
    for(const key of Object.keys(asset)){
      const value=asset[key];if(value===undefined||typeof value==='function'||typeof value==='symbol')continue;
      const hot=HOT_INDEX.has(key)?HOT_FIELDS[HOT_INDEX.get(key)][1]:null;
      if(hot){if(hotFits(hot,value))writeHot(store,index,key,hot,value);else extras[key]=jsonCopy(value);}
      else if(PROFILE_SET.has(key))profile[key]=value;
      else if(BINDING_SET.has(key))binding[key]=value;
      else extras[key]=jsonCopy(value);
    }
    c.profile[index]=intern(store,profile);c.binding[index]=intern(store,binding);
    if(Object.keys(extras).length){store.extras[index]=extras;c.extra[index]=1;}else delete store.extras[index];
  }
  function add(store,asset,{at=0}={}){
    if(!isObject(asset))throw new TypeError('fleet-store-asset-object-required');
    const index=store.length;remember(store,index);ensureCapacity(store,index+1);store.length=index+1;store.structure++;store.revision++;rt(store).dirty.push(index);
    ingestRow(store,index,asset,at);return index;
  }
  // Replace one row with a whole asset object (every field rewritten, like
  // assigning a fresh object at the same position).
  function replace(store,index,asset,{at=0}={}){
    if(!(index>=0&&index<store.length))throw new RangeError(`fleet-store-index:${index}`);
    if(!isObject(asset))throw new TypeError('fleet-store-asset-object-required');
    const previousId=idAt(store,index);remember(store,index);store.revision++;rt(store).dirty.push(index);
    ingestRow(store,index,asset,at);if(idAt(store,index)!==previousId)store.structure++;return index;
  }
  // Order-preserving removal of any set of rows in one pass (the array
  // splice/filter semantics the game relies on). Callers must not hold indices
  // across a structural change — use indexOf(id).
  function removeMany(store,indices){
    const drop=new Uint8Array(store.length);let count=0;
    for(const index of indices){if(!(index>=0&&index<store.length))throw new RangeError(`fleet-store-index:${index}`);if(!drop[index]){drop[index]=1;count++;}}
    if(!count)return 0;
    rememberColumns(store);
    let first=0;while(!drop[first])first++;
    const c=store.columns,extras={};for(const key of Object.keys(store.extras)){const index=Number(key);if(index<first)extras[index]=store.extras[key];}
    let write=first;
    for(let read=first;read<store.length;read++){
      if(drop[read])continue;
      if(write!==read){for(const name of COLUMN_NAMES)c[name][write]=c[name][read];}
      if(own(store.extras,read))extras[write]=store.extras[read];
      write++;
    }
    store.extras=extras;store.length=write;store.structure++;store.revision++;
    return count;
  }
  function remove(store,index){return removeMany(store,[index])===1;}
  function materialize(store,index){
    const out={},c=store.columns,profile=groupObject(store,c.profile[index]),binding=groupObject(store,c.binding[index]),present=c.present[index];
    if(present&1)out.id=readHot(store,index,'id','pattern');
    for(const key of Object.keys(profile))out[key]=copyValue(profile[key]);
    for(let i=1;i<HOT_FIELDS.length;i++){if(present&(1<<i)){const [field,kind]=HOT_FIELDS[i];out[field]=readHot(store,index,field,kind);}}
    for(const key of Object.keys(binding))out[key]=copyValue(binding[key]);
    if(c.extra[index]===1&&own(store.extras,index)){const extras=store.extras[index];for(const key of Object.keys(extras))out[key]=copyValue(extras[key]);}
    return out;
  }
  function fromAssets(assets,{at=0}={}){
    const list=Array.isArray(assets)?assets:[],store=create(list.length);
    for(let index=0;index<list.length;index++){store.length=index+1;ingestRow(store,index,list[index],at);}
    store.structure=1;return store;
  }
  function toAssets(store){const out=new Array(store.length);for(let index=0;index<store.length;index++)out[index]=materialize(store,index);return out;}

  // ---------------------------------------------------------------- lookup ---
  function idAt(store,index){return isPresent(store,index,'id')?readHot(store,index,'id','pattern'):(own(store.extras,index)?store.extras[index].id:undefined);}
  function indexOf(store,id){
    const r=rt(store);
    if(!r.ids||r.idsStructure!==store.structure||r.idsLength!==store.length){r.ids=new Map();for(let index=0;index<store.length;index++){const key=idAt(store,index);if(key!==undefined&&!r.ids.has(key))r.ids.set(key,index);}r.idsStructure=store.structure;r.idsLength=store.length;}
    const index=r.ids.get(id);return index===undefined?-1:index;
  }
  function find(store,id){const index=indexOf(store,id);return index<0?null:materialize(store,index);}
  // Value-table compaction: drop interned values no row references any more
  // (old lastTrip economics, replaced profiles). O(rows + values); run at save.
  function compact(store){
    const used=new Uint8Array(store.values.length),c=store.columns;used[0]=1;
    const mark=ref=>{used[ref]=1;};
    for(let index=0;index<store.length;index++){
      mark(c.profile[index]);mark(c.binding[index]);mark(c.idPattern[index]);mark(c.namePattern[index]);
      const present=c.present[index];
      for(const field of ['routeId','baseFacility','phase','lastTrip'])if(present&presentBit(field))mark(c[field][index]);
    }
    let removed=0;for(let ref=1;ref<used.length;ref++)if(!used[ref])removed++;
    if(!removed)return {removed:0,values:store.values.length};
    const remap=new Uint32Array(store.values.length),values=[null];
    for(let ref=1;ref<used.length;ref++)if(used[ref]){remap[ref]=values.length;values.push(store.values[ref]);}
    for(const column of ['profile','binding','idPattern','namePattern','routeId','baseFacility','phase','lastTrip']){const data=c[column];for(let index=0;index<store.length;index++)data[index]=remap[data[index]];}
    store.values=values;runtime.delete(store);store.revision++;return {removed,values:values.length};
  }
  function stats(store){
    let bytes=0;for(const name of COLUMN_NAMES)bytes+=store.columns[name].BYTES_PER_ELEMENT*store.length;
    return {length:store.length,capacity:store.capacity,values:store.values.length,extras:Object.keys(store.extras).length,columnBytes:bytes,bytesPerAsset:store.length?bytes/store.length:0};
  }

  const API=Object.freeze({VERSION,SCHEMA,PROFILE_FIELDS,BINDING_FIELDS,HOT_FIELDS,COLUMN_NAMES,COLUMN_TYPES,
    create,isStore,ensureCapacity,trimCapacity,add,replace,remove,removeMany,set,patch,touch,drainDirty,get,peek,setGroupField,materialize,fromAssets,toAssets,indexOf,find,idAt,
    intern,value,compact,stats,splitPattern,joinPattern,beginJournal,rollbackJournal,endJournal,isPresent});
  globalThis.GH_FLEET_STORE=API;
  if(globalThis.window&&globalThis.window!==globalThis)globalThis.window.GH_FLEET_STORE=API;
  if(typeof module!=='undefined'&&module.exports)module.exports=API;
})();

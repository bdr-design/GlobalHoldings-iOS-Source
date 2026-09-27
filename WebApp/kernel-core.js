/* Global Holdings transactional state kernel. Save Schema remains 2.0.0. */
((root,factory)=>{
  const api=factory();
  if(typeof module==='object'&&module.exports)module.exports=api;
  if(root)root.GH_KERNEL=api;
})(typeof globalThis!=='undefined'?globalThis:this,()=>{
  'use strict';
  const VERSION='GH-STATE-KERNEL-1.0.0';
  const clone=value=>{
    if(value===undefined)return undefined;
    if(typeof globalThis.structuredClone==='function')return globalThis.structuredClone(value);
    if(ArrayBuffer.isView(value))return new value.constructor(value);
    return JSON.parse(JSON.stringify(value));
  };
  const own=(value,key)=>Object.prototype.hasOwnProperty.call(value,key);
  const stable=value=>{
    if(value===undefined)return '"[undefined]"';
    if(typeof value==='number'&&!Number.isFinite(value))return JSON.stringify(String(value));
    if(ArrayBuffer.isView(value))return `{"$typed":"${value.constructor.name}","values":[${Array.from(value,stable).join(',')}]}`;
    if(Array.isArray(value))return `[${value.map(stable).join(',')}]`;
    if(value&&typeof value==='object')return `{${Object.keys(value).sort().map(key=>`${JSON.stringify(key)}:${stable(value[key])}`).join(',')}}`;
    return JSON.stringify(value);
  };
  function fingerprint(value){
    const text=stable(value);let a=0x811c9dc5,b=0x9e3779b9;
    for(let i=0;i<text.length;i++){
      const code=text.charCodeAt(i);a=Math.imul(a^code,0x01000193);b=Math.imul(b^(code+i),0x85ebca6b);
    }
    return `gh-fp-v1:${(a>>>0).toString(16).padStart(8,'0')}${(b>>>0).toString(16).padStart(8,'0')}:${text.length}`;
  }
  function firstDifference(a,b,path='$'){
    if(Object.is(a,b))return null;
    if(!a||!b||typeof a!=='object'||typeof b!=='object')return path;
    if(ArrayBuffer.isView(a)||ArrayBuffer.isView(b)){
      if(!ArrayBuffer.isView(a)||!ArrayBuffer.isView(b)||a.constructor!==b.constructor||a.length!==b.length)return path;
      for(let i=0;i<a.length;i++){const diff=firstDifference(a[i],b[i],`${path}[${i}]`);if(diff)return diff;}return null;
    }
    if(Array.isArray(a)||Array.isArray(b)){
      if(!Array.isArray(a)||!Array.isArray(b)||a.length!==b.length)return path;
      for(let i=0;i<a.length;i++){const diff=firstDifference(a[i],b[i],`${path}[${i}]`);if(diff)return diff;}return null;
    }
    const keys=[...new Set([...Object.keys(a),...Object.keys(b)])].sort();
    for(const key of keys){if(!own(a,key)||!own(b,key))return `${path}.${key}`;const diff=firstDifference(a[key],b[key],`${path}.${key}`);if(diff)return diff;}
    return null;
  }
  const pathParts=path=>Array.isArray(path)?path.map(String):String(path).split('.');
  function pathRead(root,path){let value=root;for(const key of pathParts(path)){if(value==null)return undefined;value=value[key];}return value;}
  function pathHasOwn(root,path){const parts=pathParts(path);let value=root;for(const key of parts.slice(0,-1)){if(value==null||typeof value!=='object'||!own(value,key))return false;value=value[key];}return !!value&&typeof value==='object'&&own(value,parts[parts.length-1]);}
  function pathWrite(root,path,value){const parts=pathParts(path);let target=root;for(const key of parts.slice(0,-1)){if(!target[key]||typeof target[key]!=='object'||Array.isArray(target[key]))target[key]={};target=target[key];}target[parts[parts.length-1]]=value;}
  function pathDelete(root,path){const parts=pathParts(path);let target=root;for(const key of parts.slice(0,-1)){if(!target[key]||typeof target[key]!=='object'||Array.isArray(target[key]))return;target=target[key];}delete target[parts[parts.length-1]];}
  function typedColumn(type,length){if(type==='f64')return new Float64Array(length);if(type==='u8')return new Uint8Array(length);throw new TypeError(`kernel-column-type:${type}`);}

  function create(options={}){
    const schemaVersion=String(options.schemaVersion||'2.0.0');
    if(schemaVersion!=='2.0.0')throw new Error('kernel-save-schema-must-remain-2.0.0');
    const contracts=new Map(),revisions=new Map(),auditors=new Map(),fingerprints=new Map(),idempotency=new Map(),afterCommitErrors=[];
    let base=options.legacyState&&typeof options.legacyState==='object'?clone(options.legacyState):{};
    let sequence=0;
    const hot=new Map();
    function buildColumnSection(spec,legacyValue){
      const source=Array.isArray(legacyValue)?legacyValue:[],fields=Object.entries(spec.columns||{}),rows=source.map(row=>clone(row&&typeof row==='object'&&!Array.isArray(row)?row:{})),columns={};
      for(const [name,type] of fields){
        const data=typedColumn(type,source.length),presence=new Uint8Array(source.length),enumValues=Array.isArray(spec.enumValues?.[name])?spec.enumValues[name].map(String):null;
        for(let index=0;index<source.length;index++){
          const row=source[index]||{};if(!own(row,name)){presence[index]=0;continue;}const value=row[name];
          if(value===null){presence[index]=1;continue;}
          if(type==='f64'){
            if(typeof value!=='number'||!Number.isFinite(value))throw new TypeError(`kernel-column-nonfinite:${name}:${index}`);
            data[index]=value;presence[index]=2;
          }else if(type==='u8'){
            const encoded=enumValues?enumValues.indexOf(String(value)):Number(value);
            if(!Number.isSafeInteger(encoded)||encoded<0||encoded>255)throw new TypeError(`kernel-column-enum-invalid:${name}:${index}`);
            data[index]=encoded;presence[index]=2;
          }
        }
        columns[name]={type,data,presence,enumValues};
        for(const row of rows)if(own(row,name))row[name]=null;
      }
      return {rows,columns};
    }
    function register(name,spec={}){
      name=String(name||'').trim();if(!name||contracts.has(name))throw new Error(`kernel-section-duplicate:${name}`);
      const kind=String(spec.kind||'object');if(!['object','append-only','columns','ledger'].includes(kind))throw new Error(`kernel-section-kind:${kind}`);
      if(!String(spec.owner||'').trim())throw new Error(`kernel-owner-required:${name}`);
      const path=spec.path??name,legacyValue=pathRead(base,path),contract={name,path:clone(path),present:pathHasOwn(base,path),owner:String(spec.owner),kind,cap:Number.isSafeInteger(spec.cap)&&spec.cap>0?spec.cap:null,legacyOrder:spec.legacyOrder==='newest-first'?'newest-first':'oldest-first',columns:spec.columns||{},enumValues:spec.enumValues||{}};
      if(kind==='columns')contract.data=buildColumnSection(contract,legacyValue);
      else if(kind==='append-only'||kind==='ledger'){
        if(legacyValue!=null&&!Array.isArray(legacyValue))throw new TypeError(`kernel-append-only-array-required:${name}`);
        const rows=Array.isArray(legacyValue)?clone(legacyValue):[];
        contract.data=contract.legacyOrder==='newest-first'?rows.reverse():rows;
      }else contract.data=clone(legacyValue);
      contracts.set(name,contract);revisions.set(name,0);fingerprints.delete(name);
      if(kind==='ledger')for(let index=0;index<contract.data.length;index++){
        const row=contract.data[index],key=String(row?.idempotencyKey||'');if(key){const fp=fingerprint(row);idempotency.set(`${name}:${key}`,{fingerprint:fp,row:clone(row),index});}
      }
      return api;
    }
    function ensure(name){const section=contracts.get(String(name));if(!section)throw new Error(`kernel-section-unregistered:${name}`);return section;}
    function authorize(section,writer,writes){
      if(!writes.has(section.name))throw new Error(`kernel-write-set-violation:${section.name}`);
      if(!writer.includes(section.owner))throw new Error(`kernel-writer-owner-violation:${section.name}:${section.owner}`);
    }
    function expose(section){
      if(section.kind==='columns')return columnDTO(section);
      const data=clone(section.data);return section.legacyOrder==='newest-first'&&(section.kind==='append-only'||section.kind==='ledger')?data.reverse():data;
    }
    function columnDTO(section){
      const out=section.data.rows.map(row=>clone(row));
      for(const [name,column] of Object.entries(section.data.columns))for(let i=0;i<out.length;i++){
        if(column.presence[i]===0)delete out[i][name];
        else if(column.presence[i]===1)out[i][name]=null;
        else out[i][name]=column.type==='u8'&&column.enumValues?column.enumValues[column.data[i]]:column.data[i];
      }
      return out;
    }
    function sectionFingerprint(name){const section=ensure(name);if(!fingerprints.has(name))fingerprints.set(name,fingerprint(expose(section)));return fingerprints.get(name);}
    function legacyState(){const out=clone(base);for(const section of contracts.values())if(section.present)pathWrite(out,section.path,expose(section));else pathDelete(out,section.path);return out;}
    function tx(spec,apply){
      if(!spec||typeof spec!=='object')throw new TypeError('kernel-tx-spec-required');
      if(typeof apply!=='function')throw new TypeError('kernel-tx-apply-required');
      if(!Array.isArray(spec.writes)||!spec.writes.length)throw new Error('kernel-write-set-required');
      const writeNames=[...new Set(spec.writes.map(String))],writes=new Set(writeNames),writer=[...new Set((Array.isArray(spec.owners)?spec.owners:[spec.owner||spec.actor||'']).map(String))];
      for(const name of writeNames)ensure(name);
      for(const [name,expected] of Object.entries(spec.reads||{})){ensure(name);if(Number(expected)!==revisions.get(name))throw new Error(`kernel-section-revision-conflict:${name}:${expected}:${revisions.get(name)}`);}
      const undo=[],dirty=new Set(),changes=new Map(),hooks=[];let closed=false;
      function mark(name,change){dirty.add(name);fingerprints.delete(name);if(!changes.has(name))changes.set(name,[]);changes.get(name).push(change);}
      function log(fn){undo.push(fn);}
      const writerAPI={
        get(name){const section=ensure(name);return expose(section);},
        set(name,value){const section=ensure(name);authorize(section,writer,writes);if(section.kind!=='object')throw new Error(`kernel-set-kind:${name}`);const previous=clone(section.data),wasPresent=section.present;log(()=>{section.data=previous;section.present=wasPresent;});section.data=clone(value);section.present=true;mark(name,{kind:'set'});return clone(section.data);},
        delete(name){const section=ensure(name);authorize(section,writer,writes);if(section.kind!=='object')throw new Error(`kernel-delete-kind:${name}`);const previous=clone(section.data),wasPresent=section.present;log(()=>{section.data=previous;section.present=wasPresent;});section.data=undefined;section.present=false;mark(name,{kind:'delete'});return wasPresent;},
        append(name,row){const section=ensure(name);authorize(section,writer,writes);if(section.kind!=='append-only')throw new Error(`kernel-append-kind:${name}`);const removed=[];section.data.push(clone(row));if(section.cap&&section.data.length>section.cap)removed.push(...section.data.splice(0,section.data.length-section.cap));log(()=>{section.data.pop();if(removed.length)section.data.unshift(...removed);});mark(name,{kind:'append',row:clone(row),trimmed:removed.length});return section.data.length;},
        col(name,columnName){const section=ensure(name);authorize(section,writer,writes);if(section.kind!=='columns')throw new Error(`kernel-column-kind:${name}`);const column=section.data.columns[String(columnName)];if(!column)throw new Error(`kernel-column-unregistered:${name}.${columnName}`);return Object.freeze({length:column.data.length,get(index){if(!Number.isInteger(index)||index<0||index>=column.data.length)throw new RangeError('kernel-column-index');if(column.presence[index]===0)return undefined;if(column.presence[index]===1)return null;return column.type==='u8'&&column.enumValues?column.enumValues[column.data[index]]:column.data[index];},set(index,value){if(!Number.isInteger(index)||index<0||index>=column.data.length)throw new RangeError('kernel-column-index');const previousValue=column.data[index],previousPresence=column.presence[index];let next=0,presence=0;if(value===null)presence=1;else if(value!==undefined){if(column.type==='f64'){if(typeof value!=='number'||!Number.isFinite(value))throw new TypeError(`kernel-column-nonfinite:${columnName}`);next=value;}else {const encoded=column.enumValues?column.enumValues.indexOf(String(value)):Number(value);if(!Number.isSafeInteger(encoded)||encoded<0||encoded>255)throw new TypeError(`kernel-column-enum-invalid:${columnName}`);next=encoded;}presence=2;}log(()=>{column.data[index]=previousValue;column.presence[index]=previousPresence;});column.data[index]=next;column.presence[index]=presence;mark(name,{kind:'column',column:String(columnName),index,from:previousPresence===2?previousValue:null,to:presence===2?next:null});return value;}});},
        post(name,entry){const section=ensure(name);authorize(section,writer,writes);if(section.kind!=='ledger')throw new Error(`kernel-post-kind:${name}`);const debit=Number(entry?.debit),credit=Number(entry?.credit),key=String(entry?.idempotencyKey||'');if(!key||!Number.isFinite(debit)||!Number.isFinite(credit)||debit<=0||credit<=0||debit!==credit)throw new Error('kernel-ledger-entry-unbalanced');const fp=fingerprint(entry),cacheKey=`${name}:${key}`,prior=idempotency.get(cacheKey);if(prior){if(prior.fingerprint!==fp)throw new Error('kernel-idempotency-conflict');return clone(prior.row);}const row=clone(entry),index=section.data.length;section.data.push(row);idempotency.set(cacheKey,{fingerprint:fp,row:clone(row),index});log(()=>{section.data.splice(index,1);idempotency.delete(cacheKey);});mark(name,{kind:'post',row:clone(row)});return clone(row);},
        afterCommit(fn){if(typeof fn!=='function')throw new TypeError('kernel-after-commit-function-required');hooks.push(fn);}
      };
      const started=globalThis.performance?.now?.()??Date.now();
      try{
        const value=apply(writerAPI);
        for(const name of dirty){const section=ensure(name);for(const validator of auditors.get(name)||[]){const result=validator({section:name,revision:revisions.get(name),changes:clone(changes.get(name)||[]),value:expose(section)});if(result===false||result?.ok===false)throw new Error(result?.reason||`kernel-audit-failed:${name}`);}}
        for(const name of dirty)revisions.set(name,revisions.get(name)+1);
        closed=true;
        const hooksErrors=[];for(const hook of hooks)try{hook({label:String(spec.label||''),dirty:[...dirty],revisions:Object.fromEntries([...dirty].map(name=>[name,revisions.get(name)]))});}catch(error){hooksErrors.push(String(error?.message||error));}
        const finished=globalThis.performance?.now?.()??Date.now();
        return {committed:true,value,revision:++sequence,dirty:[...dirty],sectionRevisions:Object.fromEntries([...dirty].map(name=>[name,revisions.get(name)])),undoRecords:undo.length,ms:Math.max(0,finished-started),afterCommitErrors:hooksErrors};
      }catch(error){
        for(let index=undo.length-1;index>=0;index--)undo[index]();for(const name of dirty)fingerprints.delete(name);closed=true;throw error;
      }finally{if(!closed)throw new Error('kernel-transaction-left-open');}
    }
    function addAuditor(name,validator){ensure(name);if(typeof validator!=='function')throw new TypeError('kernel-auditor-required');if(!auditors.has(name))auditors.set(name,[]);auditors.get(name).push(validator);return ()=>{const rows=auditors.get(name)||[],index=rows.indexOf(validator);if(index>=0)rows.splice(index,1);};}
    function compareLegacy(candidate){const expected=legacyState(),path=firstDifference(expected,candidate);return {ok:path===null,path,fingerprints:{kernel:fingerprint(expected),legacy:fingerprint(candidate)}};}
    function snapshot(){const sections={};for(const name of contracts.keys())sections[name]={revision:revisions.get(name),fingerprint:sectionFingerprint(name),value:expose(ensure(name))};return {schemaVersion,revision:sequence,sections};}
    const api={VERSION,schemaVersion,register,tx,read(name){return expose(ensure(name));},columnSnapshot(name,columnName){const section=ensure(name);if(section.kind!=='columns')throw new Error(`kernel-column-kind:${name}`);const column=section.data.columns[String(columnName)];if(!column)throw new Error(`kernel-column-unregistered:${name}.${columnName}`);return {type:column.type,data:new column.data.constructor(column.data),presence:new Uint8Array(column.presence),enumValues:clone(column.enumValues)};},revision(name){return revisions.get(String(name))??null;},fingerprint:sectionFingerprint,addAuditor,compareLegacy,legacyState,snapshot,contracts(){return [...contracts.values()].map(({data,...row})=>clone(row));},typedArrayBytes(){let bytes=0;for(const section of contracts.values())if(section.kind==='columns')for(const column of Object.values(section.data.columns))bytes+=column.data.byteLength+column.presence.byteLength;return bytes;}};
    return Object.freeze(api);
  }
  function fromLegacyState(legacy,contracts,options={}){
    const kernel=create({...options,legacyState:legacy});for(const contract of contracts||[])kernel.register(contract.name,contract);return kernel;
  }
  return Object.freeze({VERSION,create,fromLegacyState,fingerprint,firstDifference,stableStringify:stable});
});

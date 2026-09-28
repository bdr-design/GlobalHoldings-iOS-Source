/* Global Holdings transactional state kernel. Save Schema remains 2.0.0. */
((root,factory)=>{
  const api=factory();
  if(typeof module==='object'&&module.exports)module.exports=api;
  if(root)root.GH_KERNEL=api;
})(typeof globalThis!=='undefined'?globalThis:this,()=>{
  'use strict';
  const VERSION='GH-STATE-KERNEL-1.0.0';
  // Every tracked state-view proxy, so callers (e.g. proof locking) can avoid
  // operations the view rejects instead of paying for a thrown TypeError.
  const viewProxies=new WeakSet();
  // In-place mutators that only insert caller values or permute existing rows.
  // fill/copyWithin can alias one object at several paths, so they keep the
  // element-wise (cloning) path.
  // Mutation versions: every kernel write bumps the written object and all of
  // its ancestors up to the section root (and again on rollback). A cache that
  // records (raw identity, version) therefore has the same guarantee as an
  // Object.freeze lock: an unchanged version means unchanged content.
  const rawByView=new WeakMap(),objectVersions=new WeakMap();
  const bumpVersion=value=>{if(value&&typeof value==='object')objectVersions.set(value,(objectVersions.get(value)||0)+1);};
  const bumpChain=chain=>{for(const value of chain)bumpVersion(value);};
  const ARRAY_OPS=new Set(['push','pop','shift','unshift','splice','reverse','sort']);
  const clone=value=>{
    if(value===undefined)return undefined;
    if(typeof globalThis.GH_CLONE_CORE?.clone==='function')return globalThis.GH_CLONE_CORE.clone(value);
    if(typeof globalThis.structuredClone==='function')try{return globalThis.structuredClone(value);}catch(_error){}
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
    const contracts=new Map(),revisions=new Map(),auditors=new Map(),fingerprints=new Map(),chunkFingerprints=new Map(),idempotency=new Map(),afterCommitErrors=[];
    let base=options.legacyState&&typeof options.legacyState==='object'?clone(options.legacyState):{};
    let sequence=0,activeWriter=null,transactionOpen=false;
    const hot=new Map();
    function releaseRegisteredBase(){
      const sections=[...contracts.values()],parts=section=>pathParts(section.path);
      for(const section of sections){
        if(!section.present)continue;
        const path=parts(section),overlaps=sections.some(other=>{
          if(other===section)return false;
          const candidate=parts(other),length=Math.min(path.length,candidate.length);
          return path.slice(0,length).every((key,index)=>key===candidate[index]);
        });
        if(!overlaps)pathWrite(base,section.path,null);
      }
      return api;
    }
    function buildColumnSection(spec,legacyValue){
      const source=Array.isArray(legacyValue)?legacyValue:[],fields=Object.entries(spec.columns||{}),fieldNames=new Set(fields.map(([name])=>name)),rowOrder=source.map(row=>row&&typeof row==='object'&&!Array.isArray(row)?Object.keys(row):[]),rows=source.map(row=>{const out={};if(row&&typeof row==='object'&&!Array.isArray(row))for(const key of Object.keys(row))if(!fieldNames.has(key))out[key]=clone(row[key]);return out;}),columns={};
      for(const [name,type] of fields){
        const data=typedColumn(type,source.length),presence=new Uint8Array(source.length),enumValues=Array.isArray(spec.enumValues?.[name])?spec.enumValues[name].map(String):null;
        for(let index=0;index<source.length;index++){
          const row=source[index]||{};if(!own(row,name)){presence[index]=0;continue;}const value=row[name];
          if(value===null){presence[index]=1;continue;}
          if(value===undefined){presence[index]=3;continue;}
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
      }
      return {rows,columns,rowOrder};
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
      contracts.set(name,contract);revisions.set(name,0);fingerprints.delete(name);chunkFingerprints.delete(name);
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
    function columnKeys(section,index,source=section.data.rows[index]){
      const columns=section.data.columns,ordered=section.data.rowOrder?.[index]||[],out=[],seen=new Set();
      const include=name=>{const column=columns[name];return column?column.presence[index]!==0:!!source&&own(source,name);};
      for(const name of ordered)if(!seen.has(name)&&include(name)){seen.add(name);out.push(name);}
      if(source&&typeof source==='object')for(const name of Object.keys(source))if(!seen.has(name)){seen.add(name);out.push(name);}
      for(const [name,column] of Object.entries(columns))if(column.presence[index]!==0&&!seen.has(name)){seen.add(name);out.push(name);}
      return out;
    }
    function columnRow(section,index){
      const source=section.data.rows[index];if(source==null)return source;const row={};
      for(const name of columnKeys(section,index,source)){const column=section.data.columns[name];let value;if(column){const tag=column.presence[index];if(tag===0)continue;if(tag===1)value=null;else if(tag===3)value=undefined;else value=column.type==='u8'&&column.enumValues?column.enumValues[column.data[index]]:column.data[index];}else value=source[name];Object.defineProperty(row,name,{configurable:true,enumerable:true,writable:true,value});}
      return row;
    }
    function columnValue(section,name,index){
      const column=section.data.columns[String(name)];if(!column)return undefined;
      if(!Number.isInteger(index)||index<0||index>=column.data.length)return undefined;
      if(column.presence[index]===0||column.presence[index]===3)return undefined;if(column.presence[index]===1)return null;
      return column.type==='u8'&&column.enumValues?column.enumValues[column.data[index]]:column.data[index];
    }
    function columnDTO(section){return section.data.rows.map((_,index)=>columnRow(section,index));}
    function sectionFingerprint(name){const section=ensure(name);if(!fingerprints.has(name))fingerprints.set(name,fingerprint(expose(section)));return fingerprints.get(name);}
    // A section digest is a tree of bounded chunks. Column updates invalidate
    // one chunk; appends invalidate only the last chunk unless a cap shifts rows.
    // Full legacy fingerprints remain available for parity and export checks.
    const FINGERPRINT_CHUNK_ROWS=256;
    let fingerprintChunkCalculations=0;
    function incrementalFingerprint(name){
      const section=ensure(name),cached=chunkFingerprints.get(section.name)||new Map();
      if(!chunkFingerprints.has(section.name))chunkFingerprints.set(section.name,cached);
      const rows=section.kind==='columns'?section.data.rows:(section.kind==='ledger'||section.kind==='append-only')?section.data:null;
      if(!rows){if(!cached.has(0)){cached.set(0,fingerprint(section.present?section.data:null));fingerprintChunkCalculations++;}return fingerprint({kind:section.kind,present:section.present,chunks:[cached.get(0)]});}
      const count=Math.ceil(rows.length/FINGERPRINT_CHUNK_ROWS),hashes=[];
      for(let index=0;index<count;index++){
        if(!cached.has(index)){
          const start=index*FINGERPRINT_CHUNK_ROWS,end=Math.min(rows.length,start+FINGERPRINT_CHUNK_ROWS);
          const values=section.kind==='columns'?Array.from({length:end-start},(_,offset)=>columnRow(section,start+offset)):rows.slice(start,end);
          cached.set(index,fingerprint(values));fingerprintChunkCalculations++;
        }
        hashes.push(cached.get(index));
      }
      return fingerprint({kind:section.kind,present:section.present,legacyOrder:section.legacyOrder,length:rows.length,chunks:hashes});
    }
    function legacyState(){const out=clone(base);for(const section of contracts.values())if(section.present)pathWrite(out,section.path,expose(section));else pathDelete(out,section.path);return out;}
    function tx(spec,apply){
      if(!spec||typeof spec!=='object')throw new TypeError('kernel-tx-spec-required');
      if(typeof apply!=='function')throw new TypeError('kernel-tx-apply-required');
      if(!Array.isArray(spec.writes)||!spec.writes.length)throw new Error('kernel-write-set-required');
      const writeNames=[...new Set(spec.writes.map(String))],writes=new Set(writeNames),writer=[...new Set((Array.isArray(spec.owners)?spec.owners:[spec.owner||spec.actor||'']).map(String))];
      for(const name of writeNames)ensure(name);
      for(const [name,expected] of Object.entries(spec.reads||{})){ensure(name);if(Number(expected)!==revisions.get(name))throw new Error(`kernel-section-revision-conflict:${name}:${expected}:${revisions.get(name)}`);}
      if(transactionOpen)throw new Error('kernel-nested-transaction-forbidden');
      const undo=[],dirty=new Set(),changes=new Map(),hooks=[];let closed=false;
      function mark(name,change){
        change=change||{};
        dirty.add(name);fingerprints.delete(name);
        const cached=chunkFingerprints.get(name);
        if(cached){
          const section=ensure(name),rows=section.kind==='columns'?section.data.rows:(section.kind==='ledger'||section.kind==='append-only')?section.data:null;
          const index=Number.isInteger(change.index)?Math.floor(change.index/FINGERPRINT_CHUNK_ROWS):rows&&['append','post'].includes(change.kind)&&!change.trimmed?Math.floor((rows.length-1)/FINGERPRINT_CHUNK_ROWS):null;
          const invalidated=index===null?[...cached.entries()]:cached.has(index)?[[index,cached.get(index)]]:[];
          if(index===null)cached.clear();else cached.delete(index);
          if(invalidated.length)undo.push(()=>{for(const [chunk,digest] of invalidated)cached.set(chunk,digest);});
        }
        if(auditors.has(name)){if(!changes.has(name))changes.set(name,[]);changes.get(name).push(change);}
      }
      function log(fn){undo.push(fn);}
      function replaceColumnRows(name,section,rows){
        if(!Array.isArray(rows))throw new TypeError(`kernel-column-rows-required:${name}`);
        const previous=section.data,stableRows=previous.rows,oldRows=stableRows.slice(),oldColumns=previous.columns,wasPresent=section.present,next=buildColumnSection(section,rows);
        log(()=>{stableRows.length=0;for(let index=0;index<oldRows.length;index++)stableRows[index]=oldRows[index];section.data=previous;section.data.rows=stableRows;section.data.columns=oldColumns;section.present=wasPresent;});
        bumpVersion(stableRows);for(const oldRow of oldRows)bumpVersion(oldRow);stableRows.length=0;for(let index=0;index<next.rows.length;index++)stableRows[index]=next.rows[index];section.data={...next,rows:stableRows};section.present=true;mark(name,{kind:'rows-replace'});return columnDTO(section);
      }
      function setColumnValue(name,columnName,column,index,value,deleteProperty=false){
        if(!Number.isInteger(index)||index<0||index>=column.data.length)throw new RangeError('kernel-column-index');
        const previousValue=column.data[index],previousPresence=column.presence[index];let next=0,presence=deleteProperty?0:0;
        if(!deleteProperty){
          if(value===null)presence=1;
          else if(value===undefined)presence=3;
          else if(column.type==='f64'){if(typeof value!=='number'||!Number.isFinite(value))throw new TypeError(`kernel-column-nonfinite:${columnName}`);next=value;presence=2;}
          else{const encoded=column.enumValues?column.enumValues.indexOf(String(value)):Number(value);if(!Number.isSafeInteger(encoded)||encoded<0||encoded>255)throw new TypeError(`kernel-column-enum-invalid:${columnName}`);next=encoded;presence=2;}
        }
        const section=ensure(name),previousOrder=section.data.rowOrder[index]||[],nextOrder=deleteProperty?previousOrder.filter(field=>field!==String(columnName)):previousPresence===0?[...previousOrder,String(columnName)]:previousOrder;
        const rowChain=[section.data.rows,section.data.rows[index]];log(()=>{column.data[index]=previousValue;column.presence[index]=previousPresence;section.data.rowOrder[index]=previousOrder;bumpChain(rowChain);});bumpChain(rowChain);column.data[index]=next;column.presence[index]=presence;section.data.rowOrder[index]=nextOrder;
        mark(name,{kind:'column',column:String(columnName),index,from:previousPresence===2?previousValue:null,to:presence===2?next:null});return value;
      }
      function columnPatch(name,section,path,action,value){
        const parts=Array.isArray(path)?path.map(String):String(path||'').split('.').filter(Boolean);
        if(!parts.length){if(action==='delete')throw new Error(`kernel-column-section-delete-forbidden:${name}`);return replaceColumnRows(name,section,value);}
        const rootKey=parts[0];
        if(rootKey==='length'&&parts.length===1){if(action==='delete')throw new Error('kernel-column-length-delete-forbidden');const length=Number(value);if(!Number.isSafeInteger(length)||length<0||length>1_000_000)throw new RangeError(`kernel-column-length-invalid:${name}`);const rows=columnDTO(section);rows.length=length;return replaceColumnRows(name,section,rows);}
        if(!/^(0|[1-9]\d*)$/.test(rootKey))throw new Error(`kernel-column-path-invalid:${name}:${rootKey}`);
        const index=Number(rootKey);if(!Number.isSafeInteger(index)||index<0)throw new RangeError(`kernel-column-row-index:${name}`);
        if(parts.length===1){
          if(action==='set'&&index<section.data.rows.length){return writerAPI.replaceRow(name,index,value);}
          const rows=columnDTO(section);if(action==='delete')delete rows[index];else rows[index]=value;return replaceColumnRows(name,section,rows);
        }
        if(index>=section.data.rows.length)throw new Error(`kernel-column-row-missing:${name}:${index}`);
        const field=parts[1],column=section.data.columns[field];
        if(column){if(parts.length!==2)throw new Error(`kernel-column-nested-value:${name}:${field}`);return action==='delete'?writerAPI.col(name,field).delete(index):writerAPI.col(name,field).set(index,value);}
        let row=section.data.rows[index];if(!row||typeof row!=='object'){row={};const prior=section.data.rows[index];log(()=>{section.data.rows[index]=prior;});section.data.rows[index]=row;}
        const tail=parts.slice(1),key=tail.at(-1);if(['__proto__','constructor','prototype'].includes(key))throw new Error(`kernel-column-field-invalid:${key}`);
        let parent=row;const chain=[section.data.rows,row];for(const part of tail.slice(0,-1)){if(parent==null||typeof parent!=='object')throw new Error(`kernel-column-parent-missing:${name}:${index}:${part}`);parent=parent[part];chain.push(parent);}
        if(parent==null||typeof parent!=='object')throw new Error(`kernel-column-parent-missing:${name}:${index}:${tail.slice(0,-1).join('.')}`);
        const prior=Object.getOwnPropertyDescriptor(parent,key),wasPresent=!!prior,priorLength=Array.isArray(parent)?parent.length:null,previousOrder=section.data.rowOrder[index]||[],nextOrder=tail.length!==1?previousOrder:action==='delete'?previousOrder.filter(field=>field!==key):wasPresent?previousOrder:[...previousOrder,key];
        if(action==='set'&&wasPresent&&Object.is(parent[key],value))return value;
        log(()=>{if(wasPresent)Object.defineProperty(parent,key,prior);else delete parent[key];if(priorLength!==null)parent.length=priorLength;if(tail.length===1)section.data.rowOrder[index]=previousOrder;bumpChain(chain);});
        if(action==='delete')delete parent[key];else parent[key]=clone(value);bumpChain(chain);
        if(tail.length===1)section.data.rowOrder[index]=nextOrder;
        section.present=true;mark(name,{kind:'row-field',index,field,action});return action==='delete'?wasPresent:parent[key];
      }
      const writerAPI={
        get(name){const section=ensure(name);return expose(section);},
        addRoot(name){name=String(name||'').trim();if(!name)throw new Error('kernel-root-name-required');if(!contracts.has(name))register(name,{owner:'transaction-core',kind:'object',path:[name]});writes.add(name);return name;},
        set(name,value){const section=ensure(name);authorize(section,writer,writes);if(section.kind!=='object')throw new Error(`kernel-set-kind:${name}`);const previous=section.data,wasPresent=section.present;log(()=>{section.data=previous;section.present=wasPresent;});section.data=clone(value);section.present=true;mark(name,{kind:'set'});return clone(section.data);},
        delete(name){const section=ensure(name);authorize(section,writer,writes);if(section.kind!=='object')throw new Error(`kernel-delete-kind:${name}`);const previous=section.data,wasPresent=section.present;log(()=>{section.data=previous;section.present=wasPresent;});section.data=undefined;section.present=false;mark(name,{kind:'delete'});return wasPresent;},
        patch(name,path,action,value){
          const section=ensure(name);authorize(section,writer,writes);if(section.kind==='columns')return columnPatch(name,section,path,action,value);if(section.kind!=='object')throw new Error(`kernel-patch-kind:${name}`);
          const parts=Array.isArray(path)?path.map(String):String(path||'').split('.').filter(Boolean);
          if(!parts.length)return action==='delete'?writerAPI.delete(name):writerAPI.set(name,value);
          const key=parts.at(-1);if(['__proto__','constructor','prototype'].includes(key))throw new Error(`kernel-patch-field-invalid:${key}`);
          let parent=section.data;const chain=[parent];for(const part of parts.slice(0,-1)){if(parent==null||typeof parent!=='object')throw new Error(`kernel-patch-parent-missing:${name}:${part}`);parent=parent[part];chain.push(parent);}
          if(parent==null||typeof parent!=='object')throw new Error(`kernel-patch-parent-missing:${name}:${parts.slice(0,-1).join('.')}`);
          const prior=Object.getOwnPropertyDescriptor(parent,key),wasPresent=!!prior,priorLength=Array.isArray(parent)?parent.length:null;
          if(action==='set'&&wasPresent&&Object.is(parent[key],value))return value;
          log(()=>{if(wasPresent)Object.defineProperty(parent,key,prior);else delete parent[key];if(priorLength!==null)parent.length=priorLength;bumpChain(chain);});
          if(action==='delete')delete parent[key];else parent[key]=clone(value);
          bumpChain(chain);
          section.present=true;mark(name,auditors.has(name)?{kind:'patch',path:parts,action}:null);return action==='delete'?wasPresent:parent[key];
        },
        arrayOp(name,path,method,args){
          // One undo record per array mutation. Routing unshift/splice through the
          // proxy set trap instead moves every element through patch()+clone(),
          // which is O(length) deep clones per call and grows with retained history.
          const section=ensure(name);authorize(section,writer,writes);if(section.kind!=='object')throw new Error(`kernel-array-kind:${name}`);
          if(!ARRAY_OPS.has(method))throw new Error(`kernel-array-method:${method}`);
          const parts=(Array.isArray(path)?path:[]).map(String);let target=section.data;
          const chain=[target];for(const part of parts){if(target==null||typeof target!=='object')throw new Error(`kernel-array-parent-missing:${name}:${part}`);target=target[part];chain.push(target);}
          if(!Array.isArray(target))throw new TypeError(`kernel-array-required:${name}:${parts.join('.')}`);
          const input=Array.from(args||[]),values=method==='splice'?[...input.slice(0,2),...input.slice(2).map(clone)]:(method==='push'||method==='unshift')?input.map(clone):input;
          const prior=target.slice(),priorLength=target.length;
          log(()=>{target.length=0;target.length=priorLength;for(let index=0;index<priorLength;index++)if(index in prior)target[index]=prior[index];bumpChain(chain);});
          const result=Array.prototype[method].apply(target,values);bumpChain(chain);
          section.present=true;mark(name,{kind:'array',path:parts,method});return result;
        },
        append(name,row){const section=ensure(name);authorize(section,writer,writes);if(section.kind!=='append-only')throw new Error(`kernel-append-kind:${name}`);const removed=[];section.data.push(clone(row));if(section.cap&&section.data.length>section.cap)removed.push(...section.data.splice(0,section.data.length-section.cap));bumpVersion(section.data);log(()=>{section.data.pop();if(removed.length)section.data.unshift(...removed);bumpVersion(section.data);});mark(name,{kind:'append',row:clone(row),trimmed:removed.length});return section.data.length;},
        replaceRows(name,rows){const section=ensure(name);authorize(section,writer,writes);if(section.kind!=='columns')throw new Error(`kernel-row-kind:${name}`);return replaceColumnRows(name,section,rows);},
        col(name,columnName){const section=ensure(name);authorize(section,writer,writes);if(section.kind!=='columns')throw new Error(`kernel-column-kind:${name}`);const column=section.data.columns[String(columnName)];if(!column)throw new Error(`kernel-column-unregistered:${name}.${columnName}`);return Object.freeze({length:column.data.length,get(index){if(!Number.isInteger(index)||index<0||index>=column.data.length)throw new RangeError('kernel-column-index');if(column.presence[index]===0||column.presence[index]===3)return undefined;if(column.presence[index]===1)return null;return column.type==='u8'&&column.enumValues?column.enumValues[column.data[index]]:column.data[index];},set(index,value){return setColumnValue(name,columnName,column,index,value,false);},delete(index){return setColumnValue(name,columnName,column,index,undefined,true);}});},
        replaceRow(name,index,nextRow){
          const section=ensure(name);authorize(section,writer,writes);if(section.kind!=='columns')throw new Error(`kernel-row-kind:${name}`);if(!Number.isInteger(index)||index<0||index>=section.data.rows.length)throw new RangeError('kernel-row-index');if(!nextRow||typeof nextRow!=='object'||Array.isArray(nextRow))throw new TypeError('kernel-row-replacement-invalid');for(const key of Object.keys(nextRow))if(key==='__proto__'||key==='constructor'||key==='prototype')throw new Error(`kernel-row-field-invalid:${key}`);
          const priorRowIdentity=section.data.rows[index],priorRow=clone(section.data.rows[index]),priorOrder=section.data.rowOrder[index]||[],priorColumns=Object.fromEntries(Object.entries(section.data.columns).map(([key,column])=>[key,{data:column.data[index],presence:column.presence[index]}]));
          log(()=>{section.data.rows[index]=priorRow;section.data.rowOrder[index]=priorOrder;for(const [key,value] of Object.entries(priorColumns)){section.data.columns[key].data[index]=value.data;section.data.columns[key].presence[index]=value.presence;}});
          const metadata={},rowOrder=Object.keys(nextRow);for(const key of rowOrder)if(!own(section.data.columns,key))metadata[key]=clone(nextRow[key]);
          for(const [key,column] of Object.entries(section.data.columns)){
            const present=own(nextRow,key),value=present?nextRow[key]:undefined;let data=0,presence=0;
            if(present&&value===undefined)presence=3;else if(value===null)presence=1;else if(value!==undefined){if(column.type==='f64'){if(typeof value!=='number'||!Number.isFinite(value))throw new TypeError(`kernel-column-nonfinite:${key}`);data=value;}else{const encoded=column.enumValues?column.enumValues.indexOf(String(value)):Number(value);if(!Number.isSafeInteger(encoded)||encoded<0||encoded>255)throw new TypeError(`kernel-column-enum-invalid:${key}`);data=encoded;}presence=2;}
            column.data[index]=data;column.presence[index]=presence;
          }
          section.data.rows[index]=metadata;section.data.rowOrder[index]=rowOrder;bumpVersion(section.data.rows);bumpVersion(priorRowIdentity);mark(name,{kind:'row-replace',index});return columnRow(section,index);
        },
        updateRow(name,index,patch){
          const section=ensure(name);authorize(section,writer,writes);if(section.kind!=='columns')throw new Error(`kernel-row-kind:${name}`);if(!Number.isInteger(index)||index<0||index>=section.data.rows.length)throw new RangeError('kernel-row-index');if(!patch||typeof patch!=='object'||Array.isArray(patch))throw new TypeError('kernel-row-patch-invalid');const row=section.data.rows[index];
          for(const [key,value] of Object.entries(patch)){
            if(key==='__proto__'||key==='constructor'||key==='prototype')throw new Error(`kernel-row-field-invalid:${key}`);
            if(own(section.data.columns,key)){writerAPI.col(name,key).set(index,value);continue;}
            const had=own(row,key),previous=had?clone(row[key]):undefined,previousOrder=section.data.rowOrder[index]||[],nextOrder=had?previousOrder:[...previousOrder,key];
            log(()=>{if(had)row[key]=previous;else delete row[key];section.data.rowOrder[index]=previousOrder;bumpVersion(row);});row[key]=clone(value);bumpVersion(row);bumpVersion(section.data.rows);section.data.rowOrder[index]=nextOrder;mark(name,{kind:'row-field',index,field:key});
          }
          return columnRow(section,index);
        },
        post(name,entry){const section=ensure(name);authorize(section,writer,writes);if(section.kind!=='ledger')throw new Error(`kernel-post-kind:${name}`);const debit=Number(entry?.debit),credit=Number(entry?.credit),key=String(entry?.idempotencyKey||'');if(!key||!Number.isFinite(debit)||!Number.isFinite(credit)||debit<=0||credit<=0||debit!==credit)throw new Error('kernel-ledger-entry-unbalanced');const fp=fingerprint(entry),cacheKey=`${name}:${key}`,prior=idempotency.get(cacheKey);if(prior){if(prior.fingerprint!==fp)throw new Error('kernel-idempotency-conflict');return clone(prior.row);}const row=clone(entry),index=section.data.length;section.data.push(row);idempotency.set(cacheKey,{fingerprint:fp,row:clone(row),index});bumpVersion(section.data);log(()=>{section.data.splice(index,1);idempotency.delete(cacheKey);bumpVersion(section.data);});mark(name,{kind:'post',row:clone(row)});return clone(row);},
        afterCommit(fn){if(typeof fn!=='function')throw new TypeError('kernel-after-commit-function-required');hooks.push(fn);}
      };
      const started=globalThis.performance?.now?.()??Date.now();
      try{
        transactionOpen=true;activeWriter=writerAPI;
        const value=apply(writerAPI);
        activeWriter=null;
        for(const name of dirty){const section=ensure(name);for(const validator of auditors.get(name)||[]){
          // Validators receive the changed records. A full section is exposed
          // only if an auditor expressly requests it (for an idle full audit).
          const delta={section:name,revision:revisions.get(name),changes:clone(changes.get(name)||[]),get value(){return expose(section);},getRow(index){if(section.kind!=='columns')throw new Error('kernel-audit-row-kind');if(!Number.isInteger(index)||index<0||index>=section.data.rows.length)throw new RangeError('kernel-audit-row-index');return columnRow(section,index);}};
          const result=validator(delta);if(result===false||result?.ok===false)throw new Error(result?.reason||`kernel-audit-failed:${name}`);
        }}
        for(const name of dirty)revisions.set(name,revisions.get(name)+1);
        closed=true;transactionOpen=false;
        const hooksErrors=[];for(const hook of hooks)try{hook({label:String(spec.label||''),dirty:[...dirty],revisions:Object.fromEntries([...dirty].map(name=>[name,revisions.get(name)]))});}catch(error){hooksErrors.push(String(error?.message||error));}
        const finished=globalThis.performance?.now?.()??Date.now();
        return {committed:true,value,revision:++sequence,dirty:[...dirty],sectionRevisions:Object.fromEntries([...dirty].map(name=>[name,revisions.get(name)])),undoRecords:undo.length,ms:Math.max(0,finished-started),afterCommitErrors:hooksErrors};
      }catch(error){
        for(let index=undo.length-1;index>=0;index--)undo[index]();for(const name of dirty)fingerprints.delete(name);closed=true;throw error;
      }finally{activeWriter=null;transactionOpen=false;if(!closed)throw new Error('kernel-transaction-left-open');}
    }
    function stateView(options={}){
      // Object-identity cache entries must not keep old saves, replaced rows,
      // or archived simulation objects alive for the lifetime of the app.
      const rootTarget={},cache=new WeakMap(),proxyRefs=new WeakMap();
      const pathKey=path=>JSON.stringify(path);
      const arrayMutators=new Set(['copyWithin','fill','pop','push','reverse','shift','sort','splice','unshift']);
      // A tracked proxy of an object section reads straight from its raw target,
      // so cloning the raw value is equivalent and lets structuredClone work.
      // Column rows (path depth <= 1) synthesize fields, so they stay proxies.
      const rawRef=value=>{const ref=value&&typeof value==='object'?proxyRefs.get(value):null;if(!ref)return value;const section=contracts.get(ref.name);return section?.kind==='columns'&&ref.path.length<=1?value:ref.raw;};
      const unwrapForWrite=value=>{if(!value||typeof value!=='object')return value;const direct=rawRef(value);if(direct!==value)return direct;if(Array.isArray(value)&&!proxyRefs.has(value)){let changed=false;const out=value.map(item=>{const raw=rawRef(item);if(raw!==item)changed=true;return raw;});return changed?out:value;}return value;};
      function arrayWrite(name,path,method,args){
        let values=Array.from(args,unwrapForWrite);
        if(method==='sort'&&typeof args[0]==='function'){
          // The comparator sees state views, never raw stored rows, so any write
          // it makes still goes through the kernel (undo log and versions).
          const raw=rawAt(name,path),compare=args[0],views=new Map();
          if(Array.isArray(raw))raw.forEach((item,index)=>{if(item&&typeof item==='object')views.set(item,tracked(name,[...path,String(index)],item));});
          values=[(a,b)=>compare(views.get(a)??a,views.get(b)??b)];
        }
        if(activeWriter)return activeWriter.arrayOp(name,path,method,values);
        if(transactionOpen)throw new Error('kernel-state-write-outside-apply');
        let result;const committed=tx({label:'state-view:array-write',owner:'transaction-core',writes:[name]},writer=>{result=writer.arrayOp(name,path,method,values);return result;});
        try{options.onCommit?.(committed);}catch(error){globalThis.console?.error?.('State Kernel commit observer failed',error);}
        return result;
      }
      const rawAt=(name,path)=>{const section=contracts.get(name);if(!section||!section.present)return undefined;let value=section.data;for(const key of path){if(value==null)return undefined;value=value[key];}return value;};
      const tracked=(name,path,raw)=>{
        if(!raw||typeof raw!=='object')return raw;
        let paths=cache.get(raw);if(!paths){paths=new Map();cache.set(raw,paths);}const key=`${name}:${pathKey(path)}`,prior=paths.get(key);if(prior)return prior;
        const proxy=new Proxy(raw,{
          get(target,prop,receiver){
            const section=contracts.get(name);
            if(section?.kind==='columns'&&path.length===0&&typeof prop==='string'&&arrayMutators.has(prop))return (...args)=>{const rows=columnDTO(section),result=Array.prototype[prop].apply(rows,args);write(name,[],'set',rows);return ['copyWithin','fill','reverse','sort'].includes(prop)?receiver:result;};
            if(section?.kind==='columns'&&path.length===1&&typeof prop==='string'&&own(section.data.columns,prop))return columnValue(section,prop,Number(path[0]));
            if(section?.kind==='object'&&Array.isArray(target)&&typeof prop==='string'&&ARRAY_OPS.has(prop))return (...args)=>{const result=arrayWrite(name,path,prop,args);return prop==='reverse'||prop==='sort'?receiver:result;};
            if(prop==='__proto__')return Reflect.get(target,prop,receiver);const value=Reflect.get(target,prop,receiver);return value&&typeof value==='object'?tracked(name,[...path,String(prop)],value):value;
          },
          set(_target,prop,value){if(typeof prop==='symbol')throw new TypeError('kernel-symbol-state-key');write(name,[...path,String(prop)],'set',value);return true;},
          deleteProperty(_target,prop){if(typeof prop==='symbol')throw new TypeError('kernel-symbol-state-key');write(name,[...path,String(prop)],'delete');return true;},
          defineProperty(_target,prop,descriptor){if(typeof prop==='symbol'||!Object.prototype.hasOwnProperty.call(descriptor,'value'))throw new TypeError('kernel-state-accessor-forbidden');write(name,[...path,String(prop)],'set',descriptor.value);return true;},
          ownKeys(target){
            const section=contracts.get(name);if(section?.kind!=='columns'||path.length!==1)return Reflect.ownKeys(target);
            return columnKeys(section,Number(path[0]),target);
          },
          has(target,prop){const section=contracts.get(name);if(section?.kind==='columns'&&path.length===1&&typeof prop==='string'&&own(section.data.columns,prop))return section.data.columns[prop].presence[Number(path[0])]!==0;return Reflect.has(target,prop);},
          getOwnPropertyDescriptor(target,prop){
            const section=contracts.get(name);if(section?.kind==='columns'&&path.length===1&&typeof prop==='string'&&own(section.data.columns,prop)){const column=section.data.columns[prop];if(column.presence[Number(path[0])]===0)return undefined;return {configurable:true,enumerable:true,writable:true,value:columnValue(section,prop,Number(path[0]))};}
            return Reflect.getOwnPropertyDescriptor(target,prop);
          }
        });paths.set(key,proxy);proxyRefs.set(proxy,{name,path,raw});viewProxies.add(proxy);rawByView.set(proxy,raw);return proxy;
      };
      function write(name,path,action,value){
        const reference=action==='set'&&value&&typeof value==='object'?proxyRefs.get(value):null;
        if(reference&&reference.name===name&&reference.path.length===path.length&&reference.path.every((part,index)=>part===path[index])&&rawAt(name,path)===reference.raw)return;
        // Unwrap only after the self-assignment check: `const x=state.x=state.x`
        // must stay a no-op so the caller's proxy keeps reading live data.
        if(action==='set')value=unwrapForWrite(value);
        if(!contracts.has(name)){if(activeWriter)activeWriter.addRoot(name);else register(name,{owner:'transaction-core',kind:'object',path:[name]});}
        if(activeWriter){activeWriter.patch(name,path,action,value);return;}
        if(transactionOpen)throw new Error('kernel-state-write-outside-apply');
        const committed=tx({label:'state-view:single-write',owner:'transaction-core',writes:[name]},writer=>writer.patch(name,path,action,value));
        try{options.onCommit?.(committed);}catch(error){globalThis.console?.error?.('State Kernel commit observer failed',error);}
      }
      const root=new Proxy(rootTarget,{
        get(_target,prop,receiver){if(typeof prop==='symbol')return Reflect.get(rootTarget,prop,receiver);const name=String(prop),section=contracts.get(name);if(!section?.present)return Reflect.get(rootTarget,prop,receiver);return tracked(name,[],section.kind==='columns'?section.data.rows:section.data);},
        set(_target,prop,value){if(typeof prop==='symbol')throw new TypeError('kernel-symbol-state-key');write(String(prop),[],'set',value);return true;},
        deleteProperty(_target,prop){if(typeof prop==='symbol')throw new TypeError('kernel-symbol-state-key');write(String(prop),[],'delete');return true;},
        defineProperty(_target,prop,descriptor){if(typeof prop==='symbol'||!Object.prototype.hasOwnProperty.call(descriptor,'value'))throw new TypeError('kernel-state-accessor-forbidden');write(String(prop),[],'set',descriptor.value);return true;},
        ownKeys(){return [...contracts.values()].filter(section=>section.present).map(section=>section.name);},
        has(_target,prop){return typeof prop==='string'&&!!contracts.get(prop)?.present;},
        getOwnPropertyDescriptor(_target,prop){if(typeof prop!=='string')return undefined;const section=contracts.get(prop);if(!section?.present)return undefined;return {configurable:true,enumerable:true,writable:true,value:tracked(prop,[],section.kind==='columns'?section.data.rows:section.data)};},
        preventExtensions(){return false;},
        setPrototypeOf(){return false;}
      });
      return root;
    }
    function addAuditor(name,validator){ensure(name);if(typeof validator!=='function')throw new TypeError('kernel-auditor-required');if(!auditors.has(name))auditors.set(name,[]);auditors.get(name).push(validator);return ()=>{const rows=auditors.get(name)||[],index=rows.indexOf(validator);if(index>=0)rows.splice(index,1);};}
    function compareLegacy(candidate){const expected=legacyState(),path=firstDifference(expected,candidate);return {ok:path===null,path,fingerprints:{kernel:fingerprint(expected),legacy:fingerprint(candidate)}};}
    function snapshot(){const sections={};for(const name of contracts.keys())sections[name]={revision:revisions.get(name),fingerprint:sectionFingerprint(name),value:expose(ensure(name))};return {schemaVersion,revision:sequence,sections};}
    const api={VERSION,schemaVersion,register,releaseRegisteredBase,tx,stateView,sectionNames:()=>[...contracts.keys()],read(name){return expose(ensure(name));},readRow(name,index){const section=ensure(name);if(section.kind!=='columns')throw new Error(`kernel-row-kind:${name}`);if(!Number.isInteger(index)||index<0||index>=section.data.rows.length)throw new RangeError(`kernel-row-index:${name}:${index}`);return columnRow(section,index);},columnSnapshot(name,columnName){const section=ensure(name);if(section.kind!=='columns')throw new Error(`kernel-column-kind:${name}`);const column=section.data.columns[String(columnName)];if(!column)throw new Error(`kernel-column-unregistered:${name}.${columnName}`);return {type:column.type,data:new column.data.constructor(column.data),presence:new Uint8Array(column.presence),enumValues:clone(column.enumValues)};},columnStorageReport(name){const section=ensure(name);if(section.kind!=='columns')throw new Error(`kernel-column-kind:${name}`);const rows=section.data.rows,columns=Object.entries(section.data.columns);let redundantObjectFields=0;for(let index=0;index<rows.length;index++){const row=rows[index];if(row&&typeof row==='object')for(const [field,column] of columns)if(column.presence[index]!==0&&own(row,field))redundantObjectFields++;}return {rows:rows.length,hotFields:columns.map(([field])=>field),redundantObjectFields,typedArrayBytes:columns.reduce((sum,[,column])=>sum+column.data.byteLength+column.presence.byteLength,0)};},revision(name){return arguments.length?revisions.get(String(name))??null:sequence;},fingerprint:sectionFingerprint,incrementalFingerprint,fingerprintChunkCalculations:()=>fingerprintChunkCalculations,addAuditor,compareLegacy,legacyState,snapshot,contracts(){return [...contracts.values()].map(({data,...row})=>clone(row));},baseStorageBytes(){return new TextEncoder().encode(JSON.stringify(base)).byteLength;},typedArrayBytes(){let bytes=0;for(const section of contracts.values())if(section.kind==='columns')for(const column of Object.values(section.data.columns))bytes+=column.data.byteLength+column.presence.byteLength;return bytes;}};
    return Object.freeze(api);
  }
  function fromLegacyState(legacy,contracts,options={}){
    const kernel=create({...options,legacyState:legacy});for(const contract of contracts||[])kernel.register(contract.name,contract);kernel.releaseRegisteredBase();return kernel;
  }
  const isStateView=value=>!!value&&typeof value==='object'&&viewProxies.has(value);
  // identityOf: the stored object behind a state view (value itself otherwise).
  // versionOf: that object's mutation version (see bumpVersion above).
  const identityOf=value=>value&&typeof value==='object'&&rawByView.has(value)?rawByView.get(value):value;
  const versionOf=value=>{const raw=identityOf(value);return raw&&typeof raw==='object'?objectVersions.get(raw)||0:0;};
  // stampOf: "<identity serial>.<version>" of the stored object. Unlike section
  // revisions (which advance only at commit) it changes on every write, inside
  // an open transaction too, and a replaced object never reuses a stamp.
  const objectSerials=new WeakMap();let nextObjectSerial=0;
  const stampOf=value=>{const raw=identityOf(value);if(!raw||typeof raw!=='object')return `v:${typeof raw}:${String(raw)}`;if(!objectSerials.has(raw))objectSerials.set(raw,++nextObjectSerial);return `${objectSerials.get(raw)}.${objectVersions.get(raw)||0}`;};
  return Object.freeze({VERSION,create,fromLegacyState,fingerprint,firstDifference,stableStringify:stable,isStateView,identityOf,versionOf,stampOf});
});

(()=>{
  'use strict';
  const VERSION='3.0.0';
  let activeContext=null,durableSequence=0;
  const targetRevisions=new WeakMap();
  const durableTargets=new WeakSet();
  const stagedTargets=new Map();
  const JOURNALED_ROOTS=new Map();
  const runtimeTelemetry={last:null,lastSimulation:null,samples:[],profiledSamples:[],profiledCount:0,lastDurable:null,durableSamples:[]};
  function compactError(error,depth=0,seen=new Set()){
    if(error==null)return null;if(depth>5)return {message:'error-chain-depth-limit'};
    if(typeof error!=='object')return {message:String(error).slice(0,500)};
    if(seen.has(error))return {message:'error-chain-cycle'};seen.add(error);
    const out={name:String(error.name||'Error').slice(0,80),message:String(error.message||error).slice(0,500)};
    if(error.code!=null)out.code=String(error.code).slice(0,120);
    if(error.transactionLabel!=null)out.transactionLabel=String(error.transactionLabel).slice(0,160);
    if(error.transactionStage!=null)out.transactionStage=String(error.transactionStage).slice(0,80);
    if(error.owner!=null)out.owner=String(error.owner).slice(0,160);
    if(error.stack)out.stack=String(error.stack).split('\n').slice(0,12).join('\n');
    if(Array.isArray(error.failures))out.failures=error.failures.slice(0,16).map(row=>({component:String(row?.component||'unknown').slice(0,120),error:compactError(row?.error??row,depth+1,seen)}));
    if(error.rollbackError)out.rollbackError=compactError(error.rollbackError,depth+1,seen);
    if(error.cause)out.cause=compactError(error.cause,depth+1,seen);
    return out;
  }
  function publishDurableMetric(row){const metric={...row,recordedAtMs:Date.now()};for(const key of Object.keys(metric))if(typeof metric[key]==='number')metric[key]=Math.round(metric[key]*10)/10;runtimeTelemetry.lastDurable=metric;runtimeTelemetry.durableSamples.push(metric);if(runtimeTelemetry.durableSamples.length>16)runtimeTelemetry.durableSamples.shift();return metric;}
  const runtimeClock=()=>globalThis.performance?.now?.()??Date.now();
  function publishRuntimeMetric(row){
    const metric={...row,recordedAtMs:Date.now()};
    runtimeTelemetry.last=metric;
    if(String(metric.label||'').startsWith('simulation:'))runtimeTelemetry.lastSimulation=metric;
    runtimeTelemetry.samples.push(metric);
    if(runtimeTelemetry.samples.length>24)runtimeTelemetry.samples.shift();
    if(metric.profiled===true){
      runtimeTelemetry.profiledCount++;
      runtimeTelemetry.profiledSamples.push(metric);
      runtimeTelemetry.profiledSamples.sort((a,b)=>(Number(b.totalMs)||0)-(Number(a.totalMs)||0));
      if(runtimeTelemetry.profiledSamples.length>24)runtimeTelemetry.profiledSamples.length=24;
    }
    return metric;
  }
  function compactProfileContext(value){
    if(!value||typeof value!=='object'||Array.isArray(value))return null;
    const out={};let count=0;
    for(const [key,item] of Object.entries(value)){
      if(count++>=24)break;
      if(item===null||typeof item==='string'||typeof item==='boolean'||(typeof item==='number'&&Number.isFinite(item)))out[String(key).slice(0,64)]=typeof item==='string'?item.slice(0,120):item;
    }
    return out;
  }
  function jsonClone(value){if(value===undefined)return undefined;return JSON.parse(JSON.stringify(value));}
  // Build 358: sealed rows. An owner registers collections whose members are never edited after insertion
  // (registerSealedCollections). A durable draft copies those collections' membership only and shares the members,
  // deep-frozen, with the live state: a write to one throws (strict mode), so the draft can never reach live data.
  // restoreValue adopts a sealed value instead of writing into it, so publishing the draft is a membership walk.
  // Build 359 (iPhone: every player command copied the live finance documents, 9 MB, and the save re-encoded them): an
  // owner may seal only the members a predicate accepts (options.member(row) -> true). The finance documents seal once
  // they are final (a settled invoice, a cashed cheque, an executed transfer...), the state the business rules never edit
  // again; an open document stays an ordinary row, copied by drafts and snapshots as before. The predicate is asked
  // only when a member is not sealed yet: a sealed member stays sealed.
  // Build 359 (a million assets: the finance audit archive and the proof archives grow with the game, and every command
  // walked them to copy, validate and save them): an owner whose writers replace a collection instead of editing it
  // (copy-on-write: a new array or object for every change) registers it with {container:true}. Once every member is
  // sealed, the collection itself is frozen and sealed: drafts, snapshots, the save and validation share it whole by
  // identity, without walking its members. A write into a sealed collection throws (strict mode), so a writer that
  // edits one in place is found at once. An empty collection is not sealed (a writer may still fill it).
  const SEALED_COLLECTIONS=new Map(),SEALED_OPTIONS=new Map(),SEALED=new WeakSet();
  function registerSealedCollections(root,keys,options={}){
    root=String(root||'').trim();if(!/^[A-Za-z_$][\w$]*$/.test(root))throw new TypeError('transaction-sealed-root-name-invalid');
    const list=[...new Set((Array.isArray(keys)?keys:[]).map(String).filter(Boolean))];if(!list.length)throw new TypeError('transaction-sealed-collections-required');
    const member=options?.member;if(member!==undefined&&typeof member!=='function')throw new TypeError('transaction-sealed-member-filter-invalid');
    const container=options?.container===true;if(member&&container)throw new TypeError('transaction-sealed-container-filter');
    for(const name of list){const key=`${root}\u0000${name}`;if(member||container)SEALED_OPTIONS.set(key,Object.freeze({filter:member||null,container}));else SEALED_OPTIONS.delete(key);}
    SEALED_COLLECTIONS.set(root,Object.freeze([...new Set([...(SEALED_COLLECTIONS.get(root)||[]),...list])]));return true;
  }
  // Build 359 (the fleet routes, 2.4 MB, were deep-copied by every command): a root that is itself a collection of members
  // never edited after insertion (an array root such as customRoutes: its owner adds, replaces and removes routes, never
  // edits one) is registered whole (registerSealedRoot). Drafts and snapshots copy its membership and share its members,
  // sealed as other sealed members are.
  const SEALED_ROOTS=new Set();
  function registerSealedRoot(name){name=String(name||'').trim();if(!/^[A-Za-z_$][\w$]*$/.test(name))throw new TypeError('transaction-sealed-root-name-invalid');SEALED_ROOTS.add(name);return true;}
  const NO_OPTIONS=Object.freeze({filter:null,container:false}),collectionOptions=(root,name)=>SEALED_OPTIONS.get(`${root}\u0000${name}`)||NO_OPTIONS;
  const plainData=value=>{if(!value||typeof value!=='object')return true;if(Array.isArray(value))return true;const proto=Object.getPrototypeOf(value);return proto===Object.prototype||proto===null||(Object.getPrototypeOf(proto)===null&&typeof proto.constructor==='function'&&proto.constructor.name==='Object');};
  function sealable(value,depth){
    if(!value||typeof value!=='object'||SEALED.has(value))return true;
    if(depth>64||!plainData(value)||Object.isFrozen(value)||Object.getOwnPropertySymbols(value).length)return false;
    for(const key of Object.keys(value)){const child=value[key];if(child&&typeof child==='object'&&!sealable(child,depth+1))return false;}
    return true;
  }
  function freezeSealed(value){if(!value||typeof value!=='object'||SEALED.has(value))return;for(const key of Object.keys(value))freezeSealed(value[key]);Object.freeze(value);SEALED.add(value);}
  // Checked before anything is frozen: a member that is not plain JSON-like data is copied instead, untouched.
  function sealValue(value){if(SEALED.has(value))return true;if(!sealable(value,0))return false;freezeSealed(value);return true;}
  // A member the owner's filter does not accept (yet) is copied, as a member that is not plain data is.
  function sealMember(member,filter){return SEALED.has(member)||(!filter||filter(member)===true)&&sealValue(member);}
  // A sealed container is returned itself. A container collection whose members all seal is sealed and returned itself.
  function sealedCopy(collection,{filter=null,container=false}=NO_OPTIONS){
    if(SEALED.has(collection))return collection;let all=true;
    if(Array.isArray(collection)){const out=collection.slice();for(let i=0;i<out.length;i++){const member=out[i];if(member&&typeof member==='object'&&!sealMember(member,filter)){out[i]=deepClone(member);all=false;}}return container&&all&&sealContainer(collection)?collection:out;}
    const out={...collection};for(const key of Object.keys(out)){const member=out[key];if(member&&typeof member==='object'&&!sealMember(member,filter)){out[key]=deepClone(member);all=false;}}return container&&all&&sealContainer(collection)?collection:out;
  }
  // Freezes a container collection whose members are all sealed (checked by the caller). Not an empty one, not one that
  // is not plain data.
  function sealContainer(collection){
    if(SEALED.has(collection))return true;const size=Array.isArray(collection)?collection.length:Object.keys(collection).length;
    if(!size||!plainData(collection)||Object.isFrozen(collection)||Object.getOwnPropertySymbols(collection).length)return false;
    Object.freeze(collection);SEALED.add(collection);return true;
  }
  const isSealed=value=>!!value&&typeof value==='object'&&SEALED.has(value);
  // Build 359: the lineage of a container collection (replaced by its writers, never edited). A writer that builds the
  // next version from a base declares what it changed (deriveContainer): the keys of an object it wrote or removed, the
  // members of an array it added or removed. A reader that verified an earlier version (the save schema's memo) asks for
  // the changes since (containerChanges) and checks only those. A version keeps its chain's root (the oldest version,
  // held while descendants live) and the changes accumulated since the root; a reader that knows any version of the
  // chain gets those changes (a superset of what changed since its version: it may check a few rows again). A chain
  // whose changes reach LINEAGE_LIMIT ends (the next version has no lineage): a reader then checks the whole collection.
  const LINEAGE=new WeakMap(),LINEAGE_LIMIT=8192;
  function deriveContainer(next,base,{changed=[],removed=[]}={}){
    if(!next||typeof next!=='object'||!base||typeof base!=='object'||next===base||Array.isArray(next)!==Array.isArray(base))return false;
    const prior=LINEAGE.get(base),entry={root:prior?prior.root:base,changed:new Set(prior?prior.changed:[]),removed:new Set(prior?prior.removed:[])};
    for(const key of changed){entry.changed.add(key);entry.removed.delete(key);}
    for(const key of removed){entry.removed.add(key);entry.changed.delete(key);}
    if(entry.changed.size+entry.removed.size>LINEAGE_LIMIT){LINEAGE.delete(next);return false;}
    LINEAGE.set(next,Object.freeze(entry));return true;
  }
  // The changes from known to current ({changed,removed}, Sets), or null when current does not descend from known's chain.
  function containerChanges(current,known){
    if(current===known)return {changed:new Set(),removed:new Set()};
    const lineage=current&&typeof current==='object'?LINEAGE.get(current):null;if(!lineage||!known||typeof known!=='object')return null;
    return lineage.root===known||LINEAGE.get(known)?.root===lineage.root?{changed:lineage.changed,removed:lineage.removed}:null;
  }
  // A registered name is a key of the root, or a path inside it whose steps may be '*' (every key of that object):
  // 'auditArchive.records.*' is every collection of finance.auditArchive.records. The collections a name reaches now,
  // with their path inside the root.
  function sealedTargets(root,name){
    const steps=String(name).split('.'),out=[];
    (function walk(value,index,path){
      if(!value||typeof value!=='object'||Array.isArray(value)||!plainData(value))return;
      const step=steps[index],keys=step==='*'?Object.keys(value):Object.prototype.hasOwnProperty.call(value,step)?[step]:[];
      for(const key of keys){const child=value[key];if(index===steps.length-1){if(child&&typeof child==='object'&&plainData(child))out.push({path:[...path,key],collection:child});}else walk(child,index+1,[...path,key]);}
    })(root,0,[]);
    return out;
  }
  // A copy of root in which each target collection is replaced by null (same key order), copying only the objects
  // on the targets' paths; the collections and everything beside them are shared.
  function withoutTargets(root,targets){
    const copies=new Set(),top={...root};copies.add(top);
    for(const {path} of targets){let node=top;for(let i=0;i<path.length-1;i++){let child=node[path[i]];if(!copies.has(child)){child={...child};copies.add(child);node[path[i]]=child;}node=child;}node[path[path.length-1]]=null;}
    return top;
  }
  // Owners loaded before this module queue their registration.
  for(const [root,keys,options] of Array.isArray(globalThis.__GH_PENDING_SEALED_COLLECTIONS__)?globalThis.__GH_PENDING_SEALED_COLLECTIONS__:[])registerSealedCollections(root,keys,options);delete globalThis.__GH_PENDING_SEALED_COLLECTIONS__;
  for(const name of Array.isArray(globalThis.__GH_PENDING_SEALED_ROOTS__)?globalThis.__GH_PENDING_SEALED_ROOTS__:[])registerSealedRoot(name);delete globalThis.__GH_PENDING_SEALED_ROOTS__;
  // Seals the members of every registered collection in place (a quiescent live state, e.g. before a save).
  function sealCollections(state){
    let sealed=0;if(!state||typeof state!=='object')return sealed;
    for(const name of SEALED_ROOTS){const root=state[name];if(Array.isArray(root)&&!JOURNALED_ROOTS.has(name))for(const member of root)if(member&&typeof member==='object'&&!SEALED.has(member)&&sealValue(member))sealed++;}
    for(const [root,names] of SEALED_COLLECTIONS){const value=state[root];if(!value||typeof value!=='object'||Array.isArray(value)||JOURNALED_ROOTS.has(root))continue;for(const name of names){const {filter,container}=collectionOptions(root,name);for(const {collection} of sealedTargets(value,name)){if(SEALED.has(collection))continue;const members=Array.isArray(collection)?collection:Object.values(collection);let all=true;for(const member of members)if(member&&typeof member==='object'&&!SEALED.has(member)){if(sealMember(member,filter))sealed++;else all=false;}if(container&&all)sealContainer(collection);}}}
    return sealed;
  }
  function cloneWithoutJournaledRoots(value,{shareJournaledRoots=false,shareSealed=shareJournaledRoots}={}){
    if(!value||typeof value!=='object'||Array.isArray(value))return null;
    const keys=Object.keys(value),excluded=keys.filter(key=>JOURNALED_ROOTS.has(key));if(!excluded.length&&!(shareSealed&&keys.some(key=>SEALED_COLLECTIONS.has(key)||SEALED_ROOTS.has(key))))return null;
    // Sealed collections are shared by durable drafts and by full rollback snapshots (shareSealed): their rows cannot
    // change, so the copy holds the same rows in a new collection.
    const sealed=shareSealed?new Map():null,sealedRoots=new Map(),source={};
    for(const key of keys){
      if(JOURNALED_ROOTS.has(key))continue;const root=value[key],collections=sealed&&SEALED_COLLECTIONS.get(key);
      if(sealed&&SEALED_ROOTS.has(key)&&Array.isArray(root)){sealedRoots.set(key,root);source[key]=null;continue;}
      if(collections&&root&&typeof root==='object'&&!Array.isArray(root)&&plainData(root)){
        const targets=collections.flatMap(name=>{const options=collectionOptions(key,name);return sealedTargets(root,name).map(target=>({...target,options}));});
        if(targets.length){sealed.set(key,targets);source[key]=withoutTargets(root,targets);continue;}
      }
      source[key]=root;
    }
    let cloned;if(typeof globalThis.structuredClone==='function'){try{cloned=globalThis.structuredClone(source);}catch(_error){cloned=jsonClone(source);}}else cloned=jsonClone(source);
    if(sealed)for(const [key,targets] of sealed)for(const {path,collection,options} of targets){let node=cloned[key];for(let i=0;i<path.length-1;i++)node=node[path[i]];node[path[path.length-1]]=sealedCopy(collection,options);}
    const out={};for(const key of keys){if(JOURNALED_ROOTS.has(key)){if(shareJournaledRoots)out[key]=value[key];}else out[key]=sealedRoots.has(key)?sealedCopy(sealedRoots.get(key)):cloned[key];}return out;
  }
  // State roots registered as self-journaled are excluded from transaction
  // snapshots. Durable drafts may explicitly share them while their owner
  // keeps a journal open until the save is committed.
  const SNAPSHOT_OPTIONS=Object.freeze({shareSealed:true});
  function deepClone(value,options={}){
    let out=cloneWithoutJournaledRoots(value,options);
    if(!out&&typeof globalThis.structuredClone==='function')try{out=globalThis.structuredClone(value);}catch(_error){}
    if(!out)out=jsonClone(value);
    return globalThis.GH_STATE_CODEC?.inheritColdArchive?.(value,out)||out;
  }
  function registerJournaledRoot(name,hooks={}){
    name=String(name||'').trim();if(!/^[A-Za-z_$][\w$]*$/.test(name))throw new TypeError('transaction-journaled-root-name-invalid');
    const normalized={begin:typeof hooks.begin==='function'?hooks.begin:null,commit:typeof hooks.commit==='function'?hooks.commit:null,rollback:typeof hooks.rollback==='function'?hooks.rollback:null,revision:typeof hooks.revision==='function'?hooks.revision:null};
    const existing=JOURNALED_ROOTS.get(name);if(existing){if(existing.begin===normalized.begin&&existing.commit===normalized.commit&&existing.rollback===normalized.rollback&&existing.revision===normalized.revision)return true;throw new Error(`transaction-journaled-root-already-registered:${name}`);}
    JOURNALED_ROOTS.set(name,normalized);return true;
  }
  function beginJournaledRoots(target){
    const sessions=[];
    try{for(const [name,hooks] of JOURNALED_ROOTS){if(!Object.prototype.hasOwnProperty.call(target||{},name)||!hooks.begin)continue;const token=hooks.begin(target,target[name]);if(token!==undefined&&token!==null)sessions.push({name,target,value:target[name],hooks,token});}return sessions;}
    catch(error){rollbackJournaledRoots(sessions);throw error;}
  }
  function commitJournaledRoots(sessions){if(!Array.isArray(sessions))return;for(let i=sessions.length-1;i>=0;i--){const row=sessions[i];row.hooks.commit?.(row.target,row.value,row.token);}sessions.length=0;}
  function rollbackJournaledRoots(sessions){if(!Array.isArray(sessions))return;let firstError=null;for(let i=sessions.length-1;i>=0;i--){const row=sessions[i];try{row.hooks.rollback?.(row.target,row.value,row.token);}catch(error){firstError=firstError||error;}}sessions.length=0;if(firstError)throw firstError;}
  // Restores `target` in place from a structured-clone `snapshot`, preserving object identity.
  // Fast path (same key sequence, unfrozen plain data object): no key Map, no delete/re-add and
  // no write for unchanged primitives. Anything else uses the original delete/re-add path, so
  // shape changes, key order and the resulting graph stay byte-for-byte equivalent.
  // The identity of a record in a collection; null for values without one (restored in place as before).
  function recordIdentity(value){if(Array.isArray(value))return null;const id=value.documentProofId??value.id??value.number??null;return id===null||id===undefined?null:String(id);}
  function restoreValue(target,snapshot){
    // Fleet store records (one ArrayBuffer): always a fresh copy, so the store
    // sees a new buffer and rebuilds every runtime index from restored data.
    if(snapshot instanceof ArrayBuffer)return snapshot.slice(0);
    // A shared subtree (row-level snapshots keep immutable leaves by reference) is already restored.
    if(target===snapshot)return target;
    // A sealed value is never edited: adopt the snapshot's value instead of writing into a frozen target.
    if(isSealed(snapshot)||isSealed(target))return snapshot;
    // Typed arrays: restore with one copy, never element by element.
    if(ArrayBuffer.isView(snapshot)){
      if(ArrayBuffer.isView(target)&&target.constructor===snapshot.constructor&&target.length===snapshot.length&&!Object.isFrozen(target)){target.set(snapshot);return target;}
      return snapshot.slice();
    }
    if(Array.isArray(snapshot)){
      if(!Array.isArray(target))return deepClone(snapshot);
      if(target.length!==snapshot.length)target.length=snapshot.length;
      for(let i=0;i<snapshot.length;i++){
        const sv=snapshot[i],tv=target[i];
        // A position that now holds another record (a row was inserted or removed since the snapshot) takes the
        // snapshot's object as it is. Writing it into the old object in place corrupted documents: publish() restores a
        // committed draft that shares rows with the live state, so the old object at one position is the draft's row at
        // the next, and its fields (a sealed counterparty snapshot) were overwritten before that position was read
        // (Build 358 owner report: after a new invoice, older ones failed document-counterparty-mismatch and the save was
        // refused).
        if(sv&&typeof sv==='object'&&tv&&typeof tv==='object'&&tv!==sv&&recordIdentity(tv)!==recordIdentity(sv)){target[i]=sv;continue;}
        if(sv&&typeof sv==='object'){const next=restoreValue(tv,sv);if(next!==tv||!(i in target))target[i]=next;}
        else if(tv!==sv||!(i in target))target[i]=sv;
      }
      return target;
    }
    if(snapshot&&typeof snapshot==='object'){
      if(!target||typeof target!=='object'||Array.isArray(target))target={};
      const targetKeys=Object.keys(target),snapshotKeys=Object.keys(snapshot);
      let sameShape=targetKeys.length===snapshotKeys.length&&!Object.isFrozen(target);
      if(sameShape)for(let i=0;i<snapshotKeys.length;i++)if(targetKeys[i]!==snapshotKeys[i]){sameShape=false;break;}
      if(sameShape){
        for(let i=0;i<snapshotKeys.length;i++){
          const key=snapshotKeys[i],sv=snapshot[key],tv=target[key];
          if(sv&&typeof sv==='object'){const next=restoreValue(tv,sv);if(next!==tv)target[key]=next;}
          else if(tv!==sv||(sv!==sv))target[key]=sv;
        }
        return target;
      }
      const existing=new Map(targetKeys.map(key=>[key,target[key]]));
      for(const key of targetKeys)delete target[key];
      for(const [key,sv] of Object.entries(snapshot)){const tv=existing.get(key);target[key]=sv&&typeof sv==='object'?restoreValue(tv,sv):sv;}
      return target;
    }
    return snapshot;
  }
  function restoreObject(target,snapshot,rootValues=null){
    if(!target||typeof target!=='object'||Array.isArray(target))throw new TypeError('Transaction target must be an object');if(!snapshot||typeof snapshot!=='object'||Array.isArray(snapshot))throw new TypeError('Transaction snapshot must be an object');
    const preserved=[...JOURNALED_ROOTS.keys()].filter(key=>Object.prototype.hasOwnProperty.call(target,key)||Object.prototype.hasOwnProperty.call(snapshot,key)||(rootValues&&Object.prototype.hasOwnProperty.call(rootValues,key)));
    if(!preserved.length)return restoreValue(target,snapshot);
    const keep=new Set(preserved),current=Object.keys(target),wanted=Object.keys(snapshot);
    for(const key of current)if(!keep.has(key)&&!Object.prototype.hasOwnProperty.call(snapshot,key))delete target[key];
    for(const key of wanted){if(keep.has(key))continue;const sv=snapshot[key],tv=target[key];target[key]=sv&&typeof sv==='object'?restoreValue(tv,sv):sv;}
    for(const key of preserved)if(!Object.prototype.hasOwnProperty.call(target,key)&&rootValues&&Object.prototype.hasOwnProperty.call(rootValues,key))target[key]=rootValues[key];
    return target;
  }
  function sameOrder(keys,expected){return keys.length===expected.length&&keys.every((key,index)=>key===expected[index]);}
  function restoreRootOrder(target,rootOrder){
    if(!Array.isArray(rootOrder)||!rootOrder.length)return target;
    const current=Object.keys(target);if(sameOrder(current,rootOrder))return target;
    const descriptors=Object.getOwnPropertyDescriptors(target),ordered=[...rootOrder.filter(key=>Object.prototype.hasOwnProperty.call(descriptors,key)),...current.filter(key=>!rootOrder.includes(key))];
    for(const key of current){const descriptor=descriptors[key];if(descriptor?.configurable===false)throw new Error(`transaction-root-order-nonconfigurable:${key}`);delete target[key];}
    for(const key of ordered)Object.defineProperty(target,key,descriptors[key]);
    return target;
  }
  function isActive(){return !!activeContext;}
  // Fleet Core v4: an owner that journals its own writes registers an undo (run
  // after the snapshot restore on rollback, newest first) and a release (run once
  // the transaction has committed and its critical hooks succeeded).
  function registerUndo(undo,release){
    if(!activeContext)throw new Error('transaction-undo-requires-active-transaction');
    if(typeof undo!=='function')throw new TypeError('transaction-undo-callback-required');
    activeContext.undos.push({undo,release:typeof release==='function'?release:null});return true;
  }
  function revision(target){return target&&typeof target==='object'?targetRevisions.get(target)||0:0;}
  function advanceRevision(target){const next=revision(target)>=Number.MAX_SAFE_INTEGER?1:revision(target)+1;targetRevisions.set(target,next);return next;}
  function transactionMemo(key,factory){if(!activeContext)return typeof factory==='function'?factory():undefined;key=String(key||'');if(activeContext.memo.has(key))return activeContext.memo.get(key);const value=typeof factory==='function'?factory():factory;activeContext.memo.set(key,value);return value;}
  function transactionMemoGet(key){if(!activeContext)return undefined;return activeContext.memo.get(String(key||''));}
  function transactionMemoSet(key,value){if(!activeContext)return value;activeContext.memo.set(String(key||''),value);return value;}
  function normalizeScope(scope){if(!Array.isArray(scope)||!scope.length)return null;return [...new Set(scope.map(String).filter(Boolean))];}
  function normalizeWriteRoots(roots){if(!Array.isArray(roots))return null;return [...new Set(roots.map(String).filter(Boolean))];}
  function normalizeWriterContracts(contracts){return Array.isArray(contracts)?contracts.filter(row=>row&&typeof row==='object').map(row=>({...row})):[];}
  function journaledRevisionSnapshot(target,durableContext){
    if(!durableContext||target!==durableContext.draft&&target!==durableContext.liveState)return null;
    const roots=new Map();for(const [name,hooks] of JOURNALED_ROOTS){if(!hooks.revision||target[name]!==durableContext.liveState?.[name])continue;roots.set(name,hooks.revision(target,target[name]));}
    return roots.size?{durableContext,roots}:null;
  }
  function changedJournaledRevisions(target,snapshot){
    if(!snapshot)return [];
    const changed=[];for(const [name,before] of snapshot.roots){const hooks=JOURNALED_ROOTS.get(name),after=hooks?.revision?.(target,target[name]);if(!Object.is(before,after))changed.push(name);}
    return changed.sort();
  }
  function auditEqual(a,b,seen=new WeakMap()){
    if(Object.is(a,b))return true;
    if(!a||!b||typeof a!=='object'||typeof b!=='object')return false;
    if(ArrayBuffer.isView(a)||ArrayBuffer.isView(b)){if(!ArrayBuffer.isView(a)||!ArrayBuffer.isView(b)||a.constructor!==b.constructor||a.length!==b.length)return false;for(let i=0;i<a.length;i++)if(!Object.is(a[i],b[i]))return false;return true;}
    if(Array.isArray(a)!==Array.isArray(b))return false;
    let peers=seen.get(a);if(peers?.has(b))return true;if(!peers){peers=new WeakSet();seen.set(a,peers);}peers.add(b);
    if(Array.isArray(a)){if(a.length!==b.length)return false;for(let i=0;i<a.length;i++)if(!auditEqual(a[i],b[i],seen))return false;return true;}
    const ak=Object.keys(a),bk=Object.keys(b);if(ak.length!==bk.length)return false;
    for(const key of ak)if(!Object.prototype.hasOwnProperty.call(b,key)||!auditEqual(a[key],b[key],seen))return false;
    return true;
  }
  function diffRootKeys(target,baseline){
    const keys=new Set([...Object.keys(baseline||{}),...Object.keys(target||{})]),changed=[];
    for(const key of keys){if(JOURNALED_ROOTS.has(key))continue;const hasA=Object.prototype.hasOwnProperty.call(target,key),hasB=Object.prototype.hasOwnProperty.call(baseline,key);if(hasA!==hasB||!auditEqual(target[key],baseline[key]))changed.push(key);}
    return changed.sort();
  }
  // Row-level snapshots (Build 358). A root's owner may certify that writes inside a transaction stay at row level:
  //   root.key = value; a collection (root.key is an array or a plain object) gains, loses or replaces members;
  //   a member's own field is assigned (root.key[i].field = value, root.key[id].field = value).
  // Nothing deeper is edited in place: arrays and objects inside a member are replaced, never mutated. Under that
  // contract three shallow levels restore the root exactly, and leaves (route geometry, archived rows) are shared
  // instead of deep-copied. level:'containers' certifies writes never reach members' fields (two levels).
  // immutable:[keys] names collections whose members are never edited after insertion (only the collection is copied).
  const isPlainRecord=value=>!!value&&typeof value==='object'&&!ArrayBuffer.isView(value)&&!(value instanceof ArrayBuffer);
  // A sealed container cannot change (its writers replace it): it is kept by reference, and restoring it is a no-op (the
  // member of its parent that held it is restored).
  function captureMembers(value){return SEALED.has(value)||Object.isFrozen(value)?{ref:value,sealed:true}:Array.isArray(value)?{ref:value,array:true,items:value.slice()}:{ref:value,array:false,keys:Object.keys(value),values:{...value}};}
  function restoreMembers(entry){
    const ref=entry.ref;if(entry.sealed)return;
    if(entry.array){
      const items=entry.items;let same=ref.length===items.length;if(same)for(let i=0;i<items.length;i++)if(ref[i]!==items[i]||!(i in ref)){same=false;break;}
      if(!same){ref.length=0;for(let i=0;i<items.length;i++)ref.push(items[i]);}
      return;
    }
    const keys=entry.keys,values=entry.values,current=Object.keys(ref);let sameShape=current.length===keys.length;
    if(sameShape)for(let i=0;i<keys.length;i++)if(current[i]!==keys[i]){sameShape=false;break;}
    if(sameShape){for(let i=0;i<keys.length;i++){const key=keys[i],value=values[key];if(ref[key]!==value)ref[key]=value;}return;}
    for(const key of current)delete ref[key];for(const key of keys)ref[key]=values[key];
  }
  function captureRows(root,policy){
    const rows=policy?.level==='containers'?null:[],immutable=new Set(Array.isArray(policy?.immutable)?policy.immutable.map(String):[]),containers=[],seen=new Set([root]);
    // An array root is itself the collection: its members are the rows.
    if(Array.isArray(root)){if(rows)for(const member of root)if(isPlainRecord(member)&&!seen.has(member)){seen.add(member);rows.push(captureMembers(member));}return {root:captureMembers(root),containers,rows:rows||[]};}
    for(const key of Object.keys(root)){
      const value=root[key];if(!isPlainRecord(value)||seen.has(value))continue;seen.add(value);containers.push(captureMembers(value));
      if(!rows||immutable.has(key))continue;
      const members=Array.isArray(value)?value:Object.values(value);
      for(const member of members)if(isPlainRecord(member)&&!seen.has(member)){seen.add(member);rows.push(captureMembers(member));}
    }
    return {root:captureMembers(root),containers,rows:rows||[]};
  }
  function restoreRows(capture){for(const row of capture.rows)restoreMembers(row);for(const container of capture.containers)restoreMembers(container);restoreMembers(capture.root);}
  function captureEntry(target,key,policy=null){
    const exists=Object.prototype.hasOwnProperty.call(target,key),value=exists?target[key]:undefined;
    if(exists&&policy&&isPlainRecord(value))return {exists:true,ref:value,rows:captureRows(value,policy)};
    // Sealed collections of this root are shared (their rows cannot change), as a full rollback snapshot shares them.
    return {exists,value:exists&&(SEALED_COLLECTIONS.has(key)||SEALED_ROOTS.has(key))?deepClone({[key]:value},SNAPSHOT_OPTIONS)[key]:deepClone(value)};
  }
  function restoreEntry(target,key,entry){
    if(!entry?.exists){delete target[key];return;}
    if(entry.rows){if(target[key]!==entry.ref)target[key]=entry.ref;restoreRows(entry.rows);return;}
    const sv=entry.value,tv=target[key];target[key]=sv&&typeof sv==='object'?restoreValue(tv,sv):sv;
  }
  function captureScoped(target,scope,policies=null){const snapshot={};for(const key of scope){if(JOURNALED_ROOTS.has(key))continue;snapshot[key]=captureEntry(target,key,policies?.[key]||null);}return snapshot;}
  function restoreScoped(target,snapshot,scope,rootValues=null){for(const key of scope){if(JOURNALED_ROOTS.has(key))continue;restoreEntry(target,key,snapshot[key]);}for(const key of JOURNALED_ROOTS.keys())if(!Object.prototype.hasOwnProperty.call(target,key)&&rootValues&&Object.prototype.hasOwnProperty.call(rootValues,key))target[key]=rootValues[key];return target;}
  function isJournalPrimitive(value){return value===null||typeof value==='string'||typeof value==='boolean'||(typeof value==='number'&&Number.isFinite(value));}
  function captureJournal(target,scope,contracts){
    const assetContract=contracts.find(row=>row.proven===true&&row.root==='assets'&&row.mode==='asset-fields'&&Array.isArray(row.fields)&&row.fields.length);
    if(scope.includes('assets')&&!assetContract)return {ok:false,reason:'journal-assets-without-field-contract'};
    const rootScope=scope.filter(key=>key!=='assets'),rootSnapshot=captureScoped(target,rootScope),assetEntries=[];
    if(assetContract){
      const fields=[...new Set(assetContract.fields.map(String).filter(Boolean))];
      for(let index=0;index<(target.assets||[]).length;index++){
        const asset=target.assets[index];if(!asset||typeof asset!=='object'||Array.isArray(asset))return {ok:false,reason:'journal-asset-invalid'};
        const saved={};
        for(const field of fields){
          const descriptor=Object.getOwnPropertyDescriptor(asset,field);
          if(!descriptor||!Object.prototype.hasOwnProperty.call(descriptor,'value')||!isJournalPrimitive(descriptor.value))return {ok:false,reason:`journal-asset-field-unsupported:${field}`};
          saved[field]={...descriptor};
        }
        assetEntries.push({index,id:asset.id??null,ref:asset,keyOrder:Object.keys(asset),fields:saved});
      }
      return {ok:true,rootScope,rootSnapshot,assetEntries,assetFields:fields,records:rootScope.length+assetEntries.length*fields.length};
    }
    return {ok:true,rootScope,rootSnapshot,assetEntries,assetFields:[],records:rootScope.length};
  }
  function validateJournalPostState(target,journal){
    if(!journal)return {ok:true};
    const assets=target.assets||[];
    if(journal.assetEntries.length&&assets.length!==journal.assetEntries.length)return {ok:false,reason:'journal-assets-structural-length'};
    for(const entry of journal.assetEntries){
      const asset=assets[entry.index];
      if(!asset||asset!==entry.ref)return {ok:false,reason:`journal-assets-structural-order:${entry.id??entry.index}`};
      if(!sameOrder(Object.keys(asset),entry.keyOrder||[]))return {ok:false,reason:`journal-asset-key-structure:${entry.id??entry.index}`};
      for(const field of Object.keys(entry.fields||{})){
        const descriptor=Object.getOwnPropertyDescriptor(asset,field);
        if(!descriptor||!Object.prototype.hasOwnProperty.call(descriptor,'value'))return {ok:false,reason:`journal-asset-field-structure:${field}`};
        if(!isJournalPrimitive(descriptor.value))return {ok:false,reason:`journal-asset-field-unsupported-new:${field}`};
      }
    }
    return {ok:true};
  }
  function restoreJournal(target,journal,rootOrder){
    if(journal.rootScope.length)restoreScoped(target,journal.rootSnapshot,journal.rootScope);
    const assets=target.assets||[];
    for(const entry of journal.assetEntries){
      let asset=assets[entry.index];if(!asset||asset!==entry.ref){if(entry.id!=null)asset=assets.find(row=>row?.id===entry.id);}
      if(!asset||typeof asset!=='object')throw new Error(`journal-asset-missing:${entry.id??entry.index}`);
      for(const [field,descriptor] of Object.entries(entry.fields))Object.defineProperty(asset,field,descriptor);
    }
    return restoreRootOrder(target,rootOrder);
  }
  function applyJournalPreimageToBaseline(baseline,context){
    const journal=context.journal;if(!journal)return baseline;
    if(journal.rootScope.length)restoreScoped(baseline,journal.rootSnapshot,journal.rootScope);
    const assets=baseline.assets||[];
    for(const entry of journal.assetEntries){
      const asset=assets[entry.index];if(!asset||typeof asset!=='object')throw new Error(`journal-promotion-asset-missing:${entry.id??entry.index}`);
      for(const [field,descriptor] of Object.entries(entry.fields))Object.defineProperty(asset,field,{...descriptor});
    }
    const allowed=new Set(context.rootOrder);for(const key of Object.keys(baseline))if(!allowed.has(key))delete baseline[key];
    return restoreRootOrder(baseline,context.rootOrder);
  }
  function promoteLegacyScoped(context){
    const target=context.target,scoped=new Set(context.scope),remaining={};
    for(const key of context.rootOrder)if(!scoped.has(key)&&Object.prototype.hasOwnProperty.call(target,key))remaining[key]=target[key];
    const remainingClone=deepClone(remaining,SNAPSHOT_OPTIONS),full={};
    const rowEntries={};
    for(const key of context.rootOrder){if(scoped.has(key)){const entry=context.snapshot[key];if(entry?.rows){rowEntries[key]=entry;full[key]=entry.ref;}else if(entry?.exists)full[key]=entry.value;}else if(Object.prototype.hasOwnProperty.call(remainingClone,key))full[key]=remainingClone[key];}
    context.snapshot=full;context.scope=null;context.rowEntries=rowEntries;
  }
  function promoteToFull(context,reason='journal-fallback'){
    if(!context||context.rollbackStorage==='full-snapshot')return context;
    const start=runtimeClock();
    if(context.rollbackStorage==='journal'){
      const baseline=applyJournalPreimageToBaseline(deepClone(context.target,SNAPSHOT_OPTIONS),context);
      context.snapshot=baseline;context.journal=null;context.scope=null;
    }else if(context.scope)promoteLegacyScoped(context);
    context.rollbackStorage='full-snapshot';
    if(context.timing){context.timing.snapshotMs+=Math.max(0,runtimeClock()-start);context.timing.fullSnapshot=true;context.timing.fullSnapshotFallback=true;context.timing.fallbackReason=context.timing.fallbackReason||String(reason||'journal-fallback');context.timing.rollbackStorage='full-snapshot';}
    return context;
  }
  function afterCommit(fn,options={}){
    if(typeof fn!=='function')return;
    const task={fn,critical:options?.critical===true,priority:Number(options.priority)||0,key:options.key||null,owner:options.owner||null,writeContract:options.writeContract||null,irreversible:options.irreversible===true};
    if(activeContext){
      const ctx=activeContext;
      if(task.critical){
        if(task.irreversible){
          if(ctx.irreversiblePriority!=null)throw new Error('transaction-irreversible-ordering:multiple-terminal-critical-tasks');
          const laterExisting=ctx.postCommit.some(row=>row.critical&&!row.irreversible&&row.priority>task.priority);if(laterExisting)throw new Error('transaction-irreversible-ordering:critical-task-after-terminal');
          ctx.irreversiblePriority=task.priority;
        }else if(ctx.irreversiblePriority!=null&&task.priority>=ctx.irreversiblePriority)throw new Error('transaction-irreversible-ordering:critical-task-after-terminal');
        if(ctx.rollbackStorage==='journal'){
          const contract=task.writeContract,readOnly=contract?.proven===true&&contract?.readOnly===true;
          if(!readOnly)promoteToFull(ctx,`critical-hook:${task.owner||task.key||'unproven'}`);
        }
      }
      if(task.key)ctx.postCommit=ctx.postCommit.filter(x=>x.key!==task.key);
      ctx.postCommit.push(task);
    }else drainSteps(fn());
  }
  // Build 358: a critical post-commit task may return an iterator (a check in sections, e.g. the schema validation). A
  // staged transaction runs one section per step; anything else runs it to the end at once.
  function isStepIterator(value){return !!value&&typeof value==='object'&&typeof value.next==='function'&&typeof value[Symbol.iterator]==='function';}
  function drainSteps(value){if(isStepIterator(value))while(!value.next().done){}return value;}
  function journalAdmissionReason(options,scope,contracts){
    if(options.rollbackMode!=='journal')return null;
    if(!scope)return 'journal-requires-scope';
    if(!contracts.length)return 'unproven-writer';
    if(contracts.some(row=>row.proven!==true))return 'unproven-writer';
    if(contracts.some(row=>row.structural===true))return 'structural-writer';
    if(contracts.some(row=>row.mayJoin===true))return 'composite-writer';
    if(contracts.some(row=>row.allowNestedSubobjects===true||row.nested===true))return 'nested-asset-writer';
    if(typeof options.validate==='function'&&!(options.validateContract?.proven===true&&options.validateContract?.readOnly===true))return 'validation-unproven';
    return null;
  }
  function join(target,options={}){
    if(!activeContext)return execute(target,options);
    const ctx=activeContext;
    try{
      if(ctx.target!==target)throw new Error('Cross-state transaction join is forbidden');
      // Phase1C-B forbids late journal promotion: by the time join() is called the
      // parent may already have written. Composite writers must declare mayJoin at
      // execute() admission and therefore begin on Full Snapshot until an upfront
      // scope-union contract is separately proven.
      if(ctx.rollbackStorage==='journal')throw new Error('transaction-journal-unexpected-join');
      // A scoped writer that declares scopedJoin certifies its scope covers every root its joined writers touch
      // (proved by write-set enforcement tests), so the join needs no full-state snapshot.
      if(ctx.scope&&ctx.scopedJoin!==true)promoteToFull(ctx,'joined-writer');
      const validation=options.validate?options.validate(ctx.measure):true;
      if(validation===false||validation?.ok===false)throw new Error(validation?.reason||'validation-rejected');
      const value=options.apply(ctx.measure);
      if(value?.then)throw new Error('Asynchronous state mutation requires an explicit lifecycle');
      return {committed:true,value,label:ctx.label,joined:true};
    }catch(error){ctx.failure=error;throw error;}
  }
  // A scoped transaction may capture further roots it is about to write (for example an owner that only runs on some
  // slices). Must be called before the first write to those roots; a full-snapshot transaction already covers them.
  function extendScope(target,keys,policies=null){
    const ctx=activeContext;if(!ctx)throw new Error('transaction-extend-scope-requires-active-transaction');if(ctx.target!==target)throw new Error('Cross-state transaction scope extension is forbidden');
    if(!ctx.scope||ctx.rollbackStorage!=='legacy-scoped')return false;
    const start=runtimeClock(),known=new Set(ctx.scope);let added=0;
    for(const key of normalizeScope(keys)||[]){if(known.has(key))continue;known.add(key);ctx.scope.push(key);if(ctx.declaredWriteRoots&&!ctx.declaredWriteRoots.includes(key))ctx.declaredWriteRoots.push(key);if(!JOURNALED_ROOTS.has(key))ctx.snapshot[key]=captureEntry(target,key,policies?.[key]||null);added++;}
    if(ctx.timing){ctx.timing.snapshotMs+=Math.max(0,runtimeClock()-start);ctx.timing.scopeSize=ctx.scope.length;}
    return added>0;
  }
  // Build 358: staged transactions. One transaction (one rollback point, one set of post-commit checks) whose apply is
  // an iterator: beginStaged() runs it step by step, normally one step per frame, so a heavy boundary (the daily close)
  // never blocks a frame for its whole length. Between steps no transaction is active and the target is locked: any other
  // execute()/executeDurable() on it throws 'staged-transaction-in-progress'. abort() rolls everything back exactly like a
  // failed execute(). execute() is the same machinery driven to completion in one call.
  function execute(target,options={}){
    const steps=executeSteps(target,options,null),step=steps.next();
    if(!step.done)throw new Error('transaction-unexpected-suspension');
    return step.value;
  }
  function beginStaged(target,options={}){
    if(!target||typeof target!=='object'||Array.isArray(target))throw new TypeError('Transaction target must be an object');
    if(activeContext)throw new Error('Nested state transactions are forbidden; domain commands must join their owner');
    if(stagedTargets.has(target))throw new Error('staged-transaction-in-progress');
    const token={label:String(options.label||'staged-transaction'),abort:null},steps=executeSteps(target,options,token);let done=false,result=null,error=null,stage='start',count=0;
    const advance=resume=>{
      if(done)return;stagedTargets.set(target,token);
      try{const step=resume();count++;if(step.done){done=true;result=step.value;}else stage=String(step.value||'apply');}
      catch(caught){done=true;error=caught;}
      finally{if(done&&stagedTargets.get(target)===token)stagedTargets.delete(target);}
    };
    const abort=(reason='staged-transaction-aborted')=>{if(done)return false;const failure=new Error(String(reason));failure.code='TRANSACTION_STAGED_ABORTED';advance(()=>steps.throw(failure));return true;};
    token.abort=abort;advance(()=>steps.next());
    return {
      label:token.label,
      get done(){return done;},get result(){return result;},get error(){return error;},get stage(){return stage;},get steps(){return count;},
      // Runs steps until the iterator finishes or the deadline passes (at least one step per call).
      step(deadline=-Infinity){while(!done){advance(()=>steps.next());if(done||runtimeClock()>=deadline)break;}return done;},
      abort
    };
  }
  function* executeSteps(target,options,stageToken){
    if(!target||typeof target!=='object'||Array.isArray(target))throw new TypeError('Transaction target must be an object');
    if(typeof options.apply!=='function')throw new TypeError('Transaction apply callback is required');
    if(activeContext)throw new Error('Nested state transactions are forbidden; domain commands must join their owner');
    if(stagedTargets.has(target)&&stagedTargets.get(target)!==stageToken)throw new Error('staged-transaction-in-progress');
    const durableContext=globalThis.__GH_DURABLE_COMMAND_CONTEXT__;
    if(durableContext&&target===durableContext.liveState)throw new Error('durable-live-state-transaction-blocked');
    const durableJournalBaseline=journaledRevisionSnapshot(target,durableContext);
    const label=String(options.label||'transaction'),scope=normalizeScope(options.scope),declaredWriteRoots=normalizeWriteRoots(options.writeRoots),writerContracts=normalizeWriterContracts(options.writerContracts),auditWrites=options.auditWrites===true||options.enforceWriteRoots===true,totalStart=runtimeClock(),requestedJournal=options.rollbackMode==='journal',profiled=options.profile===true||(options.profile!==false&&globalThis.GH_DIAGNOSTICS?.recorderIsActive?.(target)===true),phaseBreakdown=profiled?[]:null;
    let fallbackReason=journalAdmissionReason(options,scope,writerContracts),rollbackStorage='legacy-scoped',snapshot=null,journal=null;
    const rowPolicies=scope&&options.rowRoots&&typeof options.rowRoots==='object'&&!Array.isArray(options.rowRoots)?options.rowRoots:null;
    let phaseDepth=0;
    const measure=(name,work)=>{
      if(typeof work!=='function')throw new TypeError('Profile phase callback is required');
      if(!profiled)return work();
      const depth=phaseDepth++,started=runtimeClock();let ok=false;
      try{const value=work();ok=true;return value;}
      finally{phaseBreakdown.push({name:String((typeof name==='function'?name():name)||'unnamed').slice(0,100),durationMs:Math.max(0,runtimeClock()-started),depth,ok});if(phaseBreakdown.length>64)phaseBreakdown.shift();phaseDepth--;}
    };
    const derivedProfileContext=profiled?{kind:label.startsWith('simulation:')?'simulation-slice':label.startsWith('boundary-recovery:')?'boundary-recovery':'state-transaction',assetCount:globalThis.GH_FLEET_DATA?.size?.(target)??(Array.isArray(target.assets)?target.assets.length:null),invoiceCount:Array.isArray(target.finance?.invoices)?target.finance.invoices.length:null,receivableCount:Array.isArray(target.finance?.receivables)?target.finance.receivables.length:null,payableCount:Array.isArray(target.finance?.payables)?target.finance.payables.length:null}:null;
    const timing={label,profiled,profileContext:profiled?compactProfileContext(options.profileContext||derivedProfileContext):null,phaseBreakdown,scopeSize:scope?scope.length:null,fullSnapshot:false,fullSnapshotFallback:false,fallbackReason:null,rollbackStorage:null,journalRecords:0,snapshotMs:0,validateMs:0,applyMs:0,postCommitCriticalMs:0,postCommitNonCriticalMs:0,postCommitCriticalTasks:[],postCommitNonCriticalTasks:[],writeAudit:auditWrites?{enabled:true,declaredRoots:declaredWriteRoots?[...declaredWriteRoots]:null,mutatedRoots:[],undeclaredRoots:[],declaredButUnchanged:[],stage:'pending'}:null,error:null,rollbackFailures:[],rollbackMs:0,totalMs:0,committed:false,stage:'snapshot'};
    // A durable command runs on a private deep-cloned draft that is discarded whole when anything
    // fails; live state is only replaced after schema/integrity/storage succeed. A second full-state
    // snapshot of that draft therefore protects nothing. This is honored ONLY when the target is
    // exactly the active durable draft; any failure poisons the command so the draft cannot publish.
    const discardableDraft=options.discardableDraft===true&&!!globalThis.__GH_DURABLE_COMMAND_CONTEXT__&&globalThis.__GH_DURABLE_COMMAND_CONTEXT__.draft===target&&!requestedJournal&&!scope;
    // Build 358: a staged transaction that captures the whole state (stagedFullScope) also captures its declared scope
    // one root per step, before it writes, instead of all at once in its first frame (the daily close: 36-45 ms on iPhone).
    const deferredScope=stageToken&&options.stagedFullScope===true&&scope&&!requestedJournal&&!discardableDraft?scope:null;
    const snapshotStart=runtimeClock();
    if(discardableDraft){rollbackStorage='discardable-draft';}
    else if(requestedJournal&&!fallbackReason){
      const captured=captureJournal(target,scope,writerContracts);
      if(captured.ok){journal=captured;rollbackStorage='journal';timing.journalRecords=captured.records;}
      else fallbackReason=captured.reason;
    }
    if(discardableDraft){/* no snapshot by design */}
    else if(requestedJournal&&fallbackReason){snapshot=deepClone(target,SNAPSHOT_OPTIONS);rollbackStorage='full-snapshot';}
    else if(!requestedJournal){snapshot=scope?captureScoped(target,deferredScope?[]:scope,rowPolicies):deepClone(target,SNAPSHOT_OPTIONS);rollbackStorage=scope?'legacy-scoped':'full-snapshot';}
    timing.snapshotMs=Math.max(0,runtimeClock()-snapshotStart);timing.rollbackStorage=rollbackStorage;timing.fullSnapshot=rollbackStorage==='full-snapshot';timing.fullSnapshotFallback=requestedJournal&&rollbackStorage==='full-snapshot';timing.fallbackReason=timing.fullSnapshotFallback?fallbackReason:null;
    // Write auditing is an architecture-development proof tool. Full transactions reuse
    // their rollback snapshot; scoped/journal transactions take an extra full baseline only when
    // audit/enforcement is explicitly requested. Normal gameplay pays no audit cost.
    const auditBaseline=auditWrites?((rollbackStorage==='full-snapshot')?snapshot:deepClone(target)):null;
    const journaledRootValues={};for(const key of JOURNALED_ROOTS.keys())if(Object.prototype.hasOwnProperty.call(target,key))journaledRootValues[key]=target[key];
    const context={target,label,scope:rollbackStorage==='legacy-scoped'?(deferredScope?[]:scope):null,snapshot,journal,rootOrder:Object.keys(target),journaledRootValues,postCommit:[],memo:new Map(),failure:null,auditBaseline,declaredWriteRoots,writerContracts,rollbackStorage,timing,measure,irreversiblePriority:null,undos:[],scopedJoin:rollbackStorage==='legacy-scoped'&&options.scopedJoin===true,rowEntries:null};
    if(rowPolicies)timing.rowRoots=Object.keys(rowPolicies).filter(key=>context.snapshot?.[key]?.rows);
    // Writer-owned undo (Build 353): a writer may keep its own exact preimage for writes it deliberately leaves
    // outside `scope` (the simulation slice keeps the previous asset field values instead of deep-cloning the
    // fleet). It always runs after the snapshot restore, so it also holds after a scoped -> full promotion.
    const undo=typeof options.undo==='function'?options.undo:null;
    const restore=()=>{if(context.rollbackStorage==='discardable-draft'){const durable=globalThis.__GH_DURABLE_COMMAND_CONTEXT__;if(durable&&durable.draft===target)durable.poisoned=true;return target;}if(context.rollbackStorage==='journal')return restoreJournal(target,context.journal,context.rootOrder);if(context.scope){restoreScoped(target,context.snapshot,context.scope,context.journaledRootValues);if(context.fullCoverage){const known=new Set(context.rootOrder);for(const key of Object.keys(target))if(!known.has(key)&&!JOURNALED_ROOTS.has(key))delete target[key];}return restoreRootOrder(target,context.rootOrder);}const restored=restoreObject(target,context.snapshot,context.journaledRootValues);if(context.rowEntries)for(const [key,entry] of Object.entries(context.rowEntries))restoreEntry(target,key,entry);return restored;};
    const releaseUndos=()=>{const rows=context.undos.splice(0);for(const row of rows)row.release?.();};
    // Rollback is best-effort across every independent owner. A snapshot restore failure must not strand a fleet/store
    // journal or another registered undo in its open state; run all of them, retain every failure, then fail closed.
    const rollback=()=>{
      let restored=target;const failures=[],attempt=(component,work)=>{try{const value=work();if(value!==undefined)restored=value;}catch(error){failures.push({component,error});}};
      attempt('snapshot-restore',restore);if(undo)attempt('transaction-owner-undo',undo);
      const rows=context.undos.splice(0);for(let i=rows.length-1;i>=0;i--)attempt(`registered-undo:${i}`,()=>rows[i].undo());
      if(failures.length){const rollbackError=new Error(`transaction-rollback-components-failed:${failures.map(row=>row.component).join(',')}`);rollbackError.code='TRANSACTION_ROLLBACK_COMPONENTS_FAILED';rollbackError.failures=failures;rollbackError.cause=failures[0].error;throw rollbackError;}
      return restored;
    };
    let phase='validate';activeContext=context;
    try{
      const validateStart=runtimeClock();let validation;
      try{validation=typeof options.validate==='function'?options.validate(measure):true;}
      finally{timing.validateMs=Math.max(0,runtimeClock()-validateStart);timing.stage='validate';}
      if(validation===false||validation?.ok===false){const rollbackStart=runtimeClock();rollback();timing.rollbackMs=Math.max(0,runtimeClock()-rollbackStart);timing.totalMs=Math.max(0,runtimeClock()-totalStart);timing.stage='validation-rejected';publishRuntimeMetric(timing);return {committed:false,reason:validation?.reason||'validation-rejected',label};}
      // Staged: the snapshot frame ends here, before any write.
      if(stageToken){activeContext=null;yield 'snapshot';if(activeContext)throw new Error('staged-transaction-resumed-inside-transaction');activeContext=context;}
      // Build 358: a staged scoped transaction may capture every other root before it writes (stagedFullScope), one root
      // per step across frames. Its scope then covers the whole state, so a joined writer needs no full-state copy in the
      // middle of the work (the daily close joins system commands; that copy was 17-21 ms on iPhone with a 25 MB state).
      // The declared scope (deferred above) comes first, with its row-level policies; a root joins the scope only once
      // captured, so a rollback in the middle of capturing restores exactly the roots captured so far.
      if(stageToken&&options.stagedFullScope===true&&context.rollbackStorage==='legacy-scoped'&&context.scope){
        const known=new Set(context.scope),declared=new Set(deferredScope||[]);
        for(const key of deferredScope?[...deferredScope,...context.rootOrder]:context.rootOrder){
          if(known.has(key)||JOURNALED_ROOTS.has(key))continue;
          const start=runtimeClock();context.snapshot[key]=captureEntry(target,key,declared.has(key)?rowPolicies?.[key]||null:null);context.scope.push(key);known.add(key);if(context.declaredWriteRoots&&!context.declaredWriteRoots.includes(key))context.declaredWriteRoots.push(key);
          timing.snapshotMs+=Math.max(0,runtimeClock()-start);timing.scopeSize=context.scope.length;
          activeContext=null;yield 'snapshot';if(activeContext)throw new Error('staged-transaction-resumed-inside-transaction');activeContext=context;
        }
        if(rowPolicies)timing.rowRoots=Object.keys(rowPolicies).filter(key=>context.snapshot?.[key]?.rows);
        context.fullCoverage=true;context.scopedJoin=true;timing.stagedFullScope=true;
      }
      phase='commit';const applyStart=runtimeClock();let value;
      try{value=options.apply(measure);}
      finally{timing.applyMs=Math.max(0,runtimeClock()-applyStart);timing.stage='commit';}
      if(stageToken){
        // Staged apply: each iterator step runs inside this transaction; between steps nothing is active.
        if(!value||typeof value.next!=='function')throw new TypeError('Staged transaction apply must return an iterator');
        const iterator=value;timing.staged=true;timing.stagedSteps=0;
        for(;;){
          const stepStart=runtimeClock();let step;
          try{step=iterator.next();}finally{timing.applyMs+=Math.max(0,runtimeClock()-stepStart);}
          timing.stagedSteps++;if(context.failure)throw context.failure;
          if(step.done){value=step.value;break;}
          activeContext=null;yield step.value||'apply';
          if(activeContext)throw new Error('staged-transaction-resumed-inside-transaction');activeContext=context;
        }
      }
      if(value?.then)throw new Error('Asynchronous state mutation requires an explicit lifecycle');
      if(context.failure)throw context.failure;
      if(context.rollbackStorage==='journal'){
        const postApply=validateJournalPostState(target,context.journal);if(!postApply.ok){const error=new Error(`transaction-journal-contract-violation:${postApply.reason}`);error.code='TRANSACTION_JOURNAL_CONTRACT_VIOLATION';throw error;}
      }
      activeContext=null;
      if(stageToken)yield 'post-commit';
      phase='post-commit-critical';
      const criticalTasks=context.postCommit.filter(x=>x.critical).sort((a,b)=>a.priority-b.priority),reversibleCritical=criticalTasks.filter(task=>!task.irreversible),irreversibleCritical=criticalTasks.filter(task=>task.irreversible);
      // A task's duration counts only its own work, not the frames a staged task waits between its sections.
      const runCriticalTask=function*(task,staged){
        const row={key:task.key||null,owner:task.owner||null,priority:task.priority,durationMs:0,ok:false,irreversible:task.irreversible===true};let active=0,at=runtimeClock();
        try{
          const out=task.fn();active+=runtimeClock()-at;
          if(isStepIterator(out))for(;;){at=runtimeClock();let section;try{section=out.next();}finally{active+=runtimeClock()-at;}if(section.done)break;if(staged)yield typeof section.value==='string'&&section.value?`post-commit:${section.value.slice(0,40)}`:'post-commit';}
          row.ok=true;
        }finally{row.durationMs=Math.max(0,active);timing.postCommitCriticalTasks.push(row);}
      };
      const runCritical=tasks=>{for(const task of tasks)drainSteps(runCriticalTask(task,false));};
      let criticalActiveMs=0,criticalStart=runtimeClock();try{
        // Staged: one reversible critical task per step, and one section per step of a task that returns sections (no
        // transaction is active during post-commit either way).
        if(stageToken){for(let i=0;i<reversibleCritical.length;i++){const task=runCriticalTask(reversibleCritical[i],true);for(;;){const at=runtimeClock();let section;try{section=task.next();}finally{criticalActiveMs+=runtimeClock()-at;}if(section.done)break;yield section.value;}if(i<reversibleCritical.length-1)yield 'post-commit';}criticalStart=runtimeClock();}
        else runCritical(reversibleCritical);
        if(context.rollbackStorage==='journal'){
          const postCritical=validateJournalPostState(target,context.journal);if(!postCritical.ok){const error=new Error(`transaction-journal-contract-violation:${postCritical.reason}`);error.code='TRANSACTION_JOURNAL_CONTRACT_VIOLATION';throw error;}
        }
        if(auditWrites){
          const mutatedRoots=diffRootKeys(target,auditBaseline),declared=declaredWriteRoots?new Set(declaredWriteRoots):null,undeclared=declared?mutatedRoots.filter(key=>!declared.has(key)):[],unchanged=declaredWriteRoots?declaredWriteRoots.filter(key=>!mutatedRoots.includes(key)):[];
          timing.writeAudit={enabled:true,declaredRoots:declaredWriteRoots?[...declaredWriteRoots]:null,mutatedRoots,undeclaredRoots:undeclared,declaredButUnchanged:unchanged,stage:'pre-irreversible'};
          if(options.enforceWriteRoots===true&&undeclared.length){const error=new Error(`transaction-write-set-violation:${undeclared.join(',')}`);error.code='TRANSACTION_WRITE_SET_VIOLATION';error.undeclaredRoots=undeclared;throw error;}
        }
        phase='post-commit-irreversible';runCritical(irreversibleCritical);
      }finally{timing.postCommitCriticalMs=Math.max(0,criticalActiveMs+runtimeClock()-criticalStart);}
      releaseUndos();
      const nonCriticalStart=runtimeClock();for(const task of context.postCommit.filter(x=>!x.critical)){const taskStart=runtimeClock(),row={key:task.key||null,owner:task.owner||null,priority:task.priority,durationMs:0,ok:false};try{task.fn();row.ok=true;}catch(error){row.error=String(error?.message||error).slice(0,240);globalThis.console?.warn?.(`${label}: non-critical post-commit side effect failed`,error);}finally{row.durationMs=Math.max(0,runtimeClock()-taskStart);timing.postCommitNonCriticalTasks.push(row);}}timing.postCommitNonCriticalMs=Math.max(0,runtimeClock()-nonCriticalStart);
      advanceRevision(target);timing.committed=true;timing.stage='committed';timing.totalMs=Math.max(0,runtimeClock()-totalStart);publishRuntimeMetric(timing);
      return {committed:true,value,label,scope:context.scope?[...context.scope]:null};
    }catch(error){
      activeContext=null;context.postCommit.length=0;
      timing.error=compactError(error);
      if(auditWrites&&timing.writeAudit?.stage==='pending'){const mutatedRoots=diffRootKeys(target,auditBaseline),declared=declaredWriteRoots?new Set(declaredWriteRoots):null;timing.writeAudit={enabled:true,declaredRoots:declaredWriteRoots?[...declaredWriteRoots]:null,mutatedRoots,undeclaredRoots:declared?mutatedRoots.filter(key=>!declared.has(key)):[],declaredButUnchanged:declaredWriteRoots?declaredWriteRoots.filter(key=>!mutatedRoots.includes(key)):[],stage:'failure-before-rollback'};}
      const rollbackStart=runtimeClock();
      try{rollback();timing.rollbackMs=Math.max(0,runtimeClock()-rollbackStart);}catch(restoreError){timing.rollbackMs=Math.max(0,runtimeClock()-rollbackStart);timing.rollbackFailures=(restoreError.failures||[{component:'rollback',error:restoreError}]).map(row=>({component:String(row.component||'rollback'),error:compactError(row.error)}));timing.stage='rollback-failed';timing.totalMs=Math.max(0,runtimeClock()-totalStart);publishRuntimeMetric(timing);const fatal=new Error(`${label}: rollback failed`);fatal.code='TRANSACTION_ROLLBACK_FAILED';fatal.cause=error;fatal.rollbackError=restoreError;fatal.transactionLabel=label;fatal.transactionStage='rollback';fatal.diagnostic=compactError(fatal);throw fatal;}
      const unisolatedRoots=changedJournaledRevisions(target,durableJournalBaseline);
      if(unisolatedRoots.length){const durable=durableJournalBaseline.durableContext;durable.poisoned=true;durable.poisonReason=`durable-journaled-root-write-failed:${unisolatedRoots.join(',')}`;const guarded=new Error(durable.poisonReason);guarded.cause=error;guarded.transactionLabel=label;guarded.transactionStage='durable-root-guard';timing.stage='durable-root-guard';timing.totalMs=Math.max(0,runtimeClock()-totalStart);publishRuntimeMetric(timing);throw guarded;}
      timing.stage=phase;timing.totalMs=Math.max(0,runtimeClock()-totalStart);publishRuntimeMetric(timing);error.transactionLabel=label;error.transactionStage=phase;error.diagnostic=compactError(error);throw error;
    }finally{activeContext=null;}
  }
  function resetProfileTelemetry(){runtimeTelemetry.profiledSamples.length=0;runtimeTelemetry.profiledCount=0;runtimeTelemetry.lastSimulation=null;return true;}
  function telemetrySnapshot(){const out=deepClone(runtimeTelemetry);if(activeContext)out.active={label:activeContext.label,rollbackStorage:activeContext.rollbackStorage,fullSnapshot:activeContext.rollbackStorage==='full-snapshot',fallbackReason:activeContext.timing?.fallbackReason||null,journalRecords:activeContext.timing?.journalRecords||0,profiled:activeContext.timing?.profiled===true,phaseBreakdown:activeContext.timing?.phaseBreakdown?deepClone(activeContext.timing.phaseBreakdown):null};return out;}
  function rejection(reason,label,stage='validate'){const error=new Error(reason);error.transactionLabel=label;error.transactionStage=stage;return error;}
  function criticalIds(result){return new Set((((result?.critical)||((result?.issues)||[]).filter(row=>row.severity==='critical'))||[]).map(row=>String(row.id||row.code||row.title)));}
  async function executeDurable(liveState,options={}){
    if(!liveState||typeof liveState!=='object'||Array.isArray(liveState))throw new TypeError('Durable transaction target must be an object');
    if(typeof options.apply!=='function')throw new TypeError('Durable transaction apply callback is required');
    if(activeContext)throw new Error('Durable transaction cannot start inside a synchronous transaction');
    if(durableTargets.has(liveState))throw new Error('durable-transaction-in-progress');
    if(stagedTargets.has(liveState))throw new Error('staged-transaction-in-progress');
    if(globalThis.__GH_DURABLE_COMMAND_CONTEXT__)throw new Error('durable-command-context-in-progress');
    const label=String(options.label||'durable-transaction'),actualRevision=Math.max(0,Math.floor(Number(liveState.saveRevision)||0)),expectedRevision=options.expectedRevision==null?actualRevision:Number(options.expectedRevision);
    if(!Number.isSafeInteger(expectedRevision)||expectedRevision<0)throw rejection('invalid-expected-save-revision',label,'admission');
    if(actualRevision!==expectedRevision)throw rejection(`state-revision-conflict:${expectedRevision}:${actualRevision}`,label,'admission');
    // Build 358: phase timings of every durable command (diagnostics: telemetry().lastDurable / durableSamples).
    const durableStart=runtimeClock(),durableTiming={label,cloneMs:0,inheritMs:0,baselineIntegrityMs:0,applyMs:0,validateMs:0,integrityMs:0,persistMs:0,publishMs:0,afterMs:0,totalMs:0,committed:false};let mark=durableStart;const lap=key=>{const now=runtimeClock();durableTiming[key]+=Math.max(0,now-mark);mark=now;};
    const transactionId=String(options.transactionId||`DTX-${String(++durableSequence).padStart(9,'0')}`),rootSessions=beginJournaledRoots(liveState);let draft;
    try{draft=deepClone(liveState,{shareJournaledRoots:true});}catch(error){rollbackJournaledRoots(rootSessions);throw error;}
    lap('cloneMs');
    // Build 358: the draft's trusted validation below must not re-verify every proof the live state already verified.
    try{globalThis.GH_SAVE_SCHEMA?.inheritVerified?.(liveState,draft);}catch(_error){/* trust is an optimisation */}
    lap('inheritMs');
    const priorCritical=criticalIds(globalThis.GH_INTEGRITY_CORE?.check?.(liveState)),afterPublishTasks=[];lap('baselineIntegrityMs');
    const context={schema:'gh-durable-transaction-v1',transactionId,label,liveState,draft,expectedRevision,startedAtSim:Number(liveState.simSeconds)||0,afterPublish(fn){if(typeof fn==='function')afterPublishTasks.push(fn);},call(domain,name,payload={},commandOptions={}){const commands=globalThis.GH_DOMAIN_COMMANDS;if(!commands?.dispatch)throw new Error('domain-command-owner-unavailable');return commands.dispatch({state:draft},domain,name,payload,commandOptions);},callSystem(domain,name,payload={},commandOptions={}){const commands=globalThis.GH_DOMAIN_COMMANDS;if(!commands?.dispatchSystem)throw new Error('system-domain-command-owner-unavailable');return commands.dispatchSystem({state:draft},domain,name,payload,commandOptions);}};
    durableTargets.add(liveState);globalThis.__GH_DURABLE_COMMAND_CONTEXT__=context;let phase='apply',durableCommitted=false;
    try{
      mark=runtimeClock();const value=await options.apply(draft,context);lap('applyMs');if(value===false)throw rejection(`${label}-rejected`,label,phase);
      if(context.poisoned)throw rejection(context.poisonReason||'durable-command-poisoned',label,phase);
      if(Number(draft.saveRevision||0)!==expectedRevision)throw rejection('draft-save-revision-mutated',label,phase);
      draft.saveRevision=expectedRevision+1;phase='validate';
      mark=runtimeClock();const schema=globalThis.GH_SAVE_SCHEMA?.validate?.(draft,{trustVerified:true});lap('validateMs');if(schema&&schema.ok===false)throw rejection(`invalid-draft:${(schema.errors||[]).join(',')}`,label,phase);
      if(options.integrity!==false&&globalThis.GH_INTEGRITY_CORE?.check){const integrity=globalThis.GH_INTEGRITY_CORE.check(draft),introduced=(((integrity?.critical)||((integrity?.issues)||[]).filter(row=>row.severity==='critical'))||[]).filter(row=>!priorCritical.has(String(row.id||row.code||row.title)));if(introduced.length)throw rejection(`critical-integrity:${introduced.map(row=>row.id||row.code||row.title).join(',')}`,label,phase);}
      if(typeof options.validate==='function'){const validation=await options.validate(draft,context);if(validation===false||validation?.ok===false)throw rejection(validation?.reason||'validation-rejected',label,phase);}
      lap('integrityMs');
      if(Number(liveState.saveRevision||0)!==expectedRevision)throw rejection(`state-revision-conflict:${expectedRevision}:${Number(liveState.saveRevision)||0}`,label,'pre-persist');
      phase='durable-commit';const persist=options.persist||((state,meta)=>{const owner=globalThis.GH_PERSISTENCE;if(!owner?.commitDurableState)throw new Error('durable-persistence-owner-unavailable');return owner.commitDurableState(state,meta);}),persisted=await persist(draft,{...(options.persistence||{}),expectedPreviousRevision:expectedRevision,transactionId,idempotencyKey:options.idempotencyKey||null,prevalidated:true});if(persisted===false||persisted?.ok===false)throw rejection(persisted?.reason||'durable-persistence-rejected',label,phase);durableCommitted=true;commitJournaledRoots(rootSessions);
      lap('persistMs');
      phase='publish';if(typeof options.publish==='function')await options.publish(liveState,draft,context);else restoreObject(liveState,draft);lap('publishMs');
      for(const task of afterPublishTasks)try{await task(value,context);}catch(error){globalThis.console?.warn?.(`${label}: after-publish side effect failed`,error);}
      if(typeof options.afterCommit==='function')try{await options.afterCommit(value,context);}catch(error){globalThis.console?.warn?.(`${label}: after-commit side effect failed`,error);}
      lap('afterMs');durableTiming.committed=true;durableTiming.totalMs=Math.max(0,runtimeClock()-durableStart);publishDurableMetric(durableTiming);
      advanceRevision(liveState);return {committed:true,durable:true,transactionId,label,saveRevision:Number(liveState.saveRevision)||0,value,persistence:persisted};
    }catch(error){
      durableTiming.totalMs=Math.max(0,runtimeClock()-durableStart);durableTiming.stage=phase;publishDurableMetric(durableTiming);
      error.transactionLabel=error.transactionLabel||label;error.transactionStage=error.transactionStage||phase;error.durableCommitted=durableCommitted;
      if(!durableCommitted)try{rollbackJournaledRoots(rootSessions);}catch(rollbackError){error.rollbackError=rollbackError;error.critical=true;globalThis.GH_PERSISTENCE?.markRecoveryRequired?.('durable-journaled-root-rollback-failed');}
      if(durableCommitted){error.critical=true;globalThis.GH_PERSISTENCE?.markRecoveryRequired?.('durable-publish-failed');}
      throw error;
    }finally{if(!durableCommitted&&rootSessions.length)try{rollbackJournaledRoots(rootSessions);}catch{}if(globalThis.__GH_DURABLE_COMMAND_CONTEXT__===context)delete globalThis.__GH_DURABLE_COMMAND_CONTEXT__;durableTargets.delete(liveState);}
  }
  const API=Object.freeze({VERSION,deepClone,restoreObject,beginStaged,isStaged:target=>target?stagedTargets.has(target):stagedTargets.size>0,abortStaged:(target,reason)=>stagedTargets.get(target)?.abort?.(reason)===true,registerJournaledRoot,registerSealedCollections,registerSealedRoot,isSealed,sealCollections,deriveContainer,containerChanges,beginJournaledRoots,commitJournaledRoots,rollbackJournaledRoots,execute,join,extendScope,executeDurable,isActive,registerUndo,isDurableActive:target=>target?durableTargets.has(target):!!globalThis.__GH_DURABLE_COMMAND_CONTEXT__,revision,afterCommit,transactionMemo,transactionMemoGet,transactionMemoSet,resetProfileTelemetry,telemetry:telemetrySnapshot});globalThis.GH_TRANSACTION_CORE=API;if(globalThis.window&&globalThis.window!==globalThis)globalThis.window.GH_TRANSACTION_CORE=API;if(typeof module!=='undefined'&&module.exports)module.exports=API;
})();

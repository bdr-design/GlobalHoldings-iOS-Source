// Fleet data access (Build 355): the one API through which every owner reads
// or writes the fleet. A state holds either the legacy `assets` array (Save
// Schema 2) or the columnar `fleet` store (Fleet Core v4); callers never touch
// either directly.
//
// Reads return read-only views. A view (and every object or array inside it)
// rejects assignment, deletion and property definition, so no caller can
// mutate the fleet by accident — in the store, nested values are shared by a
// whole purchase batch. Views support property reads, `in`, Object.keys,
// spread, JSON.stringify and array methods; use plain() for a mutable deep
// copy. Changes go through update/put/add/remove, which the store journals for
// transaction rollback.
//
// Store views present an asset at the current simulation time: progress,
// fuel, condition and dwell are derived from the row checkpoint, with the
// defaults the slice engine writes on its first slice — exactly what the
// legacy array holds after its last slice. A store write first brings the row
// checkpoint to the current time, then applies the change.
(()=>{
  'use strict';
  const VERSION='1.0.0';
  const STORE=globalThis.GH_FLEET_STORE||(typeof require==='function'?require('./fleet-store-core.js'):null);
  if(!STORE)throw new Error('Fleet data access requires the Fleet Store core');
  function events(){
    const api=globalThis.GH_FLEET_EVENTS||(typeof require==='function'?require('./fleet-event-core.js'):null);
    if(!api)throw new Error('fleet-event-core-unavailable');return api;
  }
  const own=(value,key)=>Object.prototype.hasOwnProperty.call(value,key);
  const isObject=value=>value!==null&&typeof value==='object';
  const jsonCopy=value=>value===undefined?undefined:JSON.parse(JSON.stringify(value));
  // Array-mode writes keep the legacy in-memory values (undefined, NaN, -0);
  // a value holding a read-only view can only be copied through JSON.
  const copyValue=value=>{if(!isObject(value))return value;if(globalThis.structuredClone)try{return structuredClone(value);}catch(_error){}return jsonCopy(value);};
  const DERIVED_KEYS=Object.freeze(['phase','progress','fuel','condition','simCarrySeconds','dwellRemaining']),DERIVED_SET=new Set(DERIVED_KEYS);
  let configuredRouteResolver=null;
  function configure({resolveRoute}={}){configuredRouteResolver=typeof resolveRoute==='function'?resolveRoute:null;}

  // ------------------------------------------------------------ views ---
  function readOnly(){throw new TypeError('fleet-view-read-only');}
  const nestedViews=new WeakMap(),nestedTargets=new WeakMap();
  const NESTED={
    get(target,key){const value=target[key];return isObject(value)?nested(value):value;},
    getOwnPropertyDescriptor(target,key){const descriptor=Reflect.getOwnPropertyDescriptor(target,key);if(descriptor&&descriptor.configurable&&own(descriptor,'value')&&isObject(descriptor.value))descriptor.value=nested(descriptor.value);return descriptor;},
    set:readOnly,defineProperty:readOnly,deleteProperty:readOnly,setPrototypeOf:readOnly,preventExtensions:readOnly
  };
  // Frozen values cannot be wrapped (proxy invariants) and cannot be mutated.
  function nested(value){
    if(nestedTargets.has(value)||Object.isFrozen(value))return value;
    let view=nestedViews.get(value);if(!view){view=new Proxy(value,NESTED);nestedViews.set(value,view);nestedTargets.set(view,value);}
    return view;
  }
  const META=Symbol('fleet-store-view');
  const MISSING=Symbol('fleet-field-missing');
  const STORE_VIEW={
    get(meta,key){
      if(key===META)return meta;
      if(typeof key!=='string')return undefined;
      const value=fieldOf(meta,key);
      if(value===MISSING)return Object.prototype[key];
      return isObject(value)?nested(value):value;
    },
    has(meta,key){return typeof key==='string'&&(fieldOf(meta,key)!==MISSING||key in Object.prototype);},
    ownKeys(meta){return keysOf(meta).slice();},
    getOwnPropertyDescriptor(meta,key){
      if(typeof key!=='string')return undefined;
      const value=fieldOf(meta,key);if(value===MISSING)return undefined;
      return {value:isObject(value)?nested(value):value,writable:true,enumerable:true,configurable:true};
    },
    set:readOnly,defineProperty:readOnly,deleteProperty:readOnly,setPrototypeOf:readOnly,preventExtensions:readOnly
  };
  function storeView(state,store,index){
    const meta={state,store,index,id:STORE.idAt(store,index),structure:store.structure,derived:null,dIndex:-1,dRevision:-1,dTime:-1,keys:null,kIndex:-1,kRevision:-1,kTime:-1};
    return new Proxy(meta,STORE_VIEW);
  }
  // A view survives structural changes by re-resolving its id.
  function rowOf(meta){
    const store=meta.store;
    if(meta.structure!==store.structure){meta.index=meta.id===undefined?-1:STORE.indexOf(store,meta.id);meta.structure=store.structure;}
    return meta.index<store.length?meta.index:-1;
  }
  function timeOf(state){return Math.max(0,Number(state?.simSeconds)||0);}
  function derivedOf(meta,index){
    const revision=meta.store.revision,t=timeOf(meta.state);
    if(meta.dIndex!==index||meta.dRevision!==revision||meta.dTime!==t){meta.derived=deriveRow(meta.store,index,t);meta.dIndex=index;meta.dRevision=revision;meta.dTime=t;}
    return meta.derived;
  }
  // The six presentable fields of currentAsset (fleet-event-core), without
  // materializing the row: slice-engine defaults, then linear derivation from
  // the checkpoint. null for a faulted asset (presented exactly as stored).
  // Rows whose hot fields all live in typed columns are read directly.
  const HOT_SET=new Set(STORE.HOT_FIELDS.map(([name])=>name)),BIT=Object.fromEntries(STORE.HOT_FIELDS.map(([name],bit)=>[name,1<<bit]));
  const scratch={phase:null,routeId:null,progress:0,fuel:0,condition:0,dwellRemaining:undefined,type:undefined};
  function hotInExtras(extras){for(const key in extras)if(HOT_SET.has(key))return true;return false;}
  function deriveRow(store,index,t){
    const c=store.columns,extras=c.extra[index]===1?store.extras[index]:null;
    if(extras&&hotInExtras(extras))return deriveRowGeneric(store,index,t);
    if(extras&&extras.simulationFault)return null;
    const p=c.present[index],V=store.values,ref=column=>column[index]===0?null:V[column[index]];
    const routeId=(p&BIT.routeId)?ref(c.routeId):undefined,phase=(p&BIT.phase)?ref(c.phase):undefined,out={};
    out.phase=phase?phase:(routeId?'moving':'idle');
    out.progress=(p&BIT.progress)?c.progress[index]:0;
    out.fuel=(p&BIT.fuel)?c.fuel[index]:100;
    out.condition=(p&BIT.condition)?c.condition[index]:100;
    out.simCarrySeconds=(p&BIT.simCarrySeconds)?c.simCarrySeconds[index]:0;
    if(p&BIT.dwellRemaining)out.dwellRemaining=c.dwellRemaining[index];
    const at=c.at[index];
    if(t>at&&routeId&&out.phase!=='idle'){
      const binding=V[c.binding[index]],profile=V[c.profile[index]];
      const tripSeconds=Number((binding&&binding.tripSeconds)||(configuredRouteResolver?configuredRouteResolver(routeId,(p&BIT.baseFacility)?ref(c.baseFacility):undefined)?.tripSeconds:undefined));
      scratch.phase=out.phase;scratch.routeId=routeId;scratch.progress=out.progress;scratch.fuel=out.fuel;scratch.condition=out.condition;scratch.dwellRemaining=out.dwellRemaining;scratch.type=profile?profile.type:undefined;
      events().derive(scratch,at,t,tripSeconds);
      out.progress=scratch.progress;out.fuel=scratch.fuel;out.condition=scratch.condition;if(scratch.dwellRemaining!==undefined)out.dwellRemaining=scratch.dwellRemaining;
    }
    return out;
  }
  function deriveRowGeneric(store,index,t){
    const peek=field=>STORE.peek(store,index,field);
    if(peek('simulationFault'))return null;
    const routeId=peek('routeId'),out={};
    const phase=peek('phase'),progress=peek('progress'),fuel=peek('fuel'),condition=peek('condition');
    out.phase=phase?phase:(routeId?'moving':'idle');
    out.progress=typeof progress==='number'?progress:0;
    out.fuel=typeof fuel==='number'?fuel:100;
    out.condition=typeof condition==='number'?condition:100;
    const carry=peek('simCarrySeconds');out.simCarrySeconds=carry===undefined?0:carry;
    const dwell=peek('dwellRemaining');if(dwell!==undefined)out.dwellRemaining=dwell;
    const at=store.columns.at[index];
    if(t>at&&routeId&&out.phase!=='idle'){
      const tripSeconds=Number(peek('tripSeconds')||(configuredRouteResolver?configuredRouteResolver(routeId,peek('baseFacility'))?.tripSeconds:undefined));
      const asset={phase:out.phase,routeId,progress:out.progress,fuel:out.fuel,condition:out.condition,dwellRemaining:out.dwellRemaining,type:peek('type')};
      events().derive(asset,at,t,tripSeconds);
      out.progress=asset.progress;out.fuel=asset.fuel;out.condition=asset.condition;if(asset.dwellRemaining!==undefined)out.dwellRemaining=asset.dwellRemaining;
    }
    return out;
  }
  function fieldOf(meta,key){
    const index=rowOf(meta);if(index<0)return MISSING;
    if(DERIVED_SET.has(key)){const derived=derivedOf(meta,index);if(derived&&own(derived,key))return derived[key];}
    const value=STORE.peek(meta.store,index,key);
    return value===undefined?MISSING:value;
  }
  function keysOf(meta){
    const index=rowOf(meta);if(index<0)return [];
    const revision=meta.store.revision,t=timeOf(meta.state);
    if(meta.kIndex===index&&meta.kRevision===revision&&meta.kTime===t)return meta.keys;
    const keys=STORE.keys(meta.store,index),derived=derivedOf(meta,index);
    if(derived)for(const field of DERIVED_KEYS)if(own(derived,field)&&!keys.includes(field))keys.push(field);
    meta.keys=keys;meta.kIndex=index;meta.kRevision=revision;meta.kTime=t;return keys;
  }
  function isView(value){return isObject(value)&&(nestedTargets.has(value)||value[META]!==undefined)&&value[DRAFT]===undefined;}

  // ----------------------------------------------------------- drafts ---
  // Writable working copies for owners whose algorithm edits assets in place:
  // reads fall through to the asset (nested values stay read-only), top-level
  // writes and deletes collect in an overlay, and commit() applies every
  // overlay with update(). Drafts keep their identity for the whole algorithm.
  const DRAFT=Symbol('fleet-draft'),DELETED=Symbol('fleet-draft-deleted');
  const DRAFT_VIEW={
    get(draft,key){
      if(key===DRAFT)return draft;
      if(typeof key==='string'&&own(draft.overlay,key)){const value=draft.overlay[key];return value===DELETED?undefined:value;}
      return draft.view[key];
    },
    set(draft,key,value){if(typeof key!=='string')return readOnly();draft.overlay[key]=value;return true;},
    deleteProperty(draft,key){if(typeof key!=='string')return readOnly();draft.overlay[key]=DELETED;return true;},
    has(draft,key){if(typeof key==='string'&&own(draft.overlay,key))return draft.overlay[key]!==DELETED;return key in draft.view;},
    ownKeys(draft){
      const keys=Object.keys(draft.view).filter(key=>!own(draft.overlay,key)||draft.overlay[key]!==DELETED);
      for(const key of Object.keys(draft.overlay))if(draft.overlay[key]!==DELETED&&!keys.includes(key))keys.push(key);
      return keys;
    },
    getOwnPropertyDescriptor(draft,key){
      if(typeof key!=='string')return undefined;
      if(own(draft.overlay,key)){const value=draft.overlay[key];return value===DELETED?undefined:{value,writable:true,enumerable:true,configurable:true};}
      const descriptor=Reflect.getOwnPropertyDescriptor(draft.view,key);return descriptor?{value:descriptor.value,writable:true,enumerable:true,configurable:true}:undefined;
    },
    defineProperty:readOnly,setPrototypeOf:readOnly,preventExtensions:readOnly
  };
  function sameValue(a,b){if(Object.is(a,b))return true;if(!isObject(a)||!isObject(b))return false;try{return JSON.stringify(a)===JSON.stringify(b);}catch(_error){return false;}}
  function draftOf(view){return isObject(view)?new Proxy({view,overlay:Object.create(null)},DRAFT_VIEW):view;}
  function drafts(state){return map(state,view=>draftOf(view));}
  function draft(state,target){const index=indexOfTarget(state,target);return index<0?null:draftOf(viewAt(state,index));}
  // Apply the overlays of these drafts; returns how many assets changed.
  function commit(state,rows){
    let changed=0;
    for(const row of rows||[]){
      const meta=isObject(row)?row[DRAFT]:undefined;if(!meta)continue;
      const keys=Object.keys(meta.overlay);if(!keys.length)continue;
      // Only real changes are written: an algorithm that re-assigns the same
      // value (normalization passes) costs no store write and no journal entry.
      const patch={};let fields=0;
      for(const key of keys){
        const value=meta.overlay[key],next=value===DELETED?undefined:value,current=meta.view[key];
        if(next===undefined?(current===undefined&&!(key in meta.view)):sameValue(current,next))continue;
        patch[key]=next;fields++;
      }
      meta.overlay=Object.create(null);
      if(fields&&update(state,meta.view,patch))changed++;
    }
    return changed;
  }

  // ------------------------------------------------------- containers ---
  function storeOf(state){const fleet=state?.fleet;return STORE.isStore(fleet)?fleet:null;}
  function arrayOf(state){return Array.isArray(state?.assets)?state.assets:null;}
  function mode(state){return storeOf(state)?'store':arrayOf(state)?'array':'none';}
  // The container object, for identity-keyed caches.
  function source(state){return storeOf(state)||arrayOf(state)||null;}
  function ensure(state){if(!storeOf(state)&&!arrayOf(state))state.assets=[];return mode(state);}
  function size(state){const store=storeOf(state);if(store)return store.length;const assets=arrayOf(state);return assets?assets.length:0;}
  // Changes on any store write; null for the array (callers fall back to identity).
  function revision(state){const store=storeOf(state);return store?store.revision:null;}

  // Array-mode lookups are O(1) through a cached object/id index. A hit is
  // verified against the array; a miss rebuilds once when the array changed.
  const arrayIndexes=new WeakMap();
  function arrayIndex(assets){
    let index=arrayIndexes.get(assets);
    if(!index){index={byObject:new Map(),byId:new Map(),length:-1,dirty:true};arrayIndexes.set(assets,index);}
    if(index.dirty||index.length!==assets.length){
      index.byObject.clear();index.byId.clear();
      for(let i=0;i<assets.length;i++){const asset=assets[i];if(!isObject(asset))continue;if(!index.byObject.has(asset))index.byObject.set(asset,i);const id=asset.id;if(id!==undefined&&!index.byId.has(id))index.byId.set(id,i);}
      index.length=assets.length;index.dirty=false;
    }
    return index;
  }
  function invalidateArrayIndex(assets){const index=arrayIndexes.get(assets);if(index)index.dirty=true;}
  function arrayIndexOf(assets,map,key,matches){
    let index=arrayIndex(assets),i=index[map].get(key);
    if(i!==undefined&&matches(assets[i]))return i;
    if(i!==undefined){index.dirty=true;index=arrayIndex(assets);i=index[map].get(key);}
    return i!==undefined&&matches(assets[i])?i:-1;
  }
  function viewAt(state,index){
    const store=storeOf(state);if(store)return index>=0&&index<store.length?storeView(state,store,index):null;
    const assets=arrayOf(state),asset=assets?assets[index]:undefined;return isObject(asset)?nested(asset):(asset===undefined?null:asset);
  }
  function indexOfId(state,id){
    const store=storeOf(state);if(store)return STORE.indexOf(store,id);
    const assets=arrayOf(state);return assets?arrayIndexOf(assets,'byId',id,asset=>asset?.id===id):-1;
  }
  // A target is an id or a view returned by this API.
  function indexOfTarget(state,target){
    if(isObject(target)&&target[DRAFT])target=target[DRAFT].view;
    if(isObject(target)){
      // A view read from another state (e.g. the live state while writing a
      // command draft) resolves by id, exactly like an array view.
      const meta=target[META];if(meta)return meta.store===storeOf(state)?rowOf(meta):(meta.id===undefined?-1:indexOfId(state,meta.id));
      const live=nestedTargets.get(target)||target,assets=arrayOf(state);
      if(assets){const index=arrayIndexOf(assets,'byObject',live,asset=>asset===live);if(index>=0)return index;}
      return indexOfId(state,target.id);
    }
    return indexOfId(state,target);
  }

  // ------------------------------------------------------------ reads ---
  function get(state,id){const index=indexOfId(state,id);return index<0?null:viewAt(state,index);}
  function has(state,id){return indexOfId(state,id)>=0;}
  function forEach(state,fn){const n=size(state);for(let index=0;index<n;index++)fn(viewAt(state,index),index);}
  function some(state,predicate){const n=size(state);for(let index=0;index<n;index++)if(predicate(viewAt(state,index),index))return true;return false;}
  function every(state,predicate){const n=size(state);for(let index=0;index<n;index++)if(!predicate(viewAt(state,index),index))return false;return true;}
  function find(state,predicate){const n=size(state);for(let index=0;index<n;index++){const view=viewAt(state,index);if(predicate(view,index))return view;}return null;}
  function filter(state,predicate){const out=[],n=size(state);for(let index=0;index<n;index++){const view=viewAt(state,index);if(predicate(view,index))out.push(view);}return out;}
  function count(state,predicate){let total=0;const n=size(state);for(let index=0;index<n;index++)if(predicate(viewAt(state,index),index))total++;return total;}
  function sum(state,fn){let total=0;const n=size(state);for(let index=0;index<n;index++)total+=Number(fn(viewAt(state,index),index))||0;return total;}
  function map(state,fn){const n=size(state),out=new Array(n);for(let index=0;index<n;index++)out[index]=fn(viewAt(state,index),index);return out;}
  function list(state){return map(state,view=>view);}
  function ids(state){const store=storeOf(state);if(store){const out=new Array(store.length);for(let index=0;index<store.length;index++)out[index]=STORE.idAt(store,index);return out;}return (arrayOf(state)||[]).map(asset=>asset?.id);}
  function indexById(state){const out=new Map(),n=size(state);for(let index=0;index<n;index++){const view=viewAt(state,index),id=view?.id;if(id!==undefined&&!out.has(id))out.set(id,view);}return out;}
  // A mutable deep copy of a view (or of the asset with this id).
  function plain(stateOrView,id){
    if(arguments.length>1){const view=get(stateOrView,id);return view?plainOf(view):null;}
    return isObject(stateOrView)?plainOf(stateOrView):stateOrView;
  }
  // The mutable object an owner keeps for an asset leaving the fleet: the
  // legacy array's own object (exactly what the array held, no copy), or a
  // plain copy of a store row.
  function released(value){if(!isObject(value))return value;return nestedTargets.get(value)||plainOf(value);}
  function plainOf(value){
    const draftMeta=value[DRAFT];
    if(draftMeta){const out=plainOf(draftMeta.view);for(const key of Object.keys(draftMeta.overlay)){const next=draftMeta.overlay[key];if(next===DELETED)delete out[key];else out[key]=copyValue(next);}return out;}
    const live=nestedTargets.get(value);if(live)return copyValue(live);
    const meta=value[META];
    if(meta){
      const index=rowOf(meta);if(index<0)return {};
      const out=STORE.materialize(meta.store,index),derived=derivedOf(meta,index);
      if(derived)for(const field of DERIVED_KEYS)if(own(derived,field))out[field]=derived[field];
      return out;
    }
    return copyValue(value);
  }

  // ----------------------------------------------------------- writes ---
  // Bring a store row's checkpoint to the current time before any change.
  function checkpoint(state,store,index){
    const t=timeOf(state);if(store.columns.at[index]===t)return;
    const derived=deriveRow(store,index,t);STORE.touch(store,index);
    if(derived)for(const field of DERIVED_KEYS){if(!own(derived,field))continue;const value=derived[field],stored=STORE.peek(store,index,field);if(!Object.is(stored,value))STORE.set(store,index,field,value);}
    store.columns.at[index]=t;
  }
  function liveAsset(state,index){const assets=arrayOf(state);return assets&&isObject(assets[index])?assets[index]:null;}
  // Assign fields as a plain object would (undefined deletes the field).
  function update(state,target,patch){
    if(!isObject(patch))throw new TypeError('fleet-update-patch-object-required');
    const index=indexOfTarget(state,target);if(index<0)return null;
    const store=storeOf(state);
    if(store){checkpoint(state,store,index);for(const field of Object.keys(patch))STORE.set(store,index,field,patch[field]);return viewAt(state,index);}
    const asset=liveAsset(state,index);if(!asset)return null;
    for(const field of Object.keys(patch)){const value=patch[field];if(value===undefined)delete asset[field];else asset[field]=copyValue(value);}
    return nested(asset);
  }
  // Replace the asset with the same id by a whole new value (same position).
  function put(state,asset){
    if(!isObject(asset))throw new TypeError('fleet-put-asset-object-required');
    const store=storeOf(state),value=store?jsonCopy(asset):copyValue(asset),index=indexOfId(state,value.id);if(index<0)return null;
    if(store){STORE.replace(store,index,value,{at:timeOf(state)});return viewAt(state,index);}
    const assets=arrayOf(state);invalidateArrayIndex(assets);assets[index]=value;return nested(value);
  }
  function add(state,asset){
    if(!isObject(asset))throw new TypeError('fleet-add-asset-object-required');
    const store=storeOf(state),value=store?jsonCopy(asset):copyValue(asset);
    if(store){const index=STORE.add(store,value,{at:timeOf(state)});return viewAt(state,index);}
    ensure(state);const assets=arrayOf(state);invalidateArrayIndex(assets);assets.push(value);return nested(value);
  }
  function addMany(state,assets){return (Array.isArray(assets)?assets:[]).map(asset=>add(state,asset));}
  // Order-preserving removal of every target (ids or views); returns the count.
  function removeMany(state,targets){
    const indices=new Set();for(const target of targets||[]){const index=indexOfTarget(state,target);if(index>=0)indices.add(index);}
    if(!indices.size)return 0;
    const store=storeOf(state);if(store)return STORE.removeMany(store,indices);
    const assets=arrayOf(state);invalidateArrayIndex(assets);let write=0;
    for(let read=0;read<assets.length;read++){if(indices.has(read))continue;if(write!==read)assets[write]=assets[read];write++;}
    assets.length=write;return indices.size;
  }
  function remove(state,target){return removeMany(state,[target])===1;}
  function removeWhere(state,predicate){const doomed=[];forEach(state,(view,index)=>{if(predicate(view,index))doomed.push(index);});if(!doomed.length)return 0;
    const store=storeOf(state);if(store)return STORE.removeMany(store,doomed);
    const drop=new Set(doomed),assets=arrayOf(state);invalidateArrayIndex(assets);let write=0;for(let read=0;read<assets.length;read++){if(drop.has(read))continue;if(write!==read)assets[write]=assets[read];write++;}assets.length=write;return drop.size;}

  const API=Object.freeze({VERSION,configure,mode,source,ensure,size,revision,storeOf,isView,
    get,has,forEach,some,every,find,filter,count,sum,map,list,ids,indexById,plain,released,viewAt,indexOf:indexOfId,
    update,put,add,addMany,remove,removeMany,removeWhere,drafts,draft,commit});
  globalThis.GH_FLEET_DATA=API;
  if(globalThis.window&&globalThis.window!==globalThis)globalThis.window.GH_FLEET_DATA=API;
  if(typeof module!=='undefined'&&module.exports)module.exports=API;
})();

(()=>{
  'use strict';

  // Global Holdings state codec (Build 350).
  //
  // Purpose: the persisted save repeated every property NAME and every identical nested value once per asset
  // (35 keys x 20,000 assets, plus the same crew-role table 20,000 times). That is a storage-format problem, not a
  // gameplay problem, so it is fixed at the storage boundary: large homogeneous collections are written as
  // "shape + positional cells" rows with an interned pool of repeated sub-values. The live in-memory state is never
  // changed; decode(encode(state)) is exactly JSON.parse(JSON.stringify(state)).
  //
  // Encoded value forms (every array below is a TAGGED array, so a raw JSON array can never be misread):
  //   primitive            string | finite number | boolean | null
  //   object               [shapeId, cell0, cell1, ...]     shapeId >= 0 selects an ordered key list
  //   array                [-1, item0, item1, ...]
  //   interned repeat      [-2, poolIndex]                  decoded to a FRESH copy on every use (no aliasing)
  //
  // Collections (arrays / key maps of plain objects with >= MIN_ROWS entries) become
  //   {"$gh":1,"s":shapes,"p":pool,"r":rows}                 array of objects
  //   {"$gh":2,"k":keys,"s":shapes,"p":pool,"r":rows}        map of objects
  // A shape is an ordered key list, or {"k":keys,"c":[[position,cell],...]} where the listed positions hold a value
  // that is IDENTICAL in every row of that shape (stored once, omitted from the rows). Key order is always preserved.
  // The root carries  stateCodec:{version,paths}  so decoding needs no external configuration.

  const VERSION='gh-shape-1';
  const MIN_ROWS=64;
  const MIN_POOL_CHARS=40;
  const MIN_CONSTANT_ROWS=4;
  const MAX_DEPTH=64;
  const MAX_SCAN_DEPTH=5;

  const own=(object,key)=>Object.prototype.hasOwnProperty.call(object,key);
  function isArrayBuffer(value){return !!value&&Object.prototype.toString.call(value)==='[object ArrayBuffer]';}
  function base64Encode(bytes){
    if(typeof btoa==='function'){const parts=[];for(let start=0;start<bytes.length;start+=32768)parts.push(String.fromCharCode(...bytes.subarray(start,Math.min(bytes.length,start+32768))));return btoa(parts.join(''));}
    if(typeof Buffer!=='undefined')return Buffer.from(bytes.buffer,bytes.byteOffset,bytes.byteLength).toString('base64');
    throw new Error('state-codec-base64-unavailable');
  }
  function base64Decode(text){
    if(typeof atob==='function')return atob(text);
    if(typeof Buffer!=='undefined')return Buffer.from(text,'base64').toString('binary');
    throw corrupt('binary-decoder-unavailable');
  }
  function binaryMarker(buffer){
    const bytes=new Uint8Array(buffer);return {$ghBinary:'arraybuffer-v1',byteLength:bytes.length,base64:base64Encode(bytes)};
  }
  function binaryBuffer(marker){
    if(!isPlain(marker)||marker.$ghBinary!=='arraybuffer-v1'||!Number.isSafeInteger(marker.byteLength)||marker.byteLength<0||marker.byteLength>536870912||typeof marker.base64!=='string')throw corrupt('binary-marker');
    let raw;try{raw=base64Decode(marker.base64);}catch{throw corrupt('binary-base64');}if(raw.length!==marker.byteLength)throw corrupt('binary-length');
    const buffer=new ArrayBuffer(raw.length),bytes=new Uint8Array(buffer);for(let start=0;start<raw.length;start+=32768){const end=Math.min(raw.length,start+32768);for(let i=start;i<end;i++)bytes[i]=raw.charCodeAt(i);}
    return buffer;
  }
  // A plain data object: prototype is null or a ROOT prototype (its own prototype is null). That accepts objects from
  // any realm (iframe, vm context, worker-cloned state) while still rejecting class instances, Maps, Dates, etc.
  function isPlain(value){
    if(value===null||typeof value!=='object'||Array.isArray(value))return false;
    const proto=Object.getPrototypeOf(value);
    return proto===null||Object.getPrototypeOf(proto)===null;
  }
  function corrupt(reason){const error=new Error(`state-codec-corrupt:${reason}`);error.code='STATE_CODEC_CORRUPT';return error;}
  // JSON.parse creates an OWN "__proto__" property; a plain assignment would change the prototype instead.
  function assign(target,key,value){
    if(key==='__proto__')Object.defineProperty(target,key,{value,writable:true,enumerable:true,configurable:true});
    else target[key]=value;
  }

  // Pure structural encoding (no pooling yet): primitives, [-1,...items], or [shapeId,...cells].
  function createEncoder(){
    const rowShapeIds=new Map(),nestedShapeIds=new Map(),shapes=[];
    const sameKeys=(a,b)=>{if(a.length!==b.length)return false;for(let i=0;i<a.length;i++)if(a[i]!==b[i])return false;return true;};
    const recent=new Map();                                    // registry -> last shape id (homogeneous rows hit this)
    const shapeFor=(registry,keys)=>{
      const last=recent.get(registry);
      if(last!==undefined&&sameKeys(shapes[last],keys))return last;
      const signature=JSON.stringify(keys);let id=registry.get(signature);
      if(id===undefined){id=shapes.length;shapes.push(keys);registry.set(signature,id);}
      recent.set(registry,id);return id;
    };
    function encodeObject(value,depth,registry){
      const keys=[],cells=[];
      for(const key of Object.keys(value)){
        const cell=encodeValue(value[key],depth+1);
        if(cell!==undefined){keys.push(key);cells.push(cell);}
      }
      return [shapeFor(registry,keys),...cells];
    }
    function encodeValue(value,depth){
      if(depth>MAX_DEPTH)throw new RangeError('state-codec-depth');
      switch(typeof value){
        case 'string':case 'boolean':return value;
        case 'number':return Number.isFinite(value)?value:null;
        case 'undefined':case 'function':case 'symbol':return undefined;
        case 'bigint':throw new TypeError('state-codec-bigint');
        default:break;
      }
      if(value===null)return null;
      if(typeof value.toJSON==='function'){const json=value.toJSON();if(json!==value)return encodeValue(json,depth+1);}
      if(Array.isArray(value)){
        const out=[-1];
        for(let i=0;i<value.length;i++){const cell=encodeValue(value[i],depth+1);out.push(cell===undefined?null:cell);}
        return out;
      }
      return encodeObject(value,depth,nestedShapeIds);
    }
    return {shapes,row:value=>encodeObject(value,0,rowShapeIds)};
  }

  // Pooling pass. The first occurrence stays inline; the second identical occurrence creates the pool entry and later
  // ones only reference it. Children are pooled before parents, so an entry only ever references LOWER indexes.
  function createPool(){
    const seen=new Map(),pool=[];
    function intern(encoded){
      if(encoded.length<3)return encoded;
      const signature=JSON.stringify(encoded);
      if(signature.length<MIN_POOL_CHARS)return encoded;
      const state=seen.get(signature);
      if(state===undefined){seen.set(signature,-1);return encoded;}
      if(state===-1){const index=pool.length;pool.push(encoded);seen.set(signature,index);return [-2,index];}
      return [-2,state];
    }
    function tree(cell){
      if(!Array.isArray(cell))return cell;
      const out=new Array(cell.length);out[0]=cell[0];
      for(let i=1;i<cell.length;i++)out[i]=tree(cell[i]);
      return intern(out);
    }
    return {pool,tree};
  }

  // Structural equality of two RAW cells (primitives and tagged arrays). Equivalent to comparing their JSON text.
  function rawEqual(a,b){
    if(a===b)return true;
    if(!Array.isArray(a)||!Array.isArray(b)||a.length!==b.length)return false;
    for(let i=0;i<a.length;i++)if(!rawEqual(a[i],b[i]))return false;
    return true;
  }
  // Positions whose (raw) cell is identical in every row of a shape that has >= MIN_CONSTANT_ROWS rows.
  function findConstants(raw,shapes){
    const byShape=new Map();
    for(let i=0;i<raw.length;i++){const sid=raw[i][0];let list=byShape.get(sid);if(!list){list=[];byShape.set(sid,list);}list.push(i);}
    const constants=new Map();
    for(const [sid,indexes] of byShape){
      if(indexes.length<MIN_CONSTANT_ROWS)continue;
      const keys=shapes[sid],found=new Map(),first=raw[indexes[0]];
      for(let position=0;position<keys.length;position++){
        const reference=first[position+1];let constant=true;
        for(let n=1;n<indexes.length;n++){if(!rawEqual(raw[indexes[n]][position+1],reference)){constant=false;break;}}
        if(constant)found.set(position,reference);
      }
      if(found.size)constants.set(sid,found);
    }
    return constants;
  }

  function decodeCollection(node){
    if(!node||typeof node!=='object'||Array.isArray(node)||(node.$gh!==1&&node.$gh!==2))throw corrupt('collection-marker');
    const {s:shapes,p:pool,r:rows}=node;
    if(!Array.isArray(shapes)||!Array.isArray(pool)||!Array.isArray(rows))throw corrupt('collection-shape');
    // Validate every shape once and precompute how its row cells map onto keys.
    const plans=shapes.map(entry=>{
      const keys=Array.isArray(entry)?entry:entry&&typeof entry==='object'?entry.k:null;
      if(!Array.isArray(keys)||keys.some(key=>typeof key!=='string'))throw corrupt('shape-keys');
      const constAt=new Array(keys.length).fill(undefined),isConst=new Array(keys.length).fill(false);let constCount=0;
      if(!Array.isArray(entry)&&entry.c!==undefined){
        if(!Array.isArray(entry.c))throw corrupt('shape-constants');
        for(const pair of entry.c){
          if(!Array.isArray(pair)||pair.length!==2||!Number.isInteger(pair[0])||pair[0]<0||pair[0]>=keys.length||isConst[pair[0]])throw corrupt('shape-constant-position');
          isConst[pair[0]]=true;constAt[pair[0]]=pair[1];constCount++;
        }
      }
      return {keys,isConst,constAt,arity:keys.length-constCount+1};
    });
    function decode(cell,depth){
      // Cells are primitives or TAGGED arrays only. An untagged object would be returned by reference and could smuggle
      // arbitrary structure past the shape table, so it is rejected instead of trusted.
      if(!Array.isArray(cell)){if(cell!==null&&typeof cell==='object')throw corrupt('untagged-object');return cell;}
      if(depth>MAX_DEPTH)throw corrupt('depth');
      const tag=cell[0];
      if(tag===-1){const out=new Array(cell.length-1);for(let i=1;i<cell.length;i++)out[i-1]=decode(cell[i],depth+1);return out;}
      if(tag===-2){
        const index=cell[1];if(cell.length!==2||!Number.isInteger(index)||index<0||index>=pool.length)throw corrupt('pool-index');
        return decode(pool[index],depth+1);
      }
      if(Number.isInteger(tag)&&tag>=0){
        const plan=plans[tag];if(!plan||cell.length!==plan.arity)throw corrupt('row-arity');
        const out={},keys=plan.keys;let cursor=1;
        for(let i=0;i<keys.length;i++)assign(out,keys[i],plan.isConst[i]?decode(plan.constAt[i],depth+1):decode(cell[cursor++],depth+1));
        return out;
      }
      throw corrupt('tag');
    }
    if(node.$gh===1){
      const out=new Array(rows.length);
      for(let i=0;i<rows.length;i++){if(!Array.isArray(rows[i]))throw corrupt('row');out[i]=decode(rows[i],0);}
      return out;
    }
    const keys=node.k;if(!Array.isArray(keys)||keys.length!==rows.length||keys.some(key=>typeof key!=='string'))throw corrupt('map-keys');
    const out={};for(let i=0;i<rows.length;i++){if(!Array.isArray(rows[i]))throw corrupt('row');assign(out,keys[i],decode(rows[i],0));}
    return out;
  }

  function encodeCollection(value){
    const encoder=createEncoder(),isArray=Array.isArray(value),keys=isArray?null:Object.keys(value);
    const count=isArray?value.length:keys.length,raw=new Array(count);
    for(let i=0;i<count;i++)raw[i]=encoder.row(isArray?value[i]:value[keys[i]]);
    const constants=findConstants(raw,encoder.shapes),pooler=createPool();
    const shapes=encoder.shapes.map((list,sid)=>{
      const found=constants.get(sid);if(!found)return list;
      return {k:list,c:[...found.entries()].sort((a,b)=>a[0]-b[0]).map(([position,cell])=>[position,pooler.tree(cell)])};
    });
    const rows=new Array(count);
    for(let i=0;i<count;i++){
      const source=raw[i],found=constants.get(source[0]),row=[source[0]];
      for(let position=0;position<source.length-1;position++){if(found&&found.has(position))continue;row.push(pooler.tree(source[position+1]));}
      rows[i]=row;
    }
    return isArray?{$gh:1,s:shapes,p:pooler.pool,r:rows}:{$gh:2,k:keys,s:shapes,p:pooler.pool,r:rows};
  }

  function collectionCandidate(value){
    if(Array.isArray(value)){
      if(value.length<MIN_ROWS)return false;
      for(let i=0;i<value.length;i++){const item=value[i];if(!isPlain(item)||typeof item.toJSON==='function')return false;}
      return true;
    }
    if(!isPlain(value))return false;
    const keys=Object.keys(value);if(keys.length<MIN_ROWS)return false;
    for(const key of keys){const item=value[key];if(!isPlain(item)||typeof item.toJSON==='function')return false;}
    return true;
  }
  // Deterministic discovery: the same state always yields the same ordered path list.
  function selectPaths(state){
    const paths=[];
    (function visit(node,path,depth){
      for(const key of Object.keys(node)){
        const value=node[key];if(value===null||typeof value!=='object')continue;
        if(collectionCandidate(value)){paths.push([...path,key]);continue;}
        if(depth<MAX_SCAN_DEPTH&&typeof value.toJSON!=='function'&&(isPlain(value)||Array.isArray(value)&&value.length<MIN_ROWS))visit(value,[...path,key],depth+1);
      }
    })(state,[],1);
    return paths;
  }
  function readPath(root,path){let node=root;for(const key of path){if(node===null||typeof node!=='object'||!own(node,key))return undefined;node=node[key];}return node;}
  function writePathCopy(root,path,value){
    // Structural sharing: copy only the objects on the path, never the (huge) collections beside it.
    const copy=value=>Array.isArray(value)?value.slice():{...value},copies=[copy(root)];let cursor=copies[0];
    for(let i=0;i<path.length-1;i++){const next=copy(cursor[path[i]]);cursor[path[i]]=next;cursor=next;}
    cursor[path[path.length-1]]=value;return copies[0];
  }

  function encodeState(state){
    if(!isPlain(state))return state;
    const binaryPaths=[];let out=state;
    // Fleet rows are the only ArrayBuffer in Save Schema 3. Preserve their
    // bytes through the current JSON transport until binary chunk storage lands.
    if(isArrayBuffer(state.fleet?.rows)){const path=['fleet','rows'];out=writePathCopy(out,path,binaryMarker(state.fleet.rows));binaryPaths.push(path);}
    const paths=selectPaths(out);
    if(!paths.length&&!binaryPaths.length)return state;
    for(const path of paths)out=writePathCopy(out,path,encodeCollection(readPath(out,path)));
    out.stateCodec={version:VERSION,paths,binaryPaths};
    return out;
  }

  function decodeState(tree){
    if(!isPlain(tree)||!own(tree,'stateCodec'))return tree;
    const meta=tree.stateCodec;
    if(!isPlain(meta)||meta.version!==VERSION||!Array.isArray(meta.paths))throw corrupt('meta');
    let out={...tree};delete out.stateCodec;
    for(const path of meta.paths){
      if(!Array.isArray(path)||!path.length||path.some(key=>typeof key!=='string'))throw corrupt('path');
      const node=readPath(out,path);if(node===undefined)throw corrupt('path-missing');
      out=writePathCopy(out,path,decodeCollection(node));
    }
    const binaryPaths=meta.binaryPaths===undefined?[]:meta.binaryPaths;if(!Array.isArray(binaryPaths))throw corrupt('binary-paths');
    for(const path of binaryPaths){
      if(!Array.isArray(path)||!path.length||path.some(key=>typeof key!=='string'))throw corrupt('binary-path');
      const node=readPath(out,path);if(node===undefined)throw corrupt('binary-path-missing');
      out=writePathCopy(out,path,binaryBuffer(node));
    }
    return out;
  }

  // Build 358: encoded-collection cache. A collection whose members are all sealed (deep-frozen by their owners, see
  // GH_TRANSACTION_CORE.registerSealedCollections) encodes to a pure function of its member sequence. When that
  // sequence (and, for a map, its keys) is unchanged since the last save, the previous JSON text of the encoded
  // collection is reused. The output is byte-for-byte what JSON.stringify(encodeState(state)) produces.
  const COLLECTION_TEXT=new Map(),NONCE=`${Date.now().toString(36)}${Math.random().toString(36).slice(2)}`;
  let collectionCacheStats={hits:0,misses:0};
  function sealedMembers(value){
    const sealed=globalThis.GH_TRANSACTION_CORE?.isSealed;if(typeof sealed!=='function')return null;
    const keys=Array.isArray(value)?null:Object.keys(value),members=keys?keys.map(key=>value[key]):value.slice();
    for(let i=0;i<members.length;i++)if(!sealed(members[i]))return null;
    return {keys,members};
  }
  function sameMembers(entry,current){
    if(entry.members.length!==current.members.length||!!entry.keys!==!!current.keys)return false;
    for(let i=0;i<current.members.length;i++)if(entry.members[i]!==current.members[i])return false;
    if(current.keys)for(let i=0;i<current.keys.length;i++)if(entry.keys[i]!==current.keys[i])return false;
    return true;
  }
  function serialize(state){
    if(!isPlain(state))return JSON.stringify(encodeState(state));
    const binaryPaths=[];let out=state;
    if(isArrayBuffer(state.fleet?.rows)){const path=['fleet','rows'];out=writePathCopy(out,path,binaryMarker(state.fleet.rows));binaryPaths.push(path);}
    const paths=selectPaths(out);
    if(!paths.length&&!binaryPaths.length)return JSON.stringify(state);
    const fragments=[],live=new Set();
    for(const path of paths){
      const value=readPath(out,path),key=JSON.stringify(path),current=sealedMembers(value);
      if(!current){COLLECTION_TEXT.delete(key);out=writePathCopy(out,path,encodeCollection(value));continue;}
      live.add(key);let entry=COLLECTION_TEXT.get(key);
      if(entry&&sameMembers(entry,current))collectionCacheStats.hits++;
      else{entry={keys:current.keys,members:current.members,text:JSON.stringify(encodeCollection(value))};COLLECTION_TEXT.set(key,entry);collectionCacheStats.misses++;}
      const token=`\u0000gh-codec:${NONCE}:${fragments.length}\u0000`;fragments.push({token:JSON.stringify(token),text:entry.text});out=writePathCopy(out,path,token);
    }
    for(const key of [...COLLECTION_TEXT.keys()])if(!live.has(key))COLLECTION_TEXT.delete(key);
    out.stateCodec={version:VERSION,paths,binaryPaths};
    const text=JSON.stringify(out);if(!fragments.length)return text;
    for(const fragment of fragments){fragment.at=text.indexOf(fragment.token);if(fragment.at<0||text.indexOf(fragment.token,fragment.at+1)>=0)throw new Error('state-codec-fragment-token');}
    fragments.sort((a,b)=>a.at-b.at);const parts=[];let cursor=0;
    for(const fragment of fragments){parts.push(text.slice(cursor,fragment.at),fragment.text);cursor=fragment.at+fragment.token.length;}
    parts.push(text.slice(cursor));return parts.join('');
  }
  function deserialize(json){return decodeState(JSON.parse(json));}

  const API=Object.freeze({VERSION,MIN_ROWS,encodeState,decodeState,serialize,deserialize,selectPaths,cacheStats:()=>({...collectionCacheStats,entries:COLLECTION_TEXT.size}),isEncoded:tree=>isPlain(tree)&&own(tree,'stateCodec')});
  globalThis.GH_STATE_CODEC=API;
  if(globalThis.window&&globalThis.window!==globalThis)globalThis.window.GH_STATE_CODEC=API;
  if(typeof module!=='undefined'&&module.exports)module.exports=API;
})();

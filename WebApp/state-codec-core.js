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
  // Build 358: a collection of SEGMENT_MIN+ rows is written as consecutive segments,
  //   {"$gh":3,"a":1|0,"g":[segment,...]}                   each segment a $gh:1 (array) or $gh:2 (map) collection
  // so a save re-encodes only the segments whose members changed (see serialize). Such a save is SEG_VERSION.
  // Build 359 (iPhone diagnostic: some saves re-sent 52-54 chunks, 14.6 MB, in 0.5-0.77 s): segments were 256 rows by
  // position, so archiving one record shifted every later segment and each was re-encoded and uploaded again. A
  // segment now ends after a member whose identity (map key, or the id/number of an array item) hashes to a boundary,
  // once it holds SEGMENT_FLOOR rows, or at SEGMENT_CEIL rows: removing or adding a member changes its own segment and
  // at most the next. The cached text of a segment is found by its first member's identity, not by its index. A
  // collection whose members have no identity (or a repeated one) keeps the 256-row segments. Readers never relied on
  // segment sizes.
  // Build 358 (save size): with the native vault, a sealed segment (or a whole sealed collection) of TEXT_CHUNK_MIN+
  // characters is kept out of the save text as a vault chunk holding its JSON text (UTF-8):
  //   {"$ghText":"chunk-v1","id":id,"bytes":byteLength}
  // stateCodec.chunks lists every such id in order, so the vault can require them before a commit and keep them while
  // a save mentions them. Such a save is TEXT_VERSION. Only serializeChunked writes these; serialize, encodeState and
  // exports stay self-contained.

  const VERSION='gh-shape-1';
  // Build 358 (million-asset save): runs of sequential ids. An array of RUN_MIN+ strings `prefix + digits` whose
  // numbers are consecutive (the fleet store's pattern rule: zero padding kept as a width) is stored as
  //   [-3, prefix, width, first, count]
  // inside collections, and at RUN paths (meta.runPaths) elsewhere; every element is compared with its rebuilt text
  // before a run is written, so decoding gives exactly the same array. A save with run paths is written as
  // RUN_VERSION, which earlier decoders reject (they would otherwise keep the run marker as data).
  const RUN_VERSION='gh-shape-2',RUN_MIN=64,RUN_MAX=1<<24,RUN_HEAD=/^([\s\S]*?)(\d{1,10})$/;
  function runText(prefix,width,number){const digits=String(number);return prefix+(width?digits.padStart(width,'0'):digits);}
  function idRun(list){
    if(!Array.isArray(list)||list.length<RUN_MIN||list.length>RUN_MAX||typeof list[0]!=='string')return null;
    const head=RUN_HEAD.exec(list[0]);if(!head)return null;
    const prefix=head[1],digits=head[2],first=Number(digits),width=digits.length>1&&digits[0]==='0'?digits.length:0;
    if(first+list.length-1>0xFFFFFFFF||runText(prefix,width,first)!==list[0])return null;
    for(let i=1;i<list.length;i++)if(list[i]!==runText(prefix,width,first+i))return null;
    return [-3,prefix,width,first,list.length];
  }
  function expandRun(cell){
    const [tag,prefix,width,first,count]=cell;
    if(cell.length!==5||tag!==-3||typeof prefix!=='string'||!Number.isInteger(width)||width<0||width>10||!Number.isSafeInteger(first)||first<0||!Number.isInteger(count)||count<1||count>RUN_MAX||first+count-1>0xFFFFFFFF)throw corrupt('run');
    const out=new Array(count);for(let i=0;i<count;i++)out[i]=runText(prefix,width,first+i);return out;
  }
  const MIN_ROWS=64,SEGMENT_ROWS=256,SEGMENT_MIN=SEGMENT_ROWS*2,SEGMENT_FLOOR=64,SEGMENT_CEIL=1024,SEG_VERSION='gh-shape-3',TEXT_VERSION='gh-shape-4',TEXT_CHUNK_MIN=16384;
  const MIN_POOL_CHARS=40;
  const MIN_CONSTANT_ROWS=4;
  const MAX_DEPTH=64;
  const MAX_SCAN_DEPTH=5;

  const own=(object,key)=>Object.prototype.hasOwnProperty.call(object,key);
  function isArrayBuffer(value){return !!value&&Object.prototype.toString.call(value)==='[object ArrayBuffer]';}
  // Build 358: base64 for the fleet record buffer (128 bytes per asset). The former String.fromCharCode + btoa path ran at
  // ~45 ns/byte (1.15 s for 25 MB in V8); the native Uint8Array toBase64/fromBase64 (Safari 18.2+) is used when present,
  // otherwise a 12-bit pair table writes ASCII bytes that TextDecoder turns into the string (~2 ns/byte). Output is
  // identical to btoa. Decoding falls back to atob on anything but canonical base64, so errors are unchanged.
  const B64='ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/',B64_CODES=new Uint8Array(64),B64_PAIRS=new Uint16Array(4096),B64_VALUES=new Int16Array(256).fill(-1);
  for(let i=0;i<64;i++){B64_CODES[i]=B64.charCodeAt(i);B64_VALUES[B64_CODES[i]]=i;}
  for(let i=0;i<4096;i++)B64_PAIRS[i]=B64_CODES[i>>6]|(B64_CODES[i&63]<<8);
  const LITTLE_ENDIAN=new Uint8Array(new Uint16Array([1]).buffer)[0]===1,TEXT_STEP=1<<20;
  function asciiText(bytes){const decoder=new TextDecoder('latin1');let text='';for(let at=0;at<bytes.length;at+=TEXT_STEP)text+=decoder.decode(bytes.subarray(at,Math.min(bytes.length,at+TEXT_STEP)));return text;}
  function tableEncode(bytes){
    const n=bytes.length,full=n-n%3,out=new Uint8Array(Math.ceil(n/3)*4),pairs=new Uint16Array(out.buffer,0,out.length>>1);let j=0;
    for(let i=0;i<full;i+=3){const v=(bytes[i]<<16)|(bytes[i+1]<<8)|bytes[i+2];pairs[j++]=B64_PAIRS[v>>>12];pairs[j++]=B64_PAIRS[v&4095];}
    let o=j*2;const rest=n-full;
    if(rest){const v=(bytes[full]<<16)|(rest===2?bytes[full+1]<<8:0);out[o++]=B64_CODES[v>>>18];out[o++]=B64_CODES[(v>>>12)&63];out[o++]=rest===2?B64_CODES[(v>>>6)&63]:61;out[o++]=61;}
    return asciiText(out);
  }
  function base64Encode(bytes){
    if(typeof bytes.toBase64==='function')return bytes.toBase64();
    if(LITTLE_ENDIAN&&typeof TextDecoder==='function')return tableEncode(bytes);
    if(typeof btoa==='function'){const parts=[];for(let start=0;start<bytes.length;start+=32768)parts.push(String.fromCharCode(...bytes.subarray(start,Math.min(bytes.length,start+32768))));return btoa(parts.join(''));}
    if(typeof Buffer!=='undefined')return Buffer.from(bytes.buffer,bytes.byteOffset,bytes.byteLength).toString('base64');
    throw new Error('state-codec-base64-unavailable');
  }
  // Canonical base64 to bytes, or null (then the caller uses the atob path and its errors).
  function tableDecode(text){
    if(typeof TextEncoder!=='function'||text.length%4!==0)return null;
    const codes=new TextEncoder().encode(text);if(codes.length!==text.length)return null;
    const pad=text.length&&codes[codes.length-1]===61?(codes[codes.length-2]===61?2:1):0,n=text.length/4*3-pad,out=new Uint8Array(n);let o=0;
    for(let i=0;i<codes.length;i+=4){
      const a=B64_VALUES[codes[i]],b=B64_VALUES[codes[i+1]],last=i+4===codes.length,c=last&&pad===2?0:B64_VALUES[codes[i+2]],d=last&&pad>=1?0:B64_VALUES[codes[i+3]];
      if((a|b|c|d)<0)return null;const v=(a<<18)|(b<<12)|(c<<6)|d;
      out[o++]=v>>>16;if(o<n)out[o++]=(v>>>8)&255;if(o<n)out[o++]=v&255;
    }
    return out;
  }
  function base64Decode(text){
    if(typeof atob==='function')return atob(text);
    if(typeof Buffer!=='undefined')return Buffer.from(text,'base64').toString('binary');
    throw corrupt('binary-decoder-unavailable');
  }
  function binaryMarker(buffer){
    const bytes=new Uint8Array(buffer);return {$ghBinary:'arraybuffer-v1',byteLength:bytes.length,base64:base64Encode(bytes)};
  }
  // Build 358: the fleet record buffer is encoded per segment of ROW_SEGMENT_CHUNKS store chunks. A segment is 12 MiB,
  // a multiple of 3 bytes, so the base64 of the whole buffer is exactly the concatenation of the segments' base64. A
  // segment whose chunks were not written since the last save (GH_FLEET_STORE.chunkStamp: same runtime, mass version and
  // chunk versions) reuses its text. Each save re-encodes one reused segment (in rotation) and compares; a mismatch
  // drops the cache and the save is encoded from scratch. The text equals JSON.stringify(binaryMarker(store.rows)).
  const ROW_SEGMENT_CHUNKS=3,rowSegmentCache=new WeakMap();
  let rowCacheStats={hits:0,misses:0,verified:0,mismatches:0};
  function rowsMarkerText(store){
    const STORE=globalThis.GH_FLEET_STORE,bytes=new Uint8Array(store.rows),whole=()=>JSON.stringify(binaryMarker(store.rows));
    if(typeof STORE?.chunkStamp!=='function'||STORE.isStore?.(store)!==true)return whole();
    const segmentBytes=STORE.CHUNK_ROWS*STORE.STRIDE*ROW_SEGMENT_CHUNKS;if(!Number.isSafeInteger(segmentBytes)||segmentBytes<=0||segmentBytes%3!==0)return whole();
    const stamp=STORE.chunkStamp(store),count=Math.ceil(bytes.length/segmentBytes);let entry=rowSegmentCache.get(store);
    if(!entry){entry={segments:[],rotation:0};rowSegmentCache.set(store,entry);}
    const parts=new Array(count),reused=[];
    for(let segment=0;segment<count;segment++){
      const start=segment*segmentBytes,end=Math.min(bytes.length,start+segmentBytes),first=segment*ROW_SEGMENT_CHUNKS;
      let key=`${stamp.runtime}:${stamp.mass}:${start}:${end}`;for(let chunk=first;chunk<first+ROW_SEGMENT_CHUNKS;chunk++)key+=':'+(stamp.versions[chunk]??0);
      const cached=entry.segments[segment];
      if(cached&&cached.key===key){parts[segment]=cached.text;reused.push(segment);rowCacheStats.hits++;}
      else{const text=base64Encode(bytes.subarray(start,end));entry.segments[segment]={key,text};parts[segment]=text;rowCacheStats.misses++;}
    }
    entry.segments.length=count;
    if(reused.length){
      const segment=reused[entry.rotation++%reused.length],start=segment*segmentBytes;rowCacheStats.verified++;
      if(base64Encode(bytes.subarray(start,Math.min(bytes.length,start+segmentBytes)))!==parts[segment]){
        rowCacheStats.mismatches++;rowSegmentCache.delete(store);
        try{globalThis.console?.warn?.('state-codec: fleet row cache mismatch; encoding the whole buffer');}catch{}
        return whole();
      }
    }
    return `{"$ghBinary":"arraybuffer-v1","byteLength":${bytes.length},"base64":"${parts.join('')}"}`;
  }
  // Build 358 (million-asset save): 'chunks-v1' keeps the record buffer out of the JSON text. The marker lists one id
  // per 4 MiB store chunk; options.resolveChunk(id) returns that chunk's bytes (the native vault serves them), so the
  // decoded buffer is assembled from memory. Every length is checked; a missing or short chunk is a corrupt save.
  const CHUNK_ID=/^[A-Za-z0-9._-]{1,160}$/;
  function chunkedBuffer(marker,options={}){
    const {byteLength,chunkBytes,chunks}=marker;
    if(!Number.isSafeInteger(byteLength)||byteLength<0||byteLength>536870912||!Number.isSafeInteger(chunkBytes)||chunkBytes<=0||!Array.isArray(chunks)||chunks.length!==Math.ceil(byteLength/chunkBytes)||chunks.some(id=>typeof id!=='string'||!CHUNK_ID.test(id)))throw corrupt('binary-chunks');
    if(typeof options.resolveChunk!=='function')throw corrupt('binary-chunks-unresolved');
    const buffer=new ArrayBuffer(byteLength),bytes=new Uint8Array(buffer);
    for(let index=0;index<chunks.length;index++){
      const start=index*chunkBytes,length=Math.min(chunkBytes,byteLength-start);let data;
      try{data=options.resolveChunk(chunks[index],{index,byteOffset:start,byteLength:length});}catch{throw corrupt('binary-chunk-missing');}
      // ArrayBuffer.isView / toString work across realms (a chunk may come from another context).
      const view=ArrayBuffer.isView(data)?new Uint8Array(data.buffer,data.byteOffset,data.byteLength):isArrayBuffer(data)?new Uint8Array(data):null;
      if(!view)throw corrupt('binary-chunk-missing');if(view.length!==length)throw corrupt('binary-chunk-length');
      bytes.set(view,start);
    }
    return buffer;
  }
  function binaryBuffer(marker,options={}){
    if(isPlain(marker)&&marker.$ghBinary==='chunks-v1')return chunkedBuffer(marker,options);
    if(!isPlain(marker)||marker.$ghBinary!=='arraybuffer-v1'||!Number.isSafeInteger(marker.byteLength)||marker.byteLength<0||marker.byteLength>536870912||typeof marker.base64!=='string')throw corrupt('binary-marker');
    let fast=null;
    try{fast=typeof Uint8Array.fromBase64==='function'?Uint8Array.fromBase64(marker.base64):tableDecode(marker.base64);}catch{fast=null;}
    if(fast){if(fast.length!==marker.byteLength)throw corrupt('binary-length');return fast.byteOffset===0&&fast.byteLength===fast.buffer.byteLength?fast.buffer:fast.slice().buffer;}
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
        const run=idRun(value);if(run)return run;
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

  function decodeSegment(isArray,part){if(!part||part.$gh!==(isArray?1:2))throw corrupt('segment-marker');return decodeCollection(part);}
  function combineSegments(isArray,parts){
    if(isArray)return [].concat(...parts);
    const out={};for(const part of parts)for(const key of Object.keys(part)){if(own(out,key))throw corrupt('segment-duplicate-key');assign(out,key,part[key]);}
    return out;
  }
  function decodeCollection(node){
    if(node&&typeof node==='object'&&!Array.isArray(node)&&node.$gh===3){
      if((node.a!==1&&node.a!==0)||!Array.isArray(node.g)||!node.g.length)throw corrupt('segments');
      return combineSegments(node.a,node.g.map(part=>decodeSegment(node.a,part)));
    }
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
      if(tag===-3)return expandRun(cell);
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

  function encodeRows(value){
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
  function memberIdentity(member){
    if(!member||typeof member!=='object')return null;const id=member.id??member.number;
    return typeof id==='string'?`s:${id}`:Number.isFinite(id)?`n:${id}`:null;
  }
  function identityHash(text){let h=0x811c9dc5|0;for(let i=0;i<text.length;i++)h=Math.imul(h^text.charCodeAt(i),0x01000193);return h>>>0;}
  // Segment bounds: [{start,end,key}] where key names the segment by its first member ('#index' for positional ones).
  function segmentBounds(value){
    const isArray=Array.isArray(value),keys=isArray?null:Object.keys(value),count=isArray?value.length:keys.length,ids=new Array(count),seen=new Set();let identified=true;
    for(let i=0;i<count&&identified;i++){const id=isArray?memberIdentity(value[i]):`k:${keys[i]}`;if(id===null||seen.has(id))identified=false;else{seen.add(id);ids[i]=id;}}
    const out=[];
    if(!identified){for(let start=0,index=0;start<count;start+=SEGMENT_ROWS,index++)out.push({start,end:Math.min(count,start+SEGMENT_ROWS),key:`#${index}`});return {keys,bounds:out};}
    let start=0;
    for(let i=0;i<count;i++){const length=i-start+1;if((length>=SEGMENT_FLOOR&&(identityHash(ids[i])&255)===0)||length>=SEGMENT_CEIL){out.push({start,end:i+1,key:ids[start]});start=i+1;}}
    if(start<count)out.push({start,end:count,key:ids[start]});
    return {keys,bounds:out};
  }
  function segmentSlices(value,layout=segmentBounds(value)){
    const isArray=Array.isArray(value),{keys,bounds}=layout;
    return bounds.map(({start,end})=>{if(isArray)return value.slice(start,end);const part={};for(let i=start;i<end;i++)part[keys[i]]=value[keys[i]];return part;});
  }
  function segmented(value){return (Array.isArray(value)?value.length:Object.keys(value).length)>=SEGMENT_MIN;}
  function encodeCollection(value){
    if(!segmented(value))return encodeRows(value);
    return {$gh:3,a:Array.isArray(value)?1:0,g:segmentSlices(value).map(encodeRows)};
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
  function selectPaths(state){return scanPaths(state).paths;}
  function scanPaths(state){
    const paths=[],runs=[];
    (function visit(node,path,depth){
      for(const key of Object.keys(node)){
        const value=node[key];if(value===null||typeof value!=='object')continue;
        if(Array.isArray(value)&&value.length>=RUN_MIN){const run=idRun(value);if(run){runs.push({path:[...path,key],run});continue;}}
        if(collectionCandidate(value)){paths.push([...path,key]);continue;}
        if(depth<MAX_SCAN_DEPTH&&typeof value.toJSON!=='function'&&(isPlain(value)||Array.isArray(value)&&value.length<MIN_ROWS))visit(value,[...path,key],depth+1);
      }
    })(state,[],1);
    return {paths,runs};
  }
  function readPath(root,path){let node=root;for(const key of path){if(node===null||typeof node!=='object'||!own(node,key))return undefined;node=node[key];}return node;}
  function writePathCopy(root,path,value){
    // Structural sharing: copy only the objects on the path, never the (huge) collections beside it.
    const copy=value=>Array.isArray(value)?value.slice():{...value},copies=[copy(root)];let cursor=copies[0];
    for(let i=0;i<path.length-1;i++){const next=copy(cursor[path[i]]);cursor[path[i]]=next;cursor=next;}
    cursor[path[path.length-1]]=value;return copies[0];
  }

  function codecMeta(paths,binaryPaths,runs,segments,chunks=[]){
    const version=chunks.length?TEXT_VERSION:segments?SEG_VERSION:runs.length?RUN_VERSION:VERSION,meta=runs.length?{version,paths,binaryPaths,runPaths:runs.map(row=>row.path)}:{version,paths,binaryPaths};
    if(chunks.length)meta.chunks=chunks;return meta;
  }
  function encodeState(state){
    if(!isPlain(state))return state;
    const binaryPaths=[];let out=state;
    // Fleet rows are the only ArrayBuffer in Save Schema 3. Preserve their
    // bytes through the current JSON transport until binary chunk storage lands.
    if(isArrayBuffer(state.fleet?.rows)){const path=['fleet','rows'];out=writePathCopy(out,path,binaryMarker(state.fleet.rows));binaryPaths.push(path);}
    const scan=scanPaths(out),paths=scan.paths;
    if(!paths.length&&!binaryPaths.length&&!scan.runs.length)return state;
    let segments=false;
    for(const path of paths){const value=readPath(out,path);if(segmented(value))segments=true;out=writePathCopy(out,path,encodeCollection(value));}
    for(const {path,run} of scan.runs)out=writePathCopy(out,path,run);
    out.stateCodec=codecMeta(paths,binaryPaths,scan.runs,segments);
    return out;
  }

  function decodeState(tree,options={}){
    if(!isPlain(tree)||!own(tree,'stateCodec'))return tree;
    const meta=tree.stateCodec;
    if(!isPlain(meta)||![VERSION,RUN_VERSION,SEG_VERSION,TEXT_VERSION].includes(meta.version)||!Array.isArray(meta.paths))throw corrupt('meta');
    const listed=meta.chunks===undefined?[]:meta.chunks;
    if(!Array.isArray(listed)||(listed.length&&meta.version!==TEXT_VERSION)||listed.some(id=>typeof id!=='string'||!CHUNK_ID.test(id)))throw corrupt('text-chunks');
    const pending=new Set(listed);if(pending.size!==listed.length)throw corrupt('text-chunk-duplicate');
    const text=(node,partKey)=>{if(!isTextMarker(node))return node;if(!pending.delete(node.id))throw corrupt('text-chunk-unlisted');return resolveTextChunk(node,options,partKey);};
    let out={...tree};delete out.stateCodec;
    for(const path of meta.paths){
      if(!Array.isArray(path)||!path.length||path.some(key=>typeof key!=='string'))throw corrupt('path');
      let node=readPath(out,path);if(node===undefined)throw corrupt('path-missing');
      const key=JSON.stringify(path);node=text(node,key);
      if(isPlain(node)&&node.$gh===3&&Array.isArray(node.g)){
        if((node.a!==1&&node.a!==0)||!node.g.length)throw corrupt('segments');
        // A text chunk's place is named as serialize() names it: by the segment layout of the decoded collection.
        const resolved=node.g.map(part=>{const decoded=decodeSegment(node.a,text(part,null)),adopted=isTextMarker(part)?ADOPTED_TEXT.get(null):null;ADOPTED_TEXT.delete(null);return {decoded,adopted};});
        const combined=combineSegments(node.a,resolved.map(row=>row.decoded));
        if(resolved.some(row=>row.adopted)){
          const layout=segmentBounds(combined),byStart=new Map(layout.bounds.map(bound=>[bound.start,bound]));let start=0;
          for(const row of resolved){const length=node.a?row.decoded.length:Object.keys(row.decoded).length,bound=byStart.get(start);if(row.adopted&&bound&&bound.end===start+length)ADOPTED_TEXT.set(`${key}${bound.key.startsWith('#')?'':'@'}${bound.key}`,row.adopted);start+=length;}
        }
        out=writePathCopy(out,path,combined);continue;
      }
      out=writePathCopy(out,path,decodeCollection(node));
    }
    if(pending.size)throw corrupt('text-chunk-unused');
    const binaryPaths=meta.binaryPaths===undefined?[]:meta.binaryPaths;if(!Array.isArray(binaryPaths))throw corrupt('binary-paths');
    for(const path of binaryPaths){
      if(!Array.isArray(path)||!path.length||path.some(key=>typeof key!=='string'))throw corrupt('binary-path');
      const node=readPath(out,path);if(node===undefined)throw corrupt('binary-path-missing');
      out=writePathCopy(out,path,binaryBuffer(node,options));
    }
    const runPaths=meta.runPaths===undefined?[]:meta.runPaths;
    if(!Array.isArray(runPaths)||(runPaths.length&&meta.version===VERSION))throw corrupt('run-paths');
    for(const path of runPaths){
      if(!Array.isArray(path)||!path.length||path.some(key=>typeof key!=='string'))throw corrupt('run-path');
      const node=readPath(out,path);if(!Array.isArray(node)||node[0]!==-3)throw corrupt('run-path-missing');
      out=writePathCopy(out,path,expandRun(node));
    }
    return out;
  }

  // Build 358 (save size): text chunks. A marker is resolved through options.resolveChunk (the vault's bytes), checked
  // for length and decoded as strict UTF-8 JSON; it must be a $gh:1/$gh:2 collection. The loaded text's checksum is
  // remembered by its place (path and segment): when the first save of the session encodes the same place to the same
  // text, it reuses the chunk id the vault already holds instead of uploading the same bytes again.
  function isTextMarker(node){return isPlain(node)&&own(node,'$ghText');}
  function textChecksum(text){let a=0x811c9dc5|0,b=0x01000193|0;const imul=Math.imul;for(let i=0;i<text.length;i++){a=imul(a^text.charCodeAt(i),0x01000193);b=(b+a)|0;}return `${text.length}.${(a>>>0).toString(36)}.${(b>>>0).toString(36)}`;}
  const ADOPTED_TEXT=new Map();
  function resolveTextChunk(marker,options,partKey){
    const {id,bytes}=marker;
    if(marker.$ghText!=='chunk-v1'||typeof id!=='string'||!CHUNK_ID.test(id)||!Number.isSafeInteger(bytes)||bytes<2||bytes>67108864)throw corrupt('text-marker');
    if(typeof options.resolveChunk!=='function')throw corrupt('text-chunk-unresolved');
    let data;try{data=options.resolveChunk(id,{text:true,byteLength:bytes});}catch{throw corrupt('text-chunk-missing');}
    const view=ArrayBuffer.isView(data)?new Uint8Array(data.buffer,data.byteOffset,data.byteLength):isArrayBuffer(data)?new Uint8Array(data):null;
    if(!view)throw corrupt('text-chunk-missing');if(view.length!==bytes)throw corrupt('text-chunk-length');
    let text,node;try{text=new TextDecoder('utf-8',{fatal:true}).decode(view);node=JSON.parse(text);}catch{throw corrupt('text-chunk-json');}
    if(!isPlain(node)||(node.$gh!==1&&node.$gh!==2))throw corrupt('text-chunk-collection');
    ADOPTED_TEXT.set(partKey,{id,sum:textChecksum(text)});
    return node;
  }
  function utf8Length(text){let n=0;for(let i=0;i<text.length;i++){const c=text.charCodeAt(i);if(c<128)n++;else if(c<2048)n+=2;else if(c>=0xD800&&c<=0xDBFF&&i+1<text.length){const d=text.charCodeAt(i+1);if(d>=0xDC00&&d<=0xDFFF){n+=4;i++;}else n+=3;}else n+=3;}return n;}
  let textChunkSequence=0,textChunkStats={named:0,adopted:0,referenced:0};
  // The chunk of a cached collection text: an id that never changes while the text does not (the entry is replaced when
  // its members change), the vault's id when the loaded save held the same text at the same place.
  function textChunkOf(entry,partKey){
    if(!entry.chunk){
      const adopted=ADOPTED_TEXT.get(partKey);ADOPTED_TEXT.delete(partKey);
      const id=adopted&&adopted.sum===textChecksum(entry.text)?adopted.id:`${NONCE}.t.${(++textChunkSequence).toString(36)}`;
      if(adopted&&id===adopted.id)textChunkStats.adopted++;else textChunkStats.named++;
      entry.chunk={id,bytes:utf8Length(entry.text)};
    }
    textChunkStats.referenced++;return entry.chunk;
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
  // Build 358 (lighter commands): serialization as steps. serializeSteps yields after each encoded collection and after
  // each top-level member of the final text, so an asynchronous caller (a durable command's save) can spread one save
  // over several frames; serialize() runs the same steps at once. The text is the same either way: the final object is
  // written member by member exactly as JSON.stringify writes a plain object.
  function serialize(state,options){const steps=serializeSteps(state,options);let step;while(!(step=steps.next()).done){}return step.value;}
  function* serializeSteps(state,{rowsText=null,textChunks=null}={}){
    if(!isPlain(state))return JSON.stringify(encodeState(state));
    const binaryPaths=[],fragments=[],live=new Set();let out=state;
    if(isArrayBuffer(state.fleet?.rows)){
      const path=['fleet','rows'],token=`\u0000gh-codec:${NONCE}:${fragments.length}\u0000`;
      fragments.push({token:JSON.stringify(token),text:rowsText===null?rowsMarkerText(state.fleet):rowsText});out=writePathCopy(out,path,token);binaryPaths.push(path);
    }
    const scan=scanPaths(out),paths=scan.paths;
    if(!paths.length&&!binaryPaths.length&&!scan.runs.length)return JSON.stringify(state);
    let segments=false;
    for(const path of paths){
      const value=readPath(out,path),key=JSON.stringify(path),split=segmented(value);if(split)segments=true;
      const layout=split?segmentBounds(value):null,parts=split?segmentSlices(value,layout):[value],texts=[];let cached=true;
      for(let index=0;index<parts.length;index++){
        const partKey=split?`${key}${layout.bounds[index].key.startsWith('#')?'':'@'}${layout.bounds[index].key}`:key,current=sealedMembers(parts[index]);
        if(!current){cached=false;break;}
        live.add(partKey);let entry=COLLECTION_TEXT.get(partKey);
        if(entry&&sameMembers(entry,current))collectionCacheStats.hits++;
        else{entry={keys:current.keys,members:current.members,text:JSON.stringify(encodeRows(parts[index]))};COLLECTION_TEXT.set(partKey,entry);collectionCacheStats.misses++;}
        if(textChunks&&entry.text.length>=TEXT_CHUNK_MIN){const chunk=textChunkOf(entry,partKey);textChunks.push({id:chunk.id,byteLength:chunk.bytes,text:entry.text});texts.push(`{"$ghText":"chunk-v1","id":${JSON.stringify(chunk.id)},"bytes":${chunk.bytes}}`);}
        else texts.push(entry.text);
      }
      if(!cached){out=writePathCopy(out,path,encodeCollection(value));yield;continue;}
      const text=split?`{"$gh":3,"a":${Array.isArray(value)?1:0},"g":[${texts.join(',')}]}`:texts[0];
      const token=`\u0000gh-codec:${NONCE}:${fragments.length}\u0000`;fragments.push({token:JSON.stringify(token),text});out=writePathCopy(out,path,token);yield;
    }
    for(const key of [...COLLECTION_TEXT.keys()])if(!live.has(key))COLLECTION_TEXT.delete(key);
    for(const {path,run} of scan.runs)out=writePathCopy(out,path,run);
    out.stateCodec=codecMeta(paths,binaryPaths,scan.runs,segments,textChunks?textChunks.map(chunk=>chunk.id):[]);
    const members=[];for(const key of Object.keys(out)){const json=JSON.stringify(out[key]);if(json!==undefined)members.push(`${JSON.stringify(key)}:${json}`);yield;}
    const text=`{${members.join(',')}}`;if(!fragments.length)return text;
    for(const fragment of fragments){fragment.at=text.indexOf(fragment.token);if(fragment.at<0||text.indexOf(fragment.token,fragment.at+1)>=0)throw new Error('state-codec-fragment-token');}
    fragments.sort((a,b)=>a.at-b.at);const parts=[];let cursor=0;
    for(const fragment of fragments){parts.push(text.slice(cursor,fragment.at),fragment.text);cursor=fragment.at+fragment.token.length;}
    parts.push(text.slice(cursor));return parts.join('');
  }
  function deserialize(json,options={}){return decodeState(JSON.parse(json),options);}
  // Build 358 (million-asset save): the save text with the record buffer as a 'chunks-v1' manifest. A chunk keeps its
  // id while its GH_FLEET_STORE.chunkStamp key (runtime, mass version, chunk version, length) is unchanged; a changed
  // chunk gets a fresh id `${session nonce}.${salt}.${sequence}`, unique without hashing (the vault hashes on receipt).
  // A store decoded from a chunked save adopts the ids it was read from (adoptChunkIds), so a fresh session uploads
  // only what it changes. Returns {text, chunks:[{id,index,byteOffset,byteLength}]}: every chunk of this save; the
  // caller uploads the ones the vault has not acknowledged. A checksum per id is kept and one reused chunk is
  // re-checked per save in rotation; a mismatch (a write that bypassed the store) renames every chunk (new salt), so
  // stale bytes are never referenced. Everything except fleet.rows is exactly serialize()'s text.
  const chunkIdCache=new WeakMap();let chunkSalt=0,chunkSequence=0,chunkCacheStats={reused:0,named:0,adopted:0,verified:0,mismatches:0};
  function chunkChecksum(bytes){const words=new Uint32Array(bytes.buffer,bytes.byteOffset,bytes.byteLength>>>2);let a=0x811c9dc5|0,b=0x01000193|0;const imul=Math.imul;for(let i=0;i<words.length;i++){a=imul(a^words[i],0x01000193);b=(b+a)|0;}for(let i=words.length*4;i<bytes.length;i++){a=imul(a^bytes[i],0x01000193);b=(b+a)|0;}return `${(a>>>0).toString(36)}.${(b>>>0).toString(36)}`;}
  function chunkGeometry(store){const STORE=globalThis.GH_FLEET_STORE;if(typeof STORE?.chunkStamp!=='function'||STORE.isStore?.(store)!==true)throw new Error('state-codec-chunks-need-store');const chunkBytes=STORE.CHUNK_ROWS*STORE.STRIDE,bytes=new Uint8Array(store.rows);return {STORE,chunkBytes,bytes,count:Math.ceil(bytes.length/chunkBytes)};}
  function chunkKey(stamp,index,length){return `${stamp.runtime}.${stamp.mass}.${stamp.versions[index]??0}.${length}`;}
  function adoptChunkIds(store,marker){
    if(!isPlain(marker)||marker.$ghBinary!=='chunks-v1'||!Array.isArray(marker.chunks))return false;
    const {STORE,chunkBytes,bytes,count}=chunkGeometry(store);if(marker.chunkBytes!==chunkBytes||marker.chunks.length!==count||marker.byteLength!==bytes.length)return false;
    const stamp=STORE.chunkStamp(store),entry={keys:[],ids:[],sums:[],rotation:0};
    for(let index=0;index<count;index++){const start=index*chunkBytes,length=Math.min(chunkBytes,bytes.length-start);entry.keys[index]=chunkKey(stamp,index,length);entry.ids[index]=marker.chunks[index];entry.sums[index]=chunkChecksum(bytes.subarray(start,start+length));}
    chunkIdCache.set(store,entry);chunkCacheStats.adopted+=count;return true;
  }
  function chunkManifest(store){
    const {STORE,chunkBytes,bytes,count}=chunkGeometry(store);
    let entry=chunkIdCache.get(store);if(!entry){entry={keys:[],ids:[],sums:[],rotation:0};chunkIdCache.set(store,entry);}
    const name=()=>{const stamp=STORE.chunkStamp(store),reused=[];
      for(let index=0;index<count;index++){
        const start=index*chunkBytes,length=Math.min(chunkBytes,bytes.length-start),key=chunkKey(stamp,index,length);
        if(entry.keys[index]===key&&entry.ids[index])reused.push(index);
        else{entry.keys[index]=key;entry.ids[index]=`${NONCE}.${chunkSalt}.${(++chunkSequence).toString(36)}`;entry.sums[index]=chunkChecksum(bytes.subarray(start,start+length));chunkCacheStats.named++;}
      }
      entry.keys.length=count;entry.ids.length=count;entry.sums.length=count;return reused;};
    const reused=name();chunkCacheStats.reused+=reused.length;
    if(reused.length){
      const index=reused[entry.rotation++%reused.length],start=index*chunkBytes;chunkCacheStats.verified++;
      if(chunkChecksum(bytes.subarray(start,Math.min(bytes.length,start+chunkBytes)))!==entry.sums[index]){
        chunkCacheStats.mismatches++;chunkSalt++;entry.keys=[];entry.ids=[];entry.sums=[];
        try{globalThis.console?.warn?.('state-codec: fleet chunk changed behind the store; renaming every chunk');}catch{}
        name();
      }
    }
    const ids=entry.ids.slice();
    return {marker:{$ghBinary:'chunks-v1',byteLength:bytes.length,chunkBytes,chunks:ids},chunks:ids.map((id,index)=>({id,index,byteOffset:index*chunkBytes,byteLength:Math.min(chunkBytes,bytes.length-index*chunkBytes)}))};
  }
  // Text chunks follow the fleet chunks as {id,byteLength,text}; the caller uploads the UTF-8 bytes of text.
  function serializeChunked(state){const steps=serializeChunkedSteps(state);let step;while(!(step=steps.next()).done){}return step.value;}
  function* serializeChunkedSteps(state){
    if(!isPlain(state)||!isArrayBuffer(state.fleet?.rows))return {text:yield* serializeSteps(state),chunks:[]};
    const manifest=chunkManifest(state.fleet),textChunks=[],text=yield* serializeSteps(state,{rowsText:JSON.stringify(manifest.marker),textChunks});
    return {text,chunks:[...manifest.chunks,...textChunks]};
  }

  const API=Object.freeze({VERSION,MIN_ROWS,encodeState,decodeState,serialize,serializeSteps,deserialize,selectPaths,serializeChunked,serializeChunkedSteps,adoptChunkIds,bytesToBase64:bytes=>base64Encode(bytes instanceof Uint8Array?bytes:new Uint8Array(bytes)),cacheStats:()=>({...collectionCacheStats,entries:COLLECTION_TEXT.size,rows:{...rowCacheStats},chunks:{...chunkCacheStats},text:{...textChunkStats,adoptable:ADOPTED_TEXT.size}}),textChunkMin:TEXT_CHUNK_MIN,isEncoded:tree=>isPlain(tree)&&own(tree,'stateCodec')});
  globalThis.GH_STATE_CODEC=API;
  if(globalThis.window&&globalThis.window!==globalThis)globalThis.window.GH_STATE_CODEC=API;
  if(typeof module!=='undefined'&&module.exports)module.exports=API;
})();

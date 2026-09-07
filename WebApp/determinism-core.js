(()=>{
  'use strict';
  const VERSION='2.9.0';
  function hashString(text){let h=2166136261>>>0;for(const ch of String(text)){h^=ch.charCodeAt(0);h=Math.imul(h,16777619)>>>0;}return h>>>0;}
  function ensure(state){
    if(!state||typeof state!=='object')throw new TypeError('Determinism state required');
    state.determinism=state.determinism&&typeof state.determinism==='object'?state.determinism:{};
    if(!Number.isInteger(state.determinism.seed)||state.determinism.seed===0)state.determinism.seed=(hashString(state.profile?.name||'Global Holdings')^0x9e3779b9)>>>0||1;
    state.determinism.streams=state.determinism.streams&&typeof state.determinism.streams==='object'?state.determinism.streams:{};
    state.sequences=state.sequences&&typeof state.sequences==='object'?state.sequences:{};
    return state.determinism;
  }
  function nextUint(state,stream='default'){
    const d=ensure(state),key=String(stream||'default');
    let x=Number(d.streams[key]);if(!Number.isInteger(x)||x===0)x=(d.seed^hashString(key))>>>0||1;
    x^=x<<13;x^=x>>>17;x^=x<<5;x>>>=0;d.streams[key]=x||1;return x>>>0;
  }
  function nextFloat(state,stream='default'){return nextUint(state,stream)/4294967296;}
  function nextId(state,prefix='ID'){
    ensure(state);const p=String(prefix||'ID').replace(/[^A-Z0-9_-]/gi,'').toUpperCase()||'ID';
    const n=(Number(state.sequences[p])||0)+1;state.sequences[p]=n;return `${p}-${String(n).padStart(8,'0')}`;
  }
  const API=Object.freeze({VERSION,ensure,nextUint,nextFloat,nextId,hashString});
  globalThis.GH_DETERMINISM=API;if(globalThis.window&&globalThis.window!==globalThis)globalThis.window.GH_DETERMINISM=API;
  if(typeof module!=='undefined'&&module.exports)module.exports=API;
})();

(()=>{
  'use strict';
  const VERSION='2.9.0';
  function ensure(state){state.dependencyGraph=state.dependencyGraph&&typeof state.dependencyGraph==='object'?state.dependencyGraph:{};const g=state.dependencyGraph;g.edges=Array.isArray(g.edges)?g.edges:[];g.updatedAtSim=Number(g.updatedAtSim)||0;return g;}
  function key(parent,child,type){return `${parent}|${child}|${type||'depends_on'}`;}
  function link(state,parentId,childId,type='depends_on',meta={}){const g=ensure(state),k=key(parentId,childId,type);let e=g.edges.find(x=>x.key===k);if(!e){e={key:k,parentId:String(parentId),childId:String(childId),type:String(type),status:'open',createdAtSim:Number(state.simSeconds)||0,meta:{...meta}};g.edges.push(e);}else e.meta={...(e.meta||{}),...meta};g.updatedAtSim=Number(state.simSeconds)||0;return e;}
  function setStatus(state,parentId,childId,type,status){const e=ensure(state).edges.find(x=>x.key===key(parentId,childId,type));if(!e)return false;e.status=String(status);e.updatedAtSim=Number(state.simSeconds)||0;return true;}
  function children(state,parentId){return ensure(state).edges.filter(e=>e.parentId===String(parentId));}
  function parents(state,childId){return ensure(state).edges.filter(e=>e.childId===String(childId));}
  function unresolved(state,parentId){return children(state,parentId).filter(e=>!['resolved','cancelled'].includes(e.status));}
  function detectCycles(state){const edges=ensure(state).edges,adj=new Map();for(const e of edges){if(['resolved','cancelled'].includes(e.status))continue;if(!adj.has(e.parentId))adj.set(e.parentId,[]);adj.get(e.parentId).push(e.childId);}const visiting=new Set(),done=new Set(),cycles=[];function dfs(n,path){if(visiting.has(n)){const i=path.indexOf(n);cycles.push(path.slice(i).concat(n));return;}if(done.has(n))return;visiting.add(n);for(const c of adj.get(n)||[])dfs(c,path.concat(c));visiting.delete(n);done.add(n);}for(const n of adj.keys())dfs(n,[n]);return cycles;}
  function compact(state,validIds=null){const g=ensure(state);if(validIds instanceof Set)g.edges=g.edges.filter(e=>validIds.has(e.parentId)||validIds.has(e.childId));if(g.edges.length>1600)g.edges=g.edges.slice(-1600);return g.edges.length;}
  const API=Object.freeze({VERSION,ensure,link,setStatus,children,parents,unresolved,detectCycles,compact});globalThis.GH_DEPENDENCY_CORE=API;if(globalThis.window&&globalThis.window!==globalThis)globalThis.window.GH_DEPENDENCY_CORE=API;if(typeof module!=='undefined'&&module.exports)module.exports=API;
})();

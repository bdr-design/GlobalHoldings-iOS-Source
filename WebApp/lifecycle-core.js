(()=>{
  'use strict';
  const VERSION='2.9.1';
  const DEFINITIONS={assetRequest:{
    awaiting_review:['awaiting_authorization','rejected','cancelled'],
    awaiting_authorization:['authorized','rejected','cancelled'],
    authorized:['blocked_funding','blocked_capacity','ordering','delivering','awaiting_authorization','cancelled'],
    blocked_funding:['authorized','blocked_capacity','ordering','awaiting_authorization','cancelled'],
    blocked_capacity:['authorized','blocked_funding','ordering','awaiting_authorization','cancelled'],
    ordering:['delivering','authorized','blocked_funding','blocked_capacity','cancelled'],
    delivering:['readiness','completed','cancelled'],readiness:['completed','cancelled'],completed:[],rejected:[],cancelled:[]
  }};
  function can(kind,from,to){if(from===to)return true;return (DEFINITIONS[kind]?.[from]||[]).includes(to);}
  function transition(state,entity,kind,to,meta={}){if(!entity||!kind)throw new Error('Lifecycle transition requires entity and kind.');const from=String(entity.status||'');to=String(to);if(!can(kind,from,to))throw new Error(`Lifecycle transition rejected: ${kind} ${from} -> ${to}`);if(from===to)return {changed:false,from,to};entity.status=to;entity.lifecycleRevision=(Number(entity.lifecycleRevision)||0)+1;entity.lastTransitionAt=Number(state.simSeconds)||0;entity.lastTransitionReason=String(meta.reason||meta.event||'transition');globalThis.GH_EVENT_LEDGER?.append?.(state,{type:String(meta.event||`${kind.toUpperCase()}_${to.toUpperCase()}`),domain:String(meta.domain||'operations'),entityType:kind,entityId:entity.id,correlationId:meta.correlationId||entity.correlationId||entity.id,actor:meta.actor||'system',detail:{from,to,reason:meta.reason||null,...(meta.detail||{})}});return {changed:true,from,to};}
  function validate(kind,status){return !!DEFINITIONS[kind]&&Object.prototype.hasOwnProperty.call(DEFINITIONS[kind],String(status));}
  const API=Object.freeze({VERSION,DEFINITIONS,can,transition,validate});globalThis.GH_LIFECYCLE_CORE=API;if(globalThis.window&&globalThis.window!==globalThis)globalThis.window.GH_LIFECYCLE_CORE=API;if(typeof module!=='undefined'&&module.exports)module.exports=API;
})();

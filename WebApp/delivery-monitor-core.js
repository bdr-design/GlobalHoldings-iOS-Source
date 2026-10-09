(()=>{
  'use strict';
  const VERSION='3.0.0';
  function ensure(state){delete state.demandClosure;state.deliveryClosure=state.deliveryClosure&&typeof state.deliveryClosure==='object'?state.deliveryClosure:{};const d=state.deliveryClosure;d.lastSweepSim=Number(d.lastSweepSim)||0;d.metrics=d.metrics&&typeof d.metrics==='object'?d.metrics:{};d.stalled=Array.isArray(d.stalled)?d.stalled:[];return d;}
  function inspect(state){const deliveries=state.realism?.procurement?.deliveries||[],now=Number(state.simSeconds)||0;let open=0,closed=0,blocked=0;const stalled=[];
    for(const row of deliveries){if(row.status==='pending'){open++;if(row.blockedReason)blocked++;const due=Number(row.dueAtSeconds);if(Number.isFinite(due)&&now-due>72*3600)stalled.push({id:row.id,status:row.status,ageHours:Math.floor((now-due)/3600),reason:row.blockedReason||'delivery-overdue'});}else if(['delivered','cancelled'].includes(row.status))closed++;}
    const total=open+closed;return {open,closed,blocked,delivering:open,readiness:0,closureRate:total?Math.round(closed/total*100):100,stalled:stalled.slice(0,80)};
  }
  function reconcile(state){const d=ensure(state),snapshot=inspect(state);d.metrics={open:snapshot.open,closed:snapshot.closed,blocked:snapshot.blocked,delivering:snapshot.delivering,readiness:snapshot.readiness,closureRate:snapshot.closureRate};d.stalled=snapshot.stalled;d.lastSweepSim=Number(state.simSeconds)||0;return {...d.metrics,stalled:d.stalled};}
  const API=Object.freeze({VERSION,ensure,inspect,reconcile});globalThis.GH_DELIVERY_MONITOR=API;if(globalThis.window&&globalThis.window!==globalThis)globalThis.window.GH_DELIVERY_MONITOR=API;if(typeof module!=='undefined'&&module.exports)module.exports=API;
})();

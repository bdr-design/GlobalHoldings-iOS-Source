(()=>{
  'use strict';
  const VERSION='2.9.0';
  function ensure(state){state.demandClosure=state.demandClosure&&typeof state.demandClosure==='object'?state.demandClosure:{};const d=state.demandClosure;delete d.lastSweepAtMs;d.lastSweepSim=Number(d.lastSweepSim)||0;d.metrics=d.metrics&&typeof d.metrics==='object'?d.metrics:{};d.stalled=Array.isArray(d.stalled)?d.stalled:[];return d;}
  function aiStatusResolved(x){return ['منفذ','مكتمل','مغلق','approved','completed','resolved'].includes(String(x?.status||''));}
  function reconcile(state){const d=ensure(state),reqs=state.advanced?.procurement?.assetRequests||[],ai=state.advanced?.ai?.requests||[],aiArchive=state.advanced?.ai?.requestArchive||[],deliveries=state.realism?.procurement?.deliveries||[];let open=0,blocked=0,delivering=0,readiness=0;const stalled=[];
    for(const r of reqs){if(['completed','rejected','cancelled'].includes(r.status))continue;open++;const correlation=r.correlationId||r.id;r.correlationId=correlation;for(const depId of r.linkedRequests||[]){const dep=ai.find(x=>x.id===depId)||aiArchive.find(x=>x.id===depId);const edge=globalThis.GH_DEPENDENCY_CORE?.link?.(state,r.id,depId,dep?.kind||'dependency',{company:r.company});if(edge)edge.status=dep?(aiStatusResolved(dep)?'resolved':'open'):'open';}
      for(const delivery of deliveries.filter(x=>x.requestRef===r.id)){const edge=globalThis.GH_DEPENDENCY_CORE?.link?.(state,r.id,delivery.id,'delivery',{company:r.company});if(edge)edge.status=delivery.status==='delivered'?'resolved':'open';}
      if(['blocked_funding','blocked_capacity','authorized'].includes(r.status)&&Array.isArray(r.blockers)&&r.blockers.length)blocked++;if(r.status==='delivering')delivering++;if(r.status==='readiness')readiness++;
      const ageHours=(Number(state.simSeconds)||0)/3600-Number(r.createdHour||0);if(ageHours>72&&!['delivering'].includes(r.status))stalled.push({id:r.id,status:r.status,ageHours:Math.floor(ageHours),blockers:[...(r.blockers||[])]});
    }
    const closed=state.advanced?.procurement?.assetClosureLog?.length||0,total=open+closed;d.metrics={open,closed,blocked,delivering,readiness,closureRate:total?Math.round(closed/total*100):100};d.stalled=stalled.slice(0,80);d.lastSweepSim=Number(state.simSeconds)||0;return {...d.metrics,stalled:d.stalled};
  }
  function requestFacts(state,r){const deliveries=(state.realism?.procurement?.deliveries||[]).filter(d=>d.requestRef===r.id),delivered=deliveries.filter(d=>d.status==='delivered').length,openDependencies=globalThis.GH_DEPENDENCY_CORE?.unresolved?.(state,r.id)?.length||0;return {requested:Math.max(1,Number(r.qty)||1),delivered,openDependencies};}
  function canClose(state,r,extra={}){return globalThis.GH_POLICY_CORE?.closure?.({...requestFacts(state,r),staffingGap:Number(extra.staffingGap)||0,integrityCritical:Number(extra.integrityCritical)||0})||{approved:false,blocked:[{message:'Policy Core unavailable'}]};}
  const API=Object.freeze({VERSION,ensure,reconcile,requestFacts,canClose});globalThis.GH_DEMAND_CLOSURE=API;if(globalThis.window&&globalThis.window!==globalThis)globalThis.window.GH_DEMAND_CLOSURE=API;if(typeof module!=='undefined'&&module.exports)module.exports=API;
})();

(()=>{
  'use strict';
  const VERSION='2.9.1',LIMIT=1200;
  function ensure(state){
    state.businessLedger=state.businessLedger&&typeof state.businessLedger==='object'?state.businessLedger:{};
    const l=state.businessLedger;
    l.events=Array.isArray(l.events)?l.events:[];
    l.sequence=Math.max(0,Number(l.sequence)||0);
    return l;
  }
  function append(state,input={}){
    const l=ensure(state);l.sequence+=1;
    const event={
      id:`EVT-${String(l.sequence).padStart(8,'0')}`,
      type:String(input.type||'EVENT'),
      domain:String(input.domain||'system'),
      entityType:String(input.entityType||'system'),
      entityId:input.entityId==null?null:String(input.entityId),
      correlationId:input.correlationId==null?null:String(input.correlationId),
      actor:String(input.actor||'system'),
      simSeconds:Number(state?.simSeconds)||0,
      detail:input.detail&&typeof input.detail==='object'?input.detail:{value:input.detail??null}
    };
    l.events.unshift(event);if(l.events.length>LIMIT)l.events.length=LIMIT;
    if(!event.detail?.controlEventId){try{globalThis.GH_CONTROL_PLANE?.ingestDomainEvent?.(state,event);}catch(_error){}}
    return event;
  }
  function forEntity(state,entityType,entityId,limit=80){return ensure(state).events.filter(e=>e.entityType===entityType&&e.entityId===String(entityId)).slice(0,limit);}
  function forCorrelation(state,id,limit=120){return ensure(state).events.filter(e=>e.correlationId===String(id)).slice(0,limit);}
  function summary(state){const l=ensure(state),byDomain={};for(const e of l.events)byDomain[e.domain]=(byDomain[e.domain]||0)+1;return {count:l.events.length,sequence:l.sequence,byDomain};}
  const API=Object.freeze({VERSION,LIMIT,ensure,append,forEntity,forCorrelation,summary});
  globalThis.GH_EVENT_LEDGER=API;if(globalThis.window&&globalThis.window!==globalThis)globalThis.window.GH_EVENT_LEDGER=API;if(typeof module!=='undefined'&&module.exports)module.exports=API;
})();

// Build 372: fleet passes that read every row (a million at the largest scale) as pure functions of the fleet, so the
// fleet engine's worker can run them on its replica (fleet-engine-worker 'query') and the main thread runs the same code
// when it cannot (no worker, or a replica that is not exactly its store). Each is the pass app.js made itself, with the
// same fields, predicates and row order, so both give the same result:
//   dispatchEligible: the shared international dispatch's pass (app.js dispatchSharedInternationalNetwork);
//   routeCards: the route center's per-route card counts and trip sums (app.js routeCenterLinkedSummary);
//   conditionSum: the insured fleet's condition total (realism-core fleetConditionSum, the daily close's insurance).
// The owner of a row is its ownerCompanyId or companyId; a row with neither is owned through the company platform's
// legacy mode table, which only the main thread has: a pass given no legacyOwner then returns {legacy:true} and the
// caller runs it on the main thread instead.
(()=>{
  'use strict';
  const VERSION='1.0.0';
  const DISPATCH_FIELDS=Object.freeze(['ownerCompanyId','companyId','assetMode','type','deliveryStatus','phase','departureScheduled','salePending','routeId']);
  const CARD_FIELDS=Object.freeze(['ownerCompanyId','companyId','assetMode','type','routeId','phase','departureScheduled','lastTrip','id']);
  const modeOf=row=>String(row?.assetMode||row?.type||'').trim();
  // app.js assetOwnerCompanyId, with the legacy mode table as a parameter.
  const ownerFn=(legacyOwner,flag)=>row=>{
    const explicit=row?.ownerCompanyId||row?.companyId;if(explicit)return String(explicit).trim();
    if(typeof legacyOwner!=='function'){flag.legacy=true;return '';}
    return String(legacyOwner(modeOf(row))||'').trim();
  };
  // The company's idle assets of this mode (first `limit` row indices, row order), the idle ones beyond (and how many of
  // them hold a route), and the assets per route (initial loads, in first-occurrence order).
  function dispatchEligible(state,fleet,{companyId,type,limit=20000,legacyOwner=null}={}){
    const flag={legacy:false},owner=ownerFn(legacyOwner,flag),indices=[],loads=new Map();let remaining=0,remainingOnRoutes=0;
    fleet.scan(state,DISPATCH_FIELDS,(row,index)=>{
      if(owner(row)!==companyId||modeOf(row)!==type)return;
      const idle=row.deliveryStatus!=='pending'&&row.phase!=='moving'&&!row.departureScheduled&&!row.salePending;
      if(idle&&indices.length<limit){indices.push(index);return;}
      if(idle){remaining++;if(row.routeId)remainingOnRoutes++;}
      if(row.routeId)loads.set(row.routeId,(loads.get(row.routeId)||0)+1);
    });
    if(flag.legacy)return {legacy:true};
    return {legacy:false,indices,remaining,remainingOnRoutes,initialLoads:[...loads]};
  }
  // What the route cards show about the company's assets on `routeIds`: per route the count, ready / scheduled / moving
  // counts, the first asset's id, and the trip margin and revenue sums in row order over assets with a last trip.
  function routeCards(state,fleet,{companyId,routeIds=[],legacyOwner=null}={}){
    const flag={legacy:false},owner=ownerFn(legacyOwner,flag),wanted=new Set(routeIds),out=new Map();
    if(!wanted.size)return {legacy:false,cards:[]};
    fleet.scan(state,CARD_FIELDS,row=>{
      if(!row.routeId||!wanted.has(row.routeId)||owner(row)!==companyId)return;
      let card=out.get(row.routeId);if(!card){card={count:0,turn:0,scheduled:0,inMotion:0,primaryId:row.id,scored:0,margin:0,revenue:0};out.set(row.routeId,card);}
      card.count++;if(row.phase==='turnaround'){if(row.departureScheduled)card.scheduled++;else card.turn++;}else if(row.phase==='moving')card.inMotion++;
      if(row.lastTrip){card.scored++;card.margin=card.margin+(Number(row.lastTrip.margin)||0);card.revenue=card.revenue+(Number(row.lastTrip.revenue)||0);}
    });
    if(flag.legacy)return {legacy:true};
    return {legacy:false,cards:[...out]};
  }
  // The insured fleet's condition total (realism-core fleetConditionSum): condition, or 100 without one, over every row
  // in row order, so the sum is the same number on either side.
  function conditionSum(state,fleet){let sum=0;fleet.scan(state,['condition'],row=>{sum+=Number(row.condition)||100;});return {legacy:false,sum};}
  const QUERIES=Object.freeze({dispatchEligible,routeCards,conditionSum});
  function run(name,state,fleet,params){const query=QUERIES[name];if(!query)throw new Error(`fleet-query-unknown:${name}`);return query(state,fleet,params||{});}
  const API=Object.freeze({VERSION,DISPATCH_FIELDS,CARD_FIELDS,dispatchEligible,routeCards,conditionSum,run,names:Object.freeze(Object.keys(QUERIES))});
  globalThis.GH_FLEET_QUERY=API;
  if(globalThis.window&&globalThis.window!==globalThis)globalThis.window.GH_FLEET_QUERY=API;
  if(typeof module!=='undefined'&&module.exports)module.exports=API;
})();

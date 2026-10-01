'use strict';
// Build 353: ordinary slices restore assets from a field preimage instead of a
// deep fleet clone, and validate guards without re-serializing every asset.
// Both must be observationally identical to the previous full-clone / string
// comparison behaviour.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const {ROOT}=require('./helpers/core-harness'),{scenario}=require('./helpers/business-scenario');
const app=fs.readFileSync(path.join(ROOT,'WebApp/app.js'),'utf8'),results=[];
function fragment(start,end){const a=app.indexOf(start),b=app.indexOf(end,a);assert(a>=0&&b>a,`missing app fragment ${start}`);return app.slice(a,b);}
function environment(count=3){
 const e=scenario();e.manualPurchase(1);e.s.GH_REALISM.onSimulationTime(e.state,60);const seed=structuredClone(e.state.assets[0]);
 e.state.assets=Array.from({length:count},(_,i)=>({...structuredClone(seed),id:`B353-${i}`,routeId:'B353-R',phase:'moving',progress:0}));e.state.speed=0;e.state.todayProfit=0;
 // One asset lacks optional patch fields so rollback must delete keys the slice added.
 for(const field of ['departureScheduledAt','simulationFault','lastTrip','simCarrySeconds'])delete e.state.assets[0][field];
 const route={id:'B353-R',type:'air',routeMode:'air',ownerCompanyId:'air',route:[[24.7,46.7],[25,47]],tripSeconds:1000,distanceKm:100};
 Object.assign(e.s,{state:e.state,COMPANY_PLATFORM:e.s.GH_COMPANY_PLATFORM,routeTemplates:{'B353-R':route},competitorAssets:[],BASE_ROUTE_IDS:new Set(['B353-R']),clone:value=>value===undefined?undefined:structuredClone(value),routeDistance:()=>1000,queueAssetSaleFinalize:()=>{},processFinancialDay:()=>{},processMarket:()=>{},
  processAssetDraft:(asset,_seconds,effects)=>{asset.progress=.4;asset.fuel=11;asset.lastTrip={revenue:7,at:30};asset.departureScheduledAt=99;effects.todayProfit+=1;effects.sectorProfit.air=(effects.sectorProfit.air||0)+1;effects.alerts.push(`slice ${asset.id}`);},
  SIMULATION_ASSET_ENGINE:require('../WebApp/simulation-asset-core.js'),simulationAssetRuntimeContext:()=>({workerCompatible:false}),diag:()=>{}});
 vm.runInContext(fragment('  function makeSimulationEffects()', '  // Pure simulation draft:'),e.s);
 vm.runInContext(fragment('  const SIMULATION_TRANSACTION_SCOPE=', "  if(!window.GH_TRANSACTION_CORE?.execute)throw new Error('Transaction Core compatibility"),e.s);
 return {...e,job:meta=>e.s.createSimulationSliceJob(30,{from:e.state.simSeconds,to:e.state.simSeconds+30,speed:30,...meta})};
}
function complete(job){while(!job.runChunk(32)){}return job;}
function test(name,fn){try{results.push({name,ok:true,detail:fn()});}catch(error){results.push({name,ok:false,error:String(error.stack||error)});}}
const assetOrder=state=>state.assets.map(asset=>Object.keys(asset).join(','));

test('ordinary slice does not clone the fleet and still declares assets as a write root',()=>{
 const e=environment(4),job=complete(e.job());assert.equal(job.finish().committed,true);
 const metric=e.s.GH_TRANSACTION_CORE.telemetry().last;assert.equal(metric.rollbackStorage,'legacy-scoped');assert.equal(metric.fullSnapshot,false);
 const rollbackScope=vm.runInContext('SIMULATION_STEADY_ROLLBACK_SCOPE',e.s),declared=vm.runInContext('SIMULATION_STEADY_TRANSACTION_SCOPE',e.s);assert.equal(metric.scopeSize,rollbackScope.length);assert(!rollbackScope.includes('assets'));assert(declared.includes('assets'));
 assert.equal(e.state.assets[0].progress,.4);assert.equal(e.state.assets[0].departureScheduledAt,99);return {scopeSize:metric.scopeSize};
});

test('a late failure after every asset patch restores the exact pre-slice state, key order included',()=>{
 const e=environment(5),before=JSON.stringify(e.state),order=assetOrder(e.state),job=complete(e.job());
 const operations=e.s.GH_OPERATIONS_CORE,original=operations.execute;
 e.s.GH_OPERATIONS_CORE={...operations,execute(ctx,command,payload){if(command==='record-alert')throw new Error('b353-late-alert-fault');return original(ctx,command,payload);}};
 try{assert.throws(()=>job.finish(),/b353-late-alert-fault/);}finally{e.s.GH_OPERATIONS_CORE=operations;}
 assert.equal(JSON.stringify(e.state),before);assert.deepEqual(assetOrder(e.state),order);
 assert(!Object.prototype.hasOwnProperty.call(e.state.assets[0],'departureScheduledAt'),'a field the slice added must be removed again');
 // A retry of the same interval still commits normally.
 const retry=complete(e.job());assert.equal(retry.finish().committed,true);assert.equal(e.state.simSeconds,30);return {restored:true};
});

test('rollback after a scoped-to-full promotion inside apply is still exact',()=>{
 const e=environment(3),before=JSON.stringify(e.state),job=complete(e.job()),tx=e.s.GH_TRANSACTION_CORE;
 const finance=e.s.GH_FINANCE_CORE,original=finance.execute;
 e.s.GH_FINANCE_CORE={...finance,execute(ctx,command,payload,meta){if(command!=='apply-simulation-journal')return original(ctx,command,payload,meta);
  // A joined writer promotes the scoped snapshot to a full one AFTER assets were patched.
  tx.join(e.state,{label:'b353-join',apply:()=>{e.state.cash=(Number(e.state.cash)||0)+5;}});throw new Error('b353-after-join-fault');}};
 try{assert.throws(()=>job.finish(),/b353-after-join-fault/);}finally{e.s.GH_FINANCE_CORE=finance;}
 assert.equal(JSON.stringify(e.state),before);return {restored:true};
});

test('device A/B switch restores the Build 352 asset clone scope',()=>{
 const e=environment(2);e.s.__GH_DISABLE_ASSET_PREIMAGE_ROLLBACK__=true;
 try{const job=complete(e.job());assert.equal(job.finish().committed,true);const metric=e.s.GH_TRANSACTION_CORE.telemetry().last;assert.equal(metric.scopeSize,vm.runInContext('SIMULATION_STEADY_TRANSACTION_SCOPE',e.s).length);}
 finally{delete e.s.__GH_DISABLE_ASSET_PREIMAGE_ROLLBACK__;}
 return {legacyScope:true};
});

test('bulk trip completions are summarized per company; exceptions and small fleets stay verbatim',()=>{
 const trip=(e,count)=>{e.s.processAssetDraft=(asset,_seconds,effects)=>{asset.progress=.5;effects.tripCount.air=(effects.tripCount.air||0)+1;effects.tripRevenue.air=(effects.tripRevenue.air||0)+100;effects.tripFuel.air=(effects.tripFuel.air||0)+10;effects.tripMaintenance.air=(effects.tripMaintenance.air||0)+5;effects.tripProfit.air=(effects.tripProfit.air||0)+85;effects.alerts.push(`${asset.id} أكمل رحلة. إيراد $100 − وقود $10 − صيانة $5 = هامش الرحلة $85. الراتب الثابت يُصرف في مسير 27.`);if(asset.id.endsWith('-0'))effects.alerts.push(`${asset.id}: اكتمل المسار القديم المشترك`);};return complete(e.job()).finish();};
 const big=environment(8),beforeAlerts=big.state.alerts.length;assert.equal(trip(big,8).committed,true);
 const added=big.state.alerts.slice(0,big.state.alerts.length-beforeAlerts);
 assert.equal(added.filter(text=>/أكمل رحلة/.test(text)).length,0,'no per-trip spam');assert.equal(added.filter(text=>/اكتملت 8 رحلة/.test(text)).length,1,'one exact company summary');
 assert(added.some(text=>/اكتمل المسار القديم المشترك/.test(text)),'non-trip alerts are kept');assert(/اكتمل المسار القديم المشترك/.test(added[0]),'exceptions stay on top');
 const small=environment(2),smallBefore=small.state.alerts.length;assert.equal(trip(small,2).committed,true);
 const smallAdded=small.state.alerts.slice(0,small.state.alerts.length-smallBefore);assert.equal(smallAdded.filter(text=>/أكمل رحلة/.test(text)).length,2,'small fleets keep individual trip alerts');
 return {summary:added.find(text=>/اكتملت/.test(text))};
});

test('boundary and delivery slices keep cloning assets',()=>{
 const e=environment(2),job=complete(e.job({boundary:{day:1,hour:24}}));assert.equal(job.finish().committed,true);
 assert.equal(e.s.GH_TRANSACTION_CORE.telemetry().last.fullSnapshot,true);
 const delivery=environment(2);delivery.s.GH_REALISM={...delivery.s.GH_REALISM,hasPendingDeliveries:()=>true,onSimulationTime:()=>{}};
 const pending=complete(delivery.job());assert.equal(pending.finish().committed,true);const metric=delivery.s.GH_TRANSACTION_CORE.telemetry().last;
 assert.equal(metric.scopeSize,vm.runInContext('SIMULATION_TRANSACTION_SCOPE',delivery.s).length);return {boundaryFull:true,deliveryScope:metric.scopeSize};
});

test('fast guard comparison agrees with the JSON string guard on adversarial values',()=>{
 const e=environment(1),s=e.s,fields=vm.runInContext('SIMULATION_ASSET_GUARD_FIELDS',s);let seed=12345;
 const rand=()=>(seed=(seed*1103515245+12345)>>>0)/4294967296,pick=list=>list[Math.floor(rand()*list.length)];
 const scalars=[0,-0,1,1.5,-7,NaN,Infinity,-Infinity,'','x','٣',true,false,null,undefined];
 const exotic=()=>[new Date(0),new Number(3),[1,,3],[undefined,()=>1],{a:undefined,b:1},{b:1,a:2},{toJSON(){return 'J';}},Object.assign(Object.create({inherited:1}),{own:2}),new Map([[1,2]]),Symbol('s'),()=>0,[],{}];
 const value=depth=>{const r=rand();if(depth>2||r<.45)return pick(scalars);if(r<.6)return pick(exotic());if(r<.8)return Array.from({length:Math.floor(rand()*3)},()=>value(depth+1));const out={};for(const key of ['a','b','c'].sort(()=>rand()-.5))if(rand()<.7)out[key]=value(depth+1);return out;};
 const shallow=asset=>{const copy={};for(const key of Object.keys(asset))copy[key]=asset[key];return copy;};
 const base=structuredClone(e.state.assets[0]);let decisions=0,accepted=0;
 for(let round=0;round<4000;round++){
  const asset=structuredClone(base);
  for(let n=Math.floor(rand()*3);n>=0;n--){const field=pick(fields);if(rand()<.2)delete asset[field];else asset[field]=value(0);}
  let guard;try{guard=s.simulationAssetGuard(asset,false);}catch{continue;}
  const parsed=JSON.parse(guard),mutated=shallow(asset);
  if(rand()<.6){const field=pick(fields),r=rand();
   if(r<.3)delete mutated[field];
   else if(r<.5&&mutated[field]&&typeof mutated[field]==='object'&&!Array.isArray(mutated[field])){const moved={};for(const key of Object.keys(mutated[field]).reverse())moved[key]=mutated[field][key];mutated[field]=moved;}
   else mutated[field]=value(0);}
  for(const candidate of [asset,mutated]){
   let expected,threw=false;try{expected=s.simulationAssetGuard(candidate,false)===guard;}catch{threw=true;}
   let actual,actualThrew=false;try{actual=s.simulationAssetGuardMatches(candidate,guard,parsed);}catch{actualThrew=true;}
   assert.equal(actualThrew,threw,`throw behaviour differs at round ${round}`);
   if(!threw){assert.equal(actual,expected,`guard decision differs at round ${round}: ${guard}`);decisions++;if(actual)accepted++;}
  }
 }
 assert(decisions>6000&&accepted>1000&&accepted<decisions,'the fuzz must cover both accepted and rejected guards');
 // An unchanged asset is accepted without serializing it again.
 const original=s.simulationAssetGuard,asset=structuredClone(base),guard=original(asset,false),parsed=JSON.parse(guard);let serialized=0;
 s.simulationAssetGuard=(...args)=>{serialized++;return original(...args);};
 try{assert.equal(s.simulationAssetGuardMatches(asset,guard,parsed),true);assert.equal(serialized,0);asset.fuel=Number(asset.fuel||0)+1;assert.equal(s.simulationAssetGuardMatches(asset,guard,parsed),false);assert.equal(serialized,1,'a mismatch is confirmed by the original string guard');}
 finally{s.simulationAssetGuard=original;}
 return {decisions,accepted};
});

const passed=results.filter(row=>row.ok).length;
console.log(JSON.stringify({suite:'build353-steady-slice-rollback',scope:'actual app slice factory and transaction owner; injected asset economics and faults',passed,total:results.length,results},null,2));
if(passed!==results.length)process.exitCode=1;

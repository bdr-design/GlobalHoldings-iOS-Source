'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {chromium}=require('playwright'),{boot}=require('./helpers/local-dom-app'),{scenario}=require('./helpers/business-scenario');
const out=path.resolve(process.env.GH_LOCAL_EVIDENCE||path.join(__dirname,'../verification/current-r2-map-local'));fs.mkdirSync(out,{recursive:true});
(async()=>{
 const browser=await chromium.launch({headless:true}),results=[],errors=[];let passed=false;
 try{
  const {page}=await boot({browser,errors});const e=scenario();e.manualPurchase(1);e.s.GH_REALISM.onSimulationTime(e.state,60);
  const result=await page.evaluate(async fixture=>{
   // Since Build 357 the live fleet is a record store: the Node fixture's plain assets (and the test fleets below) go into
   // one, and assets are read through GH_FLEET_DATA. A plain state.assets array would stay beside the store, unsimulated.
   // replaceLiveState keeps the live store (a journaled root), so the test installs each fleet after replacing the rest.
   const a=__AUDIT__,s=__GH_STATE__,F=GH_FLEET_DATA,toStore=(target,assets)=>{target.fleet=GH_FLEET_STORE.fromAssets(assets,{at:Number(target.simSeconds)||0});delete target.assets;return target;};
   const drainJob=async job=>{for(let step=0;step<2000;step++){const progress=job.runChunk(32,{deadline:performance.now()+4});if(progress===true||progress?.done===true)return;await new Promise(resolve=>setTimeout(resolve,0));}throw Error('slice did not finish cooperatively');};
   const replace=next=>{a.replaceLiveState(next);s.fleet=next.fleet;};
   const base=toStore({...structuredClone(s),...fixture},fixture.assets||[]);replace(base);s.speed=0;a.simulationEngine.reset(performance.now(),'r2-multiroute-regression');
   const reference=structuredClone(a.routeTemplates.AIR_RUH_LHR),initial=structuredClone(s),seed=structuredClone(fixture.assets[0]),runs=[];
   for(const size of [1000,5000]){
    const state=structuredClone(initial),routes=Array.from({length:100},(_,i)=>({...structuredClone(reference),id:`R2-MAP-ROUTE-${i}`,ownerCompanyId:'air',routeMode:'air',type:'air',fromFacility:'B1',route:[[8+(i%10)*4,-100+Math.floor(i/10)*20],[13+(i%10)*4,-85+Math.floor(i/10)*20]],tripSeconds:6000,referenceOnly:false}));
    state.customRoutes=routes;toStore(state,Array.from({length:size},(_,i)=>({...structuredClone(seed),id:`R2-MAP-${i}`,routeId:routes[i%routes.length].id,phase:'moving',tripSeconds:6000,progress:(i%7)/50,reverse:false})));replace(state);for(const route of Object.values(a.routeTemplates))if(route.id?.startsWith('R2-MAP-'))a.prepareRoute(route);
    a.renderMap();a.updateMarkerPositions(true);const snapshots=[a.mapMetrics()],beforePosition=a.assetPosition(F.get(s,'R2-MAP-0')),started=performance.now();
    for(let i=0;i<8;i++){
     const job=a.createSimulationSliceJob(30,{from:s.simSeconds,to:s.simSeconds+30,speed:30});await drainJob(job);const outcome=job.finish();if(!outcome.committed)throw Error(`slice rejected: ${outcome.reason}`);
     a.renderMap();a.updateMarkerPositions(true);a.animateMapMarkerPositions(performance.now()+1000);snapshots.push(a.mapMetrics());
    }
    const afterPosition=a.assetPosition(F.get(s,'R2-MAP-0')),live=F.list(s);runs.push({size,distinctRoutes:routes.length,simSeconds:s.simSeconds,elapsedWorkMs:performance.now()-started,beforePosition,afterPosition,snapshots,allMoving:live.every(x=>x.phase==='moving'),faults:live.filter(x=>x.simulationFault).map(x=>x.id),assetCount:F.size(s),legacyArray:Array.isArray(s.assets)});
   }return runs;
  },e.state);
  for(const run of result){assert.equal(run.assetCount,run.size);assert.equal(run.legacyArray,false,'the fleet lives in the store only');assert(run.allMoving);assert.deepEqual(run.faults,[]);assert.notDeepEqual(run.beforePosition,run.afterPosition);assert.equal(run.simSeconds,240);for(const m of run.snapshots){assert(m.layers<400,'large fleet must remain clustered, not create one layer per asset');assert(m.dom<2000,'bounded local DOM');}assert(Math.max(...run.snapshots.map(x=>x.layers))-Math.min(...run.snapshots.map(x=>x.layers))<120,'repeated renders must not retain whole prior fleets');results.push(run);}
  await page.screenshot({path:path.join(out,'multiroute-map.png')});assert.deepEqual(errors,[]);passed=true;
 }finally{fs.writeFileSync(path.join(out,'results.json'),JSON.stringify({passed,environment:'Chromium local DOM with original Leaflet; 100 synthetic route geometries; single air owner; real slice processor, not 5000 actual purchase commands; no map network, WebKit, native save or thermal test',results,errors},null,2));await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});

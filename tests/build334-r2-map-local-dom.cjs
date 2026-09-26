'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {chromium}=require('playwright'),{boot}=require('./helpers/local-dom-app'),{scenario}=require('./helpers/business-scenario');
const out=path.resolve(process.env.GH_LOCAL_EVIDENCE||path.join(__dirname,'../verification/current-r2-map-local'));fs.mkdirSync(out,{recursive:true});
(async()=>{
 const browser=await chromium.launch({headless:true}),results=[],errors=[];let passed=false;
 try{
  const {page}=await boot({browser,errors});const e=scenario();e.manualPurchase(1);e.s.GH_REALISM.onSimulationTime(e.state,60);
  const result=await page.evaluate(fixture=>{
   const a=__AUDIT__,s=__GH_STATE__,base={...structuredClone(s),...fixture};a.replaceLiveState(base);s.speed=0;a.simulationEngine.reset(performance.now(),'r2-multiroute-regression');
   const reference=structuredClone(a.routeTemplates.AIR_RUH_LHR),initial=structuredClone(s),seed=structuredClone(s.assets[0]),runs=[];
   for(const size of [1000,5000]){
    const state=structuredClone(initial),routes=Array.from({length:100},(_,i)=>({...structuredClone(reference),id:`R2-MAP-ROUTE-${i}`,ownerCompanyId:'air',routeMode:'air',type:'air',fromFacility:'B1',route:[[8+(i%10)*4,-100+Math.floor(i/10)*20],[13+(i%10)*4,-85+Math.floor(i/10)*20]],tripSeconds:6000,referenceOnly:false}));
    state.customRoutes=routes;state.assets=Array.from({length:size},(_,i)=>({...structuredClone(seed),id:`R2-MAP-${i}`,routeId:routes[i%routes.length].id,phase:'moving',tripSeconds:6000,progress:(i%7)/50,reverse:false}));a.replaceLiveState(state);for(const route of Object.values(a.routeTemplates))if(route.id?.startsWith('R2-MAP-'))a.prepareRoute(route);
    a.renderMap();a.updateMarkerPositions(true);const snapshots=[a.mapMetrics()],beforePosition=a.assetPosition(s.assets[0]),started=performance.now();
    for(let i=0;i<8;i++){
     const job=a.createSimulationSliceJob(30,{from:s.simSeconds,to:s.simSeconds+30,speed:30});while(!job.runChunk(32,{deadline:performance.now()+4})){}const outcome=job.finish();if(!outcome.committed)throw Error(`slice rejected: ${outcome.reason}`);
     a.renderMap();a.updateMarkerPositions(true);a.animateMapMarkerPositions(performance.now()+1000);snapshots.push(a.mapMetrics());
    }
    const afterPosition=a.assetPosition(s.assets[0]);runs.push({size,distinctRoutes:routes.length,simSeconds:s.simSeconds,elapsedWorkMs:performance.now()-started,beforePosition,afterPosition,snapshots,allMoving:s.assets.every(x=>x.phase==='moving'),faults:s.assets.filter(x=>x.simulationFault).map(x=>x.id),assetCount:s.assets.length});
   }return runs;
  },e.state);
  for(const run of result){assert.equal(run.assetCount,run.size);assert(run.allMoving);assert.deepEqual(run.faults,[]);assert.notDeepEqual(run.beforePosition,run.afterPosition);assert.equal(run.simSeconds,240);for(const m of run.snapshots){assert(m.layers<400,'large fleet must remain clustered, not create one layer per asset');assert(m.dom<2000,'bounded local DOM');}assert(Math.max(...run.snapshots.map(x=>x.layers))-Math.min(...run.snapshots.map(x=>x.layers))<120,'repeated renders must not retain whole prior fleets');results.push(run);}
  await page.screenshot({path:path.join(out,'multiroute-map.png')});assert.deepEqual(errors,[]);passed=true;
 }finally{fs.writeFileSync(path.join(out,'results.json'),JSON.stringify({passed,environment:'Chromium local DOM with original Leaflet; 100 synthetic route geometries; single air owner; real slice processor, not 5000 actual purchase commands; no map network, WebKit, native save or thermal test',results,errors},null,2));await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});

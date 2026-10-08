'use strict';
const assert=require('assert');
const {boot}=require('./helpers/local-dom-app');
(async()=>{
  const env=await boot(),{page,browser,errors}=env;
  try{
    const before=await page.evaluate(()=>({time:__GH_STATE__.simSeconds,fleet:GH_FLEET_DATA.size(__GH_STATE__),vehicles:(__GH_STATE__.mobility?.vehicles||[]).length}));
    assert.equal(before.fleet,0);assert.equal(before.vehicles,0);
    const result=await page.evaluate(()=>{const target=(Math.floor(__GH_STATE__.simSeconds/86400)+1)*86400;const request=__AUDIT__.simulationEngine.advanceTo(target,{speed:600,batchSeconds:3600,reason:'qa-empty-aggregate',maxSeconds:86400});__AUDIT__.simulationRuntime.wake();return {request,target};});
    assert.equal(result.request.accepted,true);
    await page.waitForFunction(target=>__GH_STATE__.simSeconds>=target&&!__AUDIT__.simulationEngine.snapshot().manualAdvance,result.target,{timeout:30000});
    const after=await page.evaluate(()=>({time:__GH_STATE__.simSeconds,day:__GH_STATE__.lastFinancialDay,hour:__GH_STATE__.lastMarketHour,health:__AUDIT__.simulationEngine.snapshot(),runtime:__AUDIT__.simulationRuntime.snapshot()}));
    assert.equal(after.time,result.target);assert.equal(after.day,Math.floor(result.target/86400));assert.equal(after.hour,Math.floor(result.target/3600),'all hourly market boundaries remain sequential inside the aggregate');
    assert(after.health.aggregateSlices>=1);assert(after.health.jobCleanups>=1);assert.equal(after.health.cleanupErrors,0);assert.equal(after.health.jobActive,false);assert.equal(after.runtime.pending,true);assert.equal(errors.length,0,errors.join('\n'));
    const lifecycle=await page.evaluate(()=>{window.dispatchEvent(new PageTransitionEvent('pagehide',{persisted:true}));const hidden={engine:__AUDIT__.simulationEngine.snapshot(),runtime:__AUDIT__.simulationRuntime.snapshot()};window.dispatchEvent(new PageTransitionEvent('pageshow',{persisted:true}));const restored={engine:__AUDIT__.simulationEngine.snapshot(),runtime:__AUDIT__.simulationRuntime.snapshot()};return {hidden,restored};});
    assert.equal(lifecycle.hidden.runtime.running,false);assert.equal(lifecycle.hidden.runtime.pending,false);assert.equal(lifecycle.hidden.engine.jobActive,false,'pagehide must release a staged simulation job');assert.equal(lifecycle.restored.runtime.running,true);assert.equal(lifecycle.restored.runtime.pending,true);
    console.log(JSON.stringify({suite:'build362-empty-calendar-browser',secondsAdvanced:after.time-before.time,aggregateSlices:after.health.aggregateSlices,jobCleanups:after.health.jobCleanups,lastMarketHour:after.hour,lastFinancialDay:after.day,runtimePending:after.runtime.pending,pageLifecycleRestored:lifecycle.restored.runtime.running}));
  }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exit(1);});

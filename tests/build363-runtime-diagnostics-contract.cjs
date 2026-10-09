'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
process.env.GH_TEST_SOURCE_DIR=process.env.GH_TEST_SOURCE_DIR||path.resolve(__dirname,'..');
const D=require('../WebApp/diagnostics-core.js');

let now=0;const events=[],coalescer=D.createGovernorEventCoalescer({nowMs:()=>now,windowMs:10000,emit:row=>events.push(row)});
let out=coalescer.observe({level:'GREEN',stage:'finish',took:1,avgWorkMs:1,avgChunkMs:.5,speed:30});
assert.equal(events.length,1);assert.equal(out.transitions,1);assert.equal(out.reason,'interval');
now=100;assert.equal(coalescer.observe({level:'YELLOW',stage:'chunk',took:7,avgWorkMs:5,avgChunkMs:4,speed:600}),null);
now=9900;assert.equal(coalescer.observe({level:'GREEN',stage:'finish',took:2,avgWorkMs:2,avgChunkMs:1,speed:600}),null);
assert.equal(events.length,1,'benign governor transitions flooded diagnostics inside the window');
now=10000;out=coalescer.observe({level:'YELLOW',stage:'create',took:8,avgWorkMs:6,avgChunkMs:4,speed:600});
assert.equal(events.length,2);assert.equal(out.transitions,3);assert.equal(out.levels.YELLOW,2);assert.equal(out.levels.GREEN,1);assert.equal(out.peakLevel,'YELLOW');assert.equal(out.maxTook,8);
now=10100;assert.equal(coalescer.observe({level:'GREEN',stage:'finish',took:1}),null);
now=10200;out=coalescer.observe({level:'ORANGE',stage:'chunk',took:31,avgWorkMs:29});
assert.equal(events.length,3);assert.equal(out.reason,'pressure-escalation');assert.equal(out.transitions,2);assert.equal(out.peakLevel,'ORANGE');assert.equal(out.maxTook,31);
now=10300;out=coalescer.observe({level:'RED',stage:'finish',took:125,avgWorkMs:121});
assert.equal(events.length,4,'RED must be emitted immediately');assert.equal(out.transitions,1);assert.equal(out.peakLevel,'RED');
for(let index=0;index<100;index++){now=10400+index*50;coalescer.observe({level:index%2?'GREEN':'YELLOW',stage:'chunk',took:index%2?1:6});}
assert.equal(events.length,4,'rapid GREEN/YELLOW changes must stay bounded');
const pending=coalescer.snapshot();assert.equal(pending.pendingTransitions,100);assert.equal(pending.peakLevel,'YELLOW');
out=coalescer.flush('diagnostic-export');assert.equal(events.length,5);assert.equal(out.transitions,100);assert.equal(out.reason,'diagnostic-export');assert.equal(coalescer.snapshot().pendingTransitions,0);

let attributionNow=0;const attributionEvents=[],attribution=D.createGovernorEventCoalescer({nowMs:()=>attributionNow,windowMs:10000,emit:row=>attributionEvents.push(row)});
attribution.observe({level:'RED',stage:'seed',took:1});attributionNow=1;attribution.observe({level:'RED',stage:'create',took:121});attributionNow=2;attribution.observe({level:'RED',stage:'finish',took:999});
out=attribution.flush('attribution');assert.equal(out.peakLevel,'RED');assert.equal(out.peakStage,'create','peakStage identifies the first stage that reached the peak pressure level');assert.equal(out.maxTook,999);assert.equal(out.maxTookStage,'finish','the slowest duration must retain its own stage attribution');
attributionNow=3;attribution.observe({level:'GREEN',stage:'chunk',took:2});assert.equal(attribution.discard(),1);assert.equal(attribution.flush('after-clear'),null,'clearing diagnostics must not resurrect a pending governor window');
attributionNow=4;out=attribution.observe({level:'RED',stage:'seed',took:30});assert.equal(out.reason,'pressure-escalation','discard resets the emission cadence');attributionNow=5;attribution.observe({level:'GREEN',stage:'chunk',took:1});attribution.flush('manual-flush');attributionNow=6;out=attribution.observe({level:'ORANGE',stage:'finish',took:40});assert.equal(out.reason,'pressure-escalation','flushing a benign window must allow a later ORANGE escalation inside ten seconds');

let pressureNow=0;const pressureEvents=[],pressure=D.createGovernorEventCoalescer({nowMs:()=>pressureNow,windowMs:10000,emit:row=>pressureEvents.push(row)});
pressure.observe({level:'ORANGE',stage:'chunk',took:30});pressureNow=10;pressure.observe({level:'RED',stage:'finish',took:130});
for(let index=0;index<100;index++){pressureNow=20+index*50;pressure.observe({level:index%2?'ORANGE':'RED',stage:'chunk',took:index%2?31:140+index});}
assert.equal(pressureEvents.length,2,'ORANGE/RED oscillation flooded diagnostics inside the pressure window');assert.equal(pressureEvents[0].peakLevel,'ORANGE');assert.equal(pressureEvents[1].peakLevel,'RED');
pressureNow=10010;out=pressure.observe({level:'ORANGE',stage:'finish',took:35});assert.equal(pressureEvents.length,3);assert.ok(out.transitions>=100);assert.equal(out.peakLevel,'RED');assert.ok(out.maxTook>=238,'coalesced pressure lost the worst duration');

const {harness,minimal}=require('./helpers/core-harness');
{
  const {s}=harness(['advanced-core']);assert.equal(s.GH_ADVANCED.diagnosticSpeedLabel({speed:1,effectiveRate:30,requestedRate:30,manualAdvance:false}),'×30');assert.equal(s.GH_ADVANCED.diagnosticSpeedLabel({speed:1,effectiveRate:30,requestedRate:600,manualAdvance:true}),'×600 · تقويم');
}
{
  const {s}=harness(['diagnostics-core','delivery-monitor-core','event-ledger-core','workflow-core']),state=minimal();state.saveVersion='3.0.0';state.speed=1;state.cash=100;state.debt=0;state.groupValue=100;state.eventLog=[];state.realism={procurement:{deliveries:[{id:'DUE',status:'pending',dueAtSeconds:-400000,blockedReason:'port'}]}};state.demandClosure={legacy:true};
  s.GH_DIAGNOSTICS.ensure(state);const before=JSON.stringify(state),bundle=s.GH_DIAGNOSTICS.exportBundle(state,{appVersion:'3.0.0',saveSchemaVersion:'3.0.0',simulation:{speed:1}});assert.equal(bundle.deliveryClosure.open,1);assert.equal(bundle.deliveryClosure.stalled.length,1);assert.equal(JSON.stringify(state),before,'diagnostic export must be a read-only snapshot of the complete save state');
}
{
  const {s}=harness(['diagnostics-core','delivery-monitor-core','event-ledger-core','workflow-core','control-plane-core']),state=minimal();state.saveVersion='3.0.0';state.speed=1;state.cash=100;state.debt=0;state.groupValue=100;state.eventLog=[];state.realism={procurement:{deliveries:[]}};s.GH_DIAGNOSTICS.ensure(state);s.GH_CONTROL_PLANE.bootstrap(state,{simulation:{version:'3.0.0'},businessWorld:{version:'3.0.0'},finance:{version:'3.0.0'},procurement:{version:'3.0.0'},assets:{version:'3.0.0'},routes:{version:'3.0.0'},staffing:{version:'3.0.2'},save:{version:'3.0.0'},update:{version:'3.0.0'},nativeBridge:{version:'Build362',connected:true,minimumNativeBuild:251,nativeBuild:362},diagnostics:{version:'3.0.0'}});
  const before=JSON.stringify(state),bundle=s.GH_CONTROL_PLANE.exportDiagnostic(state);assert.equal(bundle.format,'ghdiagnostic-v1');assert.equal(JSON.stringify(state),before,'control-plane export must not update links, incidents, lastHealth, or lifecycle defaults');
}

const app=fs.readFileSync(path.join(process.env.GH_TEST_SOURCE_DIR,'WebApp/app.js'),'utf8');
assert.ok(app.includes('createGovernorEventCoalescer'),'app does not use the bounded governor event owner');
assert.ok(app.includes("const diag=(type,detail={},severity='info')"),'diagnostic helper must retain severity');
assert.ok(app.includes('record(state,type,detail,severity)'),'direct and deferred diagnostics must pass severity to the recorder');
assert.ok(app.includes('await diagnosticLifecycleSettled();return governorEventCoalescer.flush'),'exports must wait for staged state and durable publication before consuming the pending governor window');
assert.ok(app.includes('governorEventCoalescer.discard()'),'clearing diagnostics must discard pending governor evidence');
assert.ok(app.includes('async function withDiagnosticSnapshot(work)'),'all export entry points must use the serialized stable-snapshot lock');
assert.ok(app.includes('while(simulationEngine.snapshot().manualAdvance)'),'exports must wait for an in-flight calendar advance to finish before pausing simulation');
assert.ok(app.includes('window.__GH_DIAGNOSTIC_EXPORT_IN_PROGRESS__=true;cancelSimulationPersistence()'),'snapshot lock must pause simulation and cancel queued simulation persistence');
assert.ok(app.includes('await settleGovernorDiagnostics(\'diagnostic-export\')'),'exports must flush governor evidence before capturing their one evidence snapshot');
assert.ok(app.includes('window.GH_DIAGNOSTICS.stringifyAsync(out,{yieldToHost,budgetMs,space:2})'),'file exports must serialize cooperatively');
assert.ok(app.includes('window.GH_DIAGNOSTICS.utf8ByteLengthAsync(json,{yieldToHost,budgetMs})'),'native exports must measure their exact UTF-8 payload cooperatively');
assert.ok(app.includes('measured.bytes>8_000_000'),'native export must stop before exceeding the documented 8 MB bridge cap');
assert.ok(app.includes('cp.exportDiagnosticAsync?await cp.exportDiagnosticAsync'),'diagnostic control exports must use the staged bundle builder');
assert.ok(app.includes('exportDiagnostics:async()=>withDiagnosticSnapshot'),'the runtime export path must use the same stable snapshot lock');
assert.ok(app.includes('window.GH_DIAGNOSTICS.exportBundleAsync(state'),'the runtime export path must build the bundle cooperatively');
assert.ok(app.includes('assertDiagnosticSnapshotUnchanged(marker)'),'export must reject an inconsistent snapshot');
assert.ok(app.includes('window.GH_DIAGNOSTICS.flushDeferred?.(state)'),'diagnostic events raised during export must be published after the captured snapshot');
assert.ok(app.includes('if(window.__GH_DIAGNOSTIC_EXPORT_IN_PROGRESS__===true)return false;\n    const policy=window.GH_SAVE_POLICY'),'save policy edits must wait until snapshot creation finishes');
assert.ok(app.includes('if(window.__GH_DIAGNOSTIC_EXPORT_IN_PROGRESS__===true)return false;\n    const next=MAP_VIEW.normalizeMode(mode)'),'map view state must remain fixed during snapshot creation');
assert.ok(app.includes('while(window.__GH_DIAGNOSTIC_EXPORT_IN_PROGRESS__===true)await diagnosticExportTail'),'background save must wait for the export lock to release');
assert.ok(!app.includes("nativeBridge:{version:'Build251'"),'native bridge registry still claims the historical minimum as the running build');
assert.ok(app.includes('minimumNativeBuild:251'),'native bridge minimum compatibility must remain explicit');
assert.ok(app.includes('nativeBuildLabel'),'native bridge must report the actual build label');

console.log('BUILD363_RUNTIME_DIAGNOSTICS_CONTRACT_PASS',JSON.stringify({events:events.length,coalesced:events.reduce((sum,row)=>sum+row.transitions,0),pressureEvents:pressureEvents.length}));

(async()=>{
  const {s}=harness(['diagnostics-core','delivery-monitor-core','event-ledger-core','workflow-core','control-plane-core']),state=minimal();state.saveVersion='3.0.0';state.speed=1;state.cash=100;state.debt=0;state.groupValue=100;state.eventLog=[];state.realism={procurement:{deliveries:[]}};s.GH_DIAGNOSTICS.ensure(state);s.GH_CONTROL_PLANE.bootstrap(state,{simulation:{version:'3.0.0'},businessWorld:{version:'3.0.0'},finance:{version:'3.0.0'},procurement:{version:'3.0.0'},assets:{version:'3.0.0'},routes:{version:'3.0.0'},staffing:{version:'3.0.2'},save:{version:'3.0.0'},update:{version:'3.0.0'},nativeBridge:{version:'Build362',connected:true,minimumNativeBuild:251,nativeBuild:362},diagnostics:{version:'3.0.0'}});
  const evidence=s.GH_CONTROL_PLANE.captureExportEvidence(state,{simulation:{simSeconds:0},readOnly:true}),before=JSON.stringify(state),bundle=await s.GH_CONTROL_PLANE.exportDiagnosticAsync(state,{evidence,simulation:evidence.simulation,yieldToHost:()=>new Promise(resolve=>setImmediate(resolve)),budgetMs:1});
  assert.equal(bundle.diagnostics.evidenceId,evidence.id);assert.equal(bundle.diagnostics.exportPerformance.consistent,true);assert.equal(bundle.diagnostics.exportPerformance.integrityCalls,1);assert.equal(JSON.stringify(state),before,'cooperative control export must preserve the captured save state');
  const beforeDeferred=JSON.stringify(state.diagnostics);s.window.__GH_DIAGNOSTIC_EXPORT_IN_PROGRESS__=true;s.GH_DIAGNOSTICS.record(state,'QA_DURING_EXPORT',{value:1},'warning');assert.equal(JSON.stringify(state.diagnostics),beforeDeferred,'diagnostic events during export must be buffered outside the captured state');assert.equal(s.GH_DIAGNOSTICS.flushDeferred(state),1);s.window.__GH_DIAGNOSTIC_EXPORT_IN_PROGRESS__=false;assert.equal(state.diagnostics.events[0].type,'QA_DURING_EXPORT');
  const value={rows:Array.from({length:5000},(_,index)=>({id:index,text:'تشخيص 😀 \"\\ '.repeat(8)}))},yields={n:0},asyncText=await s.GH_DIAGNOSTICS.stringifyAsync(value,{yieldToHost:async()=>{yields.n++;await new Promise(resolve=>setImmediate(resolve));},budgetMs:1});
  assert.equal(asyncText.text,JSON.stringify(value),'cooperative JSON must be byte-for-byte equivalent to native JSON.stringify');assert.ok(yields.n>0,'large JSON serialization must yield to the host');
  const measured=await s.GH_DIAGNOSTICS.utf8ByteLengthAsync(asyncText.text,{yieldToHost:()=>Promise.resolve(),budgetMs:1});assert.equal(measured.bytes,new TextEncoder().encode(asyncText.text).byteLength,'cooperative UTF-8 measurement must be exact');assert.ok(measured.timing.yields>0,'large UTF-8 measurement must yield to the host');
  console.log('PASS cooperative diagnostic export:',JSON.stringify({evidenceId:evidence.id,integrityCalls:bundle.diagnostics.exportPerformance.integrityCalls,yields:yields.n,chars:asyncText.timing.outputChars,bytes:measured.bytes,sizeYields:measured.timing.yields}));
})().catch(error=>{console.error(error);process.exitCode=1;});

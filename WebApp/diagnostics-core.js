(()=>{
  'use strict';
  const VERSION='3.0.0',LIMIT=240,ALLOWED_SPEEDS=[0,1,2,3,4,5];
  let installed=false,lastLongTaskAt=0,eventSeq=0,longTaskObserverStatus='unavailable';
  const faultRecorders=new WeakMap();
  const recorderFrameBuffers=new WeakMap();
  function ensure(state){
    state.diagnostics=state.diagnostics&&typeof state.diagnostics==='object'?state.diagnostics:{};
    // Build 335 persisted the heavy fault recorder inside the game state. Adopt
    // it once into runtime-only storage, then remove it from the durable tree.
    if(Object.prototype.hasOwnProperty.call(state.diagnostics,'faultRecorder')){if(state.diagnostics.faultRecorder&&!faultRecorders.has(state))faultRecorders.set(state,state.diagnostics.faultRecorder);delete state.diagnostics.faultRecorder;}
    state.diagnostics.events=Array.isArray(state.diagnostics.events)?state.diagnostics.events:[];
    state.diagnostics.lastHealth=state.diagnostics.lastHealth&&typeof state.diagnostics.lastHealth==='object'?state.diagnostics.lastHealth:null;
    state.diagnostics.counters=state.diagnostics.counters&&typeof state.diagnostics.counters==='object'?state.diagnostics.counters:{};
    state.diagnostics.activeIssues=state.diagnostics.activeIssues&&typeof state.diagnostics.activeIssues==='object'?state.diagnostics.activeIssues:{};
    state.diagnostics.resolvedIssues=Array.isArray(state.diagnostics.resolvedIssues)?state.diagnostics.resolvedIssues:[];
    return state.diagnostics;
  }
  function recorderFor(state){ensure(state);return faultRecorders.get(state)||null;}
  function cleanDetail(value,depth=0){
    if(depth>5)return '[depth-limit]';
    if(value==null||typeof value==='string'||typeof value==='number'||typeof value==='boolean')return value;
    if(value instanceof Error)return {name:value.name,message:value.message,stack:String(value.stack||'').split('\n').slice(0,12).join('\n')};
    if(Array.isArray(value))return value.slice(0,30).map(x=>cleanDetail(x,depth+1));
    if(typeof value==='object'){
      const out={};let count=0;
      for(const [k,v] of Object.entries(value)){
        if(count++>=40){out.__truncated=true;break;}
        if(/logo|image|base64|blob|dataurl/i.test(k)&&typeof v==='string'&&v.length>400){out[k]=`[omitted ${v.length} chars]`;continue;}
        out[k]=cleanDetail(v,depth+1);
      }
      return out;
    }
    return String(value);
  }
  function record(state,type,detail={},severity='info'){
    const d=ensure(state),event={id:`DG-${Date.now()}-${++eventSeq}`,type:String(type),severity:String(severity||'info'),at:Date.now(),simSeconds:Number(state.simSeconds)||0,detail:cleanDetail(detail)};
    d.events.unshift(event);if(d.events.length>LIMIT)d.events.length=LIMIT;
    d.counters[event.type]=(Number(d.counters[event.type])||0)+1;
    return event;
  }
  const RECORDER_SAMPLE_LIMIT=240,RECORDER_EVENT_LIMIT=120,RECORDER_FRAME_LIMIT=240,RECORDER_STALL_MS=6000,RECORDER_RATE_WINDOW_MS=3000,FRAME_EVENT_COOLDOWN_MS=250;
  const recorderNow=meta=>{const n=Number(meta?.nowMs);return Number.isFinite(n)?n:Date.now();};
  const roundMs=value=>Math.round((Number(value)||0)*100)/100;
  function newFrameBuffer(){return {rows:new Array(RECORDER_FRAME_LIMIT),write:0,count:0,totalFrames:0,intervalCount:0,callbackCount:0,jankyFrames:0,estimatedMissedFrames:0,longGaps:0,longTasks:0,maxIntervalMs:0,maxCallbackMs:0,sumIntervalMs:0,sumCallbackMs:0,firstRafMs:null,lastRafMs:null,lastCallbackStartMs:null,baselineIntervalMs:null,lastFrameEventAtMs:0,gapsSinceEvent:0,maxGapSinceEventMs:0,intervalHistogram:new Uint32Array(2001),callbackHistogram:new Uint32Array(2001),longTasksRecent:[],wallOffsetMs:0};}
  function histogramAdd(hist,value){const ms=Number(value);if(Number.isFinite(ms)&&ms>=0)hist[Math.min(hist.length-1,Math.floor(ms*2))]++;}
  function histogramQuantile(hist,count,q){if(!count)return null;const target=Math.max(1,Math.ceil(count*q));let seen=0;for(let i=0;i<hist.length;i++){seen+=hist[i];if(seen>=target)return roundMs(Math.min((hist.length-1)/2,i/2+.25));}return (hist.length-1)/2;}
  function frameRows(buffer,limit=RECORDER_FRAME_LIMIT){if(!buffer?.count)return [];const out=[],count=Math.min(buffer.count,limit),start=(buffer.write-buffer.count+buffer.rows.length)%buffer.rows.length,skip=buffer.count-count;for(let i=skip;i<buffer.count;i++){const row=buffer.rows[(start+i)%buffer.rows.length];if(row)out.push(row);}return out;}
  function frameSummary(buffer){if(!buffer)return {measured:false,frameCallbacks:0,visibleIntervals:0,jankyFrames:0,estimatedMissedFrames:0};const elapsed=buffer.intervalCount?buffer.sumIntervalMs:0,effectiveFps=elapsed>0?roundMs(buffer.intervalCount*1000/elapsed):null;return {measured:true,frameCallbacks:buffer.totalFrames,visibleIntervals:buffer.intervalCount,effectiveFps,estimatedRefreshHz:buffer.baselineIntervalMs>0?roundMs(1000/buffer.baselineIntervalMs):null,expectedFrameIntervalMs:buffer.baselineIntervalMs==null?null:roundMs(buffer.baselineIntervalMs),jankyFrames:buffer.jankyFrames,estimatedMissedFrames:buffer.estimatedMissedFrames,longGaps:buffer.longGaps,longTasks:buffer.longTasks,maxFrameIntervalMs:roundMs(buffer.maxIntervalMs),p50FrameIntervalMs:histogramQuantile(buffer.intervalHistogram,buffer.intervalCount,.5),p95FrameIntervalMs:histogramQuantile(buffer.intervalHistogram,buffer.intervalCount,.95),maxCallbackDurationMs:roundMs(buffer.maxCallbackMs),p95CallbackDurationMs:histogramQuantile(buffer.callbackHistogram,buffer.callbackCount,.95),recentTraceFrames:buffer.count,traceCapacity:RECORDER_FRAME_LIMIT,percentilesScope:'whole-recording histogram capped at 1000ms; frameTrace contains most recent bounded window'};}
  function recorderSnapshotData(state,includeHistory=false){const r=recorderFor(state);if(!r)return null;const buffer=recorderFrameBuffers.get(state),{samples=[],events=[],...base}=r,sampleLimit=includeHistory?RECORDER_SAMPLE_LIMIT:30,eventLimit=includeHistory?RECORDER_EVENT_LIMIT:30,traceLimit=includeHistory?RECORDER_FRAME_LIMIT:12;return {...cleanDetail(base),samples:samples.slice(0,sampleLimit).map(row=>cleanDetail(row)),events:events.slice(0,eventLimit).map(row=>cleanDetail(row)),sampleCount:Number(r.totalSamples)||samples.length,eventCount:Number(r.totalEvents)||events.length,frameSummary:frameSummary(buffer),frameTrace:frameRows(buffer,traceLimit).map(row=>cleanDetail(row))};}
  function overlapsLongTask(task,start,end){return Number(task?.endPerfMs)>Number(start)&&Number(task?.startPerfMs)<Number(end);}
  function transactionEvidence(provider,wallOffsetMs,frameEndPerfMs){try{const metric=typeof provider==='function'?provider():null;if(!metric)return null;const recordedAtMs=Number(metric.recordedAtMs),completionPerfMs=Number.isFinite(recordedAtMs)?recordedAtMs-Number(wallOffsetMs):null;return cleanDetail({label:metric.label||null,correlationId:metric.correlationId||null,stage:metric.stage||null,committed:metric.committed===true,totalMs:metric.totalMs,snapshotMs:metric.snapshotMs,validateMs:metric.validateMs,applyMs:metric.applyMs,postCommitCriticalMs:metric.postCommitCriticalMs,postCommitCriticalTasks:metric.postCommitCriticalTasks,rollbackMs:metric.rollbackMs,rollbackStorage:metric.rollbackStorage,fullSnapshot:metric.fullSnapshot,fullSnapshotFallback:metric.fullSnapshotFallback,fallbackReason:metric.fallbackReason,recordedAtMs:Number.isFinite(recordedAtMs)?recordedAtMs:null,ageMs:Number.isFinite(recordedAtMs)?roundMs(Math.max(0,Number(wallOffsetMs)+Number(frameEndPerfMs)-recordedAtMs)):null,completionPerfMs});}catch(error){return {captureError:String(error?.message||error)};}}
  function frameDropCause(previous,current,longTasks,transaction){const stages=[['simulation',previous?.simulationMs],['target-update',previous?.targetUpdateMs],['marker-animation',previous?.markerAnimationMs],['structural-render',previous?.structuralRenderMs]].filter(row=>Number.isFinite(Number(row[1]))).sort((a,b)=>Number(b[1])-Number(a[1]));const top=stages[0],baseline=Number(current?.expectedFrameIntervalMs)||16.67,workLimit=Math.max(8,baseline*.6);if(previous&&Number(previous.callbackDurationMs)>=workLimit&&top&&Number(top[1])>=Math.max(4,Number(previous.callbackDurationMs)*.35))return {kind:'measured-app-stage',stage:top[0],durationMs:roundMs(top[1]),confidence:'strong-correlation',basis:'previous-requestAnimationFrame callback stage timing'};if(previous&&Number(previous.recorderOverheadMs)>=workLimit&&Number(previous.recorderOverheadMs)>=Number(previous.callbackDurationMs)*.35)return {kind:'diagnostic-recorder-overhead',durationMs:roundMs(previous.recorderOverheadMs),confidence:'measured-overhead',basis:'diagnostic recording work after the preceding app callback'};if(longTasks.length)return {kind:'browser-long-task-overlap',confidence:'measured-overlap',basis:'PerformanceLongTaskTiming overlaps the delayed frame interval'};if(Number(current?.callbackDelayMs)>=workLimit)return {kind:'main-thread-queue-delay',confidence:'measured-delay-unattributed',basis:'requestAnimationFrame callback began late; no measured app stage explains the delay'};if(previous?.guardReason&&Number(previous.callbackDurationMs)>=workLimit)return {kind:'measured-lifecycle-guard',stage:previous.guardReason,durationMs:roundMs(previous.callbackDurationMs),confidence:'measured-app-callback',basis:'preceding guarded requestAnimationFrame callback duration'};if(previous&&Number(previous.callbackDurationMs)>=workLimit)return {kind:'app-loop-work-unattributed',confidence:'measured-work-incomplete',basis:'app loop occupied the main thread but measured sub-stages do not explain its full duration'};const txPerf=Number(transaction?.completionPerfMs),gapStart=Number(previous?.rafTimestampMs),gapEnd=Number(current?.rafTimestampMs)+Number(current?.callbackDelayMs);if(transaction&&Number(transaction.totalMs)>=workLimit&&Number.isFinite(txPerf)&&txPerf>=gapStart&&txPerf<=gapEnd)return {kind:'transaction-correlated',stage:transaction.stage||null,durationMs:roundMs(transaction.totalMs),confidence:'timestamp-within-frame-gap',basis:'simulation transaction completion timestamp falls within the delayed frame window; timing overlap is approximate'};return {kind:'unattributed-scheduler-or-compositor',confidence:'insufficient-main-thread-evidence',basis:'frame cadence dropped without a matching measured app stage or supported long-task entry'};}
  function recorderFrame(state,sample={},meta={}){
    const r=recorderFor(state),buffer=recorderFrameBuffers.get(state);if(!r?.active||!buffer)return null;
    const captureStartedMs=Number(globalThis.performance?.now?.()??Date.now()),rafMs=Number(sample.rafTimestampMs),startMs=Number(sample.callbackStartMs),endMs=Number(sample.callbackEndMs);if(!Number.isFinite(rafMs)||!Number.isFinite(startMs)||!Number.isFinite(endMs)||endMs<startMs)return null;
    const previous=buffer.count?buffer.rows[(buffer.write-1+buffer.rows.length)%buffer.rows.length]:null,gapMs=previous?Math.max(0,rafMs-Number(previous.rafTimestampMs)):0,callbackDelayMs=Math.max(0,startMs-rafMs),callbackMs=endMs-startMs,visible=sample.visible!==false,hidden=sample.hidden===true,visibleInterval=!!previous&&previous.visible!==false&&previous.hidden!==true&&visible&&!hidden;
    if(visibleInterval&&gapMs>2&&gapMs<1000){buffer.intervalCount++;buffer.sumIntervalMs+=gapMs;buffer.maxIntervalMs=Math.max(buffer.maxIntervalMs,gapMs);histogramAdd(buffer.intervalHistogram,gapMs);if(buffer.baselineIntervalMs==null)buffer.baselineIntervalMs=gapMs;else if(gapMs<buffer.baselineIntervalMs*1.35)buffer.baselineIntervalMs=buffer.baselineIntervalMs*.94+gapMs*.06;}
    else if(visibleInterval&&gapMs>=1000)buffer.longGaps++;
    buffer.callbackCount++;buffer.sumCallbackMs+=callbackMs;buffer.maxCallbackMs=Math.max(buffer.maxCallbackMs,callbackMs);histogramAdd(buffer.callbackHistogram,callbackMs);
    const expected=buffer.baselineIntervalMs,threshold=expected==null?34:Math.max(12,expected*1.5),janky=visibleInterval&&gapMs>threshold&&gapMs<1000,missed=janky&&expected>0?Math.max(1,Math.round(gapMs/expected)-1):0;
    const row={sequence:buffer.totalFrames+1,rafTimestampMs:roundMs(rafMs),recordedAtMs:Math.round(buffer.wallOffsetMs+endMs),simSeconds:Number(sample.simSeconds)||0,frameIntervalMs:previous?roundMs(gapMs):null,visibleInterval,effectiveFps:visibleInterval&&gapMs>0?roundMs(1000/gapMs):null,expectedFrameIntervalMs:expected==null?null:roundMs(expected),callbackDelayMs:roundMs(callbackDelayMs),callbackDurationMs:roundMs(callbackMs),simulationMs:roundMs(sample.simulationMs),targetUpdateMs:roundMs(sample.targetUpdateMs),markerAnimationMs:roundMs(sample.markerAnimationMs),structuralRenderMs:roundMs(sample.structuralRenderMs),guardReason:String(sample.guardReason||''),targetUpdated:sample.targetUpdated===true,markerAnimated:sample.markerAnimated===true,structureRendered:sample.structureRendered===true,fleetSize:Number(sample.fleetSize)||0,ownMarkers:Number(sample.ownMarkers)||0,mobilityMarkers:Number(sample.mobilityMarkers)||0,panel:String(sample.panel||''),mapActive:sample.mapActive===true,visible,hidden,simulationStage:String(sample.simulationStage||''),simulationGovernor:String(sample.simulationGovernor||''),simulationBacklog:Number(sample.simulationBacklog)||0,simulationJobActive:sample.simulationJobActive===true,manualAdvance:sample.manualAdvance===true,lastCreateMs:roundMs(sample.lastCreateMs),lastChunkMs:roundMs(sample.lastChunkMs),lastFinishMs:roundMs(sample.lastFinishMs),lastCycleMs:roundMs(sample.lastCycleMs),recorderOverheadMs:0};
    buffer.rows[buffer.write]=row;buffer.write=(buffer.write+1)%buffer.rows.length;buffer.count=Math.min(buffer.count+1,buffer.rows.length);buffer.totalFrames++;
    if(janky){buffer.jankyFrames++;buffer.estimatedMissedFrames+=missed;buffer.gapsSinceEvent++;buffer.maxGapSinceEventMs=Math.max(buffer.maxGapSinceEventMs,gapMs);const eventAtMs=Math.round(buffer.wallOffsetMs+endMs);if(!buffer.lastFrameEventAtMs||eventAtMs-buffer.lastFrameEventAtMs>=FRAME_EVENT_COOLDOWN_MS){const intervalStart=previous?.rafTimestampMs??rafMs,longTasks=buffer.longTasksRecent.filter(task=>overlapsLongTask(task,intervalStart,startMs)).slice(-8),overlappingLongTasks=longTasks.map(task=>({startPerfMs:task.startPerfMs,endPerfMs:task.endPerfMs,durationMs:task.durationMs,name:task.name,primaryAttribution:task.attribution?.[0]||null,attributionCount:task.attribution?.length||0})),transaction=transactionEvidence(meta.transactionProvider,buffer.wallOffsetMs,endMs),cause=frameDropCause(previous,row,longTasks,transaction);recorderEvent(state,'FRAME_DROP',{frameIntervalMs:roundMs(gapMs),effectiveFps:row.effectiveFps,expectedFrameIntervalMs:row.expectedFrameIntervalMs,estimatedMissedFrames:missed,coalescedJankyFrames:buffer.gapsSinceEvent,maxGapMs:roundMs(buffer.maxGapSinceEventMs),currentFrame:{callbackDelayMs:row.callbackDelayMs,callbackDurationMs:row.callbackDurationMs,simulationMs:row.simulationMs,targetUpdateMs:row.targetUpdateMs,markerAnimationMs:row.markerAnimationMs,structuralRenderMs:row.structuralRenderMs},precedingFrame:previous?cleanDetail(previous):null,context:{panel:row.panel,fleetSize:row.fleetSize,ownMarkers:row.ownMarkers,mobilityMarkers:row.mobilityMarkers,mapActive:row.mapActive,simulationStage:row.simulationStage,simulationGovernor:row.simulationGovernor,simulationBacklog:row.simulationBacklog,simulationJobActive:row.simulationJobActive,manualAdvance:row.manualAdvance},overlappingLongTasks,transaction,cause,traceBasis:'measured requestAnimationFrame timestamps and app stage durations; not a JavaScript call stack'},missed>=3?'warning':'info',{nowMs:eventAtMs});buffer.lastFrameEventAtMs=eventAtMs;buffer.gapsSinceEvent=0;buffer.maxGapSinceEventMs=0;}}
    buffer.lastRafMs=rafMs;buffer.lastCallbackStartMs=startMs;buffer.firstRafMs=buffer.firstRafMs==null?rafMs:buffer.firstRafMs;
    const captureEndedMs=Number(globalThis.performance?.now?.()??Date.now());row.recorderOverheadMs=Number.isFinite(captureStartedMs)&&Number.isFinite(captureEndedMs)?roundMs(Math.max(0,captureEndedMs-captureStartedMs)):null;
    return {recorded:true,frameCallbacks:buffer.totalFrames,jankyFrames:buffer.jankyFrames};
  }
  const recorderRevenueSignal=state=>{
    let total=Number(state.todayProfit)||0;
    for(const value of Object.values(state.sectorProfitToday||{}))total+=Number(value)||0;
    for(const value of Object.values(state.tripRevenueAccrued||{}))total+=Number(value)||0;
    return Math.round(total*100)/100;
  };
  const recorderAssetSignal=state=>{
    const assets=Array.isArray(state.assets)?state.assets:[],moving=assets.filter(a=>a&&a.phase==='moving');
    let progress=0;
    for(const a of moving)progress+=Number(a.progress)||0;
    return {assets:assets.length,moving:moving.length,progress:Math.round(progress*1e6)/1e6};
  };
  function recorderEvent(state,type,detail={},severity='warning',meta={}){
    ensure(state);const r=recorderFor(state);if(!r?.active&&meta.force!==true)return null;
    const atMs=recorderNow(meta),event={id:`FR-${Math.round(atMs)}-${++eventSeq}`,type:String(type),severity:String(severity||'warning'),atMs,at:new Date(atMs).toISOString(),simSeconds:Number(state.simSeconds)||0,detail:cleanDetail(detail)};
    r.events=Array.isArray(r.events)?r.events:[];r.events.unshift(event);if(r.events.length>RECORDER_EVENT_LIMIT)r.events.length=RECORDER_EVENT_LIMIT;
    r.counts=r.counts&&typeof r.counts==='object'?r.counts:{};r.counts[event.type]=(Number(r.counts[event.type])||0)+1;r.totalEvents=(Number(r.totalEvents)||0)+1;
    return event;
  }
  function recorderIsActive(state){return faultRecorders.get(state)?.active===true;}
  function recorderStart(state,simulation={},meta={}){
    ensure(state);const atMs=recorderNow(meta),asset=recorderAssetSignal(state),revenue=recorderRevenueSignal(state),simSeconds=Number(state.simSeconds)||0;
    const perfNow=Number(meta.performanceNowMs??globalThis.performance?.now?.()??atMs),buffer=newFrameBuffer();buffer.wallOffsetMs=atMs-(Number.isFinite(perfNow)?perfNow:atMs);recorderFrameBuffers.set(state,buffer);
    const recorder={version:2,active:true,startedAt:new Date(atMs).toISOString(),startedAtMs:atMs,endedAt:null,endedAtMs:null,startedSimSeconds:simSeconds,lastSampleAtMs:atMs,lastProgressAtMs:atMs,lastProgressSim:simSeconds,lastAssetChangeAtMs:atMs,lastRevenueChangeAtMs:atMs,lastAssetSignal:asset,lastRevenueSignal:revenue,lastEngine:{frames:Number(simulation.frames)||0,slices:Number(simulation.slices)||0,cancels:Number(simulation.cancels)||0,hardTasks:Number(simulation.hardTasks)||0,backlogClamps:Number(simulation.backlogClamps)||0,manualFailures:Number(simulation.manualFailures)||0},rateWindow:{atMs,simSeconds,asset,revenue,requestedRate:Number(simulation.manualAdvance?.speed??simulation.speed)||0},flags:{simStall:false,assetRevenueStall:false},counts:{},totalSamples:0,totalEvents:0,frameCapabilities:{rafTimestamp:true,appStageTiming:true,longTaskObserver:longTaskObserverStatus},samples:[],events:[],summary:null,meta:cleanDetail(meta.context||{})};faultRecorders.set(state,recorder);
    recorderSample(state,simulation,{...meta,forceSample:true});
    return recorderSnapshotData(state,false);
  }
  function recorderSample(state,simulation={},meta={}){
    ensure(state);const r=recorderFor(state);if(!r?.active)return r||null;
    const atMs=recorderNow(meta),simSeconds=Number(state.simSeconds)||0,requestedRate=Number(simulation.manualAdvance?.speed??simulation.speed)||0,asset=recorderAssetSignal(state),revenue=recorderRevenueSignal(state),engine={frames:Number(simulation.frames)||0,slices:Number(simulation.slices)||0,cancels:Number(simulation.cancels)||0,hardTasks:Number(simulation.hardTasks)||0,backlogClamps:Number(simulation.backlogClamps)||0,manualFailures:Number(simulation.manualFailures)||0};
    const prevEngine=r.lastEngine||{};
    if(engine.cancels>Number(prevEngine.cancels||0))recorderEvent(state,'SIM_SLICE_CANCELLED',{delta:engine.cancels-Number(prevEngine.cancels||0),reason:simulation.lastCancelReason||'',jobActive:!!simulation.jobActive,jobReadyToFinish:!!simulation.jobReadyToFinish},'warning',{nowMs:atMs});
    if(engine.hardTasks>Number(prevEngine.hardTasks||0))recorderEvent(state,'SIM_STAGE_HARD_TASK',{delta:engine.hardTasks-Number(prevEngine.hardTasks||0),stage:simulation.lastWorkStage||'',lastCreateMs:Number(simulation.lastCreateMs)||0,lastChunkMs:Number(simulation.lastChunkMs)||0,lastFinishMs:Number(simulation.lastFinishMs)||0,maxCycleMs:Number(simulation.maxCycleMs)||0,governor:simulation.governor||''},'warning',{nowMs:atMs});
    if(engine.backlogClamps>Number(prevEngine.backlogClamps||0))recorderEvent(state,'LIVE_BACKLOG_CLAMP',{delta:engine.backlogClamps-Number(prevEngine.backlogClamps||0),backlog:Number(simulation.backlog)||0,requestedRate,governor:simulation.governor||''},'warning',{nowMs:atMs});
    if(engine.manualFailures>Number(prevEngine.manualFailures||0)||simulation.lastAdvanceFailure&&JSON.stringify(simulation.lastAdvanceFailure)!==JSON.stringify(r.lastAdvanceFailure||null)){
      if(simulation.lastAdvanceFailure)recorderEvent(state,'CALENDAR_ADVANCE_FAILED',simulation.lastAdvanceFailure,'warning',{nowMs:atMs});
    }
    r.lastAdvanceFailure=cleanDetail(simulation.lastAdvanceFailure||null);
    const progressed=simSeconds>Number(r.lastProgressSim||0)+1e-6;
    if(progressed){r.lastProgressAtMs=atMs;r.lastProgressSim=simSeconds;r.flags.simStall=false;}
    const engineAlive=engine.frames>Number(prevEngine.frames||0),expectedProgress=requestedRate>0&&!simulation.hidden;
    if(expectedProgress&&engineAlive&&!progressed&&atMs-Number(r.lastProgressAtMs||atMs)>=RECORDER_STALL_MS&&!r.flags.simStall){
      r.flags.simStall=true;recorderEvent(state,'SIM_PROGRESS_STALLED',{stalledMs:atMs-Number(r.lastProgressAtMs||atMs),simSeconds,requestedRate,jobActive:!!simulation.jobActive,jobReadyToFinish:!!simulation.jobReadyToFinish,stage:simulation.lastWorkStage||'',governor:simulation.governor||'',backlog:Number(simulation.backlog)||0},'warning',{nowMs:atMs});
    }
    if(asset.progress!==r.lastAssetSignal?.progress||asset.moving!==r.lastAssetSignal?.moving){r.lastAssetChangeAtMs=atMs;r.lastAssetSignal=asset;r.flags.assetRevenueStall=false;}
    if(revenue!==r.lastRevenueSignal){r.lastRevenueChangeAtMs=atMs;r.lastRevenueSignal=revenue;r.flags.assetRevenueStall=false;}
    const rw=r.rateWindow||{atMs,simSeconds,asset,revenue,requestedRate},windowMs=atMs-Number(rw.atMs||atMs);
    if(windowMs>=RECORDER_RATE_WINDOW_MS){
      const simDelta=simSeconds-Number(rw.simSeconds||0),actualRate=windowMs>0?simDelta/(windowMs/1000):0,expected=Number(rw.requestedRate||requestedRate)||0;
      if(!simulation.manualAdvance&&expected>0&&actualRate<expected*.85)recorderEvent(state,'LIVE_SPEED_UNDERRUN',{requestedRate:expected,actualRate:Math.round(actualRate*10)/10,windowMs,simDelta,governor:simulation.governor||'',backlog:Number(simulation.backlog)||0},'warning',{nowMs:atMs});
      const assetUnchanged=asset.moving>0&&asset.progress===rw.asset?.progress&&asset.moving===rw.asset?.moving,revenueUnchanged=revenue===rw.revenue;
      if(simDelta>0&&assetUnchanged&&revenueUnchanged&&!r.flags.assetRevenueStall){r.flags.assetRevenueStall=true;recorderEvent(state,'ASSET_REVENUE_PROGRESS_STALLED',{windowMs,simDelta,movingAssets:asset.moving,assetProgressSignal:asset.progress,revenueSignal:revenue,requestedRate:expected},'warning',{nowMs:atMs});}
      r.rateWindow={atMs,simSeconds,asset,revenue,requestedRate};
    }
    const sample={atMs,simSeconds,requestedRate,actualGovernor:simulation.governor||'',backlog:Number(simulation.backlog)||0,jobActive:!!simulation.jobActive,jobReadyToFinish:!!simulation.jobReadyToFinish,stage:simulation.lastWorkStage||'',frames:engine.frames,slices:engine.slices,cancels:engine.cancels,hardTasks:engine.hardTasks,backlogClamps:engine.backlogClamps,manualFailures:engine.manualFailures,manualYields:Number(simulation.manualThrottleYields)||0,asset,revenue};
    r.samples=Array.isArray(r.samples)?r.samples:[];
    if(meta.forceSample===true||!r.samples.length||atMs-Number(r.lastSampleAtMs||0)>=500){r.samples.unshift(sample);if(r.samples.length>RECORDER_SAMPLE_LIMIT)r.samples.length=RECORDER_SAMPLE_LIMIT;r.totalSamples=(Number(r.totalSamples)||0)+1;r.lastSampleAtMs=atMs;}
    r.lastEngine=engine;r.lastSeen={atMs,simSeconds,requestedRate,asset,revenue,simulation:cleanDetail({governor:simulation.governor,avgChunkMs:simulation.avgChunkMs,avgWorkMs:simulation.avgWorkMs,lastWorkStage:simulation.lastWorkStage,lastCreateMs:simulation.lastCreateMs,lastChunkMs:simulation.lastChunkMs,lastFinishMs:simulation.lastFinishMs,lastCycleMs:simulation.lastCycleMs,lastCancelReason:simulation.lastCancelReason,lastCommitReason:simulation.lastCommitReason,backlog:simulation.backlog,jobActive:simulation.jobActive,jobReadyToFinish:simulation.jobReadyToFinish,manualAdvance:simulation.manualAdvance})};
    return recorderSnapshotData(state,false);
  }
  function recorderStop(state,simulation={},meta={}){
    ensure(state);const r=recorderFor(state);if(!r)return null;
    if(r.active)recorderSample(state,simulation,{...meta,forceSample:true});
    const atMs=recorderNow(meta);r.active=false;r.endedAtMs=atMs;r.endedAt=new Date(atMs).toISOString();
    const events=Array.isArray(r.events)?r.events:[],counts={...(r.counts||{})},priority=['FRAME_DROP','LONG_TASK_TRACE','CALENDAR_ADVANCE_FAILED','SIM_PROGRESS_STALLED','ASSET_REVENUE_PROGRESS_STALLED','LIVE_BACKLOG_CLAMP','LIVE_SPEED_UNDERRUN','SIM_SLICE_CANCELLED','SIM_STAGE_HARD_TASK'];
    const findings=priority.filter(type=>Number(counts[type])>0).map(type=>({type,count:Number(counts[type])||0,last:events.find(e=>e.type===type)||null}));
    const buffer=recorderFrameBuffers.get(state),summary=frameSummary(buffer);r.summary={status:findings.length?'captured':'no-fault-captured',durationMs:Math.max(0,atMs-Number(r.startedAtMs||atMs)),simDelta:(Number(state.simSeconds)||0)-Number(r.startedSimSeconds||0),samples:Number(r.totalSamples)||r.samples?.length||0,events:Number(r.totalEvents)||events.length,findings,frameSummary:summary,engine:cleanDetail(simulation),endedSimSeconds:Number(state.simSeconds)||0};
    return cleanDetail(r.summary);
  }
  function recorderSnapshot(state,options={}){return recorderSnapshotData(state,options.includeHistory===true);}
  function issue(id,severity,title,detail,domain='system',evidence={}){return {id,severity,title,detail,domain,evidence:cleanDetail(evidence)};}
  function finiteNumber(value){return typeof value==='number'&&Number.isFinite(value);}
  function layoutSnapshot(){
    const doc=globalThis.document;if(!doc?.querySelector)return null;
    const pack=(el)=>{if(!el?.getBoundingClientRect)return null;const r=el.getBoundingClientRect();return {left:Number(r.left)||0,top:Number(r.top)||0,right:Number(r.right)||0,bottom:Number(r.bottom)||0,width:Number(r.width)||0,height:Number(r.height)||0};};
    const actions=doc.querySelector('.topbar .top-actions');
    return {
      viewport:{width:Number(globalThis.innerWidth)||Number(doc.documentElement?.clientWidth)||0,height:Number(globalThis.innerHeight)||Number(doc.documentElement?.clientHeight)||0},
      topbar:pack(doc.querySelector('.topbar')),brand:pack(doc.querySelector('.topbar .brand')),kpis:pack(doc.querySelector('.topbar .top-kpis')),actions:pack(actions),mapActions:pack(doc.querySelector('.map-actions')),
      actionButtons:actions?[...actions.querySelectorAll('button')].filter(el=>{const st=globalThis.getComputedStyle?.(el);return st?.display!=='none'&&st?.visibility!=='hidden';}).map(el=>({id:el.id||null,rect:pack(el)})):[]
    };
  }
  function rectOverlap(a,b,tolerance=1){if(!a||!b)return false;return a.left<b.right-tolerance&&a.right>b.left+tolerance&&a.top<b.bottom-tolerance&&a.bottom>b.top+tolerance;}
  function runHealthCheck(state,extra={},options={}){
    const issues=[];ensure(state);
    const add=(id,severity,title,detail,domain,evidence)=>issues.push(issue(id,severity,title,detail,domain,evidence));
    const simSeconds=Number(state.simSeconds);
    if(!Number.isFinite(simSeconds)||simSeconds<0)add('SIM_TIME_INVALID','critical','زمن المحاكاة غير صالح','simSeconds يجب أن يكون رقمًا محدودًا وغير سالب.','simulation',{simSeconds:state.simSeconds});
    if(!ALLOWED_SPEEDS.includes(Number(state.speed)))add('SIM_SPEED_INVALID','critical','سرعة غير معتمدة','السرعة الحالية ليست ضمن الإيقاف أو مستويات التشغيل الخمسة المعتمدة.','simulation',{speed:state.speed});
    const sim=extra.simulation||{};
    if(sim.fatalError)add('SIM_FATAL_STATE','critical','المحرك في حالة خطأ قاتل',String(sim.fatalError),'simulation',sim);
    if(Number(sim.backlogSeconds)>60)add('SIM_BACKLOG_HIGH','warning','تراكم محاكاة مرتفع','يوجد backlog مرتفع وقد يؤدي إلى تباطؤ أو خفض سرعة تلقائي.','simulation',{backlogSeconds:sim.backlogSeconds});
    if(Number(sim.conflictRate)>0.1)add('SIM_CONFLICT_HIGH','warning','معدل تعارض معاملات مرتفع','تتكرر إلغاءات معاملات المحاكاة أكثر من المتوقع.','simulation',{conflictRate:sim.conflictRate});
    const recovery=state.simulationKernel?.boundaryRecovery;
    if(recovery?.failed)add('BOUNDARY_RECOVERY_FAILED','critical','فشل استرداد حدود الزمن','تم إيقاف الاسترداد بعد فشل سابق ويجب مراجعة التشخيص.','simulation',recovery);
    const lastCommit=state.simulationKernel?.lastAtomicCommit;
    if(lastCommit&&finiteNumber(lastCommit.from)&&finiteNumber(lastCommit.to)&&lastCommit.to<lastCommit.from)add('ATOMIC_COMMIT_REVERSED','critical','معاملة زمنية معكوسة','آخر Atomic Commit تحرك إلى زمن أقدم.','transaction',lastCommit);
    if(!globalThis.GH_TRANSACTION_CORE?.execute)add('TX_CORE_MISSING','critical','Transaction Core غير متاح','لا يمكن ضمان All-or-Nothing بدون Transaction Core.','transaction');
    if(!globalThis.GH_SIMULATION_CORE?.create)add('SIM_CORE_MISSING','critical','Simulation Core غير متاح','محرك الزمن المركزي غير محمل.','simulation');
    if(!globalThis.GH_SAVE_SCHEMA?.normalize)add('SAVE_SCHEMA_CORE_MISSING','critical','Save Schema Core غير متاح','طبقة التوافق مع الحفظ غير محملة.','save');
    const expectedVersions=Object.freeze({hr:'3.0.1'});
    for(const [name,core] of [['transaction',globalThis.GH_TRANSACTION_CORE],['simulation',globalThis.GH_SIMULATION_CORE],['save',globalThis.GH_SAVE_SCHEMA],['determinism',globalThis.GH_DETERMINISM],['procurement',globalThis.GH_PROCUREMENT_CORE],['hr',globalThis.GH_HR_CORE],['lifecycle',globalThis.GH_LIFECYCLE_CORE],['policy',globalThis.GH_POLICY_CORE],['dependencies',globalThis.GH_DEPENDENCY_CORE],['ledger',globalThis.GH_EVENT_LEDGER],['deliveryMonitor',globalThis.GH_DELIVERY_MONITOR],['integrity',globalThis.GH_INTEGRITY_CORE],['workflow',globalThis.GH_WORKFLOW],['departments',globalThis.GH_DEPARTMENT_CORE]]){const expected=expectedVersions[name]||VERSION;if(core?.VERSION&&String(core.VERSION)!==expected)add('CORE_VERSION_MISMATCH','critical','عدم تطابق إصدارات الأنظمة',`${name} يعمل على ${core.VERSION} بينما الإصدار المعتمد له ${expected}.`,'system',{name,version:core.VERSION,expected});}
    for(const [key,label] of [['cash','السيولة الموحدة'],['debt','الدين الموحد'],['groupValue','قيمة المجموعة']]){const v=Number(state[key]);if(!Number.isFinite(v)||v<0)add(`STATE_${key.toUpperCase()}_INVALID`,'critical',`${label} غير صالحة`,`${key} يجب أن يكون رقمًا محدودًا وغير سالب.`,'finance',{value:state[key]});}
    if(String(state.saveVersion||'2.0.0')!=='2.0.0')add('SAVE_SCHEMA_UNEXPECTED','warning','نسخة الحفظ غير متوقعة','المشروع مصمم حاليًا لحفظ 2.0.0.','save',{saveVersion:state.saveVersion});

    const assets=Array.isArray(state.assets)?state.assets:[];
    const assetIds=new Set(),dupAssets=[];
    for(const a of assets){
      if(!a||typeof a!=='object'){add('ASSET_INVALID_RECORD','critical','سجل أصل تالف','يوجد عنصر غير صالح داخل state.assets.','assets');continue;}
      const id=String(a.id||'');if(!id)add('ASSET_ID_MISSING','critical','أصل بلا معرف','كل أصل يجب أن يملك ID ثابتًا.','assets',{name:a.name,type:a.type});
      else if(assetIds.has(id))dupAssets.push(id);else assetIds.add(id);
      if(a.progress!=null&&(!finiteNumber(Number(a.progress))||Number(a.progress)<0))add('ASSET_PROGRESS_INVALID','warning','تقدم أصل غير صالح',`الأصل ${id||a.name||'؟'} يحمل progress غير صالح.`,'assets',{id,progress:a.progress});
      if(a.condition!=null&&(!finiteNumber(Number(a.condition))||Number(a.condition)<0||Number(a.condition)>100))add('ASSET_CONDITION_INVALID','warning','حالة أصل خارج النطاق',`Condition يجب أن تكون بين 0 و100.`,'assets',{id,condition:a.condition});
    }
    if(dupAssets.length)add('ASSET_DUPLICATE_IDS','critical','معرفات أصول مكررة','تكرار ID قد يسبب overwrite أو بيع/توجيه الأصل الخطأ.','assets',{ids:[...new Set(dupAssets)].slice(0,20)});

    const books=state.finance?.companyBooks||state.companyBooks||{};
    for(const [company,book] of Object.entries(books||{})){
      const balance=Number(book?.balance??book?.cash??0),debt=Number(book?.debt??0);
      if(!Number.isFinite(balance))add('FIN_BALANCE_NAN','critical','رصيد شركة غير رقمي',`رصيد ${company} ليس رقمًا صالحًا.`,'finance',{company,balance:book?.balance});
      if(!Number.isFinite(debt)||debt<0)add('FIN_DEBT_INVALID','warning','دين شركة غير صالح',`دين ${company} يجب أن يكون رقمًا غير سالب.`,'finance',{company,debt:book?.debt});
    }
    const deliveries=state.realism?.procurement?.deliveries||[];
    const overdueDeliveries=Array.isArray(deliveries)?deliveries.filter(d=>d?.status==='pending'&&Number.isFinite(Number(d.dueAtSeconds))&&Number(d.dueAtSeconds)<Number(state.simSeconds||0)-5):[];
    if(overdueDeliveries.length)add('PROCUREMENT_DELIVERY_OVERDUE','warning','أصول مستحقة لم تدخل القواعد','يوجد طلب تسليم تجاوز موعده التشغيلي ولم يدخل الأصل إلى الأسطول بعد.','assets',{count:overdueDeliveries.length,ids:overdueDeliveries.slice(0,12).map(d=>d.id)});
    const collections=[['receivables',state.finance?.receivables],['payables',state.finance?.payables],['invoices',state.finance?.invoices],['cheques',state.finance?.cheques]];
    for(const [name,list] of collections)if(list!=null&&!Array.isArray(list))add(`FIN_${name.toUpperCase()}_INVALID`,'critical',`هيكل ${name} غير صالح`,`يجب أن يكون ${name} مصفوفة.`,'finance',{type:typeof list});
    if((state.finance?.receivables?.length||0)>5000)add('AR_VOLUME_HIGH','warning','سجل الذمم المدينة ضخم','عدد السجلات مرتفع رغم نظام الضغط التاريخي.','finance',{count:state.finance.receivables.length});
    if((state.finance?.payables?.length||0)>5000)add('AP_VOLUME_HIGH','warning','سجل الذمم الدائنة ضخم','عدد السجلات مرتفع رغم نظام الضغط التاريخي.','finance',{count:state.finance.payables.length});

    const deptCore=globalThis.GH_DEPARTMENT_CORE;if(deptCore?.definitions){const overdue=[];for(const dept of Object.keys(deptCore.definitions)){if(deptCore.due?.(dept,state))overdue.push(dept);}if(overdue.length>5)add('DEPARTMENT_REVIEWS_OVERDUE','warning','مراجعات إدارية دورية متأخرة',`يوجد ${overdue.length} أقسام لم تنفذ دورتها الدورية.`, 'management',{departments:overdue});}

    const integrity=globalThis.GH_INTEGRITY_CORE?.check?.(state);
    if(integrity?.issues?.length)for(const x of integrity.issues)add(`BIZ_${x.id}`,x.severity,x.title,x.detail,x.domain||'business',x.evidence||{});
    const layout=layoutSnapshot();
    if(layout?.topbar){
      const buttons=(layout.actionButtons||[]).map(x=>x.rect).filter(Boolean);
      if(buttons.length>1){const tops=buttons.map(r=>r.top),bottoms=buttons.map(r=>r.bottom);if(Math.max(...tops)-Math.min(...tops)>4||Math.max(...bottoms)-Math.min(...bottoms)>4)add('UI_TOPBAR_ACTION_WRAP','warning','التفاف أزرار الشريط العلوي','أزرار الإجراءات ليست على صف واحد؛ قد يكون عدد الأعمدة أقل من عدد الأزرار.','ui',{layout});}
      for(const item of layout.actionButtons||[]){const r=item.rect,t=layout.topbar;if(r&&(r.top<t.top-1||r.bottom>t.bottom+1))add('UI_TOPBAR_ACTION_OVERFLOW','warning','زر خارج حدود الشريط العلوي',`الزر ${item.id||'غير معروف'} خرج عموديًا من حاوية الشريط.`,'ui',{button:item,topbar:t});}
      if(rectOverlap(layout.actions,layout.kpis,2))add('UI_TOPBAR_ACTION_KPI_OVERLAP','warning','تداخل الإجراءات مع المؤشرات','منطقة أزرار الشريط تتداخل مع بطاقات KPI.','ui',{layout});
      if(rectOverlap(layout.kpis,layout.brand,2))add('UI_TOPBAR_KPI_BRAND_OVERLAP','warning','تداخل المؤشرات مع هوية المجموعة','بطاقات KPI تتداخل مع اسم/شعار المجموعة.','ui',{layout});
      if(layout.mapActions&&layout.mapActions.top<layout.topbar.bottom+3)add('UI_MAP_TOOLS_TOPBAR_OVERLAP','warning','تداخل أدوات الخريطة مع الشريط العلوي','أدوات الخريطة بدأت قبل نهاية الشريط العلوي.','ui',{layout});
      const interactionIssues=globalThis.GH_INTERACTION?.validate?.(globalThis.document)||[];for(const ii of interactionIssues){add(ii.id||'BUTTON_INTEGRITY','warning',ii.id==='DISABLED_WITHOUT_REASON'?'زر معطل بلا سبب واضح':'خلل في ربط زر',ii.label||'زر غير معروف','ui',{button:ii});}
    }

    const diag=state.diagnostics;

    const severityRank={critical:3,warning:2,info:1,ok:0};
    issues.sort((a,b)=>(severityRank[b.severity]||0)-(severityRank[a.severity]||0));
    const critical=issues.filter(x=>x.severity==='critical').length,warning=issues.filter(x=>x.severity==='warning').length;
    const report={format:'gh-health-v3',version:VERSION,at:new Date().toISOString(),checkedAtMs:Date.now(),simSeconds:Number(state.simSeconds)||0,status:critical?'critical':warning?'warning':'healthy',counts:{critical,warning,total:issues.length},issues,summary:{assets:assets.length,events:(state.eventLog||[]).length,diagnosticEvents:(diag.events||[]).length,receivables:state.finance?.receivables?.length||0,payables:state.finance?.payables?.length||0,speed:Number(state.speed)||0},simulation:cleanDetail(sim),layout:cleanDetail(layout)};
    if(options.trackTransitions!==false){
      const previous=diag.activeIssues&&typeof diag.activeIssues==='object'?diag.activeIssues:{};
      const next={};
      for(const current of issues){
        const prior=previous[current.id];
        next[current.id]={id:current.id,severity:current.severity,title:current.title,detail:current.detail,domain:current.domain,firstSeenAt:prior?.firstSeenAt||report.at,lastSeenAt:report.at,occurrences:(Number(prior?.occurrences)||0)+1,evidence:current.evidence};
        if(!prior)record(state,'ISSUE_OPEN',{id:current.id,title:current.title,domain:current.domain},current.severity);
        else if(prior.severity!==current.severity)record(state,'ISSUE_SEVERITY_CHANGED',{id:current.id,from:prior.severity,to:current.severity,title:current.title},current.severity);
      }
      for(const [id,prior] of Object.entries(previous)){
        if(next[id])continue;
        const resolved={...prior,resolvedAt:report.at,resolvedSimSeconds:Number(state.simSeconds)||0};
        diag.resolvedIssues.unshift(resolved);
        if(diag.resolvedIssues.length>80)diag.resolvedIssues.length=80;
        record(state,'ISSUE_RESOLVED',{id,title:prior.title,domain:prior.domain},'info');
      }
      diag.activeIssues=next;
    }
    diag.lastHealth=report;
    if(options.recordEvent===true)record(state,'HEALTH_CHECK',{status:report.status,counts:report.counts},critical?'critical':warning?'warning':'info');
    return report;
  }
  function stateSummary(state){const deliveries=state.realism?.procurement?.deliveries||[];return {profile:{name:state.profile?.name||null,creditRating:state.profile?.creditRating||null},simSeconds:Number(state.simSeconds)||0,speed:Number(state.speed)||0,cash:Number(state.cash)||0,debt:Number(state.debt)||0,groupValue:Number(state.groupValue)||0,assets:(state.assets||[]).length,openedCompanies:[...(state.openedCompanies||[])],globalBases:(state.globalBases||[]).length,customHubs:(state.customHubs||[]).length,branches:(state.branches||[]).length,finance:{invoices:state.finance?.invoices?.length||0,cheques:state.finance?.cheques?.length||0,receivables:state.finance?.receivables?.length||0,payables:state.finance?.payables?.length||0},execution:{commands:state.domainRuntime?.commands?.length||0,rolledBack:(state.domainRuntime?.commands||[]).filter(row=>row.status==='rolled_back').length},procurement:{manualOnly:state.advanced?.procurement?.manualOnly===true,pendingDeliveries:deliveries.filter(row=>row.status==='pending').length,completedDeliveries:deliveries.filter(row=>row.status==='delivered').length}};}
  const profilerClock=()=>globalThis.performance?.now?.()??Date.now();
  function profileNode(value,bytes,depth=0,budget={nodes:0},limits={maxDepth:3,topN:10,maxNodes:180,minChildBytes:1024}){
    const out={kind:Array.isArray(value)?'array':value&&typeof value==='object'?'object':typeof value,bytes:null};
    try{out.bytes=bytes(value);}catch(error){out.error=String(error?.message||error);return out;}
    if(Array.isArray(value))out.count=value.length;else if(value&&typeof value==='object')out.count=Object.keys(value).length;
    if(!value||typeof value!=='object'||depth>=limits.maxDepth||budget.nodes>=limits.maxNodes)return out;
    const entries=Array.isArray(value)?value.map((child,index)=>[String(index),child]):Object.entries(value),weighted=[];
    for(const [key,child] of entries){
      try{weighted.push({key,bytes:bytes(child),value:child});}catch(error){weighted.push({key,bytes:null,error:String(error?.message||error),value:null});}
    }
    weighted.sort((a,b)=>(b.bytes||0)-(a.bytes||0));
    out.children=weighted.slice(0,limits.topN).map(row=>{
      budget.nodes++;const child={key:row.key,bytes:row.bytes};if(row.error)child.error=row.error;
      if(row.value&&typeof row.value==='object'&&Number(row.bytes)>=limits.minChildBytes&&depth+1<limits.maxDepth&&budget.nodes<limits.maxNodes)child.profile=profileNode(row.value,bytes,depth+1,budget,limits);
      return child;
    });
    return out;
  }
  function assetSamples(assets,bytes){
    if(!Array.isArray(assets)||!assets.length)return [];
    const chosen=[],push=(label,asset)=>{if(asset&&!chosen.some(row=>row.assetId===asset.id)){const fields=[];for(const [key,value] of Object.entries(asset)){try{fields.push({key,bytes:bytes(value)});}catch(error){fields.push({key,bytes:null,error:String(error?.message||error)});}}fields.sort((a,b)=>(b.bytes||0)-(a.bytes||0));chosen.push({label,assetId:asset.id||null,phase:asset.phase||null,bytes:bytes(asset),fields:fields.slice(0,24)});}};
    push('moving',assets.find(asset=>asset?.phase==='moving'));push('non-moving',assets.find(asset=>asset?.phase!=='moving'));push('first',assets[0]);return chosen;
  }
  function stateByteProfile(state){
    const started=profilerClock(),encoder=globalThis.TextEncoder?new TextEncoder():null,bytes=value=>{const json=JSON.stringify(value);return encoder?encoder.encode(json).byteLength:json.length*2;},rows=[];let rootBytes=0;
    try{rootBytes=bytes(state);}catch(_error){rootBytes=Infinity;}
    for(const [key,value] of Object.entries(state||{})){try{const size=bytes(value),subtrees=[];if(value&&typeof value==='object'&&!Array.isArray(value))for(const [subKey,subValue] of Object.entries(value)){try{const subBytes=bytes(subValue);if(subBytes>=50*1024)subtrees.push({key:subKey,bytes:subBytes});}catch(_error){subtrees.push({key:subKey,bytes:null,error:'serialization-error'});}}subtrees.sort((a,b)=>(b.bytes||0)-(a.bytes||0));rows.push({key,bytes:size,subtrees:subtrees.slice(0,24)});}catch(error){rows.push({key,bytes:null,error:String(error?.message||error),subtrees:[]});}}
    rows.sort((a,b)=>(b.bytes||0)-(a.bytes||0));const visibleRows=rows.slice(0,64),attributedBytes=rows.reduce((sum,row)=>sum+(Number.isFinite(row.bytes)?row.bytes:0),0),targeted={};
    for(const key of ['domainRuntime','documentProofs'])if(state?.[key]&&typeof state[key]==='object')targeted[key]=profileNode(state[key],bytes);
    if(Array.isArray(state?.assets)){targeted.assets=profileNode(state.assets,bytes);targeted.assetSamples=assetSamples(state.assets,bytes);}
    if(state?.realism?.procurement&&typeof state.realism.procurement==='object')targeted['realism.procurement']=profileNode(state.realism.procurement,bytes);
    return {profileVersion:'build337-targeted-topn-v1',rootBytes,attributedBytes,unattributedRootBytes:Number.isFinite(rootBytes)?rootBytes-attributedBytes:null,rows:visibleRows,targeted,profilerDurationMs:Math.max(0,profilerClock()-started)};
  }
  function exportBundle(state,extra={}){
    const d=ensure(state),simulationBase=extra.simulation||globalThis.GH_SIM_KERNEL?.snapshot?.()||{},transactionTelemetry=globalThis.GH_TRANSACTION_CORE?.telemetry?.()||null,persistenceTelemetry=globalThis.GH_PERSISTENCE?.telemetry?.()||null,appRuntime=globalThis.GH_APP_RUNTIME_METRICS?.snapshot?.()||null,controlPlaneTelemetry=globalThis.GH_CONTROL_PLANE?.telemetry?.()||null,saveSchemaTelemetry=globalThis.GH_SAVE_SCHEMA?.telemetry?.()||null;
    const runtimeInstrumentation={app:appRuntime,transaction:transactionTelemetry,persistence:persistenceTelemetry,controlPlane:controlPlaneTelemetry,saveSchema:saveSchemaTelemetry};
    const simulation={...simulationBase,lastFinishBreakdown:transactionTelemetry?.lastSimulation||null,lastSaveBreakdown:{app:appRuntime?.lastSavePreparation||null,persistence:persistenceTelemetry?.timings?.lastSaveBreakdown||null,nativeAck:persistenceTelemetry?.timings?.lastNativeAck||null}};
    const health=runHealthCheck(state,{...extra,simulation},{recordEvent:false,trackTransitions:true}),integrity=globalThis.GH_INTEGRITY_CORE?.check?.(state)||null,closure=globalThis.GH_DELIVERY_MONITOR?.reconcile?.(state)||null,ledger=globalThis.GH_EVENT_LEDGER?.summary?.(state)||null,actionTasks=globalThis.GH_UI_QUALITY?.collectTasks?.(state)||[],proofForensics=globalThis.GH_DOCUMENT_PROOF?.forensicInspectStateProofs?.(state)||null,byteProfile=stateByteProfile(state);
    return {format:'global-holdings-diagnostic-bundle',diagnosticsVersion:VERSION,generatedAt:new Date().toISOString(),faultRecorder:recorderSnapshotData(state,true),appVersion:extra.appVersion||null,saveSchemaVersion:extra.saveSchemaVersion||state.saveVersion||null,health,integrity:cleanDetail(integrity),proofForensics:cleanDetail(proofForensics),stateByteProfile:byteProfile,runtimeInstrumentation,deliveryClosure:cleanDetail(closure),eventLedger:{summary:cleanDetail(ledger),events:cleanDetail((state.businessLedger?.events||[]).slice(0,160))},dependencies:cleanDetail((state.dependencyGraph?.edges||[]).slice(0,220)),actionCenter:{count:actionTasks.length,tasks:cleanDetail(actionTasks.slice(0,120))},workflow:cleanDetail(globalThis.GH_WORKFLOW?.summary?.(state)||null),departments:cleanDetail(state.advanced?.departmentLife||null),simulation,stateSummary:stateSummary(state),events:d.events.slice(0,LIMIT),environment:{userAgent:globalThis.navigator?.userAgent||null,language:globalThis.navigator?.language||null,online:globalThis.navigator?.onLine??null}};
  }
  function installGlobalHandlers(stateProvider,extraProvider=()=>({})){
    if(installed||typeof globalThis.addEventListener!=='function')return;installed=true;
    const getState=()=>{try{return stateProvider?.();}catch{return null;}};
    globalThis.addEventListener('error',event=>{const s=getState();if(s)record(s,'WINDOW_ERROR',{message:event.message,filename:event.filename,lineno:event.lineno,colno:event.colno,error:event.error},'critical');});
    globalThis.addEventListener('unhandledrejection',event=>{const s=getState();if(s)record(s,'UNHANDLED_REJECTION',{reason:event.reason},'critical');});
    const originalError=globalThis.console?.error?.bind(globalThis.console),originalWarn=globalThis.console?.warn?.bind(globalThis.console);
    if(originalError)globalThis.console.error=(...args)=>{const s=getState();if(s)record(s,'CONSOLE_ERROR',{args},'critical');originalError(...args);};
    if(originalWarn)globalThis.console.warn=(...args)=>{const s=getState();if(s)record(s,'CONSOLE_WARN',{args},'warning');originalWarn(...args);};
    globalThis.addEventListener('visibilitychange',()=>{const s=getState();if(s)record(s,'VISIBILITY_CHANGE',{state:globalThis.document?.visibilityState},'info');});
    if(globalThis.PerformanceObserver){try{const observer=new PerformanceObserver(list=>{const s=getState();if(!s)return;for(const entry of list.getEntries()){const duration=Number(entry.duration)||0,startPerfMs=Number(entry.startTime)||0,endPerfMs=startPerfMs+duration,r=recorderFor(s),buffer=recorderFrameBuffers.get(s);if(r?.active&&buffer&&duration>=50){const attribution=Array.from(entry.attribution||[]).slice(0,4).map(row=>({containerType:String(row.containerType||''),containerName:String(row.containerName||''),containerId:String(row.containerId||''),containerSrc:String(row.containerSrc||'')})),task={startPerfMs,endPerfMs,durationMs:roundMs(duration),name:String(entry.name||'longtask'),attribution};buffer.longTasks++;buffer.longTasksRecent.push(task);if(buffer.longTasksRecent.length>32)buffer.longTasksRecent.shift();recorderEvent(s,'LONG_TASK_TRACE',{...task,observedBy:'PerformanceLongTaskTiming'},duration>=120?'warning':'info',{nowMs:Math.round(buffer.wallOffsetMs+endPerfMs)});}if(duration>=120&&Date.now()-lastLongTaskAt>250){lastLongTaskAt=Date.now();record(s,'LONG_TASK',{duration:Math.round(duration),name:entry.name||'task',extra:cleanDetail(extraProvider?.())},duration>=500?'warning':'info');}}});observer.observe({entryTypes:['longtask']});longTaskObserverStatus='installed';}catch(error){longTaskObserverStatus='unsupported-or-error';console.debug('Long Task diagnostics unavailable',error);}}else longTaskObserverStatus='unsupported';
  }
  function clear(state){const d=ensure(state);d.events=[];d.counters={};d.resolvedIssues=[];d.activeIssues={};d.lastHealth=null;faultRecorders.delete(state);recorderFrameBuffers.delete(state);d.clearedAt=new Date().toISOString();d.clearedSimSeconds=Number(state?.simSeconds)||0;return {clearedAt:d.clearedAt,simSeconds:d.clearedSimSeconds};}
  const API=Object.freeze({VERSION,LIMIT,ALLOWED_SPEEDS,ensure,record,runHealthCheck,exportBundle,layoutSnapshot,installGlobalHandlers,clear,recorderStart,recorderSample,recorderEvent,recorderIsActive,recorderFrame,recorderStop,recorderSnapshot});
  globalThis.GH_DIAGNOSTICS=API;if(globalThis.window&&globalThis.window!==globalThis)globalThis.window.GH_DIAGNOSTICS=API;if(typeof module!=='undefined'&&module.exports)module.exports=API;
})();

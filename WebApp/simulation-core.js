(()=>{
  'use strict';

  const VERSION='3.0.0';
  const TIME=globalThis.GH_SIMULATION_TIME_CORE||(typeof module!=='undefined'&&module.exports?require('./simulation-time-core.js'):null);
  const PACING=globalThis.GH_SIMULATION_PACING_CORE||(typeof module!=='undefined'&&module.exports?require('./simulation-pacing-core.js'):null);
  if(!TIME)throw new Error('Simulation Time Core must load before Simulation Core');
  if(!PACING)throw new Error('Simulation Pacing Core must load before Simulation Core');
  const DEFAULTS=Object.freeze({
    allowedSpeeds:Object.freeze([0,30,120,300,600]),
    fallbackSpeed:30,
    quantumRealSeconds:1,
    maxRealDelta:3,
    maxBacklogNormal:12,
    maxBacklogFast:96,
    frameBudgetMs:5.5,
    manualFrameBudgetMs:10,
    chunkItems:64,
    manualChunkItems:64,
    renderEveryNormalMs:180,
    renderEveryFastMs:450,
    persistEveryNormalMs:12000,
    persistEveryFastMs:30000,
    minRealSliceSeconds:0,
    maintenanceEveryHours:6,
    manualBatchSeconds:3600,
    manualMinBatchSeconds:300,
    manualRetryLimit:3,
    longTaskWarnMs:28,
    hardTaskMs:120,
    hardTaskLimit:3,
    conflictLimit:3
  });

  const systemNowMs=()=>globalThis.performance?.now?.() ?? Date.now();

  function normalizeConfig(options={}){
    const cfg={...DEFAULTS,...options};
    cfg.allowedSpeeds=Array.from(options.allowedSpeeds||DEFAULTS.allowedSpeeds).map(Number).filter(Number.isFinite);
    if(!cfg.allowedSpeeds.length)cfg.allowedSpeeds=Array.from(DEFAULTS.allowedSpeeds);
    const positive=['quantumRealSeconds','maxRealDelta','maxBacklogNormal','maxBacklogFast','frameBudgetMs','manualFrameBudgetMs','chunkItems','manualChunkItems','renderEveryNormalMs','renderEveryFastMs','persistEveryNormalMs','persistEveryFastMs','maintenanceEveryHours','manualBatchSeconds','manualMinBatchSeconds','manualRetryLimit','longTaskWarnMs','hardTaskMs','hardTaskLimit','conflictLimit'];
    for(const key of positive){const n=Number(cfg[key]);cfg[key]=Number.isFinite(n)&&n>0?n:DEFAULTS[key];}
    const minRealSliceSeconds=Number(cfg.minRealSliceSeconds);cfg.minRealSliceSeconds=Number.isFinite(minRealSliceSeconds)?Math.max(0,Math.min(1,minRealSliceSeconds)):0;
    cfg.chunkItems=Math.max(1,Math.floor(cfg.chunkItems));
    cfg.manualChunkItems=Math.max(1,Math.floor(cfg.manualChunkItems));
    cfg.hardTaskLimit=Math.max(1,Math.floor(cfg.hardTaskLimit));
    cfg.conflictLimit=Math.max(1,Math.floor(cfg.conflictLimit));
    cfg.manualBatchSeconds=Math.max(1,Math.min(3600,Number(cfg.manualBatchSeconds)||DEFAULTS.manualBatchSeconds));
    cfg.manualMinBatchSeconds=Math.max(1,Math.min(cfg.manualBatchSeconds,Number(cfg.manualMinBatchSeconds)||DEFAULTS.manualMinBatchSeconds));
    cfg.manualRetryLimit=Math.max(1,Math.floor(Number(cfg.manualRetryLimit)||DEFAULTS.manualRetryLimit));
    cfg.fallbackSpeed=cfg.allowedSpeeds.includes(Number(cfg.fallbackSpeed))?Number(cfg.fallbackSpeed):(cfg.allowedSpeeds.find(value=>value>0)??1);
    return cfg;
  }

  function create(adapter,options={}){
    if(!adapter||typeof adapter!=='object')throw new TypeError('Simulation adapter is required');
    if(typeof adapter.getSimTime!=='function'||typeof adapter.setSimTime!=='function'||typeof adapter.createSliceJob!=='function')throw new TypeError('Simulation adapter is incomplete');
    const cfg=normalizeConfig(options);
    const clock=typeof options.nowMs==='function'?options.nowMs:systemNowMs;
    const health={
      version:VERSION,frames:0,slices:0,chunks:0,hours:0,days:0,conflicts:0,cancels:0,
      maxChunkMs:0,lastChunkMs:0,longTasks:0,hardTasks:0,droppedRealSeconds:0,backlogClamps:0,
      maxCreateMs:0,lastCreateMs:0,maxFinishMs:0,lastFinishMs:0,maxCycleMs:0,lastCycleMs:0,
      lastError:'',lastBoundary:'',lastSliceSeconds:0,lastMaintenanceHour:-1,lastCancelReason:'',lastCommitReason:'',lastWorkStage:'',governor:'GREEN',avgChunkMs:0,avgWorkMs:0,
      manualFailures:0,manualThrottleYields:0,lastAdvanceFailure:null,lastProgressSim:Math.max(0,Number(adapter.getSimTime())||0),lastProgressAt:clock()
    };
    let job=null,jobSlice=0,jobStart=0,jobSpeed=0,jobBoundary=null,jobWorkMs=0,jobReadyToFinish=false,manualAdvance=null;
    let hardTaskStreak=0,conflictStreak=0,lastObservedSpeed=null,throttlePending=null;const durationSamples=[],workSamples=[];let lastGovernor='GREEN';
    let lastHourCommitted=Math.floor((Math.max(0,Number(adapter.getSimTime())||0)+1e-6)/3600);
    let lastDayCommitted=Math.floor((Math.max(0,Number(adapter.getSimTime())||0)+1e-6)/86400);

    const report=(stage,error,fatal=false)=>{
      const text=`${stage}:${error?.stack||error}`;health.lastError=text;
      if(fatal)adapter.onFatal?.(error instanceof Error?error:new Error(String(error)));
      else adapter.onWarning?.({stage,error});
    };
    const getSpeed=()=>{
      let s=Number(adapter.getSpeed?.() ?? cfg.fallbackSpeed);
      if(!cfg.allowedSpeeds.includes(s)){s=cfg.fallbackSpeed;adapter.setSpeed?.(s,{reason:'sanitize'});}
      return s;
    };
    const simNow=()=>Math.max(0,Number(adapter.getSimTime())||0);
    const setSim=t=>adapter.setSimTime(Math.max(0,Number(t)||0));
    // Effective rates are configured by the host. Never cancel slow work by
    // repeatedly selecting the same fallback: otherwise no slice can reach its
    // atomic commit under pressure.
    const fast=s=>s>=8&&s>cfg.fallbackSpeed;
    // Wall-clock pacing, backlog, frame execution budget and render/persist cadence are
    // runtime-only concerns. They never own or write authoritative economic time.
    const pacing=PACING.create({...cfg,nowMs:clock,isFast:fast});
    const manualSnapshot=()=>manualAdvance?{target:manualAdvance.target,remaining:Math.max(0,manualAdvance.target-simNow()),speed:manualAdvance.speed,requestedSpeed:manualAdvance.requestedSpeed,batchSeconds:manualAdvance.batchSeconds,reason:manualAdvance.reason,requestedAt:manualAdvance.requestedAt,retries:manualAdvance.retries||0,yields:manualAdvance.yields||0}:null;
    function failManualAdvance(reason,meta={}){
      if(!manualAdvance)return false;
      const failed={...manualAdvance},at=simNow();
      cancelJob(`manual-advance-failed:${reason}`);manualAdvance=null;pacing.reset(clock());
      const detail={reason:String(reason||'manual-advance-failed'),stage:String(meta.stage||''),from:Number(meta.from??at),to:Number(meta.to??at),at,retries:Number(failed.retries)||0,error:meta.error?String(meta.error?.message||meta.error):''};
      health.manualFailures++;health.lastAdvanceFailure=detail;
      try{adapter.onAdvance?.({active:false,failed:true,target:failed.target,remaining:Math.max(0,failed.target-at),reason:detail.reason,stage:detail.stage,from:detail.from,to:detail.to,retries:detail.retries,error:detail.error});}catch(error){report('advance-failed',error,false);}
      return true;
    }
    function completeManualAdvance(){
      if(!manualAdvance||simNow()+1e-6<manualAdvance.target)return false;
      const completed={...manualAdvance};manualAdvance=null;pacing.clearBacklog();
      try{adapter.onAdvance?.({active:false,completed:true,target:completed.target,reason:completed.reason});}catch(error){report('advance-complete',error,false);}
      return true;
    }
    // Keep transaction frequency roughly constant across user multipliers.
    // One real second of intended progress per atomic slice means higher UI multipliers do not create
    // eight full-state transactions per real second as older builds did.
    const quantum=s=>Math.max(1e-6,Math.min(3600,Math.max(1,s)*cfg.quantumRealSeconds));
    function observeWork(stage,took,speed){
      took=Math.max(0,Number(took)||0);health.lastWorkStage=stage;workSamples.push(took);if(workSamples.length>40)workSamples.shift();health.avgWorkMs=workSamples.reduce((a,b)=>a+b,0)/Math.max(1,workSamples.length);
      if(stage==='create'){health.lastCreateMs=took;health.maxCreateMs=Math.max(health.maxCreateMs,took);}else if(stage==='finish'){health.lastFinishMs=took;health.maxFinishMs=Math.max(health.maxFinishMs,took);}
      if(took>=cfg.longTaskWarnMs){health.longTasks++;hardTaskStreak++;}else hardTaskStreak=0;if(took>=cfg.hardTaskMs)health.hardTasks++;
      const pressure=Math.max(health.avgWorkMs,took),governor=pressure>=cfg.hardTaskMs?'RED':pressure>=cfg.longTaskWarnMs?'ORANGE':pressure>=cfg.frameBudgetMs?'YELLOW':'GREEN';health.governor=governor;
      if(governor!==lastGovernor){lastGovernor=governor;try{adapter.onGovernor?.({level:governor,avgChunkMs:health.avgChunkMs,avgWorkMs:health.avgWorkMs,stage,took,speed});}catch(error){report('governor',error,false);}}
      // Work-pressure throttling is cooperative. Lowering a live multiplier does
      // not make fixed snapshot/commit work cheaper and only makes the game feel
      // slower. Calendar work yields without restarting its atomic slice; live
      // speed remains the player's choice. Repeated transaction conflicts retain
      // their separate fail-safe in finishJob().
      if(manualAdvance&&(governor==='RED'||hardTaskStreak>=cfg.hardTaskLimit))throttlePending={stage,took,reason:governor==='RED'?'governor-red':'watchdog'};
      return governor;
    }

    const boundaryFor=to=>TIME.boundaryAt(to);
    const alignBoundaryTarget=maxSlice=>TIME.clampSliceToBoundary(simNow(),maxSlice);

    function startJob(speed){
      const backlog=pacing.backlog();
      if(job||backlog<=1e-9)return false;
      // The app can opt into a small real-time batching window. This prevents a
      // full atomic fleet transaction on every 60/120 Hz display frame while
      // retaining exact hour/day boundaries and the same simulated elapsed time.
      if(!manualAdvance&&cfg.minRealSliceSeconds>0){const minimumSlice=alignBoundaryTarget(Math.min(quantum(speed),Math.max(1e-6,speed*cfg.minRealSliceSeconds)));if(backlog+1e-9<minimumSlice)return false;}
      // Calendar targets do not accrue real-time backlog. Preserve their bounded
      // batch extent when fixed create/commit costs trigger a lower pacing rate.
      let batch=manualAdvance?manualAdvance.batchSeconds:quantum(speed);
      if(manualAdvance&&typeof adapter.getManualSliceLimit==='function'){
        try{const ownerLimit=Number(adapter.getManualSliceLimit({from:simNow(),target:manualAdvance.target,speed,batchSeconds:batch}));if(Number.isFinite(ownerLimit)&&ownerLimit>0)batch=Math.min(batch,ownerLimit);}catch(error){report('manual-slice-limit',error,false);}
      }
      const slice=alignBoundaryTarget(Math.min(backlog,batch));
      if(!Number.isFinite(slice)||slice<=0)return false;
      jobSlice=slice;jobStart=simNow();jobSpeed=speed;jobBoundary=boundaryFor(jobStart+slice);jobWorkMs=0;jobReadyToFinish=false;
      const createStart=clock();
      try{
        job=adapter.createSliceJob(slice,{from:jobStart,to:jobStart+slice,speed,fast:fast(speed),boundary:{...jobBoundary}})||null;
        if(!job||typeof job.runChunk!=='function'||typeof job.finish!=='function'){
          health.lastError='adapter:createSliceJob-invalid';
          if(manualAdvance)failManualAdvance('create-job-invalid',{stage:'create',from:jobStart,to:jobStart+jobSlice});
          job=null;jobSlice=0;jobBoundary=null;return false;
        }
      }catch(error){if(manualAdvance)failManualAdvance('create-error',{stage:'create',from:jobStart,to:jobStart+jobSlice,error});report('createSliceJob',error,true);job=null;jobSlice=0;jobBoundary=null;return false;}
      finally{const took=clock()-createStart;jobWorkMs+=Math.max(0,took);observeWork('create',took,speed);}
      return true;
    }

    function cancelJob(reason='cancelled'){
      if(!job)return;
      try{job.cancel?.({reason,from:jobStart,to:jobStart+jobSlice,speed:jobSpeed,boundary:jobBoundary});}catch(error){report('sliceCancel',error,false);}
      health.cancels++;health.lastCancelReason=reason;
      job=null;jobSlice=0;jobStart=simNow();jobSpeed=0;jobBoundary=null;jobWorkMs=0;jobReadyToFinish=false;
    }

    function applyFallbackSpeed(meta){
      // Calendar advancement is a target-driven workload, not a live-speed mode.
      // Never restart an already-created atomic slice merely because a slower
      // device reports a long create/chunk/finish stage: that can starve commit
      // forever while the UI remains responsive. Pressure only reduces the NEXT
      // calendar batch; the current job survives and resumes on the next frame.
      if(manualAdvance)return;
      adapter.setSpeed?.(cfg.fallbackSpeed,meta);
    }
    function consumeThrottlePending(){
      if(!throttlePending)return false;
      const pending=throttlePending;throttlePending=null;
      applyFallbackSpeed({reason:pending.reason,took:pending.took,stage:pending.stage,avgWorkMs:health.avgWorkMs});
      hardTaskStreak=0;
      if(manualAdvance){
        health.manualThrottleYields++;
        manualAdvance.yields=(manualAdvance.yields||0)+1;
        // Keep every cooperative yield in health counters, but avoid flooding
        // diagnostics on slower iPhones during long calendar advances. Emit the
        // first yield and then one heartbeat per 60 yields only.
        if(manualAdvance.yields===1||manualAdvance.yields%60===0){
          try{adapter.onThrottle?.({took:pending.took,reason:`calendar-yield:${pending.reason}:${pending.stage}`,stage:pending.stage,yields:manualAdvance.yields});}catch(error){report('throttle-notify',error,false);}
        }
        return true;
      }
      pacing.clearBacklog();cancelJob(`${pending.reason}:${pending.stage}`);
      try{adapter.onThrottle?.({took:pending.took,reason:`${pending.reason}:${pending.stage}`,stage:pending.stage});}catch(error){report('throttle-notify',error,false);}
      return true;
    }

    function finishJob(speed){
      const activeJob=job,from=jobStart,to=jobStart+jobSlice,slice=jobSlice,boundary={...jobBoundary};
      let result,finishTook=0,finishError=null;const finishStart=clock();
      try{result=activeJob.finish({from,to,speed,boundary});}
      catch(error){finishError=error;if(manualAdvance)failManualAdvance('finish-error',{stage:'finish',from,to,error});report('sliceFinish',error,true);}
      finally{finishTook=Math.max(0,clock()-finishStart);jobWorkMs+=finishTook;observeWork('finish',finishTook,speed);}
      if(finishError){cancelJob('finish-error');pacing.clearBacklog();return {done:false,breakFrame:true};}
      const committed=result===true||result?.committed===true;
      if(!committed){
        const reason=result?.reason||'commit-rejected',retryable=reason==='asset-conflict'||result?.retry;
        health.lastCommitReason=reason;
        if(retryable){health.conflicts++;conflictStreak++;}
        cancelJob(reason);
        if(manualAdvance){
          const key=`${from}->${to}:${reason}`;
          if(manualAdvance.retryKey===key)manualAdvance.retries=(manualAdvance.retries||0)+1;else{manualAdvance.retryKey=key;manualAdvance.retries=1;}
          if(!retryable||manualAdvance.retries>=cfg.manualRetryLimit){failManualAdvance(reason,{stage:'commit',from,to});return {done:false,breakFrame:true};}
        }
        if(conflictStreak>=cfg.conflictLimit&&fast(speed)){applyFallbackSpeed({reason:'conflict-watchdog'});pacing.limitBacklog(cfg.maxBacklogNormal);conflictStreak=0;}
        return {done:false,breakFrame:true};
      }
      conflictStreak=0;if(manualAdvance){manualAdvance.retries=0;manualAdvance.retryKey='';}
      // The app transaction commits the same target time atomically with all state changes.
      // This assignment is an invariant check/synchronization only; it must never precede finish().
      setSim(to);
      pacing.consume(slice);
      health.slices++;health.lastSliceSeconds=slice;health.lastCommitReason='committed';health.lastProgressSim=to;health.lastProgressAt=clock();
      health.lastCycleMs=jobWorkMs;health.maxCycleMs=Math.max(health.maxCycleMs,jobWorkMs);job=null;jobSlice=0;jobStart=to;jobSpeed=0;jobBoundary=null;jobWorkMs=0;jobReadyToFinish=false;
      if(boundary.day!==null&&boundary.day>lastDayCommitted){lastDayCommitted=boundary.day;health.days++;health.lastBoundary=`day:${boundary.day}`;}
      if(boundary.hour!==null&&boundary.hour>lastHourCommitted){lastHourCommitted=boundary.hour;health.hours++;health.lastBoundary=`hour:${boundary.hour}`;}
      if(boundary.hour!==null&&boundary.hour-health.lastMaintenanceHour>=cfg.maintenanceEveryHours){
        health.lastMaintenanceHour=boundary.hour;
        try{adapter.onMaintenance?.(boundary.hour,{time:to,speed});}catch(error){report('maintenance',error,false);}
      }
      return {done:true,breakFrame:false};
    }

    function work(now,speed){
      // Calendar advance gets a slightly larger cooperative budget so long jumps
      // finish promptly, but every frame still yields back to WebKit. Live play
      // keeps the tighter budget to protect interaction and map presentation.
      const deadline=pacing.executionDeadline(!!manualAdvance);
      while(clock()<deadline){
        if(!job&&!startJob(speed))break;
        if(throttlePending){consumeThrottlePending();break;}
        if(jobReadyToFinish){
          const outcome=finishJob(speed);if(outcome.breakFrame)break;
          if(throttlePending){consumeThrottlePending();break;}
          continue;
        }
        if(clock()>=deadline)break;
        const chunkStart=clock();let done=false,pending=false;
        const chunkItems=manualAdvance?cfg.manualChunkItems:cfg.chunkItems;
        try{
          const result=job.runChunk(chunkItems,{deadline,speed,fast:fast(speed)});
          pending=result?.pending===true;done=result===true||result?.done===true;
        }catch(error){if(manualAdvance)failManualAdvance('chunk-error',{stage:'chunk',from:jobStart,to:jobStart+jobSlice,error});report('sliceChunk',error,true);cancelJob('chunk-error');pacing.clearBacklog();return;}
        const took=clock()-chunkStart;
        jobWorkMs+=Math.max(0,took);
        health.chunks++;health.lastChunkMs=took;health.maxChunkMs=Math.max(health.maxChunkMs,took);
        durationSamples.push(took);if(durationSamples.length>30)durationSamples.shift();health.avgChunkMs=durationSamples.reduce((a,b)=>a+b,0)/Math.max(1,durationSamples.length);
        if(done)jobReadyToFinish=true;
        observeWork('chunk',took,speed);
        // An asynchronous planner has yielded its work to a Worker. Stop this
        // frame here instead of spinning until the deadline; RAF will resume
        // the same atomic job when the result arrives.
        if(pending)break;
        if(throttlePending){consumeThrottlePending();break;}
        if(jobReadyToFinish&&clock()<deadline){const outcome=finishJob(speed);if(outcome.breakFrame)break;}
        if(throttlePending){consumeThrottlePending();break;}
        if(clock()>=deadline)break;
      }
    }

    function maybeRender(now,speed){
      if(pacing.shouldRender(now,speed)){try{adapter.onRender?.({now,speed,backlog:pacing.backlog(),jobActive:!!job});}catch(error){report('render',error,false);}}
    }
    function maybePersist(now,speed){
      if(pacing.shouldPersist(now,speed)){try{adapter.onPersist?.({now,speed});}catch(error){report('persist',error,false);}}
    }

    function advanceTo(target,options={}){
      const current=simNow(),requested=Number(target),maxSeconds=Math.max(86400,Math.min(366*86400,Number(options.maxSeconds)||366*86400));
      if(!Number.isFinite(requested)||requested<=current+1e-6)return {accepted:false,reason:'advance-target-not-forward',target:current};
      if(requested-current>maxSeconds)return {accepted:false,reason:'advance-target-too-far',target:current};
      const preferred=Number(options.speed),positiveSpeeds=cfg.allowedSpeeds.filter(speed=>speed>0),fastest=positiveSpeeds.length?Math.max(...positiveSpeeds):0;
      const speed=cfg.allowedSpeeds.includes(preferred)&&preferred>0?preferred:fastest;
      if(speed<=0)return {accepted:false,reason:'advance-speed-unavailable',target:current};
      const requestedBatch=Number(options.batchSeconds),batchSeconds=Math.max(cfg.manualMinBatchSeconds,Math.min(3600,Number.isFinite(requestedBatch)&&requestedBatch>0?requestedBatch:cfg.manualBatchSeconds));
      cancelJob('manual-advance-request');
      health.lastAdvanceFailure=null;health.lastProgressSim=current;health.lastProgressAt=clock();
      manualAdvance={target:requested,speed,requestedSpeed:speed,batchSeconds,reason:String(options.reason||'manual-advance'),requestedAt:clock(),retries:0,retryKey:'',yields:0};
      pacing.reset(clock());lastObservedSpeed=speed;
      try{adapter.onAdvance?.({active:true,target:requested,remaining:requested-current,speed,reason:manualAdvance.reason});}catch(error){report('advance-start',error,false);}
      return {accepted:true,...manualSnapshot()};
    }
    function cancelAdvance(reason='manual-advance-cancelled'){
      if(!manualAdvance)return false;
      const cancelled={...manualAdvance};cancelJob(reason);manualAdvance=null;pacing.reset(clock());
      try{adapter.onAdvance?.({active:false,cancelled:true,target:cancelled.target,reason});}catch(error){report('advance-cancel',error,false);}
      return true;
    }
    function frame(now=clock()){
      health.frames++;completeManualAdvance();
      const advancing=manualAdvance,speed=advancing?advancing.speed:getSpeed();
      if(lastObservedSpeed===null)lastObservedSpeed=speed;
      if(speed!==lastObservedSpeed){cancelJob('speed-change');pacing.reset(now);lastObservedSpeed=speed;maybeRender(now,speed);maybePersist(now,speed);return;}
      const suspended=!!adapter.isSuspended?.();
      if(advancing){
        const remaining=Math.max(0,advancing.target-simNow());
        if(remaining<=1e-6){completeManualAdvance();pacing.reset(now);maybeRender(now,speed);maybePersist(now,speed);return;}
        // Manual calendar navigation is target-driven. It never accrues wall-clock
        // backlog, but it refreshes the wall-clock anchor every frame so its own
        // duration can never be replayed as live catch-up after completion.
        pacing.setManualBacklog(remaining,now);
      }else{
        const observed=pacing.observeLiveFrame(now,speed,{suspended,paused:speed<=0});
        if(observed.droppedRealSeconds>0)health.droppedRealSeconds+=observed.droppedRealSeconds;
        if(observed.stalled)health.stallGaps=(health.stallGaps||0)+1;
        if(observed.clamped)health.backlogClamps++;
      }
      const hidden=pacing.snapshot().hidden;
      if(hidden||suspended||(speed<=0&&!advancing)){pacing.clearBacklog();cancelJob(hidden?'hidden':speed<=0?'paused':'suspended');maybeRender(now,speed);return;}
      work(now,speed);completeManualAdvance();maybeRender(now,speed);maybePersist(now,speed);
    }

    function reset(now=clock(),reason='reset'){
      const cancelled=manualAdvance;manualAdvance=null;cancelJob(reason);pacing.reset(now);jobSlice=0;jobStart=simNow();jobSpeed=0;jobBoundary=null;jobWorkMs=0;jobReadyToFinish=false;hardTaskStreak=0;conflictStreak=0;throttlePending=null;
      if(cancelled)try{adapter.onAdvance?.({active:false,cancelled:true,target:cancelled.target,reason});}catch(error){report('advance-reset',error,false);}
      lastHourCommitted=Math.floor((simNow()+1e-6)/3600);lastDayCommitted=Math.floor((simNow()+1e-6)/86400);lastObservedSpeed=getSpeed();
    }
    function setHidden(v){const hidden=!!v;reset(clock(),hidden?'hidden':'visible');pacing.setHidden(hidden,clock());if(hidden){try{adapter.onPersist?.({reason:'hidden',speed:getSpeed()});}catch(error){report('persist-hidden',error,false);}}}
    function snapshot(){const pace=pacing.snapshot();return {...health,simSeconds:simNow(),speed:getSpeed(),backlog:pace.backlog,jobActive:!!job,jobReadyToFinish,jobSlice,jobSpeed,hidden:pace.hidden,manualAdvance:manualSnapshot(),pacing:pace,config:{...cfg,allowedSpeeds:[...cfg.allowedSpeeds],nowMs:undefined}};}

    return {version:VERSION,frame,reset,setHidden,advanceTo,cancelAdvance,snapshot,health:()=>({...health}),config:()=>({...cfg,allowedSpeeds:[...cfg.allowedSpeeds],nowMs:undefined})};
  }

  const API=Object.freeze({VERSION,DEFAULTS,normalizeConfig,create});
  globalThis.GH_SIMULATION_CORE=API;
  if(globalThis.window&&globalThis.window!==globalThis)globalThis.window.GH_SIMULATION_CORE=API;
  if(typeof module!=='undefined'&&module.exports)module.exports=API;
})();

(()=>{
  'use strict';

  const VERSION='3.0.0';
  const DEFAULTS=Object.freeze({
    allowedSpeeds:Object.freeze([0,1,2,4]),
    fallbackSpeed:1,
    quantumRealSeconds:1,
    maxRealDelta:3,
    maxBacklogNormal:12,
    maxBacklogFast:96,
    frameBudgetMs:5.5,
    chunkItems:64,
    renderEveryNormalMs:180,
    renderEveryFastMs:450,
    persistEveryNormalMs:12000,
    persistEveryFastMs:30000,
    minRealSliceSeconds:0,
    maintenanceEveryHours:6,
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
    const positive=['quantumRealSeconds','maxRealDelta','maxBacklogNormal','maxBacklogFast','frameBudgetMs','chunkItems','renderEveryNormalMs','renderEveryFastMs','persistEveryNormalMs','persistEveryFastMs','maintenanceEveryHours','longTaskWarnMs','hardTaskMs','hardTaskLimit','conflictLimit'];
    for(const key of positive){const n=Number(cfg[key]);cfg[key]=Number.isFinite(n)&&n>0?n:DEFAULTS[key];}
    const minRealSliceSeconds=Number(cfg.minRealSliceSeconds);cfg.minRealSliceSeconds=Number.isFinite(minRealSliceSeconds)?Math.max(0,Math.min(1,minRealSliceSeconds)):0;
    cfg.chunkItems=Math.max(1,Math.floor(cfg.chunkItems));
    cfg.hardTaskLimit=Math.max(1,Math.floor(cfg.hardTaskLimit));
    cfg.conflictLimit=Math.max(1,Math.floor(cfg.conflictLimit));
    cfg.fallbackSpeed=cfg.allowedSpeeds.includes(Number(cfg.fallbackSpeed))?Number(cfg.fallbackSpeed):1;
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
      lastError:'',lastBoundary:'',lastSliceSeconds:0,lastMaintenanceHour:-1,lastCancelReason:'',lastCommitReason:'',lastWorkStage:'',governor:'GREEN',avgChunkMs:0,avgWorkMs:0
    };
    let lastReal=clock(),backlog=0,job=null,jobSlice=0,jobStart=0,jobSpeed=0,jobBoundary=null,jobWorkMs=0,manualAdvance=null;
    let lastRender=0,lastPersist=0,hidden=false,hardTaskStreak=0,conflictStreak=0,lastObservedSpeed=null,throttlePending=null;const durationSamples=[],workSamples=[];let lastGovernor='GREEN';
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
    const fast=s=>s>=8;
    const manualSnapshot=()=>manualAdvance?{target:manualAdvance.target,remaining:Math.max(0,manualAdvance.target-simNow()),speed:manualAdvance.speed,reason:manualAdvance.reason,requestedAt:manualAdvance.requestedAt}:null;
    function completeManualAdvance(){
      if(!manualAdvance||simNow()+1e-6<manualAdvance.target)return false;
      const completed={...manualAdvance};manualAdvance=null;backlog=0;
      try{adapter.onAdvance?.({active:false,completed:true,target:completed.target,reason:completed.reason});}catch(error){report('advance-complete',error,false);}
      return true;
    }
    // Keep transaction frequency roughly constant across user multipliers.
    // One real second of intended progress per atomic slice means higher UI multipliers do not create
    // eight full-state transactions per real second as older builds did.
    const quantum=s=>Math.max(1e-6,Math.min(3600,Math.max(1,s)*cfg.quantumRealSeconds));
    const backlogCap=s=>Math.max(fast(s)?cfg.maxBacklogFast:cfg.maxBacklogNormal,s*cfg.maxRealDelta*2);
    function observeWork(stage,took,speed){
      took=Math.max(0,Number(took)||0);health.lastWorkStage=stage;workSamples.push(took);if(workSamples.length>40)workSamples.shift();health.avgWorkMs=workSamples.reduce((a,b)=>a+b,0)/Math.max(1,workSamples.length);
      if(stage==='create'){health.lastCreateMs=took;health.maxCreateMs=Math.max(health.maxCreateMs,took);}else if(stage==='finish'){health.lastFinishMs=took;health.maxFinishMs=Math.max(health.maxFinishMs,took);}
      if(took>=cfg.longTaskWarnMs){health.longTasks++;hardTaskStreak++;}else hardTaskStreak=0;if(took>=cfg.hardTaskMs)health.hardTasks++;
      const pressure=Math.max(health.avgWorkMs,took),governor=pressure>=cfg.hardTaskMs?'RED':pressure>=cfg.longTaskWarnMs?'ORANGE':pressure>=cfg.frameBudgetMs?'YELLOW':'GREEN';health.governor=governor;
      if(governor!==lastGovernor){lastGovernor=governor;try{adapter.onGovernor?.({level:governor,avgChunkMs:health.avgChunkMs,avgWorkMs:health.avgWorkMs,stage,took,speed});}catch(error){report('governor',error,false);}}
      if(fast(speed)&&(governor==='RED'||hardTaskStreak>=cfg.hardTaskLimit))throttlePending={stage,took,reason:governor==='RED'?'governor-red':'watchdog'};
      return governor;
    }

    function boundaryFor(to){
      const hour=to/3600,day=to/86400;
      const atHour=Math.abs(hour-Math.round(hour))<1e-8;
      const atDay=Math.abs(day-Math.round(day))<1e-8;
      return {hour:atHour?Math.round(hour):null,day:atDay?Math.round(day):null};
    }
    function alignBoundaryTarget(maxSlice){
      const t=simNow(),nextHour=(Math.floor(t/3600)+1)*3600,nextDay=(Math.floor(t/86400)+1)*86400;
      return Math.max(1e-6,Math.min(maxSlice,nextHour-t,nextDay-t));
    }

    function startJob(speed){
      if(job||backlog<=1e-9)return false;
      // The app can opt into a small real-time batching window. This prevents a
      // full atomic fleet transaction on every 60/120 Hz display frame while
      // retaining exact hour/day boundaries and the same simulated elapsed time.
      if(cfg.minRealSliceSeconds>0){const minimumSlice=alignBoundaryTarget(Math.min(quantum(speed),Math.max(1e-6,speed*cfg.minRealSliceSeconds)));if(backlog+1e-9<minimumSlice)return false;}
      const slice=alignBoundaryTarget(Math.min(backlog,quantum(speed)));
      if(!Number.isFinite(slice)||slice<=0)return false;
      jobSlice=slice;jobStart=simNow();jobSpeed=speed;jobBoundary=boundaryFor(jobStart+slice);jobWorkMs=0;
      const createStart=clock();
      try{
        job=adapter.createSliceJob(slice,{from:jobStart,to:jobStart+slice,speed,fast:fast(speed),boundary:{...jobBoundary}})||null;
        if(!job||typeof job.runChunk!=='function'||typeof job.finish!=='function'){
          health.lastError='adapter:createSliceJob-invalid';job=null;jobSlice=0;jobBoundary=null;return false;
        }
      }catch(error){report('createSliceJob',error,true);job=null;jobSlice=0;jobBoundary=null;return false;}
      finally{const took=clock()-createStart;jobWorkMs+=Math.max(0,took);observeWork('create',took,speed);}
      return true;
    }

    function cancelJob(reason='cancelled'){
      if(!job)return;
      try{job.cancel?.({reason,from:jobStart,to:jobStart+jobSlice,speed:jobSpeed,boundary:jobBoundary});}catch(error){report('sliceCancel',error,false);}
      health.cancels++;health.lastCancelReason=reason;
      job=null;jobSlice=0;jobStart=simNow();jobSpeed=0;jobBoundary=null;jobWorkMs=0;
    }

    function finishJob(speed){
      const activeJob=job,from=jobStart,to=jobStart+jobSlice,slice=jobSlice,boundary={...jobBoundary};
      let result,finishTook=0,finishError=null;const finishStart=clock();
      try{result=activeJob.finish({from,to,speed,boundary});}
      catch(error){finishError=error;report('sliceFinish',error,true);}
      finally{finishTook=Math.max(0,clock()-finishStart);jobWorkMs+=finishTook;observeWork('finish',finishTook,speed);}
      if(finishError){cancelJob('finish-error');backlog=0;return {done:false,breakFrame:true};}
      const committed=result===true||result?.committed===true;
      if(!committed){
        const reason=result?.reason||'commit-rejected';
        health.lastCommitReason=reason;
        if(reason==='asset-conflict'||result?.retry){health.conflicts++;conflictStreak++;}
        cancelJob(reason);
        if(conflictStreak>=cfg.conflictLimit&&fast(speed)){if(manualAdvance)manualAdvance.speed=cfg.fallbackSpeed;adapter.setSpeed?.(cfg.fallbackSpeed,{reason:'conflict-watchdog'});backlog=Math.min(backlog,cfg.maxBacklogNormal);conflictStreak=0;}
        return {done:false,breakFrame:true};
      }
      conflictStreak=0;
      // The app transaction commits the same target time atomically with all state changes.
      // This assignment is an invariant check/synchronization only; it must never precede finish().
      setSim(to);
      backlog=Math.max(0,backlog-slice);
      health.slices++;health.lastSliceSeconds=slice;health.lastCommitReason='committed';
      health.lastCycleMs=jobWorkMs;health.maxCycleMs=Math.max(health.maxCycleMs,jobWorkMs);job=null;jobSlice=0;jobStart=to;jobSpeed=0;jobBoundary=null;jobWorkMs=0;
      if(boundary.day!==null&&boundary.day>lastDayCommitted){lastDayCommitted=boundary.day;health.days++;health.lastBoundary=`day:${boundary.day}`;}
      if(boundary.hour!==null&&boundary.hour>lastHourCommitted){lastHourCommitted=boundary.hour;health.hours++;health.lastBoundary=`hour:${boundary.hour}`;}
      if(boundary.hour!==null&&boundary.hour-health.lastMaintenanceHour>=cfg.maintenanceEveryHours){
        health.lastMaintenanceHour=boundary.hour;
        try{adapter.onMaintenance?.(boundary.hour,{time:to,speed});}catch(error){report('maintenance',error,false);}
      }
      return {done:true,breakFrame:false};
    }

    function work(now,speed){
      const deadline=now+cfg.frameBudgetMs;
      while(clock()<deadline){
        if(!job&&!startJob(speed))break;
        if(throttlePending){const pending=throttlePending;throttlePending=null;if(manualAdvance)manualAdvance.speed=cfg.fallbackSpeed;adapter.setSpeed?.(cfg.fallbackSpeed,{reason:pending.reason,took:pending.took,stage:pending.stage,avgWorkMs:health.avgWorkMs});backlog=0;cancelJob(`${pending.reason}:${pending.stage}`);hardTaskStreak=0;adapter.onThrottle?.({took:pending.took,reason:`${pending.reason}:${pending.stage}`,stage:pending.stage});break;}
        if(clock()>=deadline)break;
        const chunkStart=clock();let done=false;
        try{done=!!job.runChunk(cfg.chunkItems,{deadline,speed,fast:fast(speed)});}catch(error){report('sliceChunk',error,true);cancelJob('chunk-error');backlog=0;return;}
        const took=clock()-chunkStart;
        jobWorkMs+=Math.max(0,took);
        health.chunks++;health.lastChunkMs=took;health.maxChunkMs=Math.max(health.maxChunkMs,took);
        durationSamples.push(took);if(durationSamples.length>30)durationSamples.shift();health.avgChunkMs=durationSamples.reduce((a,b)=>a+b,0)/Math.max(1,durationSamples.length);
        observeWork('chunk',took,speed);
        if(throttlePending){const pending=throttlePending;throttlePending=null;if(manualAdvance)manualAdvance.speed=cfg.fallbackSpeed;adapter.setSpeed?.(cfg.fallbackSpeed,{reason:pending.reason,took:pending.took,stage:pending.stage,avgWorkMs:health.avgWorkMs});backlog=0;cancelJob(`${pending.reason}:${pending.stage}`);hardTaskStreak=0;adapter.onThrottle?.({took:pending.took,reason:`${pending.reason}:${pending.stage}`,stage:pending.stage});break;}
        if(done){const outcome=finishJob(speed);if(outcome.breakFrame)break;}
        if(throttlePending){const pending=throttlePending;throttlePending=null;if(manualAdvance)manualAdvance.speed=cfg.fallbackSpeed;adapter.setSpeed?.(cfg.fallbackSpeed,{reason:pending.reason,took:pending.took,stage:pending.stage,avgWorkMs:health.avgWorkMs});backlog=0;hardTaskStreak=0;adapter.onThrottle?.({took:pending.took,reason:`${pending.reason}:${pending.stage}`,stage:pending.stage});break;}
        if(clock()>=deadline)break;
      }
    }

    function maybeRender(now,speed){
      const every=fast(speed)?cfg.renderEveryFastMs:cfg.renderEveryNormalMs;
      if(now-lastRender>=every){lastRender=now;try{adapter.onRender?.({now,speed,backlog,jobActive:!!job});}catch(error){report('render',error,false);}}
    }
    function maybePersist(now,speed){
      const every=fast(speed)?cfg.persistEveryFastMs:cfg.persistEveryNormalMs;
      if(now-lastPersist>=every){lastPersist=now;try{adapter.onPersist?.({now,speed});}catch(error){report('persist',error,false);}}
    }

    function advanceTo(target,options={}){
      const current=simNow(),requested=Number(target),maxSeconds=Math.max(86400,Math.min(366*86400,Number(options.maxSeconds)||366*86400));
      if(!Number.isFinite(requested)||requested<=current+1e-6)return {accepted:false,reason:'advance-target-not-forward',target:current};
      if(requested-current>maxSeconds)return {accepted:false,reason:'advance-target-too-far',target:current};
      const preferred=Number(options.speed),positiveSpeeds=cfg.allowedSpeeds.filter(speed=>speed>0),fastest=positiveSpeeds.length?Math.max(...positiveSpeeds):0;
      const speed=cfg.allowedSpeeds.includes(preferred)&&preferred>0?preferred:fastest;
      if(speed<=0)return {accepted:false,reason:'advance-speed-unavailable',target:current};
      cancelJob('manual-advance-request');
      manualAdvance={target:requested,speed,reason:String(options.reason||'manual-advance'),requestedAt:clock()};
      backlog=0;lastReal=clock();lastObservedSpeed=speed;
      try{adapter.onAdvance?.({active:true,target:requested,remaining:requested-current,speed,reason:manualAdvance.reason});}catch(error){report('advance-start',error,false);}
      return {accepted:true,...manualSnapshot()};
    }
    function cancelAdvance(reason='manual-advance-cancelled'){
      if(!manualAdvance)return false;
      const cancelled={...manualAdvance};cancelJob(reason);manualAdvance=null;backlog=0;lastReal=clock();
      try{adapter.onAdvance?.({active:false,cancelled:true,target:cancelled.target,reason});}catch(error){report('advance-cancel',error,false);}
      return true;
    }
    function frame(now=clock()){
      health.frames++;completeManualAdvance();
      const advancing=manualAdvance,speed=advancing?advancing.speed:getSpeed();
      if(lastObservedSpeed===null)lastObservedSpeed=speed;
      if(speed!==lastObservedSpeed){cancelJob('speed-change');backlog=0;lastReal=now;lastObservedSpeed=speed;maybeRender(now,speed);maybePersist(now,speed);return;}
      let realDelta=(now-lastReal)/1000;lastReal=now;
      if(!Number.isFinite(realDelta)||realDelta<0)realDelta=0;
      if(realDelta>cfg.maxRealDelta){health.droppedRealSeconds+=realDelta;health.stallGaps=(health.stallGaps||0)+1;realDelta=0;}
      if(hidden||adapter.isSuspended?.()||(speed<=0&&!advancing)){backlog=0;cancelJob(hidden?'hidden':speed<=0?'paused':'suspended');maybeRender(now,speed);return;}
      if(advancing){
        const remaining=Math.max(0,advancing.target-simNow());
        if(remaining<=1e-6){completeManualAdvance();maybeRender(now,speed);maybePersist(now,speed);return;}
        // Manual calendar navigation sets a target; the normal atomic slice and
        // boundary machinery remain the only authority that advances game time.
        backlog=remaining;
      }else{
        backlog+=realDelta*speed;
        const cap=backlogCap(speed);if(backlog>cap){backlog=cap;health.backlogClamps++;}
      }
      work(now,speed);completeManualAdvance();maybeRender(now,speed);maybePersist(now,speed);
    }

    function reset(now=clock(),reason='reset'){
      const cancelled=manualAdvance;manualAdvance=null;cancelJob(reason);lastReal=now;backlog=0;jobSlice=0;jobStart=simNow();jobSpeed=0;jobBoundary=null;jobWorkMs=0;hardTaskStreak=0;conflictStreak=0;throttlePending=null;
      if(cancelled)try{adapter.onAdvance?.({active:false,cancelled:true,target:cancelled.target,reason});}catch(error){report('advance-reset',error,false);}
      lastHourCommitted=Math.floor((simNow()+1e-6)/3600);lastDayCommitted=Math.floor((simNow()+1e-6)/86400);lastObservedSpeed=getSpeed();
    }
    function setHidden(v){hidden=!!v;reset(clock(),hidden?'hidden':'visible');if(hidden){try{adapter.onPersist?.({reason:'hidden',speed:getSpeed()});}catch(error){report('persist-hidden',error,false);}}}
    function snapshot(){return {...health,simSeconds:simNow(),speed:getSpeed(),backlog,jobActive:!!job,jobSlice,jobSpeed,hidden,manualAdvance:manualSnapshot(),config:{...cfg,allowedSpeeds:[...cfg.allowedSpeeds],nowMs:undefined}};}

    return {version:VERSION,frame,reset,setHidden,advanceTo,cancelAdvance,snapshot,health:()=>({...health}),config:()=>({...cfg,allowedSpeeds:[...cfg.allowedSpeeds],nowMs:undefined})};
  }

  const API=Object.freeze({VERSION,DEFAULTS,normalizeConfig,create});
  globalThis.GH_SIMULATION_CORE=API;
  if(globalThis.window&&globalThis.window!==globalThis)globalThis.window.GH_SIMULATION_CORE=API;
  if(typeof module!=='undefined'&&module.exports)module.exports=API;
})();

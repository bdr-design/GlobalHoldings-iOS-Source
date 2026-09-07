(()=>{
  'use strict';

  const VERSION='2.9.0';
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
      lastError:'',lastBoundary:'',lastSliceSeconds:0,lastMaintenanceHour:-1,lastCancelReason:'',lastCommitReason:'',governor:'GREEN',avgChunkMs:0
    };
    let lastReal=clock(),backlog=0,job=null,jobSlice=0,jobStart=0,jobSpeed=0,jobBoundary=null;
    let lastRender=0,lastPersist=0,hidden=false,hardTaskStreak=0,conflictStreak=0,lastObservedSpeed=null;const durationSamples=[];let lastGovernor='GREEN';
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
    // Keep transaction frequency roughly constant across user multipliers.
    // One real second of intended progress per atomic slice means higher UI multipliers do not create
    // eight full-state transactions per real second as older builds did.
    const quantum=s=>Math.max(1e-6,Math.min(3600,Math.max(1,s)*cfg.quantumRealSeconds));
    const backlogCap=s=>Math.max(fast(s)?cfg.maxBacklogFast:cfg.maxBacklogNormal,s*cfg.maxRealDelta*2);

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
      const slice=alignBoundaryTarget(Math.min(backlog,quantum(speed)));
      if(!Number.isFinite(slice)||slice<=0)return false;
      jobSlice=slice;jobStart=simNow();jobSpeed=speed;jobBoundary=boundaryFor(jobStart+slice);
      try{
        job=adapter.createSliceJob(slice,{from:jobStart,to:jobStart+slice,speed,fast:fast(speed),boundary:{...jobBoundary}})||null;
        if(!job||typeof job.runChunk!=='function'||typeof job.finish!=='function'){
          health.lastError='adapter:createSliceJob-invalid';job=null;jobSlice=0;jobBoundary=null;return false;
        }
      }catch(error){report('createSliceJob',error,true);job=null;jobSlice=0;jobBoundary=null;return false;}
      return true;
    }

    function cancelJob(reason='cancelled'){
      if(!job)return;
      try{job.cancel?.({reason,from:jobStart,to:jobStart+jobSlice,speed:jobSpeed,boundary:jobBoundary});}catch(error){report('sliceCancel',error,false);}
      health.cancels++;health.lastCancelReason=reason;
      job=null;jobSlice=0;jobStart=simNow();jobSpeed=0;jobBoundary=null;
    }

    function finishJob(speed){
      const activeJob=job,from=jobStart,to=jobStart+jobSlice,slice=jobSlice,boundary={...jobBoundary};
      let result;
      try{result=activeJob.finish({from,to,speed,boundary});}
      catch(error){
        report('sliceFinish',error,true);cancelJob('finish-error');backlog=0;return {done:false,breakFrame:true};
      }
      const committed=result===true||result?.committed===true;
      if(!committed){
        const reason=result?.reason||'commit-rejected';
        health.lastCommitReason=reason;
        if(reason==='asset-conflict'||result?.retry){health.conflicts++;conflictStreak++;}
        cancelJob(reason);
        if(conflictStreak>=cfg.conflictLimit&&fast(speed)){adapter.setSpeed?.(cfg.fallbackSpeed,{reason:'conflict-watchdog'});backlog=Math.min(backlog,cfg.maxBacklogNormal);conflictStreak=0;}
        return {done:false,breakFrame:true};
      }
      conflictStreak=0;
      // The app transaction commits the same target time atomically with all state changes.
      // This assignment is an invariant check/synchronization only; it must never precede finish().
      setSim(to);
      backlog=Math.max(0,backlog-slice);
      health.slices++;health.lastSliceSeconds=slice;health.lastCommitReason='committed';
      job=null;jobSlice=0;jobStart=to;jobSpeed=0;jobBoundary=null;
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
        const chunkStart=clock();let done=false;
        try{done=!!job.runChunk(cfg.chunkItems,{deadline,speed,fast:fast(speed)});}catch(error){report('sliceChunk',error,true);cancelJob('chunk-error');backlog=0;return;}
        const took=clock()-chunkStart;
        health.chunks++;health.lastChunkMs=took;health.maxChunkMs=Math.max(health.maxChunkMs,took);
        durationSamples.push(took);if(durationSamples.length>30)durationSamples.shift();health.avgChunkMs=durationSamples.reduce((a,b)=>a+b,0)/Math.max(1,durationSamples.length);
        const governor=health.avgChunkMs>=cfg.hardTaskMs?'RED':health.avgChunkMs>=cfg.longTaskWarnMs?'ORANGE':health.avgChunkMs>=cfg.frameBudgetMs?'YELLOW':'GREEN';
        health.governor=governor;if(governor!==lastGovernor){lastGovernor=governor;try{adapter.onGovernor?.({level:governor,avgChunkMs:health.avgChunkMs,speed});}catch(error){report('governor',error,false);}}
        if(governor==='RED'&&fast(speed)){adapter.setSpeed?.(cfg.fallbackSpeed,{reason:'governor-red',avgChunkMs:health.avgChunkMs});backlog=0;cancelJob('governor-red');break;}
        if(took>=cfg.longTaskWarnMs){health.longTasks++;hardTaskStreak++;}else hardTaskStreak=0;
        if(took>=cfg.hardTaskMs)health.hardTasks++;
        if(hardTaskStreak>=cfg.hardTaskLimit&&fast(speed)){
          adapter.setSpeed?.(cfg.fallbackSpeed,{reason:'watchdog',took});
          backlog=0;cancelJob('watchdog');hardTaskStreak=0;adapter.onThrottle?.({took,reason:'repeated-long-chunks'});break;
        }
        if(done){const outcome=finishJob(speed);if(outcome.breakFrame)break;}
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

    function frame(now=clock()){
      health.frames++;
      const speed=getSpeed();
      if(lastObservedSpeed===null)lastObservedSpeed=speed;
      if(speed!==lastObservedSpeed){cancelJob('speed-change');backlog=0;lastReal=now;lastObservedSpeed=speed;maybeRender(now,speed);maybePersist(now,speed);return;}
      let realDelta=(now-lastReal)/1000;lastReal=now;
      if(!Number.isFinite(realDelta)||realDelta<0)realDelta=0;
      if(realDelta>cfg.maxRealDelta){health.droppedRealSeconds+=realDelta;health.stallGaps=(health.stallGaps||0)+1;realDelta=0;}
      if(hidden||adapter.isSuspended?.()||speed<=0){backlog=0;cancelJob(hidden?'hidden':speed<=0?'paused':'suspended');maybeRender(now,speed);return;}
      backlog+=realDelta*speed;
      const cap=backlogCap(speed);if(backlog>cap){backlog=cap;health.backlogClamps++;}
      work(now,speed);maybeRender(now,speed);maybePersist(now,speed);
    }

    function reset(now=clock(),reason='reset'){
      cancelJob(reason);lastReal=now;backlog=0;jobSlice=0;jobStart=simNow();jobSpeed=0;jobBoundary=null;hardTaskStreak=0;conflictStreak=0;
      lastHourCommitted=Math.floor((simNow()+1e-6)/3600);lastDayCommitted=Math.floor((simNow()+1e-6)/86400);lastObservedSpeed=getSpeed();
    }
    function setHidden(v){hidden=!!v;reset(clock(),hidden?'hidden':'visible');if(hidden){try{adapter.onPersist?.({reason:'hidden',speed:getSpeed()});}catch(error){report('persist-hidden',error,false);}}}
    function snapshot(){return {...health,simSeconds:simNow(),speed:getSpeed(),backlog,jobActive:!!job,jobSlice,jobSpeed,hidden,config:{...cfg,allowedSpeeds:[...cfg.allowedSpeeds],nowMs:undefined}};}

    return {version:VERSION,frame,reset,setHidden,snapshot,health:()=>({...health}),config:()=>({...cfg,allowedSpeeds:[...cfg.allowedSpeeds],nowMs:undefined})};
  }

  const API=Object.freeze({VERSION,DEFAULTS,normalizeConfig,create});
  globalThis.GH_SIMULATION_CORE=API;
  if(globalThis.window&&globalThis.window!==globalThis)globalThis.window.GH_SIMULATION_CORE=API;
  if(typeof module!=='undefined'&&module.exports)module.exports=API;
})();

(()=>{
  'use strict';

  const VERSION='3.0.0';
  const DEFAULTS=Object.freeze({
    maxRealDelta:3,
    maxBacklogNormal:12,
    maxBacklogFast:96,
    frameBudgetMs:5.5,
    manualFrameBudgetMs:10,
    renderEveryNormalMs:180,
    renderEveryFastMs:450,
    persistEveryNormalMs:12000,
    persistEveryFastMs:30000
  });
  const systemNowMs=()=>globalThis.performance?.now?.() ?? Date.now();
  const positive=(value,fallback)=>{const n=Number(value);return Number.isFinite(n)&&n>0?n:fallback;};

  function normalizeConfig(options={}){
    return {
      maxRealDelta:positive(options.maxRealDelta,DEFAULTS.maxRealDelta),
      maxBacklogNormal:positive(options.maxBacklogNormal,DEFAULTS.maxBacklogNormal),
      maxBacklogFast:positive(options.maxBacklogFast,DEFAULTS.maxBacklogFast),
      frameBudgetMs:positive(options.frameBudgetMs,DEFAULTS.frameBudgetMs),
      manualFrameBudgetMs:positive(options.manualFrameBudgetMs,DEFAULTS.manualFrameBudgetMs),
      renderEveryNormalMs:positive(options.renderEveryNormalMs,DEFAULTS.renderEveryNormalMs),
      renderEveryFastMs:positive(options.renderEveryFastMs,DEFAULTS.renderEveryFastMs),
      persistEveryNormalMs:positive(options.persistEveryNormalMs,DEFAULTS.persistEveryNormalMs),
      persistEveryFastMs:positive(options.persistEveryFastMs,DEFAULTS.persistEveryFastMs)
    };
  }

  function create(options={}){
    const cfg=normalizeConfig(options),clock=typeof options.nowMs==='function'?options.nowMs:systemNowMs;
    let lastReal=clock(),backlog=0,lastRender=0,lastPersist=0,hidden=false,droppedRealSeconds=0,backlogClamps=0,stallGaps=0;
    const fast=s=>!!options.isFast?.(s);
    const backlogCap=s=>Math.max(fast(s)?cfg.maxBacklogFast:cfg.maxBacklogNormal,Math.max(0,Number(s)||0)*cfg.maxRealDelta*2);

    function reset(now=clock()){
      const t=Number(now);lastReal=Number.isFinite(t)?t:clock();backlog=0;
      return snapshot();
    }
    function setHidden(value,now=clock()){hidden=!!value;reset(now);return hidden;}
    function observeLiveFrame(now,speed,{suspended=false,paused=false}={}){
      const frameNow=Number(now),safeNow=Number.isFinite(frameNow)?frameNow:clock();let realDelta=(safeNow-lastReal)/1000;lastReal=safeNow;
      if(!Number.isFinite(realDelta)||realDelta<0)realDelta=0;
      let dropped=0,clamped=false,stalled=false;
      if(realDelta>cfg.maxRealDelta){dropped=realDelta;droppedRealSeconds+=realDelta;stallGaps++;realDelta=0;stalled=true;}
      if(hidden||suspended||paused){backlog=0;return {realDelta,droppedRealSeconds:dropped,clamped,stalled,backlog};}
      backlog+=realDelta*Math.max(0,Number(speed)||0);
      const cap=backlogCap(speed);if(backlog>cap){backlog=cap;backlogClamps++;clamped=true;}
      return {realDelta,droppedRealSeconds:dropped,clamped,stalled,backlog};
    }
    function setManualBacklog(seconds,now=clock()){const t=Number(now);lastReal=Number.isFinite(t)?t:clock();const n=Number(seconds);backlog=Number.isFinite(n)?Math.max(0,n):0;return backlog;}
    function limitBacklog(maximum){const n=Number(maximum);if(Number.isFinite(n)&&n>=0)backlog=Math.min(backlog,n);return backlog;}
    function consume(seconds){const n=Number(seconds);if(Number.isFinite(n)&&n>0)backlog=Math.max(0,backlog-n);return backlog;}
    function clearBacklog(){backlog=0;return 0;}
    function executionDeadline(manual=false){return clock()+(manual?cfg.manualFrameBudgetMs:cfg.frameBudgetMs);}
    function shouldRender(now,speed){const every=fast(speed)?cfg.renderEveryFastMs:cfg.renderEveryNormalMs;if(Number(now)-lastRender<every)return false;lastRender=Number(now);return true;}
    function shouldPersist(now,speed){const every=fast(speed)?cfg.persistEveryFastMs:cfg.persistEveryNormalMs;if(Number(now)-lastPersist<every)return false;lastPersist=Number(now);return true;}
    function snapshot(){return {version:VERSION,lastReal,backlog,hidden,lastRender,lastPersist,droppedRealSeconds,backlogClamps,stallGaps,config:{...cfg}};}

    return {version:VERSION,reset,setHidden,observeLiveFrame,setManualBacklog,limitBacklog,consume,clearBacklog,backlog:()=>backlog,executionDeadline,shouldRender,shouldPersist,snapshot,config:()=>({...cfg})};
  }

  const API=Object.freeze({VERSION,DEFAULTS,normalizeConfig,create});
  globalThis.GH_SIMULATION_PACING_CORE=API;
  if(globalThis.window&&globalThis.window!==globalThis)globalThis.window.GH_SIMULATION_PACING_CORE=API;
  if(typeof module!=='undefined'&&module.exports)module.exports=API;
})();

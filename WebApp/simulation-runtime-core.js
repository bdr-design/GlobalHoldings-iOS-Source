(()=>{
  'use strict';

  // Owns simulation task cadence. Authoritative simulation work deliberately
  // runs in timer tasks, never inside requestAnimationFrame; RAF is reserved for
  // presentation and cadence observation. Exactly one wake-up may be pending.
  const VERSION='1.0.0';
  const systemNow=()=>globalThis.performance?.now?.() ?? Date.now();

  function create({engine,getSpeed=()=>0,isHidden=()=>false,hasDeferredWork=()=>false,onError=()=>{}}={},options={}){
    if(!engine||typeof engine.frame!=='function'||typeof engine.snapshot!=='function')throw new TypeError('Simulation runtime requires an engine');
    const clock=typeof options.nowMs==='function'?options.nowMs:systemNow,
      schedule=typeof options.setTimer==='function'?options.setTimer:(fn,delay)=>setTimeout(fn,delay),
      unschedule=typeof options.clearTimer==='function'?options.clearTimer:id=>clearTimeout(id),
      intervals={manual:Math.max(4,Number(options.manualIntervalMs)||8),live:Math.max(8,Number(options.liveIntervalMs)||16),deferred:Math.max(16,Number(options.deferredIntervalMs)||50),paused:Math.max(100,Number(options.pausedIntervalMs)||250),hidden:Math.max(500,Number(options.hiddenIntervalMs)||1000)};
    let running=false,timer=null,generation=0,inTick=false,workSinceDrain=0;
    const health={version:VERSION,ticks:0,wakes:0,cancelledWakes:0,errors:0,longTicks:0,maxTickMs:0,lastTickMs:0,lastDelayMs:0,pending:false,running:false,inTick:false};

    function delay(){
      if(isHidden())return intervals.hidden;
      const snapshot=engine.snapshot();
      if(snapshot.manualAdvance||snapshot.jobActive)return intervals.manual;
      if(Number(getSpeed())>0)return intervals.live;
      return hasDeferredWork()?intervals.deferred:intervals.paused;
    }
    function clearPending(){
      if(timer===null)return false;
      try{unschedule(timer);}catch(_error){}
      timer=null;health.pending=false;health.cancelledWakes++;return true;
    }
    function arm(wait=delay()){
      if(!running||timer!==null)return false;
      const token=generation;health.lastDelayMs=Math.max(0,Number(wait)||0);health.pending=true;
      timer=schedule(()=>{timer=null;health.pending=false;if(!running||token!==generation)return;tick();},health.lastDelayMs);
      return true;
    }
    function tick(){
      if(!running||inTick)return false;
      inTick=true;health.inTick=true;const started=clock();
      try{engine.frame(started);health.ticks++;}
      catch(error){health.errors++;try{onError(error);}catch(_error){}}
      finally{
        const took=Math.max(0,clock()-started);health.lastTickMs=took;health.maxTickMs=Math.max(health.maxTickMs,took);if(took>=50)health.longTicks++;workSinceDrain+=took;inTick=false;health.inTick=false;arm();
      }
      return true;
    }
    function start(){if(running)return false;running=true;generation++;health.running=true;arm(0);return true;}
    // Starting is a lifecycle decision owned by the app bootstrap/pageshow path.
    // A signal emitted during bootstrap or after pagehide must never resurrect
    // the scheduler implicitly.
    function wake(){if(!running)return false;generation++;clearPending();health.wakes++;return arm(0);}
    function stop(){if(!running&&!timer)return false;running=false;generation++;health.running=false;clearPending();return true;}
    function dispose(){stop();workSinceDrain=0;}
    function drainWorkMs(){const value=workSinceDrain;workSinceDrain=0;return value;}
    function snapshot(){return {...health,running,pending:timer!==null,inTick,intervals:{...intervals}};}
    return Object.freeze({VERSION,start,wake,stop,dispose,drainWorkMs,snapshot});
  }

  const API=Object.freeze({VERSION,create});
  globalThis.GH_SIMULATION_RUNTIME_CORE=API;
  if(globalThis.window&&globalThis.window!==globalThis)globalThis.window.GH_SIMULATION_RUNTIME_CORE=API;
  if(typeof module!=='undefined'&&module.exports)module.exports=API;
})();

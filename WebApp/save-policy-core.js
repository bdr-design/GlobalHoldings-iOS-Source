// Build 358 (save policy): when the game saves the simulated progress made between the player's own commands.
// Every player command already saves itself (a durable command commits only after its save), so a checkpoint here only
// protects time that passed: fleet movement, revenue, daily closes. A save blocks the main thread for its validation
// and serialization, so the game does not save on a timer while it runs. It saves:
//   - when the app is hidden or closed (simulation-core setHidden, AppDelegate -> persistForBackground);
//   - when the real-time cap has passed since the last save of any kind: at the first quiet moment (time stopped, no
//     calendar advance), or regardless of it once the grace period has also passed;
//   - when the player asks (Save Now).
// Nothing is saved while a calendar advance runs (the host skips the check then).
// Pure functions only; the app supplies the clock, the time of the last save and whether the moment is quiet.
(()=>{
  'use strict';
  const VERSION='1.0.0';
  const CAP_CHOICES=Object.freeze([0,5,10,15,30]),DEFAULT_CAP_MINUTES=15,GRACE_MS=5*60000,RETRY_MS=30000;
  function capMinutes(state){const value=Number(state?.savePolicy?.capMinutes);return CAP_CHOICES.includes(value)?value:DEFAULT_CAP_MINUTES;}
  // Why a checkpoint is due now, or null. lastSaveAtMs is the newest save of any kind (checkpoint, command, background);
  // lastAttemptAtMs spaces retries after a refused save. quiet may be a function, read only when the cap has passed.
  function due({nowMs,lastSaveAtMs,capMinutes:cap=DEFAULT_CAP_MINUTES,quiet=false,lastAttemptAtMs=null}={}){
    const now=Number(nowMs),finite=value=>value!=null&&Number.isFinite(Number(value));if(!Number.isFinite(now)||!finite(lastSaveAtMs))return null;
    if(finite(lastAttemptAtMs)&&now-Number(lastAttemptAtMs)<RETRY_MS)return null;
    const capMs=Math.max(0,Number(cap)||0)*60000,age=now-Number(lastSaveAtMs);if(capMs<=0)return null;
    if(age>=capMs+GRACE_MS)return 'cap-forced';if(age>=capMs&&(typeof quiet==='function'?quiet():quiet))return 'cap-quiet';
    return null;
  }
  const API=Object.freeze({VERSION,CAP_CHOICES,DEFAULT_CAP_MINUTES,GRACE_MS,RETRY_MS,capMinutes,due});
  globalThis.GH_SAVE_POLICY=API;if(typeof module!=='undefined'&&module.exports)module.exports=API;
})();

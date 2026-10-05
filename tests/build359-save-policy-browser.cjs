'use strict';
// Build 358 (save policy, GH_SAVE_POLICY): the game does not save on a timer while it runs. Player commands save
// themselves; between them the game saves when the app is hidden, when a new quarter of the game calendar begins, and
// when the real-time cap (15 min by default, a Settings choice) has passed since the last save: at the first quiet
// moment (time stopped), or regardless of it once the 5-minute grace has also passed. Save Now saves at once.
// 1. The pure rules (quarters, cap, grace, retry spacing, the cap choices).
// 2. The real game (local DOM, an in-page native vault that records every commit):
//    - live play at the top speed with map mode and layer changes: no save at all;
//    - nothing is saved while a calendar advance runs, even with the cap overdue; an advance across April 1 is saved
//      once, after it ends;
//    - the cap: no save while time runs, one at the first stopped moment, one regardless after the grace, none when
//      the cap is "on exit only";
//    - Settings: the card, the cap choice (saved with the next save), Save Now;
//    - hiding the app saves.
const assert=require('node:assert/strict'),path=require('node:path');
const {chromium}=require('playwright'),{boot}=require('./helpers/local-dom-app');
const POLICY=require(path.join(process.env.GH_TEST_SOURCE_DIR||path.resolve(__dirname,'..'),'WebApp/save-policy-core.js'));

// 1. Pure rules.
{
  const START=Date.UTC(2026,0,1),day=d=>d*86400,min=m=>m*60000;
  assert.equal(POLICY.quarterOf(0,START),2026*4);assert.equal(POLICY.quarterOf(day(89)+86399,START),2026*4,'March 31 is still Q1');
  assert.equal(POLICY.quarterOf(day(90),START),2026*4+1,'April 1 begins Q2');assert.equal(POLICY.quarterOf(day(365),START),2027*4,'a new year is a new quarter');
  assert.equal(POLICY.nextQuarterStartSeconds(day(10),START),day(90));assert.equal(POLICY.nextQuarterStartSeconds(day(90),START),day(181));
  const base={nowMs:min(1),lastSaveAtMs:0,lastSaveSimSeconds:day(10),simSeconds:day(20),simStartMs:START,capMinutes:15,quiet:true};
  assert.equal(POLICY.due(base),null,'nothing is due inside a quarter before the cap');
  assert.equal(POLICY.due({...base,simSeconds:day(90)}),'quarter','a new quarter is due at once, while time runs too');
  assert.equal(POLICY.due({...base,simSeconds:day(90),quiet:false}),'quarter');
  assert.equal(POLICY.due({...base,nowMs:min(15),quiet:false}),null,'the cap waits for a quiet moment');
  assert.equal(POLICY.due({...base,nowMs:min(15)}),'cap-quiet');
  let reads=0;assert.equal(POLICY.due({...base,nowMs:min(14),quiet:()=>{reads++;return true;}}),null);assert.equal(reads,0,'quiet is read only once the cap has passed');
  assert.equal(POLICY.due({...base,nowMs:min(20)-1,quiet:false}),null);assert.equal(POLICY.due({...base,nowMs:min(20),quiet:false}),'cap-forced','the grace ends the wait');
  assert.equal(POLICY.due({...base,nowMs:min(600),capMinutes:0,quiet:false}),null,'"on exit only" never saves by time');
  assert.equal(POLICY.due({...base,simSeconds:day(90),lastAttemptAtMs:min(1)-1000}),null,'a refused save is retried after 30 s');
  assert.equal(POLICY.due({...base,simSeconds:day(90),lastAttemptAtMs:min(1)-30000}),'quarter');
  assert.equal(POLICY.due({...base,nowMs:1000,simSeconds:day(90),lastAttemptAtMs:null}),'quarter','no attempt yet is not an attempt at time 0');
  assert.equal(POLICY.due({...base,nowMs:min(60),lastSaveAtMs:null}),null,'an unknown last save time does not trigger the cap');
  assert.deepEqual([...POLICY.CAP_CHOICES],[0,5,10,15,30]);assert.equal(POLICY.capMinutes({}),15);assert.equal(POLICY.capMinutes({savePolicy:{capMinutes:7}}),15,'an unknown choice falls back to the default');assert.equal(POLICY.capMinutes({savePolicy:{capMinutes:0}}),0);
}

function installVault(){
  const vault=window.__VAULT__={commits:[]};
  const deliver=(name,detail)=>setTimeout(()=>window.dispatchEvent(new CustomEvent(name,{detail})),0);
  const bridge={postMessage(m){
    if(m.action==='storeSaveChunk')return deliver('gh-native-chunk-ack',{requestId:m.requestId,id:m.id,success:true});
    if(m.action==='commitSave'||m.action==='resetGameSave'){
      const parsed=JSON.parse(m.saveJSON);vault.commits.push({simSeconds:parsed.simSeconds,savePolicy:parsed.savePolicy||null,saveRevision:m.saveRevision,advancing:!!window.__AUDIT__?.simulationEngine?.snapshot?.().manualAdvance});
      deliver(m.action==='resetGameSave'?'gh-native-reset-ack':'gh-native-save-ack',{requestId:m.requestId,action:m.action,saveRevision:m.saveRevision,resetEpoch:m.resetEpoch,saveSchemaVersion:m.saveSchemaVersion,saveHash:m.saveHash,success:true,generation:vault.commits.length});
    }
  }};
  window.webkit={messageHandlers:{saveBridge:bridge,updateBridge:bridge}};window.GH_NATIVE_BUILD=358;
}

(async()=>{
  const browser=await chromium.launch({headless:true}),errors=[];
  try{
    const {page}=await boot({browser,errors});page.setDefaultTimeout(200000);
    await page.evaluate(installVault);
    // The policy reads the last save's time from GH_PERSISTENCE.saveCadence: __AGE__(ms) makes the save that exists now
    // look that much older (a save made after it is reported as it is).
    await page.evaluate(()=>{const P=window.GH_PERSISTENCE;let aged=null;window.__AGE__=ms=>{aged=ms>0?{atMs:P.saveCadence().lastSaveAtMs,ms}:null;};
      const wrapped={...P,saveCadence(){const c=P.saveCadence();return aged&&c.lastSaveAtMs===aged.atMs?{...c,lastSaveAtMs:c.lastSaveAtMs-aged.ms}:c;}};window.GH_PERSISTENCE=wrapped;globalThis.GH_PERSISTENCE=wrapped;});
    const commits=()=>page.evaluate(()=>window.__VAULT__.commits.length);
    const settle=()=>page.evaluate(async()=>{const a=__AUDIT__,s=__GH_STATE__;for(let i=0;i<400&&(a.simulationEngine.snapshot().manualAdvance||GH_TRANSACTION_CORE.isStaged(s)||GH_PERSISTENCE.isLocked());i++)await new Promise(r=>setTimeout(r,25));await GH_PERSISTENCE.drain();});
    // A first save establishes the cadence (as the founding command does in a real game).
    await page.evaluate(()=>__AUDIT__.save());await settle();
    const first=await commits();assert.equal(first,1,'one baseline save');

    // Live play at the top speed with map changes: no save.
    const live=await page.evaluate(async()=>{const a=__AUDIT__,before=__VAULT__.commits.length;a.setSpeed(4);
      for(const mode of ['network','expansion','operations']){document.querySelector(`.map-modes [data-map-mode="${mode}"]`)?.click();await new Promise(r=>setTimeout(r,1200));}
      document.querySelector('#layerMenu button')?.click();await new Promise(r=>setTimeout(r,4500));a.setSpeed(0);return {saves:__VAULT__.commits.length-before,sim:__GH_STATE__.simSeconds};});
    await settle();
    assert.equal(live.saves,0,`live play with map changes does not save (${JSON.stringify(live)})`);assert.ok(live.sim>3600,'time moved');

    // Calendar: within the quarter no save; across April 1 exactly one, after the quarter began.
    const advance=days=>page.evaluate(async d=>{const a=__AUDIT__,s=__GH_STATE__,target=(Math.floor(s.simSeconds/86400)+d)*86400,before=__VAULT__.commits.length;
      for(let attempt=0;attempt<20&&s.simSeconds<target-1;attempt++){a.simulationEngine.advanceTo(target,{speed:600,batchSeconds:3600,reason:'qa-save-policy',maxSeconds:400*86400});
        while(a.simulationEngine.snapshot().manualAdvance||GH_TRANSACTION_CORE.isStaged(s))await new Promise(r=>setTimeout(r,25));}
      await new Promise(r=>setTimeout(r,1500));return {reached:s.simSeconds>=target-1,day:Math.floor(s.simSeconds/86400),saves:__VAULT__.commits.slice(before)};},days);
    const toMarch=await page.evaluate(()=>88-Math.floor(__GH_STATE__.simSeconds/86400));
    const inside=await advance(toMarch);await settle();
    assert.equal(inside.reached,true);assert.equal(inside.day,88);assert.deepEqual(inside.saves,[],'an advance inside a quarter does not save');
    const across=await advance(4);await settle();
    assert.equal(across.reached,true);assert.equal(across.saves.length,1,`one quarter save (${JSON.stringify(across.saves)})`);
    assert.equal(across.saves[0].advancing,false,'the quarter save waits for the advance to end');assert.ok(across.saves[0].simSeconds>=92*86400-1,'and holds its end');
    // An overdue cap does not save during an advance either.
    await page.evaluate(()=>window.__AGE__(25*60000));const overdue=await advance(3);await page.evaluate(()=>window.__AGE__(0));await settle();
    assert.deepEqual(overdue.saves.filter(row=>row.advancing),[],'no save while the advance runs');

    // The cap: not while time runs; at the first stopped moment; regardless after the grace; never on "exit only".
    const capRun=await page.evaluate(async()=>{const a=__AUDIT__,before=__VAULT__.commits.length;window.__AGE__(16*60000);a.setSpeed(2);await new Promise(r=>setTimeout(r,3000));const running=__VAULT__.commits.length-before;
      a.setSpeed(0);await new Promise(r=>setTimeout(r,2500));const stopped=__VAULT__.commits.length-before-running;window.__AGE__(0);return {running,stopped};});
    await settle();assert.deepEqual(capRun,{running:0,stopped:1},'the cap waits for a stopped moment, then saves once');
    const forced=await page.evaluate(async()=>{const a=__AUDIT__,before=__VAULT__.commits.length;window.__AGE__(21*60000);a.setSpeed(2);await new Promise(r=>setTimeout(r,2500));const n=__VAULT__.commits.length-before;window.__AGE__(0);a.setSpeed(0);return n;});
    await settle();assert.equal(forced,1,'after the grace the cap saves while time runs');
    await page.evaluate(async()=>{__AUDIT__.openDrawer('settings');await new Promise(r=>setTimeout(r,200));});
    const card=await page.evaluate(()=>{const c=document.querySelector('.save-policy-card');return c?{choices:[...c.querySelectorAll('[data-save-cap]')].map(b=>[b.dataset.saveCap,b.getAttribute('aria-pressed')]),saveNow:!!c.querySelector('.save-now-btn'),text:c.textContent}:null;});
    assert.ok(card,'the Settings card is shown');assert.deepEqual(card.choices,[['0','false'],['5','false'],['10','false'],['15','true'],['30','false']]);assert.equal(card.saveNow,true);assert.match(card.text,/الحفظ الربعي القادم/);
    await page.click('.save-policy-card [data-save-cap="0"]');
    const off=await page.evaluate(async()=>{const a=__AUDIT__,before=__VAULT__.commits.length;window.__AGE__(120*60000);await new Promise(r=>setTimeout(r,2500));const n=__VAULT__.commits.length-before;window.__AGE__(0);return {n,cap:__GH_STATE__.savePolicy?.capMinutes,pressed:document.querySelector('.save-policy-card [data-save-cap="0"]')?.getAttribute('aria-pressed')};});
    assert.deepEqual(off,{n:0,cap:0,pressed:'true'},'"on exit only" never saves by time, and the choice is shown');
    await page.click('.save-policy-card [data-save-cap="30"]');
    const saveNowBefore=await commits();await page.click('.save-policy-card .save-now-btn');await settle();
    const savedNow=await page.evaluate(()=>__VAULT__.commits.at(-1));assert.equal(await commits(),saveNowBefore+1,'Save Now saves once');
    assert.deepEqual(savedNow.savePolicy,{capMinutes:30},'the cap choice is saved with the next save');

    // Hiding the app saves.
    const hidden=await page.evaluate(async()=>{const before=__VAULT__.commits.length;Object.defineProperty(document,'hidden',{configurable:true,get:()=>true});document.dispatchEvent(new Event('visibilitychange'));
      await new Promise(r=>setTimeout(r,1500));const n=__VAULT__.commits.length-before;Object.defineProperty(document,'hidden',{configurable:true,get:()=>false});document.dispatchEvent(new Event('visibilitychange'));return n;});
    assert.equal(hidden,1,'hiding the app saves');
    assert.deepEqual(errors,[]);
    console.log(JSON.stringify({suite:'build359-save-policy-browser',live,inside:{day:inside.day,saves:inside.saves.length},across:across.saves,capRun,forced,off,hidden},null,1));
    console.log('BUILD359_SAVE_POLICY_PASS');
  }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});

'use strict';
// Build 359 (the ordinary save was one block of 80-200 ms; stopping the fault recorder saved twice). The real game
// (local DOM, an in-page native vault that records every commit):
// - Save Now saves a copy of the state in slices (GH_PERSISTENCE.commitStateSliced): it commits once, with the state of
//   the moment it was asked, its first synchronous part is short and it yields to the frame;
// - persistence is locked from the copy to the commit (the simulation does not advance), and a save asked meanwhile
//   (Save Now again, or an ordinary save) runs once more after it;
// - a player command asked during the save waits for it and commits after it, at the next revision;
// - stopping the fault recorder from its panel saves once.
const assert=require('node:assert/strict');
const {chromium}=require('playwright'),{boot}=require('./helpers/local-dom-app');

function installVault(){
  const vault=window.__VAULT__={commits:[]};
  const deliver=(name,detail)=>setTimeout(()=>window.dispatchEvent(new CustomEvent(name,{detail})),0);
  const bridge={postMessage(m){
    if(m.action==='storeSaveChunk')return deliver('gh-native-chunk-ack',{requestId:m.requestId,id:m.id,success:true});
    if(m.action==='commitSave'||m.action==='resetGameSave'){
      const parsed=JSON.parse(m.saveJSON);vault.commits.push({simSeconds:parsed.simSeconds,saveRevision:m.saveRevision,marker:parsed.qaMarker??null});
      deliver(m.action==='resetGameSave'?'gh-native-reset-ack':'gh-native-save-ack',{requestId:m.requestId,action:m.action,saveRevision:m.saveRevision,resetEpoch:m.resetEpoch,saveSchemaVersion:m.saveSchemaVersion,saveHash:m.saveHash,success:true,generation:vault.commits.length});
    }
  }};
  window.webkit={messageHandlers:{saveBridge:bridge,updateBridge:bridge}};window.GH_NATIVE_BUILD=358;
}

(async()=>{
  const browser=await chromium.launch({headless:true}),errors=[],results=[];
  const test=async(name,fn)=>{try{results.push({name,ok:true,detail:await fn()});}catch(error){results.push({name,ok:false,error:String(error?.stack||error).slice(0,2000)});}};
  try{
    const {page}=await boot({browser,errors});page.setDefaultTimeout(200000);
    await page.evaluate(installVault);
    await page.evaluate(()=>__AUDIT__.save());

    await test('Save Now commits once, as asked, over frames',async()=>{
      return page.evaluate(async()=>{
        const s=__GH_STATE__,v=window.__VAULT__,before=v.commits.length,revision=s.saveRevision;s.qaMarker='asked';let frames=0,run=true;const tick=()=>{frames++;if(run)requestAnimationFrame(tick);};requestAnimationFrame(tick);
        const t=performance.now(),pending=__AUDIT__.saveNow(),syncMs=performance.now()-t;s.qaMarker='after';
        const ok=await pending;run=false;
        if(ok!==true)throw new Error(`the save failed (${ok})`);if(v.commits.length!==before+1)throw new Error(`one commit (${v.commits.length-before})`);
        const commit=v.commits.at(-1);if(commit.marker!=='asked')throw new Error(`the save holds the state of the moment it was asked (${commit.marker})`);
        if(s.saveRevision!==revision+1||commit.saveRevision!==revision+1)throw new Error('the next revision');
        const timing=GH_PERSISTENCE.telemetry().timings.samples.filter(r=>r.kind==='sliced-save').at(-1);if(!timing?.ok)throw new Error('the sliced path ran');
        if(frames<1)throw new Error('it yielded to the frame');
        return {syncMs:Math.round(syncMs),frames,cloneMs:Math.round(timing.cloneMs),validateMs:Math.round(timing.validateMs)};
      });
    });

    await test('the simulation waits, and a save asked meanwhile runs once more',async()=>{
      return page.evaluate(async()=>{
        const s=__GH_STATE__,a=__AUDIT__,v=window.__VAULT__,before=v.commits.length;a.setSpeed(4);await new Promise(r=>setTimeout(r,300));
        const sim0=s.simSeconds,first=a.saveNow();const locked=GH_PERSISTENCE.isLocked();s.qaMarker='second';let advanced=false;const watch=setInterval(()=>{if(s.simSeconds!==sim0)advanced=true;},5);const ordinary=a.save();
        const x=await first;clearInterval(watch);a.setSpeed(0);
        if(x!==true||ordinary!==true)throw new Error('both saves succeed');if(!locked)throw new Error('persistence is locked from the copy');if(advanced)throw new Error('the simulation advanced during the save');
        const commits=v.commits.slice(before);if(commits.length!==2)throw new Error(`two commits (${commits.length})`);if(commits[1].marker!=='second')throw new Error('the second holds the later state');
        return {commits:commits.length};
      });
    });

    await test('a player command asked during the save commits after it',async()=>{
      return page.evaluate(async()=>{
        const s=__GH_STATE__,a=__AUDIT__,v=window.__VAULT__,before=v.commits.length,revision=s.saveRevision;
        const saving=a.saveNow(),command=a.runDurableStateCommand('qa-after-save',async({state:draft})=>{draft.qaMarker='command';return true;},{silent:true});
        const [saved,committed]=await Promise.all([saving,command]);if(saved!==true||committed!==true)throw new Error(`both commit (${saved}, ${committed})`);
        const commits=v.commits.slice(before);if(commits.length!==2||commits[1].marker!=='command'||commits[1].saveRevision!==revision+2)throw new Error(`the command commits after the save (${JSON.stringify(commits)})`);
        return {revisions:commits.map(c=>c.saveRevision)};
      });
    });

    await test('stopping the fault recorder from its panel saves once',async()=>{
      return page.evaluate(async()=>{
        const a=__AUDIT__,v=window.__VAULT__;a.openDrawer('diagnostics');
        const start=document.querySelector('[data-gh-action="diagnostics-recorder-start"]');if(!start)throw new Error('the start button');start.click();await new Promise(r=>setTimeout(r,800));
        const before=v.commits.length,stop=document.querySelector('[data-gh-action="diagnostics-recorder-stop"]');if(!stop)throw new Error('the stop button');stop.click();
        for(let i=0;i<200&&v.commits.length===before;i++)await new Promise(r=>setTimeout(r,25));await new Promise(r=>setTimeout(r,800));
        if(v.commits.length-before!==1)throw new Error(`one save (${v.commits.length-before})`);return {saves:v.commits.length-before};
      });
    });
    if(errors.length)results.push({name:'no page errors',ok:false,error:errors.slice(0,5).join(' | ')});
  }finally{await browser.close();}
  const passed=results.filter(row=>row.ok).length;console.log(JSON.stringify({suite:'build359-sliced-save-browser',passed,total:results.length,results},null,1));
  if(passed!==results.length)process.exitCode=1;else console.log('BUILD359_SLICED_SAVE_BROWSER_PASS');
})();

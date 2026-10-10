'use strict';
// Build 371 regression (full app): a calendar request cancelled in the same task as a committed 12-hour boundary (its
// maintenance round queued, no part run yet). Before Build 371 the cancel was published at once and the round's ledger
// compaction then moved journal entries into the audit digest after the player saw the request cancelled
// (tests/build334-calendar-journey-browser.cjs failed intermittently on exactly that). Now:
// - no simulated time and no slice after the click;
// - the cancel is published only after the round drained, and nothing writes the books after it is published;
// - the compaction it ran conserved the books (live rows + audit digest: same count and total; no new sequence numbers);
// - a compaction that fails while the cancel settles rolls back whole, and the cancel still publishes;
// - the published state is what a reload restores;
// - a cancel with no maintenance queued is still published in the same task.
const assert=require('node:assert/strict');
const {chromium}=require('playwright'),{boot,reboot}=require('./helpers/local-dom-app');

const SNAPSHOT=()=>{const s=__GH_STATE__;return JSON.stringify({time:s.simSeconds,finance:s.finance,books:s.companyFinance,bank:s.bank,energy:s.energy,proofs:s.documentProofs,lastCompactDay:s.simulationKernel?.lastCompactDay,lastFinancialDay:s.lastFinancialDay,lastMarketHour:s.lastMarketHour});};
// Every compactable history as (live rows + its digest): count, amount total and highest sequence number.
const CONSERVATION=()=>{const s=__GH_STATE__,digests=s.finance?.auditArchive?.digests||[],records=s.finance?.auditArchive?.records||{},seq=row=>{let max=0;for(const v of [row?.id,row?.reference,row?.sourceRef,row?.documentNumber]){const m=String(v||'').match(/(\d+)(?!.*\d)/);if(m)max=Math.max(max,Number(m[1]));}return max;};
  const histories={journalEntries:s.finance?.journalEntries||[]};for(const [type,book] of Object.entries(s.companyFinance||{}))if(Array.isArray(book?.ledger))histories[`companyLedger-${type}`]=book.ledger;
  const out={};for(const [kind,rows] of Object.entries(histories)){const digest=digests.find(d=>d?.kind===kind)||{},archived=Array.isArray(records[kind])?records[kind]:[];
    out[kind]={count:rows.length+archived.length+(Number(digest.count)||0),total:Math.round((rows.reduce((a,r)=>a+Math.max(0,Number(r?.total??r?.amount)||0),0)+archived.reduce((a,r)=>a+Math.max(0,Number(r?.total??r?.amount)||0),0)+(Number(digest.total)||0))*100)/100,maxSequence:Math.max(Number(digest.maxSequence)||0,...rows.map(seq),...archived.map(seq),0)};}
  return {histories:out,journalSequence:s.finance?.journalSequence,paymentSequence:s.finance?.paymentSequence};};

async function settleDays(page,days){for(let day=0;day<days;day++){const t=await page.evaluate(()=>{document.querySelector('#simNextDay').click();return __GH_STATE__.simSeconds;});await page.waitForFunction(t=>__GH_STATE__.simSeconds>t&&!GH_SIM_KERNEL.snapshot().manualAdvance,t,{timeout:120000});}}
// Arms a cancel in the task that commits the next maintenance boundary of a day not yet compacted.
async function armBoundaryCancel(page,{failCompaction=false}={}){
  await page.evaluate(({SNAPSHOT,CONSERVATION,failCompaction})=>{
    const snapshot=eval(SNAPSHOT),conservation=eval(CONSERVATION);window.qaSnapshot=snapshot;window.qaConservation=conservation;
    const plane=window.__qaPlane||(window.__qaPlane=window.GH_CONTROL_PLANE);window.qaRace={armed:true,failCompaction,compactionFailures:0};
    window.GH_CONTROL_PLANE={...plane,appendEvent(state,event){const out=plane.appendEvent(state,event);
      if(event?.type==='SIMULATION_MAINTENANCE'&&qaRace.armed&&Math.floor(__GH_STATE__.simSeconds/86400)!==__GH_STATE__.simulationKernel?.lastCompactDay){
        qaRace.armed=false;
        queueMicrotask(()=>{
          const before=GH_APP_RUNTIME_METRICS.snapshot().maintenance;qaRace.pendingBefore=[...before.pending];
          if(qaRace.failCompaction){const tx=window.__qaTx||(window.__qaTx=window.GH_TRANSACTION_CORE);window.GH_TRANSACTION_CORE={...tx,execute(s,options){if(options?.label==='simulation-history-compaction'&&qaRace.failCompaction){qaRace.failCompaction=false;qaRace.compactionFailures++;return tx.execute(s,{...options,apply(...args){options.apply(...args);throw new Error('qa-compaction-failure');}});}return tx.execute(s,options);},join:tx.join.bind(tx)};}
          document.querySelector('#simNextDay').click();
          const k=GH_SIM_KERNEL.snapshot();qaRace.atClick={time:__GH_STATE__.simSeconds,manualAdvance:k.manualAdvance,jobActive:k.jobActive,slices:k.slices,snapshot:snapshot(),conservation:conservation(),runs:GH_APP_RUNTIME_METRICS.snapshot().maintenance.runs,button:document.querySelector('#simNextDay').textContent};
          // The first frame that sees the cancel published records the state then; later frames must not change it.
          const watch=()=>{const k2=GH_SIM_KERNEL.snapshot();if(k2.manualAdvance){qaRace.settlingFrames=(qaRace.settlingFrames||0)+1;requestAnimationFrame(watch);return;}
            qaRace.atPublish={time:__GH_STATE__.simSeconds,slices:k2.slices,snapshot:snapshot(),conservation:conservation(),runs:GH_APP_RUNTIME_METRICS.snapshot().maintenance.runs,pending:[...GH_APP_RUNTIME_METRICS.snapshot().maintenance.pending],speed:__GH_STATE__.speed};};
          requestAnimationFrame(watch);
        });
      }
      return out;}};
  },{SNAPSHOT:`(${SNAPSHOT})`,CONSERVATION:`(${CONSERVATION})`,failCompaction});
  await page.evaluate(()=>document.querySelector('[data-calendar-advance="year"]').click());
  await page.waitForFunction(()=>!!window.qaRace.atPublish,null,{timeout:120000});
  // Observation window: the engine keeps running frames; nothing may write after the publish.
  const runsAtPublish=await page.evaluate(()=>qaRace.atPublish.runs);
  await page.waitForFunction(({runs})=>{const k=GH_SIM_KERNEL.snapshot();window.qaFramesAfter=(window.qaFramesAfter||0)+1;return k.runtime.ticks>=0&&window.qaFramesAfter>=60;},{runs:runsAtPublish},{timeout:60000,polling:'raf'});
  await page.evaluate(()=>{window.qaFramesAfter=0;});
  return page.evaluate(()=>({race:{...qaRace,atClick:{...qaRace.atClick,snapshot:undefined},atPublish:{...qaRace.atPublish,snapshot:undefined}},
    sameAtPublish:qaRace.atPublish.snapshot===qaSnapshot(),changedAfterPublish:Object.keys(JSON.parse(qaRace.atPublish.snapshot)).filter(k=>JSON.stringify(JSON.parse(qaRace.atPublish.snapshot)[k])!==JSON.stringify(JSON.parse(qaSnapshot())[k])),
    changedBySettling:Object.keys(JSON.parse(qaRace.atClick.snapshot)).filter(k=>JSON.stringify(JSON.parse(qaRace.atClick.snapshot)[k])!==JSON.stringify(JSON.parse(qaRace.atPublish.snapshot)[k])),
    runsNow:GH_APP_RUNTIME_METRICS.snapshot().maintenance.runs,timeNow:__GH_STATE__.simSeconds,lastCompactDay:__GH_STATE__.simulationKernel?.lastCompactDay,day:Math.floor(__GH_STATE__.simSeconds/86400),
    failures:(__GH_STATE__.diagnostics?.events||[]).filter(e=>e?.code==='SIM_MAINTENANCE_FAILED'||e?.id==='SIM_MAINTENANCE_FAILED').length}));
}
function checkSettledCancel(out,label){
  const {race}=out;
  assert(race.pendingBefore.length>0&&race.pendingBefore[0]==='compact',`${label}: the cancel lands with the boundary's round queued: ${JSON.stringify(race.pendingBefore)}`);
  assert(race.atClick.manualAdvance&&race.atClick.manualAdvance.cancelling===true,`${label}: the request stays visible (cancelling) while its maintenance settles`);
  assert.equal(race.atClick.jobActive,false,`${label}: the slice in flight is cancelled at once`);
  assert.equal(race.atClick.button,'جارٍ الإيقاف',`${label}: the control says the cancel is settling`);
  assert(race.settlingFrames>=1,`${label}: the round drains over frames`);
  assert.equal(race.atPublish.time,race.atClick.time,`${label}: no simulated time after the click`);assert.equal(out.timeNow,race.atClick.time);
  assert.equal(race.atPublish.slices,race.atClick.slices,`${label}: no slice after the click`);
  assert.deepEqual(race.atPublish.pending,[],`${label}: published with no maintenance pending`);
  assert.equal(race.atPublish.speed,0,`${label}: paused`);
  assert.equal(out.runsNow,race.atPublish.runs,`${label}: no maintenance part after the publish`);
  assert.equal(out.sameAtPublish,true,`${label}: state changed after the publish: ${JSON.stringify(out.changedAfterPublish)}`);
  assert.deepEqual(race.atPublish.conservation.histories,race.atClick.conservation.histories,`${label}: compaction conserves every history (count, total, sequence)`);
  assert.equal(race.atPublish.conservation.journalSequence,race.atClick.conservation.journalSequence,`${label}: no journal entry posted after the click`);
  assert.equal(race.atPublish.conservation.paymentSequence,race.atClick.conservation.paymentSequence,`${label}: no payment after the click`);
}

(async()=>{
  const browser=await chromium.launch({headless:true}),errors=[],results=[];
  try{
    let {page}=await boot({browser,errors});
    await settleDays(page,4);

    // 1. Cancel in the boundary task: the compaction runs before the publish, never after.
    const first=await armBoundaryCancel(page);checkSettledCancel(first,'boundary cancel');
    assert(first.changedBySettling.includes('finance'),'the round compacted the journal while the cancel settled');
    assert.equal(first.lastCompactDay,first.day,'the boundary day is compacted before the publish');
    results.push({name:'boundary cancel settles before publish',settlingFrames:first.race.settlingFrames,changedBySettling:first.changedBySettling});

    // 2. Repeated: a second request, cancelled the same way on a later boundary.
    await settleDays(page,1);
    const second=await armBoundaryCancel(page);checkSettledCancel(second,'repeated boundary cancel');
    results.push({name:'repeated boundary cancel',settlingFrames:second.race.settlingFrames});

    // 3. Rollback: the compaction fails while the cancel settles. Its transaction rolls back whole (the books equal the
    // click), the failure is recorded, the round continues and the cancel still publishes.
    await settleDays(page,1);
    const failed=await armBoundaryCancel(page,{failCompaction:true});
    assert.equal(failed.race.compactionFailures,1,'the injected compaction failure ran');
    assert.equal(failed.race.atClick.time,failed.race.atPublish.time);assert.equal(failed.runsNow,failed.race.atPublish.runs);assert.equal(failed.sameAtPublish,true,`rollback: state changed after the publish: ${JSON.stringify(failed.changedAfterPublish)}`);
    assert(!failed.changedBySettling.includes('finance')&&!failed.changedBySettling.includes('books'),`a failed compaction leaves the books exactly as at the click: ${JSON.stringify(failed.changedBySettling)}`);
    assert.deepEqual(failed.race.atPublish.conservation,failed.race.atClick.conservation);
    await page.evaluate(()=>{if(window.__qaTx)window.GH_TRANSACTION_CORE=window.__qaTx;});
    results.push({name:'compaction failure while settling rolls back whole',changedBySettling:failed.changedBySettling});

    // 4. Recovery: the published state is what a reload restores.
    const saved=await page.evaluate(({SNAPSHOT})=>{__AUDIT__.saveNow?.();return eval(SNAPSHOT)();},{SNAPSHOT:`(${SNAPSHOT})`});
    await page.evaluate(()=>GH_PERSISTENCE.drain?.());
    ({page}=await reboot(page,{browser,errors}));
    const restored=await page.evaluate(({SNAPSHOT})=>eval(SNAPSHOT)(),{SNAPSHOT:`(${SNAPSHOT})`});
    assert.deepEqual(JSON.parse(restored),JSON.parse(saved),'reload restores the published state');
    results.push({name:'published state survives reload'});

    // 5. A cancel with nothing queued is still published in the same task.
    await page.evaluate(()=>document.querySelector('[data-calendar-advance="year"]').click());
    const immediate=await page.evaluate(async()=>{for(let i=0;i<600;i++){await new Promise(r=>requestAnimationFrame(r));const k=GH_SIM_KERNEL.snapshot();if(k.manualAdvance&&k.slices>0&&!GH_APP_RUNTIME_METRICS.snapshot().maintenance.pending.length&&!k.manualAdvance.cancelling){document.querySelector('#simNextDay').click();return {manualAdvance:GH_SIM_KERNEL.snapshot().manualAdvance,button:document.querySelector('#simNextDay').textContent};}}return null;});
    assert(immediate,'found a cancel point with no maintenance queued');assert.equal(immediate.manualAdvance,null,'published in the same task');assert.equal(immediate.button,'+ يوم');
    results.push({name:'cancel without queued maintenance publishes at once'});

    assert.deepEqual(errors,[]);
    console.log(JSON.stringify({suite:'build371-calendar-cancel-maintenance-browser',results},null,2));
    console.log('BUILD371_CALENDAR_CANCEL_MAINTENANCE_PASS');
  }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});

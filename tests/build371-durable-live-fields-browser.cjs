'use strict';
// Build 371: fields the page writes on the live state while a durable command runs. The command publishes its draft
// with replaceLiveState, which used to erase them: the player's speed, map mode and open panel reverted, and a
// protective stop (speed 0 from a native process recovery) was undone, the simulation resuming after the commit.
// With the sea dispatch paused between its assignment and its departures:
// 1. the player changes speed, map mode and panel; the command commits; speed and map mode stay, live and in the save
//    (the dispatch itself reopens its routes panel after the commit);
// 2. (a new game) a native process recovery stops the simulation; the command commits; the stop stays;
// 3. (a new game) the same with an interrupted command: rolled back, the stop stays.
// In 2 and 3 the recovery's alert and save wait for the command (written at once they were refused: an uncaught
// 'Durable state command is in progress' and no alert), and no page error occurs.
const assert=require('node:assert/strict');
const {chromium}=require('playwright'),{boot,reboot}=require('./helpers/local-dom-app');

async function setup(page){
  await page.evaluate(async()=>{
    const a=__AUDIT__,s=()=>__GH_STATE__,d=GH_COMPANY_PLATFORM.definitionFor(s(),'sea');
    await a.runAuthorizedDomainCommand('corporate','open-company',{type:'sea',companyId:'sea',capital:Math.max(400000000,d.founding.minimumCapital),legalName:'QA Live Sea',formationContract:'QA-LIVE-SEA'},{silent:true});
    const ports=GH_WORLD_DATA.ports.filter(r=>Number.isFinite(Number(r[3]))&&Number.isFinite(Number(r[4]))).slice(0,2);
    for(const [i,port] of ports.entries())await a.runAuthorizedDomainCommand('facilities','create',{facility:{id:`QA-sea-PORT-${i}`,name:`QA Port ${port[0]}`,kind:'port-base',company:'sea',ownerCompanyId:'sea',owned:true,sourceKey:`port:${port[0]}:${port[3]}:${port[4]}`,code:String(port[0]).slice(0,5),city:String(port[1]||port[0]),country:String(port[2]||'—'),coords:[port[3],port[4]]},bucket:'globalBases'},{silent:true});
    const ship=[...GH_ASSET_CATALOG.sea.used].sort((x,y)=>(x.leaseMonthly||0)-(y.leaseMonthly||0)||x.price-y.price)[0];
    for(let i=0;i<2;i++)await a.buyAsset('sea','used',ship.id,'lease',6,`QA-sea-PORT-${i}`,true,`QA-LIVE-SEA-${i}`,'sea');
    await GH_PERSISTENCE.drain();
  });
}
// Pauses the next sea dispatch at its first frame yield that sees the idle ships of one port routed and none departed.
async function pausedDispatch(page,{interrupt=false}={}){
  await page.evaluate(({interrupt})=>{const original=window.__qaTimeout||(window.__qaTimeout=window.setTimeout);window.qaPause={armed:true,held:null};
    window.setTimeout=function(fn,ms,...rest){if(qaPause.armed&&!ms&&window.__GH_DURABLE_COMMAND_CONTEXT__&&String(fn).includes('[native code]')){const ships=GH_FLEET_DATA.filter(__GH_STATE__,a=>(a.ownerCompanyId||a.companyId)==='sea'&&a.routeId&&a.phase!=='moving'&&!a.departureScheduled);if(ships.length){qaPause.armed=false;qaPause.held=()=>fn(...rest);return 0;}}return original.call(window,fn,ms,...rest);};
    const ops=window.__qaOps||(window.__qaOps=window.GH_OPERATIONS_CORE);window.GH_OPERATIONS_CORE=interrupt?{...ops,execute(ctx,cmd,payload){if(cmd==='record-alert'&&payload?.type==='dispatch')throw new Error('qa-interrupted');return ops.execute(ctx,cmd,payload);}}:ops;
    __AUDIT__.openDrawer('routes','sea');},{interrupt});
  const before=await page.evaluate(()=>GH_APP_RUNTIME_METRICS.snapshot().durable.samples.length);
  await page.locator('.dispatch-international-network[data-company="sea"]').first().click();
  await page.waitForFunction(()=>!!qaPause.held,null,{timeout:120000});
  return async()=>{
    await page.evaluate(()=>{const held=qaPause.held;qaPause.held=null;window.setTimeout=window.__qaTimeout;held();});
    await page.waitForFunction(before=>{const m=GH_APP_RUNTIME_METRICS.snapshot().durable;return m.samples.length>before&&/bulk-shared-departure:sea/.test(String(m.last?.name||''))&&!window.__GH_DURABLE_COMMAND_CONTEXT__&&!GH_PERSISTENCE.isLocked();},before,{timeout:180000});
    await page.evaluate(()=>{window.GH_OPERATIONS_CORE=window.__qaOps;return GH_PERSISTENCE.drain();});
    return page.evaluate(()=>GH_APP_RUNTIME_METRICS.snapshot().durable.last.committed);
  };
}
const FIELDS=()=>({speed:__GH_STATE__.speed,mapMode:__GH_STATE__.mapMode,lastPanel:__GH_STATE__.lastPanel,saveRevision:__GH_STATE__.saveRevision});

(async()=>{
  const browser=await chromium.launch({headless:true}),errors=[],report=[];
  try{
    // 1. The player's changes during a committed command.
    let {page}=await boot({browser,errors});page.setDefaultTimeout(120000);await setup(page);
    await page.evaluate(()=>{__AUDIT__.setSpeed(0);__AUDIT__.setMapMode('operations');});
    const start=await page.evaluate(`(${FIELDS})()`);
    let resume=await pausedDispatch(page);
    await page.evaluate(()=>{__AUDIT__.setSpeed(2);__AUDIT__.setMapMode('expansion');__AUDIT__.openDrawer('finance');});
    const during=await page.evaluate(`(${FIELDS})()`);
    assert.deepEqual({speed:during.speed,mapMode:during.mapMode,lastPanel:during.lastPanel},{speed:2,mapMode:'expansion',lastPanel:'finance'},'the player changed them during the command');
    assert.equal(await resume(),true,'the command committed');
    const after=await page.evaluate(`(${FIELDS})()`);
    assert.equal(after.saveRevision,start.saveRevision+1);
    // The panel is not compared after the commit: the dispatch reopens the routes panel itself once it committed.
    assert.deepEqual({speed:after.speed,mapMode:after.mapMode},{speed:2,mapMode:'expansion'},`the commit keeps the player's changes: ${JSON.stringify(after)}`);
    await page.evaluate(()=>__AUDIT__.setSpeed(0));
    const saved=await page.evaluate(async FIELDS=>{const read=eval(FIELDS);const ok=await __AUDIT__.saveNow();if(ok!==true)throw new Error(`save-rejected:${ok}`);await GH_PERSISTENCE.drain();return read();},`(${FIELDS})`);
    ({page}=await reboot(page,{browser,errors}));
    const restored=await page.evaluate(`(${FIELDS})()`);assert.equal(restored.mapMode,saved.mapMode,'the save holds the map mode chosen during the command');
    report.push({name:'player changes during a committed command are kept',after});

    // 2. A protective stop during a committed command (a new game).
    await page.close();({page}=await boot({browser,errors}));page.setDefaultTimeout(120000);await setup(page);
    await page.evaluate(()=>__AUDIT__.setSpeed(2));
    resume=await pausedDispatch(page);
    await page.evaluate(()=>window.dispatchEvent(new Event('gh-native-recovery')));
    assert.equal(await page.evaluate(()=>__GH_STATE__.speed),0,'the recovery stops the simulation');
    assert.equal(await resume(),true,'the command committed');
    assert.equal(await page.evaluate(()=>__GH_STATE__.speed),0,'the commit does not undo the stop');
    await page.waitForFunction(()=>(__GH_STATE__.alerts||[]).some(row=>/استرداد آخر حفظ Native/.test(String(row.text||row))),null,{timeout:30000});
    report.push({name:'a protective stop during a committed command stays'});

    // 3. The same during an interrupted command (a new game).
    await page.close();({page}=await boot({browser,errors}));page.setDefaultTimeout(120000);await setup(page);
    await page.evaluate(()=>__AUDIT__.setSpeed(2));
    resume=await pausedDispatch(page,{interrupt:true});
    await page.evaluate(()=>window.dispatchEvent(new Event('gh-native-recovery')));
    assert.equal(await resume(),false,'the command rolled back');
    assert.equal(await page.evaluate(()=>__GH_STATE__.speed),0,'the rollback does not undo the stop');
    await page.waitForFunction(()=>(__GH_STATE__.alerts||[]).some(row=>/استرداد آخر حفظ Native/.test(String(row.text||row))),null,{timeout:30000});
    report.push({name:'a protective stop during a rolled-back command stays'});

    assert.deepEqual(errors,[]);
    console.log(JSON.stringify({suite:'build371-durable-live-fields-browser',report},null,2));
    console.log('BUILD371_DURABLE_LIVE_FIELDS_PASS');
  }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});

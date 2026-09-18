'use strict';
const assert=require('assert'),fs=require('fs');
const {chromium,webkit}=require('playwright'),{serve}=require('./helpers/web-server'),{installMapFixture,expectedNetworkError}=require('./helpers/browser-network');

(async()=>{
  const engine=process.env.GH_BROWSER||'chromium';
  const browser=await(engine==='webkit'?webkit:chromium).launch({headless:true});
  const server=await serve();
  const nativeVault={json:null,generation:0,commits:0};
  const evidence={engine,quantity:1000,expectedSharedRoutes:16};

  const createContext=async nativeJSON=>{
    const context=await browser.newContext({viewport:{width:844,height:390},locale:'ar-SA'});
    await context.exposeBinding('__ghNativeCommit',async(_source,envelope)=>{
      if(!envelope||!['commitSave','resetGameSave'].includes(envelope.action))throw new Error('unsupported-native-save-action');
      const parsed=JSON.parse(envelope.saveJSON);
      assert.strictEqual(parsed.saveVersion,'2.0.0');
      nativeVault.json=envelope.saveJSON;
      nativeVault.generation++;
      nativeVault.commits++;
      return {
        action:envelope.action,requestId:envelope.requestId,saveHash:envelope.saveHash,
        saveRevision:envelope.saveRevision,resetEpoch:envelope.resetEpoch,
        saveSchemaVersion:envelope.saveSchemaVersion,generation:nativeVault.generation,success:true,message:''
      };
    });
    await context.addInitScript(({nativeJSON,generation})=>{
      window.__GH_PRELOAD_LOCAL_EMPTY__=localStorage.length===0;
      window.GH_NATIVE_BUILD=314;
      if(nativeJSON){
        const parsed=JSON.parse(nativeJSON);
        window.__GH_NATIVE_SAVE_JSON__=nativeJSON;
        window.__GH_NATIVE_SAVE_META__=Object.freeze({
          source:'native-save-vault',generation,
          saveRevision:Number(parsed.saveRevision)||0,resetEpoch:Number(parsed.resetEpoch)||0,
          simSeconds:Number(parsed.simSeconds)||0,forced:false,paused:false
        });
      }
      window.__GH_NATIVE_SLOT_META__=[];
      const commit=envelope=>{
        Promise.resolve(window.__ghNativeCommit(envelope)).then(detail=>{
          const name=envelope.action==='resetGameSave'?'gh-native-reset-ack':'gh-native-save-ack';
          window.dispatchEvent(new CustomEvent(name,{detail}));
        }).catch(error=>console.error('native-test-bridge',error));
      };
      window.webkit={messageHandlers:{
        saveBridge:{postMessage:commit},
        updateBridge:{postMessage:envelope=>{if(envelope?.action==='resetGameSave')commit(envelope);}}
      }};
    },{nativeJSON:nativeJSON||null,generation:nativeVault.generation});
    return context;
  };

  const installRoadFixture=async page=>{
    await installMapFixture(page);
    let calls=0;
    await page.route('https://router.project-osrm.org/**',async request=>{
      calls++;
      const u=new URL(request.request().url()),raw=u.pathname.split('/').pop()||'';
      const coords=raw.split(';').map(p=>p.split(',').map(Number)).filter(p=>p.length===2&&p.every(Number.isFinite));
      const km=(a,b)=>{const rad=Math.PI/180,h=Math.sin((b[1]-a[1])*rad/2)**2+Math.cos(a[1]*rad)*Math.cos(b[1]*rad)*Math.sin((b[0]-a[0])*rad/2)**2;return 12742*Math.asin(Math.min(1,Math.sqrt(h)));};
      const legs=coords.slice(1).map((point,i)=>{const distance=km(coords[i],point);return{distance:distance*1200,duration:distance*70,steps:[{geometry:{type:'LineString',coordinates:[coords[i],point]}}]};});
      await request.fulfill({json:{code:'Ok',routes:[{distance:legs.reduce((n,l)=>n+l.distance,0),duration:legs.reduce((n,l)=>n+l.duration,0),geometry:{type:'LineString',coordinates:coords},legs}]}}).catch(()=>{});
    });
    return ()=>calls;
  };

  const logicalSnapshot=s=>({
    assets:s.assets.map(a=>({id:a.id,type:a.type,catalogId:a.catalogId,baseFacility:a.baseFacility,routeId:a.routeId,routeSlot:a.routeSlot,phase:a.phase,departureScheduled:!!a.departureScheduled,deliveryStatus:a.deliveryStatus,staffing:a.staffing})),
    routes:s.customRoutes,
    roadBalances:(s.companyFinance?.road?.accounts||[]).map(a=>({id:a.id,balance:a.balance})),
    crew:s.crew,
    facility:(s.customHubs||[]).filter(f=>f.company==='road').map(f=>({id:f.id,deliveryCapacity:f.deliveryCapacity,kind:f.kind,company:f.company})),
    deliveries:(s.realism?.procurement?.deliveries||[]).filter(d=>d.type==='road').map(d=>({id:d.id,status:d.status,baseId:d.baseId,assetId:d.asset?.id,requestRef:d.requestRef}))
  });

  let context,page,errors=[],roadCalls;
  try{
    context=await createContext(null);
    page=await context.newPage();
    await installMapFixture(page);
    roadCalls=await installRoadFixture(page);
    page.on('pageerror',e=>errors.push(e.message));
    page.on('console',m=>{if(m.type()==='error'&&!expectedNetworkError(m)&&!m.location().url.includes('router.project-osrm.org'))errors.push(m.text());});
    page.on('dialog',d=>d.accept());

    const state=()=>page.evaluate(()=>JSON.parse(JSON.stringify(__GH_STATE__)));
    const close=async()=>{if(await page.locator('#drawer').getAttribute('aria-hidden')==='false')await page.click('#drawerClose');};
    const panel=async name=>{await close();const rows=page.locator(`[data-panel="${name}"]`);for(let i=0;i<await rows.count();i++)if(await rows.nth(i).isVisible()){await rows.nth(i).click();return;}throw Error('panel '+name);};
    const control=async name=>{await panel('control');await page.locator(`[data-open="${name}"]`).first().click();};

    await page.goto(server.baseURL,{waitUntil:'domcontentloaded'});
    assert.strictEqual(await page.evaluate(()=>window.__GH_PRELOAD_LOCAL_EMPTY__),true,'first context must begin without browser persistence');
    await page.selectOption('#founderMode','sandbox');
    await page.click('#founderReview');
    await page.locator('#founderForm button[type="submit"]').click();
    await page.waitForFunction(()=>__GH_STATE__.onboardingComplete);

    await panel('companies');await page.click('[data-companytab="subs"]');await page.click('button.open-company[data-type="road"]');
    await panel('finance');
    await page.selectOption('#companyTransferFrom','group');
    await page.selectOption('#companyTransferTo','road');
    await page.fill('#companyTransferAmount','400000000');
    await page.click('.company-transfer-submit');
    let current=await state();
    assert(current.openedCompanies.includes('road'),'road company must be opened through UI');
    assert(current.companyFinance.road.accounts[0].balance>=400000000,'road company must receive working capital through Finance UI');

    await close();await page.click('#worldDirectoryBtn');await page.locator('[data-world-company="road"]').click();await page.fill('#worldSearch','RUH');
    await page.locator('.open-directory-site[data-key="site:road:RUH"]').click();
    current=await state();
    const facility=current.customHubs.find(f=>f.company==='road'&&f.kind==='logistics');
    assert(facility,'Riyadh logistics facility must be created through UI');

    await page.locator('.world-result[data-key="site:road:RUH"] [data-open="facilityManage"]').click();
    const expansionCapacities=[];
    for(let i=0;i<9;i++){
      await page.locator('[data-facility-tab="operations"]').click();
      const before=await page.evaluate(id=>GH_FACILITY_CORE.assetCapacity([...__GH_STATE__.globalBases,...__GH_STATE__.customHubs].find(f=>f.id===id)),facility.id);
      await page.locator('[data-gh-action="facility-expand"]').click();
      await page.waitForFunction(({id,before})=>GH_FACILITY_CORE.assetCapacity([...__GH_STATE__.globalBases,...__GH_STATE__.customHubs].find(f=>f.id===id))>before,{id:facility.id,before},{timeout:10000});
      expansionCapacities.push(await page.evaluate(id=>GH_FACILITY_CORE.assetCapacity([...__GH_STATE__.globalBases,...__GH_STATE__.customHubs].find(f=>f.id===id)),facility.id));
    }
    assert(expansionCapacities.every((value,index)=>index===0||value>expansionCapacities[index-1]),'every UI expansion must increase authoritative delivery capacity');
    assert(expansionCapacities.at(-1)>=1000,'facility expansion must provide room for all 1000 assets');
    evidence.expansionCapacities=expansionCapacities;

    await control('assetMarket');await page.click('[data-markettype="road"]');
    const card=page.locator('.manual-buy-asset[data-type="road"][data-id="N-T1"]').locator('xpath=ancestor::article[contains(@class,"asset-market-card")]');
    await card.locator('.manual-asset-base').selectOption(facility.id);
    await card.locator('.manual-asset-qty').fill('1000');
    await card.locator('.manual-asset-mode').selectOption('cash');
    const roadCashBeforePurchase=await page.evaluate(()=>GH_FINANCE_CORE.operating(__GH_STATE__,'road'));
    const purchaseStart=Date.now();
    await card.locator('.manual-buy-asset').click();
    await page.waitForFunction(()=>__GH_STATE__.assets.filter(a=>a.type==='road').length===1000,null,{timeout:120000});
    evidence.purchaseMs=Date.now()-purchaseStart;
    current=await state();
    const roadAssets=current.assets.filter(a=>a.type==='road');
    const roadDeliveries=current.realism.procurement.deliveries.filter(d=>d.type==='road');
    const roadCashAfterPurchase=current.companyFinance.road.accounts[0].balance;
    assert.strictEqual(roadAssets.length,1000);
    assert.strictEqual(new Set(roadAssets.map(a=>a.id)).size,1000,'1000-asset purchase must not duplicate asset IDs');
    assert.strictEqual(roadDeliveries.length,1000);
    assert.strictEqual(new Set(roadDeliveries.map(d=>d.id)).size,1000,'1000-asset purchase must not duplicate delivery IDs');
    assert(roadDeliveries.every(d=>d.status==='delivered'&&d.baseId===facility.id),'all 1000 delivery contracts must finish at the expanded facility');
    assert(roadAssets.every(a=>a.deliveryStatus==='delivered'&&a.baseFacility===facility.id),'all purchased assets must be delivered to the selected facility');
    assert(roadAssets.every(a=>a.staffing?.mode==='automatic-fixed'&&a.staffing.ready===true&&a.staffing.total===3),'every truck must have its complete fixed crew');
    assert.strictEqual(roadAssets.reduce((n,a)=>n+Number(a.staffing?.total||0),0),3000,'1000 trucks must produce exactly 3000 fixed crew positions');
    assert.strictEqual(roadCashBeforePurchase-roadCashAfterPurchase,168000000,'purchase must debit exactly 1000 × N-T1 price and no more');

    await control('routes');await page.click('[data-routetype="road"]');
    const routeStart=Date.now();
    await page.click('.dispatch-existing-network');
    await page.waitForFunction(()=>!document.querySelector('.cancel-road-plan'),null,{timeout:240000});
    evidence.routePlanMs=Date.now()-routeStart;
    current=await state();
    const routed=current.assets.filter(a=>a.type==='road'),roadRoutes=current.customRoutes.filter(r=>r.type==='road');
    assert.strictEqual(roadRoutes.length,16,'1000 trucks at route capacity 64 must use exactly 16 shared routes');
    assert.strictEqual(new Set(routed.map(a=>a.routeId)).size,16,'every truck must be assigned into the 16-route shared network');
    assert(routed.every(a=>a.routeId),'no road asset may be left without a route');
    assert.strictEqual(routed.filter(a=>a.phase==='moving').length,16,'one truck per shared route should depart immediately');
    assert.strictEqual(routed.filter(a=>a.phase==='turnaround'&&a.departureScheduled).length,984,'remaining trucks must be scheduled on their shared routes');
    for(const route of roadRoutes){
      const users=routed.filter(a=>a.routeId===route.id);
      assert(users.length>0&&users.length<=64,'shared road route capacity must never exceed 64');
      assert.strictEqual(new Set(users.map(a=>a.routeSlot)).size,users.length,'route slots must be unique inside each shared route');
    }
    assert.strictEqual(roadCalls(),1,'1000-asset road planning should use one deterministic provider request, not N requests');

    const preSave=await state();
    const inspected=await page.evaluate(()=>GH_PERSISTENCE.inspectNativeJSON(JSON.stringify(__GH_STATE__)));
    evidence.nativeSaveUtf8Bytes=inspected.utf8Bytes;
    evidence.nativeSaveWarning=inspected.warning;
    evidence.heapBytes=await page.evaluate(()=>Number(performance.memory?.usedJSHeapSize)||null);
    const durable=await page.evaluate(()=>GH_PERSISTENCE.commitDurableState(__GH_STATE__,{storageKey:'global-holdings-world-v2.0.0',appVersion:'3.0.0',timeoutMs:30000}));
    assert(durable.ok&&durable.ack?.native===true,'final stress state must receive a Native durability ACK');
    await page.evaluate(()=>GH_PERSISTENCE.drain());
    assert(nativeVault.json,'native bridge must hold the final full save');
    const nativeParsed=JSON.parse(nativeVault.json);
    assert.strictEqual(nativeParsed.assets.filter(a=>a.type==='road').length,1000,'native save must contain all 1000 assets');
    assert.strictEqual(nativeParsed.customRoutes.filter(r=>r.type==='road').length,16,'native save must contain all 16 routes');
    const beforeRelaunch=logicalSnapshot(preSave);
    const committedSnapshot=logicalSnapshot(nativeParsed);
    assert.deepStrictEqual(committedSnapshot,beforeRelaunch,'Native acknowledged payload must exactly match the logical pre-relaunch state');

    await context.close();context=null;
    errors=[];
    context=await createContext(nativeVault.json);
    page=await context.newPage();
    await installMapFixture(page);
    page.on('pageerror',e=>errors.push(e.message));
    page.on('console',m=>{if(m.type()==='error'&&!expectedNetworkError(m)&&!m.location().url.includes('router.project-osrm.org'))errors.push(m.text());});
    page.on('dialog',d=>d.accept());
    await page.goto(server.baseURL,{waitUntil:'domcontentloaded'});
    assert.strictEqual(await page.evaluate(()=>window.__GH_PRELOAD_LOCAL_EMPTY__),true,'simulated Native relaunch must start with an empty browser cache');
    await page.waitForFunction(()=>window.__GH_STATE__?.assets?.filter(a=>a.type==='road').length===1000,null,{timeout:60000});
    const restored=await page.evaluate(()=>JSON.parse(JSON.stringify(__GH_STATE__)));
    assert.deepStrictEqual(logicalSnapshot(restored),beforeRelaunch,'simulated Native relaunch must restore assets, balances, routes, crew, facility capacity and deliveries exactly');
    assert.strictEqual(new Set(restored.assets.filter(a=>a.type==='road').map(a=>a.id)).size,1000);
    assert.strictEqual(restored.customRoutes.filter(r=>r.type==='road').length,16);
    assert.strictEqual(restored.assets.filter(a=>a.type==='road').reduce((n,a)=>n+Number(a.staffing?.total||0),0),3000);
    assert.deepStrictEqual(errors,[]);

    evidence.nativeCommits=nativeVault.commits;
    evidence.relaunch='PASS';
    fs.mkdirSync('tests/screenshots',{recursive:true});
    await page.screenshot({path:`tests/screenshots/build315-stress1000-${engine}.png`});
    fs.mkdirSync('.ci-output/ci',{recursive:true});
    fs.writeFileSync(`.ci-output/ci/build315-stress1000-${engine}.json`,JSON.stringify(evidence,null,2));
    console.log(`BUILD315 stress1000 ${engine}: PASS (1000 assets, 16 shared routes, 3000 fixed crew, Native save/relaunch exact; purchase ${evidence.purchaseMs}ms, routing ${evidence.routePlanMs}ms, save ${evidence.nativeSaveUtf8Bytes} bytes)`);
  }finally{
    if(context)await context.close().catch(()=>{});
    await browser.close();
    await server.close();
  }
})().catch(error=>{console.error(error);process.exitCode=1;});

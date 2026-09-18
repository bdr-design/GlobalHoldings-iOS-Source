'use strict';
const assert=require('assert'),fs=require('fs');
const {chromium,webkit}=require('playwright'),{serve}=require('./helpers/web-server'),{installMapFixture,expectedNetworkError}=require('./helpers/browser-network');

(async()=>{
  const engineName=process.env.GH_BROWSER||'chromium',engine=engineName==='webkit'?webkit:chromium;
  const browser=await engine.launch({headless:true}),server=await serve(),page=await browser.newPage({viewport:{width:844,height:390},locale:'ar-SA'}),errors=[],evidence={engine:engineName};
  await installMapFixture(page);
  page.on('pageerror',e=>errors.push(e.message));
  page.on('console',m=>{if(m.type()==='error'&&!expectedNetworkError(m))errors.push(m.text());});
  page.on('dialog',d=>d.accept());
  try{
    await page.goto(server.baseURL,{waitUntil:'domcontentloaded'});

    // Install a deterministic Native save bridge after bootstrap. The first
    // durable command is intentionally held without an ACK to reproduce iOS
    // backgrounding while Native durability is still in flight.
    await page.evaluate(()=>{
      window.__GH_LIFECYCLE_ENVELOPES__=[];
      window.webkit={messageHandlers:{saveBridge:{postMessage:envelope=>window.__GH_LIFECYCLE_ENVELOPES__.push(JSON.parse(JSON.stringify(envelope)))}}};
      window.__GH_BACKGROUND_RESULT__='not-started';
    });

    await page.selectOption('#founderMode','sandbox');await page.click('#founderReview');
    await page.locator('#founderForm button[type="submit"]').click();
    await page.waitForFunction(()=>window.__GH_LIFECYCLE_ENVELOPES__.length===1);
    assert.strictEqual(await page.evaluate(()=>__GH_STATE__.onboardingComplete),false,'live state must not promote before Native durable ACK');

    // Background persistence must wait for the in-flight durable command. It
    // must not fail immediately with lifecycle-locked and must not start a
    // competing save revision.
    await page.evaluate(()=>{
      window.__GH_BACKGROUND_RESULT__='pending';
      GH_RUNTIME.persistForBackground().then(
        value=>{window.__GH_BACKGROUND_RESULT__={status:'fulfilled',value};},
        error=>{window.__GH_BACKGROUND_RESULT__={status:'rejected',message:String(error?.message||error)};}
      );
    });
    await page.waitForTimeout(200);
    assert.strictEqual(await page.evaluate(()=>window.__GH_BACKGROUND_RESULT__),'pending','background save must remain pending behind the active durable command');
    assert.strictEqual(await page.evaluate(()=>window.__GH_LIFECYCLE_ENVELOPES__.length),1,'backgrounding must not emit a competing Native save while a durable command is in flight');

    const envelope=await page.evaluate(()=>window.__GH_LIFECYCLE_ENVELOPES__[0]);
    await page.evaluate(detail=>window.dispatchEvent(new CustomEvent('gh-native-save-ack',{detail})),{
      action:envelope.action,requestId:envelope.requestId,saveRevision:envelope.saveRevision,resetEpoch:envelope.resetEpoch,
      saveHash:envelope.saveHash,saveSchemaVersion:'2.0.0',success:true,generation:1,message:''
    });

    await page.waitForFunction(()=>__GH_STATE__.onboardingComplete===true);
    await page.waitForFunction(()=>window.__GH_BACKGROUND_RESULT__!=='pending');
    const background=await page.evaluate(()=>window.__GH_BACKGROUND_RESULT__);
    assert.strictEqual(background.status,'fulfilled',background.message||'background persistence rejected after durable command settled');
    assert.strictEqual(await page.evaluate(()=>window.__GH_LIFECYCLE_ENVELOPES__.length),1,'settled durable command already owns durability; background wait must not duplicate the commit');
    assert.strictEqual(background.value.saveRevision,envelope.saveRevision);

    // A later clean background event is allowed to persist a newer revision.
    await page.evaluate(()=>{
      window.__GH_BACKGROUND_RESULT__='pending-2';
      GH_RUNTIME.persistForBackground().then(
        value=>{window.__GH_BACKGROUND_RESULT__={status:'fulfilled-2',value};},
        error=>{window.__GH_BACKGROUND_RESULT__={status:'rejected-2',message:String(error?.message||error)};}
      );
    });
    await page.waitForFunction(()=>window.__GH_LIFECYCLE_ENVELOPES__.length===2);
    const envelope2=await page.evaluate(()=>window.__GH_LIFECYCLE_ENVELOPES__[1]);
    assert(envelope2.saveRevision>envelope.saveRevision,'clean background save must advance revision monotonically');
    await page.evaluate(detail=>window.dispatchEvent(new CustomEvent('gh-native-save-ack',{detail})),{
      action:envelope2.action,requestId:envelope2.requestId,saveRevision:envelope2.saveRevision,resetEpoch:envelope2.resetEpoch,
      saveHash:envelope2.saveHash,saveSchemaVersion:'2.0.0',success:true,generation:2,message:''
    });
    await page.waitForFunction(()=>window.__GH_BACKGROUND_RESULT__?.status==='fulfilled-2');

    const saved=await page.evaluate(()=>JSON.parse(JSON.stringify(__GH_STATE__)));
    await page.reload({waitUntil:'domcontentloaded'});
    const restored=await page.evaluate(()=>JSON.parse(JSON.stringify(__GH_STATE__)));
    assert.strictEqual(restored.onboardingComplete,true);
    assert.strictEqual(restored.saveRevision,saved.saveRevision);
    assert.strictEqual(restored.profile.name,saved.profile.name);
    assert.deepStrictEqual(errors,[]);

    evidence.firstDurableRevision=envelope.saveRevision;
    evidence.backgroundRevision=envelope2.saveRevision;
    evidence.waitedForInFlightDurable=true;
    fs.mkdirSync('.ci-output/ci',{recursive:true});
    fs.writeFileSync(`.ci-output/ci/build315-device-lifecycle-${engineName}.json`,JSON.stringify(evidence,null,2));
    console.log(`BUILD315 device lifecycle ${engineName}: PASS (background waits for in-flight Native durable command; no competing revision; reload exact)`);
  }finally{await browser.close();await server.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});

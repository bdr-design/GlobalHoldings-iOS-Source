'use strict';
// Build 358: the map controls and the phone frame, after the owner's report on iPhone (932×430, touch).
// - The scope and world-infrastructure filters apply (a blanket stopPropagation on popover buttons swallowed them).
// - The operations section stays hidden until a company is open.
// - The drawn airports cover the view instead of the first rows of the file.
// - God Mode is a Settings switch again; it survives a reload and the top bar shows ∞.
// - The rail keeps the full landscape inset only on the side of the camera housing.
const {chromium}=require('playwright');
const assert=require('node:assert/strict'),path=require('node:path');
const {serve}=require('./helpers/web-server');
const {drawFounderSignature}=require('./helpers/signature-input');
(async()=>{
  const server=await serve(path.resolve(__dirname,'../WebApp')),browser=await chromium.launch({headless:true}),errors=[];
  try{
    const page=await browser.newPage({viewport:{width:932,height:430},deviceScaleFactor:1,isMobile:true,hasTouch:true,locale:'ar-SA'});page.setDefaultTimeout(15000);
    page.on('pageerror',error=>errors.push(error.message));page.on('dialog',dialog=>dialog.accept());
    await page.route(/https:\/\/(tile\.openstreetmap\.org|server\.arcgisonline\.com)\//,route=>route.abort());
    await page.goto(server.baseURL);await page.click('#founderReview');await drawFounderSignature(page);
    await page.locator('#founderForm button[type=submit]').click();await page.waitForFunction(()=>__GH_STATE__?.onboardingComplete);
    if(await page.evaluate(()=>__GH_STATE__.speed>0))await page.click('#speedToggle');

    // Frame: header 38px, rail 56px; the inset on the side without the camera shrinks to a margin.
    const frame=notch=>page.evaluate(notch=>{const root=document.documentElement;root.style.setProperty('--safe-right','59px');root.style.setProperty('--safe-left','59px');root.dataset.notch=notch;return {top:document.querySelector('.topbar').getBoundingClientRect().height,rail:document.querySelector('.side-nav').getBoundingClientRect().width};},notch);
    const both=await frame('both'),left=await frame('left');
    assert.equal(both.top,38,'the top bar is 38px');
    assert.equal(both.rail,56+59,'with the camera on the rail side the rail keeps the full inset');
    assert(left.rail<=56+6,`with the camera on the far side the rail drops the inset (${left.rail}px)`);
    await page.evaluate(()=>{const root=document.documentElement;root.style.removeProperty('--safe-right');root.style.removeProperty('--safe-left');});

    // Filters, by touch.
    await page.tap('#filterToggle');
    assert.equal(await page.evaluate(()=>[...document.querySelectorAll('#filterPopover .filter-section')].find(section=>section.querySelector('b')?.textContent.includes('التشغيل'))?.hidden),true,'no empty operations heading before a company opens');
    await page.tap('.filter-btn[data-filter="airport"]');
    await page.waitForFunction(()=>__GH_STATE__.activeFilter==='airport'&&/مطارًا في نطاق العرض/.test(document.getElementById('mapStatus').textContent));
    const spread=await page.evaluate(()=>{const map=document.getElementById('map').getBoundingClientRect(),cells=new Set();for(const marker of document.querySelectorAll('.world-infrastructure-marker')){const r=marker.getBoundingClientRect(),x=Math.floor((r.left-map.left)/map.width*4),y=Math.floor((r.top-map.top)/map.height*3);if(x>=0&&x<4&&y>=0&&y<3)cells.add(`${x}:${y}`);}return cells.size;});
    assert(spread>=8,`airports cover the view (${spread} of 12 quarters-thirds hold one)`);
    await page.tap('.filter-btn[data-filter="port"]');await page.waitForFunction(()=>__GH_STATE__.activeFilter==='port');
    await page.tap('.filter-btn[data-filter="all"]');await page.waitForFunction(()=>__GH_STATE__.activeFilter==='all');
    await page.tap('#layerMenu [data-layer="natural"]');await page.waitForFunction(()=>__GH_STATE__.mapLayer==='natural');
    assert.equal(await page.locator('#layerMenu [data-layer="natural"].active').count(),1);
    await page.tap('#filterToggle');

    // God Mode from Settings.
    await page.tap('#settingsBtn');const card=page.locator('#drawerBody [data-open="settings"]').first();if(await card.count())await card.tap();
    await page.locator('.god-mode-toggle').tap();
    await page.waitForFunction(()=>__GH_STATE__.godMoney===true&&__GH_STATE__.infiniteMoney===true);
    await page.waitForFunction(()=>document.getElementById('cashKpi').textContent==='∞');
    await page.reload();await page.waitForFunction(()=>__GH_STATE__?.onboardingComplete);
    assert.deepEqual(await page.evaluate(()=>[__GH_STATE__.godMoney,__GH_STATE__.infiniteMoney]),[true,true],'God Mode survives a reload');
    // Switching it off works (the command used to return false, read as a rejection, so it stayed on).
    await page.tap('#settingsBtn');{const again=page.locator('#drawerBody [data-open="settings"]').first();if(await again.count())await again.tap();}
    await page.locator('.god-mode-toggle').tap();
    await page.waitForFunction(()=>__GH_STATE__.godMoney===false&&__GH_STATE__.infiniteMoney===false);
    await page.waitForFunction(()=>document.getElementById('cashKpi').textContent!=='∞');
    assert.deepEqual(errors,[]);
    console.log('PASS build358-map-controls-browser: filters apply by touch, airports cover the view, God Mode switch persists and switches off, rail keeps the inset only on the camera side');
  }finally{await browser.close();await server.close?.();}
})().catch(error=>{console.error(error);process.exit(1);});

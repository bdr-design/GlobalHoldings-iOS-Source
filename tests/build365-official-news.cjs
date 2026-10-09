'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {boot}=require('./helpers/local-dom-app');

const official=(id,kind,reference,at,extra={})=>({id,kind,reference,at,title:`خبر ${id}`,official:true,sourceDomain:'finance',sourceRef:`SRC-${id}`,documentRef:`DOC-${id}`,...extra});

(async()=>{
 const {page,browser,errors}=await boot({viewport:{width:1280,height:720}});
 try{
  const events=[
    official('NEWS-C-1','contract','CONTRACT-C-1',86400*44,{title:'توقيع عقد توريد موثق',sourceDomain:'contracts',company:'power'}),
    official('NEWS-P-1','payment','PAY-P-1',86400*43,{title:'تسوية فاتورة شهرية',sourceDomain:'finance'}),
    official('NEWS-S-1','sponsorship','SPON-ACCEPT-S-1',86400*42,{title:'اعتماد عقد رعاية',sourceDomain:'business-world'}),
    {id:'LEGACY-C-1',kind:'contract',reference:'CONTRACT-OLD-1',at:86400*40,title:'عقد قديم موثق'},
    official('NEWS-DUP','contract','CONTRACT-C-1',86400*41,{title:'نسخة مكررة'}),
    official('NEWS-BID','bid','BID-1',86400*39,{title:'عرض غير معتمد'}),
    official('NEWS-REJECT','sponsorship','SPON-REJECT-SP-1',86400*38,{title:'رعاية مرفوضة'}),
    {...official('NEWS-NO-DOC','payment','PAY-NODOC-1',86400*37),documentRef:''},
    {...official('NEWS-UNOFF','contract','CONTRACT-UNOFF-1',86400*36),official:false},
    {id:'RIVAL-1',kind:'competitor',reference:'RIVAL-1',at:86400*35,title:'خبر منافس مولد'}
  ];
  await page.evaluate(events=>{
   const s=window.__GH_STATE__;
   s.simSeconds=86400*45;
   s.eventLog=[{id:'UX-1',type:'warning',title:'تحذير واجهة ليس خبرًا'}];
   s.businessWorld.events=events;
  },events);
  const summary=await page.evaluate(()=>window.GH_ADVANCED.newsSummary(window.__GH_STATE__));
  assert.equal(summary.count,3,'only entries with explicit official flags and complete source/document proof remain');
  assert.equal(summary.latest.reference,'CONTRACT-C-1');
  const refs=await page.evaluate(()=>window.GH_ADVANCED.newsSummary(window.__GH_STATE__).latest);
  assert.equal(refs.official,true);
  await page.evaluate(()=>window.__AUDIT__.openDrawer('news'));
  await page.waitForSelector('.official-news-feed');
  const result=await page.evaluate(()=>({
   text:document.querySelector('#drawerBody')?.innerText||'',
   refs:[...document.querySelectorAll('.official-news-card footer small')].map(node=>node.textContent),
   cards:document.querySelectorAll('.official-news-card').length+document.querySelectorAll('.official-news-lead').length,
   thumbnails:document.querySelectorAll('.official-news-thumb').length,
   oldCenterButton:!!document.querySelector('[data-open="executionLog"],#executionLogBtn'),
   tracks:getComputedStyle(document.querySelector('.game-frame')).gridTemplateColumns,
   mapColumn:getComputedStyle(document.querySelector('.map-stage')).gridColumnStart,
   navRect:(()=>{const r=document.querySelector('.side-nav').getBoundingClientRect();return {left:r.left,right:r.right,width:r.width};})(),mapRect:(()=>{const r=document.querySelector('.map-stage').getBoundingClientRect();return {left:r.left,right:r.right,width:r.width};})(),sheetRect:(()=>{const r=document.querySelector('.sheet-dock').getBoundingClientRect();return {left:r.left,right:r.right,width:r.width};})(),
   title:document.querySelector('#drawerTitle')?.textContent||''
  }));
  assert.equal(result.cards,3,'news UI renders only the three fully sourced official records');
  assert(result.refs.some(ref=>ref.includes('الإدارة المالية')),'source organization remains visible');
  assert.equal(result.thumbnails,2,'artwork is capped to the first three follow-up stories');
  assert(!result.text.includes('DOC-NEWS-'),'document identifiers stay out of the newsroom UI');
  assert(!/تحذير واجهة|عرض غير معتمد|مرفوضة|خبر منافس مولد|نسخة مكررة|عقد قديم موثق/.test(result.text));
  assert.equal(result.oldCenterButton,false,'approval/execution log center has no UI entry point');
  assert.equal(result.mapColumn,'2','the map stays between the left rail and the right newsroom');assert(result.navRect.right<=result.mapRect.left+1,'the physical navigation rail stays left of the map');assert(result.mapRect.right<=result.sheetRect.left+1,'the map stays left of the right-hand news panel');assert(result.sheetRect.right>=1279,'the news panel reaches the right edge in landscape');
  assert(result.tracks.split(' ').length===3,'the landscape news layout uses separate map, rail, and panel columns');
  assert.equal(await page.locator('#executionLogBtn').count(),0);
  await page.evaluate(()=>{window.GH_BUSINESS_WORLD.recordEvent(window.__GH_STATE__,{kind:'billing',company:'group',ownerCompanyId:'group',title:'إصدار فاتورة شهرية موثقة',detail:'فاتورة TEL-INV-PRODUCER-2026-02',amount:38,reference:'BILL-telecom-2026-02-PRODUCER',official:true,sourceDomain:'finance',sourceRef:'BILL-telecom-2026-02-PRODUCER',documentRef:'TEL-INV-PRODUCER-2026-02'});window.__AUDIT__.updateKpis();});
  await page.waitForFunction(()=>document.querySelector('#drawerBody')?.innerText.includes('إصدار فاتورة شهرية موثقة'));
  assert.equal(await page.locator('.official-news-lead h2').innerText(),'إصدار فاتورة شهرية موثقة','an official billing event recorded while the newsroom is open appears without reopening it');
  assert.doesNotMatch(await page.locator('.official-news-page').innerText(),/TEL-INV-PRODUCER-2026-02/,'the newsroom does not expose document identifiers in event details');
  await page.evaluate(()=>{const s=window.__GH_STATE__;for(let i=0;i<300;i++)window.GH_BUSINESS_WORLD.recordEvent(s,{kind:'bid',company:'group',title:`نشاط غير رسمي ${i}`,reference:`BID-NOISE-${i}`});});
  const retained=await page.evaluate(()=>({count:window.GH_ADVANCED.newsSummary(window.__GH_STATE__).count,hasBilling:window.__GH_STATE__.businessWorld.events.some(event=>event.reference==='BILL-telecom-2026-02-PRODUCER')}));
  assert.equal(retained.count,4,'official stories remain available after a burst of non-news business events');assert.equal(retained.hasBilling,true,'the official record is retained ahead of low-value feed noise');
  const artwork=Object.fromEntries(['company-energy-v2.webp','company-bank-v2.webp','company-hq-v2.webp'].map(name=>[name,fs.readFileSync(path.resolve(__dirname,`../WebApp/assets/images/${name}`)).toString('base64')]));
  await page.evaluate(images=>document.querySelectorAll('.official-news-thumb').forEach(img=>{const name=img.getAttribute('src').split('/').pop(),data=images[name];if(data)img.src=`data:image/webp;base64,${data}`;}),artwork);
  await page.screenshot({path:path.resolve(__dirname,'../verification/build365-official-news-landscape.png'),fullPage:false});
  await page.locator('[data-news-close]').click();
  assert.equal(await page.locator('#drawer.open').count(),0,'news close control returns to the uncovered map');
  assert.deepEqual(errors,[],'browser boot and newsroom render without uncaught errors');
  console.log('Build365 official news: PASS (allowlist, real source refs, billing events, live refresh, physical landscape columns)');
 }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});

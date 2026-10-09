'use strict';
const assert=require('node:assert/strict');
const {boot}=require('./helpers/local-dom-app');

const official=(index)=>({id:`NEWS-${index}`,kind:'payment',reference:`PAY-PAGINATION-${index}`,at:1000+index,title:`خبر رسمي ${index}`,official:true,sourceDomain:'finance',sourceRef:`SRC-${index}`,documentRef:`DOC-${index}`});

(async()=>{
 const {page,browser,errors}=await boot({viewport:{width:1280,height:720}});
 try{
  const records=[...Array.from({length:120},(_,index)=>official(index)),...Array.from({length:40},(_,index)=>({id:`NOISE-${index}`,kind:'bid',reference:`BID-${index}`,at:2000+index,title:`نشاط غير رسمي ${index}`}))];
  await page.evaluate(events=>{window.__GH_STATE__.businessWorld.events=events;window.__GH_STATE__.simSeconds=3000;},records);
  const summary=await page.evaluate(()=>window.GH_ADVANCED.newsSummary(window.__GH_STATE__));
  assert.equal(summary.count,80,'the official newsroom list remains capped at 80 even with 120 official events in the 160-row event store');
  assert.equal(summary.latest.reference,'PAY-PAGINATION-119','newest eligible official news is retained');
  await page.evaluate(()=>window.__AUDIT__.openDrawer('news'));
  await page.waitForSelector('.official-news-page');
  const pageState=()=>page.evaluate(()=>({
   count:document.querySelector('.official-news-count')?.textContent.trim(),
   visible:document.querySelectorAll('.official-news-lead,.official-news-card').length,
   title:document.querySelector('.official-news-lead h2')?.textContent,
   firstCard:document.querySelector('.official-news-card h3')?.textContent,
   lastCard:[...document.querySelectorAll('.official-news-card h3')].at(-1)?.textContent,
   direction:getComputedStyle(document.querySelector('.official-news-page')).direction,
   button:!!document.querySelector('[data-news-more-filter]'),
   text:document.querySelector('.official-news-page')?.innerText||''
  }));
  let pageView=await pageState();
  assert.equal(pageView.visible,25,'initial render creates only the first 25 story cards including the lead');
  assert.match(pageView.count,/المعروض 25\s*\/\s*المتاح 80/,'counter accurately reports 25 of 80 available official stories');
  assert.equal(pageView.title,'خبر رسمي 119','newest retained news is shown first');
  assert.equal(pageView.firstCard,'خبر رسمي 118');
  assert.equal(pageView.lastCard,'خبر رسمي 95');
  assert.equal(pageView.direction,'rtl','newsroom remains right-to-left');
  assert(pageView.button,'load-more is available while retained official stories remain');
  assert(!/نشاط غير رسمي/.test(pageView.text),'non-official event noise is never displayed');
  await page.locator('[data-news-more-filter]').click();
  pageView=await pageState();
  assert.equal(pageView.visible,50,'first load-more adds exactly 25 records');
  assert.match(pageView.count,/المعروض 50\s*\/\s*المتاح 80/);
  assert.equal(pageView.lastCard,'خبر رسمي 70');
  await page.locator('[data-news-more-filter]').click();
  pageView=await pageState();
  assert.equal(pageView.visible,80,'final load-more adds the remaining 30 records to the list cap');
  assert.match(pageView.count,/المعروض 80\s*\/\s*المتاح 80/);
  assert.equal(pageView.lastCard,'خبر رسمي 40','last record in the retained 80-item window is reachable');
  assert.equal(pageView.button,false,'load-more disappears at the 80-item cap');
  const retained=await page.evaluate(()=>({eventCount:window.__GH_STATE__.businessWorld.events.length,oldestVisible:document.querySelectorAll('.official-news-card h3').length}));
  assert.equal(retained.eventCount,160,'pagination does not raise, rewrite, or prune the source event store');
  assert.equal(retained.oldestVisible,79,'the final 80-item window renders one lead plus 79 cards');
  assert.deepEqual(errors,[],'browser boot and pagination run without uncaught errors');
  console.log('Build370 official news pagination: PASS (25 + 25 + 30, 80-item cap, allowlist, RTL, retention)');
 }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});

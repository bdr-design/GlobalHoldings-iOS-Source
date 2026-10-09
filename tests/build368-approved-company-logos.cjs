'use strict';
const {chromium}=require('playwright'),assert=require('node:assert/strict'),path=require('node:path'),fs=require('node:fs');
const {serve}=require('./helpers/web-server.js');

(async()=>{
 const root=path.resolve(__dirname,'../WebApp'),out=path.resolve(__dirname,'../verification');fs.mkdirSync(out,{recursive:true});
 const brands=[['group','group'],['air','air'],['sea','sea'],['road','road'],['power','power'],['bank','bank'],['mobility','mobility'],['insurance','insurance'],['realestate','realestate'],['telecom','telecom'],['dealership','dealership']];
 const server=await serve(root),browser=await chromium.launch({headless:true}),page=await browser.newPage({viewport:{width:1356,height:1000},deviceScaleFactor:1,locale:'ar-SA'});
 try{
  await page.goto(server.baseURL+'/index.html');await page.waitForFunction(()=>window.GH_IDENTITY&&window.GH_COMPANY_PLATFORM&&window.GH_CONFERENCE);
  const resolved=await page.evaluate(rows=>rows.map(([id,key])=>{const symbol=GH_IDENTITY.resolve({},id,{usage:'symbol'}),horizontal=GH_IDENTITY.resolve({},id,{usage:'horizontal'});return{id,key,symbol:symbol.logo,horizontal:horizontal.logo,custom:symbol.customLogo};}),brands);
  const rendered=[];
  for(const row of resolved){
   assert.equal(row.symbol,`assets/identity/approved/${row.key}-symbol.webp`,`${row.id}: compact use selects the approved symbol`);
   assert.equal(row.horizontal,`assets/identity/approved/${row.key}-horizontal.webp`,`${row.id}: wide use selects the approved lockup`);
   assert.equal(row.custom,false,`${row.id}: default identity is not marked custom`);
   for(const src of [row.symbol,row.horizontal]){const response=await page.request.get(`${server.baseURL}/${src}`);assert.equal(response.status(),200,`${row.id}: ${src} is shipped`);assert.match(response.headers()['content-type']||'',/image\/webp/,`${row.id}: image is served as WebP`);}
   rendered.push(`<article class="brand ${row.id==='group'?'group':''}"><img src="${row.horizontal}" alt="${row.id}"></article>`);
  }
  const customState={companyRegistry:{air:{logo:'assets/identity/approved/dealership-symbol.webp'}}};
  const custom=await page.evaluate(state=>({symbol:GH_IDENTITY.resolve(state,'air',{usage:'symbol'}).logo,horizontal:GH_IDENTITY.resolve(state,'air',{usage:'horizontal'}).logo,cleared:GH_IDENTITY.resolve({companyRegistry:{air:{logo:null}}},'air',{usage:'horizontal'}).logo}),customState);
  assert.equal(custom.symbol,'assets/identity/approved/dealership-symbol.webp','one uploaded logo remains the compact logo');
  assert.equal(custom.horizontal,'assets/identity/approved/dealership-symbol.webp','one uploaded logo overrides the default horizontal lockup');
  assert.equal(custom.cleared,'assets/identity/approved/air-horizontal.webp','clearing a custom logo restores the approved default');
  const conferenceLogos=await page.evaluate(()=>{
   const raw={saveVersion:'3.0.0',saveRevision:1,simSeconds:0,onboardingComplete:true,openedCompanies:['air'],profile:{name:'مجموعة الاختبار',founder:'المؤسس'},companyRegistry:{air:{definitionId:'gh-air-v1'}},companyFinance:{},assets:[],globalBases:[],customHubs:[],branches:[],hired:[],advanced:{companies:{}}};
   const normal=GH_COMPANY_PLATFORM.migrateState(raw).state,defaultSnapshot=GH_CONFERENCE.buildSnapshot(normal,2026),defaultLogo=defaultSnapshot.companies.find(row=>row.type==='air')?.brand?.logo;
   const customState=GH_COMPANY_PLATFORM.migrateState({...raw,companyRegistry:{air:{definitionId:'gh-air-v1',logo:'assets/identity/approved/dealership-symbol.webp'}}}).state,customSnapshot=GH_CONFERENCE.buildSnapshot(customState,2026);
   const company=defaultSnapshot.companies.find(row=>row.type==='air');
   return{defaultLogo:company?.brand?.logo,defaultMark:company?.brand?.variants?.mark,customLogo:customSnapshot.companies.find(row=>row.type==='air')?.brand?.logo};
  });
  assert.equal(conferenceLogos.defaultLogo,'assets/identity/approved/air-horizontal.webp','conference snapshots preserve the approved horizontal lockup for default brands');
  assert.equal(conferenceLogos.defaultMark,'assets/identity/approved/air-symbol.webp','conference snapshots retain a separate compact mark for side signage');
  assert.equal(conferenceLogos.customLogo,'assets/identity/approved/dealership-symbol.webp','conference snapshots still honor a player-uploaded company logo');
  const signage=await page.evaluate(()=>{
   const root=document.createElement('main');root.className='ghc3';root.innerHTML='<div class="ghc3-viewport"><div class="ghc3-current-title">النتائج المالية</div><div class="ghc3-speaker"><span>شركة الاختبار</span></div><div class="ghc3-document"></div></div>';document.body.append(root);
   const board=new GH_CONF_BOARD.Board(root.querySelector('.ghc3-document')),rows=[['group','group'],['telecom','telecom']],output=[];
   for(const [type,key] of rows){const snapshot={year:2026,group:{name:'المجموعة',brand:{logo:`assets/identity/approved/${key}-horizontal.webp`,variants:{mark:`assets/identity/approved/${key}-symbol.webp`}}},companies:[{type,legalName:'شركة الاختبار',brand:{logo:`assets/identity/approved/${key}-horizontal.webp`,variants:{mark:`assets/identity/approved/${key}-symbol.webp`}}}]};board.update(snapshot,{type,kind:'finance',logo:`assets/identity/approved/${key}-horizontal.webp`,title:'النتائج المالية',headline:'النتائج المالية',metrics:[]});const world=new GH_CONF_WORLD.Auditorium(root.querySelector('.ghc3-viewport'));world.updateSideSignage();output.push({type,screen:root.querySelector('img.ghc3-board-logo')?.getAttribute('src'),mark:root.querySelector('img.ghc3-board-logo')?.getAttribute('data-mark-src'),sides:world.signagePanels.map(panel=>panel.querySelector('img')?.getAttribute('src'))});world.dispose();}
   root.remove();return output;
  });
  for(const row of signage){assert.equal(row.screen,`assets/identity/approved/${row.type}-horizontal.webp`,`${row.type}: main conference display uses full lockup`);assert.equal(row.mark,`assets/identity/approved/${row.type}-symbol.webp`,`${row.type}: main display carries its compact mark separately`);assert.deepEqual(row.sides,[row.mark,row.mark],`${row.type}: stage side panels use only the compact mark`);}
  await page.setContent(`<html lang="ar" dir="ltr"><meta charset="utf-8"><style>*{box-sizing:border-box}body{margin:0;background:#f8faf4;color:#0b2455;font-family:Arial,sans-serif;padding:34px}main{width:100%;height:100%;display:grid;grid-template-columns:1fr 1fr;grid-template-rows:150px repeat(5,154px);gap:0 42px;align-items:center}article{height:154px;display:flex;align-items:center;justify-content:center;border-bottom:1px solid #d6d9d2;padding:10px}article.group{grid-column:1 / -1;justify-self:center;width:560px;height:150px;border-bottom:0;border-top:0}img{width:100%;height:100%;object-fit:contain}.group img{max-width:550px}article.group+article{grid-column:1}</style><main>${rendered.join('')}</main></html>`,{waitUntil:'load'});
  const dimensions=await page.locator('img').evaluateAll(images=>images.map(image=>({src:image.getAttribute('src'),width:image.naturalWidth,height:image.naturalHeight,complete:image.complete})));
  assert.equal(dimensions.length,brands.length,'preview includes all eleven brand lockups');
  for(const row of dimensions)assert(row.complete&&row.width>0&&row.height>0,`preview decodes ${row.src}`);
  await page.screenshot({path:path.join(out,'build368-approved-company-lockups.png')});
  console.log(JSON.stringify({ok:true,brands:resolved.length,customLogoOverride:custom,conferenceLogos,signage,preview:'verification/build368-approved-company-lockups.png'},null,2));
 }finally{await browser.close();await server.close();}
})().catch(error=>{console.error(error);process.exit(1);});

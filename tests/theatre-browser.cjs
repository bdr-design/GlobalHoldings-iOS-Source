const {chromium}=require('playwright');
const fs=require('fs'),path=require('path'),assert=require('assert/strict');
const root=path.resolve(__dirname,'../WebApp');
const {serve}=require('./helpers/web-server.js');
(async()=>{
 const out=path.resolve(__dirname,'../verification');fs.mkdirSync(out,{recursive:true});const server=await serve(root),browser=await chromium.launch({headless:true,args:['--enable-unsafe-swiftshader']}),page=await browser.newPage({viewport:{width:1440,height:900},deviceScaleFactor:1});
 const errors=[];page.on('pageerror',error=>errors.push(error.message));
 await page.goto(server.baseURL+'/index.html');
 await page.waitForFunction(()=>window.GH_CONFERENCE_3D&&window.GH_FINANCE_CORE);
 await page.evaluate(()=>{
  const seed={simSeconds:365*86400,openedCompanies:['air','sea','road','power','bank','mobility'],profile:{name:'مجموعة القابضة العالمية',founder:'عبدالله العتيبي',reputation:75},hired:[],assets:[],globalBases:[],customHubs:[],bank:{branches:32},energy:{solarMW:250},mobility:{vehicles:[]},companyRegistry:{}};
  const migrated=GH_COMPANY_PLATFORM.migrateState(seed);if(migrated.errors.length)throw new Error(`theatre-company-fixture:${migrated.errors.join(',')}`);const state=migrated.state;
  GH_FINANCE_CORE.ensure(state);GH_HR_CORE.ensure(state);
  const types=['air','sea','road','power','bank','mobility'];types.forEach(type=>{const c=GH_HR_CORE.OFFICIAL_MANAGER_CANDIDATES.find(c=>c.company===type);GH_HR_CORE.appointOfficialManager(state,{company:type,candidateId:c.id});});
  for(let day=0;day<365;day++)GH_FINANCE_CORE.execute({state},'record-daily-close',{day,net:270000,companies:Object.fromEntries(types.map((t,i)=>[t,{grossRevenue:100000+i*10000,expenses:80000,net:20000+i*10000}]))});
  const snapshot=GH_CONFERENCE.buildSnapshot(state,2026);window.testSnapshot=snapshot;window.testProgress=[];window.testConfig={snapshot,conferenceId:'QA-334',onProgress:p=>testProgress.push(p)};GH_CONFERENCE_3D.launch(testConfig,{mode:'manual'});
 });
 await page.waitForFunction(()=>GH_CONFERENCE_3D.diagnostics().frames>0);
 await page.screenshot({path:path.join(out,'334-conference-desktop.png')});
 const first=await page.evaluate(()=>GH_CONFERENCE_3D.diagnostics());assert(first.webgl2);assert(first.audience>80);assert(!first.failed);assert.equal(first.scheduledFrame,false);
 await page.locator('[data-c3="camera-screen"]').click();await page.waitForFunction(()=>!GH_CONFERENCE_3D.diagnostics().scheduledFrame);await page.locator('[data-c3="next"]').click();await page.screenshot({path:path.join(out,'334-conference-results.png')});
 await page.locator('[data-c3="details"]').click();assert.match(await page.locator('.ghc3-panel-content').textContent(),/الإيرادات/);await page.locator('[data-c3="panel-close"]').click();
 await page.locator('[data-c3="chapters"]').click();await page.locator('[data-c3="scene-15"]').click();await page.waitForFunction(()=>!GH_CONFERENCE_3D.diagnostics().scheduledFrame);await page.screenshot({path:path.join(out,'334-conference-company.png')});
 await page.setViewportSize({width:390,height:844});await page.locator('[data-c3="camera-wide"]').click();await page.waitForFunction(()=>!GH_CONFERENCE_3D.diagnostics().scheduledFrame);await page.screenshot({path:path.join(out,'334-conference-phone.png')});
 const phone=await page.evaluate(()=>({width:innerWidth,scroll:document.querySelector('.ghc3').scrollWidth,height:innerHeight,rect:document.querySelector('.ghc3').getBoundingClientRect().height,diag:GH_CONFERENCE_3D.diagnostics()}));assert(phone.scroll<=phone.width);assert.equal(phone.rect,phone.height);
 await page.setViewportSize({width:844,height:390});await page.waitForFunction(()=>!GH_CONFERENCE_3D.diagnostics().scheduledFrame);await page.screenshot({path:path.join(out,'334-conference-iphone-landscape.png')});
 const idle=await page.evaluate(()=>GH_CONFERENCE_3D.diagnostics().frames);await page.waitForTimeout(500);assert.equal(await page.evaluate(()=>GH_CONFERENCE_3D.diagnostics().frames),idle);
 await page.getByRole('button',{name:'إغلاق المؤتمر',exact:true}).click();assert.equal(await page.evaluate(()=>GH_CONFERENCE_3D.isActive()),false);assert.equal(await page.locator('.ghc3').count(),0);
 for(let i=0;i<3;i++){await page.evaluate(()=>GH_CONFERENCE_3D.launch(testConfig,{mode:'brief'}));await page.waitForFunction(()=>GH_CONFERENCE_3D.diagnostics().frames>0);await page.getByRole('button',{name:'إغلاق المؤتمر',exact:true}).click();}
 await page.evaluate(()=>{window.testTheatre=GH_CONFERENCE_3D.launch(testConfig,{mode:'manual'});});await page.waitForFunction(()=>GH_CONFERENCE_3D.diagnostics().frames>0);
 const glError=await page.evaluate(()=>document.querySelector('.ghc3 canvas').getContext('webgl2').getError());assert.equal(glError,0);
 await page.evaluate(()=>document.querySelector('.ghc3 canvas').getContext('webgl2').getExtension('WEBGL_lose_context').loseContext());await page.waitForFunction(()=>GH_CONFERENCE_3D.diagnostics().failed);assert(await page.locator('.ghc3-recovery').isVisible());await page.locator('[data-c3="retry"]').click();await page.waitForFunction(()=>GH_CONFERENCE_3D.diagnostics().frames>0&&!GH_CONFERENCE_3D.diagnostics().failed);await page.getByRole('button',{name:'إغلاق المؤتمر',exact:true}).click();
 await page.emulateMedia({reducedMotion:'reduce'});await page.evaluate(()=>{window.testTheatre=GH_CONFERENCE_3D.launch(testConfig,{mode:'manual'});});await page.waitForFunction(()=>GH_CONFERENCE_3D.diagnostics().frames>0);await page.locator('[data-c3="camera-screen"]').click();assert.equal(await page.evaluate(()=>!!testTheatre.transition),false);await page.getByRole('button',{name:'إغلاق المؤتمر',exact:true}).click();const memory=await page.evaluate(()=>({...testTheatre.renderer.info.memory}));assert.equal(memory.geometries,0);assert.equal(memory.textures,0);
 const prior=await page.evaluate(()=>{const s=structuredClone(testSnapshot);s.group.prior={reportedDays:35};s.group.growth={revenue:942.857};return GH_CONFERENCE_3D.buildScenePlan(s).find(x=>x.id==='group-results').metrics.find(x=>x.label==='النمو السنوي').value;});assert.equal(prior,'غير متاح');
 assert.deepEqual(errors,[]);fs.writeFileSync(path.join(out,'334-theatre-results.json'),JSON.stringify({first,phone,errors,idleFramesStable:true,reopenCycles:3,contextLossRecovered:true,reducedMotionRespected:true,disposedMemory:memory,glError,legacyIncompleteGrowthSuppressed:true},null,2));
 console.log(JSON.stringify({first,phone,errors},null,2));await browser.close();await server.close();
})().catch(error=>{console.error(error);process.exit(1)});

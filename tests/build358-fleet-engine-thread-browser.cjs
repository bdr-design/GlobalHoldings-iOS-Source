'use strict';
// Build 358: the fleet event engine runs on its own thread (fleet-engine-worker.js) and the main thread replays its
// result inside each simulation slice. This gate drives the real game (local DOM, the real slice jobs and simulation
// engine) with an air and a road fleet on routes, and at every step an independent copy of the fleet store runs the
// same step on the main thread with the same inputs. The replayed result must equal it exactly: every record byte, the
// value table and the engine's effects. Along the way:
//   - live slices and a calendar advance (both orders), across hour and day boundaries;
//   - purchases and route dispatch between steps (rows appended and rewritten on the main thread reach the replica);
//   - a slice that fails after its writes (a critical post-commit task throws): the whole state, fleet included, comes
//     back exactly, and the thread's replica rolls back with it (the next steps still match);
//   - a slice cancelled while its step is on the thread (discarded: the replica rolls back);
//   - a command that writes the fleet waits for the step in flight;
// and the thread really ran the steps (no fallback to the main thread).
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path');
const {chromium}=require('playwright'),{boot}=require('./helpers/local-dom-app');
const web=path.join(process.env.GH_AUDIT_ROOT||path.resolve(__dirname,'..'),'WebApp');
// The local page has no URL to load worker files from: the worker is the same files, inlined into one blob.
const workerSource=['fleet-store-core.js','simulation-asset-core.js','fleet-event-core.js'].map(file=>fs.readFileSync(path.join(web,file),'utf8')).join('\n;\n')+'\n;\n'+
  fs.readFileSync(path.join(web,'fleet-engine-worker.js'),'utf8').replace(/^importScripts\([^)]*\);$/m,'');

(async()=>{
  const browser=await chromium.launch({headless:true}),errors=[];
  try{
    // The worker comes from a blob here (the page has no URL to load it from); the app's policy allows workers from 'self'
    // only, which on the device is gh://app, so this page bypasses it.
    const {page}=await boot({browser,errors,viewport:{width:844,height:390},bypassCSP:true});page.setDefaultTimeout(180000);
    await page.evaluate(source=>{
      const url=URL.createObjectURL(new Blob([source],{type:'text/javascript'}));window.__GH_FLEET_ENGINE_WORKER_FACTORY__=()=>new Worker(url);
      // Every step the thread runs is checked against the main-thread engine on an independent copy of the store.
      const API=window.GH_FLEET_ENGINE_THREAD,STORE=GH_FLEET_STORE,EVENTS=GH_FLEET_EVENTS,checks=window.__THREAD_CHECKS__={steps:0,mismatches:[],applied:0,client:null};
      window.GH_FLEET_ENGINE_THREAD={...API,create(options){
        const client=API.create(options),specs=options.catalogSpecs(),resolveRoute=options.resolveRoute,shadows=new Map();checks.client=client;
        const catalogSpecs=asset=>asset?.specs?null:(specs[asset?.type]?.[asset?.catalogId]||null);
        return {...client,
          request(store,params){const shadow=STORE.importReplica(structuredClone(STORE.exportReplica(store)));const ticket=client.request(store,params);if(ticket)shadows.set(ticket.id,{shadow,params});return ticket;},
          apply(ticket,store,applyOptions){
            const out=client.apply(ticket,store,applyOptions),entry=shadows.get(ticket?.id);shadows.delete(ticket?.id);
            if(out&&entry){
              checks.applied++;
              const {shadow,params}=entry,expected=EVENTS.advance(shadow,{from:params.from,to:params.to,context:params.context,resolveRoute,catalogSpecs,tripAlertLimit:params.tripAlertLimit,order:params.order,...(Number.isFinite(params.maxEvents)?{maxEvents:params.maxEvents}:{})});
              const a=new Uint8Array(store.rows,0,store.length*STORE.STRIDE),b=new Uint8Array(shadow.rows,0,shadow.length*STORE.STRIDE);
              let row=-1;if(store.length!==shadow.length)row=-2;else for(let i=0;i<a.length;i++)if(a[i]!==b[i]){row=Math.floor(i/STORE.STRIDE);break;}
              const values=JSON.stringify(store.values)===JSON.stringify(shadow.values),effects=JSON.stringify(out.effects)===JSON.stringify(expected.effects);
              const extras=JSON.stringify(store.extras)===JSON.stringify(shadow.extras);
              if(row!==-1||!values||!effects||!extras||out.completeTo!==expected.completeTo||out.events!==expected.events)
                checks.mismatches.push({from:params.from,to:params.to,row,values,effects,extras,completeTo:[out.completeTo,expected.completeTo],events:[out.events,expected.events]});
              checks.steps++;
            }
            return out;
          }};
      }};
    },workerSource);
    const setup=await page.evaluate(async()=>{
      const a=__AUDIT__,s=()=>__GH_STATE__,W=GH_WORLD_DATA;s().godMoney=true;s().infiniteMoney=true;
      for(const type of ['air','sea']){const d=GH_COMPANY_PLATFORM.definitionFor(s(),type);await a.runAuthorizedDomainCommand('corporate','open-company',{type,companyId:type,capital:Math.max(900000000,d.founding.minimumCapital),legalName:`QA ${type}`,formationContract:`QA-THREAD-${type}`},{silent:true});}
      const cheapest=type=>[...GH_ASSET_CATALOG[type].used].sort((x,y)=>(x.leaseMonthly||0)-(y.leaseMonthly||0)||x.price-y.price)[0];let order=0;
      for(const icao of ['OMDB','EGLL']){const r=W.airports.find(x=>x[0]===icao),id=`QA-air-${icao}`;await a.runAuthorizedDomainCommand('facilities','create',{facility:{id,name:`QA ${icao}`,kind:'airport-base',company:'air',ownerCompanyId:'air',owned:true,sourceKey:`air:${icao}`,code:r[1]||icao,icao,iata:r[1],city:r[3]||'—',country:String(r[5]||'—'),coords:[r[6],r[7]]},bucket:'globalBases'},{silent:true});await a.buyAsset('air','used',cheapest('air').id,'lease',150,id,true,`QA-T-${order++}`,'air');}
      const port=W.ports.find(r=>Number.isFinite(Number(r[3]))&&Number.isFinite(Number(r[4])));
      await a.runAuthorizedDomainCommand('facilities','create',{facility:{id:'QA-sea-PORT',name:`QA Port ${port[0]}`,kind:'port-base',company:'sea',ownerCompanyId:'sea',owned:true,sourceKey:`port:${port[0]}:${port[3]}:${port[4]}`,code:String(port[0]).slice(0,5),city:String(port[1]||port[0]),country:String(port[2]||'—'),coords:[port[3],port[4]]},bucket:'globalBases'},{silent:true});
      await a.buyAsset('sea','used',cheapest('sea').id,'lease',80,'QA-sea-PORT',true,`QA-T-${order++}`,'sea');
      return {size:GH_FLEET_DATA.size(s())};
    });
    const dispatch=async company=>{await page.evaluate(c=>__AUDIT__.openDrawer('routes',c),company);const b=page.locator(`.dispatch-international-network[data-company="${company}"]`).first();await b.waitFor({state:'visible'});await b.click();
      await page.waitForFunction(c=>GH_FLEET_DATA.filter(__GH_STATE__,x=>(x.ownerCompanyId||x.companyId)===c).every(x=>x.routeId),company,{timeout:180000});await page.evaluate(()=>__AUDIT__.closeDrawer());};
    await dispatch('air');await dispatch('sea');
    // Time moves through the real simulation engine (calendar advance, then live speed). Single slice jobs, away from a
    // day boundary (a daily close is staged and only lives inside the engine's own job), test rollback and cancel.
    await page.evaluate(()=>{
      const a=__AUDIT__,s=__GH_STATE__,TX=GH_TRANSACTION_CORE,TIME=GH_SIMULATION_TIME_CORE;
      window.__ADVANCE__=async(hours,batchSeconds)=>{
        const target=s.simSeconds+hours*3600,r=a.simulationEngine.advanceTo(target,{speed:600,batchSeconds,reason:'qa-thread',maxSeconds:400*86400});
        for(let i=0;i<20000&&(a.simulationEngine.snapshot().manualAdvance||TX.isStaged(s));i++)await new Promise(r=>setTimeout(r,20));
        const snap=a.simulationEngine.snapshot();
        return {accepted:r?.accepted!==false,reached:Math.abs(s.simSeconds-target)<1e-6,...(Math.abs(s.simSeconds-target)<1e-6?{}:{sim:s.simSeconds,target,failure:snap.lastAdvanceFailure,manualFailures:snap.manualFailures,lastCommitReason:snap.lastCommitReason,lastCancelReason:snap.lastCancelReason,staged:TX.isStaged(s)})};
      };
      window.__LIVE__=async ms=>{a.setSpeed(4);await new Promise(r=>setTimeout(r,ms));a.setSpeed(0);for(let i=0;i<500&&(a.simulationEngine.snapshot().jobActive||TX.isStaged(s));i++)await new Promise(r=>setTimeout(r,20));return {sim:s.simSeconds};};
      window.__RUN_SLICE__=async({seconds=300,fail=false,cancel=false}={})=>{
        let from=s.simSeconds;if(TIME.boundaryAt(from+seconds).day!=null||Math.floor(from/86400)!==Math.floor((from+seconds)/86400))throw new Error('slice would reach a day boundary');
        const to=from+seconds,b=TIME.boundaryAt(to),originalTime=window.GH_SIMULATION_TIME_CORE;
        // The job reads the time core when it is created: the failure hook goes in first (it only acts inside the slice).
        if(fail)window.GH_SIMULATION_TIME_CORE={...originalTime,boundaryAt(x){if(TX.isActive())TX.afterCommit(()=>{throw new Error('build358-thread-injected-failure');},{critical:true,key:'build358-thread-injected',owner:'test'});return originalTime.boundaryAt(x);}};
        try{
          const job=a.createSimulationSliceJob(seconds,{from,to,speed:600,boundary:{day:b.day,hour:b.hour}});
          let pendingSeen=false;
          for(let guard=0;guard<20000;guard++){const r=job.runChunk(64,{deadline:performance.now()+8});if(r===true)break;if(r?.pending){pendingSeen=true;if(cancel){job.cancel();return {cancelled:true,pendingSeen};}await new Promise(r=>setTimeout(r,0));}}
          let out;try{out=job.finish();}catch(error){out={committed:false,error:String(error?.message||error)};}return {...out,pendingSeen};
        }finally{window.GH_SIMULATION_TIME_CORE=originalTime;}
      };
      // Moves to the start of the next hour that is not the last of its day, so short single slices stay inside one day.
      window.__TO_SAFE_HOUR__=async()=>{const hour=Math.floor(s.simSeconds/3600)+1,target=(hour%24===23?hour+1:hour)*3600;if(target>s.simSeconds)await __ADVANCE__((target-s.simSeconds)/3600,600);};
      window.__FINGERPRINT__=()=>JSON.stringify({state:s,fleet:GH_FLEET_DATA.list(s),size:GH_FLEET_DATA.size(s)},function(key,value){return this===s&&key==='fleet'?undefined:value;});
    });
    const steps=()=>page.evaluate(()=>window.__THREAD_CHECKS__.steps);
    const calendar=await page.evaluate(()=>__ADVANCE__(30,600));                 // 30 hours (crosses a day) in 600 s slices
    const calendarHours=await page.evaluate(()=>__ADVANCE__(24,3600));           // a day in hour slices
    const live=await page.evaluate(()=>__LIVE__(4000));                          // live speed: events order, live pacing
    const stepsBeforePurchase=await steps();
    // Rows appended and rewritten here between steps: a purchase, then its dispatch.
    await page.evaluate(async()=>{const a=__AUDIT__,cheapest=[...GH_ASSET_CATALOG.air.used].sort((x,y)=>(x.leaseMonthly||0)-(y.leaseMonthly||0)||x.price-y.price)[0];await a.buyAsset('air','used',cheapest.id,'lease',60,'QA-air-OMDB',true,'QA-T-MORE','air');});
    await dispatch('air');
    const afterPurchase=await page.evaluate(()=>__ADVANCE__(26,3600));
    // A few rows edited here, as a single-asset command does (row writes, not column writes): they travel as rows.
    const rowEdits=await page.evaluate(async()=>{
      const s=__GH_STATE__,ids=GH_FLEET_DATA.filter(s,x=>x.phase==='turnaround').slice(0,5).map(x=>x.id),before=__THREAD_CHECKS__.client.stats().rowsSent;
      const tx=GH_TRANSACTION_CORE.execute(s,{label:'qa-row-edits',scope:['simSeconds'],apply:()=>{for(const id of ids)GH_FLEET_DATA.update(s,id,{condition:81.5});return true;}});
      const written=ids.filter(id=>GH_FLEET_DATA.get(s,id)?.condition===81.5).length,revision=s.fleet.revision,full=__THREAD_CHECKS__.client.stats().fullSyncs;
      const r=await __ADVANCE__(6,1800);const stats=__THREAD_CHECKS__.client.stats();
      return {...r,committed:tx.committed,edited:written,rowsSent:stats.rowsSent-before,fullSyncs:stats.fullSyncs-full,reasons:stats.fullSyncReasons,revision};
    });
    // A slice that fails after its writes rolls everything back, the replica included.
    await page.evaluate(()=>__TO_SAFE_HOUR__());
    const rollback=await page.evaluate(async()=>{
      const before=__FINGERPRINT__(),failed=await __RUN_SLICE__({seconds:600,fail:true}),after=__FINGERPRINT__();
      // On a mismatch, name what differs (state roots, their changed keys, and the first changed fleet row).
      let diff=null;if(before!==after){const A=JSON.parse(before),B=JSON.parse(after),changed=(a,b)=>Object.keys({...a,...b}).filter(k=>JSON.stringify(a?.[k])!==JSON.stringify(b?.[k]));diff={roots:changed(A.state,B.state),size:[A.size,B.size]};diff.detail=diff.roots.slice(0,6).map(k=>{const a=A.state[k],b=B.state[k];return a&&b&&typeof a==='object'&&!Array.isArray(a)?{root:k,keys:changed(a,b).slice(0,12)}:{root:k,before:JSON.stringify(a).slice(0,240),after:JSON.stringify(b).slice(0,240)};});const row=A.fleet.findIndex((x,i)=>JSON.stringify(x)!==JSON.stringify(B.fleet[i]));if(row>=0){const keys=changed(A.fleet[row],B.fleet[row]);diff.fleetRow={row,keys,before:Object.fromEntries(keys.map(k=>[k,A.fleet[row][k]])),after:Object.fromEntries(keys.map(k=>[k,B.fleet[row]?.[k]]))};}}
      return {committed:failed.committed,error:failed.error||failed.reason||null,pendingSeen:failed.pendingSeen,identical:before===after,diff};
    });
    // A slice cancelled while its step is on the thread.
    const cancelled=await page.evaluate(async()=>{const before=__FINGERPRINT__(),r=await __RUN_SLICE__({seconds:600,cancel:true});return {...r,identical:before===__FINGERPRINT__()};});
    const stepsBeforeRecovery=await steps();
    const afterRollback=await page.evaluate(()=>__ADVANCE__(12,1800));
    // A command that writes the fleet waits for a step in flight.
    await page.evaluate(()=>__TO_SAFE_HOUR__());
    const waited=await page.evaluate(async()=>{
      const client=window.__THREAD_CHECKS__.client,s=__GH_STATE__,TIME=GH_SIMULATION_TIME_CORE,from=s.simSeconds,to=from+300,b=TIME.boundaryAt(to);
      const job=__AUDIT__.createSimulationSliceJob(300,{from,to,speed:600,boundary:{day:b.day,hour:b.hour}});const first=job.runChunk(64,{deadline:performance.now()+8});
      const busy=client.busy;let resolvedWhileBusy=null;const idle=client.idle().then(()=>{resolvedWhileBusy=client.busy;});
      for(let i=0;i<2000&&job.runChunk(64,{deadline:performance.now()+8})!==true;i++)await new Promise(r=>setTimeout(r,0));
      const out=job.finish();await idle;
      return {firstPending:!!first?.pending,busy,committed:out.committed,resolvedWhileBusy,busyAfter:client.busy};
    });
    const checks=await page.evaluate(()=>({steps:__THREAD_CHECKS__.steps,applied:__THREAD_CHECKS__.applied,mismatches:__THREAD_CHECKS__.mismatches.slice(0,3),stats:__THREAD_CHECKS__.client?.stats(),size:GH_FLEET_DATA.size(__GH_STATE__),moving:GH_FLEET_DATA.count(__GH_STATE__,x=>x.phase==='moving')}));
    console.log(JSON.stringify({setup,calendar,calendarHours,live,afterPurchase,rowEdits,rollback,cancelled,afterRollback,waited,checks},null,1));
    assert.deepEqual(checks.mismatches,[],'every step replayed from the thread equals the main-thread engine on the same inputs');
    assert.equal(checks.stats.disabled,null,`the thread stayed available (${checks.stats.lastReason})`);
    assert.equal(checks.stats.fallbacks,0,`no step fell back to the main thread (${checks.stats.lastReason})`);
    for(const [name,row] of Object.entries({calendar,calendarHours,afterPurchase,rowEdits,afterRollback}))assert.equal(row.reached,true,`${name}: the calendar advance reached its target`);
    assert.ok(stepsBeforePurchase>=60,`the thread ran the calendar and live steps (${stepsBeforePurchase})`);
    assert.ok(checks.steps>stepsBeforeRecovery,'steps after a rollback and a cancel still run on the thread (and still match)');
    assert.ok(checks.stats.incrementalSyncs>0&&rowEdits.edited===5&&rowEdits.rowsSent>=5&&rowEdits.reached,`rows written here between steps reached the replica as rows (${JSON.stringify(rowEdits)})`);
    assert.ok(checks.size>setup.size&&checks.moving>0,'the purchase was replicated and the fleet moves');
    assert.equal(rollback.committed,false);assert.match(String(rollback.error),/build358-thread-injected-failure/);assert.equal(rollback.pendingSeen,true);
    assert.equal(rollback.identical,true,'a failed slice restores the whole state exactly');
    assert.equal(cancelled.cancelled,true);assert.equal(cancelled.identical,true,'a cancelled slice leaves the state unchanged');
    assert.deepEqual(waited,{firstPending:true,busy:true,committed:true,resolvedWhileBusy:false,busyAfter:false},'a command waits until the step in flight is settled');
    assert.deepEqual(errors,[]);
    console.log('BUILD358_FLEET_ENGINE_THREAD_PASS');
  }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});

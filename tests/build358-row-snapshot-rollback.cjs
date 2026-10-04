'use strict';
// Build 358: simulation slices snapshot only the roots they write, and GH Mobility, finance, the control plane, domain
// command records, the market and realism are captured at row level instead of deep-cloned (an hour slice also keeps
// the routes, their endpoints and GH_ADVANCED at row level; its failed run below edits all three). This test drives the real
// game (local DOM, real slice job) with an air fleet on routes and an active GH Mobility network, then:
//   1. runs two game days of slices with the write-set audit enforcing the narrow scopes (any write outside the
//      snapshot throws), and
//   2. fails a steady, an hour-only and a daily-close slice after all their writes (a critical post-commit task throws)
//      and requires the complete game state, fleet records included, to come back byte-for-byte.
const assert=require('node:assert/strict');
const {chromium}=require('playwright'),{boot}=require('./helpers/local-dom-app');

(async()=>{
  const browser=await chromium.launch({headless:true}),errors=[];
  try{
    const {page}=await boot({browser,errors});
    const setup=await page.evaluate(async()=>{
      const a=__AUDIT__,s=()=>__GH_STATE__,W=GH_WORLD_DATA;
      const open=async(type,capital)=>{if(!s().openedCompanies.includes(type)){const d=GH_COMPANY_PLATFORM.definitionFor(s(),type);await a.runAuthorizedDomainCommand('corporate','open-company',{type,companyId:type,capital:Math.max(capital,d.founding.minimumCapital),legalName:`Rollback ${type}`,formationContract:`ROLLBACK-${type}`},{silent:true});}};
      await open('air',400000000);
      const ap=W.airports.find(r=>r[0]==='OMDB');
      const facility={id:'RB-AIR-OMDB',name:'Rollback OMDB',kind:'airport-base',company:'air',ownerCompanyId:'air',owned:true,sourceKey:'air:OMDB',code:ap[1],icao:ap[0],iata:ap[1],city:ap[3]||'—',country:String(ap[5]),coords:[ap[6],ap[7]]};
      await a.runAuthorizedDomainCommand('facilities','create',{facility,bucket:'globalBases'},{silent:true});
      const model=[...GH_ASSET_CATALOG.air.used].sort((x,y)=>(x.leaseMonthly||0)-(y.leaseMonthly||0)||x.price-y.price)[0];
      await a.buyAsset('air','used',model.id,'lease',40,facility.id,true,'RB-AIR-40','air');
      await a.openDrawer('routes','air');document.querySelector('.dispatch-international-network[data-company="air"]')?.click();
      for(let i=0;i<200&&GH_FLEET_DATA.count(s(),x=>!!x.routeId)<40;i++)await new Promise(r=>setTimeout(r,100));
      await open('mobility',150000000);
      const M=GH_MOBILITY_CORE,st=s();
      st.customHubs.push({id:'MOB-CENTER-RUH',name:'Riyadh',kind:'mobility-center',company:'mobility',ownerCompanyId:'mobility',owned:true,capitalId:'RUH',city:'Riyadh',country:'Saudi Arabia',coords:[24.7,46.7],bays:120});
      M.ensure(st);st.mobility.capitalCenters.push({id:'MOB-CENTER-RUH',ownerCompanyId:'mobility',capitalId:'RUH',city:'Riyadh',country:'Saudi Arabia',coords:[24.7,46.7],facilityId:'MOB-CENTER-RUH'});
      await a.runAuthorizedDomainCommand('mobility','buy-fleet',{quantity:40,centerId:'RUH'},{silent:true});
      for(const from of M.ZONES)for(const to of M.ZONES){const mid=[(from.coords[0]+to.coords[0])/2+.001,(from.coords[1]+to.coords[1])/2];M.cacheStreetRoute({state:st},{centerId:'RUH',fromZone:from.id,toZone:to.id,route:[from.coords,mid,to.coords],distanceKm:8,durationSeconds:700});}
      return {routed:GH_FLEET_DATA.count(s(),x=>!!x.routeId),vehicles:st.mobility.vehicles.length,mode:GH_FLEET_DATA.mode(s())};
    });
    assert.equal(setup.mode,'store');assert.equal(setup.routed,40);assert.equal(setup.vehicles,40);

    const result=await page.evaluate(()=>{
      const a=__AUDIT__,s=__GH_STATE__,TX=GH_TRANSACTION_CORE,TIME=GH_SIMULATION_TIME_CORE;s.speed=0;
      const kindAt=to=>{const b=TIME.boundaryAt(to);return b.day!=null?'day':b.hour!=null?'hour':'steady';};
      const runSlice=(failAfterWrites=false,extraWrites=null)=>{
        const from=s.simSeconds,to=from+600,b=TIME.boundaryAt(to),originalTime=window.GH_SIMULATION_TIME_CORE;
        if(failAfterWrites)window.GH_SIMULATION_TIME_CORE={...originalTime,boundaryAt(x){TX.afterCommit(()=>{throw new Error('build358-injected-failure');},{critical:true,key:'build358-injected',owner:'test'});if(extraWrites){extraWrites();extraWrites=null;}return originalTime.boundaryAt(x);}};
        try{
          const job=a.createSimulationSliceJob(600,{from,to,speed:600,boundary:{day:b.day,hour:b.hour}});
          while(job.runChunk(64,{deadline:performance.now()+8})!==true){}
          try{return job.finish();}catch(error){return {committed:false,error:String(error?.message||error)};}
        }finally{window.GH_SIMULATION_TIME_CORE=originalTime;}
      };
      // Everything a save would hold, in insertion order. Fleet records are compared through the access layer: the
      // store's revision/structure counters only move forward by design (Build 356), so the raw root is left out.
      const fingerprint=()=>JSON.stringify({state:s,fleet:GH_FLEET_DATA.list(s),fleetSize:GH_FLEET_DATA.size(s)},function(key,value){return this===s&&key==='fleet'?undefined:value;});
      // 1. two game days under write-set enforcement
      window.__GH_BUILD339_WRITE_AUDIT__=true;window.__GH_BUILD358_ENFORCE_SLICE_SCOPE__=true;
      const enforced={steady:0,hour:0,day:0},storages={};
      try{for(let i=0;i<288;i++){const kind=kindAt(s.simSeconds+600),out=runSlice();if(!out.committed)throw new Error(`enforced ${kind} slice failed: ${out.reason||out.error}`);enforced[kind]++;const t=TX.telemetry().lastSimulation;(storages[kind]=storages[kind]||new Set()).add(`${t.rollbackStorage}/${t.fallbackReason||'-'}/${(t.rowRoots||[]).join('+')}`);}}
      finally{window.__GH_BUILD339_WRITE_AUDIT__=false;window.__GH_BUILD358_ENFORCE_SLICE_SCOPE__=false;}
      // 2. failed slices restore exactly
      const rollbacks={};
      for(const wanted of ['steady','hour','day']){
        let guard=0;while(kindAt(s.simSeconds+600)!==wanted&&guard++<200){const out=runSlice();if(!out.committed)throw new Error('advance failed '+out.reason);}
        const mobilityBefore={trips:s.mobility.activeTrips.length,archive:s.mobility.tripArchive.length,requests:s.mobility.rideRequests.length};
        // The hour slice keeps the routes, their endpoints and GH_ADVANCED at row level: within that contract, writes
        // to each (a field of a member, a member added, removed or replaced, a list inside a member edited) roll back.
        const hourWrites=()=>{
          const routes=s.customRoutes,endpointIds=Object.keys(s.routeEndpoints);
          routes[0].qaRollbackField='written';routes[1].name='QA renamed';routes.push({...routes[2],id:'QA-ROUTE-EXTRA'});routes.splice(3,1);
          s.routeEndpoints[endpointIds[0]]={...s.routeEndpoints[endpointIds[0]],qa:true};delete s.routeEndpoints[endpointIds[1]];s.routeEndpoints['QA-ENDPOINT']={id:'QA-ENDPOINT'};
          s.advanced.economy.electricityPriceMWh=(Number(s.advanced.economy.electricityPriceMWh)||0)+7;s.advanced.economy.qa=1;
          s.advanced.ma=s.advanced.ma||{reviews:[]};s.advanced.ma.reviews=Array.isArray(s.advanced.ma.reviews)?s.advanced.ma.reviews:[];s.advanced.ma.reviews.unshift({id:'QA-REVIEW'});
        };
        if(wanted==='hour'&&!(s.customRoutes.length>=4&&Object.keys(s.routeEndpoints).length>=2))throw new Error('hour rollback needs routes and endpoints');
        const before=fingerprint(),simBefore=s.simSeconds,failed=runSlice(true,wanted==='hour'?hourWrites:null),after=fingerprint();
        const t=TX.telemetry().lastSimulation;
        let firstDiff=-1;if(before!==after){for(let i=0;i<Math.min(before.length,after.length);i++)if(before[i]!==after[i]){firstDiff=i;break;}}
        rollbacks[wanted]={committed:failed.committed,reason:failed.reason||failed.error||null,simBefore,simAfter:s.simSeconds,identical:before===after,bytes:before.length,diff:firstDiff<0?null:{before:before.slice(Math.max(0,firstDiff-160),firstDiff+160),after:after.slice(Math.max(0,firstDiff-160),firstDiff+160)},storage:`${t.rollbackStorage}/${t.fallbackReason||'-'}/${(t.rowRoots||[]).join('+')}`,mobilityBefore};
        const ok=runSlice();if(!ok.committed)throw new Error(`${wanted} slice did not commit after rollback: ${ok.reason||ok.error}`);
      }
      // 3. GH Mobility street-route results run as scoped system commands (mobility + command records), not full copies
      const zones=GH_MOBILITY_CORE.ZONES,streetPayload=(i)=>({centerId:'RUH',fromZone:zones[i%zones.length].id,toZone:zones[(i+5)%zones.length].id,route:[zones[i%zones.length].coords,[24.71+i/1000,46.71],zones[(i+5)%zones.length].coords],distanceKm:6+i,durationSeconds:500+i});
      window.__GH_BUILD358_ENFORCE_SLICE_SCOPE__=true;
      try{GH_DOMAIN_COMMANDS.dispatchSystem({state:s},'mobility','cache-street-route',streetPayload(1),{actor:'system-mobility-routing-provider'});}finally{window.__GH_BUILD358_ENFORCE_SLICE_SCOPE__=false;}
      const streetTelemetry=TX.telemetry().last,streetBefore=fingerprint(),originalExecute=GH_MOBILITY_CORE.execute;
      GH_MOBILITY_CORE.execute=function(...args){const value=originalExecute.apply(this,args);TX.afterCommit(()=>{throw new Error('build358-street-failure');},{critical:true,key:'build358-street',owner:'test'});return value;};
      let streetError=null;try{GH_DOMAIN_COMMANDS.dispatchSystem({state:s},'mobility','cache-street-route',streetPayload(2),{actor:'system-mobility-routing-provider'});}catch(error){streetError=String(error?.message||error);}finally{GH_MOBILITY_CORE.execute=originalExecute;}
      const street={storage:streetTelemetry.rollbackStorage,scope:streetTelemetry.scopeSize,rowRoots:streetTelemetry.rowRoots||[],error:streetError,identical:fingerprint()===streetBefore};
      return {enforced,street,storages:Object.fromEntries(Object.entries(storages).map(([k,v])=>[k,[...v]])),rollbacks,mobility:{trips:s.mobility.activeTrips.length,archive:s.mobility.tripArchive.length,completed:s.mobility.kpis.completed}};
    });
    console.log(JSON.stringify({enforced:result.enforced,storages:result.storages,mobility:result.mobility},null,1));
    assert(result.enforced.steady>200&&result.enforced.hour>=40&&result.enforced.day>=2,`slice mix: ${JSON.stringify(result.enforced)}`);
    assert(result.mobility.completed>0&&result.mobility.archive>0,'GH Mobility must complete and archive trips during the run');
    assert(result.storages.steady.every(row=>row.startsWith('legacy-scoped/-/')&&row.includes('mobility')),`steady slices: ${result.storages.steady}`);
    assert(result.storages.hour.every(row=>row.startsWith('legacy-scoped/-/')&&row.includes('controlPlane')),`hour slices must not promote: ${result.storages.hour}`);
    assert(result.storages.hour.every(row=>['advanced','customRoutes','routeEndpoints'].every(root=>row.split('/')[2].split('+').includes(root))),`hour slices keep routes, endpoints and GH_ADVANCED at row level: ${result.storages.hour}`);
    for(const [kind,row] of Object.entries(result.rollbacks)){
      console.log(kind,JSON.stringify({committed:row.committed,reason:row.reason,storage:row.storage,identical:row.identical,bytes:row.bytes,mobility:row.mobilityBefore}));
      assert.equal(row.committed,false,`${kind}: injected failure must roll back`);
      assert.match(String(row.reason),/build358-injected-failure/,`${kind}: rolled back for the injected failure`);
      assert.equal(row.simAfter,row.simBefore,`${kind}: simulation time restored`);
      assert.equal(row.identical,true,`${kind}: state must be restored exactly: ${JSON.stringify(row.diff)}`);
    }
    // The staged daily close captures every root before it writes (stagedFullScope), so its joined commands no longer
    // promote it to a full-state copy mid-work; the rollback above stays exact.
    assert.match(result.rollbacks.day.storage,/^legacy-scoped\/-\//,'daily close: full scope captured before writing, no joined-writer promotion');
    console.log('street-route',JSON.stringify(result.street));
    assert.equal(result.street.storage,'legacy-scoped','a street-route result snapshots only its scope');assert.ok(result.street.rowRoots.includes('mobility'));
    assert.match(String(result.street.error),/build358-street-failure/);assert.equal(result.street.identical,true,'a failed street-route command restores the state exactly');
    assert.deepEqual(errors,[]);
    console.log('BUILD358_ROW_SNAPSHOT_ROLLBACK_PASS');
  }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});

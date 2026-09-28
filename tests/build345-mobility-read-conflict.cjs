'use strict';
const assert=require('node:assert/strict');
const {makeEnvironment}=require('./helpers/simulation-owner-scenario');
const {scenario}=require('./helpers/business-scenario');
let checks=0;
function check(name,run){run();checks++;console.log('PASS',name);}
function ready(env,seconds=30){
 const from=env.state.simSeconds,job=env.s.createSimulationSliceJob(seconds,{from,to:from+seconds,speed:30,boundary:{day:null,hour:null}});
 for(let turn=0;turn<10000;turn++){if(job.runChunk(32)===true)return job;}
 throw new Error('slice-did-not-complete');
}
check('unchanged map queries do not create gameplay revisions or replace canonical arrays',()=>{
 const env=makeEnvironment(true,2),tx=env.s.GH_TRANSACTION_CORE,m=env.s.GH_MOBILITY_CORE,s=env.state;
 m.ensure(s);m.ensure(s);const before=JSON.stringify(s),rev=tx.inputRevision(s),transactions=tx.kernelOwnerStatus(s).transactions;
 const arrays=['vehicles','drivers','rideRequests','activeTrips','tripArchive','tripArchivePending','events','capitalCenters','zones'];
 const refs=arrays.map(key=>s.mobility[key]),kpis=s.mobility.kpis;
 for(let i=0;i<10;i++){m.liveVehicles(s,1,{onlyIds:[]});m.movingClusters(s,[]);m.centerClusters(s);m.snapshot(s);m.pendingStreetRoutes(s);m.findVehicle(s,'missing');}
 assert.equal(JSON.stringify(s)===before,true,'state bytes must stay unchanged');
 assert.equal(tx.inputRevision(s),rev,'presentation must not advance simulation input revision');
 assert.equal(tx.kernelOwnerStatus(s).transactions,transactions,'canonical reads must not open even no-op kernel transactions');
 arrays.forEach((key,index)=>assert.equal(s.mobility[key],refs[index],`${key} identity`));assert.equal(s.mobility.kpis,kpis);
});
check('900-asset prepared slice survives repeated real map-reader calls',()=>{
 const env=makeEnvironment(true,900),tx=env.s.GH_TRANSACTION_CORE,m=env.s.GH_MOBILITY_CORE,s=env.state;m.ensure(s);
 const job=ready(env),rev=tx.inputRevision(s);
 for(let i=0;i<20;i++){m.liveVehicles(s,1,{onlyIds:[]});m.movingClusters(s);}
 assert.equal(tx.inputRevision(s),rev);assert.equal(job.finish().committed,true);assert.equal(s.simSeconds,30);
});
check('real Mobility writes still invalidate a prepared slice',()=>{
 const env=makeEnvironment(true,2),m=env.s.GH_MOBILITY_CORE,s=env.state;m.ensure(s);const job=ready(env);
 s.mobility.kpis.completed++;m.liveVehicles(s,1,{onlyIds:[]});
 const outcome=job.finish();assert.equal(outcome.committed,false);assert.equal(outcome.reason,'simulation-source-revision-conflict');assert.equal(s.simSeconds,0);
});
check('failed finance commit still rolls back the complete simulation byte-for-byte',()=>{
 const env=makeEnvironment(true,2),s=env.state;env.s.GH_MOBILITY_CORE.ensure(s);const job=ready(env),before=JSON.stringify(s),original=env.s.GH_FINANCE_CORE.execute;
 env.s.GH_FINANCE_CORE.execute=(ctx,command,...args)=>{if(command==='apply-simulation-journal')throw new Error('injected-build345-finance-failure');return original(ctx,command,...args);};
 assert.throws(()=>job.finish(),/injected-build345-finance-failure/);assert.equal(JSON.stringify(s)===before,true,'state bytes must stay unchanged');
});
check('normalization remains idempotent on legacy objects and repairs replaced input',()=>{
 const env=scenario(),m=env.s.GH_MOBILITY_CORE,s=env.state;delete s.mobility;m.ensure(s);const before=JSON.stringify(s),refs={vehicles:s.mobility.vehicles,zones:s.mobility.zones,kpis:s.mobility.kpis};
 m.ensure(s);assert.equal(JSON.stringify(s)===before,true,'state bytes must stay unchanged');for(const [key,ref] of Object.entries(refs))assert.equal(s.mobility[key],ref);
 s.mobility.vehicles=[null,false];delete s.mobility.kpis.requests;m.ensure(s);assert.deepEqual(Array.from(s.mobility.vehicles),[]);assert.equal(s.mobility.kpis.requests,0);
});
check('row ownership rejection remains active after normalization and rollback',()=>{
 const env=makeEnvironment(true,2),m=env.s.GH_MOBILITY_CORE,s=env.state,tx=env.s.GH_TRANSACTION_CORE;m.ensure(s);const before=JSON.stringify(s);
 assert.throws(()=>tx.execute(s,{label:'test-invalid-mobility-owner',apply:()=>{s.mobility.vehicles.push({id:'bad',ownerCompanyId:'air'});m.ensure(s);}}),/mobility-row-owner-conflict/);
 assert.equal(JSON.stringify(s)===before,true,'state bytes must stay unchanged');m.ensure(s);assert.equal(s.mobility.vehicles.length,0);
});
console.log(`BUILD345_MOBILITY_READ_CONFLICT ${checks}/${checks} PASS; Node-only, physicalDeviceTested=false`);

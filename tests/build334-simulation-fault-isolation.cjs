'use strict';

const assert=require('node:assert/strict');
const {createSimulationAdapter,makeAsset,fixture}=require('./helpers/fleet-simulation-adapter');

function stateSnapshot(s,state){
  const copy=structuredClone(state);delete copy.fleet;
  const at=[];s.GH_FLEET_STORE.forEachLive(state.fleet,row=>at.push(s.GH_FLEET_STORE.slot(state.fleet,'at',row)));
  return JSON.stringify({state:copy,assets:s.GH_FLEET_STORE.toAssets(state.fleet),at});
}

function run({faultAt=1,lateFailure=false}={}){
  const route={...fixture.routes.A1,id:'FAULT-ROUTE',tripSeconds:60,dwellHours:1.25};
  const broken=makeAsset('faulted',{route,from:0,phase:'moving',progress:0,routeSlot:0,baseFacility:route.fromFacility,catalogId:'FAULT'});broken.tripSeconds=60;
  delete broken.specs;
  const healthy=makeAsset('healthy',{route,from:0,phase:'moving',progress:0,routeSlot:0,baseFacility:route.fromFacility,catalogId:'HEALTHY'});healthy.tripSeconds=60;
  const {s,state}=createSimulationAdapter({from:0,assets:[broken,healthy],routeOverrides:{[route.id]:route},deliveryWork:lateFailure});
  const calls={faulted:0};
  s.catalogItem=(_type,catalogId)=>{
    if(catalogId==='FAULT'&&++calls.faulted===faultAt)throw new Error('injected-trip-failure');
    return null;
  };
  if(lateFailure){
    s.GH_REALISM.hasPendingDeliveries=()=>true;
    s.GH_REALISM.onSimulationTime=()=>{throw new Error('injected-delivery-failure');};
  }
  const to=faultAt===1?60:4560,job=s.__makeFleetSliceJob(to,{from:0,to,speed:30,manualAdvance:false,boundary:{day:null,hour:null}});
  assert.equal(job.runChunk(64),true);
  if(lateFailure){
    const before=stateSnapshot(s,state);
    assert.throws(()=>job.finish(),/injected-delivery-failure/);
    assert.equal(stateSnapshot(s,state),before,'failed slice must restore non-fleet roots and exact fleet row content/checkpoints');
    assert.equal(state.simSeconds,0);return;
  }
  const result=job.finish();assert.equal(result.committed,true);
  const brokenView=s.GH_FLEET_DATA.get(state,'faulted'),healthyView=s.GH_FLEET_DATA.get(state,'healthy');
  assert.equal(brokenView.simulationFault.code,'ASSET_SIMULATION_ISOLATED');
  assert.equal(brokenView.crewBlocked,true);
  assert.equal(healthyView.simulationFault,undefined,'one asset fault must not stop its peer');
  assert.equal(state.simSeconds,to);
  assert(calls.faulted>=faultAt,'the injected catalog failure must occur on the requested event');
  assert(Object.values(state.tripCountAccrued||{}).some(count=>count>0),'healthy asset trips must still accrue');
}

run();run({faultAt:2});run({lateFailure:true});
console.log(JSON.stringify({suite:'simulation-fault-isolation',passed:3,total:3,contract:'per-asset engine fault isolation plus exact transaction rollback',engine:'Fleet Event Core 4.2'}));

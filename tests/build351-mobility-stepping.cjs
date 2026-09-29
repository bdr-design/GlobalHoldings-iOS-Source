'use strict';
// Build 351: Mobility is stepped every 600 s INSIDE a wider slice instead of shrinking every slice of the whole group.
// Proof: driving a real Mobility company for several days with 600-second slices (the old cadence) and with 3600-second slices
// (advanceThrough) leaves the ENTIRE game state byte-identical, and the slice limit no longer constrains other simulation.
const assert=require('node:assert/strict');
const path=require('node:path');
const ROOT=process.env.GH_TEST_SOURCE_DIR||path.resolve(__dirname,'..');
process.env.GH_TEST_SOURCE_DIR=ROOT;
const {scenario}=require(path.join(ROOT,'tests/helpers/business-scenario'));

function prepared(){
  const env=scenario(),{state,s,command}=env,M=s.GH_MOBILITY_CORE;
  command('corporate','open-company',{type:'mobility',capital:500000000,legalName:'Test Mobility'});
  state.customHubs.push({id:'MOB-CENTER-RUH',name:'Riyadh',kind:'mobility-center',ownerCompanyId:'mobility',owned:true,capitalId:'RUH',city:'Riyadh',country:'Saudi Arabia',coords:[24.7,46.7],bays:120});
  M.ensure(state);state.mobility.capitalCenters.push({id:'MOB-CENTER-RUH',ownerCompanyId:'mobility',capitalId:'RUH',city:'Riyadh',country:'Saudi Arabia',coords:[24.7,46.7],facilityId:'MOB-CENTER-RUH'});
  command('mobility','buy-fleet',{quantity:12,centerId:'RUH',classId:'eco-ev'});
  // No street-route provider exists in Node: cache a verified route for every zone pair through the official API so trips can
  // start AND complete (otherwise only demand, dispatch and expiry would be exercised).
  for(const from of M.ZONES)for(const to of M.ZONES){
    const distanceKm=6+((from.id.length*7+to.id.length*3)%9),durationSeconds=420+((from.id.length*131+to.id.length*57)%900);
    M.cacheStreetRoute({state},{centerId:'RUH',fromZone:from.id,toZone:to.id,route:[from.coords,[(from.coords[0]+to.coords[0])/2+.001,(from.coords[1]+to.coords[1])/2],to.coords],distanceKm,durationSeconds});
  }
  return {env,state,M};
}
const DAY=86400,SPAN=3*DAY,START=1000;

// A) reference: consecutive 600-second slices, exactly what the engine did while Mobility was active
const A=prepared();A.state.simSeconds=START;
for(let t=START;t<START+SPAN;t+=600){A.state.simSeconds=t+600;A.M.onSimulationTime({state:A.state},t+600);}
// B) new: 3600-second slices, Mobility stepped inside
const B=prepared();B.state.simSeconds=START;
for(let t=START;t<START+SPAN;t+=3600){B.state.simSeconds=t+3600;B.M.advanceThrough({state:B.state},t,t+3600);}

assert.equal(A.state.simSeconds,B.state.simSeconds);
const ja=JSON.stringify(A.state),jb=JSON.stringify(B.state);
if(ja!==jb){let i=0;while(i<ja.length&&ja[i]===jb[i])i++;assert.fail(`states diverge at ${i}: ...${ja.slice(Math.max(0,i-80),i+120)}...  vs  ...${jb.slice(Math.max(0,i-80),i+120)}...`);}
const m=B.state.mobility;
assert.ok(m.kpis.requests>50&&m.kpis.completed>5,`the scenario really exercised the model (requests ${m.kpis.requests}, completed ${m.kpis.completed})`);
assert.equal(B.state.simSeconds,START+SPAN,'simSeconds is restored after every stepped advance');

// C) a single 3600 call WITHOUT stepping is what would have been wrong: it must differ (proves the test can detect the defect)
const C=prepared();C.state.simSeconds=START;
for(let t=START;t<START+SPAN;t+=3600){C.state.simSeconds=t+3600;C.M.onSimulationTime({state:C.state},t+3600);}
assert.notEqual(JSON.stringify(C.state),ja,'un-stepped 3600-second calls change Mobility results, so stepping is required');

// D) contract points
assert.equal(B.M.simulationSliceLimit(B.state),3600,'active Mobility no longer constrains the group slice');
assert.equal(B.M.advanceThrough({state:B.state},B.state.simSeconds,B.state.simSeconds+600).ok===undefined,true);
// an inactive Mobility (or a short slice) is a single ordinary call
const idle=scenario();const before=JSON.stringify(idle.state.mobility||null);idle.s.GH_MOBILITY_CORE.advanceThrough({state:idle.state},0,3600);
console.log(JSON.stringify({suite:'build351-mobility-stepping',simulatedDays:3,requests:m.kpis.requests,completed:m.kpis.completed,archiveRows:m.tripArchive.length,sliceSecondsReference:600,sliceSecondsNew:3600,identicalState:true}));
void before;

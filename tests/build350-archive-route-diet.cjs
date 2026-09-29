'use strict';
// Build 350: archived mobility trips no longer carry the ~9 KB OSRM polyline. Active trips keep it; every other field of the
// archived row, and every effect of completing/cancelling a trip, is unchanged. Rows archived by older builds are compacted.
const assert=require('node:assert/strict');
const path=require('node:path');
const ROOT=process.env.GH_TEST_SOURCE_DIR||path.resolve(__dirname,'..');
process.env.GH_TEST_SOURCE_DIR=ROOT;
const {scenario}=require(path.join(ROOT,'tests/helpers/business-scenario'));
const env=scenario(),{state,s,command}=env,M=s.GH_MOBILITY_CORE;

command('corporate','open-company',{type:'mobility',capital:500000000,legalName:'Test Mobility'});
state.customHubs.push({id:'MOB-CENTER-RUH',name:'Riyadh',kind:'mobility-center',ownerCompanyId:'mobility',owned:true,capitalId:'RUH',city:'Riyadh',country:'Saudi Arabia',coords:[24.7,46.7],bays:120});
M.ensure(state);state.mobility.capitalCenters.push({id:'MOB-CENTER-RUH',ownerCompanyId:'mobility',capitalId:'RUH',city:'Riyadh',country:'Saudi Arabia',coords:[24.7,46.7],facilityId:'MOB-CENTER-RUH'});
command('mobility','buy-fleet',{quantity:4,centerId:'RUH',classId:'eco-ev'});
const m=state.mobility,polyline=n=>({coordinates:Array.from({length:n},(_,i)=>[24.7+i*1e-4,46.7+i*1e-4]),distanceKm:10,source:'osrm'});
const trip=(id,v,extra)=>({id,ownerCompanyId:'mobility',requestId:'REQ-'+id,vehicleId:m.vehicles[v].id,driverId:m.drivers[v].id,centerId:'RUH',fromZone:'KAFD',toZone:'OLAYA',distanceKm:10,fare:100,route:polyline(400),routeLocked:true,routeVersion:3,routeSource:'OSRM',...extra});
for(const id of ['A','B','C'])m.rideRequests.push({id:'REQ-'+id,ownerCompanyId:'mobility',status:'active',centerId:'RUH',fromZone:'KAFD',toZone:'OLAYA',fare:100});
const completing=trip('A',0,{routeVerified:true,dueAt:1}),expiring=trip('B',1,{routeVerified:false,routingDeadlineAt:1,dueAt:null}),staying=trip('C',2,{routeVerified:true,dueAt:99999999});
const beforeFields=Object.fromEntries([completing,expiring].map(t=>[t.id,Object.keys(t).filter(k=>k!=='route')]));
m.activeTrips.push(completing,expiring,staying);
for(const i of [0,1,2]){m.vehicles[i].status='moving';m.drivers[i].status='on-trip';}
m.tripArchive.push(trip('OLD1',3,{status:'completed',completedAt:0,routeVerified:true}),trip('OLD2',3,{status:'completed',completedAt:0,routeVerified:true}));
assert.ok(m.tripArchive.every(r=>r.route),'precondition: a legacy archive still carries polylines');

M.onSimulationTime({state},2000);

const archive=Object.fromEntries(m.tripArchive.map(r=>[r.id,r]));
assert.deepEqual(Object.keys(archive).sort(),['A','B','OLD1','OLD2']);
for(const row of Object.values(archive))assert.ok(!Object.prototype.hasOwnProperty.call(row,'route'),`archived ${row.id} must not carry a route`);
// everything else about the archived rows is kept, including the route metadata and the outcome fields
for(const id of ['A','B'])for(const key of beforeFields[id])assert.ok(key in archive[id],`archived ${id} keeps ${key}`);
assert.equal(archive.A.status,'completed');assert.equal(archive.A.routeVerified,true);assert.equal(archive.A.routeVersion,3);assert.equal(archive.A.routeSource,'OSRM');assert.equal(archive.A.distanceKm,10);assert.ok(Number.isFinite(archive.A.driverPayout)&&Number.isFinite(archive.A.platformRevenue));
assert.equal(archive.B.status,'cancelled');assert.ok(archive.B.cancelReason);
// the still-active trip keeps its polyline untouched; economic effects of completing a trip are unchanged
const active=m.activeTrips.find(t=>t.id==='C');assert.equal(active.route.coordinates.length,400);
assert.equal(state.tripProfitAccrued.mobility,74);assert.equal(state.finance.pendingDailyCash.mobility,74);assert.equal(m.kpis.completed,1);
// idempotent: a second ensure/tick changes nothing
const digest=JSON.stringify(m);M.ensure(state);assert.equal(JSON.stringify(m),digest,'ensure() is idempotent once compacted');
// the compacted state still passes the game's own schema and company-platform validation and reloads
assert.equal(s.GH_COMPANY_PLATFORM.validateState(state).ok,true);
const reloaded=s.GH_COMPANY_PLATFORM.migrateState(JSON.parse(JSON.stringify(state)));assert.equal(reloaded.errors.length,0,reloaded.errors.join(','));

// scale: 1,200 archived trips of ~9 KB polylines used to cost ~10 MB; now the archive is a small fraction of that
const perRowWithRoute=JSON.stringify(trip('X',0,{status:'completed'})).length;
const big=[];for(let i=0;i<1200;i++)big.push(trip('BIG'+i,0,{status:'completed',completedAt:i,routeVerified:true}));
m.tripArchive=big;M.ensure(state);
const bytes=JSON.stringify(m.tripArchive).length;
assert.ok(bytes<1200*1500,`1,200 archived rows must be small (got ${bytes} bytes)`);
assert.ok(perRowWithRoute>6000,'the synthetic polyline is realistic in size');
console.log(JSON.stringify({suite:'build350-archive-route-diet',archivedRows:1200,bytesBefore:1200*perRowWithRoute,bytesAfter:bytes,reduction:+(1-bytes/(1200*perRowWithRoute)).toFixed(3)}));

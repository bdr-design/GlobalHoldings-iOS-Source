'use strict';
const assert=require('node:assert/strict');
const MOBILITY=require('../WebApp/mobility-core.js');
const COLD=require('../WebApp/cold-archive-core.js');

class MemoryArchive{
  constructor(){this.data=new Map();}
  async read(key){return this.data.has(key)?this.data.get(key):null;}
  async writeAtomic(key,value){this.data.set(key,value);}
  async remove(key){this.data.delete(key);}
  async keys(){return [...this.data.keys()];}
}

(async()=>{
  const state={simSeconds:1,openedCompanies:['mobility'],mobility:{
    ownerCompanyId:'mobility',routeSchemaVersion:3,vehicles:[{id:'V-1',ownerCompanyId:'mobility',centerId:'RUH',zoneId:'KAFD',status:'available',totalTrips:0,totalKm:0,battery:100}],
    drivers:[],rideRequests:[],activeTrips:Array.from({length:2401},(_,index)=>({id:`TRIP-${String(index).padStart(5,'0')}`,ownerCompanyId:'mobility',vehicleId:`V-${index}`,driverId:`D-${index}`,centerId:'RUH',fromZone:'KAFD',toZone:'OLAYA',dueAt:1,duration:60,distanceKm:4,fare:100,routeVerified:true,progress:1})),
    tripArchive:Array.from({length:1200},(_,index)=>({id:`OLD-${String(index).padStart(5,'0')}`,ownerCompanyId:'mobility',status:'completed'})),tripArchivePending:[],events:[],capitalCenters:[],kpis:{completed:0,grossBookings:0,driverPayouts:0,platformRevenue:0},kpisByCenter:{},streetRoutes:{}
  }};
  const result=MOBILITY.onSimulationTime({state},1),mobility=state.mobility;
  assert.equal(result.activeTrips,0);
  assert.equal(mobility.tripArchive.length,1200,'the hot trip history remains bounded');
  assert.equal(mobility.tripArchivePending.length,2401,'every displaced old or newly completed trip stays in the durable offload queue');
  assert.equal(new Set(mobility.tripArchivePending.map(row=>row.id)).size,2401,'pending archive contains no duplicate trip IDs');
  assert.equal(mobility.kpis.completed,2401);
  assert.equal(mobility.kpis.grossBookings,240100,'archiving does not change trip revenue');
  assert.equal(mobility.kpis.driverPayouts,24010,'archiving does not change driver payroll');
  assert.equal(mobility.kpis.platformRevenue,177674,'archiving does not change platform economics');

  const adapter=new MemoryArchive(),archive=COLD.create({adapter,bucket:'mobility-trip-receipts-e9',idFor:row=>row.id}),batch=mobility.tripArchivePending.slice(0,128);
  await archive.append(batch);
  const afterDurableWriteBeforeAck=await archive.metadata();assert.equal(afterDurableWriteBeforeAck.count,128);
  await archive.append(batch);
  assert.equal((await archive.metadata()).count,128,'a crash/retry before state acknowledgement is idempotent');
  assert.deepEqual(await archive.readAll(),batch,'cold reads return verified original trip records');
  console.log('Build342 Mobility receipt archive: bounded hot window, durable overflow queue, stable-ID retry and unchanged economics PASS');
})().catch(error=>{console.error(error);process.exitCode=1;});

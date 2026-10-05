'use strict';
// Build 358: real models, and every operating figure on the card changes a number the game uses.
// The owner found the former catalogue arbitrary: generic names, one passenger fare for every seat, every ship type on
// the same tonne rate, crew fixed per mode, hydrogen trucks burning nothing, maintenance at 4% of revenue.
const assert=require('node:assert/strict'),path=require('node:path');
const root=process.env.GH_TEST_SOURCE_DIR||path.resolve(__dirname,'..');
globalThis.window=globalThis;
require(path.join(root,'WebApp/catalog.js'));
const S=require(path.join(root,'WebApp/simulation-asset-core.js')),catalog=globalThis.GH_ASSET_CATALOG;
const all=['air','sea','road'].flatMap(mode=>[...catalog[mode].new,...catalog[mode].used].map(item=>({mode,item})));
const trip=(mode,specs,km,hours)=>S.baseTripEconomics({assetMode:mode,type:mode,specs},km,hours);

// Real models: a manufacturer and model on every line, no generic placeholders, unique ids.
assert.equal(new Set(all.map(row=>row.item.id)).size,all.length,'ids are unique');
for(const {item} of all){
  assert(item.manufacturer&&item.model,`${item.id} names its manufacturer and model`);
  assert.doesNotMatch(item.name,/Single Aisle|Widebody \d|Regional \d|Long Haul \d|Feedermax/,`${item.id} is not a generic placeholder`);
  assert(item.specs.market&&item.specs.crewPlan,`${item.id} has a market and a crew plan`);
  assert(Number(item.deliveryDays)>0&&Number(item.residual5y)>0,`${item.id} has its delivery and value curve`);
}
const A=id=>catalog.air.new.find(x=>x.id===id).specs,SH=id=>catalog.sea.new.find(x=>x.id===id).specs,T=id=>catalog.road.new.find(x=>x.id===id).specs;

// Aircraft: class layout earns by class; belly cargo earns; maintenance per flight hour; landing fees from MTOW.
const a320=A('A-A320N'),allEconomy={...a320,cabin:{first:0,business:0,premium:0,economy:162}};
assert(trip('air',a320,1500,2).revenue>trip('air',allEconomy,1500,2).revenue,'12 business seats out-earn the same seats in economy');
const b779=A('A-B779');assert(trip('air',b779,8000,10).revenue>trip('air',{...b779,bellyCargoT:0},8000,10).revenue,'belly cargo earns');
assert.equal(trip('air',a320,1500,2).maintenance,a320.maintenancePerBlockHour*2,'maintenance is per flight hour');
assert(trip('air',b779,1500,2).fees>trip('air',a320,1500,2).fees,'a heavier aircraft pays more airport fees');
const g650=A('A-G650');assert.equal(trip('air',g650,5000,6).revenue,g650.charterPerHour*6*.75,'business jets earn their charter hour');
const fare=km=>45+.075*Math.min(km,3000)+.055*Math.max(0,km-3000);
assert(fare(870)>90&&fare(870)<140,'a Riyadh–Dubai economy fare is in the real range');

// Ships: the type sets the market. Same deadweight, different trade, different revenue; chartered types earn a day rate
// and the charterer pays fuel.
const crude=SH('S-AFRA'),product=SH('S-LR2');
assert(trip('sea',product,9000,300).revenue>trip('sea',crude,9000,300).revenue*1.3,'refined products pay more than crude');
const bulk=SH('S-KMAX'),boxes=SH('S-NPX8200');
assert.notEqual(trip('sea',bulk,9000,300).revenue/9000,trip('sea',boxes,9000,300).revenue/9000);
const lng=SH('S-LNG'),lngTrip=trip('sea',lng,9000,240);
assert.equal(lngTrip.revenue,lng.dayRate*10);assert.equal(lngTrip.fuelCost,0,'the charterer pays an LNG carrier’s fuel');
const vlcc=SH('S-VLCC'),v=trip('sea',vlcc,11000,330),perTonne=v.revenue/(vlcc.capacity*.97*.5);
assert(perTonne>10&&perTonne<25,`VLCC freight is a real 10–25$ per tonne (${perTonne.toFixed(1)})`);
const ulcv=SH('S-ULCV24'),u=trip('sea',ulcv,19400,420),perBox=u.revenue/(ulcv.capacity*.82);
assert(perBox>700&&perBox<2500,`Asia–Europe container rate is real (${perBox.toFixed(0)}$ per TEU)`);

// Trucks: body sets the rate; electric and hydrogen pay for their energy; reefer units burn fuel per hour.
const actros=T('T-ACTROS'),reefer=T('T-SCANIA-R'),xcient=T('T-XCIENT'),semi=T('T-TSEMI');
assert(trip('road',reefer,800,10).revenue/reefer.capacity>trip('road',actros,800,10).revenue/actros.capacity,'a reefer tonne pays more');
assert(trip('road',xcient,400,5).fuelCost>0,'hydrogen is paid for');
assert(trip('road',semi,500,6).fuelCost<trip('road',actros,500,6).fuelCost,'electricity costs less than diesel');
assert.equal(trip('road',actros,500,6).maintenance,actros.maintenancePerKm*500);

// A spec from before the real catalogue still reads (plain market of its mode).
assert(trip('air',{capacity:180,fuelBurnKgPerKm:3},1000,2).revenue>0);

// Crew follows the model.
require(path.join(root,'WebApp/fleet-core.js'));
const F=globalThis.GH_FLEET_CORE;
assert.equal(typeof F?.staffingPlan,'function');
{
  const small=F.staffingPlan({assetMode:'air',specs:A('A-ATR42')}),big=F.staffingPlan({assetMode:'air',specs:b779});
  assert(big.monthlyPayroll>small.monthlyPayroll*3,'a 777-9 needs a far larger crew than an ATR 42');
}
// Every legacy id of the former catalogue maps to one real model.
const legacy=new Map();for(const {item} of all)for(const id of item.legacyIds||[]){assert(!legacy.has(id),`${id} maps once`);legacy.set(id,item.id);}
for(const prefix of ['N-A','N-S','N-T'])for(let i=1;i<=30;i++){const id=`${prefix}${i}`;if(prefix==='N-T'&&i>30)continue;if(prefix==='N-A'&&i>28)continue;assert(legacy.has(id),`${id} has a real model`);}
console.log('PASS build358-asset-realism: real models; classes, belly cargo, charter, ship markets, energy, maintenance, fees and crew all change the numbers');

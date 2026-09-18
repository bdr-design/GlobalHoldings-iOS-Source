'use strict';
const assert=require('assert'),fs=require('fs');
const {harness,minimal}=require('./helpers/core-harness');

const {s}=harness(['transaction-core','domain-command-core','route-core','fleet-core','save-schema']);
const F=s.GH_FLEET_CORE,S=s.GH_SAVE_SCHEMA;
const staffing={mode:'automatic-fixed',ready:true,roles:[],total:1,monthlyPayroll:1};
const route=(id,type='road')=>({id,type,company:type,name:id,from:'A',to:'B',fromFacility:`BASE-${type}`,toFacility:`PUBLIC-${type}`,route:[[24.7,46.6],[25.2,47.1]],distanceKm:90,maxLegKm:90,effectiveSpeedKmh:60,tripSeconds:5400,dwellHours:1});
const asset=(id,type='road')=>({id,name:id,type,baseFacility:`BASE-${type}`,phase:'idle',progress:0,fuel:100,condition:100,deliveryStatus:'delivered',salePending:false,routeId:null,routeSlot:null,departureScheduled:false,staffing});
const assignment=(row,r)=>({id:row.id,routeId:r.id,baseFacility:row.baseFacility,phase:'turnaround',route:r});

// The complete batch is prepared before any live asset is mutated. The 65th
// truck therefore rejects the whole request instead of leaving 64 partial
// assignments behind.
const roadRoute=route('ROAD-FLEET'),roadAssets=Array.from({length:65},(_,index)=>asset(`ROAD-${String(index).padStart(3,'0')}`));
const roadState={customRoutes:[roadRoute],assets:roadAssets,advanced:{},crew:[],sequences:{},simSeconds:0};
assert.strictEqual(F.routeCapacity('road'),64);assert.strictEqual(F.routeCapacity('sea'),24);assert.strictEqual(F.routeCapacity('air'),1);
assert.throws(()=>F.execute({state:roadState},'assign-routes-batch',{assignments:roadAssets.map(row=>assignment(row,roadRoute))}),/asset-route-capacity/);
assert(roadAssets.every(row=>row.routeId===null&&row.phase==='idle'),'capacity failure partially assigned the road fleet');

const assigned=F.execute({state:roadState},'assign-routes-batch',{assignments:roadAssets.slice(0,64).map(row=>assignment(row,roadRoute))});
assert.strictEqual(assigned.length,64);assert.deepStrictEqual([...assigned.map(row=>row.routeSlot)].sort((a,b)=>a-b),Array.from({length:64},(_,index)=>index));
const departed=F.execute({state:roadState},'depart-batch',{departures:assigned.map(row=>({id:row.id,route:roadRoute,load:'اختبار',delaySeconds:F.departureDelay(row)}))});
assert.strictEqual(departed.filter(row=>row.phase==='moving').length,1);assert.strictEqual(departed.filter(row=>row.phase==='turnaround'&&row.departureScheduled).length,63);assert.strictEqual(departed.at(-1).dwellRemaining,63*15);

// A genuinely large fleet remains one atomic command: 640 trucks need ten
// route geometries, not 640 persisted routes or 1,280 sequential UI commands.
const scaleRoutes=Array.from({length:10},(_,index)=>({...route(`ROAD-SCALE-${index}`),toFacility:`PUBLIC-SCALE-${index}`,to:`B${index}`,route:[[24.7,46.6],[25+index*2,47+index*2]]})),scaleAssets=Array.from({length:640},(_,index)=>asset(`SCALE-${String(index).padStart(4,'0')}`)),scaleState={customRoutes:scaleRoutes,assets:scaleAssets,advanced:{},crew:[],sequences:{},simSeconds:0};
const scaleAssignments=scaleAssets.map((row,index)=>assignment(row,scaleRoutes[Math.floor(index/64)]));F.execute({state:scaleState},'assign-routes-batch',{assignments:scaleAssignments});
assert.strictEqual(new Set(scaleAssets.map(row=>row.routeId)).size,10);assert(scaleRoutes.every(routeRow=>scaleAssets.filter(row=>row.routeId===routeRow.id).length===64));
F.execute({state:scaleState},'depart-batch',{departures:scaleAssets.map(row=>({id:row.id,route:scaleRoutes.find(routeRow=>routeRow.id===row.routeId),delaySeconds:F.departureDelay(row)}))});
assert.strictEqual(scaleAssets.filter(row=>row.phase==='moving').length,10);assert.strictEqual(scaleAssets.filter(row=>row.departureScheduled).length,630);

const seaRoute=route('SEA-FLEET','sea'),seaAssets=Array.from({length:25},(_,index)=>asset(`SEA-${index}`,'sea')),seaState={customRoutes:[seaRoute],assets:seaAssets,advanced:{},crew:[],sequences:{}};
assert.throws(()=>F.execute({state:seaState},'assign-routes-batch',{assignments:seaAssets.map(row=>assignment(row,seaRoute))}),/asset-route-capacity/);assert(seaAssets.every(row=>row.routeId===null));
F.execute({state:seaState},'assign-routes-batch',{assignments:seaAssets.slice(0,24).map(row=>assignment(row,seaRoute))});assert.strictEqual(F.departureDelay(seaAssets[23]),23*60);

// Aviation separation remains exactly as before: neither route-id reuse nor
// the shared-fleet capacity path is available to a second aircraft.
const airRoute=route('AIR-EXCLUSIVE','air'),airState={customRoutes:[airRoute],assets:[asset('AIR-1','air'),asset('AIR-2','air')],advanced:{},crew:[],sequences:{}};
F.execute({state:airState},'assign-route',assignment(airState.assets[0],airRoute));
assert.throws(()=>F.execute({state:airState},'assign-route',assignment(airState.assets[1],airRoute)),/asset-route-exclusive/);

const barrierRoute=route('ROAD-BARRIER'),barrierLive={customRoutes:[barrierRoute],assets:[asset('BARRIER-LIVE')],advanced:{},crew:[],sequences:{},simSeconds:0},barrierDraft=structuredClone(barrierLive),barrierPayload=assignment(barrierDraft.assets[0],barrierRoute);
s.__GH_DURABLE_COMMAND_CONTEXT__={name:'test',liveState:barrierLive,draft:barrierDraft};
assert.throws(()=>s.GH_DOMAIN_COMMANDS.dispatch({state:barrierLive},'fleet','assign-route',barrierPayload),/Durable state command is in progress/);
assert.doesNotThrow(()=>s.GH_DOMAIN_COMMANDS.dispatch({state:barrierDraft},'fleet','assign-route',barrierPayload));delete s.__GH_DURABLE_COMMAND_CONTEXT__;

// Save migration and validation use the same capacities as Fleet Core. This is
// the persistence boundary that previously rejected every shared road/sea save.
const save={...minimal(),customRoutes:[roadRoute],routeEndpoints:{},routeCache:{},assets:Array.from({length:64},(_,index)=>({...asset(`LEGACY-${index}`),routeId:roadRoute.id,phase:'turnaround'}))};
const migrated=S.migrateLegacy(save);assert(migrated.changed);assert.strictEqual(migrated.state.assets.filter(row=>row.routeId===roadRoute.id).length,64);assert.strictEqual(new Set(migrated.state.assets.map(row=>row.routeSlot)).size,64);assert(S.validate(migrated.state).ok,S.validate(migrated.state).errors.join(','));
const over={...migrated.state,assets:[...migrated.state.assets,{...asset('OVER'),routeId:roadRoute.id,routeSlot:64,phase:'turnaround'}]};assert(S.validate(over).errors.includes('asset-route-capacity'));

const app=fs.readFileSync('WebApp/app.js','utf8'),domain=fs.readFileSync('WebApp/domain-command-core.js','utf8'),planner=fs.readFileSync('WebApp/road-planner.js','utf8');
assert(app.includes('let durableCommandInProgress=false')&&app.includes('finally{release();}'),'UI operations must release their busy state on every outcome');
assert(app.includes('durableCommandInProgress||window.GH_PERSISTENCE.isLocked()'),'simulation must pause behind the durable command barrier');
assert(domain.includes('__GH_DURABLE_COMMAND_CONTEXT__')&&domain.includes('durable?.liveState===state'),'live commands must not overlap a durable draft');
assert(planner.includes('DEFAULT_ROUTE_CAPACITY=64')&&planner.includes('plannedShared'),'road planning must scale by fleet routes rather than one geometry per truck');
assert(!/Math\.random\s*\(/.test(app),'button locking must not reintroduce nondeterministic business randomness');

console.log('BUILD314 shared fleet routes + durable UI lock: PASS');

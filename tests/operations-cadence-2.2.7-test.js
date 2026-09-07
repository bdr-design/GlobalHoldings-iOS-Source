const fs=require('fs');
const vm=require('vm');
const assert=require('assert');

// Realism delivery must be slice-time based and work for all three mobile asset companies.
const realismSrc=fs.readFileSync('WebApp/realism-core.js','utf8');
const sandbox={window:{},globalThis:null,structuredClone:global.structuredClone,console,module:{exports:{}}};sandbox.globalThis=sandbox;sandbox.window=sandbox;
for(const file of ['transaction-core.js','domain-command-core.js','fleet-core.js','corporate-core.js','operations-core.js'])vm.runInNewContext(fs.readFileSync(`WebApp/${file}`,'utf8'),sandbox,{filename:file});
vm.runInNewContext(realismSrc,sandbox,{filename:'realism-core.js'});
const R=sandbox.GH_REALISM;
assert(R&&typeof R.onSimulationTime==='function','Realism Core must expose onSimulationTime delivery cadence');
const state={simSeconds:1000,profile:{riskAppetite:'balanced'},companyRegistry:{air:{legalName:'AirCo'},sea:{legalName:'SeaCo'},road:{legalName:'RoadCo'}},companyFinance:{},finance:{receivables:[],payables:[]},assets:[],leasedAssets:[],alerts:[],groupValue:0,globalBases:[
  {id:'AIR-HUB',kind:'airport-base',company:'air',owned:true,name:'Air Hub'},
  {id:'SEA-HUB',kind:'port-base',company:'sea',owned:true,name:'Sea Hub'}
],customHubs:[{id:'ROAD-HUB',kind:'depot',company:'road',owned:true,name:'Road Hub'}]};
R.migrate(state);state.finance.invoices=[];
for(const [type,baseId,name] of [['air','AIR-HUB','A1'],['sea','SEA-HUB','S1'],['road','ROAD-HUB','R1']]){state.finance.invoices.push({number:'INV-'+type,status:'مدفوعة',company:type,amount:1000});state.realism.procurement.deliveries.push({id:'D-'+type,status:'pending',payment:{kind:'invoice',ref:'INV-'+type,company:type,amount:1000},type,baseId,dueAtSeconds:999,asset:{id:name,type,name,ownership:'cash',purchasePrice:1000}});}
R.onSimulationTime(state,1000);
assert.equal(state.assets.length,3,'All due assets must enter fleet without waiting for a day boundary');
assert.deepStrictEqual(state.assets.map(a=>a.baseFacility).sort(),['AIR-HUB','ROAD-HUB','SEA-HUB'].sort(),'Delivered assets must land at their owned compatible bases');

// Missing approved base must stop visibly; silent re-routing is forbidden.
state.realism.procurement.deliveries.push({id:'D-recover',status:'pending',type:'air',baseId:'REMOVED',dueAtSeconds:1000,asset:{id:'A2',type:'air',name:'A2',ownership:'cash',purchasePrice:1000}});
R.onSimulationTime(state,1000);
assert.equal(state.assets.find(a=>a.id==='A2'),undefined,'Delivery must not silently move to another base');
assert.equal(state.realism.procurement.deliveries.find(d=>d.id==='D-recover').blockedReason,'approved-destination-missing-or-full','Blocked delivery must retain explicit exact-destination reason');

// Business AI must be simulation-time deterministic; diagnostics may remain wall-clock supervised.
const app=fs.readFileSync('WebApp/app.js','utf8');
assert(!app.includes('REALTIME_AI_REVIEW_MS'),'AI business cadence must not use wall-clock realtime supervision');
assert(app.includes('window.GH_ADVANCED.proactiveReview(advCtx,true,null,hour)'),'AI must review on simulation-hour boundaries');
assert(app.includes('REALTIME_HEALTH_MS=10000'),'Diagnostics realtime cadence missing');
assert(app.includes('GH_REALISM.onSimulationTime(state,simMeta.to)'),'Asset delivery must be committed inside atomic slices');
assert(app.includes("'ai','submit'")&&app.includes('`AI-FUND-${number}`')&&app.includes('createdDay:state.lastFinancialDay'),'Payroll funding must be submitted through the AI owner and remain visible in approvals center');

// Diagnostics clear must truly reset the event log and avoid immediate render-side re-population.
const diagSrc=fs.readFileSync('WebApp/diagnostics-core.js','utf8');
const ds={window:{},globalThis:null,navigator:{},document:{},console,module:{exports:{}}};ds.globalThis=ds;ds.window=ds;
vm.runInNewContext(diagSrc,ds,{filename:'diagnostics-core.js'});
const D=ds.GH_DIAGNOSTICS;
const dstate={simSeconds:12,speed:1,cash:1,debt:0,groupValue:1,assets:[],finance:{companyBooks:{},receivables:[],payables:[],invoices:[],cheques:[]},diagnostics:{events:[{type:'OLD',severity:'critical'}],counters:{OLD:1},lastHealth:{status:'critical'}}};
D.clear(dstate);
assert.equal(dstate.diagnostics.events.length,0,'Diagnostics clear must empty events');
assert.equal(dstate.diagnostics.lastHealth,null,'Diagnostics clear must clear cached health result');
assert.deepStrictEqual(Object.keys(dstate.diagnostics.counters),[],'Diagnostics clear must reset counters');
console.log('Operations cadence + delivery + AI + diagnostics 2.3.9: PASS');

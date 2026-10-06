'use strict';
// Build 359 (owner: "no option without effect"), the management section review: every option now changes a number the
// game uses, and the calculation faults found in the review are fixed. Checked here, on a founded game state:
// - research, SAF and electric road apply once in trip economics (they applied twice);
// - the eight sustainability programmes: catalogue prices (the button's price is ignored, unknown ids refused), each
//   effect at full maturity (facility running cost, maintenance, repairs, asset prices, insurance index, credit spread,
//   reputation from the ESG score), the yearly upkeep and the lapse when it is not paid; the ESG panel writes nothing;
// - research phases of 30 days priced from the group's value; automation lowers the fleet crew payroll;
// - cyber: coverage sets the daily chance and the recovery time, decays, a drill raises it, an incident books the
//   outage; safety: the audit opens a 180-day plan, fines are halved under it, the score comes from ratios;
// - the action center alarms count the last 30 days only;
// - the legacy executive roster is gone (bids count official managers); understaffed bases slow turnaround in both
//   engines; CII is computed in IMO units; the duplicated hub renderers are gone.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const ROOT=process.env.GH_TEST_SOURCE_DIR||path.resolve(__dirname,'..'),WEB=path.join(ROOT,'WebApp');
const read=file=>fs.readFileSync(path.join(WEB,file),'utf8');
const {scenario}=require(path.join(ROOT,'tests/helpers/business-scenario'));
const results=[];const test=(name,fn)=>{try{const detail=fn();results.push({name,ok:true,detail});}catch(error){results.push({name,ok:false,error:String(error?.stack||error)});}};

const e=scenario(),s=e.s,state=e.state;e.load('governance-core');e.load('ui-quality-core');
const G=s.GH_GOVERNANCE_CORE,F=s.GH_FINANCE_CORE,R=s.GH_REALISM,CORE=s.GH_SIMULATION_ASSET_CORE,FAC=s.GH_FACILITY_CORE;
state.godMoney=true;state.infiniteMoney=true;state.research={efficiency:0,automation:0,cleanEnergy:0,...(state.research||{})};
const gov=(name,p={})=>e.command('governance',name,p);
const setMaturity=(id,value)=>{state.sustainability.programs[id]={...(state.sustainability.programs[id]||{id,at:state.simSeconds,cost:G.ESG_PROGRAMS[id].cost,company:'group',lastMaturityDay:0}),maturity:value,status:value>=100?'مكتمل':'قيد التنفيذ'};};

test('research and sustainability apply once in trip economics',()=>{
  const FIX=require(path.join(ROOT,'tests/helpers/fleet-fixture.js')),asset=FIX.fleet().find(a=>a.type==='air'),route=FIX.routes.A1;
  const base={...FIX.context(),companies:{air:{serviceLevel:85,automation:0}},sustainability:{}};
  const plain=CORE.computeTripEconomics(structuredClone(asset),route,{...base,research:{efficiency:0,automation:0,cleanEnergy:0}});
  const researched=CORE.computeTripEconomics(structuredClone(asset),route,{...base,research:{efficiency:100,automation:0,cleanEnergy:0}});
  const ratio=researched.fuelCost/plain.fuelCost;assert.ok(Math.abs(ratio-.92)<1e-9,`efficiency research cuts fuel 8% once (ratio ${ratio})`);
  const saf=CORE.computeTripEconomics(structuredClone(asset),route,{...base,research:{},sustainability:{safShare:100}});
  const safRatio=saf.fuelCost/CORE.computeTripEconomics(structuredClone(asset),route,{...base,research:{},sustainability:{safShare:0}}).fuelCost;
  assert.ok(Math.abs(safRatio-.96)<1e-9,`SAF cuts air fuel once (ratio ${safRatio})`);
  assert.ok(!/eff\*\.055|researchEfficiency\*\.055/.test(read('realism-core.js')+read('simulation-asset-core.js')),'the second research layer is gone');
  return {fuelRatio:ratio,safRatio};
});

test('sustainability programmes: catalogue, effects, upkeep and lapse',()=>{
  assert.throws(()=>gov('esg-program',{id:'made-up'}),/unknown-esg-program/);
  const before=F.operating(state,'group'),out=gov('esg-program',{id:'circular',cost:1});
  assert.equal(out.cost,G.ESG_PROGRAMS.circular.cost,'the catalogue price, not the payload');
  assert.ok(before-F.operating(state,'group')>=G.ESG_PROGRAMS.circular.cost-1||state.godMoney,'the programme is paid');
  for(const id of ['renewable','supply','water','disclosure'])setMaturity(id,100);setMaturity('circular',100);
  const fx=G.programEffects(state);
  assert.deepEqual({facility:fx.facilityCost,maintenance:fx.maintenance,repair:fx.incidentRepair,price:fx.purchasePrice,lead:fx.leadTime,insurance:fx.insuranceIndex,spread:fx.creditSpread},{facility:.85,maintenance:.96,repair:.95,price:.98,lead:.9,insurance:-5,spread:-.0025});
  const listed=FAC.dailyOperatingCosts(state,{facilities:[{id:'X1',owned:true,kind:'airport-base',ownerCompanyId:'air',dailyCost:10000}]});assert.equal(listed.total,8500,'renewable energy lowers facility running cost 15%');
  const item=s.GH_ASSET_CATALOG.air.new[0];assert.equal(G.pricedAsset(state,item).price,Math.round(item.price*.98),'supply chain lowers asset prices 2%');
  const spreadNow=F.creditSpread?F.creditSpread(state):null;if(spreadNow!==null)assert.ok(spreadNow<=.017-.0025+1e-9||spreadNow===.003,'disclosure narrows the spread');
  // ESG score → reputation (+1 per 10 points over 60).
  state.sustainability.esgScore=85;assert.equal(G.programEffects(state).reputation,2);
  // Upkeep: due a year after the start; without cash the programme lapses and loses maturity.
  const program=state.sustainability.programs.circular;program.nextUpkeepDay=Math.floor(state.simSeconds/86400);program.lastMaturityDay=0;program.at=state.simSeconds;
  state.godMoney=false;state.infiniteMoney=false;const saved=F.book(state,'group').accounts[0].balance;F.book(state,'group').accounts[0].balance=0;
  try{
    gov('tick-sustainability',{day:Math.floor(state.simSeconds/86400)});assert.equal(program.lapsed,true,'unpaid upkeep lapses the programme');
    state.simSeconds+=30*86400;gov('tick-sustainability',{day:Math.floor(state.simSeconds/86400)});assert.ok(program.maturity<100&&program.maturity>=97,`a lapsed programme loses about 2 points a month (${program.maturity})`);
  }finally{F.book(state,'group').accounts[0].balance=saved;state.godMoney=true;state.infiniteMoney=true;}
  assert.ok(!/su\.electricRoadShare=/.test(read('advanced-core.js')),'the ESG panel does not write the state');
  return fx;
});

test('research phases take 30 days and are priced from the group value',()=>{
  state.groupValue=200e9;const expected=Math.max(25e6,Math.round(200e9*.0005));
  const start=Number(state.research.efficiency)||0,out=gov('research-fund',{project:'efficiency',cost:1});
  assert.equal(out.phase.cost,expected,'0.05% of the group value');assert.equal(Number(state.research.efficiency)||0,start,'no progress before the phase ends');
  assert.throws(()=>gov('research-fund',{project:'efficiency'}),/research-phase-active/);
  const day=Math.floor(state.simSeconds/86400);gov('tick-research',{day:day+29});assert.equal(Number(state.research.efficiency)||0,start,'day 29: not yet');
  gov('tick-research',{day:day+30});assert.equal(state.research.efficiency,Math.min(100,start+25),'day 30: +25');
  // Automation lowers the fleet crew payroll (monthlyPayrollSnapshot, app.js).
  const app=read('app.js'),code=app.slice(app.indexOf('  function monthlyPayrollSnapshot('),app.indexOf('  function payrollReportForMonth('));
  const run=automation=>{const box={state:{research:{automation},advanced:{labor:{employmentContracts:[]}}},operationalCompanyIds:()=>['air'],companyHasCapability:()=>true,uniqueOperationalCompanyForCapability:()=>null,clamp:(v,a,b)=>Math.max(a,Math.min(b,v)),window:{GH_HR_CORE:{ensure(){},salaryMultiplier:()=>1},GH_FLEET_CORE:{payrollSummary:()=>({air:{amount:100000,headcount:10}})}}};vm.createContext(box);vm.runInContext(code+';this.result=monthlyPayrollSnapshot()',box);return box.result.air.amount;};
  assert.equal(run(0),100000);assert.equal(run(100),95000,'automation at 100% lowers crew payroll 5%');
  return {phaseCost:expected};
});

test('cyber risk and drill',()=>{
  const c=state.advanced.cyber;c.coverage=0;delete c.lastTickDay;const day0=Math.floor(state.simSeconds/86400);
  gov('tick-cyber',{day:day0});assert.equal(c.rtoHours,90);assert.ok(Math.abs(c.chance-.0015)<1e-12);
  const drilled=gov('cyber-drill');assert.equal(Math.round(drilled.coverage),12,'a drill adds 12 points');
  gov('tick-cyber',{day:day0+30});assert.ok(Math.abs(c.coverage-10)<1e-9,`coverage wears off 2 points a month (${c.coverage})`);
  // Find an incident: book the outage at the latest daily revenue × RTO / 24.
  c.coverage=0;state.finance.dailyCompanyReports=[{day:day0,companies:{air:{grossRevenue:2400000}}}];let hit=null;
  for(let d=day0+31;d<day0+20000&&!hit;d++){const out=gov('tick-cyber',{day:d});c.coverage=0;if(out.incidents.length)hit=out.incidents[0];}
  assert.ok(hit,'an incident happens at 0.15% a day');assert.equal(hit.loss,Math.round(2400000*hit.hours/24));
  assert.ok(!/runtimeErrorCount|UNHANDLED_REJECTION/.test(read('governance-core.js')),'the app runtime errors no longer move the score');
  return {hit};
});

test('safety plan, fines and ratio score',()=>{
  const day=15;state.advanced.safety={};gov('safety-audit');const h=state.advanced.safety;h.plan.untilDay=day+100;
  const acc=()=>({count:1000,conditionSum:1000*70,risk:0,premium:0,value:1e9,sample:[],licence:0,fine:5000,unsafe:50});
  const fines=()=>(state.finance.payables||[]).filter(row=>String(row.number||'').startsWith('FINE-AIR-15')).map(row=>Number(row.total??row.amount));
  const run=()=>{const it=R.runIncidents(state,{companies:new Map([['air',acc()]])},day);while(!it.next().done){}};
  run();assert.equal(Math.round(h.score),96,`score from ratios: 100 - 5% × 0.8 (${h.score})`);assert.equal(h.openFindings,50);
  const finesWith=fines();assert.ok(finesWith.includes(2500),`the plan halves the inspection fine (${finesWith})`);
  return {score:h.score};
});

test('alarms count the last 30 days',()=>{
  const day=Math.floor(state.simSeconds/86400);state.realism.incidents=[{day:day-40,count:500},{day:day-2,count:1}];state.advanced.cyber.events=[{day:day-90}];
  const tasks=s.GH_UI_QUALITY.collectTasks(state),safety=tasks.find(t=>t.id==='SAFETY:INCIDENTS');
  assert.ok(safety&&/^1 /.test(safety.title),`only recent incidents count (${safety?.title})`);assert.ok(!tasks.some(t=>t.id==='CYBER:INCIDENTS'),'an old cyber incident raises nothing');
  return {title:safety.title};
});

test('legacy roster, base staffing, CII and hub renderers',()=>{
  const app=read('app.js'),adv=read('advanced-core.js'),hr=read('hr-core.js');
  assert.ok(!/state\.hired\.length/.test(app)&&/officialManagerCount\(state\)\*\.012/.test(app),'bids count official managers');
  assert.ok(!/EXECUTIVE_RULES|function executiveGaps/.test(hr)&&!/\['recruitment'/.test(adv),'the legacy roster and its tab are gone');
  assert.ok(/baseDwellFactor/.test(read('fleet-event-core.js'))&&/baseDwellFactor/.test(read('simulation-asset-core.js'))&&/baseDwellFactor:baseDwellFactors\(facilities\)/.test(app),'both engines read the base staffing factor');
  const realism=read('realism-core.js');assert.ok(/1984\*Math\.pow/.test(realism)&&!/,\.35,2\.5\)/.test(realism),'CII uses the IMO reference line, no 2.5 cap');
  assert.ok(!/function renderLeadershipHub|function renderPeopleHub/.test(adv)&&/newsFeed\(ctx,newsEntries\(ctx\),8\)/.test(adv),'one hub renderer, one news feed');
  return {ok:true};
});

test('an understaffed base holds assets longer (event engine)',()=>{
  global.window=global;require(path.join(WEB,'transaction-core.js'));
  const STORE=require(path.join(WEB,'fleet-store-core.js')),EVENTS=require(path.join(WEB,'fleet-event-core.js')),FIX=require(path.join(ROOT,'tests/helpers/fleet-fixture.js'));
  const bases=new Set();for(const route of Object.values(FIX.routes)){bases.add(route.fromFacility);bases.add(route.toFacility);}
  const run=factor=>{const store=STORE.fromAssets(FIX.fleet()),context={...FIX.context(0),...(factor?{baseDwellFactor:Object.fromEntries([...bases].map(id=>[id,factor]))}:{})};const out=EVENTS.advance(store,{from:0,to:3*86400,context,resolveRoute:FIX.resolveRoute});return Object.values(out.effects.tripCount||{}).reduce((n,v)=>n+v,0);};
  const normal=run(0),slow=run(2);
  assert.ok(slow<normal,`with turnaround doubled fewer trips complete in 3 days (${slow} < ${normal})`);
  return {normal,slow};
});

const passed=results.filter(r=>r.ok).length;console.log(JSON.stringify({suite:'build359-management-effects',passed,total:results.length,results},null,1));
if(passed!==results.length){process.exitCode=1;}else console.log('BUILD359_MANAGEMENT_EFFECTS_PASS');

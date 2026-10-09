'use strict';
// The expensive holdings close is split by item while remaining one domain
// command inside one daily-close transaction. The staged and synchronous paths
// must publish the same bytes, and an abort after a partial item must restore
// every finance/document/command root.
const assert=require('node:assert/strict'),path=require('node:path');
const fs=require('node:fs');
process.env.GH_TEST_SOURCE_DIR=process.env.GH_TEST_SOURCE_DIR||path.resolve(__dirname,'..');
const {scenario}=require('./helpers/business-scenario');

const {s,state}=scenario(),TX=s.GH_TRANSACTION_CORE,D=s.GH_DOMAIN_COMMANDS;
state.simSeconds=180*86400;state.lastFinancialDay=180;
state.simulationWorld=state.simulationWorld||{};
state.simulationWorld.competitors=[
  {id:'H1',name:'Holding One',sector:'لوجستيات',hq:'الرياض',price:100000000,revenue:200000000,ebitda:40000000,debt:0},
  {id:'H2',name:'Holding Two',sector:'بحري',hq:'دبي',price:50000000,revenue:90000000,ebitda:15000000,debt:0}
];
state.maPortfolio=[
  {id:'H1',name:'Holding One',stake:25,costBasis:1,acquiredDay:90,controlDay:null},
  {id:'H2',name:'Holding Two',stake:10,costBasis:1,acquiredDay:1,controlDay:null},
  {id:'MISSING',name:'Missing',stake:10,costBasis:1,acquiredDay:0,controlDay:null}
];
state.stakes={H1:25,H2:10,MISSING:10};
state.market=[{sym:'LIST',name:'Listed Holding',price:25,yield:4},{sym:'EMPTY',name:'Empty Holding',price:80,yield:3}];
state.portfolio={LIST:100};state.portfolioBook={LIST:{avgCost:20,acquiredDay:0,lastDividendPeriod:0,realizedIncome:0}};

const seed=TX.deepClone(state),direct=TX.deepClone(seed),staged=TX.deepClone(seed),actor={actor:'financial-close'};
const directTx=TX.execute(direct,{label:'qa-holdings-close',apply:()=>D.dispatchSystem({state:direct},'market','settle-holdings',{day:180},actor)});
assert.equal(directTx.committed,true);

const yielded=[];
const handle=TX.beginStaged(staged,{label:'qa-holdings-close',apply:function*(){
  const command=D.dispatchSystemStages({state:staged},'market','settle-holdings',{day:180},actor);
  for(;;){const step=command.next();if(step.done)return step.value;yielded.push(step.value);yield step.value;}
}});
while(!handle.done)handle.step(-Infinity);
assert.ifError(handle.error);assert.equal(handle.result.committed,true);
assert.deepEqual(handle.result.value,directTx.value,'staged command result differs from synchronous dispatch');
assert.equal(JSON.stringify(staged),JSON.stringify(direct),'staged command changed authoritative bytes or property order');
assert.deepEqual(yielded,[
  'market.holdings.private','market.holdings.private','market.holdings.private',
  'market.holdings.listed','market.holdings.listed'
]);
const committed=staged.domainRuntime.commands.filter(row=>row.domain==='market'&&row.name==='settle-holdings');
assert.equal(committed.length,1,'one close emitted more than one domain command');
assert.equal(committed[0].status,'committed');

const rollback=TX.deepClone(seed),rollbackBefore=JSON.stringify(rollback);
const failed=TX.beginStaged(rollback,{label:'qa-holdings-rollback',apply:function*(){
  const command=D.dispatchSystemStages({state:rollback},'market','settle-holdings',{day:180},actor),first=command.next();
  assert.equal(first.done,false);yield first.value;throw new Error('qa-failure-after-first-holding');
}});
while(!failed.done)failed.step(-Infinity);
assert.match(String(failed.error?.message),/qa-failure-after-first-holding/);
assert.equal(JSON.stringify(rollback),rollbackBefore,'partial staged holdings survived rollback');

assert.throws(()=>{
  const outside=D.dispatchSystemStages({state:rollback},'market','settle-holdings',{day:180},actor);outside.next();
},/requires-active-transaction/);

const app=fs.readFileSync(path.join(process.env.GH_TEST_SOURCE_DIR,'WebApp/app.js'),'utf8');
assert.ok(app.includes("dispatchSystemCommandStages({state},'market','settle-holdings'"),'daily close does not drive the staged holdings command');
assert.ok(!app.includes("phase('simulation.finance-day.holdings',()=>dispatchSystemCommand({state},'market','settle-holdings'"),'daily close still uses the blocking holdings command');

console.log('BUILD363_STAGED_HOLDINGS_COMMAND_PASS',JSON.stringify({yields:yielded.length,payouts:handle.result.value.result.payouts.length,listed:handle.result.value.result.listedDividends.length}));

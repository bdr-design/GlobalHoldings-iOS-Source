'use strict';
// Build 358, step 2 (finance): an acquisition paid hundreds of millions for a number. A stake in a listed competitor
// is now bought at its market value (a 25% control premium on the purchase that crosses 51%, 1.5% fees) from the
// holding's capex budget; below control it pays 40% of the target's net profit as a quarterly dividend, with control
// its profit is upstreamed monthly with synergies building over a year; it can be sold at market value. An old
// save's stake keeps earning.
const assert=require('node:assert/strict'),path=require('node:path');
process.env.GH_TEST_SOURCE_DIR=process.env.GH_TEST_SOURCE_DIR||path.resolve(__dirname,'..');
const {scenario}=require('./helpers/business-scenario');
const DAY=86400;

const {s,state,command}=scenario(),M=s.GH_MARKET_CORE,F=s.GH_FINANCE_CORE,TX=s.GH_TRANSACTION_CORE;
state.simulationWorld=state.simulationWorld||{};
state.simulationWorld.competitors=[{id:'C1',name:'NorthStar Logistics',sector:'لوجستيات',hq:'فرانكفورت',price:100000000,revenue:200000000,ebitda:40000000,debt:50000000},{id:'C9',name:'Old Target',sector:'بحري',hq:'دبي',price:50000000,revenue:80000000,ebitda:12000000,debt:0}];
state.simSeconds=10*DAY;s.GH_REALISM.migrate(state).economy.baseRate=.05;state.profile.creditRating='BBB';
F.execute({state},'raise-equity',{company:'group',amount:400000000,note:'تمويل QA'});
const ni=Math.max(0,(40000000*.75-50000000*.067)*.8);assert.equal(M.netIncome(state,state.simulationWorld.competitors[0]),ni);

// 1. Minority: market value plus fees; a quarterly dividend of 40% of profit.
const cash0=F.operating(state,'group');
const minority=command('market','buy-stake',{id:'C1',target:25});
assert.equal(minority.paid,Math.round(.25*100000000*1.015));assert.equal(minority.premium,0);assert.equal(F.operating(state,'group'),cash0-minority.paid);
assert.equal(state.stakes.C1,25);assert.throws(()=>command('market','buy-stake',{id:'C1',target:10}),/stake-target-invalid/);
assert.equal(command('market','settle-holdings',{day:99}).payouts.length,0,'no dividend before the quarter');
const q=command('market','settle-holdings',{day:100}).payouts;
assert.deepEqual(JSON.parse(JSON.stringify(q)),[{id:'C1',kind:'dividend',amount:Math.round(.25*ni*.4/4)}]);
assert.equal(command('market','settle-holdings',{day:100}).payouts.length,1,'the same day returns the same payout');
assert.equal(state.finance.invoices.filter(row=>row.reference==='DIV-C1-100'||row.number==='DIV-C1-100'||String(row.note).includes('أرباح موزعة من NorthStar')).length,1,'paid once');

// 2. Control: the purchase crossing 51% carries the premium; profit then comes up monthly with synergies.
const control=command('market','buy-stake',{id:'C1',target:51});
assert.equal(control.premium,.25);assert.equal(control.paid,Math.round(.26*100000000*1.25*1.015));assert.equal(control.controlDay,10);
const up=command('market','settle-holdings',{day:40}).payouts[0];
assert.equal(up.kind,'upstream');assert.equal(up.amount,Math.round(.51*(ni/12+200000000*.03*(30/365)/12)));

// 3. The capex budget binds the holding.
assert.throws(()=>command('finance','set-budget',{company:'group',limit:1000000000,lines:{capex:10000000}}),/budget-line-below-month-spend:capex/,'a line below what the month already spent is refused, not left broken');
const capexSpent=s.GH_FINANCE_CORE.budget(state,'group').spentByLine.capex;command('finance','set-budget',{company:'group',limit:1000000000,lines:{capex:capexSpent+10000000}});
assert.throws(()=>command('market','buy-stake',{id:'C1',target:100}),/insufficient-funds-or-budget/);
command('finance','reset-budget',{company:'group'});

// 4. Selling at market value less fees; the gain is against what was paid.
const sale=command('market','sell-stake',{id:'C1'});
assert.equal(sale.proceeds,Math.round(.51*100000000*.985));assert.equal(sale.gain,sale.proceeds-(minority.paid+control.paid));
assert.equal(state.stakes.C1,undefined);assert.equal(state.maPortfolio.length,0);

// 5. An old save's stake becomes a holding that earns.
state.stakes.C9=30;M.ensure(state);assert.deepEqual(JSON.parse(JSON.stringify(state.maPortfolio)),[{id:'C9',name:'',stake:30,costBasis:0,acquiredDay:0,controlDay:null}]);
assert.equal(command('market','settle-holdings',{day:90}).payouts[0].amount,Math.round(.3*12000000*.75*.8*.4/4));

// 6. The synchronous command drains the item-at-a-time generator without changing a result or any state byte.
{
  const seed=TX.deepClone(state);seed.maPortfolio.push({id:'MISSING',name:'Missing',stake:10,costBasis:1,acquiredDay:0,controlDay:null});seed.stakes.MISSING=10;
  seed.market=[{sym:'QA1',name:'Listed QA',price:25,yield:4},{sym:'QA0',name:'No holding',price:80,yield:3}];seed.portfolio={QA1:100};seed.portfolioBook={QA1:{avgCost:20,acquiredDay:0,lastDividendPeriod:0,realizedIncome:0}};
  const directState=TX.deepClone(seed),stagedState=TX.deepClone(seed),beforeStages=JSON.stringify(stagedState),direct=M.execute({state:directState},'settle-holdings',{day:180}),stages=M.settleHoldingsStages(stagedState,{day:180},F),yields=[];let step;
  assert.equal(JSON.stringify(stagedState),beforeStages,'creating the generator performs no work');
  while(!(step=stages.next()).done)yields.push(step.value);
  assert.deepEqual(step.value,direct,'the staged result is exact');assert.deepEqual(stagedState,directState,'the staged mutations and finance documents are exact');assert.equal(JSON.stringify(stagedState),JSON.stringify(directState),'serialized state and property order are exact');
  assert.deepEqual(yields,['market.holdings.private','market.holdings.private','market.holdings.listed','market.holdings.listed'],'one yield follows every private and listed item, including skipped items');
}

assert.equal(s.GH_SAVE_SCHEMA.validate(state).ok,true);
console.log('BUILD358_STAKES_PASS',JSON.stringify({minority:minority.paid,control:control.paid,dividend:q[0].amount,upstream:up.amount,sale:sale.proceeds}));

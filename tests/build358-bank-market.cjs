'use strict';
// Build 358, step 2 (markets): the bank no longer types its own rates. Deposits follow the market base rate under a
// pricing stance (competitive / market / conservative); a loan pays the base rate, its product spread and the
// borrower's expected loss; wholesale funding is priced like the group's own debt; liquidity yields by instrument and
// term. A higher base rate moves every one of them the next time it is read.
process.env.GH_TEST_SOURCE_DIR=process.env.GH_TEST_SOURCE_DIR||require('path').resolve(__dirname,'..');
const assert=require('node:assert/strict');
const {harness,minimal}=require('./helpers/core-harness');
const h=harness(['capability-registry-core','company-definitions','company-platform-core','identity-system','control-plane-core','authorization-core','document-proof-core','transaction-core','domain-command-core','save-schema','determinism-core','event-ledger-core','dependency-core','policy-core','lifecycle-core','delivery-monitor-core','realism-core','finance-core','hr-core','corporate-core','facility-core','banking-core','game-lifecycle-core']);
const {s}=h,d={...minimal(),profile:{name:'Bank Market'},bank:{},operations:{},crew:[],branches:[],hired:[],unlockedSectors:[],ownedCompanies:[]};
const state=s.GH_GAME_LIFECYCLE.pristine(d,1);
s.GH_GAME_LIFECYCLE.foundGroup(state,{mode:'sandbox',name:'Bank Market Group',founder:'Founder',locationId:'RUH'},d,{nextId:()=> 'FOUND-BM',simYear:()=>2026});
const run=(name,p)=>s.GH_DOMAIN_COMMANDS.dispatch({state},'banking',name,p).result,B=s.GH_BANKING_CORE,F=s.GH_FINANCE_CORE;
s.GH_DOMAIN_COMMANDS.dispatch({state},'corporate','open-company',{type:'bank',capital:400000000,legalName:'Bank Market'});
const economy=s.GH_REALISM.migrate(state).economy;economy.baseRate=.05;state.profile.creditRating='BBB';
const near=(a,b)=>Math.abs(a-b)<1e-9;

// 1. Deposits: a stance, not numbers; an old save's typed rates are replaced by the market's.
state.bank.depositPricing={sight:.19,savings:.19,term:.19};
const bank=B.ensure(state);assert.deepEqual(Object.keys(bank.depositPricing).sort(),['lastChangedAt','stance'],'the save keeps the stance only, never rates');assert.equal(bank.depositPricing.stance,'market');assert.ok(near(B.depositRates(state,'market').savings,Number((.05*.65).toFixed(4))));
assert.throws(()=>run('set-deposit-pricing',{savings:.2}),/bank-deposit-stance-invalid/);
const competitive=run('set-deposit-pricing',{stance:'competitive'});
assert.ok(near(competitive.savings,Number((.05*.65+.005).toFixed(4))));assert.ok(near(competitive.term,Number((.05*.90+.005).toFixed(4))));
economy.baseRate=.06;assert.ok(near(B.depositRates(state,B.ensure(state).depositPricing.stance).term,Number((.06*.90+.005).toFixed(4))),'deposit rates follow the base rate');

// 2. Loans: base + product spread + expected loss of the grade.
const corporate=B.PRODUCTS.corporate,bbb=B.RISK_GRADES.BBB;
assert.ok(near(B.loanRate(state,'corporate','BBB'),Math.round((.06+(corporate.rate-.046)+bbb.pd*bbb.lgd)*1e5)/1e5));
assert.ok(B.loanRate(state,'corporate','BB')>B.loanRate(state,'corporate','A'),'a riskier borrower pays more');

// 3. Wholesale funding is priced like the group's own debt; typed rate and lender are ignored.
const funding=run('raise-wholesale-funding',{amount:50000000,termDays:1095,rate:.001,lender:'QA'});
assert.equal(funding.rate,F.fixedDebtQuote(state,1095));assert.equal(funding.lender,'سوق التمويل المؤسسي');
assert.throws(()=>run('raise-wholesale-funding',{amount:1000000,termDays:200}),/bank-wholesale-term-invalid/);

// 4. Liquidity: yield by instrument and term from the base rate; typed yield ignored.
const security=run('invest-liquidity',{amount:20000000,kind:'covered-bond',termDays:730,yieldRate:.25});
assert.ok(near(security.yieldRate,Math.round((.06+.004+.002)*1e5)/1e5));
assert.throws(()=>run('invest-liquidity',{amount:1000000,kind:'central-bank',termDays:365}),/bank-liquidity-term-invalid/);

// 5. The bank stress test left the game in step 1; its command is gone.
assert.throws(()=>run('stress',{}),/Unknown banking command/);

assert.equal(s.GH_SAVE_SCHEMA.validate(state).ok,true);
console.log('BUILD358_BANK_MARKET_PASS',JSON.stringify({deposits:B.depositRates(state,B.ensure(state).depositPricing.stance),loanBBB:B.loanRate(state,'corporate','BBB'),wholesale:funding.rate,coveredBond:security.yieldRate}));

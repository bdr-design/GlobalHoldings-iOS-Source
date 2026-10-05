'use strict';
// Build 358, step 2 (finance): external debt was free (the statements showed a notional 7% that nobody paid).
// Now a credit line and asset finance pay the market base rate plus the spread of the group's credit rating, a bond
// pays the fixed rate quoted when it was issued, and the daily close bills one day of interest per company as a
// lender invoice on 7-day terms that settle-due-terms pays. Energy project finance keeps its own schedule.
const assert=require('node:assert/strict'),path=require('node:path');
process.env.GH_TEST_SOURCE_DIR=process.env.GH_TEST_SOURCE_DIR||path.resolve(__dirname,'..');
const {scenario}=require('./helpers/business-scenario');
const DAY=86400,near=(a,b,eps=.01)=>Math.abs(a-b)<=eps;

const {s,state,command}=scenario(),F=s.GH_FINANCE_CORE,R=s.GH_REALISM;
state.simSeconds=10*DAY;R.migrate(state).economy.baseRate=.05;state.profile.creditRating='BBB';
assert.ok(near(F.floatingDebtRate(state),.067,1e-12),'base 5% + BBB spread 1.7%');

// 1. A line floats; a bond is fixed at its quote (term premium 0.1% a year, at most 0.5%).
const line=command('finance','raise-debt',{company:'group',amount:50000000,note:'خط ائتمان QA',lender:'بنك QA',termDays:360});
assert.equal(line.record.rateBasis,'floating');assert.equal(line.record.annualRate,undefined);
const bond=command('finance','raise-debt',{company:'air',amount:100000000,note:'سندات QA',lender:'أمناء QA',termDays:1800,fixedRate:true,ref:'BOND-QA'});
const bondRate=Math.round((.067+1800/365*.001)*1e5)/1e5;assert.equal(bond.record.rateBasis,'fixed');assert.equal(bond.record.annualRate,bondRate,`bond ${bond.record.annualRate}`);
const project=command('finance','raise-debt',{company:'air',amount:30000000,note:'تمويل مشروع QA',lender:'اتحاد QA',liabilityAccount:'تمويل مشاريع طاقة',ref:'PF-QA'});
assert.equal(F.interestBearing(project.record),false,'project finance interest is Energy Core\'s');

// 2. One day of interest per company, billed on 7-day terms, once per day.
const cashAir=F.operating(state,'air');
const groupDay=command('finance','accrue-debt-interest',{day:10,company:'group'}),airDay=command('finance','accrue-debt-interest',{day:10,company:'air'});
assert.ok(near(groupDay.amount,Math.round(50000000*.067/365*100)/100),`group ${groupDay.amount}`);
assert.ok(near(airDay.amount,Math.round(100000000*bondRate/365*100)/100),`air ${airDay.amount}`);
assert.equal(command('finance','accrue-debt-interest',{day:10,company:'air'}).idempotent,true);
const invoice=state.finance.payables.find(row=>row.number==='INT-AIR-10');
assert.ok(invoice&&invoice.autoSettle===true&&invoice.dueDay===17,'a lender invoice on 7-day terms');
assert.equal(invoice.counterparty,'أمناء QA');assert.equal(F.operating(state,'air'),cashAir,'nothing is paid before the due day');

// 3. A lower rating costs more the next day on floating debt only.
state.profile.creditRating='BB';
const groupNext=command('finance','accrue-debt-interest',{day:11,company:'group'}),airNext=command('finance','accrue-debt-interest',{day:11,company:'air'});
assert.ok(near(groupNext.amount,Math.round(50000000*.086/365*100)/100),'BB: 5% + 3.6%');assert.equal(airNext.amount,airDay.amount,'the bond keeps its rate');

// 4. The due day pays it; repaying the line stops its interest.
state.simSeconds=17*DAY;const paid=command('finance','settle-due-terms',{day:17,company:'air'});
assert.equal(paid.paid,1);assert.ok(near(F.operating(state,'air'),cashAir-airDay.amount));
command('finance','repay-debt',{company:'group',amount:50000000,debtId:line.ref,note:'سداد QA'});
assert.equal(command('finance','accrue-debt-interest',{day:12,company:'group'}).amount,0);

// 5. The statements show a month of real interest, not a notional rate.
const statement=R.statements(state,'air');
assert.ok(near(statement.interest,100000000*bondRate/12,1),`statement interest ${statement.interest}`);

assert.equal(s.GH_SAVE_SCHEMA.validate(state).ok,true);
console.log('BUILD358_DEBT_INTEREST_PASS',JSON.stringify({floating:F.floatingDebtRate(state),bond:bond.record.annualRate,groupDay:groupDay.amount,airDay:airDay.amount}));

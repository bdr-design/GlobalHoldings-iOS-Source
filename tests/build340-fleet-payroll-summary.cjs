'use strict';

const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const Fleet=require('../WebApp/fleet-core.js');
const APP=fs.readFileSync(path.join(__dirname,'../WebApp/app.js'),'utf8');
const assets=Array.from({length:20000},(_,index)=>({id:`PAY-${index}`,ownerCompanyId:['air','sea','road'][index%3],type:['air','sea','road'][index%3],staffing:{ready:index%7!==0,monthlyPayroll:(index%7!==0)?12000+(index%500):0,total:(index%7!==0)?12+(index%30):0}}));
const state={assets},before=JSON.stringify(state),expected={air:{amount:0,headcount:0},sea:{amount:0,headcount:0},road:{amount:0,headcount:0}};
for(const asset of assets)if(asset.staffing.ready){expected[asset.ownerCompanyId].amount+=Number(asset.staffing.monthlyPayroll)||0;expected[asset.ownerCompanyId].headcount+=Number(asset.staffing.total)||0;}
const summary=Fleet.payrollSummary(state);
for(const company of ['air','sea','road']){assert.equal(summary[company].amount,expected[company].amount);assert.equal(summary[company].headcount,expected[company].headcount);assert.equal(Fleet.monthlyPayroll(state,company),expected[company].amount);assert.equal(Fleet.headcount(state,company),expected[company].headcount);}
assert.equal(Fleet.monthlyPayroll(state,'all'),Object.values(expected).reduce((sum,row)=>sum+row.amount,0));assert.equal(Fleet.headcount(state,'all'),Object.values(expected).reduce((sum,row)=>sum+row.headcount,0));assert.equal(JSON.stringify(state),before,'the owner read-model does not mutate live assets');
const start=APP.indexOf('  function monthlyPayrollSnapshot(){'),end=APP.indexOf('\n  }',start);assert(start>=0&&end>start);const snapshot=APP.slice(start,end);assert.match(snapshot,/payrollSummary\?\.\(state\)/);assert.doesNotMatch(snapshot,/monthlyPayroll\?\.\(state,company\)/);assert.doesNotMatch(snapshot,/headcount\?\.\(state,company\)/);
console.log(JSON.stringify({suite:'build340-fleet-payroll-summary',assets:assets.length,passes:6,scanContract:'one full fleet pass shared by all company payroll rows',environment:`Node ${process.version}; synthetic owner DTOs; not iPhone performance`}));

'use strict';
const assert=require('assert'),fs=require('fs'),path=require('path');
const app=fs.readFileSync(path.resolve(__dirname,'../WebApp/app.js'),'utf8');
assert(app.includes('cashOperatingRevenue={...operatingRevenue},cashOperatingExpense={...operatingExpense}'));
assert(app.includes('cashOperatingExpense[energyCompany]=Math.max(0,Number(cashOperatingExpense[energyCompany]||0)-Math.max(0,Number(ed.takeOrPayAccrued)||0))'));
assert(app.includes('expense=Math.max(0,Number(cashOperatingExpense[companyId])||0)'));
assert(app.includes('operatingExpense[energyCompany]+=Math.max(0,Number(ed.powerExpense)||0)-Math.max(0,Number(ed.powerFacilityExpense)||0)'));
assert(app.includes('const daily=Object.fromEntries(companyIds.map(companyId=>[companyId,(Number(operatingRevenue[companyId])||0)-(Number(operatingExpense[companyId])||0)]))'));
console.log(JSON.stringify({suite:'accrual-cash-separation-contract',passed:5,total:5},null,2));

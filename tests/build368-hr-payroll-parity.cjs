'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
process.env.GH_TEST_SOURCE_DIR=process.env.GH_TEST_SOURCE_DIR||path.resolve(__dirname,'..');
const {scenario}=require('./helpers/business-scenario');

const {s,state,command}=scenario(),HR=s.GH_HR_CORE;
command('corporate','open-company',{type:'telecom',capital:500000000,legalName:'اختبار الاتصالات'});
state.customHubs.push(
 {id:'TEL-QA-BRANCH-1',kind:'telecom-branch',name:'فرع الاختبار الأول',ownerCompanyId:'telecom',owned:true},
 {id:'TEL-QA-BRANCH-2',kind:'telecom-branch',name:'فرع الاختبار الثاني',ownerCompanyId:'telecom',owned:true}
);

const before=HR.snapshot(state,{},'telecom');
assert.equal(before.required,28,'two telecom branches require fourteen staff each');
assert.equal(before.total,28);
assert.equal(before.coverage,0);
const hiring=HR.executeHiring(state,{},'telecom','QA bulk branch staffing','facility');
assert.equal(hiring.total,28);
assert.equal(hiring.missingAfter,0);
assert.equal(hiring.coverageAfter,100);
assert.equal(HR.snapshot(state,{},'telecom').total,0);
const branchContracts=state.advanced.labor.employmentContracts.filter(row=>row.status==='ساري'&&row.role==='تشغيل منشأة'&&row.ownerCompanyId==='telecom');
assert.equal(branchContracts.length,2,'the bulk action creates a separately owned contract for each branch');
assert.deepEqual(JSON.parse(JSON.stringify(branchContracts.map(row=>row.count).sort((a,b)=>a-b))),[14,14]);
assert.deepEqual(JSON.parse(JSON.stringify(branchContracts.map(row=>state.advanced.facilities[row.facilityId].staff).sort((a,b)=>a-b))),[14,14]);
assert(branchContracts.every(row=>row.salary===5200&&row.autoRenew===true));

const candidate=HR.officialManagerCandidates(state,'telecom').slice().sort((a,b)=>b.skill-a.skill||b.experience-a.experience||a.salary-b.salary)[0];
assert(candidate,'telecom has an eligible official-manager candidate');
const appointment=HR.appointOfficialManager(state,{company:'telecom',candidateId:candidate.id,source:'QA payroll parity'});
const managerContract=state.advanced.labor.employmentContracts.find(row=>row.id===appointment.contract.id);
assert.equal(managerContract.salary,candidate.salary,'manager salary is stored annually');
HR.execute({state},'set-salary-index',{company:'telecom',index:1.1});

// Compare the budget's actual payroll with the same production monthly-payroll read model used by payroll settlement.
const app=fs.readFileSync(path.resolve(__dirname,'../WebApp/app.js'),'utf8'),start=app.indexOf('  function monthlyPayrollSnapshot(){'),end=app.indexOf('  function payrollReportForMonth(',start);
assert(start>=0&&end>start,'production monthly payroll snapshot is available');
const box={state,operationalCompanyIds:()=>['telecom'],companyHasCapability:()=>false,uniqueOperationalCompanyForCapability:()=>null,clamp:(v,a,b)=>Math.max(a,Math.min(b,v)),window:{GH_HR_CORE:HR}};
vm.createContext(box);vm.runInContext(app.slice(start,end)+';this.result=monthlyPayrollSnapshot()',box,{filename:'app-monthly-payroll-snapshot.js'});
const payrollSnapshot=box.result.telecom;
const expectedBase=branchContracts.reduce((sum,row)=>sum+row.salary*row.count,0)+managerContract.salary/12;
assert.equal(payrollSnapshot.amount,Math.round(expectedBase*1.1));
assert.equal(payrollSnapshot.headcount,29,'the payroll model counts all branch staff and the official manager');

// A local day close refreshes Budget/Actual using inferBudgetActual without adding assets or entering mobility code.
const fleetBefore=JSON.stringify(state.assets||[]),mobilityBefore=JSON.stringify(state.mobility||{});
s.GH_REALISM.onDay(state,1);
const budgetActual=state.realism.budgets.telecom.actual.payroll;
assert.equal(budgetActual,payrollSnapshot.amount,'budget Actual equals the production monthly payroll amount');
assert.equal(JSON.stringify(state.assets||[]),fleetBefore,'the HR payroll regression does not mutate assets');
assert.equal(JSON.stringify(state.mobility||{}),mobilityBefore,'the HR payroll regression does not mutate mobility state');

console.log(JSON.stringify({suite:'build368-hr-payroll-parity',branchCount:branchContracts.length,required:before.required,filled:hiring.total,coverageAfter:hiring.coverageAfter,headcount:payrollSnapshot.headcount,annualManagerSalary:managerContract.salary,monthlyPayroll:payrollSnapshot.amount,budgetActualPayroll:budgetActual,assetsUntouched:true,mobilityUntouched:true}));

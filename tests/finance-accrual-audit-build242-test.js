const fs=require('fs'),assert=require('assert');
const app=fs.readFileSync('WebApp/app.js','utf8');
assert(app.includes('function postAccruedExpense('),'missing single accrued-expense document path');
assert(!/state\.finance\.payables\.unshift\(\{number:`\$\{type\.toUpperCase\(\)\}-ACC/.test(app),'daily close bypasses accrued-expense document path');
assert(app.includes("postAccruedExpense(company,amount,'رواتب مستحقة — نقص سيولة'"),'unfunded payroll must create an auditable source document');
assert(app.includes('sourceDocumentIds:ids')&&app.includes('sources:overflow.map'),'finance archive digest must preserve compact source traceability');
console.log('Build242 finance accrual/audit traceability: PASS');

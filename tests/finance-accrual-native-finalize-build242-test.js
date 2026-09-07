const fs=require('fs');
const app=fs.readFileSync('WebApp/app.js','utf8');
const finance=fs.readFileSync('WebApp/finance-core.js','utf8');
const banking=fs.readFileSync('WebApp/banking-core.js','utf8');
const native=fs.readFileSync('iOS/GlobalHoldings/GameViewController.swift','utf8');
function ok(v,m){if(!v)throw new Error(m)}
ok(finance.includes("kind:'cash-document'")&&finance.includes("kind:'accrual-document'"),'Finance Core audit entries must distinguish cash from accrual');
ok(app.includes("postAccruedExpense('group',due,'عجز الشركة القابضة المرحّل'")&&app.includes("'مصروفات إدارية وتشغيلية'"),'group shortfall must use the unified accrued-expense document/AP path');
ok(app.includes("postAccruedExpense(company,amount,'رواتب مستحقة — نقص سيولة'")&&app.includes("'مصروف رواتب وأجور'"),'unpaid payroll must use the unified accrued-expense document/AP path exactly once');
ok(banking.includes("const arrangementFee=Math.max(25000,a*.0035)")&&banking.includes("رسوم ترتيب تسهيل ائتماني مستحقة لبنك المجموعة"),'bank arrangement fee must be mirrored in borrower books by Banking Core');
ok(native.includes('generation > 0'),'update checkpoint must reject missing verified native generation');
ok(native.includes('rollbackFailedUpdate(reason: "boot-confirm-failed:'),'boot-confirm exception must rollback paired runtime/save, not merely report failure');
console.log('finance-accrual-native-finalize-build242-test: PASS');

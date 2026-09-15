const fs=require('fs'),path=require('path'),assert=require('assert');
const root=path.resolve(__dirname,'..'),read=p=>fs.readFileSync(path.join(root,p),'utf8');
const app=read('WebApp/app.js'),finance=read('WebApp/finance-core.js'),adv=read('WebApp/advanced-core.js'),closure=read('WebApp/demand-closure-core.js'),schema=require(path.join(root,'WebApp/save-schema.js'));
const fn=(name,next)=>{const a=app.indexOf(`function ${name}`),b=next?app.indexOf(`function ${next}`,a+1):-1;assert(a>=0,`missing ${name}`);return app.slice(a,b>a?b:Math.min(app.length,a+9000));};

// Liability settlement belongs to Finance Core; UI delegates through domain commands.
const financeFn=(name,next)=>{const a=finance.indexOf(`function ${name}`),b=next?finance.indexOf(`function ${next}`,a+1):-1;assert(a>=0,`missing Finance Core ${name}`);return finance.slice(a,b>a?b:Math.min(finance.length,a+7000));};
const tax=financeFn('payTaxes','issueCheque');assert(!tax.includes("'spend'"),'VAT settlement must clear a liability, not create a new expense');assert(tax.includes("account:'ضريبة VAT مستحقة',debit:a")&&tax.includes('credit:a'),'VAT settlement journal missing');
const ar=financeFn('collectReceivable','settlePayable');assert(ar.includes("account:'ذمم مدينة',credit:a"),'AR collection must credit receivables');
const ap=financeFn('settlePayable','payTaxes');assert(ap.includes("account:'ذمم دائنة',debit:a"),'AP settlement must debit payables');
assert(finance.includes("account:'ذمم دائنة',debit:a")&&finance.includes('invoiceNumber'),'cheque settlement must clear linked AP in Finance Core');
assert(app.includes('financeAuditArchive')&&app.includes('archiveTrim')&&app.includes('auditChecksum'),'financial audit archive must replace silent destructive trimming');
assert(finance.includes("p.liabilityAccount||'تسهيلات ائتمانية مستحقة'")&&finance.includes("p.equityAccount||'رأس مال وعلاوة إصدار'"),'financing/equity journal coverage missing in Finance Core');
assert(app.includes("'finance','raise-debt'")&&app.includes("'finance','raise-equity'"),'financing UI must delegate to Finance Core');

// VAT periods are deltas with explicit opening/closing credit, not cumulative liabilities.
assert(finance.includes('openingCredit')&&finance.includes('closingCredit')&&finance.includes('deltaOutput')&&finance.includes('deltaInput')&&finance.includes("case'close-vat-period'"),'VAT delta period model missing from Finance Core');
const base={saveVersion:'2.0.0',saveRevision:1,simSeconds:1,assets:[],market:[],advanced:{},companyFinance:{group:{accounts:[{balance:1}],debt:0,taxPayable:50,vat:{output:150,input:50,creditCarry:0,periodOutputStart:0,periodInputStart:0}}},finance:{invoices:[],cheques:[],payables:[],receivables:[],journalEntries:[],periods:[{id:'T1',company:'group',outputVAT:100,inputVAT:25,openingCredit:25,closingCredit:0,amount:50,status:'مستحق'}]},companyBudgets:{}};
assert(schema.validate(base).ok,'valid VAT delta period rejected');base.finance.periods[0].amount=75;assert(!schema.validate(base).ok,'invalid cumulative VAT period accepted');

// AI business decisions are simulation-clock deterministic and authority gated.
for(const [name,text] of [['advanced',adv],['closure',closure]]){const business=text.replace(/createdAt:Date\.now\(\)/g,'');assert(!/Date\.now\(\)/.test(business),`${name} business state uses wall clock`);}
assert(app.includes('proactiveReview(advCtx,true,null,hour)')&&!app.includes('GH_REQUEST_CORE?.tick?.(advCtx)'),'simulation-hour AI owner must not depend on removed request core');
assert(app.includes('manual-buy-asset')&&app.includes('MANUAL-ASSET'),'manual purchase path missing');
console.log('Atomic finance + deterministic AI Build242: PASS');

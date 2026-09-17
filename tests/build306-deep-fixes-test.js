'use strict';
// BUILD306 regression firewall: daily company cash survives saves and settles once,
// payroll always has a formal transfer trail, motion remains presentation-only,
// and every facility family enters through the same global directory workflow.
const assert=require('assert');
const fs=require('fs');
const path=require('path');
const finance=require('../WebApp/finance-core.js');
const ROOT=path.resolve(__dirname,'..');
const read=file=>fs.readFileSync(path.join(ROOT,file),'utf8');

function state(){
  const value={
    saveVersion:'2.0.0',simSeconds:86400,cash:0,debt:0,profile:{name:'مجموعة الاختبار'},openedCompanies:['air','sea','road','power','bank','mobility'],
    companyFinance:{},companyBudgets:{},finance:{invoices:[],payables:[],receivables:[],cheques:[],periods:[],journalEntries:[],transfers:[],payrollReports:[],dailyCompanyReports:[]},
    treasury:{accounts:[],ledger:[],paymentQueue:[]},assets:[],market:[],advanced:{}
  };
  finance.ensure(value);
  return value;
}
function setBalance(s,type,amount){finance.book(s,type).accounts[0].balance=amount;finance.reconcile(s);}
function balancedJournals(s){return s.finance.journalEntries.every(row=>{const debit=row.lines.reduce((n,line)=>n+(Number(line.debit)||0),0),credit=row.lines.reduce((n,line)=>n+(Number(line.credit)||0),0);return row.lines.length&&Math.abs(debit-credit)<=.02;});}

(function dailyCashPersistenceAndExactlyOnceSettlement(){
  const s=state();setBalance(s,'air',1000);setBalance(s,'mobility',700);
  const airOpening=finance.operating(s,'air'),mobilityOpening=finance.operating(s,'mobility');
  finance.execute({state:s},'apply-simulation-journal',{journal:{todayProfit:205.5,sectorProfit:{air:125.5,mobility:80},tripProfit:{air:125.5,mobility:80},tripRevenue:{air:190,mobility:100},tripFuel:{air:64.5,mobility:20},tripCount:{air:2,mobility:4},cash:{air:125.5,mobility:80}}});
  assert.strictEqual(finance.operating(s,'air'),airOpening,'intraday flight cash must not mutate the current account before day close');
  assert.strictEqual(finance.operating(s,'mobility'),mobilityOpening,'intraday Mobility cash must not bypass day close');
  assert.strictEqual(s.finance.pendingDailyCash.air,125.5,'flight cash must be held in the persisted daily clearing bucket');
  assert.strictEqual(s.finance.pendingDailyCash.mobility,80,'Mobility must use the same daily clearing contract');

  const reloaded=JSON.parse(JSON.stringify(s));finance.ensure(reloaded);
  assert.strictEqual(reloaded.finance.pendingDailyCash.air,125.5,'pending company income must survive a save/reload during the day');
  const batch=finance.execute({state:reloaded},'consume-trip-accruals',{});
  assert.strictEqual(batch.cash.air,125.5,'day close must receive the exact persisted amount');
  assert.strictEqual(reloaded.finance.pendingDailyCash.air,0,'consumed clearing cash must reset atomically');

  const first=finance.execute({state:reloaded},'settle-daily-cash',{company:'air',amount:batch.cash.air,day:1,reference:'DAY-CASH-air-1'});
  assert.strictEqual(first.idempotent,false,'first daily settlement must execute');
  assert.strictEqual(finance.operating(reloaded,'air'),airOpening+125.5,'day close must credit the company current account exactly');
  assert(reloaded.finance.transfers.some(row=>row.reference==='DAY-CASH-air-1'&&row.status==='منفذة'),'daily income must have a formal transfer record');
  assert(reloaded.treasury.ledger.some(row=>row.reference==='DAY-CASH-air-1'),'daily income must have a treasury ledger record');
  const transferCount=reloaded.finance.transfers.length,ledgerCount=reloaded.treasury.ledger.length;
  const duplicate=finance.execute({state:reloaded},'settle-daily-cash',{company:'air',amount:batch.cash.air,day:1,reference:'DAY-CASH-air-1'});
  assert.strictEqual(duplicate.idempotent,true,'a retried day boundary must not settle twice');
  assert.strictEqual(finance.operating(reloaded,'air'),airOpening+125.5,'a retry must not duplicate current-account cash');
  assert.strictEqual(reloaded.finance.transfers.length,transferCount,'a retry must not duplicate its formal transfer');
  assert.strictEqual(reloaded.treasury.ledger.length,ledgerCount,'a retry must not duplicate its ledger entry');
})();

(function payrollPaymentAndDueSettlementDocuments(){
  const s=state();setBalance(s,'air',1000);setBalance(s,'road',900);
  const paid=finance.execute({state:s},'pay-payroll',{company:'air',amount:240,note:'مسير رواتب يناير',reportId:'PAYROLL-2026-01'});
  assert.strictEqual(finance.operating(s,'air'),760,'payroll must actually leave the company current account');
  assert(paid.transferReference,'paid payroll must expose its formal transfer reference');
  assert(s.finance.transfers.some(row=>row.reference===paid.transferReference&&row.kind==='payroll-transfer'&&row.status==='منفذة'&&row.documentNumber===paid.number),'paid payroll must link invoice and executed transfer');
  assert(s.treasury.ledger.some(row=>row.reference===paid.transferReference&&row.documentNumber===paid.number),'paid payroll must be present in the treasury ledger');
  const invoiceCount=s.finance.invoices.length,transferCount=s.finance.transfers.length;
  const retry=finance.execute({state:s},'pay-payroll',{company:'air',amount:240,note:'مسير رواتب يناير',reportId:'PAYROLL-2026-01'});
  assert.strictEqual(retry.number,paid.number,'same payroll report must resolve to the original payment document');
  assert.strictEqual(finance.operating(s,'air'),760,'same payroll report must never be paid twice');
  assert.strictEqual(s.finance.invoices.length,invoiceCount,'payroll retry must not duplicate the invoice');
  assert.strictEqual(s.finance.transfers.length,transferCount,'payroll retry must not duplicate the transfer');

  const due=finance.execute({state:s},'accrue-payroll',{company:'road',amount:300,note:'رواتب مستحقة',number:'PAY-ROAD-2026-01',dueDay:1,reportId:'PAYROLL-2026-01-DUE'});
  const pending=s.finance.transfers.find(row=>row.reference===due.transferReference);
  assert(pending&&pending.status==='مستحقة'&&pending.kind==='payroll-payable','unfunded payroll must still produce a formal pending transfer');
  finance.execute({state:s},'record-payroll-report',{report:{id:'PAYROLL-2026-01-DUE',day:1,monthKey:'2026-01',lines:[{company:'road',amount:300,paid:0,due:300,dueRef:due.number}]}});
  const settlement=finance.execute({state:s},'settle-payable',{number:due.number});
  assert.strictEqual(settlement.reference,due.transferReference,'later payroll settlement must retain the original formal reference');
  assert.strictEqual(finance.operating(s,'road'),600,'settled payroll payable must leave the correct company account');
  assert.strictEqual(pending.status,'منفذة','the original pending transfer must become executed, not be replaced by an unrelated record');
  assert.strictEqual(pending.kind,'payroll-transfer','the settled record must become an executed payroll transfer');
  assert(s.treasury.ledger.some(row=>row.reference===due.transferReference&&row.status==='منفذة'),'settled payroll must have a referenced executed ledger entry');
  assert.strictEqual(s.finance.payrollReports[0].due,0,'payroll report must close when its payable is settled');
  assert(balancedJournals(s),'all payroll journals must remain balanced');
})();

(function legacyPayrollDocumentMigration(){
  const s=state();s.finance.transfers=[];
  s.finance.invoices.push({number:'LEGACY-PAY-AIR-1',company:'air',kind:'مصروف',amount:120,total:120,subtotal:120,tax:0,note:'مسير رواتب قديم',method:'تحويل رواتب',status:'مدفوعة',budgetLine:'payroll',at:100});
  s.finance.invoices.push({number:'LEGACY-PAY-ROAD-1',company:'road',kind:'مصروف',amount:90,total:90,subtotal:90,tax:0,note:'رواتب قديمة مستحقة',method:'تحويل رواتب',status:'مستحقة',payrollShortfall:true,at:100});
  s.finance.payables.push({...s.finance.invoices[1]});finance.ensure(s);
  const paid=s.finance.transfers.find(row=>row.documentNumber==='LEGACY-PAY-AIR-1'),due=s.finance.transfers.find(row=>row.documentNumber==='LEGACY-PAY-ROAD-1');
  assert(paid&&paid.status==='منفذة'&&paid.kind==='payroll-transfer'&&paid.migrated===true,'legacy paid payroll must gain an executed formal transfer');
  assert(due&&due.status==='مستحقة'&&due.kind==='payroll-payable'&&due.migrated===true,'legacy payroll debt must gain a pending formal transfer');
  const count=s.finance.transfers.length;finance.ensure(s);assert.strictEqual(s.finance.transfers.length,count,'payroll document backfill must be idempotent');
})();

(function sourceContracts(){
  const app=read('WebApp/app.js'),advanced=read('WebApp/advanced-core.js'),financeSource=read('WebApp/finance-core.js'),facilitySource=read('WebApp/facility-core.js'),mobility=read('WebApp/mobility-core.js'),index=read('WebApp/index.html'),styles=read('WebApp/styles.css'),save=read('WebApp/save-schema.js');
  const motion=app.slice(app.indexOf('function markerPoint'),app.indexOf('function updateMarkerPositions'));
  assert(!motion.includes('setInterval')&&!motion.includes('setTimeout'),'marker presentation must not add an independent timing loop');
  assert(motion.includes('function fadeResyncMarker')&&motion.includes('requestAnimationFrame'),'large discontinuities must use a presentation-only fade resync');
  assert(!/state\.simSeconds\s*=|\.progress\s*=/.test(motion),'presentation tween helpers must never own simulation time or logical progress');
  assert(app.includes('animateMapMarkerPositions(now);'),'the main animation frame must sample marker presentation tweens');
  assert(motion.includes('markerMotionStates.get(key)')&&motion.includes('row.target=clean'),'target updates must reuse one bounded motion state per marker');
  assert(app.includes('mapStructureSignature()!==lastMapStructureSignature'),'the one-second map check must rebuild only for structural changes');
  assert(mobility.includes('cash:{mobility:profit}'),'Mobility must enter the persisted daily cash clearing path');
  assert(!mobility.includes("'record-simulation-revenue'"),'Mobility must not bypass end-of-day settlement with immediate revenue posting');
  assert(!financeSource.includes('recordSimulationRevenue')&&!financeSource.includes("case'record-simulation-revenue'"),'the superseded immediate simulation-revenue system must be removed, not left callable');
  assert(app.includes("'settle-daily-cash'"),'the financial boundary must settle pending company cash');
  assert(app.includes("openWorldDirectory('power',{energyKind:b.dataset.kind||'solar'})"),'energy projects must enter through the shared directory');
  assert(advanced.includes("ctx.openWorldDirectory?.('bank')")&&!advanced.includes('bank-branch'),'bank branches must expose one directory path without a duplicate legacy control');
  assert(app.includes('open-facility-directory')&&app.includes("data-kind=\"road\""),'logistics centers must expose the shared directory action');
  assert(app.includes("if(entity.company==='road')result=openLogisticsHub(entity.key)")&&app.includes("else if(entity.company==='power')result=buildEnergy(entity.energyKind||worldDirectoryIntent.energyKind||'solar',entity.key)")&&app.includes("else if(entity.company==='bank')result=openBankBranch(entity.key)"),'directory execution must route each facility family through a canonical key');
  assert(app.includes("site=canonicalDirectorySite(site,'road')")&&app.includes("site=canonicalDirectorySite(site,'power')")&&app.includes("site=canonicalDirectorySite(site,'bank')"),'facility UI commands must reconstruct sites from the canonical directory');
  assert(facilitySource.includes('verifyDirectorySite')&&facilitySource.includes('directory-site-coordinates-invalid'),'the facility owner must independently reject forged directory data');
  assert(!app.includes('startHubPlacement')&&!app.includes('place-logistics')&&!app.includes('confirmMapPlacement'),'the superseded free-map logistics opening path must be removed');
  for(const id of ['founderFlow','founderForm','founderName','founderOwner','founderCountry','founderCity','founderSector','founderMode','founderLogoPreview','skipFounder'])assert(index.includes(`id="${id}"`),`founding binding #${id} must remain intact`);
  assert.strictEqual((index.match(/class="founder-group founder-contract-article"/g)||[]).length,3,'the founding contract must retain exactly three bound articles');
  assert.strictEqual((index.match(/<button[^>]+class="logo-preset(?: active)?"/g)||[]).length,4,'the four logo presets must remain intact');
  const build306Css=styles.slice(styles.indexOf('BUILD306'));
  assert(build306Css.includes('grid-template-rows:repeat(8,minmax(0,1fr))'),'all eight sidebar domains must share the available height');
  assert(build306Css.includes('min-height:44px'),'landscape sidebar controls must retain a reliable touch target');
  assert(!/\.side-nav\{[^}]*padding(?:-top)?:\s*(?:66|67|82)px/.test(styles),'the old top-offset sidebar geometry must not remain underneath BUILD306');
  assert(!styles.includes('grid-template-columns:minmax(320px,1fr) minmax(430px,620px)'),'the superseded founder layout must not remain underneath the contract layout');
  assert(build306Css.includes('.founder-contract-sheet'),'the founder UI must use the contract-sheet layout');
  assert(save.includes("SAVE_SCHEMA_VERSION='2.0.0'"),'BUILD306 must not change Save Schema 2.0.0');
})();

console.log('BUILD306 motion + facilities + daily cash + payroll + founder contract firewall: PASS');

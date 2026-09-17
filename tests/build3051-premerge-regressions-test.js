'use strict';
const assert=require('assert');
const fs=require('fs');
const path=require('path');
const {JSDOM}=require('jsdom');
const {harness,minimal}=require('./helpers/core-harness');

const {s}=harness(['transaction-core','domain-command-core','finance-core','corporate-core','banking-core','economics-core']);
const F=s.GH_FINANCE_CORE,B=s.GH_BANKING_CORE,X=s.GH_ECONOMICS_CORE,D=s.GH_DOMAIN_COMMANDS;

function fundedBankState(){
  const state={...minimal(),profile:{name:'BUILD305.1 Test Group',founder:'المؤسس',hq:'الرياض'},openedCompanies:['bank'],unlockedSectors:['bank'],companyRegistry:{bank:{legalName:'BUILD305.1 Bank'}},advanced:{economy:{depositRate:.03,loanYield:.075}},customHubs:[],assets:[]};
  F.ensure(state);
  F.book(state,'group').accounts[0].balance=100_000_000;
  F.book(state,'bank').accounts[0].balance=80_000_000;
  F.reconcile(state);
  const bank=B.ensure(state);bank.corporateClients.group.creditLimit=25_000_000;
  return state;
}

// Corporate interest is already collected as cash inside Banking Core. The
// day-end accounting read model must retain the full P&L while exposing only
// the unposted cash revenue to the financial close.
{
  const state=fundedBankState();
  D.dispatch({state},'banking','draw-facility',{company:'group',amount:3_650_000,termDays:365,rate:.06},{actor:'test'});
  const bankBefore=F.operating(state,'bank'),groupBefore=F.operating(state,'group');
  state.simSeconds=86400;
  const report=D.dispatch({state},'banking','tick-day',{day:1},{actor:'financial-close'}).result;
  assert(report.corporatePrincipalRepaid>0&&report.corporateInterestIncome>0,'corporate debt service was not exercised');
  assert.strictEqual(report.cashPostedInterestIncome,report.corporateInterestIncome,'collected corporate interest must be labelled as already posted cash');
  assert(Math.abs(report.unpostedInterestIncome-(report.interestIncome-report.cashPostedInterestIncome))<1e-8,'unposted interest does not reconcile to total interest');
  assert(Math.abs(F.operating(state,'bank')-bankBefore-report.corporatePrincipalRepaid-report.corporateInterestIncome)<1e-8,'bank cash did not receive principal and interest exactly once during debt service');
  assert(Math.abs(groupBefore-F.operating(state,'group')-report.corporatePrincipalRepaid-report.corporateInterestIncome)<1e-8,'borrower cash did not fund debt service exactly once');

  const economics=X.sectorEconomics(state,{day:1,preferDailyReport:true});
  assert.strictEqual(economics.detail.bankRevenue,report.interestIncome+report.securityIncome+report.feeIncome,'bank P&L must retain total earned revenue');
  assert.strictEqual(economics.detail.bankCashRevenueToPost,report.unpostedInterestIncome+report.securityIncome+report.feeIncome,'financial close must receive only revenue whose cash was not already posted');
  const cashAfterDebtService=F.operating(state,'bank');
  if(economics.detail.bankCashRevenueToPost>0)F.execute({state},'credit',{company:'bank',amount:economics.detail.bankCashRevenueToPost,note:'BUILD305.1 close probe',taxable:false});
  assert.strictEqual(F.operating(state,'bank'),cashAfterDebtService,'the close probe reposted already-collected corporate interest');

  const facility=state.bank.corporateFacilities[0],reference=`CF-INTEREST-${facility.id}-1`,documentsBefore=state.finance.invoices.length,journalsBefore=state.finance.journalEntries.length;
  const repeated=D.dispatch({state},'finance','settle-intercompany-interest',{from:'group',to:'bank',amount:report.corporateInterestIncome,ref:reference},{actor:'test'}).result;
  assert.strictEqual(repeated.idempotent,true,'repeating the authoritative interest reference was not idempotent');
  assert.strictEqual(repeated.cashPostedRevenue,0,'an idempotent interest settlement reported new cash');
  assert.strictEqual(F.operating(state,'bank'),cashAfterDebtService,'an idempotent interest settlement moved bank cash');
  assert.strictEqual(state.finance.invoices.length,documentsBefore,'an idempotent interest settlement created duplicate documents');
  assert.strictEqual(state.finance.journalEntries.length,journalsBefore,'an idempotent interest settlement created duplicate journals');

  const persistedReport=state.bank.dailyHistory.find(row=>row.day===1);
  delete persistedReport.cashPostedInterestIncome;
  delete persistedReport.unpostedInterestIncome;
  const legacyEconomics=X.sectorEconomics(state,{day:1,preferDailyReport:true});
  assert.strictEqual(legacyEconomics.detail.bankCashRevenueToPost,Math.max(0,report.interestIncome-report.corporateInterestIncome)+report.securityIncome+report.feeIncome,'a pre-BUILD305.1 daily report loses or duplicates interest during recovery');
}

// A failure after principal transfer but before interest settlement must roll
// the entire banking day back, including balances, debt and facility schedule.
{
  const state=fundedBankState();
  D.dispatch({state},'banking','draw-facility',{company:'group',amount:3_650_000,termDays:365,rate:.06},{actor:'test'});
  state.simSeconds=86400;
  const before={
    groupCash:F.operating(state,'group'),bankCash:F.operating(state,'bank'),groupDebt:F.book(state,'group').debt,
    facility:structuredClone(state.bank.corporateFacilities[0]),journalEntries:state.finance.journalEntries.length,
    invoices:state.finance.invoices.length,ledger:state.treasury.ledger.length,lastProcessedDay:state.bank.lastProcessedDay
  };
  const original=s.GH_FINANCE_CORE;
  s.GH_FINANCE_CORE={...original,execute(ctx,cmd,payload){if(cmd==='settle-intercompany-interest')throw new Error('injected-interest-posting-failure');return original.execute(ctx,cmd,payload);}};
  assert.throws(()=>D.dispatch({state},'banking','tick-day',{day:1},{actor:'financial-close'}),/injected-interest-posting-failure/);
  s.GH_FINANCE_CORE=original;
  assert.strictEqual(JSON.stringify({
    groupCash:F.operating(state,'group'),bankCash:F.operating(state,'bank'),groupDebt:F.book(state,'group').debt,
    facility:state.bank.corporateFacilities[0],journalEntries:state.finance.journalEntries.length,
    invoices:state.finance.invoices.length,ledger:state.treasury.ledger.length,lastProcessedDay:state.bank.lastProcessedDay
  }),JSON.stringify(before),'failed debt service left partial financial state');
}

// Generic content-image recovery must never bind to Leaflet's tile images.
{
  const dom=new JSDOM('<!doctype html><div class="leaflet-tile-pane"><img id="tile" class="leaflet-tile" src="https://tile.openstreetmap.org/3/4/2.png"></div><div class="asset-thumb"><img id="content" src="assets/images/missing-air-photo.webp"></div>',{runScripts:'outside-only',url:'http://127.0.0.1/'});
  dom.window.structuredClone=structuredClone;
  dom.window.requestAnimationFrame=()=>0;
  dom.window.eval(fs.readFileSync(path.join(__dirname,'../WebApp/advanced-core.js'),'utf8'));
  dom.window.GH_ADVANCED.bind(dom.window.document,{});
  const tile=dom.window.document.getElementById('tile'),content=dom.window.document.getElementById('content'),tileSource=tile.getAttribute('src');
  tile.dispatchEvent(new dom.window.Event('error'));
  content.dispatchEvent(new dom.window.Event('error'));
  assert.strictEqual(tile.getAttribute('src'),tileSource,'a failed Leaflet tile was replaced by a business image');
  assert.strictEqual(tile.dataset.fallbackApplied,undefined,'Leaflet tile was enrolled in the generic image fallback');
  assert.strictEqual(content.dataset.fallbackApplied,'1','owned content image no longer receives its fallback');
  assert(/assets\/images\/.+\.(?:webp|png|jpg)$/i.test(content.getAttribute('src')),'content fallback is not a local visual asset');
  dom.window.close();
}

// The visible sedan stays compact, while the iPhone interaction target must be
// large enough and the offline map state must be explicit.
{
  const app=fs.readFileSync('WebApp/app.js','utf8'),css=fs.readFileSync('WebApp/styles.css','utf8');
  assert(app.includes('iconSize:[44,44],iconAnchor:[22,22]'),'Mobility marker does not expose a 44-point hit target');
  assert(/\.vehicle-pin\.mobility \.vehicle-sprite\{[^}]*width:12px[^}]*height:24px/.test(css),'Mobility sedan remains visually compact on iPhone');
  assert(app.includes("layer.on('tileerror'")&&app.includes('map-tiles-offline'),'tile failures do not produce an explicit offline map state');
  assert(css.includes('.map-stage.map-tiles-offline'),'offline map has no deliberate visual treatment');
}

console.log('BUILD305.1 pre-merge behavioral regressions: PASS');

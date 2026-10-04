'use strict';
// Build 358, reported from play: "taxes don't work" - VAT stayed zero, nothing came due and no tax settlement was ever
// issued. Fleet purchases were taxed, so a purchase put 15% of its price into input VAT: a credit larger than months of
// output VAT on trips, and every monthly close found nothing due. Aircraft, ships and trucks are now zero-rated, as
// Mobility vehicles and every asset sale already were, and older saves have that credit reversed once on load.
// Checked: a purchase adds no input VAT; trip revenue then makes VAT due at the month close and it is paid; the
// migration reverses only fleet-purchase VAT (the open period, then the carried credit, never more than either holds),
// leaves cash unchanged, runs once, and the save validates.
const assert=require('node:assert/strict'),path=require('node:path');
const ROOT=process.env.GH_TEST_SOURCE_DIR||path.resolve(__dirname,'..');process.env.GH_TEST_SOURCE_DIR=ROOT;
const {scenario}=require(path.join(ROOT,'tests/helpers/business-scenario'));
const results=[];function test(name,fn){try{results.push({name,ok:true,detail:fn()});}catch(error){results.push({name,ok:false,error:String(error.stack||error).slice(0,1600)});}}
const DAY=86400;
// The app boots a saved game through Save Schema normalize (app.js). The scenario builds a 2.0.0 state with an asset
// array; give it the 3.0.0 shape (a fleet store) first, as saves on device have.
const boot=(s,state)=>{state.saveVersion=s.GH_SAVE_SCHEMA.SAVE_SCHEMA_VERSION;state.fleet=s.GH_FLEET_STORE.fromAssets(state.assets||[],{at:Number(state.simSeconds)||0});delete state.assets;return s.GH_SAVE_SCHEMA.normalize(state);};

test('a fleet purchase carries no input VAT; trip revenue makes VAT due at the month close and it is paid',()=>{
  const e=scenario(),{s,state,command}=e,F=s.GH_FINANCE_CORE;state.godMoney=true;state.infiniteMoney=true;
  const input=F.book(state,'air').vat.input;
  assert.ok(e.manualPurchase(3),'the purchase is ordered');
  const doc=state.finance.invoices.find(row=>F.FLEET_PURCHASE_NOTE.test(row.note));
  assert.ok(doc,'the purchase invoice');assert.equal(doc.tax,0,'no VAT on the purchase');assert.equal(doc.subtotal,doc.amount);
  assert.equal(F.book(state,'air').vat.input,input,'no input VAT credit');
  state.simSeconds=20*DAY;command('finance','credit',{company:'air',amount:1150000,note:'تسوية رحلات يومية',taxable:true});
  assert.equal(F.book(state,'air').taxAccrued,150000,'the open period accrues the output VAT');
  state.simSeconds=31*DAY;const period=command('finance','close-vat-period',{day:30}).find(row=>row.company==='air');
  assert.equal(period.status,'مستحق','the month close makes it due');assert.equal(period.amount,150000);
  const cashBefore=F.operating(state,'air'),transfersBefore=state.finance.transfers.length;
  const paid=command('finance','pay-taxes',{company:'air'});
  assert.equal(paid.amount,150000);assert.ok(/^TAX-SET-/.test(paid.settlementId),'a tax settlement is issued with its number');
  // Build 358: the tax is paid by a cheque to the tax authority, cashed at once; no government transfer.
  const cheque=state.finance.cheques.find(row=>row.id===paid.chequeId);
  assert.ok(cheque,'a cheque is issued');assert.equal(cheque.beneficiary,'هيئة الزكاة والضريبة والجمارك');assert.equal(cheque.amount,150000);
  assert.equal(cheque.status,'مصروف','the cheque is cashed');assert.equal(cheque.purposeCategory,'سداد ضريبة القيمة المضافة');
  assert.equal(F.operating(state,'air'),cashBefore-150000,'the account pays exactly the tax');
  assert.equal(state.finance.transfers.length,transfersBefore,'no transfer document');
  assert.equal(state.finance.transfers.some(row=>row.kind==='tax-settlement'),false);
  const settlement=state.finance.taxSettlements.find(row=>row.id===paid.settlementId);
  assert.equal(settlement.paymentMethod,'شيك مصرفي');assert.equal(settlement.paymentReference,cheque.id);assert.equal(settlement.chequeId,cheque.id);
  const statement=state.treasury.ledger.find(row=>row.chequeNumber===cheque.id);assert.ok(statement&&statement.paymentMethod==='شيك مصرفي','the bank statement shows the cashed cheque');
  assert.equal(s.GH_DOCUMENT_PROOF.verifyDocument(state,cheque).ok,true,'the cheque stays sealed');assert.equal(s.GH_DOCUMENT_PROOF.verifyDocument(state,settlement).ok,true,'the settlement stays sealed');
  assert.equal(state.finance.periods.find(row=>row.id===period.id).status,'مسدد');
  assert.equal(s.GH_SAVE_SCHEMA.validate(state).ok,true);
  return {invoice:doc.number,due:period.amount,settlement:paid.settlementId};
});

test('older saves: the fleet-purchase VAT credit is reversed once, cash unchanged, the next close is due',()=>{
  const e=scenario(),{s,state,command}=e,F=s.GH_FINANCE_CORE,SCHEMA=s.GH_SAVE_SCHEMA;state.godMoney=true;state.infiniteMoney=true;
  const vat=()=>F.book(state,'air').vat;
  // As saved before: purchases taxed the old way. Month 1 holds a purchase (150,000 VAT), fuel (15,000 VAT, not a
  // purchase) and revenue (30,000 VAT); it closes with a carried credit of 135,000. Month 2 holds another purchase
  // (75,000 VAT) and revenue (45,000 VAT).
  state.simSeconds=10*DAY;
  F.invoice(state,{kind:'مصروف',amount:1150000,note:'شراء 10 × A320neo',taxable:true,status:'مسددة',company:'air',counterparty:'Supplier LLC'});
  F.invoice(state,{kind:'مصروف',amount:115000,note:'تكلفة تشغيل رحلات يومية',taxable:true,status:'مسددة',company:'air',counterparty:'Fuel LLC'});
  command('finance','credit',{company:'air',amount:230000,note:'تسوية رحلات يومية',taxable:true});
  state.simSeconds=31*DAY;const first=command('finance','close-vat-period',{day:30}).find(row=>row.company==='air');
  assert.equal(first.status,'صفر');assert.equal(vat().creditCarry,135000,'the purchase left a carried credit');
  state.simSeconds=40*DAY;
  F.invoice(state,{kind:'مصروف',amount:575000,note:'دفعة إيجار 5 × ATR 72',taxable:true,status:'مسددة',company:'air',counterparty:'Lessor LLC'});
  command('finance','credit',{company:'air',amount:345000,note:'تسوية رحلات يومية',taxable:true});
  assert.equal(F.book(state,'air').taxAccrued,0,'before: the credit hides the VAT on revenue');
  delete state.finance.fleetPurchaseVat;
  const cash=F.operating(state,'air'),journal=state.finance.journalEntries.length;

  // Loading the older save as the app boots it.
  const loaded=boot(s,state),book=()=>F.book(loaded,'air');
  assert.equal(loaded.finance.fleetPurchaseVat,'zero-rated');
  assert.equal(JSON.stringify(loaded.finance.fleetPurchaseVatAdjustment.companies.air),JSON.stringify({open:75000,closed:135000,amount:210000}));
  assert.equal(book().vat.creditCarry,0,'the carried credit is removed up to what it holds');
  assert.equal(book().taxAccrued,45000,'the open period now accrues the VAT on revenue');
  assert.equal(F.operating(loaded,'air'),cash,'cash is unchanged');
  assert.equal(loaded.finance.journalEntries.length,journal+1);
  const entry=loaded.finance.journalEntries[0];assert.equal(entry.company,'air');
  assert.equal(entry.lines.reduce((n,row)=>n+row.debit,0),210000);assert.equal(entry.lines.reduce((n,row)=>n+row.credit,0),210000);
  const once=JSON.stringify(loaded);SCHEMA.normalize(loaded);assert.equal(JSON.stringify(loaded),once,'runs once');
  const checked=SCHEMA.validate(loaded);assert.equal(checked.ok,true,`the save validates: ${checked.errors}`);

  loaded.simSeconds=60*DAY;const second=F.execute({state:loaded},'close-vat-period',{day:58}).find(row=>row.company==='air');
  assert.equal(second.status,'مستحق');assert.equal(second.amount,45000);
  assert.equal(F.execute({state:loaded},'pay-taxes',{company:'air'}).amount,45000);
  return {reversed:210000,due:second.amount};
});

test('the open period loses no more than it holds, and a save without taxed fleet purchases is left untouched',()=>{
  const e=scenario(),{s,state}=e,F=s.GH_FINANCE_CORE;state.godMoney=true;state.infiniteMoney=true;
  state.simSeconds=5*DAY;F.invoice(state,{kind:'مصروف',amount:115000,note:'شراء 1 × A220',taxable:true,status:'مسددة',company:'air',counterparty:'Supplier LLC'});
  F.book(state,'air').vat.input-=10000;delete state.finance.fleetPurchaseVat;
  const loaded=boot(s,state);
  assert.equal(loaded.finance.fleetPurchaseVatAdjustment.companies.air.amount,5000,'bounded by the open input VAT');
  assert.equal(F.book(loaded,'air').vat.input,0);
  // Every game since this build: purchases carry no VAT, so loading changes nothing (save/reload stays exact).
  const clean=scenario();clean.state.godMoney=true;clean.state.infiniteMoney=true;assert.ok(clean.manualPurchase(2));
  const cleanLoaded=boot(clean.s,clean.state),finance=JSON.stringify(cleanLoaded.finance);
  assert.equal(cleanLoaded.finance.fleetPurchaseVat,undefined);assert.equal(cleanLoaded.finance.fleetPurchaseVatAdjustment,undefined);
  clean.s.GH_SAVE_SCHEMA.normalize(cleanLoaded);assert.equal(JSON.stringify(cleanLoaded.finance),finance);
  return {bounded:5000};
});

const passed=results.filter(r=>r.ok).length;
console.log(JSON.stringify({suite:'build358-fleet-purchase-vat',passed,total:results.length,results},null,2));
if(passed!==results.length)process.exitCode=1;

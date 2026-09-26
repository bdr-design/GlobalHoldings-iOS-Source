'use strict';
const assert=require('node:assert/strict');
const {scenario}=require('./helpers/business-scenario.js');
function setup(number){
  const env=scenario();
  env.load('business-world-core');
  env.load('integrity-core');
  const {state:game,s:runtime,command}=env;
  const finance=runtime.GH_FINANCE_CORE;
  game.godMoney=false;
  game.infiniteMoney=false;
  finance.book(game,'air').accounts[0].balance=0;
  finance.reconcile(game);
  game.companyBudgets.air={limit:100,spent:0,reserved:0,period:0,enabled:true,lines:{other:100},spentByLine:{},reservedByLine:{}};
  const doc=command('finance','accrue-expense',{company:'air',amount:200,note:'Contracted operating expense already incurred',method:'قيد مستحق',taxable:false,dueDay:7,number,line:'other'});
  assert.equal(doc.status,'مستحقة');
  assert.equal(doc.budgetReserved,100,'only the available budget may be reserved');
  assert.equal(doc.budgetUnbudgetedAmount,100,'uncovered obligation amount must remain explicit');
  assert.equal(doc.budgetObligation,true);
  assert.equal(finance.operating(game,'air'),0,'booking an obligation must not invent or debit cash');
  assert.equal(game.finance.payables.some(row=>row.number===doc.number),true);
  assert.equal(finance.budget(game,'air').reserved,100);
  assert.equal(finance.budget(game,'air').spent,0);
  assert.equal(finance.remaining(game,'air'),0,'remaining budget must stay unavailable for discretionary spending');
  return {game,runtime,finance,command,doc};
}
{
  const {game,finance,command,doc}=setup('B339-ACCRUAL-TRANSFER');
  const beforeFailedSettlement=JSON.stringify(game);
  assert.throws(()=>command('finance','settle-payable',{number:doc.number,method:'transfer'}),/insufficient-cash/);
  assert.equal(JSON.stringify(game),beforeFailedSettlement,'failed payment must roll back without losing the payable');
  finance.book(game,'air').accounts[0].balance=250;
  finance.reconcile(game);
  assert.equal(finance.canSpend(game,'air',1,'other'),false,'budget reservation must continue to block new spending');
  command('finance','settle-payable',{number:doc.number,method:'transfer'});
  assert.equal(finance.operating(game,'air'),50,'later transfer settlement must debit exact cash once');
  assert.equal(game.finance.payables.some(row=>row.number===doc.number),false);
  assert.equal(game.finance.invoices.find(row=>row.number===doc.number).status,'مسددة');
  assert.equal(finance.budget(game,'air').reserved,0);
  assert.equal(finance.budget(game,'air').spent,100,'only the budgeted portion may enter the capped budget');
  assert.equal(game.finance.invoices.find(row=>row.number===doc.number).budgetUnbudgetedAmount,100);
}
{
  const {game,finance,command,doc}=setup('B339-ACCRUAL-CHEQUE');
  const issued=command('finance','settle-payable',{number:doc.number,method:'cheque'});
  assert.equal(finance.operating(game,'air'),0,'issuing a payable cheque must not debit cash');
  finance.book(game,'air').accounts[0].balance=250;
  finance.reconcile(game);
  const cleared=command('finance','settle-cheque',{id:issued.chequeId});
  assert.equal(cleared.settled,true);
  assert.equal(finance.operating(game,'air'),50,'cheque settlement must debit exact cash once');
  assert.equal(game.finance.payables.some(row=>row.number===doc.number),false);
  assert.equal(finance.budget(game,'air').reserved,0);
  assert.equal(finance.budget(game,'air').spent,100);
}
console.log(JSON.stringify({suite:'build339-accrued-obligation-cash-shortfall',passed:2,total:2},null,2));

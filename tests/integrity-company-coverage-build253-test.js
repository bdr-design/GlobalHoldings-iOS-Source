'use strict';
const assert=require('assert'),fs=require('fs');
const {scenario}=require('./helpers/business-scenario');

// Founding a company must never make the consolidated-cash audit disagree with the books.
// Regression: integrity-core skipped the mobility book, so its paid-in capital vanished from
// the consolidated sum, raised FINANCE_CONSOLIDATED_CASH_MISMATCH and rolled the founding back.
{
  const {s,state,ctx,command,load}=scenario();load('integrity-core');load('mobility-core');
  const types=['sea','road','power','bank','mobility'];
  for(const type of types)command('corporate','open-company',{type,capital:18000000,legalName:`Test ${type}`});
  for(const type of types)assert(state.openedCompanies.includes(type),`${type} must stay founded`);

  const books=Object.values(state.companyFinance||{});
  const consolidated=books.reduce((n,b)=>n+(b.accounts||[]).reduce((m,a)=>m+Number(a.balance||0),0),0);
  assert(Math.abs(consolidated-Number(state.cash))<=.01,'consolidated cash must equal the sum of every company book');

  const report=s.GH_INTEGRITY_CORE.check(state,ctx);
  const critical=report.issues.filter(x=>x.severity==='critical').map(x=>x.id);
  assert.strictEqual(critical.join(', '),'','integrity audit must stay clean after founding every company');

  s.GH_MOBILITY_CORE.launch(ctx);
  const after=s.GH_INTEGRITY_CORE.check(state,ctx).issues.filter(x=>x.severity==='critical').map(x=>x.id);
  assert.strictEqual(after.join(', '),'','mobility launch CAPEX must stay reconciled with the audit');
}

// Structural guard: the audit's company list must cover every company the corporate domain can
// create, plus the holding book. A new sector added without touching integrity-core fails here
// instead of failing silently inside a rolled-back transaction.
{
  const list=(file,name)=>{
    const source=fs.readFileSync(file,'utf8'),start=source.indexOf(name+'=[');
    assert(start>=0,`${name} not found in ${file}`);
    const open=source.indexOf('[',start),close=source.indexOf(']',open);
    assert(close>open,`${name} in ${file} is not a literal array`);
    return source.slice(open+1,close).split(',').map(x=>x.trim().replace(/^['"]|['"]$/g,'')).filter(Boolean);
  };
  const corporate=list('WebApp/corporate-core.js','COMPANY_TYPES');
  const audited=list('WebApp/integrity-core.js','COMPANY_TYPES');
  const finance=list('WebApp/finance-core.js','TYPES');

  assert(audited.includes('group'),'the holding book must be audited');
  for(const type of corporate){
    assert(audited.includes(type),`integrity-core must audit the ${type} book`);
    assert(finance.includes(type),`finance-core must keep a book for ${type}`);
  }
  assert.deepStrictEqual([...audited].sort(),[...new Set(['group',...corporate])].sort(),'the audited company list must match the corporate registry exactly');
}

console.log('INTEGRITY COMPANY COVERAGE GUARD: PASS');

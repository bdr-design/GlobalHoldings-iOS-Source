'use strict';
// Regression coverage for lot-level dividend eligibility, closed-position history and security accounting.
const assert=require('node:assert/strict'),path=require('node:path');
process.env.GH_TEST_SOURCE_DIR=process.env.GH_TEST_SOURCE_DIR||path.resolve(__dirname,'..');
const {scenario}=require('./helpers/business-scenario');
const {s,state,command}=scenario(),M=s.GH_MARKET_CORE,F=s.GH_FINANCE_CORE,P=s.GH_DOCUMENT_PROOF,DAY=86400;
state.market=[{sym:'QA',name:'شركة الاختبار',price:25,marketCap:1000000,pe:10,yield:4,change:0}];state.simSeconds=0;
F.execute({state},'raise-equity',{company:'group',amount:100000,ref:'BUILD369-SEED',note:'رأس مال اختبار'});

// A skipped close still settles each quarter using the ownership on that quarter's record day.
command('market','trade-stock',{sym:'QA',qty:100});
state.simSeconds=91*DAY;command('market','trade-stock',{sym:'QA',qty:100});
state.simSeconds=181*DAY;command('market','trade-stock',{sym:'QA',qty:100});
state.simSeconds=270*DAY;const dividends=command('market','settle-holdings',{day:270}).listedDividends;
assert.deepEqual(JSON.parse(JSON.stringify(dividends.map(row=>({amount:row.amount,periods:row.periods})))),[{amount:150,periods:3}],'period 1 pays 100 shares, period 2 pays 200, period 3 pays 300');
assert.equal(state.finance.transfers.filter(row=>row.kind==='market-security-dividend').length,3);
assert.equal(state.finance.journalEntries.filter(row=>row.sourceRef.startsWith('LISTED-DIV-QA-P')).length,3);
assert.equal(command('market','settle-holdings',{day:270}).listedDividends.length,0,'quarterly settlement is idempotent');

// Closing a position keeps its historical realized result and books sale proceeds as asset recovery plus gain.
state.market[0].price=30;state.simSeconds=280*DAY;const sale=command('market','trade-stock',{sym:'QA',qty:-300});
assert.equal(sale.value,9000);assert.equal(sale.costBasis,7500);assert.equal(sale.realizedGain,1500);
assert.equal(state.portfolio.QA,undefined);assert.equal(state.portfolioBook.QA.realizedIncome,1650,'closed book retains $150 dividends and $1,500 realized gain');
assert.equal(state.portfolioBook.QA.closedDay,280);assert.equal(state.portfolioLots.QA.reduce((sum,lot)=>sum+lot.remaining,0),0);
const transfer=state.finance.transfers.find(row=>row.reference===sale.transferReference);assert(transfer);assert.equal(transfer.kind,'market-security-trade');assert.equal(transfer.costBasis,7500);assert.equal(transfer.realizedGain,1500);assert.equal(P.verifyDocument(state,transfer).ok,true);
const journal=state.finance.journalEntries.find(row=>row.id===transfer.journalEntryId);assert(journal);assert.equal(journal.lines.reduce((sum,row)=>sum+row.debit-row.credit,0),0);
assert.equal(journal.lines.find(row=>row.account==='استثمارات في أوراق مالية مدرجة')?.credit,7500);assert.equal(journal.lines.find(row=>row.account==='أرباح محققة من بيع استثمارات')?.credit,1500);
assert.equal(state.finance.invoices.some(row=>row.sourceRef===sale.reference),false,'a securities sale is not operating revenue');
assert.equal(s.GH_SAVE_SCHEMA.validate(state).ok,true);

// IPO admission requires a balanced ownership table and the exact primary-equity cash transfer.
F.execute({state},'raise-equity',{company:'group',amount:180,ref:'BUILD369-IPO',note:'متحصلات اختبار الطرح'});
const ipoBase={listed:true,ticker:'GH',listedDay:280,issuedPct:18,proceeds:180,offerPrice:10,sharesIssued:18,totalShares:100,marketCap:1180,transferReference:'BUILD369-IPO'};
assert.throws(()=>command('corporate','set-ipo',{...ipoBase,capTable:[{holderId:'founders',label:'المؤسسون',shares:82},{holderId:'public-float',label:'المساهمون العموم',shares:17}]}),/ipo-cap-table-unbalanced/);
assert.equal(state.ipo,undefined,'invalid ownership does not publish');
command('corporate','set-ipo',{...ipoBase,capTable:[{holderId:'founders',label:'المؤسسون',shares:82},{holderId:'public-float',label:'المساهمون العموم',shares:18}]});
assert.equal(state.ipo.capTable.reduce((sum,row)=>sum+row.shares,0),state.ipo.totalShares);assert.equal(s.GH_SAVE_SCHEMA.validate(state).ok,true);

// Legacy portfolio roots migrate to one opening lot without changing share count or average cost.
const legacy={simSeconds:50*DAY,portfolio:{QA:17},portfolioBook:{QA:{avgCost:12.5,acquiredDay:0,lastDividendPeriod:0,realizedIncome:0}}};M.ensure(legacy);
assert.equal(legacy.portfolio.QA,17);assert.deepEqual(JSON.parse(JSON.stringify(legacy.portfolioLots.QA.map(({quantity,remaining,unitCost,acquiredDay})=>({quantity,remaining,unitCost,acquiredDay})))),[{quantity:17,remaining:17,unitCost:12.5,acquiredDay:0}]);

console.log('BUILD369_STOCK_LIFECYCLE_PASS',JSON.stringify({dividends:150,saleBasis:sale.costBasis,realizedGain:sale.realizedGain,closedRealized:state.portfolioBook.QA.realizedIncome,legacyShares:legacy.portfolio.QA,ipoTotalShares:state.ipo.totalShares}));

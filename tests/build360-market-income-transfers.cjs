'use strict';
// Listed dividends, share sales and the group's IPO must reach the holding through durable finance transfers.
const assert=require('node:assert/strict'),path=require('node:path');
process.env.GH_TEST_SOURCE_DIR=process.env.GH_TEST_SOURCE_DIR||path.resolve(__dirname,'..');
const {scenario}=require('./helpers/business-scenario');
const {s,state,command}=scenario(),F=s.GH_FINANCE_CORE,P=s.GH_DOCUMENT_PROOF,DAY=86400;

state.market=[{sym:'QA',name:'شركة الاختبار المدرجة',price:25,marketCap:250000000,pe:12,yield:4,change:1.25}];
state.portfolio={};state.portfolioBook={};state.simSeconds=10*DAY;
F.execute({state},'raise-equity',{company:'group',amount:100000000,ref:'QA-SEED-EQUITY',note:'تمويل اختبار'});

const beforeBuy=F.operating(state,'group'),purchase=command('market','trade-stock',{sym:'QA',qty:1000});
assert.equal(purchase.value,25000);assert.equal(F.operating(state,'group'),beforeBuy-25000);
assert.equal(state.portfolio.QA,1000);assert.equal(state.portfolioBook.QA.acquiredDay,10);

state.simSeconds=100*DAY;const beforeDividend=F.operating(state,'group');
const quarter=command('market','settle-holdings',{day:100}).listedDividends;
assert.equal(quarter.length,1);assert.equal(quarter[0].amount,250);
assert.equal(F.operating(state,'group'),beforeDividend+250);
const dividendTransfer=state.finance.transfers.find(row=>row.reference===quarter[0].reference);
assert(dividendTransfer);assert.equal(dividendTransfer.kind,'market-security-dividend');
assert.equal(P.verifyDocument(state,dividendTransfer).ok,true);
const repeated=command('market','settle-holdings',{day:100});
assert.equal(repeated.listedDividends.length,0);assert.equal(F.operating(state,'group'),beforeDividend+250,'same quarterly dividend cannot arrive twice');

state.simSeconds=190*DAY;const second=command('market','settle-holdings',{day:190}).listedDividends;
assert.equal(second.length,1);assert.equal(second[0].amount,250);

const beforeSale=F.operating(state,'group'),sale=command('market','trade-stock',{sym:'QA',qty:-1000});
assert.equal(sale.value,25000);assert.equal(F.operating(state,'group'),beforeSale+25000);
const saleTransfer=state.finance.transfers.find(row=>row.reference===sale.transferReference);
assert(saleTransfer);assert.equal(saleTransfer.kind,'market-security-trade');assert.equal(saleTransfer.costBasis,25000);assert.equal(saleTransfer.realizedGain,0);assert.equal(P.verifyDocument(state,saleTransfer).ok,true);

const beforeIpo=F.operating(state,'group'),ipo=command('finance','raise-equity',{company:'group',amount:180000000,ref:'IPO-GH-190',source:'مكتتبو الطرح العام',note:'متحصلات الطرح العام الأولي'});
assert.equal(ipo.amount,180000000);assert.equal(F.operating(state,'group'),beforeIpo+180000000);
assert.equal(ipo.transfer.kind,'equity-financing');assert.equal(ipo.transfer.paymentMethod,'حوالة اكتتاب واردة');assert.equal(P.verifyDocument(state,ipo.transfer).ok,true);
const ipoRetry=command('finance','raise-equity',{company:'group',amount:180000000,ref:'IPO-GH-190',source:'مكتتبو الطرح العام',note:'متحصلات الطرح العام الأولي'});
assert.equal(ipoRetry.amount,0);assert.equal(F.operating(state,'group'),beforeIpo+180000000,'IPO retry cannot credit the group twice');
command('corporate','set-ipo',{listed:true,ticker:'GH',listedDay:190,issuedPct:18,proceeds:180000000,offerPrice:100,sharesIssued:1800000,totalShares:10000000,capTable:[{holderId:'founders',label:'المؤسسون',shares:8200000},{holderId:'public-float',label:'المساهمون العموم',shares:1800000}],marketCap:1000000000,transferReference:ipo.ref});
assert.deepEqual({listed:state.ipo.listed,ticker:state.ipo.ticker,transferReference:state.ipo.transferReference},{listed:true,ticker:'GH',transferReference:'IPO-GH-190'});
assert.equal(s.GH_SAVE_SCHEMA.validate(state).ok,true);
console.log('BUILD360_MARKET_INCOME_TRANSFERS_PASS',JSON.stringify({dividends:[quarter[0].amount,second[0].amount],sale:sale.value,ipo:ipo.amount}));

'use strict';
const assert=require('assert'),fs=require('fs'),path=require('path'),vm=require('vm'),acorn=require('acorn');
const {ROOT,harness,minimal}=require('./helpers/core-harness');
const app=fs.readFileSync(path.join(ROOT,'WebApp/app.js'),'utf8');
const functions=new Map();
function walk(node){if(!node||typeof node!=='object')return;if(node.type==='FunctionDeclaration')functions.set(node.id.name,app.slice(node.start,node.end));for(const value of Object.values(node)){if(Array.isArray(value))value.forEach(walk);else if(value&&typeof value==='object')walk(value);}}
walk(acorn.parse(app,{ecmaVersion:'latest'}));
let passed=0;function test(name,fn){fn();passed++;console.log('PASS '+name);}
test('dateline rendering splits both directions including exact boundary endpoints without changing routes',()=>{
 const {s}=harness(['route-core']);
 for(const input of [[[10,179],[20,-179]],[[20,-179],[10,179]],[[0,180],[1,-180]],[[0,-180],[1,180]],[[0,170],[1,-180]],[[0,-170],[1,180]],[[0,10],[1,20]]]){
  const original=JSON.stringify(input),segments=s.GH_ROUTE_CORE.splitAtDateline(input);assert(segments.length>=1);assert.strictEqual(JSON.stringify(input),original);
  for(const segment of segments)for(let i=1;i<segment.length;i++){assert(Math.abs(segment[i][1]-segment[i-1][1])<=180);assert(segment[i].every(Number.isFinite));}
 }
 const context={Math,EARTH_RADIUS_KM:6371,clamp:(x,a,b)=>Math.max(a,Math.min(b,x))};vm.createContext(context);
 for(const name of ['haversine','shortestLongitudeDelta','interpolateRoute'])vm.runInContext(functions.get(name),context);
 for(const input of [[[10,179],[10,-179]],[[10,-179],[10,179]]]){context.route=input;const point=vm.runInContext('interpolateRoute(route,.5)',context);assert(Math.abs(point[1])>179.9,'ship must not cross Greenwich');}
});
test('every sector collection credits its own current account once and links a balanced receivable receipt',()=>{
 const {s}=harness(['finance-core']),F=s.GH_FINANCE_CORE,state=minimal();F.ensure(state);
 for(const company of F.TYPES){const before=F.operating(state,company),other=F.TYPES.filter(t=>t!==company).map(t=>F.operating(state,t)),payload={company,amount:12500,taxable:false,reference:`COL-${company}`,periodDay:5,sourceRefs:[`SERVICE-${company}-5`]};
  const invoice=F.execute(state,'credit',payload),receipt=state.finance.transfers.find(x=>x.reference===payload.reference);assert.strictEqual(F.operating(state,company),before+12500);assert.strictEqual(invoice.status,'محصلة');assert.strictEqual(invoice.transferReference,receipt.reference);assert.strictEqual(receipt.to,F.book(state,company).accounts[0].id);assert(receipt.channel&&receipt.service);assert.strictEqual(receipt.invoiceNumbers[0],invoice.number);assert.strictEqual(state.finance.receivables.length,0);assert.deepStrictEqual(F.TYPES.filter(t=>t!==company).map(t=>F.operating(state,t)),other);
  F.execute(state,'credit',payload);assert.strictEqual(F.operating(state,company),before+12500);assert.throws(()=>F.execute(state,'credit',{...payload,amount:1}),/reference-conflict/);
  state.finance.transfers=state.finance.transfers.filter(x=>x.reference!==payload.reference);F.execute(state,'credit',payload);assert.strictEqual(F.operating(state,company),before+12500,'archive trimming must not allow a repeated daily receipt');
 }
 assert(state.finance.journalEntries.every(j=>Math.abs(j.lines.reduce((n,l)=>n+l.debit-l.credit,0))<.001));
});
test('manual receivable rejects another company and retries safely',()=>{
 const {s}=harness(['finance-core']),F=s.GH_FINANCE_CORE,state=minimal();F.ensure(state);const invoice=F.invoice(state,{company:'road',kind:'دخل',amount:900,status:'مستحقة',taxable:false,counterparty:'عميل نقل'}),before=JSON.stringify(state);
 assert.throws(()=>F.execute(state,'collect-receivable',{number:invoice.number,company:'sea'}),/invalid-receivable/);assert.strictEqual(JSON.stringify(state),before);
 const account=F.book(state,'road').accounts[0],balance=account.balance;F.execute(state,'collect-receivable',{number:invoice.number});F.execute(state,'collect-receivable',{number:invoice.number});assert.strictEqual(account.balance,balance+900);assert.strictEqual(state.finance.transfers.length,1);
});
test('trip batch reconciles gross costs carry and net without duplicating cash after archival',()=>{
 const {s}=harness(['finance-core']),F=s.GH_FINANCE_CORE,state=minimal();F.ensure(state);const account=F.book(state,'road').accounts[0];account.balance=1000;
 const invoice=F.invoice(state,{company:'road',kind:'دخل',amount:100,status:'مدفوعة',taxable:false,settlementAccount:'مركز التسوية التشغيلية اليومية'}),p={company:'road',amount:60,grossAmount:100,deductions:30,invoiceNumbers:[invoice.number],tripCount:2,day:4};
 F.execute(state,'settle-daily-cash',p);assert.strictEqual(account.balance,1060);const transfer=state.finance.transfers[0];assert.strictEqual(transfer.carriedAdjustment,-10);assert.strictEqual(invoice.transferReference,transfer.reference);assert.strictEqual(transfer.grossAmount-transfer.deductions+transfer.carriedAdjustment,transfer.signedAmount);
 F.execute(state,'settle-daily-cash',p);assert.strictEqual(account.balance,1060);state.finance.transfers=[];F.execute(state,'settle-daily-cash',p);assert.strictEqual(account.balance,1060);
 F.execute(state,'settle-daily-cash',{company:'road',amount:-2000,day:5});assert.strictEqual(account.balance,0);assert.strictEqual(state.finance.pendingDailyCash.road,-940);assert.strictEqual(state.finance.transfers[0].shortfall,940);
 const before=JSON.stringify(state);assert.throws(()=>F.execute(state,'settle-daily-cash',{company:'sea',amount:100,day:6,invoiceNumbers:[invoice.number]}),/invalid-settlement-invoices/);assert.strictEqual(JSON.stringify(state),before);
 F.execute(state,'settle-daily-cash',{company:'road',amount:0,grossAmount:200,deductions:200,day:6});assert.strictEqual(account.balance,0);assert.strictEqual(state.finance.transfers[0].amount,0);
});
test('corporate interest is one real debit and credit with a formal bank collection',()=>{
 const {s}=harness(['finance-core']),F=s.GH_FINANCE_CORE,state=minimal();F.ensure(state);F.book(state,'road').accounts[0].balance=1000;const bank=F.operating(state,'bank');
 const p={from:'road',to:'bank',amount:100,reference:'INTEREST-1'};F.execute(state,'settle-intercompany-interest',p);F.execute(state,'settle-intercompany-interest',p);assert.strictEqual(F.operating(state,'road'),900);assert.strictEqual(F.operating(state,'bank'),bank+100);assert.strictEqual(state.finance.transfers.length,1);assert.strictEqual(state.finance.transfers[0].beneficiaryCompany,'bank');
});
test('assigned-only bulk departure remains distinct from all-truck allocation',()=>{
 assert(functions.get('departRouteAssets').includes('asset.type===type&&asset.routeId&&'));assert(app.includes('تشغيل المسارات المعيّنة فقط'));assert(app.includes('تشغيل تلقائي بمسارات عشوائية'));
 assert(functions.get('departRouteAssets').includes('runDurableStateCommand'));assert(functions.get('dispatchExistingDistinctNetwork').includes('throw new Error'));
 const css=fs.readFileSync(path.join(ROOT,'WebApp/styles.css'),'utf8');assert(css.includes('/* Corporate finance separation */'));assert(css.includes('min-height:44px'));
 const swift=fs.readFileSync(path.join(ROOT,'iOS/GlobalHoldings/GlobalGameStorage.swift'),'utf8');assert(swift.includes('Self.trustedUpdateKeys[keyId]'));assert(swift.includes('gh-primary-2026-build310'));assert(!swift.includes('GH_UPDATE_SIGNING_PRIVATE_KEY_B64='));
});
test('Mediterranean ports use their local sea approach and do not shortcut directly to Gibraltar',()=>{
 const context={Math,Map,Set,EARTH_RADIUS_KM:6371,clamp:(x,a,b)=>Math.max(a,Math.min(b,x))};vm.createContext(context);
 for(const name of ['haversine','greatCircle','routeLongestLeg'])vm.runInContext(functions.get(name),context);
 vm.runInContext(app.slice(app.indexOf('  const MARITIME_LANES'),app.indexOf('  function rebuildMaritimeRoute')),context);
 for(const [from,to,first,last] of [[[44.4,8.9],[51.9,4.1],'LIGURIAN','NORTH_SEA'],[[37.94,23.64],[55.7,12.6],'AEGEAN_S','KATTEGAT']]){
  context.from=from;context.to=to;const route=vm.runInContext('buildMaritimeRoute(from,to)',context);assert.strictEqual(route.laneNodes[0],first);assert.strictEqual(route.laneNodes.at(-1),last);assert(route.laneNodes.includes('GIBRALTAR'));assert(route.laneNodes.includes('PORTUGAL_OFFSHORE'));assert(route.laneNodes.includes('DOVER'));assert.strictEqual(route.maritimeGeometryVersion,310);
 }
 context.from=[31.28,32.33];assert.strictEqual(vm.runInContext('maritimeApproach(from).key',context),'MED_EAST');
 const presentation=functions.get('currentAssetRoute');assert(presentation.includes('maritimePresentationCache'));assert(!presentation.includes('tripSeconds='));
});
console.log(`BUILD310 regression checks: ${passed}/7`);

const fs=require('fs'),vm=require('vm'),assert=require('assert');
const code=fs.readFileSync('WebApp/request-core.js','utf8');
const app=fs.readFileSync('WebApp/app.js','utf8'),advanced=fs.readFileSync('WebApp/advanced-core.js','utf8'),html=fs.readFileSync('WebApp/index.html','utf8');
const context={window:{},globalThis:null,structuredClone:v=>JSON.parse(JSON.stringify(v)),console,Math,JSON,Date};context.globalThis=context.window;vm.createContext(context);vm.runInContext(fs.readFileSync('WebApp/transaction-core.js','utf8'),context);vm.runInContext(code,context,{filename:'request-core.js'});const core=context.window.GH_REQUEST_CORE;
assert.strictEqual(core.VERSION,'2.9.0');
assert(html.includes('request-core.js'),'request-core.js is not loaded');
assert(!app.includes('class="primary-btn acquire-asset"'),'direct asset acquisition button returned to market UI');
assert(app.includes('qty=clamp(Math.floor(Number(qty)||1),1,50)'),'buyAsset must execute central request quantities up to 50 exactly');
assert(advanced.includes("state.advanced?.procurement?.assetRequests"),'AI does not account for central open asset requests');
assert(advanced.includes("GH_REQUEST_CORE?.ingestAIProposal")||advanced.includes("GH_REQUEST_CORE.ingestAIProposal"),'AI procurement proposals are not routed to request core');
function state(){return {simSeconds:0,sequences:{},profile:{founder:'Founder'},advanced:{facilities:{'BASE-A':{capacity:50}},procurement:{assetRequests:[],assetRequestArchive:[],assetClosureLog:[],requestCenter:{}},ai:{requests:[],annualPlans:{}}},globalBases:[{id:'BASE-A',name:'Base A',kind:'airport-base',company:'air',owned:true}],customHubs:[],assets:[],crew:[],realism:{procurement:{deliveries:[]}},companyFinance:{},treasury:{},advancedFacilities:{}};}
function ctx(s){return {state:s,assetCatalog:{air:{new:[{id:'A1',name:'Aircraft',price:100,downPayment:.2,leaseMonthly:3}],used:[]},sea:{new:[],used:[]},road:{new:[],used:[]}},companyOperatingBalance:t=>t==='air'?100000:100000,companyFinanceName:t=>t,fmtMoney:n=>String(n),supplierFor:()=>({legalName:'Supplier'}),requiredCrewForFleet:()=>({}),buyAsset:(type,tab,id,mode,qty,baseId,paid,silent,requestRef)=>{for(let i=0;i<qty;i++)s.realism.procurement.deliveries.push({id:`D${i}`,status:'pending',baseId,requestRef,asset:{id:`A${i}`,type}});return 'PO1';},transferBetweenCompanies:()=>true};}
{
 const s=state(),c=ctx(s);const r=core.create(c,{company:'air',tab:'new',catalogId:'A1',baseId:'BASE-A',qty:24,mode:'cash',reason:'test'});assert.strictEqual(r.qty,24);assert(core.authorize(c,r.id));core.tick(c);assert.strictEqual(s.realism.procurement.deliveries.length,24,'central request quantity was not executed completely');assert.strictEqual(r.status,'delivering');
}
{
 const s=state(),c=ctx(s);s.advanced.ai.annualPlans.air={status:'approved',masterLetterId:'PLAN1',budget:150,spent:60};let buys=0;c.buyAsset=()=>{buys++;return 'PO';};const r=core.ingestAIProposal({company:'air',planMasterId:'PLAN1',payload:{type:'air',catalogId:'A1',baseId:'BASE-A',qty:1},quantity:1,cost:100},c);core.tick(c);assert.strictEqual(buys,0,'annual plan executed beyond remaining full budget');assert(r.blockers?.some(x=>x.includes('ميزانية الخطة')),'annual plan budget blocker missing');
}
console.log('Central Asset Request + Demand Closure 2.3.9: PASS');

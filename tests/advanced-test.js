const fs=require('fs');
const vm=require('vm');

const context={window:{},console,Intl,Date,Math,JSON,localStorage:{getItem(){return null},setItem(){},removeItem(){}}};
vm.createContext(context);
for(const file of ['WebApp/facility-core.js','WebApp/corporate-core.js','WebApp/advanced-core.js'])vm.runInContext(fs.readFileSync(file,'utf8'),context,{filename:file});

const state={saveVersion:'1.1.0',profile:{name:'مجموعة الاختبار',city:'الرياض',country:'السعودية',creditRating:'BBB',reputation:55},cash:250000000,debt:84000000,groupValue:412000000,todayProfit:24000,simSeconds:3600,
  assets:[{id:'A1',type:'air',condition:91,routeId:'R1',purchasePrice:62000000,specs:{co2Band:'B'},lastTrip:{margin:12000,revenue:50000,fuelCost:18000,crewCost:9000,maintReserve:2000}}],
  sectorProfitToday:{air:12000,sea:0,road:0,power:33000,bank:22000},hired:[],crew:[{id:'pilots',icon:'P',name:'طيارون',sector:'air',count:8,morale:88,salaryMin:180,salaryMax:320}],unlockedSectors:['air','sea','road','power','bank'],globalBases:[],customHubs:[],branches:[],ownedCompanies:[],stakes:{},insurancePolicies:[],eventLog:[{at:0,text:'اكتملت رحلة اختبار'}],research:{efficiency:0,automation:25,cleanEnergy:50},esg:{environment:55,social:62,governance:70},governance:{boardDecision:'pending'},
  energy:{gasMW:350,solarMW:220,windMW:80,storageMWh:1600,availability:94.6},bank:{branches:1,deposits:320000000,loans:210000000,npl:1.9,capitalRatio:16.4},alerts:[]};
context.window.GH_ADVANCED.migrate(state);
const facility={id:'HQ-RUH',kind:'hq',owned:true,name:'المقر العالمي',city:'الرياض',country:'السعودية',cost:0,dailyCost:12000};
const ctx={state,fmtMoney:v=>`$${Math.round(v)}`,fmtNumber:v=>String(Math.round(v||0)),formatDuration:v=>`${Math.round(v)}s`,esc:v=>String(v),typeName:v=>v,facilityKind:v=>v,findFacility:id=>id===facility.id?facility:null,competitors:[{id:'C1',name:'منافس',sector:'لوجستيات',hq:'دبي',risk:'متوسط',revenue:100000000,ebitda:18000000,debt:12000000,price:80000000}],assetCatalog:{},WORLD:{meta:{}},storageKey:'test',legacyStorageKeys:[],canSpend:()=>true,spend:()=>true,pushAlert:()=>{},save:()=>{},updateKpis:()=>{},renderMap:()=>{},openDrawer:()=>{}};

const panels=['leadershipHub','actionCenter','governanceHub','systemHub','aiApprovals','programs','diagnostics','companies','more','intelligence','treasury','audit','legal','procurement','cyber','safety','energy','bank','governance','insurance','research','esg','career','news','labor','ma','settings','updates'];
for(const panel of panels){const html=context.window.GH_ADVANCED.render(panel,undefined,ctx);if(typeof html!=='string'||html.length<100)throw new Error(`${panel}: renderer did not return a complete view`);}
if(!context.window.GH_ADVANCED.render('facilityManage',{id:'HQ-RUH',tab:'command'},ctx).includes('المقر العالمي'))throw new Error('facility management renderer failed');
if(!context.window.GH_ADVANCED.render('companyManage',{type:'air',tab:'finance'},ctx).includes('المالية المستقلة'))throw new Error('company management renderer failed');
const econSrc=fs.readFileSync('WebApp/economics-core.js','utf8');vm.runInContext(econSrc,context);const sector=context.window.GH_ECONOMICS_CORE.sectorEconomics(state);if(!Number.isFinite(sector.power)||!Number.isFinite(sector.bank))throw new Error('sector economics returned invalid values');
const trip=context.window.GH_ADVANCED.adjustTripEconomics(state,state.assets[0],{revenue:50000,fuelCost:18000,crewCost:9000,maintReserve:2000,margin:21000,hours:2});if(!Number.isFinite(trip.margin)||!trip.modifiers)throw new Error('institutional decisions are not connected to trip economics');
console.log(`Global Holdings advanced systems: PASS (${panels.length+2} views)`);

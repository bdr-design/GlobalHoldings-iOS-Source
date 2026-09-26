'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const {scenario}=require('./helpers/business-scenario');
const ROOT=path.resolve(__dirname,'..'),app=fs.readFileSync(path.join(ROOT,'WebApp/app.js'),'utf8'),results=[];
function fragment(start,end){const a=app.indexOf(start),b=app.indexOf(end,a);assert(a>=0&&b>a,`${start} -> ${end}`);return app.slice(a,b);}
const EXPECTED={
  1:['acceptedContracts','advanced','assets','bank','businessWorld','cash','companyBudgets','companyFinance','contractStartDays','documentProofs','domainRuntime','failedBids','finance','groupValue','lastClosedProfit','lastClosedSectorProfit','lastFinancialDay','mobility','operations','profile','realism','todayProfit','treasury'],
  26:['alerts','businessWorld','cash','companyBudgets','companyFinance','documentProofs','domainRuntime','eventLog','finance','groupValue','lastClosedProfit','lastClosedSectorProfit','lastFinancialDay','operations','realism','sequences','treasury'],
  30:['alerts','businessWorld','cash','companyBudgets','companyFinance','documentProofs','domainRuntime','eventLog','finance','groupValue','lastFinancialDay','operations','realism','sequences','treasury']
};
function installDayOwner(){
  const e=scenario();for(const name of ['strategy-core','business-world-core','conference-core','advanced-core','economics-core','banking-core','contracts-core','company-adapters-core'])e.load(name);
  e.manualPurchase(1);e.s.GH_REALISM.onSimulationTime(e.state,60);e.s.GH_ADVANCED.migrate(e.state);
  const {s,state}=e;state.simSeconds=86400;state.lastFinancialDay=0;state.lastMarketHour=23;
  Object.assign(s,{state,COMPANY_PLATFORM:s.GH_COMPANY_PLATFORM,SIM_START:Date.UTC(2026,0,1),contracts:[],candidates:[],
    assetOwnerCompanyId:a=>String(a?.ownerCompanyId||a?.companyId||s.GH_COMPANY_PLATFORM.ownerForLegacyAssetMode?.(String(a?.assetMode||a?.type||''))||'').trim(),
    facilityOwnerCompanyId:f=>String(f?.ownerCompanyId||f?.companyId||f?.company||'group').trim(),
    companyDefinition:id=>s.GH_COMPANY_PLATFORM.definitionFor?.(state,id)||s.GH_COMPANY_PLATFORM.getDefinition?.(id)||null,
    getDynamicFacilities:()=>[...(state.globalBases||[]),...(state.customHubs||[])],fmtMoney:v=>`$${Number(v||0).toFixed(0)}`,
    nextId:p=>s.GH_DETERMINISM.nextId(state,p),updateKpis:()=>{},dispatchSystemCommand:(ctx,d,n,p,o)=>s.GH_DOMAIN_COMMANDS.dispatchSystem(ctx,d,n,p,o)});
  vm.runInContext(`
function companyTypes(target=state,options={}){return COMPANY_PLATFORM.listInstances(target,{includeGroup:false,openedOnly:options.openedOnly===true}).filter(company=>(options.registeredOnly!==true||company.registered||company.opened)&&(options.operationalOnly!==true||company.operational)).map(company=>company.id);}
function companyFinanceTypes(target=state,options={}){const ids=COMPANY_PLATFORM.listInstances(target,{includeGroup:true,openedOnly:options.openedOnly===true,capability:'finance.book'}).filter(company=>(company.id==='group'||company.registered||company.opened)&&(options.operationalOnly!==true||company.operational)).map(company=>company.id);return ids.includes('group')?['group',...ids.filter(id=>id!=='group')]:ids;}
const isFinanceCompany=(value,target=state,options={})=>companyFinanceTypes(target,options).includes(String(value||''));
const operationalCompanyInstances=(target=state)=>COMPANY_PLATFORM.listInstances(target,{includeGroup:false,openedOnly:true}).filter(company=>company.operational);
const operationalCompanyIds=(target=state)=>operationalCompanyInstances(target).map(company=>company.id);
const companyHasCapability=(target,companyId,capability)=>COMPANY_PLATFORM.hasCapability?.(target,companyId,capability)===true;
const companyTaxable=(target,companyId)=>COMPANY_PLATFORM.definitionFor?.(target,companyId)?.finance?.vatEnabled!==false;
const zeroCompanyMap=(target=state)=>Object.fromEntries(operationalCompanyIds(target).map(companyId=>[companyId,0]));
function uniqueOperationalCompanyForCapability(target,capability){const matches=operationalCompanyInstances(target).filter(company=>company.definition?.capabilities?.includes(capability));return matches.length===1?matches[0].id:null;}
function resolveOperationalCompanyForSector(target,sector,explicitCompanyId=null){sector=String(sector||'').trim();explicitCompanyId=String(explicitCompanyId||'').trim();if(explicitCompanyId){const company=COMPANY_PLATFORM.resolveCompany(target,explicitCompanyId),sectors=COMPANY_PLATFORM.getSectorIds?.(target,explicitCompanyId)||[];return company?.operational&&(!sector||sectors.includes(sector))?explicitCompanyId:null;}const matches=operationalCompanyInstances(target).filter(company=>(company.definition?.classification?.sectorIds||[]).includes(sector));return matches.length===1?matches[0].id:null;}
function contractOwnerCompanyId(contract,target=state){const registry=target.contractRegistry?.[contract?.id]||{},explicit=contract?.ownerCompanyId||contract?.companyId||registry.ownerCompanyId||registry.companyId||registry.company;return resolveOperationalCompanyForSector(target,contract?.sector,explicit);}
const isMobilityCompany=(companyId,target=state)=>COMPANY_PLATFORM.hasCapability?.(target,companyId,'operations.mobility')===true;
const companyFinanceName=type=>window.GH_IDENTITY?.legalName?.(state,type)||(type==='group'?state.profile.name:(state.companyRegistry?.[type]?.legalName||typeName(type)));
const companyOperatingBalance=type=>window.GH_FINANCE_CORE.operating(state,type);const companyOperatingBalanceFor=(target,type)=>window.GH_FINANCE_CORE.operating(target,type);
function reconcileConsolidatedCash(){return window.GH_FINANCE_CORE.reconcile(state);}
function transferBetweenCompaniesSystem(target,from,to,amount,note,actor='financial-close'){const out=dispatchSystemCommand({state:target},'finance','transfer',{from,to,amount,note},{actor});return out.ok&&out.result?.transferred===true;}
const validMoney=amount=>Number.isFinite(Number(amount))&&Number(amount)>=0;
function typeName(type){const definition=companyDefinition(type);return definition?.identity?.trade?.ar||definition?.identity?.trade?.en||({air:'طيران',sea:'شحن بحري',road:'نقل بري',power:'طاقة',bank:'خدمات مالية',mobility:'تنقل ذكي حسب الطلب'})[type]||'قطاع متنوع';}
function pushAlert(text){const result=dispatchSystemCommand({state},'operations','record-alert',{id:nextId('EV'),text,type:'operation'},{actor:'system-ui-notification'});if(!result?.ok)throw new Error('Operations alert owner unavailable');return true;}
function postInvoice(kind,amount,note,method='تحويل بنكي',taxable=true,status='مدفوعة',company='group',counterparty='',details={}){return window.GH_FINANCE_CORE.invoice(state,{kind,amount,note,method,taxable,status,company,counterparty,...details});}
function postAccruedExpense(company,amount,note,method='قيد مستحق',dueDay=null,number=null,expenseAccount='مصروف تشغيلي'){company=String(company||'');amount=Math.max(0,Number(amount)||0);if(!isFinanceCompany(company)||amount<=0)return null;if(number){const existing=state.finance.invoices.find(x=>x.number===String(number));if(existing)return existing;}try{return dispatchSystemCommand({state},'finance','accrue-expense',{company,amount,note,method,dueDay,number,expenseAccount},{actor:'financial-close'}).result||null;}catch(_error){return null;}}
function settleCheque(cheque){return dispatchSystemCommand({state},'finance','settle-cheque',{id:cheque?.id},{actor:'finance-scheduler'}).result;}
function spendCompanySystem(company,amount,note='مصروف تشغيلي',method='تحويل بنكي',taxable=true){if(!validMoney(Number(amount)))return false;const out=dispatchSystemCommand({state},'finance','spend',{company,amount,note,method:method==='نقدي'?'تحويل بنكي':method,taxable},{actor:'financial-close'});return !!out.result;}
`,s);
  vm.runInContext(fragment('  function simulationCalendarDate','  function processMarket(processedHour=null){'),s,{filename:'app-day-owner.js'});vm.runInContext('globalThis.__processFinancialDay=processFinancialDay',s);return e;
}
function commitDay(e,day,audit=false,lateFailure=false){const {s,state}=e;state.simSeconds=day*86400;return s.GH_TRANSACTION_CORE.execute(state,{label:`build339-day-${day}`,auditWrites:audit,apply:()=>{s.__processFinancialDay(day);if(lateFailure)s.GH_TRANSACTION_CORE.afterCommit(()=>{throw new Error('build339-day-late-failure');},{critical:true,key:'build339-day-late-failure',owner:'build339-day-contract',priority:100});}});}
function test(name,fn){try{results.push({name,ok:true,detail:fn()});}catch(error){results.push({name,ok:false,error:String(error.stack||error)});}}
test('actual daily close publishes stable normal/payroll/month-end root maps',()=>{const e=installDayOwner(),sampled={};for(let day=1;day<=30;day++){const audit=[1,26,30].includes(day);const out=commitDay(e,day,audit);assert.equal(out.committed,true);if(audit)sampled[day]=structuredClone(e.s.GH_TRANSACTION_CORE.telemetry().last.writeAudit);}for(const day of [1,26,30])assert.deepEqual(sampled[day].mutatedRoots,EXPECTED[day],`day ${day} write-map drift`);assert.equal(e.s.GH_INTEGRITY_CORE.check(e.state).status,'healthy');assert.equal(e.state.finance.dailyCompanyReports.length,30);assert.equal(e.state.finance.payrollReports.length,1);return sampled;});
test('month-end late critical failure rolls every day mutation back byte-equivalent',()=>{const e=installDayOwner();for(let day=1;day<30;day++)commitDay(e,day,false);e.state.simSeconds=30*86400;const before=JSON.stringify(e.state);assert.throws(()=>commitDay(e,30,true,true),/build339-day-late-failure/);assert.equal(JSON.stringify(e.state),before);const audit=e.s.GH_TRANSACTION_CORE.telemetry().last.writeAudit;assert.deepEqual(audit.mutatedRoots,EXPECTED[30]);assert.equal(audit.stage,'failure-before-rollback');return audit;});
const union=[...new Set(Object.values(EXPECTED).flat())].sort(),passed=results.filter(row=>row.ok).length;console.log(JSON.stringify({suite:'build339-day-boundary-write-map',passed,total:results.length,days:Object.keys(EXPECTED),union,results},null,2));if(passed!==results.length)process.exitCode=1;

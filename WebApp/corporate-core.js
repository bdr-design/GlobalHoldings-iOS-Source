(()=>{'use strict';
const VERSION='2.9.1',num=v=>Math.max(0,Number(v)||0),now=s=>Number(s.simSeconds)||0;
const COMPANY_TYPES=['air','sea','road','power','bank','mobility'];
function ensure(s){s.companyRegistry=s.companyRegistry&&typeof s.companyRegistry==='object'?s.companyRegistry:{};s.openedCompanies=Array.isArray(s.openedCompanies)?s.openedCompanies:[];s.unlockedSectors=Array.isArray(s.unlockedSectors)?s.unlockedSectors:[];s.stakes=s.stakes&&typeof s.stakes==='object'?s.stakes:{};s.maDeals=s.maDeals&&typeof s.maDeals==='object'?s.maDeals:{};s.advanced=s.advanced||{};s.advanced.companies=s.advanced.companies&&typeof s.advanced.companies==='object'?s.advanced.companies:{};return s;}
function model(s,type){ensure(s);return s.advanced.companies[type]||(s.advanced.companies[type]={budget:25000000,serviceLevel:86,riskLimit:72,automation:48,growthTarget:8,capitalPlan:0,customerScore:82,lastDecision:0,upgradeCooldowns:{},history:[]});}
function validate(ctx,cmd,p={}){const s=ctx.state||ctx;ensure(s);if(cmd==='open-company'&&!COMPANY_TYPES.includes(p.type))return {ok:false,reason:'invalid-company'};if(['decision','rename-company'].includes(cmd)&&!s.companyRegistry[p.type])return {ok:false,reason:'company-not-found'};return true;}
function execute(ctx,cmd,p={}){const s=ctx.state||ctx;ensure(s);
 if(cmd==='found-group'){
  if(s.onboardingComplete)throw new Error('group-already-founded');
  if(!p.profile?.name||!p.registry?.formationContract)throw new Error('founding-identity-invalid');
  s.profile={...p.profile};s.companyRegistry={group:{...p.registry}};s.groupValue=num(p.capital);
  s.openedCompanies=[];s.unlockedSectors=[];s.ownedCompanies=[];s.stakes={};s.maDeals={};
  s.onboardingComplete=true;return {profile:s.profile,registry:s.companyRegistry.group};
 }
 if(cmd==='acquire-stake'){
  const a=num(p.amount),id=String(p.id||''),target=Math.max(0,Math.min(100,Number(p.stake)||0));
  if(!id||a<=0||target<=0)throw new Error('invalid-acquisition');
  const current=Number(s.stakes[id])||0;if(target<=current)throw new Error('stake-not-increased');
  const F=globalThis.GH_FINANCE_CORE;if(!F?.execute)throw new Error('finance-core-missing');
  F.execute({state:s},'spend',{company:'group',amount:a,note:`استحواذ ${target}% · ${p.name||id}`,method:'تحويل استحواذ',taxable:false,line:'capex'});
  s.stakes[id]=target;const deal=s.maDeals[id]||(s.maDeals[id]={stage:'screening',dd:null,offer:null,integration:0});
  deal.offer={at:now(s),target,cost:a,premium:Number(p.premium)||1};deal.stage=target>=51?'integration':'investment';
  if(target>=51){s.ownedCompanies=Array.isArray(s.ownedCompanies)?s.ownedCompanies:[];if(!s.ownedCompanies.includes(id))s.ownedCompanies.push(id);deal.integration=Math.max(20,Number(deal.integration)||0);}
  s.groupValue=num(s.groupValue)+a*.72+num(p.synergy)*2;
  return {id,name:p.name||id,stake:target,amount:a,acquiredAt:now(s),status:target>=51?'سيطرة':'استثمار'};
 }
 if(cmd==='open-company'){
  const type=p.type;if(s.openedCompanies.includes(type))return s.companyRegistry[type];const capital=num(p.capital);if(capital<=0)throw new Error('invalid-capital');
  const F=globalThis.GH_FINANCE_CORE;if(!F)throw new Error('finance-core-missing');F.execute({state:s},'transfer',{from:'group',to:type,amount:capital,note:p.note||`رأس مال مدفوع لتأسيس ${p.legalName||type}`});
  s.openedCompanies.push(type);if(!s.unlockedSectors.includes(type))s.unlockedSectors.push(type);s.groupValue=num(s.groupValue)+num(p.groupValueAdd||capital*.82);
  const rec={...(s.companyRegistry[type]||{}),legalName:p.legalName||p.name||type,owner:p.owner||s.profile?.name||'المجموعة',authorizedSignatory:p.authorizedSignatory||s.profile?.founder||'المؤسس',logo:p.logo??null,logoStyle:p.logoStyle||type,legalForm:p.legalForm||'شركة تابعة مملوكة للمجموعة',currency:p.currency||s.profile?.currency||'USD',procurementPolicy:p.procurementPolicy||s.profile?.procurementPolicy||'competitive',riskAppetite:p.riskAppetite||s.profile?.riskAppetite||'balanced',taxId:p.taxId||'',commercialRegistration:p.commercialRegistration||'',businessLicense:p.businessLicense||'',formationContract:p.formationContract||'',incorporatedAt:now(s),paidInCapital:capital,budget:capital,bankAccount:F.book(s,type).accounts[0].id,incorporationChecklist:Array.isArray(p.incorporationChecklist)?p.incorporationChecklist:['السجل التجاري','الملف الضريبي','الحساب البنكي','تفويض التوقيع','سياسة المشتريات','خطة التوظيف'],invoiceSequence:1,invoices:Array.isArray(p.invoices)?p.invoices:[]};s.companyRegistry[type]=rec;model(s,type);return rec;
 }
 if(cmd==='rename-company'){const type=p.type,name=String(p.legalName||'').trim();if(!name)throw new Error('invalid-company-name');s.companyRegistry[type].legalName=name;if(type==='group'&&s.profile)s.profile.name=name;for(const a of (s.assets||[]))if(a.type===type)a.company=name;if(s.bank?.corporateClients?.[type])s.bank.corporateClients[type].name=name;globalThis.GH_FINANCE_CORE?.execute?.({state:s},'refresh-identity',{company:type});return s.companyRegistry[type];}
 if(cmd==='set-logo'){if(!s.companyRegistry[p.type])throw new Error('company-not-found');s.companyRegistry[p.type].logo=p.logo||null;if(p.type==='group'&&s.profile)s.profile.logo=p.logo||null;globalThis.GH_FINANCE_CORE?.execute?.({state:s},'refresh-identity',{company:p.type});return s.companyRegistry[p.type];}
 if(cmd==='unlock-sector'){const type=String(p.type||'');if(!COMPANY_TYPES.includes(type))throw new Error('invalid-company');if(!s.unlockedSectors.includes(type))s.unlockedSectors.push(type);return [...s.unlockedSectors];}
 if(cmd==='adjust-group-value'){const delta=Number(p.delta)||0;s.groupValue=Math.max(0,(Number(s.groupValue)||0)+delta);return s.groupValue;}
 if(cmd==='set-credit-rating'){s.profile=s.profile||{};s.profile.creditRating=String(p.grade||'BBB');return s.profile.creditRating;}
 if(cmd==='set-reputation'){s.profile=s.profile||{};s.profile.reputation=Math.max(0,Math.min(100,Number(p.value)||0));return s.profile.reputation;}
 if(cmd==='set-ipo'){s.ipo={listed:!!p.listed,ticker:String(p.ticker||'GH').toUpperCase()};return s.ipo;}
 if(cmd==='decision'){
   const type=p.type,m=model(s,type),id=p.action,cost=num(p.cost),F=globalThis.GH_FINANCE_CORE;if(cost)F.execute({state:s},'spend',{company:type,amount:cost,note:`قرار ${id} · ${s.companyRegistry[type]?.legalName||type}`,method:'تحويل بنكي',line:id==='company-capex'?'capex':'other'});
   if(id==='company-budget'){F.execute({state:s},'transfer',{from:'group',to:type,amount:num(p.amount||5000000),note:`تمويل تشغيلي إلى ${s.companyRegistry[type]?.legalName||type}`});m.budget+=num(p.amount||5000000);}
   if(id==='company-service'){m.serviceLevel=Math.min(100,m.serviceLevel+5);m.customerScore=Math.min(100,m.customerScore+4);}
   if(id==='company-automation')m.automation=Math.min(100,m.automation+8);
   if(['company-service','company-automation'].includes(id))m.upgradeCooldowns[id]=now(s);
   if(id==='company-capex'){m.capitalPlan+=num(p.capitalPlanAdd||10000000);m.budget+=num(p.budgetAdd||2500000);s.groupValue=num(s.groupValue)+num(p.groupValueAdd||5500000);}
   if(id==='company-risk')m.riskLimit=Math.max(35,m.riskLimit-5);
   m.lastDecision=now(s);m.history.unshift({at:now(s),action:id});m.history=m.history.slice(0,50);return m;
 }
 if(cmd==='set-stake'){const pct=Math.max(0,Math.min(100,Number(p.percent)||0));s.stakes[p.id]=pct;const d=s.maDeals[p.id]||(s.maDeals[p.id]={});d.stage=pct>=100?'owned':pct>=51?'control':pct>0?'minority':'none';return pct;}
 if(cmd==='record-dd'){const d=s.maDeals[p.id]||(s.maDeals[p.id]={});d.dd={...p.data,at:now(s)};d.stage='diligence';return d.dd;}
 throw new Error(`Unknown corporate command: ${cmd}`);
}
const API={VERSION,COMPANY_TYPES,ensure,model,validate,execute};globalThis.GH_CORPORATE_CORE=API;globalThis.GH_DOMAIN_COMMANDS?.register?.('corporate',API);if(globalThis.window&&window!==globalThis)window.GH_CORPORATE_CORE=API;if(typeof module!=='undefined'&&module.exports)module.exports=API;
})();

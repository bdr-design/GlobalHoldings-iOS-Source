(()=>{'use strict';
const VERSION='3.0.0',num=v=>Math.max(0,Number(v)||0),now=s=>Number(s.simSeconds)||0;
function ensure(s){s.globalBases=Array.isArray(s.globalBases)?s.globalBases:[];s.customHubs=Array.isArray(s.customHubs)?s.customHubs:[];s.branches=Array.isArray(s.branches)?s.branches:[];s.advanced=s.advanced||{};s.advanced.facilities=s.advanced.facilities&&typeof s.advanced.facilities==='object'?s.advanced.facilities:{};s.energy=s.energy||{};return s;}
function all(s){ensure(s);return [...s.globalBases,...s.customHubs];}
function find(s,id){return all(s).find(x=>x.id===id)||null;}
function model(s,f){ensure(s);if(!f)return null;const cap=Number(f.bays||f.capacityMW||parseFloat(f.capacity)||24)||24;const m=s.advanced.facilities[f.id]||(s.advanced.facilities[f.id]={});m.level=Math.max(1,Number(m.level)||1);m.staff=num(m.staff);m.capacity=Math.max(1,Number(m.capacity)||cap);m.utilization=Math.max(0,Math.min(100,Number(m.utilization)||0));m.serviceLevel=Math.max(0,Math.min(100,Number(m.serviceLevel)||88));m.maintenance=Math.max(0,Math.min(100,Number(m.maintenance)||88));m.safety=Math.max(0,Math.min(100,Number(m.safety)||91));m.compliance=Math.max(0,Math.min(100,Number(m.compliance)||86));m.security=Math.max(0,Math.min(100,Number(m.security)||84));m.budget=num(m.budget);m.history=Array.isArray(m.history)?m.history:[];m.tasks=Array.isArray(m.tasks)?m.tasks:[];m.slaContracts=Array.isArray(m.slaContracts)?m.slaContracts:[];m.departments=m.departments&&typeof m.departments==='object'?m.departments:{operations:70,maintenance:70,security:70,finance:70};m.manager=m.manager||f.manager||'مدير المنشأة';return m;}
function log(s,m,text){m.lastAction=now(s);m.history.unshift({at:m.lastAction,text});m.history=m.history.slice(0,40);return text;}
function ownerCompany(f){return f?.company||(['airport','airport-base'].includes(f?.kind)?'air':['port','port-base'].includes(f?.kind)?'sea':['logistics','depot'].includes(f?.kind)?'road':f?.kind==='power'?'power':f?.kind==='bank'?'bank':'group');}
const DIRECTORY_KIND_BY_COMPANY=Object.freeze({road:'logistics',power:'power',bank:'bank',mobility:'mobility-center'});
function verifyDirectorySite(payload={},expectedCompany=''){
 const source=payload?.site&&typeof payload.site==='object'?payload.site:payload?.facility&&typeof payload.facility==='object'?payload.facility:payload;
 const company=String(expectedCompany||source?.company||'').trim(),capitalId=String(source?.capitalId||'').trim(),key=String(source?.directorySiteKey||source?.sourceKey||source?.key||'').trim();
 if(!DIRECTORY_KIND_BY_COMPANY[company])throw new Error('directory-site-company-invalid');
 if(!capitalId||key!==`site:${company}:${capitalId}`)throw new Error('directory-site-key-invalid');
 const capital=globalThis.GH_MOBILITY_CORE?.capitalMeta?.(capitalId);
 if(!capital)throw new Error('directory-site-capital-invalid');
 const coords=source?.coords;
 if(!Array.isArray(coords)||coords.length!==2||!coords.every(Number.isFinite)||Math.abs(coords[0]-capital.coords[0])>1e-7||Math.abs(coords[1]-capital.coords[1])>1e-7)throw new Error('directory-site-coordinates-invalid');
 if(String(source.city||'')!==capital.city||String(source.country||'')!==capital.country)throw new Error('directory-site-identity-invalid');
 if(source.company&&source.company!==company)throw new Error('directory-site-company-mismatch');
 if(source.kind&&source.kind!=='company-site'&&source.kind!==DIRECTORY_KIND_BY_COMPANY[company])throw new Error('directory-site-kind-mismatch');
 return Object.freeze({key,sourceKey:key,company,capitalId,city:capital.city,country:capital.country,coords:[...capital.coords],facilityKind:DIRECTORY_KIND_BY_COMPANY[company]});
}
function directoryCompanyForFacility(f){for(const [company,kind] of Object.entries(DIRECTORY_KIND_BY_COMPANY))if(f?.kind===kind)return company;if(f?.kind==='depot')return 'road';return null;}
function canonicalFacility(state,p={}){
 const input=p.facility;if(!input||typeof input!=='object'||!input.id)throw new Error('invalid-or-duplicate-facility');
 const row={...input,owned:input.owned!==false},company=directoryCompanyForFacility(row);
 if(!company)return row;
 if(row.company!==company||row.kind!==DIRECTORY_KIND_BY_COMPANY[company])throw new Error('directory-facility-owner-invalid');
 if(!(state.openedCompanies||[]).includes(company))throw new Error('directory-facility-company-not-open');
 const site=verifyDirectorySite(row,company);
 if(all(state).some(existing=>existing.sourceKey===site.key||(existing.company===company&&existing.capitalId===site.capitalId&&existing.kind===site.facilityKind)))throw new Error('directory-facility-already-open');
 return {...row,sourceKey:site.key,capitalId:site.capitalId,company:site.company,kind:site.facilityKind,city:site.city,country:site.country,coords:[...site.coords]};
}
function finance(){const f=globalThis.GH_FINANCE_CORE;if(!f?.execute)throw new Error('finance-core-missing');return f;}
function value(s,delta){const c=globalThis.GH_CORPORATE_CORE;if(!c?.execute)throw new Error('corporate-core-missing');return c.execute({state:s},'adjust-group-value',{delta});}
function spend(s,company,amount,note){if(num(amount)<=0)return true;finance().execute({state:s},'spend',{company,amount,note,method:'تحويل بنكي',line:'capex'});return true;}
function purchase(s,company,amount,note,beneficiary){if(num(amount)<=0)return null;return finance().execute({state:s},'pay-by-cheque',{company,amount,note,beneficiary,line:'capex'});}
function validate(ctx,cmd,p={}){const s=ctx.state||ctx;ensure(s);const f=p.id?find(s,p.id):null;if(['close','budget','optimize','recovery','maintenance','expand','hire','audit','contract','task','task-done'].includes(cmd)&&!f)return {ok:false,reason:'facility-not-found'};if(cmd==='close'&&(s.assets||[]).some(a=>a.baseFacility===p.id))return {ok:false,reason:'facility-has-assets'};if(cmd==='create'){if(!p.facility?.id||find(s,p.facility.id))return {ok:false,reason:'invalid-or-duplicate-facility'};try{canonicalFacility(s,p);}catch(error){return {ok:false,reason:String(error?.message||error)};}}return true;}
function execute(ctx,cmd,p={}){const s=ctx.state||ctx;ensure(s);const f=p.id?find(s,p.id):null,m=f?model(s,f):null;
 if(cmd==='create'){const row=canonicalFacility(s,p);if(find(s,row.id))throw new Error('invalid-or-duplicate-facility');const bucket=p.bucket==='customHubs'||['logistics','power','bank','mobility-center','hq'].includes(row.kind)?s.customHubs:s.globalBases;bucket.push(row);model(s,row);if(num(p.groupValueAdd))value(s,num(p.groupValueAdd));return row;}
 if(cmd==='open-regional-hq'){const id=String(p.id||'');if(!id)throw new Error('facility-id-required');s.branches=Array.isArray(s.branches)?s.branches:[];if(s.branches.includes(id))throw new Error('facility-already-open');s.branches.push(id);value(s,num(p.groupValueAdd));return {id,openedAt:now(s)};}
 if(cmd==='close'){const company=p.company||ownerCompany(f),settlement=num(p.settlement);if(settlement)spend(s,company,settlement,`تسوية إغلاق ${f.name||f.id}`);s.globalBases=s.globalBases.filter(x=>x.id!==f.id);s.customHubs=s.customHubs.filter(x=>x.id!==f.id);delete s.advanced.facilities[f.id];return true;}
 if(cmd==='budget'){spend(s,p.company||ownerCompany(f),num(p.cost||2000000),`تعزيز ميزانية ${f.name}`);m.budget+=num(p.amount||2000000);return log(s,m,'تم تعزيز ميزانية التشغيل.');}
 if(cmd==='optimize'){spend(s,p.company||ownerCompany(f),num(p.cost||250000),`تحسين جدولة ${f.name}`);m.utilization=Math.min(96,m.utilization+4);m.serviceLevel=Math.min(99,m.serviceLevel+2);return log(s,m,'نفذت الإدارة تحسين الجدولة.');}
 if(cmd==='recovery'){spend(s,p.company||ownerCompany(f),num(p.cost||250000),`خطة إنقاذ ${f.name}`);m.utilization=Math.min(60,m.utilization+14);m.serviceLevel=Math.min(88,m.serviceLevel+8);m.maintenance=Math.min(100,m.maintenance+4);return log(s,m,'بدأت خطة إنقاذ تشغيلية تحت رقابة الإدارة.');}
 if(cmd==='maintenance'){spend(s,p.company||ownerCompany(f),num(p.cost||1000000),`صيانة وقائية ${f.name}`);m.maintenance=Math.min(100,m.maintenance+9);m.safety=Math.min(100,m.safety+2);return log(s,m,'أغلق برنامج صيانة وقائية.');}
 if(cmd==='expand'){const cost=num(p.cost||12000000),payment=purchase(s,p.company||ownerCompany(f),cost,`توسعة ${f.name}`,p.contractor||`مقاول توسعة ${f.name}`);m.level++;if(p.addCapacity!=null)m.capacity=Math.max(m.capacity,Number(p.currentCapacity)||0)+Math.max(1,Number(p.addCapacity)||1);else m.capacity=Math.round(m.capacity*Math.max(1.01,Number(p.factor)||1.25));m.budget+=num(p.budgetAdd||3000000);value(s,num(p.groupValueAdd||cost*.7));return {facilityId:f.id,capacity:m.capacity,paymentRef:payment?.cheque?.id||null,invoiceRef:payment?.invoice?.number||null,message:log(s,m,'اكتملت توسعة القدرة التشغيلية.')};}
 if(cmd==='hire'){
  const hr=globalThis.GH_HR_CORE;if(!hr?.snapshot||!hr?.executeHiring)throw new Error('hr-core-missing');
  const company=ownerCompany(f),context={...(p.hrContext||{}),facilityId:f.id};
  const need=hr.snapshot(s,context,company).facilities.find(x=>x.facilityId===f.id);
  if(!need)throw new Error('facility-hr-need-unavailable');
  if(need.missing===0)return {ok:true,status:'already-staffed',staff:m.staff,hired:0};
  spend(s,company,num(p.cost??500000),`استقطاب وتشغيل ${f.name}`);
  const result=hr.executeHiring(s,context,company,`احتياج منشأة ${f.name}`,'facility');
  const after=hr.snapshot(s,context,company).facilities.find(x=>x.facilityId===f.id);
  if(!after||after.missing>0||after.have>after.needed)throw new Error('facility-hr-incomplete');
  m.departments.operations=Math.min(100,num(m.departments.operations)+4);
  return {ok:true,status:'staffed',hr:result,staff:m.staff,hired:after.have-need.have,message:log(s,m,'اكتملت دورة استقطاب فريق التشغيل.')};
 }
 if(cmd==='audit'){spend(s,p.company||ownerCompany(f),num(p.cost||500000),`تدقيق منشأة ${f.name}`);m.compliance=Math.min(100,m.compliance+8);m.security=Math.min(100,m.security+5);return log(s,m,'اكتمل تدقيق الامتثال والأمن.');}
 if(cmd==='contract'){if(m.utilization>92)throw new Error('unsafe-capacity');const startDay=Math.floor(now(s)/86400),termDays=Math.max(1,Number(p.termDays)||180);const c={id:p.contractId||`SLA-${Math.floor(now(s))}-${m.slaContracts.length+1}`,startDay,expiresDay:startDay+termDays,annualRevenue:num(p.annualRevenue||3200000),utilization:num(p.utilization||8)};m.slaContracts.push(c);m.contracts=m.slaContracts.length;m.utilization=Math.min(98,m.utilization+c.utilization);m.expectedRevenue=m.slaContracts.reduce((sum,x)=>sum+num(x.annualRevenue),0);log(s,m,'تم توقيع عقد SLA تشغيلي.');return c;}
 if(cmd==='task'){const task={id:p.taskId||`TASK-${Math.floor(now(s))}-${m.tasks.length+1}`,title:p.title||`مهمة جديدة أسندها ${m.manager}`,status:'قيد التنفيذ',createdAt:now(s)};m.tasks.unshift(task);log(s,m,'أُسندت مهمة تشغيلية جديدة.');return task;}
 if(cmd==='task-done'){const task=m.tasks.find(x=>x.id===p.taskId);if(!task)return false;task.status='مكتملة';task.completedAt=now(s);m.serviceLevel=Math.min(99,m.serviceLevel+1);log(s,m,`أُنجزت المهمة: ${task.title}.`);return task;}
 if(cmd==='commission-energy'){const k=String(p.key||'capacityMW');s.energy[k]=num(s.energy[k])+num(p.amount);return {key:k,value:s.energy[k]};}
 if(cmd==='tick-day'){const d=Math.floor(Number(p.day)||Math.floor(now(s)/86400));let expired=0;for(const f of all(s)){const fm=model(s,f);const rows=Array.isArray(fm.slaContracts)?fm.slaContracts:[],ended=rows.filter(c=>Number(c.expiresDay)<=d);if(ended.length){fm.utilization=Math.max(0,num(fm.utilization)-ended.reduce((sum,c)=>sum+num(c.utilization||8),0));expired+=ended.length;}fm.slaContracts=rows.filter(c=>Number(c.expiresDay)>d);fm.contracts=fm.slaContracts.length;fm.expectedRevenue=fm.slaContracts.reduce((sum,c)=>sum+num(c.annualRevenue),0);}return {day:d,expired};}
 throw new Error(`Unknown facility command: ${cmd}`);
}
const API={VERSION,ensure,all,find,model,ownerCompany,verifyDirectorySite,validate,execute};globalThis.GH_FACILITY_CORE=API;globalThis.GH_DOMAIN_COMMANDS?.register?.('facilities',API);if(globalThis.window&&window!==globalThis)window.GH_FACILITY_CORE=API;if(typeof module!=='undefined'&&module.exports)module.exports=API;
})();

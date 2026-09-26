(()=>{'use strict';
const VERSION='3.0.0',num=v=>Math.max(0,Number(v)||0),now=s=>Number(s.simSeconds)||0;
const DEFAULT_ASSET_CAPACITY=Object.freeze({'airport-base':300,'port-base':120,logistics:140,depot:80,'mobility-center':120});
const ASSET_FACILITY_KINDS=Object.freeze({air:Object.freeze(['airport-base']),sea:Object.freeze(['port-base']),road:Object.freeze(['depot','logistics'])});
const platform=()=>globalThis.GH_COMPANY_PLATFORM||null;
const explicitOwner=x=>String(x?.ownerCompanyId||x?.companyId||x?.company||'').trim();
function ensure(s){s.globalBases=Array.isArray(s.globalBases)?s.globalBases:[];s.customHubs=Array.isArray(s.customHubs)?s.customHubs:[];s.branches=Array.isArray(s.branches)?s.branches:[];s.advanced=s.advanced||{};s.advanced.facilities=s.advanced.facilities&&typeof s.advanced.facilities==='object'?s.advanced.facilities:{};s.energy=s.energy||{};return s;}
function all(s){ensure(s);return [...s.globalBases,...s.customHubs];}
function find(s,id){return all(s).find(x=>x.id===id)||null;}
function model(s,f){ensure(s);if(!f)return null;const cap=Number(f.bays||f.capacityMW||parseFloat(f.capacity)||24)||24;const m=s.advanced.facilities[f.id]||(s.advanced.facilities[f.id]={});m.level=Math.max(1,Number(m.level)||1);m.staff=num(m.staff);m.capacity=Math.max(1,Number(m.capacity)||cap);const ownedAssetCapacity=assetCapacity(f);if(ownedAssetCapacity>0)m.assetCapacity=ownedAssetCapacity;m.utilization=Math.max(0,Math.min(100,Number(m.utilization)||0));m.serviceLevel=Math.max(0,Math.min(100,Number(m.serviceLevel)||88));m.maintenance=Math.max(0,Math.min(100,Number(m.maintenance)||88));m.safety=Math.max(0,Math.min(100,Number(m.safety)||91));m.compliance=Math.max(0,Math.min(100,Number(m.compliance)||86));m.security=Math.max(0,Math.min(100,Number(m.security)||84));m.budget=num(m.budget);m.history=Array.isArray(m.history)?m.history:[];m.tasks=Array.isArray(m.tasks)?m.tasks:[];m.slaContracts=Array.isArray(m.slaContracts)?m.slaContracts:[];m.departments=m.departments&&typeof m.departments==='object'?m.departments:{operations:70,maintenance:70,security:70,finance:70};m.manager=m.manager||f.manager||'مدير المنشأة';return m;}
function log(s,m,text){m.lastAction=now(s);m.history.unshift({at:m.lastAction,text});m.history=m.history.slice(0,40);return text;}
function ownerCompany(f){const explicit=explicitOwner(f);if(explicit)return explicit;return ['airport','airport-base'].includes(f?.kind)?'air':['port','port-base'].includes(f?.kind)?'sea':['logistics','depot'].includes(f?.kind)?'road':f?.kind==='power'?'power':f?.kind==='bank'?'bank':f?.kind==='mobility-center'?'mobility':'group';}
// A read-only inventory of the existing daily facility charges. Domain models
// disclose these costs, while the generic day-close remains their cash owner.
function dailyOperatingCosts(state,{facilities}={}){
 const rows=facilities??[...(state.globalBases||[]),...(state.customHubs||[])];
 if(!Array.isArray(rows))throw new Error('facility-daily-cost-rows-invalid');
 const byCompany=Object.create(null),byFacility=Object.create(null);let total=0;
 for(const row of rows){
  if(!row||row.owned!==true)continue;
  const id=String(row.id||''),companyId=ownerCompany(row),amount=Number(row.dailyCost??0);
  if(!id||!Number.isFinite(amount)||amount<0)throw new Error(`facility-daily-cost-invalid:${id||'missing-id'}`);
  const previous=byFacility[id];
  if(previous){if(previous.ownerCompanyId!==companyId||previous.amount!==amount)throw new Error(`facility-daily-cost-conflict:${id}`);continue;}
  byFacility[id]={ownerCompanyId:companyId,amount};byCompany[companyId]=(byCompany[companyId]||0)+amount;total+=amount;
 }
 return {total,byCompany,byFacility};
}
function companyDefinition(state,companyId){return state?platform()?.definitionFor?.(state,companyId):platform()?.getDefinition?.(companyId);}
function requireFacilityCompany(state,companyId,{operational=true}={}){const P=platform();if(!P)throw new Error('company-platform-missing');return P.requireCompany(state,companyId,{operational});}
function assetCapacity(f){if(!f||!Object.prototype.hasOwnProperty.call(DEFAULT_ASSET_CAPACITY,f.kind))return 0;const explicit=Number(f.deliveryCapacity??f.assetCapacity);return Math.max(1,Math.floor(Number.isFinite(explicit)&&explicit>0?explicit:DEFAULT_ASSET_CAPACITY[f.kind]));}
function isAssetFacilityCompatible(assetOrMode,f,state=null){
 const descriptor=assetOrMode&&typeof assetOrMode==='object'?assetOrMode:{assetMode:String(assetOrMode||'')},mode=String(descriptor.assetMode||descriptor.type||''),P=platform(),assetOwner=String(descriptor.ownerCompanyId||descriptor.companyId||P?.ownerForLegacyAssetMode?.(mode)||(!P&&ASSET_FACILITY_KINDS[mode]?mode:'')),facilityOwner=ownerCompany(f);
 if(!f||f.owned!==true||!assetOwner||assetOwner!==facilityOwner)return false;
 if(P){const definition=companyDefinition(state,assetOwner);if(!definition||!definition.capabilities.includes('operations.fleet')||!definition.classification.routeModes.includes(mode)||!definition.facilities.allowedKinds.includes(f.kind))return false;const assetClass=String(descriptor.assetClass||P.assetClassForLegacyMode(mode)||definition.classification.assetClasses[0]||'');return definition.classification.assetClasses.includes(assetClass);}
 const kinds=ASSET_FACILITY_KINDS[mode];return assetOwner===mode&&Array.isArray(kinds)&&kinds.includes(f.kind);
}
function assetOccupancy(state,f){if(!f?.id)return 0;const delivered=(state.assets||[]).filter(asset=>asset.baseFacility===f.id).length,pending=(state.realism?.procurement?.deliveries||[]).filter(row=>row.status==='pending'&&row.baseId===f.id).length;return delivered+pending;}
function availableAssetCapacity(state,f){return Math.max(0,assetCapacity(f)-assetOccupancy(state,f));}
const DIRECTORY_KIND_BY_COMPANY=Object.freeze({road:'logistics',power:'power',bank:'bank',mobility:'mobility-center'});
const GLOBAL_KIND_BY_COMPANY=Object.freeze({air:'airport-base',sea:'port-base'});
function facilityProfile(state,companyId){const definition=companyDefinition(state,companyId);if(!definition)return null;return {definition,kind:definition.facilities.primaryKind,providers:definition.facilities.directoryProviderIds||[],allowedKinds:definition.facilities.allowedKinds||[]};}
const FACILITY_MANAGEMENT_COMMANDS=new Set(['close','budget','optimize','recovery','maintenance','expand','hire','audit','contract','task','task-done']);
function verifyManagementOwner(f,cmd,p){if(!FACILITY_MANAGEMENT_COMMANDS.has(cmd))return;if(!f)throw new Error('facility-not-found');if(p.company!=null&&p.company!==ownerCompany(f))throw new Error('facility-management-company-mismatch');}
let indexedWorld=null,airportSites=new Map(),portSites=new Map();
function worldRegistry(){const world=globalThis.GH_WORLD_DATA||globalThis.window?.GH_WORLD_DATA;if(!world||!Array.isArray(world.airports)||!Array.isArray(world.ports))throw new Error('global-facility-directory-unavailable');if(world!==indexedWorld){indexedWorld=world;airportSites=new Map();portSites=new Map();}return world;}
function worldSiteRow(provider,key){
 const world=worldRegistry(),cache=provider==='world-airports'?airportSites:provider==='world-ports'?portSites:null;if(!cache)throw new Error('global-facility-provider-invalid');if(cache.has(key))return cache.get(key);
 const rows=provider==='world-airports'?world.airports:world.ports;let found=null;
 if(provider==='world-airports'){
  const icao=String(key||'').startsWith('air:')?String(key).slice(4):'';if(!icao)return null;
  for(const row of rows)if(row?.[0]===icao){found=row;break;}
 }else{
  for(const row of rows)if(`port:${row?.[0]}:${row?.[3]}:${row?.[4]}`===key){found=row;break;}
 }
 if(found)cache.set(key,found);return found;
}
function countryLabel(code){if(!code)return 'غير محدد';if(code.length===2){try{return typeof Intl.DisplayNames==='function'?new Intl.DisplayNames(['ar'],{type:'region'}).of(code)||code:code;}catch{return code;}}return code.replace(/\b\w/g,ch=>ch.toUpperCase());}
function verifyGlobalSite(payload={},expectedCompany='',state=null){
 const source=payload?.facility&&typeof payload.facility==='object'?payload.facility:payload,company=String(expectedCompany||explicitOwner(source)||''),profile=facilityProfile(state,company),provider=profile?.providers.find(id=>id==='world-airports'||id==='world-ports'),kind=profile?.kind||GLOBAL_KIND_BY_COMPANY[company];
 if(!provider||!kind)throw new Error('global-facility-company-invalid');
 if(explicitOwner(source)!==company||source.kind!==kind)throw new Error('global-facility-owner-invalid');
 const key=String(source.sourceKey||''),row=worldSiteRow(provider,key);if(!row)throw new Error('global-facility-source-invalid');
 const air=provider==='world-airports',coords=air?[row[6],row[7]]:[row[3],row[4]],code=air?row[1]||row[0]:row[0],city=air?row[3]||row[4]||'—':row[1],country=countryLabel(air?row[5]:row[2]);
 if(!Array.isArray(source.coords)||source.coords.length!==2||!source.coords.every(Number.isFinite)||source.coords.some((value,index)=>Math.abs(value-coords[index])>1e-7))throw new Error('global-facility-coordinates-invalid');
 // sourceKey + canonical world row own geographic identity. Country is display text
 // and may be localized by the directory; never reject a real port for label spelling.
 if(source.code!==code||source.city!==city||air&&(source.icao!==row[0]||String(source.iata||'')!==row[1]))throw new Error('global-facility-identity-invalid');
 if(air&&source.countryCode!=null&&source.countryCode!==row[5])throw new Error('global-facility-identity-invalid');
 return Object.freeze({sourceKey:key,ownerCompanyId:company,kind,city,country,coords:[...coords],code,...(air?{icao:row[0],iata:row[1],countryCode:row[5],elevationFt:row[8]}:{terminal:!!row[5]})});
}
function verifyDirectorySite(payload={},expectedCompany='',state=null){
 const source=payload?.site&&typeof payload.site==='object'?payload.site:payload?.facility&&typeof payload.facility==='object'?payload.facility:payload;
 const company=String(expectedCompany||explicitOwner(source)||'').trim(),profile=facilityProfile(state,company),kind=profile?.kind||DIRECTORY_KIND_BY_COMPANY[company],capitalId=String(source?.capitalId||'').trim(),key=String(source?.directorySiteKey||source?.sourceKey||source?.key||'').trim();
 if(!profile?.providers.includes('world-capitals')&&!DIRECTORY_KIND_BY_COMPANY[company])throw new Error('directory-site-company-invalid');
 if(!capitalId||key!==`site:${company}:${capitalId}`)throw new Error('directory-site-key-invalid');
 const capital=globalThis.GH_MOBILITY_CORE?.capitalMeta?.(capitalId);
 if(!capital)throw new Error('directory-site-capital-invalid');
 const coords=source?.coords;
 if(!Array.isArray(coords)||coords.length!==2||!coords.every(Number.isFinite)||Math.abs(coords[0]-capital.coords[0])>1e-7||Math.abs(coords[1]-capital.coords[1])>1e-7)throw new Error('directory-site-coordinates-invalid');
 if(String(source.city||'')!==capital.city||String(source.country||'')!==capital.country)throw new Error('directory-site-identity-invalid');
 if(explicitOwner(source)&&explicitOwner(source)!==company)throw new Error('directory-site-company-mismatch');
 if(source.kind&&source.kind!=='company-site'&&source.kind!==kind)throw new Error('directory-site-kind-mismatch');
 return Object.freeze({key,sourceKey:key,ownerCompanyId:company,capitalId,city:capital.city,country:capital.country,coords:[...capital.coords],facilityKind:kind});
}
function directoryCompanyForFacility(f){const explicit=explicitOwner(f);if(explicit)return explicit;for(const [company,kind] of Object.entries(DIRECTORY_KIND_BY_COMPANY))if(f?.kind===kind)return company;if(f?.kind==='depot')return 'road';return null;}
function canonicalFacility(state,p={}){
 const input=p.facility;if(!input||typeof input!=='object'||!input.id)throw new Error('invalid-or-duplicate-facility');
 const row={...input,owned:input.owned!==false},company=directoryCompanyForFacility(row),profile=company?facilityProfile(state,company):null;
 const capacity=assetCapacity(row);if(capacity>0)row.deliveryCapacity=capacity;
 if(company==='group'&&['hq','headquarters'].includes(row.kind)){requireFacilityCompany(state,'group',{operational:false});return {...row,ownerCompanyId:'group'};}
 const globalCompany=profile?.providers.some(id=>id==='world-airports'||id==='world-ports')?company:null;
 const bucket=globalCompany?'globalBases':'customHubs';if(p.bucket!=null&&p.bucket!==bucket)throw new Error('facility-bucket-mismatch');
 if(globalCompany){
  const instance=requireFacilityCompany(state,globalCompany);if(!profile.allowedKinds.includes(row.kind))throw new Error('global-facility-owner-invalid');
  if(!instance.operational)throw new Error('global-facility-company-not-open');
  const site=verifyGlobalSite({...row,ownerCompanyId:globalCompany},globalCompany,state);
  if(all(state).some(existing=>ownerCompany(existing)===globalCompany&&existing.sourceKey===site.sourceKey))throw new Error('global-facility-already-open');
  return {...row,...site,ownerCompanyId:globalCompany,coords:[...site.coords]};
 }
 if(!company){if(!['hq','headquarters'].includes(row.kind))throw new Error('facility-kind-owner-invalid');return {...row,ownerCompanyId:'group'};}
 const instance=requireFacilityCompany(state,company);if(!profile||!profile.allowedKinds.includes(row.kind))throw new Error('directory-facility-owner-invalid');
 if(!instance.operational)throw new Error('directory-facility-company-not-open');
 if(!profile.providers.includes('world-capitals'))throw new Error('directory-site-provider-unsupported');
 const site=verifyDirectorySite({...row,ownerCompanyId:company},company,state);
 if(all(state).some(existing=>ownerCompany(existing)===company&&(existing.sourceKey===site.key||(existing.capitalId===site.capitalId&&existing.kind===site.facilityKind))))throw new Error('directory-facility-already-open');
 return {...row,sourceKey:site.key,capitalId:site.capitalId,ownerCompanyId:company,kind:site.facilityKind,city:site.city,country:site.country,coords:[...site.coords]};
}
function finance(){const f=globalThis.GH_FINANCE_CORE;if(!f?.execute)throw new Error('finance-core-missing');return f;}
function value(s,delta){const c=globalThis.GH_CORPORATE_CORE;if(!c?.execute)throw new Error('corporate-core-missing');return c.execute({state:s},'adjust-group-value',{delta});}
function spend(s,company,amount,note){if(num(amount)<=0)return true;finance().execute({state:s},'spend',{company,amount,note,method:'تحويل بنكي',line:'capex'});return true;}
function purchase(s,company,amount,note,beneficiary){if(num(amount)<=0)return null;return finance().execute({state:s},'pay-by-cheque',{company,amount,note,beneficiary,line:'capex'});}
function validate(ctx,cmd,p={}){const s=ctx.state||ctx;ensure(s);const f=p.id?find(s,p.id):null;try{verifyManagementOwner(f,cmd,p);}catch(error){return {ok:false,reason:String(error?.message||error)};}if(cmd==='close'&&(s.assets||[]).some(a=>a.baseFacility===p.id))return {ok:false,reason:'facility-has-assets'};if(cmd==='create'){if(!p.facility?.id||find(s,p.facility.id))return {ok:false,reason:'invalid-or-duplicate-facility'};try{canonicalFacility(s,p);}catch(error){return {ok:false,reason:String(error?.message||error)};}}return true;}
function execute(ctx,cmd,p={}){const s=ctx.state||ctx;ensure(s);const f=p.id?find(s,p.id):null;verifyManagementOwner(f,cmd,p);if(f&&cmd!=='tick-day')requireFacilityCompany(s,ownerCompany(f));const m=f?model(s,f):null;
 if(cmd==='create'){const row=canonicalFacility(s,p);if(find(s,row.id))throw new Error('invalid-or-duplicate-facility');const profile=facilityProfile(s,ownerCompany(row)),bucket=profile?.providers.some(id=>id==='world-airports'||id==='world-ports')?s.globalBases:s.customHubs;bucket.push(row);model(s,row);if(num(p.groupValueAdd))value(s,num(p.groupValueAdd));return row;}
 if(cmd==='open-regional-hq'){const id=String(p.id||'');if(!id)throw new Error('facility-id-required');s.branches=Array.isArray(s.branches)?s.branches:[];if(s.branches.includes(id))throw new Error('facility-already-open');s.branches.push(id);value(s,num(p.groupValueAdd));return {id,openedAt:now(s)};}
 if(cmd==='close'){const company=ownerCompany(f),settlement=num(p.settlement);if(settlement)spend(s,company,settlement,`تسوية إغلاق ${f.name||f.id}`);s.globalBases=s.globalBases.filter(x=>x.id!==f.id);s.customHubs=s.customHubs.filter(x=>x.id!==f.id);delete s.advanced.facilities[f.id];return true;}
 if(cmd==='budget'){spend(s,ownerCompany(f),num(p.cost||2000000),`تعزيز ميزانية ${f.name}`);m.budget+=num(p.amount||2000000);return log(s,m,'تم تعزيز ميزانية التشغيل.');}
 if(cmd==='optimize'){spend(s,ownerCompany(f),num(p.cost||250000),`تحسين جدولة ${f.name}`);m.utilization=Math.min(96,m.utilization+4);m.serviceLevel=Math.min(99,m.serviceLevel+2);return log(s,m,'نفذت الإدارة تحسين الجدولة.');}
 if(cmd==='recovery'){spend(s,ownerCompany(f),num(p.cost||250000),`خطة إنقاذ ${f.name}`);m.utilization=Math.min(60,m.utilization+14);m.serviceLevel=Math.min(88,m.serviceLevel+8);m.maintenance=Math.min(100,m.maintenance+4);return log(s,m,'بدأت خطة إنقاذ تشغيلية تحت رقابة الإدارة.');}
 if(cmd==='maintenance'){spend(s,ownerCompany(f),num(p.cost||1000000),`صيانة وقائية ${f.name}`);m.maintenance=Math.min(100,m.maintenance+9);m.safety=Math.min(100,m.safety+2);return log(s,m,'أغلق برنامج صيانة وقائية.');}
 if(cmd==='expand'){const cost=num(p.cost||12000000),payment=purchase(s,ownerCompany(f),cost,`توسعة ${f.name}`,p.contractor||`مقاول توسعة ${f.name}`),factor=Math.max(1.01,Number(p.factor)||1.25),add=p.addCapacity!=null?Math.max(1,Number(p.addCapacity)||1):null;m.level++;if(add!=null)m.capacity=Math.max(m.capacity,Number(p.currentCapacity)||0)+add;else m.capacity=Math.round(m.capacity*factor);if(assetCapacity(f)>0){const currentAssetCapacity=assetCapacity(f),nextAssetCapacity=add!=null?currentAssetCapacity+add:Math.max(currentAssetCapacity+1,Math.round(currentAssetCapacity*factor));f.deliveryCapacity=nextAssetCapacity;m.assetCapacity=nextAssetCapacity;}m.budget+=num(p.budgetAdd||3000000);value(s,num(p.groupValueAdd||cost*.7));return {facilityId:f.id,capacity:m.capacity,assetCapacity:assetCapacity(f),paymentRef:payment?.cheque?.id||null,invoiceRef:payment?.invoice?.number||null,message:log(s,m,'اكتملت توسعة القدرة التشغيلية.')};}
 if(cmd==='hire'){
  const hr=globalThis.GH_HR_CORE;if(!hr?.snapshot||!hr?.executeHiring)throw new Error('hr-core-missing');
  const company=ownerCompany(f),context={candidates:Array.isArray(ctx.candidates)?ctx.candidates:[],getDynamicFacilities:typeof ctx.getDynamicFacilities==='function'?ctx.getDynamicFacilities:undefined,facilityId:f.id};
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
 if(cmd==='audit'){spend(s,ownerCompany(f),num(p.cost||500000),`تدقيق منشأة ${f.name}`);m.compliance=Math.min(100,m.compliance+8);m.security=Math.min(100,m.security+5);return log(s,m,'اكتمل تدقيق الامتثال والأمن.');}
 if(cmd==='contract'){if(m.utilization>92)throw new Error('unsafe-capacity');const startDay=Math.floor(now(s)/86400),termDays=Math.max(1,Number(p.termDays)||180);const c={id:p.contractId||`SLA-${Math.floor(now(s))}-${m.slaContracts.length+1}`,startDay,expiresDay:startDay+termDays,annualRevenue:num(p.annualRevenue||3200000),utilization:num(p.utilization||8)};m.slaContracts.push(c);m.contracts=m.slaContracts.length;m.utilization=Math.min(98,m.utilization+c.utilization);m.expectedRevenue=m.slaContracts.reduce((sum,x)=>sum+num(x.annualRevenue),0);log(s,m,'تم توقيع عقد SLA تشغيلي.');return c;}
 if(cmd==='task'){const task={id:p.taskId||`TASK-${Math.floor(now(s))}-${m.tasks.length+1}`,title:p.title||`مهمة جديدة أسندها ${m.manager}`,status:'قيد التنفيذ',createdAt:now(s)};m.tasks.unshift(task);log(s,m,'أُسندت مهمة تشغيلية جديدة.');return task;}
 if(cmd==='task-done'){const task=m.tasks.find(x=>x.id===p.taskId);if(!task)return false;task.status='مكتملة';task.completedAt=now(s);m.serviceLevel=Math.min(99,m.serviceLevel+1);log(s,m,`أُنجزت المهمة: ${task.title}.`);return task;}
 if(cmd==='commission-energy'){const k=String(p.key||'capacityMW');s.energy[k]=num(s.energy[k])+num(p.amount);return {key:k,value:s.energy[k]};}
 if(cmd==='tick-day'){const d=Math.floor(Number(p.day)||Math.floor(now(s)/86400));let expired=0;for(const f of all(s)){const fm=model(s,f);const rows=Array.isArray(fm.slaContracts)?fm.slaContracts:[],ended=rows.filter(c=>Number(c.expiresDay)<=d);if(ended.length){fm.utilization=Math.max(0,num(fm.utilization)-ended.reduce((sum,c)=>sum+num(c.utilization||8),0));expired+=ended.length;}fm.slaContracts=rows.filter(c=>Number(c.expiresDay)>d);fm.contracts=fm.slaContracts.length;fm.expectedRevenue=fm.slaContracts.reduce((sum,c)=>sum+num(c.annualRevenue),0);}return {day:d,expired};}
 throw new Error(`Unknown facility command: ${cmd}`);
}
const API={VERSION,dailyOperatingCosts,DEFAULT_ASSET_CAPACITY,ASSET_FACILITY_KINDS,ensure,all,find,model,ownerCompany,assetCapacity,isAssetFacilityCompatible,assetOccupancy,availableAssetCapacity,verifyDirectorySite,verifyGlobalSite,validate,execute};globalThis.GH_FACILITY_CORE=API;globalThis.GH_DOMAIN_COMMANDS?.register?.('facilities',API);if(globalThis.window&&window!==globalThis)window.GH_FACILITY_CORE=API;if(typeof module!=='undefined'&&module.exports)module.exports=API;
})();

(()=>{'use strict';
const VERSION='3.1.0',SCHEMA=2,CUSTOMER_SCHEMA=1,CUSTOMER_PROFILE_LIMIT=160,CUSTOMER_REVIEW_BATCH=8;
const CUSTOMER_SEGMENTS=Object.freeze(['strategic','enterprise','sme','consumer']);
const SPONSOR_SEEDS=[
 {id:'SPON-AERO-001',name:'Velora Payments',industry:'تقنية مالية',sectors:['air','mobility'],value:18000000,termDays:365,rights:'ظهور العلامة في القنوات الرقمية ونقاط الخدمة',exclusivity:'مدفوعات رقمية'},
 {id:'SPON-SEA-001',name:'Maris Industrial Group',industry:'صناعة وتجارة',sectors:['sea','road'],value:24000000,termDays:365,rights:'رعاية المحتوى التجاري وتقارير الشحن',exclusivity:'حلول صناعية'},
 {id:'SPON-ENERGY-001',name:'NorthArc Data Systems',industry:'مراكز بيانات',sectors:['power'],value:32000000,termDays:730,rights:'شريك طاقة واستدامة للمحتوى المؤسسي',exclusivity:'مراكز بيانات'},
 {id:'SPON-GROUP-001',name:'Crestline Business Network',industry:'خدمات أعمال',sectors:['group','bank'],value:15000000,termDays:365,rights:'رعاية الفعاليات والتقارير المؤسسية',exclusivity:'خدمات أعمال'}
];
const num=v=>Math.max(0,Number(v)||0),now=s=>Number(s.simSeconds)||0,day=s=>Math.floor(now(s)/86400);
const norm=v=>String(v||'').trim().toLowerCase().replace(/[\s._,،/\\()-]+/g,' ');
const unique=a=>[...new Set((a||[]).filter(Boolean).map(String))];
const trim=(a,n)=>{if(Array.isArray(a)&&a.length>n)a.length=n;return a;};
const clamp=(value,min,max)=>Math.max(min,Math.min(max,Number(value)||0));
const platform=()=>globalThis.GH_COMPANY_PLATFORM||null;
function requireBusinessCompany(s,value,{operational=true}={}){
 const companyId=String(value||'').trim();if(!companyId)throw new Error('business-company-required');const P=platform();
 if(P)return P.requireCompany(s,companyId,companyId==='group'?{operational:false,capability:'company.core'}:{operational,capability:'company.core'}).id;
 if(companyId==='group'||(s.openedCompanies||[]).includes(companyId))return companyId;throw new Error(`business-company-unknown:${companyId}`);
}
function companySectors(s,companyId){if(companyId==='group')return ['group'];const P=platform();return P?.getSectorIds?.(s,companyId)||[companyId];}
function legacySectorOwner(s,sector){
 sector=String(sector||'').trim();if(!sector)return null;if(sector==='group')return'group';const P=platform();
 const matches=P?.listInstances?P.listInstances(s,{includeGroup:false,openedOnly:true}).filter(company=>company.operational&&P.getSectorIds(s,company.id).includes(sector)).map(company=>company.id):(s.openedCompanies||[]).filter(id=>id===sector);
 if(matches.length>1)throw new Error(`business-company-ambiguous:${sector}`);return matches[0]||null;
}
function ownerFromPayload(s,p={},fallback='group'){
 const explicit=String(p.ownerCompanyId||p.companyId||p.company||'').trim();if(explicit)return requireBusinessCompany(s,explicit);
 const legacy=legacySectorOwner(s,p.sectorId||p.sector);return requireBusinessCompany(s,legacy||fallback);
}
function stableId(name,prefix='ORG'){let h=2166136261;for(const ch of norm(name)){h^=ch.codePointAt(0);h=Math.imul(h,16777619)>>>0;}return `${prefix}-${h.toString(16).toUpperCase().padStart(8,'0')}`;}
function ensure(s){
 const b=s.businessWorld=s.businessWorld&&typeof s.businessWorld==='object'&&!Array.isArray(s.businessWorld)?s.businessWorld:{};
 b.schema=SCHEMA;b.parties=b.parties&&typeof b.parties==='object'&&!Array.isArray(b.parties)?b.parties:{};
 b.relationships=b.relationships&&typeof b.relationships==='object'&&!Array.isArray(b.relationships)?b.relationships:{};
 for(const k of ['opportunities','sponsorships','events','competitorActivity'])b[k]=Array.isArray(b[k])?b[k]:[];delete b.campaigns;
 b.sequence=Math.max(0,Math.floor(Number(b.sequence)||0));const lastWeek=Number(b.lastCompetitorWeek);b.lastCompetitorWeek=Number.isFinite(lastWeek)?Math.max(-1,Math.floor(lastWeek)):-1;
 const customers=b.customers=b.customers&&typeof b.customers==='object'&&!Array.isArray(b.customers)?b.customers:{};customers.schema=CUSTOMER_SCHEMA;customers.profiles=customers.profiles&&typeof customers.profiles==='object'&&!Array.isArray(customers.profiles)?customers.profiles:{};customers.segments=customers.segments&&typeof customers.segments==='object'&&!Array.isArray(customers.segments)?customers.segments:{};customers.profileOrder=Array.isArray(customers.profileOrder)?customers.profileOrder.filter(key=>customers.profiles[key]).slice(0,CUSTOMER_PROFILE_LIMIT):[];for(const key of Object.keys(customers.profiles))if(!customers.profileOrder.includes(key)&&customers.profileOrder.length<CUSTOMER_PROFILE_LIMIT)customers.profileOrder.push(key);customers.reviewCursor=Math.max(0,Math.floor(Number(customers.reviewCursor)||0));customers.lastReviewDay=Number.isFinite(Number(customers.lastReviewDay))?Math.floor(Number(customers.lastReviewDay)):-1;
 trim(b.opportunities,120);trim(b.sponsorships,60);trim(b.events,240);trim(b.competitorActivity,120);
 seedSponsors(s);return b;
}
// Presentation and reporting paths must never create or normalize persistent state. This is
// especially important while a staged financial close is being cancelled: the map ticker is
// refreshed immediately after the rollback and a read must leave the restored snapshot intact.
function readWorld(s){
 const source=s?.businessWorld&&typeof s.businessWorld==='object'&&!Array.isArray(s.businessWorld)?s.businessWorld:null;
 const object=value=>value&&typeof value==='object'&&!Array.isArray(value)?value:{};
 const array=value=>Array.isArray(value)?value:[];
 const customerSource=object(source?.customers);return {parties:object(source?.parties),relationships:object(source?.relationships),opportunities:array(source?.opportunities),sponsorships:array(source?.sponsorships),events:array(source?.events),competitorActivity:array(source?.competitorActivity),customers:{profiles:object(customerSource.profiles),segments:object(customerSource.segments),profileOrder:array(customerSource.profileOrder)}};
}
function findByName(s,name){const n=norm(name);if(!n)return null;return Object.values(ensure(s).parties).find(p=>norm(p.legalName)===n||norm(p.displayName)===n||(p.aliases||[]).some(a=>norm(a)===n))||null;}
function upsertParty(s,p={}){
 const b=ensure(s),name=String(p.legalName||p.displayName||p.name||'').trim();if(!name)return null;
 let id=String(p.id||'').trim(),existing=id?b.parties[id]:findByName(s,name);if(existing)id=existing.id;else if(!id)id=stableId(name);
 const row=b.parties[id]||{id,createdAt:now(s),roles:[],sectors:[],aliases:[]};
 row.legalName=String(p.legalName||row.legalName||name);row.displayName=String(p.displayName||p.name||row.displayName||row.legalName);
 row.country=String(p.country||row.country||'دولي');row.city=String(p.city||p.hq||row.city||'');row.industry=String(p.industry||p.sector||row.industry||'أعمال متنوعة');
 row.roles=unique([...(row.roles||[]),...(p.roles||[]),p.role]);row.sectors=unique([...(row.sectors||[]),...(p.sectors||[]),p.sectorKey]);
 row.aliases=unique([...(row.aliases||[]),...(p.aliases||[]),name,row.displayName,row.legalName]);row.active=p.active!==false;row.updatedAt=now(s);
 if(p.externalId)row.externalId=String(p.externalId);if(p.marketShare!=null)row.marketShare=String(p.marketShare);if(p.strategy)row.strategy=String(p.strategy);
 b.parties[id]=row;return row;
}
function partyIdForName(s,name,role='counterparty'){
 const raw=String(name||'').trim();if(!raw||/^(عميل تعاقدي مسجل|طرف تعاقدي مسجل|عملاء المجموعة|حسابات الموظفين|مركز التسوية|مركز تحصيل|وكلاء الحجز|المقترضون|مدفوعات الركاب)/.test(raw))return null;
 const p=findByName(s,raw)||upsertParty(s,{name:raw,role});if(p&&role&&!p.roles.includes(role))p.roles=unique([...p.roles,role]);return p?.id||null;
}
function resolveParty(s,value){if(!value)return null;const b=readWorld(s),direct=b.parties[value];if(direct)return direct;const n=norm(value);return Object.values(b.parties).find(p=>norm(p.legalName)===n||norm(p.displayName)===n||(p.aliases||[]).some(a=>norm(a)===n))||null;}
function relKey(partyId,company){return `${partyId}::${company}`;}
function segmentFor(amount=0,strategic=false){amount=num(amount);return strategic||amount>=50000000?'strategic':amount>=1000000?'enterprise':amount>=100000?'sme':'consumer';}
function segmentRow(s,company,segment){
 company=requireBusinessCompany(s,company);segment=CUSTOMER_SEGMENTS.includes(segment)?segment:'consumer';const customers=ensure(s).customers,byCompany=customers.segments[company]=customers.segments[company]&&typeof customers.segments[company]==='object'?customers.segments[company]:{},row=byCompany[segment]=byCompany[segment]&&typeof byCompany[segment]==='object'?byCompany[segment]:{segment,namedCustomers:0,marketCustomers:0,billed:0,received:0,outstanding:0,invoiceCount:0,paymentCount:0,interactions:0,newCustomers:0,lostCustomers:0,lastDay:day(s),recentReferences:[]};return row;
}
function moveProfileSegment(s,profile,next){
 next=CUSTOMER_SEGMENTS.includes(next)?next:'consumer';if(profile.segment===next)return profile;const prior=segmentRow(s,profile.company,profile.segment);prior.namedCustomers=Math.max(0,Math.floor(num(prior.namedCustomers))-1);const target=segmentRow(s,profile.company,next);target.namedCustomers=Math.floor(num(target.namedCustomers))+1;profile.segment=next;return profile;
}
function customerProfile(s,{partyId,company='group',amount=0,strategic=false,create=true}={}){
 if(!partyId)return null;company=requireBusinessCompany(s,company);const customers=ensure(s).customers,key=relKey(partyId,company),existing=customers.profiles[key];if(existing){const next=segmentFor(amount,strategic||existing.segment==='strategic');if(CUSTOMER_SEGMENTS.indexOf(next)<CUSTOMER_SEGMENTS.indexOf(existing.segment))moveProfileSegment(s,existing,next);return existing;}
 if(!create||customers.profileOrder.length>=CUSTOMER_PROFILE_LIMIT)return null;const segment=segmentFor(amount,strategic),profile={id:key,partyId,company,segment,stage:'lead',status:'active',trust:70,satisfaction:75,paymentReliability:80,serviceQuality:82,churnRisk:18,lifetimeValue:0,billed:0,received:0,outstanding:0,invoiceCount:0,paymentCount:0,contractIds:[],recentReferences:[],createdAt:now(s),lastInteractionAt:now(s),lastReviewedDay:-1};customers.profiles[key]=profile;customers.profileOrder.push(key);const cohort=segmentRow(s,company,segment);cohort.namedCustomers=Math.floor(num(cohort.namedCustomers))+1;cohort.newCustomers=Math.floor(num(cohort.newCustomers))+1;return profile;
}
function onceReference(target,reference){const value=String(reference||'').trim();if(!value)return true;target.recentReferences=Array.isArray(target.recentReferences)?target.recentReferences:[];if(target.recentReferences.includes(value))return false;target.recentReferences.unshift(value);trim(target.recentReferences,32);return true;}
function touchCustomerLifecycle(s,p={}){
 const company=requireBusinessCompany(s,p.company||'group'),profile=customerProfile(s,{partyId:p.partyId,company,amount:p.amount,strategic:p.strategic===true,create:p.create!==false}),segment=profile?.segment||segmentFor(p.amount,p.strategic===true),cohort=segmentRow(s,company,segment),reference=String(p.reference||''),uniqueEvent=onceReference(profile||cohort,`${p.kind||p.stage||'touch'}:${reference}`);if(!uniqueEvent)return profile;
 cohort.interactions=Math.floor(num(cohort.interactions))+1;cohort.lastDay=day(s);if(!profile)return null;
 const stage=String(p.stage||'').trim();if(stage)profile.stage=stage;if(p.status)profile.status=String(p.status);if(p.contractId)profile.contractIds=unique([p.contractId,...profile.contractIds]).slice(0,40);if(p.amount>0)profile.lifetimeValue=Math.max(num(profile.lifetimeValue),num(p.amount));profile.lastInteractionAt=now(s);if(p.serviceQuality!=null)profile.serviceQuality=clamp(p.serviceQuality,0,100);return profile;
}
function recordCustomerFinance(s,p={}){
 if(p.direction!=='incoming')return null;const company=requireBusinessCompany(s,p.company||'group'),amount=num(p.amount),partyId=p.partyId||null,profile=customerProfile(s,{partyId,company,amount,create:true}),segment=profile?.segment||segmentFor(amount),cohort=segmentRow(s,company,segment),reference=String(p.reference||p.transferRef||p.documentNumber||''),kind=p.settled?'payment':'invoice';if(!onceReference(profile||cohort,`${kind}:${reference}`))return profile;
 cohort.interactions=Math.floor(num(cohort.interactions))+1;cohort.lastDay=day(s);if(p.settled){cohort.received+=amount;cohort.outstanding=Math.max(0,num(cohort.outstanding)-amount);cohort.paymentCount=Math.floor(num(cohort.paymentCount))+1;}else{cohort.billed+=amount;cohort.outstanding+=amount;cohort.invoiceCount=Math.floor(num(cohort.invoiceCount))+1;}
 if(!profile)return null;profile.lastInteractionAt=now(s);if(p.settled){profile.received+=amount;profile.outstanding=Math.max(0,num(profile.outstanding)-amount);profile.paymentCount++;profile.paymentReliability=clamp(profile.paymentReliability+1,0,100);profile.stage=profile.contractIds.length?'service':'payment';}else{profile.billed+=amount;profile.outstanding+=amount;profile.invoiceCount++;profile.stage=profile.contractIds.length?'invoiced':'customer';}return profile;
}
function migrateCustomerPortfolio(s){
 const b=ensure(s),customers=b.customers;if(Number(customers.migrationVersion)>=1)return {migrated:false,profiles:customers.profileOrder.length};
 for(const opportunity of b.opportunities){const company=opportunity.ownerCompanyId||opportunity.company||legacySectorOwner(s,opportunity.sectorId||opportunity.sector);if(!company||!opportunity.partyId)continue;const profile=touchCustomerLifecycle(s,{partyId:opportunity.partyId,company,amount:opportunity.value,strategic:['نشط','منتهي','بانتظار التوقيع'].includes(opportunity.status),stage:opportunity.status==='نشط'?'service':opportunity.status==='منتهي'?'renewal':opportunity.status==='بانتظار التوقيع'?'awaiting-signature':'lead',status:opportunity.status==='منتهي'?'renewal':'active',contractId:opportunity.id,reference:`MIG-OP-${opportunity.id}`,kind:'opportunity'});if(profile&&opportunity.status==='نشط')profile.activeContracts=Math.max(1,Number(profile.activeContracts)||0);}
 for(const invoice of s.finance?.invoices||[]){const partyId=invoice.counterpartyPartyId;if(!partyId||invoice.kind!=='دخل')continue;recordCustomerFinance(s,{partyId,company:invoice.company||'group',direction:'incoming',amount:invoice.total??invoice.amount,reference:`MIG-INV-${invoice.number}`,documentNumber:invoice.number,settled:false});if(['محصلة','مدفوعة','مسددة'].includes(invoice.status))recordCustomerFinance(s,{partyId,company:invoice.company||'group',direction:'incoming',amount:invoice.total??invoice.amount,reference:`MIG-PAY-${invoice.transferReference||invoice.number}`,documentNumber:invoice.number,settled:true});}
 customers.migrationVersion=1;return {migrated:true,profiles:customers.profileOrder.length};
}
function sectorCompany(s,sector){const rows=platform()?.listInstances?.(s,{includeGroup:false,openedOnly:true})||[];const matches=rows.filter(row=>row.operational&&companySectors(s,row.id).includes(sector));return matches.length===1?matches[0].id:null;}
function setMarketCustomers(s,sector,segment,count){const company=sectorCompany(s,sector);if(!company)return;segmentRow(s,company,segment).marketCustomers=Math.max(0,Math.floor(Number(count)||0));}
function syncMarketCohorts(s){
 const bank=s.bank||{};setMarketCustomers(s,'bank','consumer',bank.retailCustomers);setMarketCustomers(s,'bank','sme',bank.businessCustomers);
 const insurance=s.insurance,policies=Array.isArray(insurance?.offices)?insurance.offices.reduce((sum,office)=>sum+Object.values(office.lines||{}).reduce((lineSum,line)=>lineSum+num(line?.policies),0),0):0;setMarketCustomers(s,'insurance','consumer',policies);
 const realEstate=s.realEstate,projects=Array.isArray(realEstate?.projects)?realEstate.projects:[],propertyCustomers=projects.reduce((sum,row)=>sum+num(row.sold)+num(row.presold)+num(row.leased),0);setMarketCustomers(s,'realestate','consumer',propertyCustomers);
}
function reviewCustomerBatch(s,processedDay){
 const customers=ensure(s).customers;if(customers.lastReviewDay===processedDay||!customers.profileOrder.length)return 0;const count=Math.min(CUSTOMER_REVIEW_BATCH,customers.profileOrder.length);for(let offset=0;offset<count;offset++){const index=(customers.reviewCursor+offset)%customers.profileOrder.length,profile=customers.profiles[customers.profileOrder[index]];if(!profile)continue;const service=operationalExperience(s,profile.company,profile.serviceQuality),age=Math.max(0,processedDay-Math.floor(num(profile.lastInteractionAt)/86400)),payment=clamp(profile.paymentReliability-(profile.outstanding>profile.received*.5+1000000?2:0),35,100),target=clamp(service*.5+payment*.25+profile.trust*.25,35,98);profile.serviceQuality=Math.round(service);profile.paymentReliability=Math.round(payment);profile.satisfaction=Math.round(profile.satisfaction*.75+target*.25);profile.churnRisk=Math.round(clamp(100-profile.satisfaction+(age>90?Math.min(25,(age-90)/4):0),2,95));profile.lastReviewedDay=processedDay;if(!profile.contractIds.length&&age>180){profile.stage='dormant';profile.status='at-risk';}}
 customers.reviewCursor=(customers.reviewCursor+count)%customers.profileOrder.length;customers.lastReviewDay=processedDay;return count;
}
function customerPortfolio(s,company=null){
 const b=readWorld(s),profiles=Object.values(b.customers.profiles).filter(row=>!company||row.company===company),companies={};for(const [companyId,segments] of Object.entries(b.customers.segments)){if(company&&companyId!==company)continue;const rows=CUSTOMER_SEGMENTS.map(id=>segments?.[id]).filter(Boolean),named=rows.reduce((sum,row)=>sum+num(row.namedCustomers),0),market=rows.reduce((sum,row)=>sum+num(row.marketCustomers),0);companies[companyId]={company:companyId,customers:named+market,named,market,billed:rows.reduce((sum,row)=>sum+num(row.billed),0),received:rows.reduce((sum,row)=>sum+num(row.received),0),outstanding:rows.reduce((sum,row)=>sum+num(row.outstanding),0),segments:rows.map(row=>({...row,recentReferences:undefined}))};}return {profileLimit:CUSTOMER_PROFILE_LIMIT,reviewBatch:CUSTOMER_REVIEW_BATCH,profiles,companies};
}
function touchRelationship(s,{partyId,company='group',role='customer',reference=null,contractId=null,documentNumber=null,transferRef=null}={}){
 if(!partyId)return null;company=requireBusinessCompany(s,company);const b=ensure(s),key=relKey(partyId,company),r=b.relationships[key]||{id:key,partyId,company,ownerCompanyId:company,roles:[],contractIds:[],documentNumbers:[],transferRefs:[],since:now(s),status:'نشطة'};
 r.roles=unique([...r.roles,role]);if(contractId)r.contractIds=unique([contractId,...r.contractIds]).slice(0,80);if(documentNumber)r.documentNumbers=unique([documentNumber,...r.documentNumbers]).slice(0,120);if(transferRef)r.transferRefs=unique([transferRef,...r.transferRefs]).slice(0,120);if(reference)r.lastReference=String(reference);r.lastInteractionAt=now(s);b.relationships[key]=r;return r;
}
function recordEvent(s,p={}){
 const b=ensure(s),ref=String(p.reference||'').trim(),kind=String(p.kind||'commercial'),company=ownerFromPayload(s,p);
 if(ref){const old=b.events.find(e=>e.reference===ref&&e.kind===kind);if(old)return old;}
 const id=`BW-EVT-${String(++b.sequence).padStart(6,'0')}`,row={id,at:now(s),day:day(s),kind,category:p.category||'business',partyId:p.partyId||null,company,ownerCompanyId:company,title:String(p.title||'حدث تجاري'),detail:String(p.detail||''),amount:num(p.amount),reference:ref||id,severity:p.severity||'neutral',official:p.official===true,sourceDomain:p.official?String(p.sourceDomain||'business-world'):null,sourceRef:p.official?String(p.sourceRef||ref||id):null,documentRef:p.official?String(p.documentRef||''):null};
 b.events.unshift(row);trim(b.events,240);return row;
}
function seedSponsors(s){
 const b=s.businessWorld;if(!b||b.__seeding)return;b.__seeding=true;
 try{for(const seed of SPONSOR_SEEDS){const party=upsertParty(s,{name:seed.name,industry:seed.industry,role:'sponsor',sectors:seed.sectors});if(!b.sponsorships.some(x=>x.id===seed.id))b.sponsorships.push({id:seed.id,partyId:party.id,status:'عرض متاح',sectors:[...seed.sectors],value:seed.value,termDays:seed.termDays,rights:seed.rights,exclusivity:seed.exclusivity,createdAt:now(s)});}}
 finally{delete b.__seeding;}
}
function syncWorld(s,p={}){
 const b=ensure(s);
 for(const c of p.customers||[])upsertParty(s,{name:c.name||c.client,legalName:c.legalName,role:'customer',sectors:c.sectors||[c.sector],industry:c.industry||'عميل تجاري',country:c.country});
 for(const x of p.suppliers||[])upsertParty(s,{id:x.partyId,name:x.legalName||x.name,displayName:x.name,role:'supplier',sectors:[x.sector],industry:x.service,country:x.country,externalId:x.id});
 for(const x of p.competitors||[])upsertParty(s,{id:`COMP-${x.id}`,name:x.name,role:'competitor',sectors:x.sectors||[],industry:x.sector,country:x.country,city:x.hq,marketShare:x.marketShare,strategy:x.strategy,externalId:x.id});
 for(const o of p.opportunities||[]){
   const partyId=partyIdForName(s,o.client,'customer'),existing=b.opportunities.find(x=>x.id===o.id),status=o.status||existing?.status||'متاحة';
   const row=existing||{id:String(o.id),createdAt:now(s)};Object.assign(row,{partyId,client:String(o.client||''),sectorId:o.sectorId||o.sector||'',sector:o.sectorId||o.sector||'',title:String(o.name||o.title||o.id),value:num(o.value),cost:num(o.cost),termMonths:num(o.termMonths),region:String(o.region||''),sla:String(o.sla||''),payment:String(o.payment||''),status});if(o.ownerCompanyId){row.ownerCompanyId=requireBusinessCompany(s,o.ownerCompanyId);row.company=row.ownerCompanyId;}if(!existing)b.opportunities.unshift(row);
 }
 trim(b.opportunities,120);migrateCustomerPortfolio(s);syncMarketCohorts(s);return snapshot(s);
}
function competitorForSector(s,sector){
 const rows=Object.values(ensure(s).parties).filter(p=>p.roles.includes('competitor')&&(!sector||p.sectors.includes(sector)));if(!rows.length)return null;
 rows.sort((a,b)=>a.id.localeCompare(b.id));const rnd=globalThis.GH_DETERMINISM?.nextFloat?.(s,`business-world-competitor:${sector}`)??0.5;return rows[Math.min(rows.length-1,Math.floor(rnd*rows.length))];
}
function recordBid(s,p={}){
 const b=ensure(s),o=b.opportunities.find(x=>x.id===String(p.id)),clientId=p.partyId||partyIdForName(s,p.client,'customer'),winner=p.won?null:(p.competitorId||null),company=ownerFromPayload(s,{...p,sectorId:p.sectorId||p.sector||o?.sectorId||o?.sector,ownerCompanyId:p.ownerCompanyId||o?.ownerCompanyId});
 if(o){o.status=p.won?'بانتظار التوقيع':'خسر العرض';o.lastBidAt=now(s);o.winnerPartyId=winner;o.ownerCompanyId=company;o.company=company;}
 touchRelationship(s,{partyId:clientId,company,role:'customer',reference:`BID-${p.id}`,contractId:p.id});touchCustomerLifecycle(s,{partyId:clientId,company,amount:p.value??o?.value,strategic:true,stage:p.won?'awaiting-signature':'lost-bid',status:p.won?'active':'prospect',contractId:p.id,reference:`BID-${p.id}-${p.won?'W':'L'}`,kind:'bid'});
 const rival=winner?resolveParty(s,winner):null;recordEvent(s,{kind:'bid',partyId:clientId,ownerCompanyId:company,title:p.won?`فازت المجموعة بعرض ${p.title||p.id}`:`تمت ترسية ${p.title||p.id} على ${rival?.displayName||p.competitorName||'منافس آخر'}`,detail:p.won?'العقد بانتظار توقيع اللاعب.':'سجلت نتيجة المنافسة دون أي إجراء تلقائي على شركاتك.',reference:`BID-${p.id}-${p.won?'W':'L'}`,severity:p.won?'positive':'neutral'});return {won:!!p.won,winnerPartyId:winner,ownerCompanyId:company};
}
function recordContract(s,p={}){
 const b=ensure(s),id=String(p.id||''),partyId=p.partyId||partyIdForName(s,p.client,'customer'),o=b.opportunities.find(x=>x.id===id),company=ownerFromPayload(s,{...p,ownerCompanyId:p.ownerCompanyId||o?.ownerCompanyId,sectorId:p.sectorId||p.sector||o?.sectorId});
 if(o){o.status=p.status==='منتهي'?'منتهي':'نشط';o.contractNumber=p.number||o.contractNumber;o.signedAt=p.signedAt??now(s);o.ownerCompanyId=company;o.company=company;}
 const rel=touchRelationship(s,{partyId,company,role:'customer',reference:p.number||id,contractId:id}),profile=touchCustomerLifecycle(s,{partyId,company,amount:p.value,strategic:true,stage:p.status==='منتهي'?'renewal':'service',status:p.status==='منتهي'?'renewal':'active',contractId:id,reference:`CONTRACT-LIFECYCLE-${p.number||id}-${p.status||'active'}`,kind:'contract'});if(profile)profile.activeContracts=Math.max(0,(Number(profile.activeContracts)||0)+(p.status==='منتهي'?-1:1));
 if(p.status==='نشط')recordEvent(s,{kind:'contract',partyId,ownerCompanyId:company,title:`توقيع ${p.title||id} مع ${resolveParty(s,partyId)?.displayName||p.client||'عميل'}`,detail:`عقد ${p.number||id} دخل مرحلة التنفيذ.`,amount:p.value,reference:`CONTRACT-${p.number||id}`,severity:'positive',official:true,sourceDomain:'contracts',sourceRef:id,documentRef:p.number||id});
 if(p.status==='منتهي')recordEvent(s,{kind:'contract',partyId,ownerCompanyId:company,title:`انتهاء ${p.title||id}`,detail:'أُغلق العقد بعد اكتمال مدته المسجلة.',reference:`CONTRACT-END-${p.number||id}`,official:true,sourceDomain:'contracts',sourceRef:id,documentRef:p.number||id});
 return rel;
}
function recordFinance(s,p={}){
 const partyId=p.partyId||partyIdForName(s,p.counterparty||p.partyName,p.direction==='outgoing'?'supplier':'customer');if(!partyId)return null;const company=ownerFromPayload(s,p);
 const rel=touchRelationship(s,{partyId,company,role:p.direction==='outgoing'?'supplier':'customer',reference:p.reference,documentNumber:p.documentNumber,transferRef:p.transferRef});recordCustomerFinance(s,{...p,partyId,company});
 if(p.settled&&p.news===true){const sourceRef=String(p.reference||p.transferRef||p.documentNumber||'');recordEvent(s,{kind:'payment',partyId,ownerCompanyId:company,title:p.direction==='outgoing'?`حوالة صادرة إلى ${resolveParty(s,partyId)?.displayName}`:`حوالة واردة من ${resolveParty(s,partyId)?.displayName}`,detail:p.note||'',amount:p.amount,reference:`PAY-${sourceRef}`,severity:'neutral',official:true,sourceDomain:'finance',sourceRef,documentRef:String(p.documentNumber||p.transferRef||p.reference||'')});}return rel;
}
function acceptSponsorship(s,p={}){
 const b=ensure(s),offer=b.sponsorships.find(x=>x.id===p.id);if(!offer)throw new Error('sponsorship-not-found');if(offer.status!=='عرض متاح')throw new Error('sponsorship-not-available');
 let company;if(p.ownerCompanyId||p.companyId||p.company)company=ownerFromPayload(s,p);else{const candidates=platform()?.listInstances?s=>platform().listInstances(s,{openedOnly:true}).filter(row=>row.operational&&companySectors(s,row.id).some(sector=>offer.sectors.includes(sector))).map(row=>row.id):s=>['group',...(s.openedCompanies||[])].filter(id=>offer.sectors.includes(id));const matches=candidates(s);if(matches.length!==1)throw new Error(matches.length?'sponsorship-company-ambiguous':'sponsorship-company-not-open');company=matches[0];}if(!companySectors(s,company).some(sector=>offer.sectors.includes(sector)))throw new Error('sponsorship-company-sector-mismatch');
 offer.status='نشط';offer.company=company;offer.ownerCompanyId=company;offer.startDay=day(s);offer.endDay=offer.startDay+offer.termDays;offer.monthlyValue=offer.value/(offer.termDays/30);offer.nextBillingDay=offer.startDay;offer.billedPeriods=0;
 touchRelationship(s,{partyId:offer.partyId,company,role:'sponsor',reference:offer.id,contractId:offer.id});recordEvent(s,{kind:'sponsorship',partyId:offer.partyId,company,title:`قبول رعاية ${resolveParty(s,offer.partyId)?.displayName}`,detail:`${offer.rights} · حصرية: ${offer.exclusivity}`,amount:offer.value,reference:`SPON-ACCEPT-${offer.id}`,severity:'positive',official:true,sourceDomain:'business-world',sourceRef:offer.id,documentRef:offer.id});return offer;
}
function rejectSponsorship(s,p={}){const offer=ensure(s).sponsorships.find(x=>x.id===p.id);if(!offer)throw new Error('sponsorship-not-found');if(offer.status!=='عرض متاح')throw new Error('sponsorship-not-available');offer.status='مرفوض';offer.closedAt=now(s);recordEvent(s,{kind:'sponsorship',partyId:offer.partyId,title:`رفض عرض رعاية ${resolveParty(s,offer.partyId)?.displayName}`,reference:`SPON-REJECT-${offer.id}`});return offer;}
function billSponsorship(s,offer,processedDay){
 if(offer.status!=='نشط'||processedDay<offer.nextBillingDay)return 0;if(processedDay>offer.endDay){offer.status='منتهي';return 0;}
 const F=globalThis.GH_FINANCE_CORE;if(!F?.execute)return 0;const period=offer.billedPeriods+1,ref=`SPON-${offer.id}-P${period}`,party=resolveParty(s,offer.partyId),amount=Math.min(offer.monthlyValue,Math.max(0,offer.value-offer.billedPeriods*offer.monthlyValue));
 if(amount<=0){offer.status='منتهي';return 0;}F.execute({state:s},'credit',{company:offer.company,amount,reference:ref,note:`دفعة رعاية ${offer.id} · الفترة ${period}`,counterparty:party?.legalName||party?.displayName||'راعٍ تجاري',taxable:true,sourceRefs:[offer.id]});offer.billedPeriods=period;offer.lastBillingDay=processedDay;offer.nextBillingDay+=30;if(offer.nextBillingDay>offer.endDay||offer.billedPeriods*offer.monthlyValue>=offer.value-.01)offer.status='منتهي';return amount;
}
function competitorTick(s,processedDay){
 const b=ensure(s),week=Math.floor(processedDay/7);if(week<=0||b.lastCompetitorWeek>=week)return null;b.lastCompetitorWeek=week;
 const rivals=Object.values(b.parties).filter(p=>p.roles.includes('competitor'));if(!rivals.length)return null;const rnd=globalThis.GH_DETERMINISM?.nextFloat?.(s,'business-world-weekly-rival')??0.5,r=rivals[Math.min(rivals.length-1,Math.floor(rnd*rivals.length))],sector=r.sectors[0]||'market';
 const kinds=['عقد جديد','توسعة تجارية','شراكة قطاعية','مناقصة خارجية'],kind=kinds[week%kinds.length],row={id:`RIVAL-${week}-${r.id}`,at:now(s),day:processedDay,partyId:r.id,sector,kind,detail:`${r.displayName} أعلنت ${kind} في ${r.industry||'السوق'}.`};b.competitorActivity.unshift(row);trim(b.competitorActivity,120);recordEvent(s,{kind:'competitor',partyId:r.id,company:'group',title:row.detail,detail:'حدث سوقي خارجي للمنافس ولا ينفذ أي قرار داخل شركاتك.',reference:row.id});return row;
}
function tickDay(s,p={}){
 const processedDay=Math.max(0,Math.floor(Number(p.day)||day(s))),b=ensure(s);let sponsorshipRevenue=0;
 for(const offer of b.sponsorships)sponsorshipRevenue+=billSponsorship(s,offer,processedDay);
 syncMarketCohorts(s);const reviewedCustomers=reviewCustomerBatch(s,processedDay),competitor=competitorTick(s,processedDay);return {day:processedDay,sponsorshipRevenue,reviewedCustomers,competitor};
}
function customerSnapshot(s,partyId){
 const b=readWorld(s),party=b.parties[partyId];if(!party)return null;
 const relationships=Object.values(b.relationships).filter(r=>r.partyId===partyId),ops=b.opportunities.filter(o=>o.partyId===partyId),profiles=Object.values(b.customers.profiles).filter(row=>row.partyId===partyId);if(profiles.length){return {party,relationships,profiles,opportunities:ops,contracts:ops.filter(o=>['نشط','منتهي'].includes(o.status)),invoices:[],totalBilled:profiles.reduce((sum,row)=>sum+num(row.billed),0),outstanding:profiles.reduce((sum,row)=>sum+num(row.outstanding),0),received:profiles.reduce((sum,row)=>sum+num(row.received),0),lastInteractionAt:Math.max(0,...relationships.map(r=>num(r.lastInteractionAt)),...profiles.map(row=>num(row.lastInteractionAt))),health:{satisfaction:Math.round(profiles.reduce((sum,row)=>sum+num(row.satisfaction),0)/profiles.length),churnRisk:Math.round(profiles.reduce((sum,row)=>sum+num(row.churnRisk),0)/profiles.length),stage:profiles[0].stage}};}
 // Compatibility fallback for a legacy save while its bounded customer portfolio is still being established.
 const names=new Set((party.aliases||[]).map(norm)),matches=x=>x?.counterpartyPartyId===partyId||names.has(norm(x?.counterparty)),invoices=(s.finance?.invoices||[]).filter(matches),incoming=(s.finance?.transfers||[]).filter(x=>x.fromPartyId===partyId||names.has(norm(x.from)));return {party,relationships,profiles:[],opportunities:ops,contracts:ops.filter(o=>['نشط','منتهي'].includes(o.status)),invoices,totalBilled:invoices.filter(x=>x.kind==='دخل').reduce((n,x)=>n+num(x.total),0),outstanding:invoices.filter(x=>x.kind==='دخل'&&!['محصلة','مدفوعة','مسددة'].includes(x.status)).reduce((n,x)=>n+num(x.total),0),received:incoming.reduce((n,x)=>n+num(x.amount),0),lastInteractionAt:Math.max(0,...relationships.map(r=>num(r.lastInteractionAt)),...invoices.map(x=>num(x.at)),...incoming.map(x=>num(x.at)))};
}
function operationalExperience(s,company,service){
 const r=s.realism||{},sector=companySectors(s,company)[0]||company;
 if(sector==='air')return clamp(((Number(r.aviation?.otp)||service)+(Number(r.aviation?.dispatchReliability)||service))/2,35,99);
 if(sector==='sea'){const cii={A:96,B:88,C:76,D:63,E:48}[String(r.maritime?.cii||'C')]||76;return clamp(cii*.65+(Number(r.maritime?.utilization)||service)*.35,35,99);}
 if(sector==='road')return clamp((Number(r.logistics?.onTime)||service)*.82+(100-(Number(r.logistics?.damageRate)||1)*7)*.18,35,99);
 if(sector==='power')return clamp(70+(Number(r.energy?.capacityFactor)||0)*.18+(Number(r.energy?.storageHealth)||90)*.1-(Number(r.energy?.curtailment)||0)*.5,35,99);
 if(sector==='bank')return clamp(88-(Number(r.banking?.npl)||2)*2.5+Math.min(6,((Number(r.banking?.lcr)||100)-100)*.04),35,99);
 if(sector==='insurance'){const sum=globalThis.GH_INSURANCE_CORE?.summary?.(s),ratio=Number(sum?.lossRatio30);return clamp(service+(Number.isFinite(ratio)?Math.max(-10,Math.min(5,(.72-ratio)*20)):0),35,99);}
 if(sector==='realestate'){const sum=globalThis.GH_REALESTATE_CORE?.summary?.(s),occupancy=Number(sum?.occupancy);return clamp(service+(Number.isFinite(occupancy)?(occupancy-.75)*12:0),35,99);}
 return clamp(service,35,99);
}
function companyCustomerRating(s,company){
 const companyId=requireBusinessCompany(s,company,{operational:company!=='group'}),b=readWorld(s),sectors=companySectors(s,companyId),r=s.realism||{},model=s.advanced?.companies?.[companyId]||{},service=clamp(Number(model.serviceLevel)||82,35,100),reputation=clamp(Number(r.reputation?.[companyId]??r.reputation?.[sectors[0]]??s.profile?.reputation??70),35,100),operations=operationalExperience(s,companyId,service),cutoff=now(s)-90*86400;
 const relations=Object.values(b.relationships).filter(row=>row.company===companyId&&(row.roles||[]).includes('customer')),profiles=Object.values(b.customers.profiles).filter(row=>row.company===companyId),invoiceCount=profiles.reduce((sum,row)=>sum+Math.floor(num(row.invoiceCount)),0),contracts=b.opportunities.filter(row=>(row.ownerCompanyId||row.company)===companyId&&['نشط','منتهي'].includes(row.status)),events=b.events.filter(row=>row.company===companyId&&(Number(row.at)||0)>=cutoff),positive=events.filter(row=>row.severity==='positive').length,negative=events.filter(row=>['critical','negative'].includes(row.severity)).length,eventAdjustment=clamp((positive-negative)*.8,-6,6),customerHealth=profiles.length?profiles.reduce((sum,row)=>sum+clamp(row.satisfaction,35,100),0)/profiles.length:service,score=clamp(reputation*.36+service*.29+operations*.2+customerHealth*.15+eventAdjustment,35,98),responses=Math.min(250000,relations.length*17+invoiceCount*3+contracts.length*11),rating=Math.round(clamp(1+score/25,1,5)*10)/10,trendRaw=clamp((service-82)*.025+(positive-negative)*.08-(profiles.reduce((sum,row)=>sum+num(row.churnRisk),0)/Math.max(1,profiles.length)-20)*.006,-1,1),trend=Math.round(trendRaw*10)/10;
 return {company:companyId,rating,score:Math.round(score),responses,confidence:responses>=100?'مرتفعة':responses>=25?'متوسطة':'أولية',provisional:responses<25,trend,trendLabel:trend>.2?'صاعد':trend<-.2?'يتراجع':'مستقر',components:{reputation:Math.round(reputation),service:Math.round(service),operations:Math.round(operations)},customers:relations.length,contracts:contracts.length};
}
function customerRatings(s){
 const ids=platform()?.listInstances?.(s,{includeGroup:false,openedOnly:true,capability:'company.core'}).filter(row=>row.operational).map(row=>row.id)||(s.openedCompanies||[]),companies=[...new Set(ids)].map(id=>companyCustomerRating(s,id)),weight=row=>Math.max(1,row.responses),total=companies.reduce((sum,row)=>sum+weight(row),0),rating=companies.length?Math.round(companies.reduce((sum,row)=>sum+row.rating*weight(row),0)/total*10)/10:null,responses=companies.reduce((sum,row)=>sum+row.responses,0);
 return {group:{company:'group',rating,responses,confidence:responses>=250?'مرتفعة':responses>=50?'متوسطة':'أولية',provisional:responses<50,trend:companies.length?Math.round(companies.reduce((sum,row)=>sum+row.trend,0)/companies.length*10)/10:0},companies};
}
function snapshot(s){
 const b=readWorld(s),parties=Object.values(b.parties),customers=parties.filter(p=>(p.roles||[]).includes('customer')),competitors=parties.filter(p=>(p.roles||[]).includes('competitor')),sponsors=parties.filter(p=>(p.roles||[]).includes('sponsor'));
 return {parties,customers,competitors,sponsors,opportunities:b.opportunities,sponsorships:b.sponsorships,events:b.events,competitorActivity:b.competitorActivity,customerPortfolio:customerPortfolio(s),activeContracts:b.opportunities.filter(o=>o.status==='نشط').length,openOpportunities:b.opportunities.filter(o=>['متاحة','بانتظار التوقيع'].includes(o.status)).length};
}
function execute(ctx,cmd,p={}){const s=ctx.state||ctx;ensure(s);switch(cmd){
 case'ensure':return ensure(s);case'sync-world':return syncWorld(s,p);case'record-bid':return recordBid(s,p);case'record-contract':return recordContract(s,p);case'record-finance':return recordFinance(s,p);case'accept-sponsorship':return acceptSponsorship(s,p);case'reject-sponsorship':return rejectSponsorship(s,p);case'tick-day':return tickDay(s,p);default:throw new Error(`Unknown business-world command: ${cmd}`);
}}
const API={VERSION,SCHEMA,CUSTOMER_PROFILE_LIMIT,CUSTOMER_REVIEW_BATCH,ensure,upsertParty,partyIdForName,resolveParty,touchRelationship,touchCustomerLifecycle,recordEvent,syncWorld,competitorForSector,customerSnapshot,customerPortfolio,companyCustomerRating,customerRatings,snapshot,execute};
globalThis.GH_BUSINESS_WORLD=API;globalThis.GH_DOMAIN_COMMANDS?.register?.('business-world',API);if(globalThis.window&&window!==globalThis)window.GH_BUSINESS_WORLD=API;if(typeof module!=='undefined'&&module.exports)module.exports=API;
})();

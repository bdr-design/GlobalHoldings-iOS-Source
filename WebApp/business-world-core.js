(()=>{'use strict';
const VERSION='3.0.0',SCHEMA=1,COMPANIES=['group','air','sea','road','power','bank','mobility'];
const SPONSOR_SEEDS=[
 {id:'SPON-AERO-001',name:'Velora Payments',industry:'تقنية مالية',sectors:['air','mobility'],value:18000000,termDays:365,rights:'ظهور العلامة في القنوات الرقمية ونقاط الخدمة',exclusivity:'مدفوعات رقمية'},
 {id:'SPON-SEA-001',name:'Maris Industrial Group',industry:'صناعة وتجارة',sectors:['sea','road'],value:24000000,termDays:365,rights:'رعاية المحتوى التجاري وتقارير الشحن',exclusivity:'حلول صناعية'},
 {id:'SPON-ENERGY-001',name:'NorthArc Data Systems',industry:'مراكز بيانات',sectors:['power'],value:32000000,termDays:730,rights:'شريك طاقة واستدامة للمحتوى المؤسسي',exclusivity:'مراكز بيانات'},
 {id:'SPON-GROUP-001',name:'Crestline Business Network',industry:'خدمات أعمال',sectors:['group','bank'],value:15000000,termDays:365,rights:'رعاية الفعاليات والتقارير المؤسسية',exclusivity:'خدمات أعمال'}
];
const CAMPAIGN_CHANNELS=Object.freeze({
 digital:{name:'حملة رقمية',cpm:9,reachFactor:74,agency:'Nexa Media Exchange'},
 trade:{name:'معارض وفعاليات قطاعية',cpm:28,reachFactor:24,agency:'World Trade Events'},
 outdoor:{name:'إعلان خارجي',cpm:16,reachFactor:42,agency:'MetroReach Media'},
 corporate:{name:'حملة B2B مباشرة',cpm:36,reachFactor:18,agency:'Meridian Corporate Media'}
});
const num=v=>Math.max(0,Number(v)||0),now=s=>Number(s.simSeconds)||0,day=s=>Math.floor(now(s)/86400);
const norm=v=>String(v||'').trim().toLowerCase().replace(/[\s._,،/\\()-]+/g,' ');
const unique=a=>[...new Set((a||[]).filter(Boolean).map(String))];
const trim=(a,n)=>{if(Array.isArray(a)&&a.length>n)a.length=n;return a;};
function stableId(name,prefix='ORG'){let h=2166136261;for(const ch of norm(name)){h^=ch.codePointAt(0);h=Math.imul(h,16777619)>>>0;}return `${prefix}-${h.toString(16).toUpperCase().padStart(8,'0')}`;}
function ensure(s){
 const b=s.businessWorld=s.businessWorld&&typeof s.businessWorld==='object'&&!Array.isArray(s.businessWorld)?s.businessWorld:{};
 b.schema=SCHEMA;b.parties=b.parties&&typeof b.parties==='object'&&!Array.isArray(b.parties)?b.parties:{};
 b.relationships=b.relationships&&typeof b.relationships==='object'&&!Array.isArray(b.relationships)?b.relationships:{};
 for(const k of ['opportunities','sponsorships','campaigns','events','competitorActivity'])b[k]=Array.isArray(b[k])?b[k]:[];
 b.sequence=Math.max(0,Math.floor(Number(b.sequence)||0));b.lastCompetitorWeek=Math.max(-1,Math.floor(Number(b.lastCompetitorWeek)??-1));
 trim(b.opportunities,120);trim(b.sponsorships,60);trim(b.campaigns,80);trim(b.events,240);trim(b.competitorActivity,120);
 seedSponsors(s);return b;
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
 const raw=String(name||'').trim();if(!raw||/^(عميل تعاقدي مسجل|طرف تعاقدي مسجل|عملاء المجموعة|حسابات الموظفين|مركز التسوية)/.test(raw))return null;
 const p=findByName(s,raw)||upsertParty(s,{name:raw,role});if(p&&role&&!p.roles.includes(role))p.roles=unique([...p.roles,role]);return p?.id||null;
}
function resolveParty(s,value){if(!value)return null;const b=ensure(s);return b.parties[value]||findByName(s,value);}
function relKey(partyId,company){return `${partyId}::${company}`;}
function touchRelationship(s,{partyId,company='group',role='customer',reference=null,contractId=null,documentNumber=null,transferRef=null}={}){
 if(!partyId||!COMPANIES.includes(company))return null;const b=ensure(s),key=relKey(partyId,company),r=b.relationships[key]||{id:key,partyId,company,roles:[],contractIds:[],documentNumbers:[],transferRefs:[],since:now(s),status:'نشطة'};
 r.roles=unique([...r.roles,role]);if(contractId)r.contractIds=unique([contractId,...r.contractIds]).slice(0,80);if(documentNumber)r.documentNumbers=unique([documentNumber,...r.documentNumbers]).slice(0,120);if(transferRef)r.transferRefs=unique([transferRef,...r.transferRefs]).slice(0,120);if(reference)r.lastReference=String(reference);r.lastInteractionAt=now(s);b.relationships[key]=r;return r;
}
function recordEvent(s,p={}){
 const b=ensure(s),ref=String(p.reference||'').trim(),kind=String(p.kind||'commercial');
 if(ref){const old=b.events.find(e=>e.reference===ref&&e.kind===kind);if(old)return old;}
 const id=`BW-EVT-${String(++b.sequence).padStart(6,'0')}`,row={id,at:now(s),day:day(s),kind,category:p.category||'business',partyId:p.partyId||null,company:p.company||'group',title:String(p.title||'حدث تجاري'),detail:String(p.detail||''),amount:num(p.amount),reference:ref||id,severity:p.severity||'neutral'};
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
   const row=existing||{id:String(o.id),createdAt:now(s)};Object.assign(row,{partyId,client:String(o.client||''),company:o.sector||'group',sector:o.sector||'',title:String(o.name||o.title||o.id),value:num(o.value),cost:num(o.cost),termMonths:num(o.termMonths),region:String(o.region||''),sla:String(o.sla||''),payment:String(o.payment||''),status});if(!existing)b.opportunities.unshift(row);
 }
 trim(b.opportunities,120);return snapshot(s);
}
function competitorForSector(s,sector){
 const rows=Object.values(ensure(s).parties).filter(p=>p.roles.includes('competitor')&&(!sector||p.sectors.includes(sector)));if(!rows.length)return null;
 rows.sort((a,b)=>a.id.localeCompare(b.id));const rnd=globalThis.GH_DETERMINISM?.nextFloat?.(s,`business-world-competitor:${sector}`)??0.5;return rows[Math.min(rows.length-1,Math.floor(rnd*rows.length))];
}
function recordBid(s,p={}){
 const b=ensure(s),o=b.opportunities.find(x=>x.id===String(p.id)),clientId=p.partyId||partyIdForName(s,p.client,'customer'),winner=p.won?null:(p.competitorId||null);
 if(o){o.status=p.won?'بانتظار التوقيع':'خسر العرض';o.lastBidAt=now(s);o.winnerPartyId=winner;}
 touchRelationship(s,{partyId:clientId,company:p.sector||'group',role:'customer',reference:`BID-${p.id}`,contractId:p.id});
 const rival=winner?resolveParty(s,winner):null;recordEvent(s,{kind:'bid',partyId:clientId,company:p.sector||'group',title:p.won?`فازت المجموعة بعرض ${p.title||p.id}`:`تمت ترسية ${p.title||p.id} على ${rival?.displayName||p.competitorName||'منافس آخر'}`,detail:p.won?'العقد بانتظار توقيع اللاعب.':'سجلت نتيجة المنافسة دون أي إجراء تلقائي على شركاتك.',reference:`BID-${p.id}-${p.won?'W':'L'}`,severity:p.won?'positive':'neutral'});return {won:!!p.won,winnerPartyId:winner};
}
function recordContract(s,p={}){
 const b=ensure(s),id=String(p.id||''),partyId=p.partyId||partyIdForName(s,p.client,'customer'),o=b.opportunities.find(x=>x.id===id);
 if(o){o.status=p.status==='منتهي'?'منتهي':'نشط';o.contractNumber=p.number||o.contractNumber;o.signedAt=p.signedAt??now(s);}
 const rel=touchRelationship(s,{partyId,company:p.company||p.sector||'group',role:'customer',reference:p.number||id,contractId:id});
 if(p.status==='نشط')recordEvent(s,{kind:'contract',partyId,company:p.company||p.sector||'group',title:`توقيع ${p.title||id} مع ${resolveParty(s,partyId)?.displayName||p.client||'عميل'}`,detail:`عقد ${p.number||id} دخل مرحلة التنفيذ.`,amount:p.value,reference:`CONTRACT-${p.number||id}`,severity:'positive'});
 if(p.status==='منتهي')recordEvent(s,{kind:'contract',partyId,company:p.company||p.sector||'group',title:`انتهاء ${p.title||id}`,detail:'أُغلق العقد بعد اكتمال مدته المسجلة.',reference:`CONTRACT-END-${p.number||id}`});
 return rel;
}
function recordFinance(s,p={}){
 const partyId=p.partyId||partyIdForName(s,p.counterparty||p.partyName,p.direction==='outgoing'?'supplier':'customer');if(!partyId)return null;
 const rel=touchRelationship(s,{partyId,company:p.company||'group',role:p.direction==='outgoing'?'supplier':'customer',reference:p.reference,documentNumber:p.documentNumber,transferRef:p.transferRef});
 if(p.settled)recordEvent(s,{kind:'payment',partyId,company:p.company||'group',title:p.direction==='outgoing'?`حوالة صادرة إلى ${resolveParty(s,partyId)?.displayName}`:`حوالة واردة من ${resolveParty(s,partyId)?.displayName}`,detail:p.note||'',amount:p.amount,reference:`PAY-${p.reference||p.transferRef||p.documentNumber}`,severity:'neutral'});return rel;
}
function acceptSponsorship(s,p={}){
 const b=ensure(s),offer=b.sponsorships.find(x=>x.id===p.id);if(!offer)throw new Error('sponsorship-not-found');if(offer.status!=='عرض متاح')throw new Error('sponsorship-not-available');
 const company=COMPANIES.includes(p.company)?p.company:(offer.sectors.find(x=>x==='group'||(s.openedCompanies||[]).includes(x))||null);if(!company||company!=='group'&&!(s.openedCompanies||[]).includes(company))throw new Error('sponsorship-company-not-open');
 offer.status='نشط';offer.company=company;offer.startDay=day(s);offer.endDay=offer.startDay+offer.termDays;offer.monthlyValue=offer.value/(offer.termDays/30);offer.nextBillingDay=offer.startDay;offer.billedPeriods=0;
 touchRelationship(s,{partyId:offer.partyId,company,role:'sponsor',reference:offer.id,contractId:offer.id});recordEvent(s,{kind:'sponsorship',partyId:offer.partyId,company,title:`قبول رعاية ${resolveParty(s,offer.partyId)?.displayName}`,detail:`${offer.rights} · حصرية: ${offer.exclusivity}`,amount:offer.value,reference:`SPON-ACCEPT-${offer.id}`,severity:'positive'});return offer;
}
function rejectSponsorship(s,p={}){const offer=ensure(s).sponsorships.find(x=>x.id===p.id);if(!offer)throw new Error('sponsorship-not-found');if(offer.status!=='عرض متاح')throw new Error('sponsorship-not-available');offer.status='مرفوض';offer.closedAt=now(s);recordEvent(s,{kind:'sponsorship',partyId:offer.partyId,title:`رفض عرض رعاية ${resolveParty(s,offer.partyId)?.displayName}`,reference:`SPON-REJECT-${offer.id}`});return offer;}
function launchCampaign(s,p={}){
 const channel=CAMPAIGN_CHANNELS[p.channel];if(!channel)throw new Error('campaign-channel-invalid');const company=COMPANIES.includes(p.company)?p.company:'group',budget=num(p.budget),days=Math.max(7,Math.min(180,Math.floor(Number(p.days)||30)));if(company!=='group'&&!(s.openedCompanies||[]).includes(company))throw new Error('campaign-company-not-open');if(budget<10000)throw new Error('campaign-budget-too-small');
 const agency=upsertParty(s,{name:channel.agency,role:'advertising-agency',industry:'إعلانات وتسويق'}),F=globalThis.GH_FINANCE_CORE;if(!F?.execute)throw new Error('finance-core-unavailable');
 const id=`CMP-${String(++ensure(s).sequence).padStart(6,'0')}`;F.execute({state:s},'spend',{company,amount:budget,note:`${channel.name} · ${id}`,method:'تحويل بنكي',taxable:true,counterparty:agency.legalName,line:'marketing'});
 const impressions=Math.round(budget/Math.max(1,channel.cpm)*1000),reach=Math.round(impressions*Math.min(.92,.32+channel.reachFactor/100));
 const row={id,company,agencyPartyId:agency.id,channel:p.channel,channelName:channel.name,budget,startDay:day(s),endDay:day(s)+days,status:'نشطة',impressions,reach,frequency:reach?Number((impressions/reach).toFixed(2)):0};ensure(s).campaigns.unshift(row);trim(ensure(s).campaigns,80);
 recordEvent(s,{kind:'campaign',partyId:agency.id,company,title:`إطلاق ${channel.name}`,detail:`ميزانية ${budget.toLocaleString('en-US')} USD · مدة ${days} يوم`,amount:budget,reference:`CAMPAIGN-${id}`});return row;
}
function billSponsorship(s,offer,processedDay){
 if(offer.status!=='نشط'||processedDay<offer.nextBillingDay)return 0;if(processedDay>offer.endDay){offer.status='منتهي';return 0;}
 const F=globalThis.GH_FINANCE_CORE;if(!F?.execute)return 0,period=offer.billedPeriods+1,ref=`SPON-${offer.id}-P${period}`,party=resolveParty(s,offer.partyId),amount=Math.min(offer.monthlyValue,Math.max(0,offer.value-offer.billedPeriods*offer.monthlyValue));
 if(amount<=0){offer.status='منتهي';return 0;}F.execute({state:s},'credit',{company:offer.company,amount,reference:ref,note:`دفعة رعاية ${offer.id} · الفترة ${period}`,counterparty:party?.legalName||party?.displayName||'راعٍ تجاري',taxable:true,sourceRefs:[offer.id]});offer.billedPeriods=period;offer.lastBillingDay=processedDay;offer.nextBillingDay+=30;if(offer.nextBillingDay>offer.endDay||offer.billedPeriods*offer.monthlyValue>=offer.value-.01)offer.status='منتهي';return amount;
}
function competitorTick(s,processedDay){
 const b=ensure(s),week=Math.floor(processedDay/7);if(week<=0||b.lastCompetitorWeek>=week)return null;b.lastCompetitorWeek=week;
 const rivals=Object.values(b.parties).filter(p=>p.roles.includes('competitor'));if(!rivals.length)return null;const rnd=globalThis.GH_DETERMINISM?.nextFloat?.(s,'business-world-weekly-rival')??0.5,r=rivals[Math.min(rivals.length-1,Math.floor(rnd*rivals.length))],sector=r.sectors[0]||'market';
 const kinds=['عقد جديد','توسعة تجارية','شراكة قطاعية','مناقصة خارجية'],kind=kinds[week%kinds.length],row={id:`RIVAL-${week}-${r.id}`,at:now(s),day:processedDay,partyId:r.id,sector,kind,detail:`${r.displayName} أعلنت ${kind} في ${r.industry||'السوق'}.`};b.competitorActivity.unshift(row);trim(b.competitorActivity,120);recordEvent(s,{kind:'competitor',partyId:r.id,company:'group',title:row.detail,detail:'حدث سوقي خارجي للمنافس ولا ينفذ أي قرار داخل شركاتك.',reference:row.id});return row;
}
function tickDay(s,p={}){
 const processedDay=Math.max(0,Math.floor(Number(p.day)||day(s))),b=ensure(s);let sponsorshipRevenue=0,completedCampaigns=0;
 for(const offer of b.sponsorships)sponsorshipRevenue+=billSponsorship(s,offer,processedDay);
 for(const c of b.campaigns)if(c.status==='نشطة'&&processedDay>=c.endDay){c.status='مكتملة';c.completedDay=processedDay;completedCampaigns++;recordEvent(s,{kind:'campaign',partyId:c.agencyPartyId,company:c.company,title:`اكتملت ${c.channelName}`,detail:`الوصول التقديري ${c.reach.toLocaleString('en-US')} · الظهور ${c.impressions.toLocaleString('en-US')}`,reference:`CAMPAIGN-END-${c.id}`,severity:'positive'});}
 const competitor=competitorTick(s,processedDay);return {day:processedDay,sponsorshipRevenue,completedCampaigns,competitor};
}
function customerSnapshot(s,partyId){
 const b=ensure(s),party=b.parties[partyId];if(!party)return null,names=new Set((party.aliases||[]).map(norm)),matches=x=>x?.counterpartyPartyId===partyId||names.has(norm(x?.counterparty));
 const invoices=(s.finance?.invoices||[]).filter(matches),incoming=(s.finance?.transfers||[]).filter(x=>x.fromPartyId===partyId||names.has(norm(x.from))),relationships=Object.values(b.relationships).filter(r=>r.partyId===partyId),ops=b.opportunities.filter(o=>o.partyId===partyId);
 return {party,relationships,opportunities:ops,contracts:ops.filter(o=>['نشط','منتهي'].includes(o.status)),invoices,totalBilled:invoices.filter(x=>x.kind==='دخل').reduce((n,x)=>n+num(x.total),0),outstanding:invoices.filter(x=>x.kind==='دخل'&&!['محصلة','مدفوعة','مسددة'].includes(x.status)).reduce((n,x)=>n+num(x.total),0),received:incoming.reduce((n,x)=>n+num(x.amount),0),lastInteractionAt:Math.max(0,...relationships.map(r=>num(r.lastInteractionAt)),...invoices.map(x=>num(x.at)),...incoming.map(x=>num(x.at)))};
}
function snapshot(s){
 const b=ensure(s),parties=Object.values(b.parties),customers=parties.filter(p=>p.roles.includes('customer')),competitors=parties.filter(p=>p.roles.includes('competitor')),sponsors=parties.filter(p=>p.roles.includes('sponsor'));
 return {parties,customers,competitors,sponsors,opportunities:b.opportunities,sponsorships:b.sponsorships,campaigns:b.campaigns,events:b.events,competitorActivity:b.competitorActivity,activeContracts:b.opportunities.filter(o=>o.status==='نشط').length,openOpportunities:b.opportunities.filter(o=>['متاحة','بانتظار التوقيع'].includes(o.status)).length};
}
function execute(ctx,cmd,p={}){const s=ctx.state||ctx;ensure(s);switch(cmd){
 case'ensure':return ensure(s);case'sync-world':return syncWorld(s,p);case'record-bid':return recordBid(s,p);case'record-contract':return recordContract(s,p);case'record-finance':return recordFinance(s,p);case'accept-sponsorship':return acceptSponsorship(s,p);case'reject-sponsorship':return rejectSponsorship(s,p);case'launch-campaign':return launchCampaign(s,p);case'tick-day':return tickDay(s,p);default:throw new Error(`Unknown business-world command: ${cmd}`);
}}
const API={VERSION,SCHEMA,CAMPAIGN_CHANNELS,ensure,upsertParty,partyIdForName,resolveParty,touchRelationship,recordEvent,syncWorld,competitorForSector,customerSnapshot,snapshot,execute};
globalThis.GH_BUSINESS_WORLD=API;globalThis.GH_DOMAIN_COMMANDS?.register?.('business-world',API);if(globalThis.window&&window!==globalThis)window.GH_BUSINESS_WORLD=API;if(typeof module!=='undefined'&&module.exports)module.exports=API;
})();
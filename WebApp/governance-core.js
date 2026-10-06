(()=>{'use strict';
const VERSION='3.0.0',num=v=>Math.max(0,Number(v)||0),now=s=>Number(s.simSeconds)||0,clamp=(n,a,b)=>Math.max(a,Math.min(b,n));
  const fleetData=()=>{const api=globalThis.GH_FLEET_DATA||(typeof require==='function'?require('./fleet-access-core.js'):null);if(!api)throw new Error('fleet-data-access-unavailable');return api;};
function assetOwner(a){return String(a?.ownerCompanyId||a?.companyId||a?.company||globalThis.GH_COMPANY_PLATFORM?.ownerForLegacyAssetMode?.(a?.assetMode||a?.type)||'').trim();}
function companyFor(s,p={}){const requested=String(p.ownerCompanyId||p.companyId||p.company||p.sector||'').trim();if(!requested)throw new Error('company-id-required');const platform=globalThis.GH_COMPANY_PLATFORM;if(platform?.requireCompany){platform.requireCompany(s,requested,{registered:true});return requested;}return requested;}
function ensure(s){s.advanced=s.advanced||{};s.advanced.insurance=s.advanced.insurance||{policies:{},claims:[],annualPremium:0};s.advanced.insurance.claims=Array.isArray(s.advanced.insurance.claims)?s.advanced.insurance.claims:[];s.advanced.cyber=s.advanced.cyber||{};s.advanced.safety=s.advanced.safety||{};s.advanced.researchPrograms=s.advanced.researchPrograms||{};s.esg=s.esg||{environment:50,social:50,governance:50};s.sustainability=s.sustainability||{targetYear:2035,renewableShare:12,safShare:0,shorePower:0,electricRoadShare:0,circularity:42,waterScore:55,supplyChainScore:60,disclosure:68,carbonIntensity:100,programs:{}};s.sustainability.programs=s.sustainability.programs||{};s.research=s.research&&typeof s.research==='object'?s.research:{};return s;}
function spend(s,amount,note,company='group'){if(num(amount)<=0)return true;globalThis.GH_FINANCE_CORE?.execute?.({state:s},'spend',{company,amount,note,method:'تحويل بنكي',line:'other'});return true;}
// Build 359: the sustainability programmes are a catalogue here (cost, paying company, effect at full maturity); the
// command takes only the programme id. Every programme now changes a number the game uses (owner: no option without
// effect); the ESG score built from them moves reputation, which moves demand.
const ESG_PROGRAMS=Object.freeze({
 fleet:Object.freeze({company:'road',cost:12000000,effect:'electric-road'}),
 saf:Object.freeze({company:'air',cost:18000000,effect:'saf'}),
 shore:Object.freeze({company:'sea',cost:16000000,effect:'shore-power'}),
 renewable:Object.freeze({company:'power',cost:24000000,effect:'facility-cost',value:.15}),
 circular:Object.freeze({company:'group',cost:9000000,effect:'maintenance',value:.04,repair:.05}),
 supply:Object.freeze({company:'group',cost:7000000,effect:'procurement',value:.02,lead:.10}),
 water:Object.freeze({company:'group',cost:6000000,effect:'insurance',value:5}),
 disclosure:Object.freeze({company:'group',cost:5000000,effect:'credit-spread',value:.0025})
});
const RESEARCH_PHASE_DAYS=30,RESEARCH_PHASE_STEP=25;function researchPhaseCost(s){return Math.max(25000000,Math.round(num(s.groupValue)*.0005));}
const CYBER_DRILL_COST=650000,CYBER_DECAY_PER_DAY=2/30,CYBER_BASE_CHANCE=.0015,CYBER_FLOOR_CHANCE=.0003;
function unit(seed){let h=2166136261;for(let i=0;i<seed.length;i++){h^=seed.charCodeAt(i);h=Math.imul(h,16777619);}h^=h<<13;h^=h>>>17;h^=h<<5;return (h>>>0)/4294967296;}
function cyberState(s){const c=s.advanced.cyber;c.coverage=clamp(Number.isFinite(Number(c.coverage))?Number(c.coverage):40,0,100);c.events=Array.isArray(c.events)?c.events:[];return c;}
// Coverage alone sets the chance (0.15%/day at none, 0.03% at full), the recovery time (90 h at none, 8 h at full) and
// the score; the app's own runtime errors no longer move a game number.
function refreshCyber(c){const k=num(c.coverage)/100;c.chance=CYBER_BASE_CHANCE-(CYBER_BASE_CHANCE-CYBER_FLOOR_CHANCE)*k;c.rtoHours=Math.round(90-82*k);c.recoveryScore=clamp(100-c.rtoHours,0,100);c.score=Math.round(clamp(num(c.coverage)*.7+c.recoveryScore*.3,0,100));delete c.rtoMinutes;}
const SAFETY_PLAN_DAYS=180;
const UPKEEP_SHARE=.10,UPKEEP_DAYS=365,LAPSE_PER_DAY=2/30;
function payingCompany(s,company){const opened=new Set(['group',...(s.openedCompanies||[])]);return opened.has(company)?company:'group';}
function maturityOf(s,id){const program=s.sustainability?.programs?.[id];return program?clamp((Number(program.maturity)||0)/100,0,1):0;}
// What the programmes and the ESG score do now; read by facility costs, trip economics, incidents, insurance, credit and
// procurement. Neutral (all 1 / 0) before any programme.
function programEffects(s){
 const su=s.sustainability||{},m=id=>maturityOf(s,id),C=ESG_PROGRAMS,score=Number(su.esgScore)||0;
 return {facilityCost:1-C.renewable.value*m('renewable'),maintenance:1-C.circular.value*m('circular'),incidentRepair:1-C.circular.repair*m('circular'),
  purchasePrice:1-C.supply.value*m('supply'),leadTime:1-C.supply.lead*m('supply'),insuranceIndex:-C.water.value*m('water'),creditSpread:-C.disclosure.value*m('disclosure'),
  reputation:Math.max(0,Math.floor((score-60)/10))};
}
// A catalogue asset at the programme's price (the same rounding on the page and in the purchase command).
function pricedAsset(s,item){const factor=Number(programEffects(s).purchasePrice)||1;if(!item||factor>=1)return item;return {...item,price:Math.round(Number(item.price)*factor),...(Number(item.leaseMonthly)?{leaseMonthly:Math.round(Number(item.leaseMonthly)*factor)}:{})};}
function esgScore(s){const e=s.esg||{},su=s.sustainability||{},mix=su.fleetMix||{},low=mix.total?mix.lowEmission/mix.total*100:0;return Math.round((num(e.environment)+num(e.social)+num(e.governance)+Math.min(100,low+num(su.renewableShare)/2)+num(su.circularity)+num(su.supplyChainScore)+num(su.disclosure))/7);}
function execute(ctx,cmd,p={}){const s=ctx.state||ctx;ensure(s);
 // Build 359: a research phase takes 30 game days and costs 0.05% of the group's value (at least 25M), priced here; the
 // project gains its 25 points when the phase completes (tick-research), and its effect grows with each completed phase.
 if(cmd==='research-fund'){const id=String(p.project||'');if(!Object.prototype.hasOwnProperty.call(s.research,id))throw new Error('unknown-research');if((Number(s.research[id])||0)>=100)throw new Error('research-complete');const meta=s.advanced.researchPrograms[id]||(s.advanced.researchPrograms[id]={spent:0,rounds:0,history:[],status:'بحث'});meta.history=Array.isArray(meta.history)?meta.history:[];if(meta.phase)throw new Error('research-phase-active');const cost=researchPhaseCost(s),startDay=Math.floor(now(s)/86400);spend(s,cost,`تمويل مرحلة بحث ${id}`);meta.spent=num(meta.spent)+cost;meta.phase={startDay,endDay:startDay+RESEARCH_PHASE_DAYS,cost};meta.status='مرحلة جارية';return {project:id,progress:Number(s.research[id])||0,phase:{...meta.phase}};}
 if(cmd==='tick-research'){const day=Math.max(0,Math.floor(Number(p.day)||Math.floor(now(s)/86400))),done=[];for(const [id,meta] of Object.entries(s.advanced.researchPrograms||{})){if(!meta?.phase||day<Number(meta.phase.endDay))continue;const before=Number(s.research[id])||0,after=Math.min(100,before+RESEARCH_PHASE_STEP);s.research[id]=after;meta.rounds=num(meta.rounds)+1;meta.history=Array.isArray(meta.history)?meta.history:[];meta.history.unshift({at:now(s),cost:num(meta.phase.cost),from:before,to:after});meta.history=meta.history.slice(0,20);meta.phase=null;meta.status=after>=100?'تشغيلي':'بحث';if(after>=100)globalThis.GH_CORPORATE_CORE?.execute?.({state:s},'adjust-group-value',{delta:num(meta.spent)*.35});done.push({project:id,progress:after});}return {completed:done};}
 if(cmd==='tick-sustainability'){
   const day=Math.max(0,Math.floor(Number(p.day)||Math.floor(now(s)/86400))),su=s.sustainability,programs=su.programs||{};
   // Build 359: the fleet's emission mix, once a day here (the ESG panel used to build every asset and write the electric
   // road share into the state while it rendered). The share of electric/hydrogen trucks is a floor for the road share.
   const mix={total:0,lowEmission:0,road:0,electricRoad:0,day};for(const [key,count] of fleetData().countByFields(s,['type','specs'],a=>`${a.specs?.co2Band||'C'}|${a.type}|${a.specs?.electric||a.specs?.hydrogen?1:0}`)){const [band,type,electric]=key.split('|');mix.total+=count;if(band==='A'||band==='B')mix.lowEmission+=count;if(type==='road'){mix.road+=count;if(electric==='1')mix.electricRoad+=count;}}
   su.fleetMix=mix;su.electricRoadShare=Math.max(num(su.electricRoadShare),mix.road?Math.round(mix.electricRoad/mix.road*100):0);
   for(const [id,program] of Object.entries(programs)){
     if(!program)continue;const started=Math.max(0,Number(program.at)||0),elapsedDays=Math.max(0,Math.floor((now(s)-started)/86400)),steps=Math.max(0,elapsedDays-(Number(program.lastMaturityDay)||0));
     // Build 359: yearly upkeep (10% of the cost) from the paying company; unpaid, the programme lapses and loses 2
     // maturity points a month until a later attempt (every 30 days) pays.
     const catalog=ESG_PROGRAMS[id],upkeep=Math.round(num(program.cost||catalog?.cost)*UPKEEP_SHARE),dueDay=Number.isFinite(Number(program.nextUpkeepDay))&&program.nextUpkeepDay!==null?Number(program.nextUpkeepDay):Math.floor(started/86400)+UPKEEP_DAYS;
     if(day>=dueDay&&upkeep>0){const company=payingCompany(s,program.company||catalog?.company||'group'),F=globalThis.GH_FINANCE_CORE,cash=s.godMoney&&s.infiniteMoney?Infinity:Number(F?.operating?.(s,company))||0;
       if(cash>=upkeep){spend(s,upkeep,`صيانة سنوية لبرنامج الاستدامة ${id}`,company);program.lapsed=false;program.nextUpkeepDay=dueDay+UPKEEP_DAYS;program.upkeepPaid=(Number(program.upkeepPaid)||0)+upkeep;}
       else{program.lapsed=true;program.nextUpkeepDay=day+30;}}
     const maturity=program.lapsed?clamp((Number(program.maturity)||0)-steps*LAPSE_PER_DAY,0,100):program.status==='مكتمل'?100:clamp((Number(program.maturity)||0)+steps*4,0,100);program.maturity=maturity;program.lastMaturityDay=elapsedDays;const factor=maturity/100;
     if(id==='fleet')su.electricRoadShare=Math.max(num(su.electricRoadShare),12*factor);if(id==='saf')su.safShare=Math.max(num(su.safShare),15*factor);if(id==='shore')su.shorePower=Math.max(num(su.shorePower),25*factor);if(id==='renewable')su.renewableShare=Math.max(num(su.renewableShare),18*factor);if(id==='circular')su.circularity=Math.max(num(su.circularity),14*factor);if(id==='supply')su.supplyChainScore=Math.max(num(su.supplyChainScore),15*factor);if(id==='water')su.waterScore=Math.max(num(su.waterScore),18*factor);if(id==='disclosure')su.disclosure=Math.max(num(su.disclosure),18*factor);program.status=program.lapsed?'متوقف لعدم دفع الصيانة':maturity>=100?'مكتمل':'قيد التنفيذ';
   }
   const envBase=46,socialBase=58,govBase=62;s.esg.environment=clamp(envBase+num(su.electricRoadShare)*.05+num(su.safShare)*.08+num(su.shorePower)*.04+num(su.renewableShare)*.08+num(su.circularity)*.04+num(su.waterScore)*.03,0,100);s.esg.social=clamp(socialBase+num(su.supplyChainScore)*.04,0,100);s.esg.governance=clamp(govBase+num(su.disclosure)*.08+num(su.supplyChainScore)*.03,0,100);su.esgScore=esgScore(s);su.effects=programEffects(s);su.lastTickDay=day;return {esg:{...s.esg},sustainability:{...su}};
 }
 if(cmd==='esg-program'){const id=String(p.id||''),catalog=Object.prototype.hasOwnProperty.call(ESG_PROGRAMS,id)?ESG_PROGRAMS[id]:null;if(!catalog)throw new Error('unknown-esg-program');if(s.sustainability.programs[id])throw new Error('program-exists');const company=payingCompany(s,catalog.company);spend(s,catalog.cost,`برنامج استدامة ${id}`,company);s.sustainability.programs[id]={id,at:now(s),cost:catalog.cost,company,status:'قيد التنفيذ',maturity:0,lastMaturityDay:0,nextUpkeepDay:Math.floor(now(s)/86400)+UPKEEP_DAYS,title:p.title||id};return s.sustainability.programs[id];}
 // Build 359: a drill raises the response coverage 12 points (it wears off 2 points a month); coverage sets the daily
 // chance of a cyber incident per company and the recovery time (RTO) an incident costs (tick-cyber).
 if(cmd==='cyber-drill'){const c=cyberState(s);spend(s,CYBER_DRILL_COST,'تمرين استجابة سيبرانية');c.coverage=clamp(num(c.coverage)+12,0,100);c.lastDrill=now(s);c.lastDrillDay=Math.floor(now(s)/86400);refreshCyber(c);return {...c,events:undefined};}
 if(cmd==='tick-cyber'){const day=Math.max(0,Math.floor(Number(p.day)||Math.floor(now(s)/86400))),c=cyberState(s);if(Number(c.lastTickDay)>=day)return {incidents:[]};const elapsed=Number.isFinite(Number(c.lastTickDay))?day-Number(c.lastTickDay):1;c.lastTickDay=day;c.coverage=clamp(num(c.coverage)-elapsed*CYBER_DECAY_PER_DAY,0,100);refreshCyber(c);
   const reports=s.finance?.dailyCompanyReports||[],latest=reports[0]?.companies||{},F=globalThis.GH_FINANCE_CORE,hits=[];
   for(const company of (s.openedCompanies||[])){if(unit(`cyber:${company}:${day}`)>=c.chance)continue;const dailyRevenue=num(latest?.[company]?.grossRevenue),loss=Math.round(dailyRevenue*c.rtoHours/24);
     if(loss>0&&F?.execute)F.execute({state:s},'accrue-expense',{company,amount:loss,note:`توقف تشغيل ${c.rtoHours} ساعة بسبب حادث سيبراني`,method:'فاتورة استجابة',taxable:false,dueDay:day+7,number:`CYB-${String(company).toUpperCase()}-${day}`,paymentTerms:7,counterparty:'مزود الاستجابة للحوادث',line:'other'});
     const event={day,company,hours:c.rtoHours,loss};c.events.unshift(event);hits.push(event);}
   c.events=c.events.slice(0,60);c.incidents=c.events.filter(row=>day-Number(row.day)<30).length;return {incidents:hits};}
 // Build 359: an HSE audit opens a 180-day corrective plan: incident risk 15% lower and inspection fines halved while it
 // runs (GH_REALISM.runIncidents). The score and open findings are refreshed every day from the fleet (ratios, not counts).
 if(cmd==='safety-audit'){spend(s,p.cost||500000,'تدقيق السلامة HSE');const h=s.advanced.safety,day=Math.floor(now(s)/86400);h.lastAudit=now(s);h.plan={startDay:day,untilDay:day+SAFETY_PLAN_DAYS};return {...h};}
 throw new Error(`Unknown governance command: ${cmd}`);
}
const API={VERSION,SAFETY_PLAN_DAYS,ESG_PROGRAMS,RESEARCH_PHASE_DAYS,researchPhaseCost,programEffects,pricedAsset,esgScore,ensure,execute};globalThis.GH_GOVERNANCE_CORE=API;globalThis.GH_DOMAIN_COMMANDS?.register?.('governance',API);if(globalThis.window&&window!==globalThis)window.GH_GOVERNANCE_CORE=API;if(typeof module!=='undefined'&&module.exports)module.exports=API;
})();

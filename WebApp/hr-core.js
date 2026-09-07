(()=>{
  'use strict';
  const VERSION='2.9.1';
  const CREW_STANDARDS=Object.freeze({
    air:{pilots:4,cabin:6,aeng:2},
    sea:{captains:2,sailors:14,seng:4},
    road:{drivers:2,mech:.25}
  });
  const FACILITY_STANDARDS=Object.freeze({hq:42,office:18,'airport-base':36,'port-base':44,logistics:24,depot:20,power:32,bank:16,acquired:28});
  const EXECUTIVE_RULES=Object.freeze({
    H3:()=>true,
    H4:s=>(s.assets||[]).some(a=>a.type==='air')||(s.globalBases||[]).some(f=>f.company==='air'),
    H2:s=>(s.assets||[]).some(a=>a.type==='sea')||(s.globalBases||[]).some(f=>f.company==='sea'),
    H1:s=>(s.assets||[]).some(a=>a.type==='road')||(s.customHubs||[]).some(f=>f.company==='road'),
    H6:s=>(s.assets||[]).some(a=>a.type==='road')||(s.customHubs||[]).some(f=>f.company==='road'),
    H5:s=>(s.acceptedContracts||[]).length>0,
    H7:s=>Object.values(s.stakes||{}).some(v=>Number(v)>0),
    H8:s=>(s.openedCompanies||[]).includes('power')
  });
  const clone=v=>globalThis.structuredClone?structuredClone(v):JSON.parse(JSON.stringify(v));
  const day=s=>Math.floor((Number(s?.simSeconds)||0)/86400);
  function nextId(state,prefix){state.sequences=state.sequences&&typeof state.sequences==='object'?state.sequences:{};const k=`hrCore_${prefix}`;state.sequences[k]=(Number(state.sequences[k])||0)+1;return `${prefix}-${String(state.sequences[k]).padStart(6,'0')}`;}
  function ensure(state){
    state.advanced=state.advanced||{};
    const hr=state.advanced.labor=state.advanced.labor&&typeof state.advanced.labor==='object'?state.advanced.labor:{};
    hr.employmentContracts=Array.isArray(hr.employmentContracts)?hr.employmentContracts:[];
    hr.requisitions=Array.isArray(hr.requisitions)?hr.requisitions:[];
    hr.hiringLog=Array.isArray(hr.hiringLog)?hr.hiringLog:[];
    hr.aiReviews=Array.isArray(hr.aiReviews)?hr.aiReviews:[];
    hr.trainingSpend=Math.max(0,Number(hr.trainingSpend)||0);
    hr.policy=hr.policy&&typeof hr.policy==='object'?hr.policy:{approvalMode:'executive-authorization',contractMonths:24,minimumCoverage:100};
    return hr;
  }
  function companyOfFacility(f){if(f?.company)return f.company;if(f?.kind==='airport-base')return'air';if(f?.kind==='port-base')return'sea';if(['depot','logistics'].includes(f?.kind))return'road';if(f?.kind==='power')return'power';if(f?.kind==='bank')return'bank';return'group';}
  function facilityNeed(f){const base=FACILITY_STANDARDS[f?.kind]||12,cap=Number(f?.bays||f?.capacityMW||0),scale=f?.kind==='power'?Math.ceil(cap/250)*4:['depot','logistics'].includes(f?.kind)?Math.ceil(cap/20)*3:0;return Math.max(base,base+scale);}
  function requiredCrewForFleet(state,sector,assetCount=null){
    const count=assetCount==null?(state.assets||[]).filter(a=>a.type===sector).length:Math.max(0,Number(assetCount)||0),standard=CREW_STANDARDS[sector]||{},out={};
    for(const [roleId,ratio] of Object.entries(standard))out[roleId]=Math.ceil(count*ratio);
    return out;
  }
  function crewGaps(state,sector=null){
    const sectors=sector?[sector]:['air','sea','road'],rows=[];
    for(const s of sectors){const required=requiredCrewForFleet(state,s);for(const [roleId,needed] of Object.entries(required)){const role=(state.crew||[]).find(c=>c.id===roleId),have=Math.max(0,Number(role?.count)||0),missing=Math.max(0,needed-have);rows.push({kind:'crew',company:s,roleId,name:role?.name||roleId,needed,have,missing,dailyRate:role?((Number(role.salaryMin)||0)+(Number(role.salaryMax)||0))/2:0});}}
    return rows;
  }
  function facilityGaps(state,ctx,company='all'){
    const facilities=(ctx?.getDynamicFacilities?.()||[...(state.globalBases||[]),...(state.customHubs||[])]).filter(f=>f&&f.owned===true),rows=[];state.advanced=state.advanced||{};state.advanced.facilities=state.advanced.facilities||{};
    for(const f of facilities){const owner=companyOfFacility(f);if(company!=='all'&&owner!==company)continue;const needed=facilityNeed(f),have=Math.max(0,Number(state.advanced.facilities?.[f.id]?.staff)||0),missing=Math.max(0,needed-have);rows.push({kind:'facility',company:owner,facilityId:f.id,name:f.name||f.id,needed,have,missing});}
    return rows;
  }
  function executiveGaps(state,ctx,company='all'){
    const rows=[];for(const [id,rule] of Object.entries(EXECUTIVE_RULES)){if(!rule(state))continue;const c=(ctx?.candidates||[]).find(x=>x.id===id);if(!c)continue;let owner='group';if(id==='H4')owner='air';else if(id==='H2')owner='sea';else if(['H1','H6'].includes(id))owner='road';else if(id==='H8')owner='power';if(company!=='all'&&company!==owner)continue;const have=(state.hired||[]).includes(id)?1:0;rows.push({kind:'executive',company:owner,candidateId:id,name:c.name,role:c.role,needed:1,have,missing:have?0:1,salary:Number(c.salary)||0});}return rows;
  }
  function snapshot(state,ctx={},company='all'){
    ensure(state);const crew=['air','sea','road'].flatMap(s=>company==='all'||company===s?crewGaps(state,s):[]),facilities=facilityGaps(state,ctx,company),executives=executiveGaps(state,ctx,company),all=[...crew,...facilities,...executives],gaps=all.filter(x=>x.missing>0);
    const crewMissing=crew.reduce((n,x)=>n+x.missing,0),facilityMissing=facilities.reduce((n,x)=>n+x.missing,0),executiveMissing=executives.reduce((n,x)=>n+x.missing,0),total=crewMissing+facilityMissing+executiveMissing;
    const filled=all.reduce((n,x)=>n+Math.min(x.have,x.needed),0),required=all.reduce((n,x)=>n+x.needed,0),coverage=required?Math.round(filled/required*100):100;
    return {company,crew,facilities,executives,gaps,crewMissing,facilityMissing,executiveMissing,total,required,filled,coverage};
  }
  function contract(state,data){const hr=ensure(state),c={id:nextId(state,'EMP'),company:data.company||'group',name:data.name,role:data.role||data.name,count:Math.max(1,Number(data.count)||1),center:data.center||'المقر الرئيسي',salary:Math.max(0,Number(data.salary)||0),startDay:day(state),termMonths:Math.max(1,Number(data.termMonths)||hr.policy.contractMonths||24),status:'ساري',source:data.source||'HR Core',requisitionId:data.requisitionId||null};hr.employmentContracts.unshift(c);return c;}
  function executeHiring(state,ctx={},company='all',source='تفويض HR رسمي',scope='all'){
    const before=snapshot(state,ctx,company),hr=ensure(state),allow=k=>scope==='all'||scope===k;
    if(!['all','crew','facility','executive'].includes(scope))throw new Error('hr-scope-invalid');
    if(allow('crew')&&before.crew.some(g=>g.missing>0&&!(state.crew||[]).some(c=>c.id===g.roleId)))throw new Error('hr-crew-role-unavailable');
    const result={crew:[],facilities:[],executives:[],total:0,coverageBefore:before.coverage,coverageAfter:before.coverage,scope};
    if(allow('crew'))for(const gap of before.crew.filter(x=>x.missing>0)){const role=(state.crew||[]).find(c=>c.id===gap.roleId);if(!role)continue;role.count=(Number(role.count)||0)+gap.missing;contract(state,{company:gap.company,name:`${gap.missing} × ${gap.name}`,role:gap.name,count:gap.missing,salary:gap.dailyRate*30,source});result.crew.push({...gap,count:gap.missing});result.total+=gap.missing;}
    state.advanced.facilities=state.advanced.facilities||{};if(allow('facility'))for(const gap of before.facilities.filter(x=>x.missing>0&&(!ctx.facilityId||x.facilityId===ctx.facilityId))){const m=state.advanced.facilities[gap.facilityId]||(state.advanced.facilities[gap.facilityId]={staff:0,departments:{operations:75,finance:70,hr:70,commercial:70,maintenance:75,security:75}});m.staff=(Number(m.staff)||0)+gap.missing;contract(state,{company:gap.company,name:`${gap.missing} × فريق ${gap.name}`,role:'تشغيل منشأة',count:gap.missing,center:gap.name,salary:5200,source});result.facilities.push({...gap,count:gap.missing});result.total+=gap.missing;}
    state.hired=Array.isArray(state.hired)?state.hired:[];if(allow('executive'))for(const gap of before.executives.filter(x=>x.missing>0)){const c=(ctx.candidates||[]).find(x=>x.id===gap.candidateId);if(!c||state.hired.includes(c.id))continue;state.hired.push(c.id);contract(state,{company:gap.company,candidateId:c.id,name:c.name,role:c.role,count:1,salary:c.salary,source});result.executives.push(c);result.total++;}
    const after=snapshot(state,ctx,company);result.coverageAfter=after.coverage;result.ok=true;result.status='completed';result.missingAfter=after.gaps.filter(g=>allow(g.kind)&&(!ctx.facilityId||g.kind!=='facility'||g.facilityId===ctx.facilityId)).reduce((n,g)=>n+g.missing,0);if(result.missingAfter)throw new Error('hr-hiring-incomplete');hr.hiringLog.unshift({id:nextId(state,'HR-ACT'),at:Number(state.simSeconds)||0,company,source,total:result.total,coverageBefore:before.coverage,coverageAfter:after.coverage});hr.hiringLog=hr.hiringLog.slice(0,200);return result;
  }
  function createRequisition(state,ctx={},company='all',source='manual'){
    const hr=ensure(state),need=snapshot(state,ctx,company);if(!need.total)return null;const existing=hr.requisitions.find(r=>r.status==='open'&&r.company===company);if(existing){existing.need=clone(need);existing.updatedAt=Number(state.simSeconds)||0;return existing;}
    const r={id:nextId(state,'HR-REQ'),company,status:'open',source,createdAt:Number(state.simSeconds)||0,need:clone(need),title:company==='all'?`سد كامل العجز الوظيفي · ${need.total}`:`سد عجز ${company} · ${need.total}`,approvalRequestId:null};hr.requisitions.unshift(r);return r;
  }
  function aiReview(state,ctx={},company='all'){
    const hr=ensure(state),need=snapshot(state,ctx,company),review={id:nextId(state,'HR-AI'),at:Number(state.simSeconds)||0,company,need:clone(need),recommendation:need.total?'hire-gap':'no-action',score:need.total?Math.max(70,Math.min(100,80+Math.round((100-need.coverage)*.2))):100};hr.aiReviews.unshift(review);hr.aiReviews=hr.aiReviews.slice(0,120);return review;
  }
  function tickDay(state,processedDay=null){const hr=ensure(state),d=processedDay==null?day(state):Math.floor(Number(processedDay)||0);let expired=0;for(const c of hr.employmentContracts){const end=Number(c.startDay||0)+Math.max(1,Number(c.termMonths||24))*30;if(c.status==='ساري'&&d>=end){c.status='منتهي';c.endedDay=d;expired++;}}return {day:d,expired};}
  function health(state,ctx={}){const s=snapshot(state,ctx,'all'),hr=ensure(state);return {coverage:s.coverage,missing:s.total,crewMissing:s.crewMissing,facilityMissing:s.facilityMissing,executiveMissing:s.executiveMissing,openRequisitions:hr.requisitions.filter(r=>r.status==='open').length,contracts:hr.employmentContracts.filter(c=>c.status==='ساري').length};}
  function execute(ctx,cmd,p={}){const state=ctx.state||ctx;if(cmd==='tick-day')return tickDay(state,p.day);if(cmd==='hire')return executeHiring(state,ctx,p.company||'all',p.source||'HR Domain Command',p.scope||'all');if(cmd==='hire-executive'){const hr=ensure(state),id=String(p.candidateId||''),c=(ctx.candidates||p.candidates||[]).find(x=>x.id===id);if(!c)throw new Error('candidate-not-found');state.hired=Array.isArray(state.hired)?state.hired:[];if(state.hired.includes(id))throw new Error('candidate-already-hired');state.hired.push(id);const row=contract(state,{company:p.company||'group',candidateId:id,name:c.name,role:c.role,count:1,center:p.center||'المقر الرئيسي',salary:c.salary,source:p.source||'HR executive recruitment'});hr.hiringLog.unshift({id:nextId(state,'HR-ACT'),at:Number(state.simSeconds)||0,company:p.company||'group',source:p.source||'HR executive recruitment',total:1,candidateId:id});hr.hiringLog=hr.hiringLog.slice(0,200);return {candidate:c,contract:row};}if(cmd==='requisition')return createRequisition(state,ctx,p.company||'all',p.source||'domain');if(cmd==='ai-review')return aiReview(state,ctx,p.company||'all');throw new Error(`Unknown HR command: ${cmd}`);}
  const API={VERSION,ensure,snapshot,health,aiReview,createRequisition,executeHiring,requiredCrewForFleet,facilityNeed,companyOfFacility,tickDay,execute};
  globalThis.GH_HR_CORE=API;globalThis.GH_DOMAIN_COMMANDS?.register?.('hr',API);if(globalThis.window&&window!==globalThis)window.GH_HR_CORE=API;if(typeof module!=='undefined'&&module.exports)module.exports=API;
})();

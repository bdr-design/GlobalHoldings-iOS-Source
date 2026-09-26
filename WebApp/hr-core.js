(()=>{
  'use strict';
  const VERSION='3.0.1';
  const platform=()=>globalThis.GH_COMPANY_PLATFORM||null;
  const MANAGER_COMPANIES=Object.freeze(platform()?.listDefinitions?.({includeGroup:false}).filter(definition=>definition.capabilities.includes('hr.management')).map(definition=>definition.id)||['air','sea','road','power','bank','mobility']);
  const OFFICIAL_MANAGER_CANDIDATES=Object.freeze([
    {id:'M-AIR-01',company:'air',name:'ريم العتيبي',role:'الرئيس التنفيذي',city:'الرياض',nationality:'السعودية',salary:780000,skill:96,experience:18,specialty:'شبكات الطيران والنمو الدولي',style:'نمو منضبط'},
    {id:'M-AIR-02',company:'air',name:'ناصر الحربي',role:'الرئيس التنفيذي',city:'جدة',nationality:'السعودية',salary:720000,skill:93,experience:20,specialty:'تشغيل الأساطيل وجودة الخدمة',style:'تشغيل أولًا'},
    {id:'M-SEA-01',company:'sea',name:'خالد الزهراني',role:'الرئيس التنفيذي',city:'الدمام',nationality:'السعودية',salary:740000,skill:95,experience:21,specialty:'الشحن البحري والموانئ',style:'توسع شبكي'},
    {id:'M-SEA-02',company:'sea',name:'هند السالم',role:'الرئيس التنفيذي',city:'الخبر',nationality:'السعودية',salary:700000,skill:92,experience:17,specialty:'الأساطيل والعقود البحرية',style:'انضباط تجاري'},
    {id:'M-ROAD-01',company:'road',name:'سارة القحطاني',role:'الرئيس التنفيذي',city:'الرياض',nationality:'السعودية',salary:680000,skill:95,experience:16,specialty:'اللوجستيات وسلاسل الإمداد',style:'كفاءة الشبكة'},
    {id:'M-ROAD-02',company:'road',name:'تركي الغامدي',role:'الرئيس التنفيذي',city:'الرياض',nationality:'السعودية',salary:640000,skill:91,experience:19,specialty:'النقل البري ومراكز التوزيع',style:'توسع تشغيلي'},
    {id:'M-POWER-01',company:'power',name:'عبدالعزيز الشهري',role:'الرئيس التنفيذي',city:'الرياض',nationality:'السعودية',salary:840000,skill:96,experience:22,specialty:'تطوير مشاريع الطاقة',style:'استثمار طويل الأجل'},
    {id:'M-POWER-02',company:'power',name:'لمى المطيري',role:'الرئيس التنفيذي',city:'الرياض',nationality:'السعودية',salary:810000,skill:94,experience:18,specialty:'الطاقة والتشغيل التجاري',style:'عائد ومخاطر'},
    {id:'M-BANK-01',company:'bank',name:'مشعل الدوسري',role:'الرئيس التنفيذي',city:'الرياض',nationality:'السعودية',salary:920000,skill:97,experience:24,specialty:'الخدمات المصرفية والخزينة',style:'نمو محافظ'},
    {id:'M-BANK-02',company:'bank',name:'دانة الرشيد',role:'الرئيس التنفيذي',city:'الرياض',nationality:'السعودية',salary:890000,skill:96,experience:20,specialty:'مصرفية الشركات والتحول الرقمي',style:'رقمي مؤسسي'},
    {id:'M-MOB-01',company:'mobility',name:'فيصل العنزي',role:'الرئيس التنفيذي',city:'الرياض',nationality:'السعودية',salary:660000,skill:94,experience:15,specialty:'التنقل الذكي وتشغيل الأساطيل',style:'منتج وتشغيل'},
    {id:'M-MOB-02',company:'mobility',name:'شهد الدخيل',role:'الرئيس التنفيذي',city:'الرياض',nationality:'السعودية',salary:650000,skill:93,experience:14,specialty:'المنصات الرقمية وتجربة العميل',style:'رقمي سريع'}
  ]);
  const MANAGER_CANDIDATE_POOL=Object.freeze([
    {id:'executive-01',name:'جود الشمري',city:'الرياض',nationality:'السعودية',style:'قيادة قائمة على البيانات'},
    {id:'executive-02',name:'راكان الدوسري',city:'جدة',nationality:'السعودية',style:'انضباط تشغيلي'},
    {id:'executive-03',name:'نوف اليامي',city:'الخبر',nationality:'السعودية',style:'نمو يركز على العميل'},
    {id:'executive-04',name:'مازن القحطاني',city:'الرياض',nationality:'السعودية',style:'حوكمة وتنفيذ'},
    {id:'executive-05',name:'ديمة السبيعي',city:'الدمام',nationality:'السعودية',style:'تحول مؤسسي'},
    {id:'executive-06',name:'فهد العتيبي',city:'المدينة المنورة',nationality:'السعودية',style:'توسع منضبط'},
    {id:'executive-07',name:'أروى الغامدي',city:'جدة',nationality:'السعودية',style:'تجربة عميل وتشغيل'},
    {id:'executive-08',name:'طلال الزهراني',city:'الخبر',nationality:'السعودية',style:'عائد ومخاطر'},
    {id:'executive-09',name:'هيا الحربي',city:'الرياض',nationality:'السعودية',style:'فرق عالية الأداء'},
    {id:'executive-10',name:'عمر الشهري',city:'الدمام',nationality:'السعودية',style:'تنفيذ طويل الأجل'},
    {id:'executive-11',name:'رنا السالم',city:'جدة',nationality:'السعودية',style:'تجاري مؤسسي'},
    {id:'executive-12',name:'بدر المطيري',city:'الرياض',nationality:'السعودية',style:'ابتكار قابل للتوسع'}
  ].map(Object.freeze));
  const MANAGER_ROLE_FOCUS=Object.freeze({
    'group-chair-v1':'حوكمة المجموعة وتخصيص رأس المال',
    'ceo-aviation-v1':'شبكات الطيران وتشغيل الأساطيل',
    'ceo-marine-v1':'الشحن البحري وإدارة الموانئ',
    'ceo-logistics-v1':'الخدمات اللوجستية وسلاسل الإمداد',
    'ceo-energy-v1':'مشاريع الطاقة والتشغيل التجاري',
    'ceo-bank-v1':'الخدمات المصرفية والخزينة',
    'ceo-mobility-v1':'التنقل الذكي والمنصات الرقمية',
    'ceo-hospitality-v1':'تشغيل الضيافة وتجربة النزيل'
  });
  const GENERATED_MANAGER_CANDIDATE_COUNT=2;
  const FACILITY_STANDARDS=Object.freeze({hq:42,office:18,'airport-base':36,'port-base':44,logistics:24,depot:20,'mobility-center':18,power:32,bank:16,acquired:28});
  const assetOwner=a=>String(a?.ownerCompanyId||a?.companyId||platform()?.ownerForLegacyAssetMode?.(a?.assetMode||a?.type)||(!platform()?a?.type:'')||'');
  const facilityOwner=f=>String(f?.ownerCompanyId||f?.companyId||f?.company||'');
  const EXECUTIVE_RULES=Object.freeze({
    H3:()=>true,
    H4:s=>(s.assets||[]).some(a=>assetOwner(a)==='air')||(s.globalBases||[]).some(f=>facilityOwner(f)==='air'),
    H2:s=>(s.assets||[]).some(a=>assetOwner(a)==='sea')||(s.globalBases||[]).some(f=>facilityOwner(f)==='sea'),
    H1:s=>(s.assets||[]).some(a=>assetOwner(a)==='road')||(s.customHubs||[]).some(f=>facilityOwner(f)==='road'),
    H6:s=>(s.assets||[]).some(a=>assetOwner(a)==='road')||(s.customHubs||[]).some(f=>facilityOwner(f)==='road'),
    H5:s=>(s.acceptedContracts||[]).length>0,
    H7:s=>Object.values(s.stakes||{}).some(v=>Number(v)>0),
    H8:s=>(s.openedCompanies||[]).includes('power'),
    H9:s=>(s.openedCompanies||[]).includes('bank'),
    H10:s=>(s.openedCompanies||[]).includes('bank'),
    H11:s=>(s.openedCompanies||[]).includes('power')
  });
  const clone=v=>globalThis.structuredClone?structuredClone(v):JSON.parse(JSON.stringify(v));
  const day=s=>Math.floor((Number(s?.simSeconds)||0)/86400);
  function stableHash(value){let hash=2166136261;for(let index=0;index<String(value||'').length;index++){hash^=String(value).charCodeAt(index);hash=Math.imul(hash,16777619);}return hash>>>0;}
  function fallbackManagerCandidates(definition,company){
    const profileId=String(definition?.hr?.managerRoleProfileId||'').trim();if(!profileId)return [];
    const definitionId=String(definition.definitionId||definition.id||''),tradeName=String(definition.identity?.trade?.ar||definition.identity?.legalDefault?.ar||definition.identity?.short||company).trim(),focus=MANAGER_ROLE_FOCUS[profileId]||`قيادة ${tradeName}`;
    const poolOffset=stableHash(`${profileId}:${company}:pool`)%MANAGER_CANDIDATE_POOL.length,step=1+(stableHash(`${company}:${definitionId}:step`)%(MANAGER_CANDIDATE_POOL.length-1)),used=new Set(),rows=[];
    for(let slot=0;slot<GENERATED_MANAGER_CANDIDATE_COUNT;slot++){
      let poolIndex=(poolOffset+(slot*step))%MANAGER_CANDIDATE_POOL.length;while(used.has(poolIndex))poolIndex=(poolIndex+1)%MANAGER_CANDIDATE_POOL.length;used.add(poolIndex);
      const person=MANAGER_CANDIDATE_POOL[poolIndex],seed=stableHash(`${company}:${definitionId}:${profileId}:${slot}`),companyToken=String(company).toUpperCase().replace(/[^A-Z0-9]+/g,'-').replace(/^-|-$/g,'').slice(0,24)||'COMPANY',suffix=seed.toString(36).toUpperCase().padStart(7,'0'),specialty=slot===0?`${focus} والنمو المؤسسي`:`${focus} · الحوكمة والانضباط المالي في ${tradeName}`;
      rows.push({id:`M-AUTO-${companyToken}-${slot+1}-${suffix}`,company,ownerCompanyId:company,definitionId,managerRoleProfileId:profileId,candidateSource:'definition-manager-profile',poolProfileId:person.id,name:person.name,role:'الرئيس التنفيذي',city:person.city,nationality:person.nationality,salary:600000+(seed%9)*30000,skill:90+((seed>>>4)%8),experience:15+((seed>>>8)%12),specialty,style:person.style});
    }
    return rows;
  }
  function nextId(state,prefix){state.sequences=state.sequences&&typeof state.sequences==='object'?state.sequences:{};const k=`hrCore_${prefix}`;state.sequences[k]=(Number(state.sequences[k])||0)+1;return `${prefix}-${String(state.sequences[k]).padStart(6,'0')}`;}

  function retireLegacyBankCEO(state,hr){
    const manager=hr.officialManagers.bank;
    if(manager?.status!=='ساري'||!hr.employmentContracts.some(c=>c.id===manager.contractId&&c.status==='ساري'))return;
    const wasHired=(state.hired||[]).includes('H9');
    state.hired=(state.hired||[]).filter(id=>id!=='H9');
    for(const c of hr.employmentContracts)if(c.candidateId==='H9'&&c.status==='ساري'){c.status='منتهي';c.endedDay=day(state);c.endReason='انتقال منصب الرئيس التنفيذي إلى المدير الرسمي';}
    if(wasHired)hr.managerHistory.unshift({candidateId:'H9',company:'bank',name:'نورة المنصور',status:'منتهي',endedDay:day(state),endReason:'تعيين المدير الرسمي'});
    hr.managerHistory=hr.managerHistory.slice(0,100);
  }
  function ensure(state){
    state.advanced=state.advanced||{};
    const hr=state.advanced.labor=state.advanced.labor&&typeof state.advanced.labor==='object'?state.advanced.labor:{};
    hr.employmentContracts=Array.isArray(hr.employmentContracts)?hr.employmentContracts:[];
    hr.requisitions=Array.isArray(hr.requisitions)?hr.requisitions:[];
    hr.hiringLog=Array.isArray(hr.hiringLog)?hr.hiringLog:[];
    hr.trainingSpend=Math.max(0,Number(hr.trainingSpend)||0);
    hr.officialManagers=hr.officialManagers&&typeof hr.officialManagers==='object'&&!Array.isArray(hr.officialManagers)?hr.officialManagers:{};
    hr.managerHistory=Array.isArray(hr.managerHistory)?hr.managerHistory:[];
    const managerCompanyIds=new Set([...MANAGER_COMPANIES,...Object.keys(hr.officialManagers),...(platform()?.listInstances?.(state,{includeGroup:false,capability:'hr.management'}).filter(company=>company.known).map(company=>company.id)||[])]);
    for(const company of managerCompanyIds){const row=hr.officialManagers[company];if(row&&typeof row==='object'&&row.status!=='منتهي')row.status='ساري';else if(row&&typeof row!=='object')delete hr.officialManagers[company];}
    hr.salaryPolicy=hr.salaryPolicy&&typeof hr.salaryPolicy==='object'&&!Array.isArray(hr.salaryPolicy)?hr.salaryPolicy:{};
    const companyIds=platform()?.listInstances?.(state).filter(company=>company.known).map(company=>company.id)||['group',...MANAGER_COMPANIES];for(const company of companyIds){const policy=hr.salaryPolicy[company]=hr.salaryPolicy[company]&&typeof hr.salaryPolicy[company]==='object'?hr.salaryPolicy[company]:{};policy.salaryIndex=Math.max(.5,Math.min(3,Number(policy.salaryIndex)||1));policy.lastRaisePct=Number.isFinite(Number(policy.lastRaisePct))?Number(policy.lastRaisePct):0;policy.lastRaiseDay=Math.max(0,Math.floor(Number(policy.lastRaiseDay)||0));policy.history=Array.isArray(policy.history)?policy.history:[];}
    hr.policy=hr.policy&&typeof hr.policy==='object'?hr.policy:{approvalMode:'executive-authorization',contractMonths:24,minimumCoverage:100};
    retireLegacyBankCEO(state,hr);return hr;
  }
  function companyOfFacility(f){const owner=facilityOwner(f);if(owner)return owner;if(f?.kind==='airport-base')return'air';if(f?.kind==='port-base')return'sea';if(['depot','logistics'].includes(f?.kind))return'road';if(f?.kind==='mobility-center')return'mobility';if(f?.kind==='power')return'power';if(f?.kind==='bank')return'bank';return'group';}
  function facilityNeed(f){const base=FACILITY_STANDARDS[f?.kind]||12,cap=Number(f?.bays||f?.capacityMW||0),scale=f?.kind==='power'?Math.ceil(cap/250)*4:['depot','logistics'].includes(f?.kind)?Math.ceil(cap/20)*3:f?.kind==='mobility-center'?Math.ceil(cap/40)*2:0;return Math.max(base,base+scale);}
  function facilityGaps(state,ctx,company='all'){
    const facilities=(ctx?.getDynamicFacilities?.()||[...(state.globalBases||[]),...(state.customHubs||[])]).filter(f=>f&&f.owned===true),rows=[];state.advanced=state.advanced||{};state.advanced.facilities=state.advanced.facilities||{};
    for(const f of facilities){const owner=companyOfFacility(f);if(company!=='all'&&owner!==company)continue;const needed=facilityNeed(f),have=Math.max(0,Number(state.advanced.facilities?.[f.id]?.staff)||0),missing=Math.max(0,needed-have);rows.push({kind:'facility',company:owner,facilityId:f.id,name:f.name||f.id,needed,have,missing});}
    return rows;
  }
  function executiveOwner(id){if(id==='H4')return'air';if(id==='H2')return'sea';if(['H1','H6'].includes(id))return'road';if(id==='H8'||id==='H11')return'power';if(id==='H9'||id==='H10')return'bank';return'group';}
  function executiveGaps(state,ctx,company='all'){
    const catalog=Array.isArray(ctx?.candidates)?ctx.candidates:[],rows=[];
    for(const [id,rule] of Object.entries(EXECUTIVE_RULES)){
      if(!rule(state))continue;if(id==='H9'&&officialManager(state,'bank'))continue;
      const owner=executiveOwner(id);if(company!=='all'&&company!==owner)continue;
      const candidate=catalog.find(row=>row?.id===id),have=(state.hired||[]).includes(id)?1:0;
      rows.push({kind:'executive',company:owner,candidateId:id,name:candidate?.name||id,role:candidate?.role||'تعريف المرشح مفقود',needed:1,have,missing:have?0:1,salary:Number(candidate?.salary)||0,catalogMissing:!candidate});
    }
    return rows;
  }
  function snapshot(state,ctx={},company='all'){
    ensure(state);const crew=[],facilities=facilityGaps(state,ctx,company),executives=executiveGaps(state,ctx,company),all=[...facilities,...executives],gaps=all.filter(x=>x.missing>0);
    const crewMissing=0,facilityMissing=facilities.reduce((n,x)=>n+x.missing,0),executiveMissing=executives.reduce((n,x)=>n+x.missing,0),total=facilityMissing+executiveMissing;
    const filled=all.reduce((n,x)=>n+Math.min(x.have,x.needed),0),required=all.reduce((n,x)=>n+x.needed,0),coverage=required?Math.round(filled/required*100):100;
    return {company,crew,facilities,executives,gaps,crewMissing,facilityMissing,executiveMissing,total,required,filled,coverage};
  }
  function contract(state,data){const hr=ensure(state),company=String(data.ownerCompanyId||data.company||'group'),c={id:nextId(state,'EMP'),company,ownerCompanyId:company,name:data.name,role:data.role||data.name,count:Math.max(1,Number(data.count)||1),center:data.center||'المقر الرئيسي',salary:Math.max(0,Number(data.salary)||0),startDay:day(state),termMonths:Math.max(1,Number(data.termMonths)||hr.policy.contractMonths||24),status:'ساري',source:data.source||'HR Core',requisitionId:data.requisitionId||null,candidateId:data.candidateId||null,officialManager:!!data.officialManager,appointmentId:data.appointmentId||null};hr.employmentContracts.unshift(c);return c;}
  function requireManagerCompany(state,company,{operational=true}={}){const P=platform();if(P)return P.requireCompany(state,company,{operational,capability:'hr.management'});if(!MANAGER_COMPANIES.includes(company))throw new Error('official-manager-company-invalid');if(operational&&!(state.openedCompanies||[]).includes(company))throw new Error('official-manager-company-not-open');return {id:company};}
  function candidateScopeId(candidateId,company){return `${String(candidateId||'').trim()}--${String(company||'').trim().replace(/[^A-Za-z0-9._-]/g,'-')}`;}
  function managerCandidateRows(state,company){
    const P=platform(),definition=P?.definitionFor?.(state,company),templateCompany=definition?.id||company,moduleRows=state.companyModules?.[company]?.hr?.managerCandidates,profileId=String(definition?.hr?.managerRoleProfileId||'').trim(),definitionId=String(definition?.definitionId||'');
    const templateRows=OFFICIAL_MANAGER_CANDIDATES.filter(candidate=>candidate.company===templateCompany).map(candidate=>({...clone(candidate),id:company===templateCompany?candidate.id:candidateScopeId(candidate.id,company),company,ownerCompanyId:company,...(company===templateCompany?{}:{templateCandidateId:candidate.id,templateCompanyId:templateCompany}),...(profileId?{managerRoleProfileId:profileId}:{})}));
    const explicitRows=(Array.isArray(moduleRows)?moduleRows:[]).filter(candidate=>candidate&&(!candidate.company||String(candidate.company)===company)).map(candidate=>({...clone(candidate),company,ownerCompanyId:company,...(definitionId?{definitionId}:{}),...(profileId?{managerRoleProfileId:profileId}:{})}));
    const rows=new Map();for(const candidate of [...templateRows,...explicitRows])if(String(candidate?.id||'')&&String(candidate?.name||''))rows.set(String(candidate.id),candidate);if(rows.size)return [...rows.values()];
    for(const candidate of fallbackManagerCandidates(definition,company))rows.set(candidate.id,candidate);return [...rows.values()];
  }
  function officialManager(state,company){const hr=ensure(state),key=String(company||'');try{requireManagerCompany(state,key,{operational:false});}catch(_error){return null;}const row=hr.officialManagers[key];if(!row||row.status!=='ساري')return null;const contractRow=(hr.employmentContracts||[]).find(c=>c.id===row.contractId&&c.status==='ساري');if(!contractRow){row.status='منتهي';row.endedDay=day(state);row.endReason='انتهاء/فقد عقد المدير الرسمي';delete hr.officialManagers[key];return null;}return clone(row);}
  function officialManagerCandidates(state,company){ensure(state);const key=String(company||'');try{requireManagerCompany(state,key);}catch(_error){return [];}const current=officialManager(state,key);return managerCandidateRows(state,key).map(c=>({...clone(c),company:key,appointed:current?.candidateId===c.id}));}
  function appointOfficialManager(state,p={}){const hr=ensure(state),company=String(p.company||''),candidateId=String(p.candidateId||'');requireManagerCompany(state,company);const candidate=managerCandidateRows(state,company).find(c=>c.id===candidateId);if(!candidate)throw new Error('official-manager-candidate-invalid');const current=officialManager(state,company);if(current?.candidateId===candidateId)return {appointment:clone(current),candidate:clone(candidate),idempotent:true};if(current){const oldContract=hr.employmentContracts.find(c=>c.id===current.contractId&&c.status==='ساري');if(oldContract){oldContract.status='منتهي';oldContract.endedDay=day(state);oldContract.endReason='استبدال المدير الرسمي';}current.status='منتهي';current.endedDay=day(state);current.endReason='استبدال المدير الرسمي';hr.managerHistory.unshift(clone(current));}
    const appointmentId=nextId(state,'MGR'),row={id:appointmentId,company,ownerCompanyId:company,definitionId:candidate.definitionId||platform()?.definitionFor?.(state,company)?.definitionId||null,managerRoleProfileId:candidate.managerRoleProfileId||platform()?.definitionFor?.(state,company)?.hr?.managerRoleProfileId||null,candidateId:candidate.id,name:candidate.name,role:candidate.role,city:candidate.city,nationality:candidate.nationality,salary:candidate.salary,skill:candidate.skill,experience:candidate.experience,specialty:candidate.specialty,style:candidate.style,appointedDay:day(state),status:'ساري',source:String(p.source||'تعيين مدير رسمي')};const c=contract(state,{company,candidateId:candidate.id,name:candidate.name,role:`${candidate.role} — ${company}`,count:1,center:String(p.center||'المقر الرئيسي للشركة'),salary:candidate.salary,termMonths:Math.max(12,Math.floor(Number(p.termMonths)||48)),source:row.source,officialManager:true,appointmentId});row.contractId=c.id;hr.officialManagers[company]=row;retireLegacyBankCEO(state,hr);hr.hiringLog.unshift({id:nextId(state,'HR-ACT'),at:Number(state.simSeconds)||0,company,source:row.source,total:1,action:'official-manager-appointed',candidateId:candidate.id,appointmentId});hr.hiringLog=hr.hiringLog.slice(0,200);hr.managerHistory=hr.managerHistory.slice(0,100);return {appointment:clone(row),candidate:clone(candidate),contract:clone(c),idempotent:false};}
  function dismissOfficialManager(state,p={}){const hr=ensure(state),company=String(p.company||'');requireManagerCompany(state,company);const current=officialManager(state,company);if(!current)return {dismissed:false,idempotent:true};const c=hr.employmentContracts.find(x=>x.id===current.contractId&&x.status==='ساري');if(c){c.status='منتهي';c.endedDay=day(state);c.endReason=String(p.reason||'إنهاء تكليف المدير الرسمي');}const ended={...current,status:'منتهي',endedDay:day(state),endReason:String(p.reason||'إنهاء تكليف المدير الرسمي')};hr.managerHistory.unshift(ended);delete hr.officialManagers[company];hr.hiringLog.unshift({id:nextId(state,'HR-ACT'),at:Number(state.simSeconds)||0,company,source:'إنهاء تكليف مدير رسمي',total:0,action:'official-manager-dismissed',candidateId:current.candidateId,appointmentId:current.id});hr.hiringLog=hr.hiringLog.slice(0,200);hr.managerHistory=hr.managerHistory.slice(0,100);return {dismissed:true,appointment:clone(ended)};}
  function executeHiring(state,ctx={},company='all',source='تفويض HR رسمي',scope='all'){
    const before=snapshot(state,ctx,company),hr=ensure(state),allow=k=>scope==='all'||scope===k;
    if(!['all','crew','facility','executive'].includes(scope))throw new Error('hr-scope-invalid');
    if(scope==='crew')throw new Error('asset-crew-is-automatic');
    if(allow('executive')&&before.executives.some(row=>row.catalogMissing))throw new Error('hr-candidate-catalog-incomplete');
    const result={crew:[],facilities:[],executives:[],total:0,coverageBefore:before.coverage,coverageAfter:before.coverage,scope};
    state.advanced.facilities=state.advanced.facilities||{};if(allow('facility'))for(const gap of before.facilities.filter(x=>x.missing>0&&(!ctx.facilityId||x.facilityId===ctx.facilityId))){const m=state.advanced.facilities[gap.facilityId]||(state.advanced.facilities[gap.facilityId]={staff:0,departments:{operations:75,finance:70,hr:70,commercial:70,maintenance:75,security:75}});m.staff=(Number(m.staff)||0)+gap.missing;contract(state,{company:gap.company,name:`${gap.missing} × فريق ${gap.name}`,role:'تشغيل منشأة',count:gap.missing,center:gap.name,salary:5200,source});result.facilities.push({...gap,count:gap.missing});result.total+=gap.missing;}
    state.hired=Array.isArray(state.hired)?state.hired:[];if(allow('executive'))for(const gap of before.executives.filter(x=>x.missing>0)){const c=(ctx.candidates||[]).find(x=>x.id===gap.candidateId);if(!c||state.hired.includes(c.id))continue;state.hired.push(c.id);contract(state,{company:gap.company,candidateId:c.id,name:c.name,role:c.role,count:1,salary:c.salary,source});result.executives.push(c);result.total++;}
    const after=snapshot(state,ctx,company);result.coverageAfter=after.coverage;result.ok=true;result.status='completed';result.missingAfter=after.gaps.filter(g=>g.kind!=='crew'&&allow(g.kind)&&(!ctx.facilityId||g.kind!=='facility'||g.facilityId===ctx.facilityId)).reduce((n,g)=>n+g.missing,0);if(result.missingAfter)throw new Error('hr-hiring-incomplete');hr.hiringLog.unshift({id:nextId(state,'HR-ACT'),at:Number(state.simSeconds)||0,company,source,total:result.total,coverageBefore:before.coverage,coverageAfter:after.coverage});hr.hiringLog=hr.hiringLog.slice(0,200);return result;
  }
  function createRequisition(state,ctx={},company='all',source='manual'){
    const hr=ensure(state),need=snapshot(state,ctx,company);if(!need.total)return null;const existing=hr.requisitions.find(r=>r.status==='open'&&r.company===company);if(existing){existing.need=clone(need);existing.updatedAt=Number(state.simSeconds)||0;return existing;}
    const r={id:nextId(state,'HR-REQ'),company,status:'open',source,createdAt:Number(state.simSeconds)||0,need:clone(need),title:company==='all'?`سد كامل العجز الوظيفي · ${need.total}`:`سد عجز ${company} · ${need.total}`,approvalRequestId:null};hr.requisitions.unshift(r);return r;
  }
  function tickDay(state,processedDay=null){const hr=ensure(state),d=processedDay==null?day(state):Math.floor(Number(processedDay)||0);let expired=0;for(const c of hr.employmentContracts){if(c.permanent||c.automaticAssetStaffing)continue;const end=Number(c.startDay||0)+Math.max(1,Number(c.termMonths||24))*30;if(c.status==='ساري'&&d>=end){c.status='منتهي';c.endedDay=d;c.endReason=c.endReason||'انتهاء مدة العقد';expired++;if(c.officialManager&&c.company&&hr.officialManagers[c.company]?.contractId===c.id){const ended={...hr.officialManagers[c.company],status:'منتهي',endedDay:d,endReason:'انتهاء مدة عقد المدير الرسمي'};hr.managerHistory.unshift(ended);delete hr.officialManagers[c.company];}}}hr.managerHistory=hr.managerHistory.slice(0,100);return {day:d,expired};}
  function salaryCompany(state,company){company=String(company||'group');const P=platform();if(P)P.requireCompany(state,company,company==='group'?{operational:false}:{operational:true,capability:'hr.management'});else if(!['group',...MANAGER_COMPANIES].includes(company))throw new Error('salary-company-invalid');return company;}
  function salaryMultiplier(state,company='group'){const hr=ensure(state),key=salaryCompany(state,company);return Math.max(.5,Math.min(3,Number(hr.salaryPolicy[key]?.salaryIndex)||1));}
  function salaryHistory(state,company='group'){const hr=ensure(state),key=salaryCompany(state,company);return clone(hr.salaryPolicy[key]?.history||[]);}
  function applySalaryRaise(state,p={}){const hr=ensure(state),company=salaryCompany(state,p.company||'group'),pct=Math.max(0,Math.min(25,Number(p.percent)||0));if(pct<.5)throw new Error('salary-raise-percent-invalid');const policy=hr.salaryPolicy[company],reference=String(p.reference||`SALARY-${company}-${day(state)}-${policy.history.length+1}`),year=Number.isFinite(Number(p.year))?Math.floor(Number(p.year)):null,note=String(p.note||'زيادة رواتب سنوية معتمدة');const prior=policy.history.find(x=>x.reference===reference);if(prior){if(prior.company!==company||Number(prior.percent)!==pct||prior.year!==year||prior.note!==note)throw new Error('salary-reference-conflict');return clone(prior);}const before=salaryMultiplier(state,company),after=Math.min(3,before*(1+pct/100)),row={reference,company,percent:pct,beforeIndex:before,afterIndex:after,day:day(state),year,note};policy.salaryIndex=after;policy.lastRaisePct=pct;policy.lastRaiseDay=row.day;policy.history.unshift(row);policy.history=policy.history.slice(0,24);hr.hiringLog.unshift({id:nextId(state,'HR-ACT'),at:Number(state.simSeconds)||0,company,source:'annual-compensation-review',total:0,action:'salary-raise',percent:pct,reference});hr.hiringLog=hr.hiringLog.slice(0,200);return clone(row);}
  function health(state,ctx={}){const s=snapshot(state,ctx,'all'),hr=ensure(state),opened=platform()?.listInstances?.(state,{includeGroup:false,openedOnly:true,capability:'hr.management'}).filter(c=>c.operational).map(c=>c.id)||(state.openedCompanies||[]).filter(c=>MANAGER_COMPANIES.includes(c)),officialManagers=opened.filter(c=>officialManager(state,c)).length;return {coverage:s.coverage,missing:s.total,crewMissing:s.crewMissing,facilityMissing:s.facilityMissing,executiveMissing:s.executiveMissing,officialManagerCoverage:opened.length?Math.round(officialManagers/opened.length*100):100,officialManagers,officialManagerRequired:opened.length,openRequisitions:hr.requisitions.filter(r=>r.status==='open').length,contracts:hr.employmentContracts.filter(c=>c.status==='ساري').length};}
  function execute(ctx,cmd,p={}){const state=ctx.state||ctx;if(cmd==='tick-day')return tickDay(state,p.day);if(cmd==='apply-salary-raise')return applySalaryRaise(state,p);if(cmd==='appoint-official-manager')return appointOfficialManager(state,p);if(cmd==='dismiss-official-manager')return dismissOfficialManager(state,p);if(cmd==='hire')return executeHiring(state,ctx,p.company||'all',p.source||'HR Domain Command',p.scope||'all');if(cmd==='hire-executive'){const hr=ensure(state),id=String(p.candidateId||''),c=(ctx.candidates||p.candidates||[]).find(x=>x.id===id);if(!c)throw new Error('candidate-not-found');if(id==='H9'&&officialManager(state,'bank'))throw new Error('منصب الرئيس التنفيذي مشغول بالمدير الرسمي');state.hired=Array.isArray(state.hired)?state.hired:[];if(state.hired.includes(id))throw new Error('candidate-already-hired');state.hired.push(id);const row=contract(state,{company:p.company||'group',candidateId:id,name:c.name,role:c.role,count:1,center:p.center||'المقر الرئيسي',salary:c.salary,source:p.source||'HR executive recruitment'});hr.hiringLog.unshift({id:nextId(state,'HR-ACT'),at:Number(state.simSeconds)||0,company:p.company||'group',source:p.source||'HR executive recruitment',total:1,candidateId:id});hr.hiringLog=hr.hiringLog.slice(0,200);return {candidate:c,contract:row};}if(cmd==='requisition')return createRequisition(state,ctx,p.company||'all',p.source||'domain');throw new Error(`Unknown HR command: ${cmd}`);}
  const API={VERSION,MANAGER_COMPANIES,OFFICIAL_MANAGER_CANDIDATES,MANAGER_CANDIDATE_POOL,ensure,snapshot,health,createRequisition,executeHiring,officialManager,officialManagerCandidates,appointOfficialManager,dismissOfficialManager,facilityNeed,companyOfFacility,tickDay,salaryMultiplier,salaryHistory,applySalaryRaise,execute};
  globalThis.GH_HR_CORE=API;globalThis.GH_DOMAIN_COMMANDS?.register?.('hr',API);if(globalThis.window&&window!==globalThis)window.GH_HR_CORE=API;if(typeof module!=='undefined'&&module.exports)module.exports=API;
})();

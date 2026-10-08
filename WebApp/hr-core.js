(()=>{
  'use strict';
  const VERSION='3.0.2';
  const platform=()=>globalThis.GH_COMPANY_PLATFORM||null;
  const fleetData=()=>{const api=globalThis.GH_FLEET_DATA||(typeof require==='function'?require('./fleet-access-core.js'):null);if(!api)throw new Error('fleet-data-access-unavailable');return api;};
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
    'ceo-insurance-v1':'الاكتتاب والتسعير وإدارة المطالبات',
    'ceo-realestate-v1':'التطوير العقاري والمبيعات والتأجير',
    'ceo-hospitality-v1':'تشغيل الضيافة وتجربة النزيل'
  });
  const GENERATED_MANAGER_CANDIDATE_COUNT=2;
  const FACILITY_STANDARDS=Object.freeze({hq:42,office:18,'airport-base':36,'port-base':44,logistics:24,depot:20,'mobility-center':18,power:32,bank:16,insurance:14,realestate:12,acquired:28});
  const assetOwner=a=>String(a?.ownerCompanyId||a?.companyId||platform()?.ownerForLegacyAssetMode?.(a?.assetMode||a?.type)||(!platform()?a?.type:'')||'');
  const facilityOwner=f=>String(f?.ownerCompanyId||f?.companyId||f?.company||'');
  // Build 358 (million-asset): whether any asset belongs to an owner, counted per class of rows (one cached class scan
  // per fleet revision) instead of visiting every asset until one matches.
  const ownsAssets=(s,owner)=>(fleetData().countByFields(s,['ownerCompanyId','companyId','assetMode','type'],assetOwner).get(owner)||0)>0;
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

  // Build 359: the legacy executive roster (state.hired, catalogue H1-H11) is retired. Each company's official manager
  // carries the leadership and its effect; the legacy contracts end once, with a dated reason and one notice.
  function retireLegacyExecutives(state,hr){
    if(hr.legacyRosterRetired===true&&!(Array.isArray(state.hired)&&state.hired.length))return;hr.legacyRosterRetired=true;
    const hired=Array.isArray(state.hired)?state.hired.slice():[];state.hired=[];
    let ended=0;for(const c of hr.employmentContracts)if(c.candidateId&&!c.officialManager&&c.status==='ساري'){c.status='منتهي';c.endedDay=day(state);c.endReason='إلغاء نظام القيادات القديم؛ المدير الرسمي لكل شركة يغطي القيادة';ended++;}
    if(!hired.length&&!ended)return;
    hr.managerHistory.unshift({candidateId:'legacy-executives',company:'group',name:`${Math.max(hired.length,ended)} قيادات سابقة`,status:'منتهي',endedDay:day(state),endReason:'إلغاء نظام القيادات القديم'});hr.managerHistory=hr.managerHistory.slice(0,100);
    hr.legacyExecutivesRetired={day:day(state),count:Math.max(hired.length,ended),notified:false};
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
    retireLegacyExecutives(state,hr);return hr;
  }
  function companyOfFacility(f){const owner=facilityOwner(f);if(owner)return owner;if(f?.kind==='airport-base')return'air';if(f?.kind==='port-base')return'sea';if(['depot','logistics'].includes(f?.kind))return'road';if(f?.kind==='mobility-center')return'mobility';if(f?.kind==='power')return'power';if(f?.kind==='bank')return'bank';return'group';}
  function facilityNeed(f,state=null){
    const base=FACILITY_STANDARDS[f?.kind]||12;
    // A Mobility center's 3,000 bays are capacity, not 3,000 occupied vehicles. Staffing grows with the delivered fleet.
    // Energy keeps using commissioned project capacity; the canonical field is capacityAmount (capacityMW is legacy).
    const mobilityVehicles=f?.kind==='mobility-center'&&state?(state.mobility?.vehicles||[]).filter(vehicle=>vehicle?.centerId===f.capitalId).length:0;
    const cap=f?.kind==='mobility-center'?mobilityVehicles:Number(f?.capacityAmount??f?.capacityMW??0),scale=f?.kind==='power'?Math.ceil(cap/250)*4:['depot','logistics'].includes(f?.kind)?Math.ceil(Number(f?.bays||0)/20)*3:f?.kind==='mobility-center'?Math.ceil(cap/40)*2:0;
    return Math.max(base,base+scale);
  }
  function facilityGaps(state,ctx,company='all'){
    const facilities=(ctx?.getDynamicFacilities?.()||[...(state.globalBases||[]),...(state.customHubs||[])]).filter(f=>f&&f.owned===true),rows=[];state.advanced=state.advanced||{};state.advanced.facilities=state.advanced.facilities||{};
    for(const f of facilities){const owner=companyOfFacility(f);if(company!=='all'&&owner!==company)continue;const needed=facilityNeed(f,state),have=Math.max(0,Number(state.advanced.facilities?.[f.id]?.staff)||0),missing=Math.max(0,needed-have);rows.push({kind:'facility',company:owner,facilityId:f.id,name:f.name||f.id,needed,have,missing});}
    return rows;
  }
  function snapshot(state,ctx={},company='all'){
    ensure(state);const crew=[],facilities=facilityGaps(state,ctx,company),executives=[],all=[...facilities],gaps=all.filter(x=>x.missing>0);
    const crewMissing=0,facilityMissing=facilities.reduce((n,x)=>n+x.missing,0),executiveMissing=executives.reduce((n,x)=>n+x.missing,0),total=facilityMissing+executiveMissing;
    const filled=all.reduce((n,x)=>n+Math.min(x.have,x.needed),0),required=all.reduce((n,x)=>n+x.needed,0),coverage=required?Math.round(filled/required*100):100;
    return {company,crew,facilities,executives,gaps,crewMissing,facilityMissing,executiveMissing,total,required,filled,coverage};
  }
  function contract(state,data){const hr=ensure(state),company=String(data.ownerCompanyId||data.company||'group'),role=data.role||data.name,c={id:nextId(state,'EMP'),company,ownerCompanyId:company,name:data.name,role,count:Math.max(1,Number(data.count)||1),center:data.center||'المقر الرئيسي',facilityId:data.facilityId||null,salary:Math.max(0,Number(data.salary)||0),startDay:day(state),termMonths:Math.max(1,Number(data.termMonths)||hr.policy.contractMonths||24),status:'ساري',source:data.source||'HR Core',requisitionId:data.requisitionId||null,candidateId:data.candidateId||null,officialManager:!!data.officialManager,appointmentId:data.appointmentId||null,autoRenew:data.autoRenew===true||data.officialManager===true||role==='تشغيل منشأة'};hr.employmentContracts.unshift(c);return c;}
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
    const appointmentId=nextId(state,'MGR'),row={id:appointmentId,company,ownerCompanyId:company,definitionId:candidate.definitionId||platform()?.definitionFor?.(state,company)?.definitionId||null,managerRoleProfileId:candidate.managerRoleProfileId||platform()?.definitionFor?.(state,company)?.hr?.managerRoleProfileId||null,candidateId:candidate.id,name:candidate.name,role:candidate.role,city:candidate.city,nationality:candidate.nationality,salary:candidate.salary,skill:candidate.skill,experience:candidate.experience,specialty:candidate.specialty,style:candidate.style,appointedDay:day(state),status:'ساري',source:String(p.source||'تعيين مدير رسمي')};const c=contract(state,{company,candidateId:candidate.id,name:candidate.name,role:`${candidate.role} — ${company}`,count:1,center:String(p.center||'المقر الرئيسي للشركة'),salary:candidate.salary,termMonths:Math.max(12,Math.floor(Number(p.termMonths)||48)),source:row.source,officialManager:true,appointmentId});row.contractId=c.id;hr.officialManagers[company]=row;retireLegacyExecutives(state,hr);hr.hiringLog.unshift({id:nextId(state,'HR-ACT'),at:Number(state.simSeconds)||0,company,source:row.source,total:1,action:'official-manager-appointed',candidateId:candidate.id,appointmentId});hr.hiringLog=hr.hiringLog.slice(0,200);hr.managerHistory=hr.managerHistory.slice(0,100);return {appointment:clone(row),candidate:clone(candidate),contract:clone(c),idempotent:false};}
  function appointAllOfficialManagers(state,p={}){
    const rows=platform()?.listInstances?.(state,{includeGroup:false,openedOnly:true,capability:'hr.management'}).filter(row=>row.operational).map(row=>row.id)||(state.openedCompanies||[]).filter(company=>MANAGER_COMPANIES.includes(company)),result={appointed:0,skipped:0,companies:[],appointments:[]};
    for(const company of [...new Set(rows)]){if(officialManager(state,company)){result.skipped++;continue;}const candidates=managerCandidateRows(state,company).slice().sort((a,b)=>(Number(b.skill)||0)-(Number(a.skill)||0)||(Number(b.experience)||0)-(Number(a.experience)||0)||(Number(a.salary)||0)-(Number(b.salary)||0)||String(a.id).localeCompare(String(b.id)));if(!candidates.length){result.skipped++;continue;}const out=appointOfficialManager(state,{company,candidateId:candidates[0].id,termMonths:Math.max(12,Math.floor(Number(p.termMonths)||48)),source:String(p.source||'تعيين جماعي معتمد لمديري الشركات')});result.appointed++;result.companies.push(company);result.appointments.push(out.appointment);}
    return result;
  }
  function dismissOfficialManager(state,p={}){const hr=ensure(state),company=String(p.company||'');requireManagerCompany(state,company);const current=officialManager(state,company);if(!current)return {dismissed:false,idempotent:true};const c=hr.employmentContracts.find(x=>x.id===current.contractId&&x.status==='ساري');if(c){c.status='منتهي';c.endedDay=day(state);c.endReason=String(p.reason||'إنهاء تكليف المدير الرسمي');}const ended={...current,status:'منتهي',endedDay:day(state),endReason:String(p.reason||'إنهاء تكليف المدير الرسمي')};hr.managerHistory.unshift(ended);delete hr.officialManagers[company];hr.hiringLog.unshift({id:nextId(state,'HR-ACT'),at:Number(state.simSeconds)||0,company,source:'إنهاء تكليف مدير رسمي',total:0,action:'official-manager-dismissed',candidateId:current.candidateId,appointmentId:current.id});hr.hiringLog=hr.hiringLog.slice(0,200);hr.managerHistory=hr.managerHistory.slice(0,100);return {dismissed:true,appointment:clone(ended)};}
  function executeHiring(state,ctx={},company='all',source='تفويض HR رسمي',scope='all'){
    const before=snapshot(state,ctx,company),hr=ensure(state),allow=k=>scope==='all'||scope===k;
    // Build 359: the legacy executive roster is retired; hiring by its scope is refused rather than reported complete.
    if(scope==='executive')throw new Error('legacy-executives-retired');
    if(!['all','crew','facility'].includes(scope))throw new Error('hr-scope-invalid');
    if(scope==='crew')throw new Error('asset-crew-is-automatic');
    const result={crew:[],facilities:[],executives:[],total:0,coverageBefore:before.coverage,coverageAfter:before.coverage,scope};
    state.advanced.facilities=state.advanced.facilities||{};if(allow('facility'))for(const gap of before.facilities.filter(x=>x.missing>0&&(!ctx.facilityId||x.facilityId===ctx.facilityId))){const m=state.advanced.facilities[gap.facilityId]||(state.advanced.facilities[gap.facilityId]={staff:0,departments:{operations:75,finance:70,hr:70,commercial:70,maintenance:75,security:75}});m.staff=(Number(m.staff)||0)+gap.missing;contract(state,{company:gap.company,facilityId:gap.facilityId,name:`${gap.missing} × فريق ${gap.name}`,role:'تشغيل منشأة',count:gap.missing,center:gap.name,salary:5200,source});result.facilities.push({...gap,count:gap.missing});result.total+=gap.missing;}
    const after=snapshot(state,ctx,company);result.coverageAfter=after.coverage;result.ok=true;result.status='completed';result.missingAfter=after.gaps.filter(g=>g.kind!=='crew'&&allow(g.kind)&&(!ctx.facilityId||g.kind!=='facility'||g.facilityId===ctx.facilityId)).reduce((n,g)=>n+g.missing,0);if(result.missingAfter)throw new Error('hr-hiring-incomplete');hr.hiringLog.unshift({id:nextId(state,'HR-ACT'),at:Number(state.simSeconds)||0,company,source,total:result.total,coverageBefore:before.coverage,coverageAfter:after.coverage});hr.hiringLog=hr.hiringLog.slice(0,200);return result;
  }
  function createRequisition(state,ctx={},company='all',source='manual'){
    const hr=ensure(state),need=snapshot(state,ctx,company);if(!need.total)return null;const existing=hr.requisitions.find(r=>r.status==='open'&&r.company===company);if(existing){existing.need=clone(need);existing.updatedAt=Number(state.simSeconds)||0;return existing;}
    const r={id:nextId(state,'HR-REQ'),company,status:'open',source,createdAt:Number(state.simSeconds)||0,need:clone(need),title:company==='all'?`سد كامل العجز الوظيفي · ${need.total}`:`سد عجز ${company} · ${need.total}`,approvalRequestId:null};hr.requisitions.unshift(r);return r;
  }
  function reconcileFacilityStaffing(state,p={}){
    const hr=ensure(state),facilityId=String(p.facilityId||''),facilities=[...(state.globalBases||[]),...(state.customHubs||[])].filter(f=>f?.owned===true&&(!facilityId||f.id===facilityId));let changed=0,reduced=0,ended=0;
    for(const f of facilities){
      const m=state.advanced.facilities?.[f.id];if(!m)continue;const needed=facilityNeed(f,state),have=Math.max(0,Math.floor(Number(m.staff)||0));if(have<=needed)continue;
      let excess=have-needed;const owner=companyOfFacility(f),contracts=hr.employmentContracts.filter(c=>c?.status==='ساري'&&!c.automaticAssetStaffing&&c.role==='تشغيل منشأة'&&String(c.ownerCompanyId||c.company||'')===owner&&(c.facilityId===f.id||(!c.facilityId&&c.center===(f.name||f.id))));
      for(const c of contracts){if(excess<=0)break;const count=Math.max(1,Math.floor(Number(c.count)||1)),cut=Math.min(count,excess);excess-=cut;reduced+=cut;if(cut===count){c.count=0;c.status='منتهي';c.endedDay=day(state);c.endReason=String(p.reason||'مواءمة فريق المنشأة مع حجم التشغيل الفعلي');ended++;}else c.count=count-cut;changed++;}
      m.staff=needed;changed++;
    }
    return {changed,reduced,ended};
  }
  function migrateFacilityStaffing(state){const hr=ensure(state);if(Number(hr.facilityStaffingModelVersion)>=2)return {changed:0,reduced:0,ended:0};const result=reconcileFacilityStaffing(state,{reason:'ترحيل وقائي: احتساب تشغيل مركز التنقل حسب المركبات الفعلية بدل السعة القصوى'});hr.facilityStaffingModelVersion=2;return result;}
  function tickDay(state,processedDay=null){const hr=ensure(state),d=processedDay==null?day(state):Math.floor(Number(processedDay)||0);let expired=0,renewed=0;for(const c of hr.employmentContracts){if(c.permanent||c.automaticAssetStaffing)continue;const termDays=Math.max(1,Number(c.termMonths||24))*30,end=Number(c.startDay||0)+termDays;if(c.status==='ساري'&&d>=end){if(c.autoRenew===true||c.officialManager===true||c.role==='تشغيل منشأة'){const cycles=Math.max(1,Math.floor((d-Number(c.startDay||0))/termDays));c.startDay=Number(c.startDay||0)+cycles*termDays;c.lastRenewedDay=d;c.renewalCount=(Number(c.renewalCount)||0)+cycles;renewed++;continue;}c.status='منتهي';c.endedDay=d;c.endReason=c.endReason||'انتهاء مدة العقد';expired++;if(c.officialManager&&c.company&&hr.officialManagers[c.company]?.contractId===c.id){const ended={...hr.officialManagers[c.company],status:'منتهي',endedDay:d,endReason:'انتهاء مدة عقد المدير الرسمي'};hr.managerHistory.unshift(ended);delete hr.officialManagers[c.company];}}}hr.managerHistory=hr.managerHistory.slice(0,100);return {day:d,expired,renewed};}
  function salaryCompany(state,company){company=String(company||'group');const P=platform();if(P)P.requireCompany(state,company,company==='group'?{operational:false}:{operational:true,capability:'hr.management'});else if(!['group',...MANAGER_COMPANIES].includes(company))throw new Error('salary-company-invalid');return company;}
  function salaryMultiplier(state,company='group'){const hr=ensure(state),key=salaryCompany(state,company);return Math.max(.5,Math.min(3,Number(hr.salaryPolicy[key]?.salaryIndex)||1));}
  function salaryHistory(state,company='group'){const hr=ensure(state),key=salaryCompany(state,company);return clone(hr.salaryPolicy[key]?.history||[]);}
  function health(state,ctx={}){const s=snapshot(state,ctx,'all'),hr=ensure(state),opened=platform()?.listInstances?.(state,{includeGroup:false,openedOnly:true,capability:'hr.management'}).filter(c=>c.operational).map(c=>c.id)||(state.openedCompanies||[]).filter(c=>MANAGER_COMPANIES.includes(c)),officialManagers=opened.filter(c=>officialManager(state,c)).length;return {coverage:s.coverage,missing:s.total,crewMissing:s.crewMissing,facilityMissing:s.facilityMissing,executiveMissing:s.executiveMissing,officialManagerCoverage:opened.length?Math.round(officialManagers/opened.length*100):100,officialManagers,officialManagerRequired:opened.length,openRequisitions:hr.requisitions.filter(r=>r.status==='open').length,contracts:hr.employmentContracts.filter(c=>c.status==='ساري').length};}
  // The skill of a company's appointed manager (0 when none), read without normalizing state: the simulation's trip
  // context reads it every slice (computeTripEconomics).
  function managerSkill(state,company){const hr=state.advanced?.labor,row=hr?.officialManagers?.[company];if(!row||row.status!=='ساري'||!(hr.employmentContracts||[]).some(c=>c.id===row.contractId&&c.status==='ساري'))return 0;const candidate=managerCandidateRows(state,company).find(c=>c.id===row.candidateId);return Math.max(0,Math.min(100,Number(candidate?.skill)||70));}
  // A company's pay level (90%-130% of its base salaries): payroll scales with it, and against the market wage it sets
  // how many crews quit and how fast they are replaced (GH_REALISM updateCrews).
  const SALARY_LEVELS=Object.freeze([.9,.95,1,1.05,1.1,1.15,1.2,1.3]);
  function setSalaryIndex(state,p){const hr=ensure(state),company=salaryCompany(state,p.company),index=Number(p.index);if(!SALARY_LEVELS.includes(index))throw new Error('salary-index-invalid');const policy=hr.salaryPolicy[company],day=Math.floor((Number(state.simSeconds)||0)/86400),before=policy.salaryIndex;policy.lastRaisePct=Math.round((index/before-1)*1e4)/100;policy.lastRaiseDay=day;policy.salaryIndex=index;policy.history.unshift({day,from:before,to:index});policy.history=policy.history.slice(0,24);return {company,index,from:before};}
  function execute(ctx,cmd,p={}){const state=ctx.state||ctx;if(cmd==='tick-day')return tickDay(state,p.day);if(cmd==='set-salary-index')return setSalaryIndex(state,p);if(cmd==='appoint-official-manager')return appointOfficialManager(state,p);if(cmd==='appoint-all-official-managers')return appointAllOfficialManagers(state,p);if(cmd==='dismiss-official-manager')return dismissOfficialManager(state,p);if(cmd==='hire')return executeHiring(state,ctx,p.company||'all',p.source||'HR Domain Command',p.scope||'all');if(cmd==='hire-executive')throw new Error('legacy-executives-retired');if(cmd==='requisition')return createRequisition(state,ctx,p.company||'all',p.source||'domain');throw new Error(`Unknown HR command: ${cmd}`);}
  const API={VERSION,SALARY_LEVELS,managerSkill,MANAGER_COMPANIES,OFFICIAL_MANAGER_CANDIDATES,MANAGER_CANDIDATE_POOL,ensure,snapshot,health,createRequisition,executeHiring,reconcileFacilityStaffing,migrateFacilityStaffing,officialManager,officialManagerCandidates,appointOfficialManager,appointAllOfficialManagers,dismissOfficialManager,facilityNeed,companyOfFacility,tickDay,salaryMultiplier,salaryHistory,execute};
  globalThis.GH_HR_CORE=API;globalThis.GH_DOMAIN_COMMANDS?.register?.('hr',API);if(globalThis.window&&window!==globalThis)window.GH_HR_CORE=API;if(typeof module!=='undefined'&&module.exports)module.exports=API;
})();

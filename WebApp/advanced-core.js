(() => {
  'use strict';

  const VERSION = '3.0.0';
  const SAVE_SCHEMA_VERSION = '2.0.0';
  const UPDATE_FORMAT = 'global-holdings-update';
  const photos = {
    hq:'assets/images/company-hq-v2.webp', airport:'assets/images/facility-airport-v2.webp', 'airport-base':'assets/images/facility-airport-v2.webp',
    port:'assets/images/facility-port-v2.webp', 'port-base':'assets/images/facility-port-v2.webp', logistics:'assets/images/facility-logistics-v2.webp',
    depot:'assets/images/facility-logistics-v2.webp', office:'assets/images/company-hq-v2.webp', acquired:'assets/images/company-hq-v2.webp',
    power:'assets/images/company-energy-v2.webp', bank:'assets/images/company-bank-v2.webp', intelligence:'assets/images/company-intelligence-v2.webp'
  };

  const initialAdvanced = () => ({
    schema:2,
    ai:{mode:'advisory',approvalLimit:0,automationDisabled:true,requestArchive:[],observations:[],messages:[
      {role:'assistant',text:'أنا مكتب GH Intelligence. أراقب السيولة والأساطيل والمراكز والعقود والمخاطر، وأشرح قراراتي من بيانات المحاكاة نفسها.',sources:['دفتر المجموعة','محرك العمليات']}
    ]},
    facilities:{},
    companies:{},
    treasury:{liquidityBuffer:0,hedgeRatio:35,fxExposure:68000000,interestExposure:42000000,lastStress:null},
    audit:{score:78,lastRun:0,findings:3},
    legal:{openCases:1,licenses:8,compliance:84,lastReview:0},
    procurement:{activeSuppliers:14,annualSpend:126000000,savings:0,tenders:[],manualOnly:true},
    programs:{initiatives:[],completed:0,lastReview:0},researchPrograms:{},
    labor:{employmentContracts:[],trainingSpend:0},
    cyber:{score:76,incidents:0,lastDrill:0,coverage:82},
    safety:{score:88,incidents:0,lastAudit:0},
    economy:{electricityPriceMWh:72,gasCostMWh:39,carbonPriceTon:52,depositRate:.032,loanYield:.075,baseRate:.046,freightIndex:100},
    insurance:{claims:[],annualPremium:0},
    board:{meetings:[],committees:{audit:82,risk:76,remuneration:71,investment:79}},
    content:{visualPack:'GH Visual Library 2.0',catalogVersion:'2026.09',scenarioVersion:'3.0.0'},
    updateHistory:[],
    settings:{reducedData:false,compactKpis:true},
    saveSlots:[null,null,null]
  });

  const clone = value => JSON.parse(JSON.stringify(value));
  const merge = (base, value) => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return base;
    Object.entries(value).forEach(([key,item]) => {
      if (item && typeof item === 'object' && !Array.isArray(item) && base[key] && typeof base[key] === 'object' && !Array.isArray(base[key])) merge(base[key],item);
      else base[key] = item;
    });
    return base;
  };
  const migrate = state => {
    state.advanced = merge(initialAdvanced(), state.advanced || {});
    state.saveVersion = SAVE_SCHEMA_VERSION;
    state.advanced.appVersion = VERSION;
    if(state.treasury?.accounts?.[1])state.advanced.treasury.liquidityBuffer=Number(state.treasury.accounts[1].balance)||0;
    if (!Array.isArray(state.advanced.ai.messages)) state.advanced.ai.messages=[];
    const ai=state.advanced.ai;
    if(!Array.isArray(ai.requestArchive))ai.requestArchive=[];if(!Array.isArray(ai.observations))ai.observations=[];
    // AI is advisory-only. Existing queues are archived once so an upgrade never
    // leaves a decision blocking the game or silently executes an old plan.
    if(ai.restrictedModeVersion!==VERSION){
      const legacy=[...(Array.isArray(ai.requests)?ai.requests:[]),...(Array.isArray(ai.baseAdvice)?ai.baseAdvice:[]),...(Array.isArray(ai.recommendations)?ai.recommendations:[]),...(Array.isArray(ai.routeAdvice)?ai.routeAdvice:[])].filter(Boolean);
      for(const row of legacy){const id=row.id||deterministicId(state,'AI-ARCHIVE');if(!(ai.requestArchive||[]).some(x=>x.id===id))ai.requestArchive.unshift({...clone(row),id,status:'مؤرشف للمراجعة',advisoryOnly:true,closedDay:Math.floor((state.simSeconds||0)/86400),closureReason:'تقليص AI إلى وضع استشاري بلا تنفيذ أو انتظار اعتماد'});}
      ai.requestArchive=ai.requestArchive.slice(0,240);ai.restrictedModeVersion=VERSION;
    }
    for(const legacyKey of ['lastOptimization','recommendations','routeAdvice','baseAdvice','requests','delegations','executionLog','monitoringLetters','annualPlans'])delete ai[legacyKey];
    ai.mode='advisory';ai.approvalLimit=0;ai.automationDisabled=true;
    delete state.advanced.settings.aiBrief;
    const programs=state.advanced.programs=state.advanced.programs&&typeof state.advanced.programs==='object'?state.advanced.programs:{initiatives:[],completed:0,lastReview:0};
    programs.initiatives=Array.isArray(programs.initiatives)?programs.initiatives:[];
    for(const initiative of programs.initiatives)if(initiative&&['بانتظار الاعتماد','قيد الدراسة'].includes(initiative.status)){initiative.status='مؤرشف';initiative.archiveReason='أُلغي مسار الانتظار في Build 301؛ المستشار لا ينفذ مبادرات.';}
    if(state.lastPanel==='programs'){state.lastPanel='actionCenter';state.lastPanelArg=null;}
    const procurement=state.advanced.procurement=state.advanced.procurement&&typeof state.advanced.procurement==='object'?state.advanced.procurement:{};
    for(const legacyKey of ['requests','assetRequests','assetRequestArchive','assetClosureLog','requestCenter','assetPortfolioPlans'])delete procurement[legacyKey];
    procurement.manualOnly=true;procurement.removedLegacyAt=VERSION;
    // Old AI request dependencies never participate in BUILD302. Purge their root
    // snapshots so a migrated save cannot revive an obsolete approval graph.
    delete state.demandClosure;
    if(state.dependencyGraph?.edges?.length)state.dependencyGraph={edges:[],updatedAtSim:Number(state.simSeconds)||0};
    if (!Array.isArray(state.advanced.updateHistory)) state.advanced.updateHistory=[];
    return state;
  };

  const COMPANY_TAB_LABELS={overview:'القيادة',operations:'التشغيل',assets:'الأصول',people:'الأفراد',finance:'المالية',risk:'المخاطر'};
  const COMPANY_DISPLAY_NAMES={air:'الشركة العالمية للطيران',sea:'الشركة العالمية للشحن البحري',road:'اللوجستيات العالمية',power:'شركة الطاقة العالمية',bank:'بنك المجموعة',mobility:'GH Mobility للتنقل الذكي'};
  const parseCompanyViewArg=arg=>typeof arg==='string'&&arg.includes(':')?{type:arg.split(':')[0],tab:arg.split(':')[1]}:arg;
  const meta = (panel,arg) => {
    if(panel==='companyManage'){
      const parsed=parseCompanyViewArg(arg);
      const type=typeof parsed==='object'?parsed?.type:parsed,tab=(typeof parsed==='object'&&parsed?.tab)||'overview';
      const companyName=COMPANY_DISPLAY_NAMES[type]||'الشركة';
      return ['المجموعة والشركات',`${COMPANY_TAB_LABELS[tab]||'مركز إدارة الشركة'} · ${companyName}`];
    }
    return ({
    leadershipHub:['القيادة التنفيذية','مركز القيادة والقرار'],workspaceHub:['النظام والسلامة','الصحة والصيانة'],peopleHub:['الموارد البشرية','وظائف المنشآت والتنظيم'],actionCenter:['القيادة التنفيذية','مركز المهام'],intelligence:['القيادة التنفيذية','المستشار التحليلي المحدود'],aiApprovals:['القيادة التنفيذية','سجل الاعتمادات المنفذة'],facilityManage:['التشغيل والأصول','إدارة المنشأة'],companyManage:['المجموعة والشركات','مركز إدارة الشركة'],treasury:['المالية والخزينة','السيولة والتمويل'],
    audit:['الحوكمة والمخاطر','التدقيق الداخلي'],compliance:['الحوكمة والمخاطر','الامتثال والمخاطر التشغيلية'],legal:['الحوكمة والمخاطر','القانون والامتثال'],procurement:['التشغيل والأصول','الشراء اليدوي للأصول'],
    governanceHub:['الحوكمة والمخاطر','مركز الرقابة والامتثال'],systemHub:['النظام والسلامة','الصحة والصيانة'],cyber:['الحوكمة والمخاطر','الأمن السيبراني'],safety:['الحوكمة والمخاطر','السلامة والأمن'],updates:['النظام والسلامة','مركز التحديثات'],diagnostics:['النظام والسلامة','مركز التشخيص الشامل'],controlPlane:['النظام والسلامة','مركز التحكم والسلامة المركزي']
  })[panel] || null;
  };
  const root = panel => ['leadershipHub','actionCenter','intelligence','aiApprovals','news','realism','ma','research','esg','career'].includes(panel) ? 'leadership' : ['peopleHub','labor'].includes(panel) ? 'people' : ['governanceHub','governance','audit','legal','insurance','cyber','safety','compliance'].includes(panel) ? 'governance' : ['systemHub','workspaceHub','diagnostics','controlPlane','updates','settings'].includes(panel) ? 'system' : ['treasury','bank'].includes(panel) ? 'finance' : panel==='procurement' ? 'control' : panel==='facilityManage'?'control':panel==='companyManage'?'companies':null;

  const photoFor = kind => photos[kind] || photos.hq;
  const hero = (image,title,copy,tag='LIVE') => `<article class="visual-hero"><img src="${image}" alt="${title}" loading="lazy" data-gh-image><div class="visual-hero-shade"></div><div class="visual-hero-copy"><span>${tag}</span><h3>${title}</h3><p>${copy}</p></div></article>`;
  const tabs = (items,active,attr='data-advanced-tab') => `<div class="tabs">${items.map(([id,label])=>`<button class="tab-btn ${id===active?'active':''}" ${attr}="${id}">${label}</button>`).join('')}</div>`;
  const metrics = items => `<div class="metric-row">${items.map(([label,value,cls=''])=>`<div><span>${label}</span><b class="${cls}">${value}</b></div>`).join('')}</div>`;
  const sectionTitle = (title,copy='') => `<div class="section-heading"><h3>${title}</h3>${copy?`<p>${copy}</p>`:''}</div>`;
  const action = (id,label,extra='',secondary=false) => {const guarded=/\bdisabled\b/.test(extra)&&!/data-disabled-reason=/.test(extra)?`${extra} data-disabled-reason="هذا الإجراء غير متاح حتى تكتمل متطلباته الحالية."`:extra;return `<button class="${secondary?'secondary-btn':'primary-btn'}" data-gh-action="${id}" ${guarded}>${label}</button>`;};
  const deterministicId=(state,prefix)=>globalThis.GH_DETERMINISM?.nextId?.(state,prefix)||`${prefix}-${Math.floor(Number(state?.simSeconds)||0)}-${Math.max(1,(state?.eventLog?.length||0)+1)}`;
  const departmentLifeCard=(dept,ctx)=>{const snap=globalThis.GH_DEPARTMENT_CORE?.snapshot?.(dept,ctx.state);if(!snap)return '';const d=snap.definition,r=snap.last,sig=snap.signal||{score:0,facts:[]},work=snap.openWorkItems||[],subs=snap.managementSubmissions||[];const workHTML=work.length?`<div class="department-work-queue"><div class="section-heading"><h3>قائمة العمل الحالية</h3><p>مهام مولدة من حالة اللعبة الفعلية؛ لا تُغلق بمجرد الضغط إذا بقي سببها قائمًا.</p></div>${work.slice(0,5).map(w=>`<div class="department-work-item"><div><span class="tag ${w.severity==='critical'?'negative':''}">${ctx.esc(w.severity)}</span><b>${ctx.esc(w.title)}</b><small>${ctx.esc(w.evidence)} · المالك ${ctx.esc(w.owner)} · استحقاق يوم ${w.dueDay}</small></div>${action('department-work-action',w.requiresApproval?'تسجيل المعالجة':'بدء المعالجة',`data-dept="${dept}" data-work="${w.id}"`)}</div>`).join('')}</div>`:'<p class="result-note positive">لا توجد استثناءات تشغيلية مفتوحة في دورة القسم الحالية.</p>';const subHTML=subs.length?`<div class="department-submissions"><span>آخر الرفوعات للإدارة</span>${subs.slice(0,3).map(x=>`<p><b>${ctx.esc(x.title)}</b> · ${ctx.esc(x.status)} · يوم ${x.day}</p>`).join('')}</div>`:'';return `<article class="list-item department-life-card" data-department-life="${dept}"><div class="list-item-head"><div><h3>دورة ${ctx.esc(d.name)}</h3><p>${ctx.esc(d.mission)}</p><small>المسؤول: ${ctx.esc(d.owner||'إدارة القطاع')}</small></div><span class="tag ${sig.critical?'negative':sig.score>=80?'positive':''}">${Math.round(sig.score)}/100</span></div>${metrics([['المراجعة',snap.due?'مستحقة':'محدثة',snap.due?'negative':'positive'],['مهام مفتوحة',work.length,work.some(w=>w.severity==='critical')?'negative':''],['متأخرة',snap.overdue||0,(snap.overdue||0)>0?'negative':''],['رفع الإدارة',ctx.esc(d.report)]])}<div class="ownership-grid">${d.tasks.map((t,i)=>`<div><span>مسؤولية ${i+1}</span><b>${ctx.esc(t)}</b></div>`).join('')}</div><div class="department-ai-role"><span>القراءة التحليلية المحدودة</span><p>${ctx.esc(snap.advisoryRole||'يقرأ المؤشرات فقط ولا ينفذ أو يوقف أي وظيفة.')}</p></div><div class="department-procedure"><span>دورة الإجراء</span><p>${(snap.procedures||[]).map(ctx.esc).join(' → ')}</p></div>${workHTML}${r?`<div class="department-report-summary"><b>آخر تقرير · ${ctx.esc(r.grade)} · ${r.score}/100</b><p>${r.findings.map(ctx.esc).join(' · ')}</p>${r.recommendations?.length?`<small>${r.recommendations.map(ctx.esc).join(' · ')}</small>`:''}${r.nextReviewDay!=null?`<small>المراجعة القادمة: يوم ${r.nextReviewDay}</small>`:''}</div>`:'<p class="section-mini">لم تُشغّل دورة القسم بعد. شغّلها يدويًا عند الحاجة.</p>'}${subHTML}<div class="action-row">${action('department-review','تشغيل دورة القسم',`data-dept="${dept}"`)}${action('department-escalate','تسجيل التقرير للمراجعة',`data-dept="${dept}"`,true)}</div></article>`;};
  const findPhoto = (type) => type==='air'?photos.airport:type==='sea'?photos.port:['road','mobility'].includes(type)?photos.logistics:type==='power'?photos.power:photos.bank;

  const managerRoleFor = kind => ({
    airport:'مدير المطار', 'airport-base':'مدير القاعدة الجوية', port:'مدير الميناء', 'port-base':'مدير المحطة البحرية',
    depot:'مدير مركز التشغيل', logistics:'مدير المركز اللوجستي', 'mobility-center':'مدير مركز التنقل الحضري', hq:'الرئيس التنفيذي للمقر', office:'مدير المقر الإقليمي',
    power:'مدير محطة الطاقة', bank:'مدير الفرع المصرفي', acquired:'مدير الشركة المستحوذ عليها'
  }[kind] || 'مدير المنشأة');

  const seedTasksFor = (kind,state) => {
    const common=[{title:'مراجعة الجدول التشغيلي الأسبوعي',status:'قيد التنفيذ'},{title:'تدقيق سجل السلامة والامتثال',status:'مجدولة'}];
    const byKind={
      airport:[{title:'تنسيق خانات الهبوط والإقلاع مع البرج',status:'قيد التنفيذ'}],
      'airport-base':[{title:'تجهيز عقود الوقود والمناولة الأرضية',status:'مجدولة'}],
      port:[{title:'جدولة الأرصفة والرافعات لهذا الأسبوع',status:'قيد التنفيذ'}],
      'port-base':[{title:'التنسيق الجمركي لأول شحنة',status:'مجدولة'}],
      depot:[{title:'تدوير مناوبات السائقين',status:'قيد التنفيذ'}],
      logistics:[{title:'تجهيز أرصفة التحميل وتعيين فريق التشغيل الأول',status:'قيد التنفيذ'}],
      'mobility-center':[{title:'توزيع السيارات على مناطق الطلب وربط الشركاء',status:'قيد التنفيذ'}],
      power:[{title:'فحص معامل الحمل والتوافر',status:'قيد التنفيذ'}],
      bank:[{title:'مراجعة محفظة الودائع والقروض',status:'قيد التنفيذ'}]
    };
    return [...(byKind[kind]||[]),...common].map((t,i)=>({id:`${deterministicId(state,'TASK')}-${i}`,createdAt:0,...t}));
  };

  function facilityModel(state,facility){return globalThis.GH_FACILITY_CORE?.model?.(state,facility)||null;}

  function companyModel(state,type){return globalThis.GH_CORPORATE_CORE?.model?.(state,type)||null;}

  function companyView(arg,ctx){
    const parsed=parseCompanyViewArg(arg);
    const type=typeof parsed==='object'?parsed.type:parsed,m=companyModel(ctx.state,type);
    let active=(typeof parsed==='object'&&parsed.tab)||'overview';
    const names=COMPANY_DISPLAY_NAMES;
    const assets=type==='mobility'?(ctx.state.mobility?.vehicles||[]):ctx.state.assets.filter(a=>a.type===type),performance=ctx.companyPerformance?.(type,30)||{currentNet:Number(ctx.state.sectorProfitToday?.[type])||0,lastDayNet:0,lastDayGross:0,lastDayExpenses:0,net:0,grossRevenue:0,expenses:0,reportedDays:0},profit=performance.currentNet,record=ctx.state.companyRegistry?.[type]||{},liquidity=ctx.companyOperatingBalance?.(type)||0,account=ctx.state.companyFinance?.[type]?.accounts?.[0];
    const assetCount=type==='power'?((Number(ctx.state.energy?.gasMW)>0?1:0)+(Number(ctx.state.energy?.solarMW)>0?1:0)+(Number(ctx.state.energy?.windMW)>0?1:0)+(Number(ctx.state.energy?.storageMWh)>0?1:0)):type==='bank'?Number(ctx.state.bank?.branches||0):assets.length;
    const condition=assets.length?Math.round(assets.reduce((n,a)=>n+(Number(a.condition)||100),0)/assets.length):(assetCount?100:0),contracts=(ctx.state.advanced?.labor?.employmentContracts||[]).filter(c=>c.company===type&&c.status==='ساري'),assetCrewContracts=contracts.filter(c=>c.automaticAssetStaffing),managedContracts=contracts.filter(c=>!c.automaticAssetStaffing),assetCrew=assetCrewContracts.reduce((n,c)=>n+(Number(c.count)||1),0),managedPeople=managedContracts.reduce((n,c)=>n+(Number(c.count)||1),0);
    const tabDefs=Object.entries(COMPANY_TAB_LABELS).filter(([id])=>id!=='ai').map(([id,label])=>[id,label]);
    if(active==='ai')active='overview';
    const bar=tabs(tabDefs,active,'data-company-manage-tab');let body='';
    const facilitiesButton=`<button class="secondary-btn" data-open="companyFacilities" data-arg="${type}">قواعد ومراكز الشركة</button>`;
    if(active==='overview')body=`<article class="list-item"><div class="company-identity-card"><div class="company-logo-badge" data-style="${ctx.esc(record.logoStyle||type)}">${record.logo?`<img src="${ctx.esc(record.logo)}" alt="">`:`<span>${({air:'AIR',sea:'SEA',road:'LOG',power:'NRG',bank:'BNK',mobility:'MOVE'})[type]||'CO'}</span>`}</div><div><h3>${ctx.esc(record.legalName||ctx.typeName(type))}</h3><p>${ctx.esc(account?.id||'حساب قيد الإنشاء')} · حساب مالي مستقل</p><div class="company-identity-editor"><label>اسم الشركة<input class="company-name-input" data-company="${type}" maxlength="60" value="${ctx.esc(record.legalName||ctx.typeName(type))}"></label><button class="secondary-btn company-name-save" data-company="${type}">حفظ الاسم</button></div><div class="company-logo-actions"><label class="secondary-btn company-logo-upload">رفع شعار من الاستديو<input type="file" accept="image/*" data-company="${type}"></label><button class="secondary-btn company-logo-clear" data-company="${type}">الشعار الافتراضي</button></div></div></div>${metrics([['رصيد الحساب',ctx.fmtMoney(liquidity),liquidity>0?'positive':''],['صافي اليوم الجاري',ctx.fmtMoney(profit),profit>=0?'positive':'negative'],['آخر إقفال',ctx.fmtMoney(performance.lastDayNet),performance.lastDayNet>=0?'positive':'negative'],['صافي 30 يوم',ctx.fmtMoney(performance.net),performance.net>=0?'positive':'negative']])}${metrics([['الأصول الفعلية',assetCount],['متوسط الحالة',`${condition}%`],['أيام مالية مسجلة',performance.reportedDays]])}<div class="ownership-grid"><div><span>المالك</span><b>${ctx.esc(record.owner||ctx.state.profile.name)}</b></div><div><span>رقم ضريبي</span><b>${ctx.esc(record.taxId||'قيد الإصدار')}</b></div><div><span>العقد</span><b>${ctx.esc(record.formationContract||'قيد الإصدار')}</b></div><div><span>الفواتير</span><b>${ctx.state.finance?.invoices?.filter(x=>(x.company||'group')===type).length||0}</b></div></div><div class="action-row">${facilitiesButton}</div></article>`;
    if(active==='operations')body=type==='mobility'?`${facilitiesButton}<div class="company-company-engine">${globalThis.GH_MOBILITY_CORE?.render?.(ctx)||'<div class="empty">محرك التنقل غير متاح.</div>'}</div>`:`${facilitiesButton}<article class="list-item"><h3>نموذج التشغيل</h3>${metrics([['مستوى الخدمة',`${m.serviceLevel}%`],['الأتمتة',`${m.automation}%`],['الأصول النشطة',assets.filter(a=>a.routeId).length]])}<p>تُدار السعة والتسعير والصيانة والموظفون والعقود كمنظومة واحدة، وتمنع حدود المخاطر التوسع غير الممول.</p><div class="action-row">${action('company-service','برنامج جودة · $1.5M',`data-company="${type}"`)}${action('company-automation','أتمتة · $3M',`data-company="${type}"`,true)}</div></article>${['power','bank'].includes(type)?'':departmentLifeCard(type,ctx)}${type==='power'?`<div class="company-company-engine">${renderEnergy(ctx)}</div>`:type==='bank'?`<div class="company-company-engine">${renderBank(ctx)}</div>`:''}`;
    if(active==='assets')body=type==='power'?`<article class="list-item"><h3>محفظة أصول الطاقة</h3>${metrics([['غاز',`${Number(ctx.state.energy?.gasMW||0)} MW`],['شمسي',`${Number(ctx.state.energy?.solarMW||0)} MW`],['رياح',`${Number(ctx.state.energy?.windMW||0)} MW`],['تخزين',`${Number(ctx.state.energy?.storageMWh||0)} MWh`]])}<div class="action-row"><button class="primary-btn" data-open="energy">فتح سجل الطاقة</button></div></article>`:type==='bank'?`<article class="list-item"><h3>شبكة أصول البنك</h3>${metrics([['الفروع',assetCount],['عملاء الشركات',Object.keys(ctx.state.bank?.corporateClients||{}).length],['السيولة',ctx.fmtMoney(liquidity)]])}<div class="action-row"><button class="primary-btn" data-open="bank">فتح تشغيل البنك</button></div></article>`:`<article class="list-item"><div class="list-item-head"><div><h3>الأصول المملوكة</h3><p>هذا الملخص يقود إلى سجل الأصول الموحد؛ لا توجد قائمة ثانية مختلفة داخل صفحة الشركة.</p></div><span class="tag">${assets.length} أصل</span></div>${metrics([['الإجمالي',assets.length],['متحركة',assets.filter(a=>a.phase==='moving'||a.status==='moving').length],['رواتب مرتبطة',ctx.fmtMoney(type==='mobility'?(globalThis.GH_MOBILITY_CORE?.snapshot?.(ctx.state)?.monthlyPayroll||0):(globalThis.GH_FLEET_CORE?.monthlyPayroll?.(ctx.state,type)||0))]])}<div class="action-row"><button class="primary-btn" data-open="assets" data-arg="${type}">فتح الأصول المملوكة</button><button class="secondary-btn" data-open="assetMarket" data-arg="${type}">شراء أصل</button>${facilitiesButton}</div></article>`;
    if(active==='people')body=`<article class="list-item"><h3>الأفراد والعقود</h3>${metrics([['طاقم الأصول الآلي',assetCrew],['المنشآت والقيادة',managedPeople],['العقود السارية',contracts.length]])}<p>طاقم كل أصل يُنشأ ويُسعّر تلقائيًا مع الشراء ولا ينتظر موافقة الموارد البشرية. قسم الموارد البشرية مخصص لموظفي المنشآت والقيادة فقط.</p><div class="action-row"><button class="primary-btn" data-open="labor" data-arg="dashboard">فتح موظفي المنشآت والقيادة</button></div></article>${contracts.slice(0,30).map(c=>`<article class="list-item"><div class="list-item-head"><div><h3>${ctx.esc(c.name)}</h3><p>${ctx.esc(c.role||'موظف')} · ${ctx.esc(c.center||'')}</p></div><span class="tag ${c.automaticAssetStaffing?'':'positive'}">${c.automaticAssetStaffing?'آلي ثابت':Number(c.count)||1}</span></div></article>`).join('')}`;
    if(active==='finance')body=`<article class="list-item"><h3>المالية المستقلة</h3>${metrics([['الحساب الجاري',ctx.fmtMoney(liquidity),liquidity>0?'positive':''],['إيراد آخر إقفال',ctx.fmtMoney(performance.lastDayGross),performance.lastDayGross>0?'positive':''],['مصروف آخر إقفال',ctx.fmtMoney(performance.lastDayExpenses)],['صافي آخر إقفال',ctx.fmtMoney(performance.lastDayNet),performance.lastDayNet>=0?'positive':'negative']])}${metrics([['إيراد 30 يوم',ctx.fmtMoney(performance.grossRevenue),performance.grossRevenue>0?'positive':''],['مصروف 30 يوم',ctx.fmtMoney(performance.expenses)],['صافي 30 يوم',ctx.fmtMoney(performance.net),performance.net>=0?'positive':'negative'],['رحلات مسجلة',performance.tripCount]])}<p>الإيراد والربح هنا من السجل المالي اليومي لنفس الشركة، ولا يعودان إلى الصفر بصريًا بعد إقفال منتصف الليل. الشركة الجديدة تبقى صفرًا حتى تملك أصلًا أو منشأة أو عقدًا تشغيليًا فعليًا. شراء CAPEX يتم فقط من متجر الأصول أو سجل المنشآت.</p><div class="action-row"><button class="primary-btn" data-open="invoices" data-arg="${type}">المستندات المالية</button></div></article>`;
    if(active==='risk')body=`<article class="list-item"><h3>شهية المخاطر</h3>${metrics([['حد المخاطر',`${m.riskLimit}%`],['سلامة الأصول',`${condition}%`],['التأمين',ctx.state.insurancePolicies.includes(type)?'مغطى':'غير مغطى']])}<div class="action-row">${action('company-risk','تشديد الحد 5 نقاط',`data-company="${type}"`)}</div></article>`;
    return `${hero(findPhoto(type),names[type]||'شركة المجموعة',`${ctx.typeName(type)} · مركز ربح مستقل`,profit>=0?'PROFIT CENTER':'RECOVERY PLAN')}${bar}<div class="list">${body}</div>`;
  }

  function facilityView(arg,ctx) {
    const id=typeof arg==='object'?arg.id:arg,requestedTab=(typeof arg==='object'&&arg.tab)||'command',active=['command','operations','people','finance','compliance'].includes(requestedTab)?requestedTab:'command';
    const f=ctx.findFacility(id);if(!f)return '<div class="empty">تعذر العثور على المنشأة.</div>';
    const m=facilityModel(ctx.state,f),isAirport=['airport','airport-base'].includes(f.kind),isPort=['port','port-base'].includes(f.kind);
    const tabbar=tabs([['command','القيادة'],['operations','التشغيل'],['people','الأفراد'],['finance','المال'],['compliance','الامتثال']],active,'data-facility-tab');
    let body='';
    if(active==='command'){
      const hq=['hq','office'].includes(f.kind),commandMetrics=hq?metrics([['جاهزية الحوكمة',`${m.compliance}%`],['فعالية القرار',`${m.serviceLevel}%`],['المرونة المؤسسية',`${m.safety}%`]]):metrics([['الاستغلال',`${m.utilization}%`],['مستوى الخدمة',`${m.serviceLevel}%`],['السلامة',`${m.safety}%`]]);
      body=`${commandMetrics}${metrics([['ميزانية التشغيل',ctx.fmtMoney(m.budget)],['الإيراد/الأثر المتوقع',ctx.fmtMoney(m.expectedRevenue)],['الموظفون',ctx.fmtNumber(m.staff)]])}
      <article class="list-item"><h3>${hq?'مكتب قيادة المجموعة':'صلاحيات المدير المحلي'}</h3><p>${hq?'المقر يعرض رأس المال والسيولة والأداء والسجل التنفيذي. التنفيذ يتم من القسم المختص ويُسجل مكتملًا للمراجعة.':'ينفذ المدير المحلي ضمن الميزانية، وتظهر النتيجة مباشرة في سجل الاعتمادات المنفذة.'}</p><div class="action-row">${action('facility-budget','إضافة ميزانية · $2M',`data-id="${f.id}"`)}<button class="secondary-btn" data-open="aiApprovals">سجل الاعتمادات المنفذة</button></div></article>${hq?`<article class="list-item"><h3>ملخص المجموعة</h3>${metrics([['شركات تابعة',ctx.state.openedCompanies?.length||0],['سجلات تنفيذ',ctx.state.domainRuntime?.commands?.length||0],['عقود كبرى',ctx.state.acceptedContracts?.length||0]])}${metrics([['السيولة الموحدة',ctx.fmtMoney(ctx.state.cash)],['الدين الموحد',ctx.fmtMoney(ctx.state.debt)],['قيمة المجموعة',ctx.fmtMoney(ctx.state.groupValue)]])}<div class="action-row"><button class="primary-btn" data-open="finance">فتح المركز المالي</button><button class="secondary-btn" data-open="actionCenter">المهام الحالية</button></div></article>`:''}`;
    }
    if(active==='operations'&&f.kind==='mobility-center'){
      const centerStats=globalThis.GH_MOBILITY_CORE?.centerSnapshot?.(ctx.state,f.capitalId)||{vehicles:0,moving:0,drivers:0,online:0,activeTrips:0,completed:0,platformRevenue:0,grossBookings:0};
      body=`<article class="list-item"><h3>تشغيل مركز ${ctx.esc(f.city)}</h3>${metrics([['سيارات هذا المركز',centerStats.vehicles],['متحركة الآن',centerStats.moving],['شركاء القيادة',centerStats.drivers]])}${metrics([['متصلون الآن',centerStats.online],['رحلات نشطة',centerStats.activeTrips],['الاستغلال',`${centerStats.vehicles?Math.round(centerStats.moving/centerStats.vehicles*100):0}%`]])}${metrics([['رحلات مكتملة',centerStats.completed],['إجمالي الحجوزات',ctx.fmtMoney(centerStats.grossBookings)],['ربح المركز الفعلي',ctx.fmtMoney(centerStats.platformRevenue)]])}<p>الأسطول والسائقون والطلبات والمسارات هنا محلية لمدينة ${ctx.esc(f.city)} فقط، ومنفصلة تمامًا بيانيًا عن أي مركز آخر.</p><div class="action-row"><button class="primary-btn" data-open="assetMarket" data-arg="mobility">شراء مركبات لهذا المركز</button>${action('facility-maintenance','برنامج صيانة · $1M',`data-id="${f.id}"`,true)}</div></article>`;
    } else if(active==='operations')body=`<article class="list-item"><h3>${isAirport?'تشغيل المطار':isPort?'تشغيل المحطة البحرية':'تشغيل المركز'}</h3>${metrics([[isAirport?'حركات/يوم':isPort?'نوافذ رسو':'بوابات تشغيل',m.capacity],['الاستغلال',`${m.utilization}%`],['الصيانة',`${m.maintenance}%`]])}<p>${isAirport?'إدارة الخانات الزمنية والبوابات والمناولة والوقود والمستودع والصيانة.':isPort?'إدارة الأرصفة والغاطس والرافعات والساحة والتبريد والقاطرات والجمارك.':'إدارة الاستلام والتخزين والتوزيع والمناوبات والشحن البارد والطاقة.'}</p><div class="action-row">${action('facility-maintenance','برنامج صيانة · $1M',`data-id="${f.id}"`)}${action('facility-expand','توسعة القدرة · $12M',`data-id="${f.id}"`,true)}</div></article>
      <article class="list-item"><h3>العقود وSLA</h3>${metrics([['عقود نشطة',m.contracts],['خدمة في الموعد',`${m.serviceLevel}%`],['قدرة متاحة',`${Math.max(0,100-m.utilization)}%`]])}<div class="action-row">${action('facility-contract','توقيع عقد تشغيلي',`data-id="${f.id}"`)}</div></article>`;
    if(active==='people')body=`<article class="list-item"><h3>المسؤول المسؤول عن المنشأة</h3><div class="metric-row two"><div><span>الدور</span><b>${m.manager||managerRoleFor(f.kind)}</b></div><div><span>الفريق</span><b>${ctx.fmtNumber(m.staff)} موظف</b></div></div></article>
      <article class="list-item"><h3>الهيكل المحلي</h3>${Object.entries(m.departments).map(([id,v])=>`<div class="department-row"><span>${({operations:'العمليات',finance:'المالية',hr:'الموارد البشرية',commercial:'التجاري',maintenance:'الصيانة',security:'الأمن'})[id]}</span><div class="progress-bar"><span style="width:${v}%"></span></div><b>${v}%</b></div>`).join('')}<div class="action-row">${action('facility-hire','توظيف فريق تشغيل · $500K',`data-id="${f.id}"`)}</div></article>
      <article class="list-item"><h3>المهام النشطة</h3>${(m.tasks||[]).length?`<div class="list">${m.tasks.map(t=>`<div class="task-row ${t.status==='مكتملة'?'done':''}"><span>${ctx.esc(t.title)}</span><b>${t.status}</b>${t.status!=='مكتملة'?`<button class="secondary-btn" data-gh-action="facility-task-done" data-id="${f.id}" data-task="${t.id}">إنهاء</button>`:''}</div>`).join('')}</div>`:'<p class="section-mini">لا مهام نشطة حاليًا.</p>'}<div class="action-row">${action('facility-task','إسناد مهمة جديدة · $150K',`data-id="${f.id}"`)}</div></article>`;
    if(active==='finance'){const revenue=(m.expectedRevenue||0)/365,cost=(f.dailyCost||0)+m.staff*48+m.level*900,profit=revenue-cost;body=`<article class="list-item"><h3>مركز الربحية</h3>${metrics([['استثمار تأسيسي',ctx.fmtMoney(f.cost||0)],['إيراد يومي',ctx.fmtMoney(revenue),revenue?'positive':''],['تكلفة يومية',ctx.fmtMoney(cost)]])}${metrics([['صافي يومي',ctx.fmtMoney(profit),profit>=0?'positive':'negative'],['ميزانية',ctx.fmtMoney(m.budget)],['عقود نشطة',m.contracts]])}<p>يُدمج صافي هذا المركز فعليًا في الإغلاق المالي اليومي للمجموعة، وتأتي الإيرادات من عقود SLA المسجلة هنا.</p></article>`;}
    if(active==='compliance')body=`<article class="list-item"><h3>السلامة والامتثال</h3>${metrics([['امتثال',`${m.compliance}%`],['أمن',`${m.security}%`],['سلامة',`${m.safety}%`]])}<p>المراجعة تشمل التراخيص، أمن المنشأة، الجمارك، سلامة العاملين، السجلات التشغيلية واستمرارية الأعمال.</p><div class="action-row">${action('facility-audit','تدقيق شامل · $500K',`data-id="${f.id}"`)}</div></article>`;
    return `${hero(f.photo||photoFor(f.kind),f.name,`${f.city||'—'} · ${f.country||'—'} · ${ctx.facilityKind(f.kind)}`,m.serviceLevel>=90?'PREMIUM OPS':'OPERATIONS')}${tabbar}<div class="list">${body}</div>`;
  }

  function aiAnswer(question,ctx) {
    const s=ctx.state,q=question.toLowerCase(),daily=Object.values(s.sectorProfitToday||{}).reduce((a,b)=>a+b,0);
    const active=s.assets.filter(a=>a.routeId).length,condition=s.assets.length?s.assets.reduce((n,a)=>n+(a.condition||100),0)/s.assets.length:100;
    if(/وقود|fuel|18/.test(q)){
      const exposure=Math.max(1,s.assets.filter(a=>a.routeId).length)*18500,impact=exposure*.18;
      return {text:`سيناريو ارتفاع الوقود 18% يخفض الهامش اليومي التقديري بنحو ${ctx.fmtMoney(impact)}. الأولوية: تحوط 45% من التعرض، إيقاف أقل المسارات هامشًا، ورفع تسعير العقود الجديدة 3–5%.`,sources:['الأصول النشطة','احتياطي الوقود','هوامش الرحلات']};
    }
    if(/سيولة|دين|تمويل/.test(q)){
      const runway=Math.max(0,Math.floor(s.cash/Math.max(1,Math.abs(Math.min(0,daily))+42500)));
      return {text:`السيولة ${ctx.fmtMoney(s.cash)} مقابل دين ${ctx.fmtMoney(s.debt)}. هامش التشغيل اليومي ${ctx.fmtMoney(daily)}، والاحتياطي التشغيلي التقديري ${ctx.fmtNumber(runway)} يومًا. هذا تحليل للقراءة فقط؛ لا يصدر المستشار موافقات أو أوامر تشغيل.`,sources:['المركز المالي','الإغلاق اليومي','سجل الدين']};
    }
    if(/سنغافورة|قاعدة|مركز/.test(q)){
      return {text:'خطة فتح قاعدة عالمية: دراسة طلب وربط مسارات، فحص الترخيص والضرائب، اختيار نوع القاعدة، حجز 120 يومًا من تكلفة التشغيل، ثم تشغيل تجريبي عند 35% من القدرة. سنغافورة مناسبة للبحر والشحن الجوي لكن رسومها ومنافسة السعة مرتفعة.',sources:['الدليل العالمي','تكاليف القواعد','طلب الشبكة']};
    }
    if(/إغلاق|اغلق|جدوى.*مركز|مركز.*جدوى/.test(q)){
      const facilities=Object.entries(s.advanced.facilities||{}).map(([id,m])=>({id,m}));
      const weak=facilities.filter(x=>x.m.utilization<35||x.m.serviceLevel<70).sort((a,b)=>(a.m.utilization+a.m.serviceLevel)-(b.m.utilization+b.m.serviceLevel))[0];
      return weak?{text:`مراجعة GH AI: المنشأة ${weak.id} هي الأقل جدوى حاليًا؛ استغلالها ${weak.m.utilization}% وخدمتها ${weak.m.serviceLevel}%. التوصية: خطة إنقاذ 30 يومًا (عقد/مسار/تحسين) ثم رفع قرار إغلاق منظم إن لم تتجاوز 45% استغلالًا. لا يتم الإغلاق تلقائيًا لأن الأصول والعقود قد تتأثر.`,sources:['مركز الربحية','استغلال المنشآت','العقود النشطة']}:{text:'لا توجد مراكز مفتوحة ذات بيانات تشغيلية كافية للمراجعة. افتح مركزًا وشغّله ثم اطلب تقرير الجدوى.',sources:['سجل المنشآت']};
    }
    if(/شراء|أصول|سفن|شاحنات|طائرات|vip|غاز/.test(q)){
      const active=s.assets.filter(a=>a.routeId).length,byType=t=>s.assets.filter(a=>a.type===t).length;
      return {text:`خطة الاحتياج المقترحة: ${active<10?'ابدأ بـ 4 طائرات شحن متوسطة، 4 شاحنات نقل ثقيل، وسفينتي حاويات؛ لا توسع العدد قبل توقيع عقود تغطي 65% من السعة.':'وسّع بناءً على العقود: 10 سفن حاويات للخطوط العامة، أو 10 ناقلات غاز فقط عند وجود عقد طويل الأجل، و12 شاحنة ثقيلة لتغذية المراكز، وطائرتي شحن VIP للعقود عالية الهامش.'} الأسطول الحالي: طيران ${byType('air')}، بحر ${byType('sea')}، بر ${byType('road')}. القرار النهائي يبقى لديك ويجب أن يمر من اعتماد شراء وتحويل/شيك.`,sources:['الأسطول','العقود','سيولة الحساب الجاري','سعة المراكز']};
    }
    if(/lng|ناقلة|تأجير|شراء/.test(q)){
      return {text:'الشراء يرفع قيمة الأصول ويخفض التكلفة طويلة الأجل لكنه يستهلك رأس المال ويحمّل مخاطر القيمة المتبقية. التأجير يحافظ على السيولة ويزيد الالتزام الشهري. أوصي بالشراء إذا كان العقد المؤكد يغطي 65% من القدرة لخمس سنوات؛ وإلا فالتأجير التشغيلي أقل مخاطرة.',sources:['كتالوج السفن','التزامات الإيجار','العقود النشطة']};
    }
    if(/خسر|خسارة|مسار|ربح/.test(q)){
      const last=s.assets.filter(a=>a.lastTrip).sort((a,b)=>a.lastTrip.margin-b.lastTrip.margin)[0];
      return last?{text:`أضعف دورة حديثة هي ${last.name} بهامش ${ctx.fmtMoney(last.lastTrip.margin)}. الإيراد ${ctx.fmtMoney(last.lastTrip.revenue)}، الوقود ${ctx.fmtMoney(last.lastTrip.fuelCost)}، الطاقم ${ctx.fmtMoney(last.lastTrip.crewCost)} والصيانة ${ctx.fmtMoney(last.lastTrip.maintReserve)}. راجع الإشغال والتسعير قبل تغيير الأصل.`,sources:[`رحلة ${last.name}`,'دفتر تكلفة الرحلة']}:{text:'لا توجد دورة مكتملة كافية للتحليل. شغّل أصلًا على مسار ثم أعد السؤال.',sources:['محرك الرحلات']};
    }
    if(/عقد|مناقصة|sla/.test(q)){
      return {text:'أقيّم العقد على خمس طبقات: الهامش بعد الوقود والعمالة، القدرة المتاحة، احتمال غرامة SLA، مخاطر العملة، وتركيز العميل. لا أوصي بالتقديم إذا لم تغط القدرة 110% من الذروة أو كان الاحتياطي النقدي أقل من ثلاثة أشهر من التكلفة.',sources:['سجل المناقصات','قدرة الأسطول','الخزينة','حدود المخاطر']};
    }
    if(/أخبار|خبر|headline|news|سوق اليوم|تطورات/.test(q)){
      const events=(s.eventLog||[]).slice(0,30),alerts=(s.alerts||[]).slice(0,12),texts=[...new Set([...events.map(e=>e.text),...alerts].filter(Boolean))].slice(0,12);
      if(!texts.length)return {text:'لا توجد أخبار أو أحداث داخلية كافية للتحليل بعد. شغّل المحاكاة أو السوق ثم أعد الطلب.',sources:['سجل الأحداث']};
      const critical=texts.filter(t=>/خسار|مرتجع|فشل|تعذر|مخاطر|ضغط|انخفاض/.test(t)),growth=texts.filter(t=>/افتتاح|نمو|ارتفاع|اكتمل|اعتمد|توفير/.test(t)),financial=texts.filter(t=>/سيولة|دين|ضريبة|فاتورة|شيك|سعر|فائدة/.test(t));
      const lead=critical[0]||financial[0]||texts[0],decision=critical.length?'الأولوية حماية السيولة واحتواء السبب قبل توسع جديد.':growth.length?'استفد من الزخم لكن اربط أي توسع بعقد وسعة وتمويل واضح.':'حافظ على الوضع الحالي وراقب المؤشرات قبل قرار رأسمالي.';
      return {text:`موجز الأخبار التنفيذي: أهم تطور الآن «${lead}». لدي ${critical.length} إشارة مخاطر، ${growth.length} إشارة فرصة/نمو، و${financial.length} حدثًا ماليًا ضمن آخر البيانات. القرار المقترح: ${decision}`,sources:['سجل الأحداث','تنبيهات المجموعة','المؤشرات الاقتصادية','الخزينة والتشغيل']};
    }
    return {text:`الموجز التنفيذي: ${active} أصلًا يعمل من أصل ${s.assets.length}، متوسط الحالة ${condition.toFixed(1)}%، السيولة ${ctx.fmtMoney(s.cash)}، وصافي اليوم ${ctx.fmtMoney(s.todayProfit)}. أكبر فرصة الآن هي رفع استغلال المراكز منخفضة الاستخدام قبل شراء قدرة جديدة.`,sources:['الأسطول','المراكز','المالية','العقود']};
  }

  function renderAI(ctx) {
    const ai=ctx.state.advanced.ai,msgs=ai.messages.slice(-10),observations=(ai.observations||[]).length,archived=(ai.requestArchive||[]).length;
    return `${hero(photos.intelligence,'GH Intelligence','محلل استشاري محدود: يقرأ المؤشرات ويجيب عند الطلب فقط، ولا يشتري أو يوظف أو ينشئ مسارًا أو يوقف وظيفة.','ADVISORY ONLY')}
      <div class="list"><article class="list-item"><div class="list-item-head"><div><h3>حدود ثابتة لا تتغير</h3><p>لا توجد طوابير موافقة AI ولا خطط ذاتية ولا تنفيذ تلقائي. جميع أزرار اللعبة اليدوية تنفذ ضمن قواعد المجال وتذهب إلى سجل الاعتمادات كعمليات معتمدة ومنفذة.</p></div><span class="tag positive">محدود</span></div>${metrics([['صلاحية التنفيذ','صفر'],['طلبات معلقة',0],['ملاحظات مراقبة',observations],['سجل قديم مؤرشف',archived]])}<div class="action-row"><button class="primary-btn" data-open="aiApprovals">سجل الاعتمادات المنفذة</button><button class="secondary-btn" data-open="diagnostics">صحة النظام</button></div></article>
      <article class="list-item"><h3>المحلل عند الطلب</h3><p>الإجابة تفسيرية فقط ولا تغيّر حالة اللعبة.</p><div class="ai-quick"><button data-ai-prompt="حلل السيولة والدين">السيولة</button><button data-ai-prompt="حلل جاهزية الأصول">الأصول</button><button data-ai-prompt="وش أثر ارتفاع الوقود 18%؟">الوقود</button><button data-ai-prompt="أعطني الموجز التنفيذي">الموجز</button></div><section class="ai-chat">${msgs.map(m=>`<article class="ai-message ${m.role}"><span>${m.role==='assistant'?'GH AI':'أنت'}</span><p>${ctx.esc(m.text)}</p>${m.sources?.length?`<small>المصادر: ${m.sources.map(ctx.esc).join(' · ')}</small>`:''}</article>`).join('')}</section><div class="ai-composer"><textarea id="aiPrompt" rows="2" placeholder="اسأل سؤالًا تحليليًا…"></textarea><button data-gh-action="ai-send">تحليل فقط</button></div></article></div>`;
  }

  // سجل موحّد لكل أمر نطاق نُفّذ فعليًا في اللعبة (state.domainRuntime.commands)، سواء احتاج
  // موافقة أم لا. موزّع الأوامر المركزي (domain-command-core.js) يسجّل هذا تلقائيًا لكل استدعاء
  // من أي قسم دون استثناء، فهذا العرض لا يعتمد على أي قسم يتذكر تسجيل نفسه بشكل منفصل.
  const DOMAIN_LABELS={hr:'الموارد البشرية',ai:'المستشار التحليلي',contracts:'العقود',market:'السوق',corporate:'الشركة الأم',banking:'البنك',facilities:'المنشآت',governance:'الحوكمة',routes:'المسارات',operations:'العمليات',procurement:'المشتريات',strategy:'الاستراتيجية',fleet:'الأسطول',finance:'المالية'};
  function renderUnifiedOperationsLog(ctx){
    const rows=(ctx.state.domainRuntime?.commands||[]).slice(0,80),failed=rows.filter(r=>r.status==='rolled_back').length,manual=rows.filter(r=>r.manual!==false&&r.status==='committed').length;
    return `<article class="list-item"><div class="list-item-head"><div><h3>سجل الاعتمادات والتنفيذ</h3><p>كل إجراء يدوي يُعتمد ويُنفذ فورًا داخل معاملة واحدة، ثم يسجل هنا للمراجعة فقط. لا توجد خطوة انتظار أو زر اعتماد ثانٍ. الإجراء الفاشل يُلغى بالكامل ويظهر كعملية متراجع عنها.</p></div><span class="tag ${failed?'negative':'positive'}">${manual} معتمد · ${failed} ملغي</span></div>${rows.length?rows.map(r=>`<div class="spec-row"><span>${ctx.esc(DOMAIN_LABELS[r.domain]||r.domain)} · ${ctx.esc(r.name)} · ${ctx.esc(r.actor||'—')}</span><b class="${r.status==='committed'?'positive':'negative'}">${r.status==='committed'?(r.manual===false?'نظامي · منفذ':'معتمد · منفذ'):`ملغي بالكامل · ${ctx.esc(r.error||'سبب غير محدد')}`}</b></div>`).join(''):'<div class="empty">لا توجد إجراءات مسجلة بعد.</div>'}</article>`;
  }
  function renderAIApprovals(ctx){
    const ai=ctx.state.advanced.ai,rows=ctx.state.domainRuntime?.commands||[],committed=rows.filter(row=>row.status==='committed'),manual=committed.filter(row=>row.manual!==false),system=committed.length-manual.length,rolledBack=rows.filter(row=>row.status==='rolled_back').length,archive=(ai.requestArchive||[]).slice(0,24);
    return `<div class="list ai-authority-desk"><article class="list-item authority-summary"><div class="list-item-head"><div><h3>الاعتمادات سجل مراجعة فقط</h3><p>الإجراء اليدوي يُعتمد ويُنفذ مباشرة ضمن ضوابط الرصيد والسعة والسلامة والمعاملة الذرية. لا ينتظر منك اعتمادًا ثانيًا، ولا يملك AI صلاحية إنشاء أو إيقاف أي عملية.</p></div><span class="tag positive">لا يوجد انتظار</span></div>${metrics([['يدوي معتمد ومنفذ',manual.length],['نظامي منفذ',system],['ملغي بالكامل',rolledBack,'negative'],['طلبات AI معلقة',0]])}</article>
      ${renderUnifiedOperationsLog(ctx)}
      <article class="list-item"><div class="list-item-head"><div><h3>أرشيف AI السابق</h3><p>محفوظ للمراجعة التاريخية فقط؛ لا يمكن تنفيذه ولا يعطّل اللعبة.</p></div><span class="tag">${archive.length}</span></div>${archive.length?archive.map(row=>`<div class="spec-row"><span>${ctx.esc(row.title||row.name||row.id||'سجل استشاري')} · ${ctx.esc(row.company?ctx.typeName(row.company):'المجموعة')}</span><b>مؤرشف · بلا صلاحية تنفيذ</b></div>`).join(''):'<div class="empty">لا يوجد أرشيف AI سابق.</div>'}</article></div>`;
  }

  // زر "الخطوة التالية" الوحيد لكل شركة مؤسَّسة: يوصل مباشرة لأول أصل أو موقع يجب على اللاعب شراءه.
  function nextStepButton(id,s){
    const has=(kind)=>(s.globalBases||[]).concat(s.customHubs||[]).some(f=>f.owned&&f.kind===kind);
    if(id==='air')return has('airport-base')?`<button class="primary-btn" data-open="companyFacilities" data-arg="air">✈ القواعد الجوية</button>`:`<button class="primary-btn" data-open="companyFacilities" data-arg="air">✈ افتح أول قاعدة جوية</button>`;
    if(id==='sea')return has('port-base')?`<button class="primary-btn" data-open="companyFacilities" data-arg="sea">⚓ الموانئ</button>`:`<button class="primary-btn" data-open="companyFacilities" data-arg="sea">⚓ افتح أول ميناء</button>`;
    if(id==='road')return `<button class="primary-btn" data-open="companyFacilities" data-arg="road">🚚 ${has('logistics')?'المراكز اللوجستية':'أضف أول مركز لوجستي'}</button>`;
    if(id==='power')return `<button class="primary-btn" data-open="companyManage" data-arg="power:operations">⚡ تشغيل الطاقة</button>`;
    if(id==='bank')return `<button class="primary-btn" data-open="companyManage" data-arg="bank:operations">🏦 تشغيل البنك</button>`;
    if(id==='mobility'){
      const hasCenter=(s.customHubs||[]).some(f=>f.owned&&f.company==='mobility'&&f.kind==='mobility-center'),vehicles=s.mobility?.vehicles||[];
      if(!hasCenter)return `<button class="primary-btn" data-open="companyFacilities" data-arg="mobility">🚗 افتح أول مركز تنقل</button>`;
      if(!vehicles.length)return `<button class="primary-btn" data-open="assetMarket" data-arg="mobility">🚗 اشترِ أول مركبة</button>`;
      return `<button class="primary-btn" data-open="assets" data-arg="mobility">🚗 الأصول المملوكة</button>`;
    }
    return '';
  }
  function renderCompanies(arg,ctx) {
    const tab=arg||'holding',s=ctx.state,totalPeople=s.hired.length+s.crew.reduce((n,c)=>n+c.count,0)+(s.mobility?.drivers||[]).length;
    const tabbar=tabs([['holding','الشركة القابضة'],['subs','الشركات التابعة']],tab,'data-companytab');
    if(tab==='holding')return `${tabbar}${hero(photos.hq,ctx.esc(s.profile.name),`${ctx.esc(s.profile.city)} · ${ctx.esc(s.profile.country)} · قيادة متعددة القطاعات`,s.profile.creditRating)}<div class="list">
      <article class="list-item">${metrics([['قيمة المجموعة',ctx.fmtMoney(s.groupValue)],['السيولة',ctx.fmtMoney(s.cash)],['الدين',ctx.fmtMoney(s.debt)]])}${metrics([['الموظفون',ctx.fmtNumber(totalPeople)],['القواعد',s.globalBases.length+s.customHubs.length+s.branches.length],['السمعة',`${s.profile.reputation}/100`]])}<div class="action-row"><button class="primary-btn" data-open="intelligence">المستشار التحليلي</button><button class="secondary-btn" data-open="governance">مجلس الإدارة</button></div></article>
      <article class="list-item"><h3>نموذج الإدارة</h3><p>كل شركة تعمل كمركز ربح مستقل بميزانية وتشغيل ومخاطر، ثم تُجمع نتائجها في قوائم المجموعة مع رقابة الخزينة والمجلس.</p></article></div>`;
    const sectors=[['air','الشركة العالمية للطيران','شبكة جوية وشحن ومناولة',25000000],['sea','الشركة العالمية للشحن البحري','سفن وموانئ وعقود شحن',30000000],['road','اللوجستيات العالمية','شاحنات ومستودعات وتوزيع',12000000],['power','شركة الطاقة العالمية','توليد وتخزين وشبكة',55000000],['bank','بنك المجموعة','ودائع وتمويل وخزينة',75000000],['mobility','GH Mobility للتنقل الذكي','رحلات حسب الطلب · تسعير وإسناد آلي · شركاء قيادة',120000000]];
    return `${tabbar}<div class="company-visual-grid">${sectors.map(([id,name,copy,cost])=>{
      const assets=id==='mobility'?(s.mobility?.vehicles||[]):s.assets.filter(a=>a.type===id),performance=ctx.companyPerformance?.(id,30)||{currentNet:Number(s.sectorProfitToday?.[id])||0,lastDayNet:0},profit=performance.currentNet!==0?performance.currentNet:performance.lastDayNet,profitLabel=performance.currentNet!==0?'صافي اليوم':'آخر إقفال',opened=s.openedCompanies.includes(id),record=s.companyRegistry?.[id];
      const shortfall=Math.max(0,cost-s.cash);
      return `<article class="company-visual-card ${opened?'':'company-pending'}"><img src="${findPhoto(id)}" alt="${name}" loading="lazy" data-gh-image><div class="company-visual-body"><span>${opened?id.toUpperCase():'قيد التأسيس'}</span><h3>${name}</h3><p>${opened?`${copy} · ${record?.taxId||'ملف قانوني قيد المزامنة'}`:`${copy} · لا توجد أصول أو قاعدة أو طاقم قبل التأسيس.`}</p>${opened?`${metrics([['الأصول',assets.length],[profitLabel,ctx.fmtMoney(profit),profit>=0?'positive':'negative'],['الميزانية',ctx.fmtMoney(record?.budget||0)]])}<div class="action-row">${nextStepButton(id,s)}<button class="secondary-btn" data-open="companyManage" data-arg="${id}">إدارة الشركة</button></div>`:`${metrics([['رأس المال',ctx.fmtMoney(cost)],['سيولة القابضة',ctx.fmtMoney(s.cash)],['الحالة',shortfall?`ينقص ${ctx.fmtMoney(shortfall)}`:'جاهزة للتأسيس']])}<button class="primary-btn open-company" data-type="${id}">فتح الشركة · ${ctx.fmtMoney(cost)}</button>`}</div></article>`;
    }).join('')}</div>`;
  }

  function renderLeadershipHub(ctx) {
    const commands=ctx.state.domainRuntime?.commands||[],committed=commands.filter(x=>x.status==='committed').length,failed=commands.filter(x=>x.status==='rolled_back').length;
    const tasks=globalThis.GH_UI_QUALITY?.collectTasks?.(ctx.state)||[],critical=tasks.filter(x=>x.priority==='critical').length;
    const cards=[
      ['actionCenter','NOW','المهام الحالية','الاستثناءات التشغيلية التي تحتاج متابعة',critical?`${critical} حرج`:'مستقر'],
      ['aiApprovals','LOG','سجل الاعتمادات المنفذة','كل فعل يدوي مسجل كمعتمد ومنفذ للمراجعة',`${committed} سجل`],
      ['realism','ECO','السوق والاقتصاد','طلب · وقود · فائدة · أسعار · مخاطر خارجية','LIVE'],
      ['intelligence','AI','المستشار التحليلي','قراءة مختصرة فقط؛ بلا شراء أو توظيف أو تشغيل','محدود']
    ];
    return `${hero(photos.intelligence,'مركز القيادة والقرار','واجهة مختصرة للمهام والسجل والاقتصاد. التنفيذ يبقى داخل القسم المختص ويُسجل فورًا دون طابور اعتماد.','COMMAND CENTER')}<div class="executive-strip">${metrics([['مهام مفتوحة',tasks.length,tasks.length?'negative':'positive'],['حرج الآن',critical,critical?'negative':'positive'],['منفذ ومسجل',committed,'positive'],['فشل وتراجع',failed,failed?'negative':'positive']])}</div><div class="action-row executive-quick-actions"><button class="primary-btn" data-open="aiApprovals">فتح سجل التنفيذ</button>${action('diagnostics-run','فحص صحة النظام','',true)}</div>${sectionTitle('مساحات القيادة','أربع وجهات واضحة بلا وظائف مكررة أو قرارات تنتظر اعتمادًا ثانيًا.')}<div class="command-grid workspace-card-grid">${cards.map(([panel,code,name,copy,badge])=>`<button class="command-btn workspace-card" data-open="${panel}"><span>${code}</span><div><b>${name}</b><small>${copy}</small></div><em>${badge}</em></button>`).join('')}</div>`;
  }

  function renderActionCenter(ctx){
    const tasks=globalThis.GH_UI_QUALITY?.collectTasks?.(ctx.state)||[];
    const critical=tasks.filter(t=>t.priority==='critical').length,high=tasks.filter(t=>t.priority==='high').length;
    const groups=['القيادة','التشغيل','المالية','الرقابة','النظام'].map(domain=>[domain,tasks.filter(t=>t.domain===domain)]).filter(([,rows])=>rows.length);
    const row=t=>`<article class="list-item action-center-item ${t.priority}"><div class="list-item-head"><div><h3>${ctx.esc(t.title)}</h3><p>${ctx.esc(t.reason||'يتطلب مراجعة أو متابعة.')}</p></div><span class="tag ${t.priority==='critical'?'negative':t.priority==='high'?'warning':''}">${t.priority==='critical'?'حرج':t.priority==='high'?'مرتفع':'متابعة'}</span></div>${t.panel?`<div class="action-row"><button class="primary-btn" data-open="${t.panel}">فتح القسم المسؤول</button></div>`:''}</article>`;
    return `${hero(photos.intelligence,'مركز المهام','يعرض الاستثناءات والمشكلات المفتوحة فقط. كل معالجة يدوية تنفذ مباشرة ثم تُسجل للمراجعة.','ACTION CENTER')}<div class="list"><article class="list-item">${metrics([['إجمالي المهام',tasks.length],['حرجة',critical,'negative'],['مرتفعة',high]])}<div class="action-row">${action('diagnostics-run','فحص صحة النظام')}<button class="secondary-btn" data-open="aiApprovals">سجل التنفيذ</button></div></article>${groups.length?groups.map(([domain,rows])=>`${sectionTitle(domain,`${rows.length} مهمة/استثناء`)}${rows.map(row).join('')}`).join(''):'<div class="empty">لا توجد مهام تحتاج تدخلك الآن. الأنظمة تعمل ضمن الحدود الحالية.</div>'}${sectionTitle('ما تغيّر مؤخرًا','الأحداث والأثر في موضع واحد للمراجعة.')}${String(renderNews(ctx)).replace(/^[\s\S]*?<div class="list">/,'').replace(/<\/div>\s*$/,'')}</div>`;
  }

  function renderPeopleHub(ctx){
    const snap=globalThis.GH_HR_CORE?.snapshot?.(ctx.state)||{total:0,coverage:100,gaps:[]};
    const contracts=(ctx.state.advanced?.labor?.employmentContracts||[]).filter(x=>x.status==='ساري').length;
    const staff=(ctx.state.hired?.length||0)+(ctx.state.crew||[]).reduce((n,x)=>n+(Number(x.count)||0),0)+(ctx.state.mobility?.drivers||[]).length;
    return `${hero(photos.hq,'الأفراد والتنظيم','طواقم الأصول تُنشأ وتُسعّر تلقائيًا مع الشراء؛ وتبقى HR مسؤولة عن وظائف المنشآت والقيادات والعقود والرواتب.','PEOPLE & HR')}<div class="list"><article class="list-item people-summary"><div class="list-item-head"><div><h3>جاهزية القوى البشرية</h3><p>طواقم الطائرات والسفن والشاحنات والسيارات ثابتة وآلية. هذا العجز يخص المنشآت والقيادات فقط.</p></div><span class="tag ${snap.total?'negative':'positive'}">${snap.coverage||0}%</span></div>${metrics([['إجمالي العاملين',staff],['عجز المنشآت والقيادات',snap.total||0,snap.total?'negative':'positive'],['عقود سارية',contracts],['مجالات عجز',(snap.gaps||[]).length]])}<div class="action-row"><button class="primary-btn" data-open="labor">فتح إدارة HR</button>${action('hr-hire-all','توظيف موظفي المنشآت والقيادات',snap.total?'':'disabled')}</div></article></div>${sectionTitle('دورة الأفراد','طاقم الأصل يولد بعقد وراتب ثابت فور الشراء؛ أما وظائف المنشآت والقيادات فتُدار هنا.')}<div class="command-grid workspace-card-grid"><button class="command-btn workspace-card" data-open="labor"><span>HR</span><div><b>إدارة الموارد البشرية</b><small>وظائف منشآت · قيادات · عقود · رواتب</small></div><em>${snap.total?`${snap.total} شاغر`:'مغطى'}</em></button><button class="command-btn workspace-card" data-open="companies"><span>ORG</span><div><b>الهيكل والشركات</b><small>الشركات · الملكية · الهوية · القيادة</small></div><em>${(ctx.state.openedCompanies||[]).length} شركة</em></button><button class="command-btn workspace-card" data-open="career"><span>TAL</span><div><b>القدرات والنضج</b><small>قيادات · نضج مؤسسي · جاهزية النمو</small></div><em>تطوير</em></button></div>`;
  }

  function renderWorkspaceHub(ctx){
    const issues=ctx.state.diagnostics?.lastHealth?.counts?.total||0;
    return `${hero(photos.hq,'مساحات العمل','وصول سريع للمجالات الأقل تكرارًا على الهاتف بدون ازدحام الشريط السفلي.','WORKSPACES')}<div class="command-grid workspace-card-grid"><button class="command-btn workspace-card" data-open="companies"><span>GRP</span><div><b>المجموعة والشركات</b><small>القابضة · الشركات التابعة · الهوية · الملكية</small></div><em>${(ctx.state.openedCompanies||[]).length} مفتوحة</em></button><button class="command-btn workspace-card" data-open="peopleHub"><span>HR</span><div><b>الأفراد وHR</b><small>وظائف المنشآت · عقود · رواتب · جاهزية</small></div><em>PEOPLE</em></button><button class="command-btn workspace-card" data-open="governanceHub"><span>GRC</span><div><b>الحوكمة والمخاطر</b><small>مجلس · تدقيق · قانون · سلامة · سايبر</small></div><em>ASSURANCE</em></button><button class="command-btn workspace-card" data-open="systemHub"><span>SYS</span><div><b>النظام والصيانة</b><small>صحة · تشخيص · تحديثات · حفظ</small></div><em>${issues?`${issues} ملاحظة`:'سليم'}</em></button></div><article class="list-item mobile-command-inbox"><div class="list-item-head"><div><h3>سجل التنفيذ</h3><p>كل فعل يدوي معتمد ومنفذ مباشرة؛ افتح السجل للمراجعة دون أي خطوة انتظار.</p></div><span class="tag positive">جاهز</span></div><div class="action-row"><button class="primary-btn" data-open="aiApprovals">فتح سجل التنفيذ</button><button class="secondary-btn" data-open="actionCenter">المهام الحالية</button></div></article>`;
  }

  // صفحة امتثال واحدة تجمع أربعة أقسام كان لكل منها إجراء واحد فقط (تدقيق/قانون/سلامة/سيبراني).
  // الدوال الأربع الأصلية تبقى كما هي (وروابطها القديمة تعمل)، هنا فقط تُعرض متتالية في صفحة واحدة.
  function renderCompliance(ctx){
    const strip=(h)=>String(h||'').replace(/^<div class="list">/,'').replace(/<\/div>\s*$/,'');
    return `${hero(photos.hq,'الامتثال والمخاطر التشغيلية','التدقيق الداخلي والقانون والسلامة والأمن السيبراني - كل الضوابط التشغيلية في صفحة واحدة.','GRC')}<div class="list">${strip(renderAudit(ctx))}${strip(renderLegal(ctx))}${strip(renderSafety(ctx))}${strip(renderCyber(ctx))}</div>`;
  }
  function renderGovernanceHub(ctx) {
    const cards=[
      ['governance','BRD','مجلس الإدارة','لجان · صلاحيات · اجتماعات · قرارات'],
      ['compliance','GRC','الامتثال والمخاطر التشغيلية','التدقيق · القانون · السلامة · الأمن السيبراني في صفحة واحدة'],
      ['insurance','RSK','التأمين وإدارة المخاطر','وثائق · تغطية · مطالبات · حدود']
    ];
    return `${hero(photos.hq,'الحوكمة والمخاطر','منظومة GRC مستقلة: مجلس الإدارة والضوابط والمخاطر والقانون والسلامة والاستمرارية.','GRC & ASSURANCE')}${sectionTitle('الرقابة المؤسسية','مجلس الإدارة والضوابط والمخاطر والامتثال في نطاق واحد.')}<div class="command-grid grouped">${cards.map(([panel,code,name,copy])=>`<button class="command-btn" data-open="${panel}"><span>${code}</span><div><b>${name}</b><small>${copy}</small></div></button>`).join('')}</div>`;
  }

  function renderSystemHub(ctx) {
    const cards=[
      ['controlPlane','CIE','مركز التحكم والسلامة','Command Bus · Integrity · Incidents · Black Box · Exports'],
      ['diagnostics','HLT','صحة النظام','فحص حي · مشاكل نشطة · سجل تشخيصي'],
      ['updates','UPD','مركز التحديثات','حزم موقعة · تحقق · استعادة آمنة'],
      ['settings','CFG','الحفظ والإعدادات','حفظ · نسخ احتياطية · تفضيلات التطبيق']
    ];
    return `${hero(photos.intelligence,'النظام والصيانة','مساحة تقنية صافية لصحة التطبيق والحفظ والتحديثات والتشخيص، بعيدة عن قرارات الأعمال.','SYSTEM OPERATIONS')}${sectionTitle('صيانة التطبيق','فصل الأدوات التقنية عن الحوكمة والتشغيل يمنع تشتت الوظائف.')}<div class="command-grid grouped">${cards.map(([panel,code,name,copy])=>`<button class="command-btn" data-open="${panel}"><span>${code}</span><div><b>${name}</b><small>${copy}</small></div></button>`).join('')}</div><div class="section-heading"><h3>مختبر إداري</h3><p>God Mode أداة اختبار موثقة وليست جزءًا من التشغيل الطبيعي.</p></div><div class="command-grid grouped"><button class="command-btn god" id="moreGodBtn"><span>GOD</span><div><b>God Mode</b><small>سيولة · ميزانيات · اختبارات · حقن موثق</small></div></button></div>`;
  }

  function renderTreasury(ctx){const t=ctx.state.advanced.treasury;return `${hero(photos.bank,'الخزينة المركزية','إدارة السيولة والعملات وأسعار الفائدة وحدود التمويل.','TREASURY')}<div class="list"><article class="list-item">${metrics([['احتياطي السيولة',ctx.fmtMoney(t.liquidityBuffer)],['تعرض العملات',ctx.fmtMoney(t.fxExposure)],['نسبة التحوط',`${t.hedgeRatio}%`]])}<div class="action-row">${action('treasury-hedge','رفع التحوط 10% · $600K')}${action('treasury-buffer','تحويل $10M للاحتياطي','',true)}</div></article><article class="list-item"><h3>اختبار الضغط</h3><p>صدمة مقترحة: وقود +18%، فائدة +200 نقطة أساس، وعملة تشغيل -8%.</p><div class="action-row">${action('treasury-stress','تشغيل الاختبار')}</div>${t.lastStress?`<p class="result-note">آخر نتيجة: ${ctx.esc(t.lastStress)}</p>`:''}</article>${departmentLifeCard('treasury',ctx)}</div>`;}
  function renderAudit(ctx){const a=ctx.state.advanced.audit,bi=globalThis.GH_INTEGRITY_CORE?.check?.(ctx.state),counts=bi?.byDomain||{};return `${hero(photos.hq,'التدقيق الداخلي','الفحص الحالي يقرأ فعليًا سلامة المال والتشغيل والتبعيات بدل رفع درجة شكلية.','ASSURANCE')}<div class="list"><article class="list-item">${metrics([['فعالية الضوابط',`${a.score}%`],['ملاحظات مفتوحة',a.findings],['مشاكل أعمال نشطة',bi?.counts?.total||0]])}${metrics([['مالية',counts.finance||0],['تشغيل',counts.operations||0],['تبعيات',counts.dependencies||0]])}<div class="action-row">${action('audit-run','تنفيذ تدقيق شامل · $350K')}</div></article>${departmentLifeCard('audit',ctx)}</div>`;}
  function renderLegal(ctx){const l=ctx.state.advanced.legal,fac=(ctx.state.globalBases||[]).length+(ctx.state.customHubs||[]).length,contracts=(ctx.state.advanced?.contracts||[]).filter(x=>x.status==='active'||x.status==='ساري').length;return `${hero(photos.hq,'القانون والامتثال','التقييم الحالي يربط التراخيص والعقود والاختصاصات بالمواقع والعقود الفعلية.','LEGAL')}<div class="list"><article class="list-item">${metrics([['التراخيص',l.licenses],['مواقع تشغيل',fac],['عقود نشطة',contracts]])}${metrics([['قضايا مفتوحة',l.openCases],['الامتثال',`${l.compliance}%`],['فجوة تراخيص',Math.max(0,fac-Number(l.licenses||0))]])}<div class="action-row">${action('legal-review','مراجعة قانونية عالمية · $420K')}</div></article>${departmentLifeCard('legal',ctx)}</div>`;}
  function renderCyber(ctx){const c=ctx.state.advanced.cyber,diag=ctx.state.diagnostics||{},errors=Number(diag.runtimeErrorCount||0)+Number(diag.unhandledRejectionCount||0);return `${hero(photos.intelligence,'الأمن السيبراني','نفس التمرين الحالي، لكن الجاهزية تقرأ التغطية وأخطاء Runtime والاسترداد بدل درجة معزولة.','CYBER')}<div class="list"><article class="list-item">${metrics([['الجاهزية',`${c.score}%`],['التغطية',`${c.coverage}%`],['حوادث',c.incidents]])}${metrics([['أخطاء Runtime',errors],['RTO تقديري',c.rtoMinutes?`${c.rtoMinutes} د`:'—'],['آخر تمرين',c.lastDrill?'مكتمل':'مستحق']])}<div class="action-row">${action('cyber-drill','تمرين استجابة · $650K')}</div></article>${departmentLifeCard('cyber',ctx)}</div>`;}
  function renderSafety(ctx){const h=ctx.state.advanced.safety,assets=ctx.state.assets||[],low=assets.filter(a=>Number(a.condition||100)<82).length,aog=assets.filter(a=>a.phase==='aog'||a.status==='AOG').length;return `${hero(photos.logistics,'السلامة والأمن المؤسسي','التدقيق الحالي يقرأ حالة الأسطول وAOG والصيانة بدل رفع المؤشر تلقائيًا.','HSE')}<div class="list"><article class="list-item">${metrics([['مؤشر السلامة',`${h.score}%`],['حوادث',h.incidents],['أصول <82%',low]])}${metrics([['AOG/تعطل',aog],['ملاحظات مفتوحة',h.openFindings||0],['آخر تدقيق',h.lastAudit?'مكتمل':'مستحق']])}<div class="action-row">${action('safety-audit','تدقيق HSE · $500K')}</div></article>${departmentLifeCard('safety',ctx)}</div>`;}

  function renderManualProcurement(ctx){
    const deliveries=(ctx.state.realism?.procurement?.deliveries||[]).filter(Boolean),pending=deliveries.filter(d=>d.status!=='delivered'),arrived=deliveries.filter(d=>d.status==='delivered');
    return `${hero(photos.logistics,'الشراء اليدوي للأصول','تم حذف الطلبات والمحافظ الآلية. اختر بنفسك الأصل والعدد والقاعدة وطريقة التملك من السوق.','MANUAL ASSET PURCHASE')}<div class="list"><article class="list-item"><div class="list-item-head"><div><h3>السياسة التشغيلية</h3><p>لا يختار AI أصلًا ولا ينشئ أمر شراء ولا يوظف طاقمًا ولا يعيّن مسارًا. كل قرار شراء يبدأ من اختيارك المباشر.</p></div><span class="tag positive">MANUAL ONLY</span></div>${metrics([['قيد الوصول',pending.length],['وصلت',arrived.length],['أصول مملوكة',(ctx.state.assets||[]).length]])}<div class="action-row"><button class="primary-btn" data-open="assetMarket">فتح سوق الأصول اليدوي</button></div></article>${pending.slice().reverse().slice(0,30).map(d=>`<article class="list-item"><div class="list-item-head"><div><h3>${ctx.esc(d.asset?.name||d.catalogId||d.id)}</h3><p>${ctx.esc(d.destination||d.baseId||'')}</p></div><span class="tag">في الطريق</span></div></article>`).join('')||'<div class="empty positive-empty">لا توجد مشتريات يدوية قيد الوصول.</div>'}</div>`;
  }

  function renderEnergy(ctx){const e=ctx.state.energy,m=ctx.state.advanced.economy,r=ctx.state.realism?.energy||{},total=e.gasMW+e.solarMW+e.windMW,reserve=Number(r.reserveMargin||0),storageHealth=Number(r.storageHealth||100),renew=Number(r.renewableShare||0);return `${hero(photos.power,'شركة الطاقة العالمية','نفس محفظة الطاقة الحالية، لكن القرار الآن يقرأ التوافر الفعلي ومرونة الشبكة وصحة التخزين والخسائر قبل التوسع.','ENERGY')}<div class="list"><article class="list-item">${metrics([['قدرة اسمية',`${ctx.fmtNumber(total)} MW`],['قدرة متاحة',`${ctx.fmtNumber(r.availableMW??total*e.availability/100)} MW`],['الإتاحة',`${e.availability}%`]])}<p>المزيج الحالي: غاز ${e.gasMW}MW، شمسي ${e.solarMW}MW، رياح ${e.windMW}MW.</p>${metrics([['مزيج متجدد',`${renew.toFixed(1)}%`],['احتياطي القدرة',`${reserve.toFixed(1)}%`,reserve<0?'negative':reserve<10?'':'positive'],['صحة التخزين',`${storageHealth.toFixed(1)}%`,storageHealth<70?'negative':'positive']])}${metrics([['SOC',`${Number(r.storageSoc||0).toFixed(1)}%`],['سعة فعالة',`${ctx.fmtNumber(r.effectiveStorageMWh??e.storageMWh)} MWh`],['كفاءة دورة',`${Number(r.roundTripEfficiency||86).toFixed(1)}%`]])}${metrics([['سعر الكهرباء',`$${m.electricityPriceMWh.toFixed(1)}/MWh`],['تكلفة الغاز',`$${m.gasCostMWh.toFixed(1)}/MWh`],['فاقد التخزين',`${ctx.fmtNumber(r.roundTripLossMWh||0)} MWh`]])}</article><article class="list-item"><h3>خط مشروعات CAPEX</h3><p>قرار المشروع يقرأ هامش الاحتياط وصحة التخزين والمزيج قبل التنفيذ، ويبقى اختيار المشروع بيدك.</p><div class="action-row"><button class="primary-btn energy-build" data-kind="solar">شمسي 100MW · $82M</button><button class="secondary-btn energy-build" data-kind="wind">رياح 120MW · $145M</button><button class="secondary-btn energy-build" data-kind="storage">تخزين 500MWh · $64M</button></div></article><article class="list-item"><h3>مخاطر التشغيل</h3>${metrics([['احتياطي القدرة',`${reserve.toFixed(1)}%`,reserve<0?'negative':''],['Curtailment',`${Number(r.curtailment||0).toFixed(1)}%`],['دورات التخزين',Number(r.cycles||0).toFixed(1)]])}</article>${departmentLifeCard('power',ctx)}</div>`;}
  function renderBank(ctx){
    const b=ctx.state.bank,stress=ctx.state.advanced.bankStress,r=ctx.state.realism?.banking||{};ctx.ensureBankCorporateClients?.();const liq=ctx.bankLiquidityMetrics?.()||{lcr:r.lcr||0,nsfr:r.nsfr||0,loanDeposit:r.loanDeposit||0},clients=Object.values(b.corporateClients||{}),lc=(b.lettersOfCredit||[]),gtee=(b.guarantees||[]),cet1=Number(r.cet1||b.capitalRatio||0),cet1Head=Number(r.cet1Headroom??(cet1-7)),lcrHead=Number(r.lcrHeadroom??(Number(liq.lcr)-100)),nsfrHead=Number(r.nsfrHeadroom??(Number(liq.nsfr)-100));
    return `${hero(photos.bank,'بنك المجموعة','نفس البنك الحالي لكن المؤشرات تقيس رأس المال والسيولة والتمويل المستقر وجودة الأصول قبل توسيع الائتمان.','CORPORATE BANK')}
      <div class="list"><article class="list-item"><div class="list-item-head"><div><h3>الميزانية والسيولة الرقابية</h3><p>رأس المال والسيولة والتمويل المستقر تُعرض كهامش فوق الحدود بدل رقم منفرد.</p></div><span class="tag ${cet1Head>=0?'positive':'negative'}">CET1 ${cet1.toFixed(1)}%</span></div>${metrics([['الودائع',ctx.fmtMoney(b.deposits)],['القروض',ctx.fmtMoney(b.loans)],['الفروع',b.branches]])}${metrics([['CET1 headroom',`${cet1Head.toFixed(1)} نقطة`,cet1Head<0?'negative':'positive'],['LCR headroom',`${lcrHead.toFixed(0)} نقطة`,lcrHead<0?'negative':'positive'],['NSFR headroom',`${nsfrHead.toFixed(0)} نقطة`,nsfrHead<0?'negative':'positive']])}${metrics([['NPL',`${Number(r.npl??b.npl).toFixed(1)}%`,Number(r.npl??b.npl)>3?'negative':'positive'],['تغطية المخصصات',`${Number(r.provisionCoverage||0).toFixed(0)}%`],['قروض/ودائع',`${Number(r.loanDeposit??liq.loanDeposit).toFixed(0)}%`]])}<div class="action-row"><button class="primary-btn bank-branch">فتح فرع</button>${action('bank-credit-review','مراجعة حدود الشركات',``,true)}${action('bank-cash-sweep','إدارة النقد المركزي')}<button class="secondary-btn bank-loan">توسعة محفظة القروض · $50M</button></div></article>
      <article class="list-item"><h3>عملاء الشركات داخل المجموعة</h3><p>كل شركة لها حد ائتماني وسحب وتصنيف مستقل. البنك يمولها كعميل مؤسسي ولا يخلط أرصدتها.</p>${clients.map(c=>`<div class="bank-client-row"><div><b>${ctx.esc(c.name)}</b><small>${ctx.esc(c.accountId)} · KYC ${ctx.esc(c.kyc)} · ${ctx.esc(c.rating)}</small></div><div><span>${ctx.fmtMoney(c.drawn)} / ${ctx.fmtMoney(c.creditLimit)}</span><div class="action-row">${c.company!=='bank'?action('bank-draw-facility','سحب $10M',`data-company="${c.company}"`,true):''}${c.company!=='bank'?action('bank-issue-lc','اعتماد مستندي $5M',`data-company="${c.company}"`):''}${c.company!=='bank'?action('bank-issue-guarantee','ضمان $5M',`data-company="${c.company}"`):''}</div></div></div>`).join('')}</article>
      <article class="list-item"><h3>تمويل التجارة والضمانات</h3>${metrics([['اعتمادات مستندية نشطة',lc.filter(x=>x.status==='ساري').length],['ضمانات نشطة',gtee.filter(x=>x.status==='ساري').length],['تعرض خارج الميزانية',ctx.fmtMoney(b.offBalance||0)]])}<p>الاعتماد والضمان يزيدان التعرض خارج الميزانية ويؤثران على RWA والسيولة؛ الرسوم وحدها ليست مقياس القرار.</p></article>
      <article class="list-item"><h3>اختبار الضغط والسيولة</h3><p>السيناريو الحالي يبقى نفسه، لكن النتيجة تُقرأ مقابل CET1/LCR/NSFR وجودة المحفظة.</p><div class="action-row">${action('bank-stress','تشغيل الاختبار')}</div>${stress?metrics([['ودائع بعد الصدمة',ctx.fmtMoney(stress.depositsAfter)],['NPL مضغوط',`${stress.npl.toFixed(1)}%`,stress.npl>5?'negative':''],['رأس مال مضغوط',`${stress.capitalRatio.toFixed(1)}%`,stress.capitalRatio<10?'negative':'positive']]):''}</article>${departmentLifeCard('bank',ctx)}</div>`;
  }
  function renderGovernance(ctx){const g=ctx.state.governance,b=ctx.state.advanced.board;return `${hero(photos.hq,'مجلس الإدارة','حوكمة وصلاحيات ولجان وقرارات قابلة للتدقيق.','BOARD')}<div class="list"><article class="list-item">${metrics([['الأعضاء','6'],['الاستقلالية','67%'],['القرار',g.boardDecision==='approved'?'معتمد':'قيد المراجعة']])}<div class="action-row"><button class="primary-btn board-approve">اعتماد برنامج التوسع</button><button class="secondary-btn board-defer">إحالته للمخاطر</button></div></article><article class="list-item"><h3>لجان المجلس</h3>${Object.entries(b.committees).map(([id,v])=>`<div class="department-row"><span>${({audit:'التدقيق',risk:'المخاطر',remuneration:'المكافآت',investment:'الاستثمار'})[id]}</span><div class="progress-bar"><span style="width:${v}%"></span></div><b>${v}%</b></div>`).join('')}<div class="action-row">${action('board-meeting','عقد اجتماع رسمي · $120K')}</div></article>${departmentLifeCard('board',ctx)}</div>`;}
  function renderInsurance(ctx){const sectors=['air','sea','road','power'];const ins=ctx.state.advanced.insurance,renew=Number(ins.renewalIndex||100);return `${hero(photos.hq,'التأمين وإدارة المخاطر','نفس الوثائق والمطالبة الحالية، لكن التسعير يقرأ التعرض وسجل المطالبات والتحمل بدل سعر ثابت.','RISK')}<div class="list"><article class="list-item">${metrics([['وثائق نشطة',ctx.state.insurancePolicies.length],['مطالبات',ins.claims.length],['مؤشر التجديد',`${renew.toFixed(0)}%`]])}${metrics([['قسط سنوي',ctx.fmtMoney(ins.annualPremium||0)],['مطالبات مفتوحة',(ins.claims||[]).filter(x=>!['مغلقة','مدفوعة'].includes(x.status)).length],['احتياطي مطالبات',ctx.fmtMoney(ins.claimReserve||0)]])}</article>${sectors.map(sec=>{const covered=ctx.state.insurancePolicies.includes(sec),policy=ctx.state.insurancePolicyMeta?.[sec]||{},quote=ctx.insuranceQuote?.(sec);return `<article class="list-item"><div class="list-item-head"><div><h3>تغطية ${ctx.typeName(sec)}</h3><p>أضرار الأصل، المسؤولية، توقف الأعمال والطرف الثالث.</p></div><span class="tag ${covered?'positive':''}">${covered?'مغطى':'غير مغطى'}</span></div>${covered?metrics([['القسط',ctx.fmtMoney(policy.premium||0)],['حد التغطية',`${policy.coveragePct||92}%`],['التحمل',`${policy.deductiblePct||2}%`]]):metrics([['عرض حالي',ctx.fmtMoney(quote?.premium||2000000)],['تعرض القطاع',ctx.fmtMoney(quote?.exposure||0)],['مؤشر التجديد',`${Number(quote?.renewalIndex||renew).toFixed(0)}%`]])}<div class="action-row">${covered?action('insurance-claim','فتح مطالبة تأمين',`data-sector="${sec}"`,true):`<button class="primary-btn buy-insurance" data-sector="${sec}">شراء الوثيقة · ${ctx.fmtMoney(quote?.premium||2000000)}</button>`}</div></article>`}).join('')}${departmentLifeCard('insurance',ctx)}</div>`;}
  function renderResearch(ctx){const projects=[['efficiency','كفاءة الأساطيل','يخفض الوقود واحتياطي الصيانة بعد إثبات المرحلة التشغيلية'],['automation','أتمتة العمليات','يرفع كفاءة التشغيل ويخفض تكلفة الطواقم تدريجيًا'],['cleanEnergy','الطاقة النظيفة','يخفض كثافة تكلفة الطاقة ويعزز مرونة المزيج']];const researchPrograms=ctx.state.advanced.researchPrograms||{};return `${hero(photos.intelligence,'البحث والتطوير','نفس المشاريع الحالية لكن كل مرحلة الآن مسجلة بالتكلفة والأثر ولا يتحول الأثر إلى تشغيل كامل قبل اكتمال 100%.','R&D')}<div class="list">${projects.map(([id,name,copy])=>{const pct=Number(ctx.state.research[id])||0,meta=researchPrograms[id]||{},stage=pct>=100?'تشغيلي':pct>=75?'اعتماد وتشغيل تجريبي':pct>=50?'اختبار موسع':pct>=25?'نموذج أولي':'فكرة ودراسة';return `<article class="list-item"><div class="list-item-head"><div><h3>${name}</h3><p>${copy}</p></div><span class="tag ${pct>=100?'positive':''}">${stage} · ${pct}%</span></div><div class="progress-bar"><span style="width:${pct}%"></span></div>${metrics([['الإنفاق المتراكم',ctx.fmtMoney(meta.spent||0)],['المراحل',meta.rounds||0],['الأثر',pct>=100?'مفعل':'غير كامل']])}<div class="action-row"><button class="primary-btn fund-research" data-project="${id}" ${pct>=100?'disabled data-disabled-reason="اكتمل المشروع ودخل التشغيل."':''}>تمويل مرحلة · $25M</button></div></article>`}).join('')}${departmentLifeCard('research',ctx)}</div>`;}
  function renderESG(ctx){
    const e=ctx.state.esg,su=ctx.state.sustainability||{targetYear:2035,renewableShare:12,safShare:0,shorePower:0,electricRoadShare:0,circularity:42,waterScore:55,supplyChainScore:60,disclosure:68,carbonIntensity:100,programs:{}};
    const bands=ctx.state.assets.reduce((o,x)=>{const b=x.specs?.co2Band||'C';o[b]=(o[b]||0)+1;return o;},{}),fleet=Math.max(1,ctx.state.assets.length),low=(bands.A||0)+(bands.B||0),lowShare=Math.round(low/fleet*100),road=ctx.state.assets.filter(x=>x.type==='road'),electricRoad=Math.round(road.filter(x=>x.specs?.electric||x.specs?.hydrogen).length/Math.max(1,road.length)*100);su.electricRoadShare=Math.max(su.electricRoadShare||0,electricRoad);
    const score=Math.round((e.environment+e.social+e.governance+Math.min(100,lowShare+su.renewableShare/2)+su.circularity+su.supplyChainScore+su.disclosure)/7);
    const programs=[
      ['fleet','تحديث الأسطول منخفض الانبعاثات','road',12000000,'كهرباء/هيدروجين، شحن ذكي، إحلال الأصول الأعلى استهلاكًا'],
      ['saf','وقود طيران مستدام SAF','air',18000000,'عقود توريد وخلط وقود تقلل كثافة الانبعاثات الجوية'],
      ['shore','كهرباء الموانئ Shore Power','sea',16000000,'خفض تشغيل المحركات أثناء الرسو وربط القواعد البحرية بالطاقة النظيفة'],
      ['renewable','طاقة متجددة للمرافق','power',24000000,'شمسي/رياح وعقود PPA للمقرات والقواعد والمراكز'],
      ['circular','الاقتصاد الدائري والصيانة','group',9000000,'إعادة استخدام القطع، الإطارات، الزيوت والمخلفات والتتبع الرقمي'],
      ['supply','سلسلة توريد مسؤولة','group',7000000,'تقييم الموردين، سلامة العمالة، انبعاثات Scope 3 واشتراطات العقود'],
      ['water','المياه والتنوع الحيوي','group',6000000,'كفاءة المياه، خطط التسرب، حماية المواقع الحساسة والتعويض البيئي'],
      ['disclosure','الإفصاح والحوكمة المناخية','group',5000000,'مؤشرات قابلة للتدقيق، مخاطر انتقالية ومادية، تقارير مجلس الإدارة']
    ];
    return `${hero(photos.power,'الاستدامة والتحول المؤسسي','منظومة تشغيل ومال ومخاطر تشمل الأسطول والطاقة والمرافق وسلسلة التوريد والحوكمة، وليس مؤشر ESG واحدًا.','SUSTAINABILITY 2.0')}
      <div class="list"><article class="list-item"><div class="list-item-head"><div><h3>لوحة التحول حتى ${su.targetYear}</h3><p>يربط البرنامج الاستثمار بتكلفة التشغيل، جودة التمويل، المخاطر والسمعة.</p></div><span class="tag positive">${score}/100</span></div>${metrics([['أسطول A/B',`${lowShare}%`],['طريق منخفض الانبعاث',`${su.electricRoadShare}%`],['طاقة متجددة',`${su.renewableShare}%`]])}${metrics([['دائرية',`${su.circularity}%`],['سلسلة توريد',`${su.supplyChainScore}%`],['إفصاح',`${su.disclosure}%`]])}<div class="action-row">${action('esg-review','مراجعة مؤشرات الاستدامة')}</div></article>
      <article class="list-item"><h3>ESG الأساسي</h3>${metrics([['بيئي',e.environment],['اجتماعي',e.social],['حوكمة',e.governance]])}<p>الدرجة الأساسية تبقى متوافقة مع ملفات الحفظ، لكن القرار التشغيلي أصبح مبنيًا على البرامج التفصيلية أدناه.</p></article>
      ${programs.map(([id,name,company,cost,copy])=>{const prog=su.programs?.[id],maturity=Math.max(0,Math.min(100,Number(prog?.maturity)||0)),stateLabel=!prog?'مقترح':maturity>=100?'مستقر تشغيليًا':`${prog.status||'قيد التنفيذ'} · ${Math.round(maturity)}%`;return `<article class="list-item"><div class="list-item-head"><div><h3>${name}</h3><p>${copy}</p></div><span class="tag ${prog?'positive':''}">${stateLabel}</span></div>${prog?`<div class="progress-bar"><span style="width:${maturity}%"></span></div>${metrics([['النضج',`${Math.round(maturity)}%`],['الإنفاق',ctx.fmtMoney(prog.cost||cost)],['الأثر',maturity>=100?'مستقر':'يتدرج مع التشغيل']])}`:''}<div class="action-row">${action('esg-program',prog?'معتمد':`اعتماد · ${ctx.fmtMoney(cost)}`,`data-program="${id}" data-company="${company}" data-cost="${cost}" ${prog?'disabled data-disabled-reason="البرنامج معتمد ويظهر تقدمه في نفس البطاقة."':''}`,!!prog)}</div></article>`}).join('')}${departmentLifeCard('esg',ctx)}</div>`;
  }

  function renderCareer(ctx){const s=ctx.state,score=Math.round(Math.min(100,s.groupValue/25000000+s.assets.length*1.4+s.globalBases.length*3+s.profile.reputation*.25));return `${hero(photos.hq,'النضج المؤسسي','تقييم واقعي لقدرة المجموعة على التمويل والتوسع والحوكمة، وليس مستوى أركيديًا.','RATING')}<div class="list"><article class="list-item">${metrics([['النضج',`${score}/100`],['التصنيف',s.profile.creditRating],['السمعة',`${s.profile.reputation}/100`]])}<div class="progress-bar"><span style="width:${score}%"></span></div><p>${score<40?'مرحلة تأسيس: ركز على السيولة والعمليات الأساسية.':score<70?'مجموعة إقليمية: ارفع الحوكمة ووسع شبكة العقود.':'مجموعة عالمية: ركز على التكامل والاستحواذ وإدارة المخاطر.'}</p></article></div>`;}
  function renderNews(ctx,arg){
    const filter=(arg&&typeof arg==='object'?arg.filter:arg)||'all',all=(ctx.state.eventLog||[]).slice(0,120);
    const classify=e=>{const t=String(e.type||'operation'),text=String(e.text||'');if(t==='economy'||/سوق|فائدة|وقود|طاقة|شحن|سعر/.test(text))return 'economy';if(t==='program'||/برنامج|مشروع|بحث/.test(text))return 'strategy';if(/فاتورة|ضريبة|سيولة|دين|شيك|تحويل/.test(text))return 'finance';return 'operations';};
    const severity=e=>/خسار|مرتجع|تعذر|فشل|انخفاض|مخاطر|ضغط/.test(e.text||'')?'critical':/ارتفاع|افتتاح|اكتمل|اعتمد|نمو/.test(e.text||'')?'positive':'neutral';
    const events=filter==='all'?all:all.filter(e=>classify(e)===filter),latest=all[0],counts={economy:0,operations:0,finance:0,strategy:0};all.forEach(e=>counts[classify(e)]++);
    const headline=latest?.text||'لا توجد أحداث جديدة بعد';
    return `${hero(photos.intelligence,'GH Newsroom','غرفة أخبار تنفيذية تربط الحدث بأثره على الاقتصاد والتشغيل والقرار، مع وصول منفصل للمستشار المحدود.','LIVE INTEL')}
      <article class="news-lead"><div><span class="news-kicker">LATEST · يوم ${Math.floor((latest?.at||ctx.state.simSeconds||0)/86400)+1}</span><h2>${ctx.esc(headline)}</h2><p>الأخبار هنا ناتجة عن المحاكاة وسجل قراراتك وليست تغذية إنترنت خارجية.</p></div><button class="primary-btn" data-open="intelligence">فتح المستشار المحدود</button></article>
      <div class="news-metrics">${metrics([['اقتصاد',counts.economy],['تشغيل',counts.operations],['مالية',counts.finance],['استراتيجية',counts.strategy]])}</div>
      <div class="news-filter"><button data-news-filter="all" class="${filter==='all'?'active':''}">الكل</button><button data-news-filter="economy" class="${filter==='economy'?'active':''}">الاقتصاد</button><button data-news-filter="operations" class="${filter==='operations'?'active':''}">التشغيل</button><button data-news-filter="finance" class="${filter==='finance'?'active':''}">المالية</button><button data-news-filter="strategy" class="${filter==='strategy'?'active':''}">الاستراتيجية</button></div>
      <div class="news-feed">${events.length?events.slice(0,50).map(e=>{const cat=classify(e),sev=severity(e);return `<article class="news-card ${sev}"><div class="news-card-meta"><span>${({economy:'اقتصاد',operations:'تشغيل',finance:'مالية',strategy:'استراتيجية'})[cat]}</span><time>${ctx.formatDuration(Math.max(0,ctx.state.simSeconds-(e.at||0)))}</time></div><h3>${ctx.esc(e.text)}</h3></article>`}).join(''):'<div class="empty">لا توجد أخبار في هذا التصنيف.</div>'}</div>`;
  }
  function renderLabor(arg,ctx){
    const tab=arg||'dashboard',hr=globalThis.GH_HR_CORE?.ensure?.(ctx.state)||ctx.state.advanced.labor||{},snap=globalThis.GH_HR_CORE?.snapshot?.(ctx.state,ctx,'all')||{coverage:100,total:0,crewMissing:0,facilityMissing:0,executiveMissing:0,gaps:[]};
    const bar=tabs([['dashboard','لوحة HR'],['jobs','الوظائف والاحتياج'],['recruitment','الاستقطاب'],['contracts','العقود'],['payroll','الرواتب']],tab,'data-labortab');let body='';
    const executivePayroll=ctx.state.hired.reduce((n,id)=>n+(ctx.candidates.find(c=>c.id===id)?.salary||0),0),crewPayroll=ctx.state.crew.reduce((n,c)=>n+(Number(c.count)||0)*((Number(c.salaryMin)||0)+(Number(c.salaryMax)||0))/2*30,0);
    const companyRows=['air','sea','road','mobility','power','bank'].map(company=>{const x=globalThis.GH_HR_CORE?.snapshot?.(ctx.state,ctx,company)||{coverage:100,total:0};return {company,...x};});
    if(tab==='dashboard')body=`<article class="list-item hr-command"><div class="list-item-head"><div><h3>إدارة الموارد البشرية</h3><p>HR مسؤول عن القيادات وفرق المنشآت فقط. طاقم كل طائرة وسفينة وشاحنة وسائق كل سيارة يُنشأ ويُثبت تلقائيًا مع الأصل.</p></div><span class="tag ${snap.total?'negative':'positive'}">تغطية ${snap.coverage}%</span></div>${metrics([['عجز HR',snap.total],['المنشآت',snap.facilityMissing],['القيادات',snap.executiveMissing]])}<div class="action-row">${action('hr-hire-all','سد وظائف المنشآت والقيادات',snap.total?'':'disabled')}</div></article><div class="hr-company-grid">${companyRows.map(x=>`<article class="list-item"><div class="list-item-head"><div><h3>${ctx.typeName(x.company)}</h3><p>الطاقم التشغيلي مرتبط بالأصول آليًا؛ هنا تُدار المنشآت والقيادات.</p></div><span class="tag ${x.total?'':'positive'}">${x.coverage}%</span></div>${metrics([['عجز HR',x.total],['وظائف مطلوبة',x.required||0],['مشغول',x.filled||0]])}<div class="action-row">${action('hr-hire-company','سد وظائف HR لهذه الشركة',`data-company="${x.company}" ${x.total<=0?'disabled':''}`)}</div></article>`).join('')}</div>${(hr.hiringLog||[]).length?`<article class="list-item"><h3>سجل قرارات HR</h3><p>يسجل هنا توظيف القيادات والمنشآت؛ عقود طواقم الأصول تظهر في العقود كسجل مالي آلي ثابت فقط.</p>${hr.hiringLog.slice(0,15).map(e=>`<div class="spec-row"><span>يوم ${Math.floor((e.at||0)/86400)} · ${ctx.typeName(e.company)} · ${ctx.esc(e.source||'—')}</span><b>${e.total||1} توظيف${e.coverageAfter!=null?` · تغطية ${e.coverageBefore??'—'}%→${e.coverageAfter}%`:''}</b></div>`).join('')}</article>`:''}`;
    if(tab==='jobs'){const gaps=(snap.gaps||[]);body=`<article class="list-item"><div class="list-item-head"><div><h3>خطة الوظائف الحية</h3><p>كل صف ناتج من أصل/قاعدة/مركز أو قيادة مطلوبة فعلًا، وليس رقمًا ثابتًا للعرض.</p></div><span class="tag">${gaps.length} فجوة</span></div></article>${gaps.length?gaps.map(g=>`<article class="list-item hr-gap"><div class="list-item-head"><div><h3>${ctx.esc(g.name)}</h3><p>${ctx.typeName(g.company||'group')} · ${g.kind==='crew'?'طاقم أسطول':g.kind==='facility'?'تشغيل منشأة':'قيادة'}</p></div><span class="tag negative">ناقص ${g.missing}</span></div>${metrics([['المطلوب',g.needed],['الحالي',g.have],['التغطية',g.needed?`${Math.round(Math.min(g.have,g.needed)/g.needed*100)}%`:'100%']])}</article>`).join(''):'<div class="empty positive-empty">لا توجد وظائف شاغرة تشغيلية حاليًا.</div>'}`;}
    if(tab==='recruitment'){const available=ctx.candidates.filter(c=>!ctx.state.hired.includes(c.id));body=`<article class="list-item"><h3>الاستقطاب والمرشحون</h3><p>التوظيف الفردي للقيادات متاح هنا، وفرق المنشآت تُسد من لوحة HR. طواقم الأصول ليست إجراءً بشريًا منفصلًا.</p>${metrics([['مرشحون متاحون',available.length],['قيادات موظفة',ctx.state.hired.length],['عجز HR',snap.facilityMissing+snap.executiveMissing]])}</article>${available.map(c=>`<article class="list-item"><div class="list-item-head"><div><h3>${ctx.esc(c.name)}</h3><p>${ctx.esc(c.role)} · ${ctx.esc(c.city)}</p></div><span class="tag">كفاءة ${c.skill}/100</span></div>${metrics([['راتب سنوي',ctx.fmtMoney(c.salary)],['سوق المهارة',ctx.esc(c.market)],['الحالة','متاح']])}<div class="action-row"><button class="primary-btn hire" data-id="${c.id}">توقيع عقد وتوظيف</button></div></article>`).join('')||'<div class="empty">لا توجد قيادات متاحة حاليًا.</div>'}`;}
    if(tab==='contracts')body=(hr.employmentContracts||[]).length?(hr.employmentContracts||[]).map(c=>`<article class="list-item"><div class="list-item-head"><div><h3>${ctx.esc(c.name)}</h3><p>${ctx.esc(c.role||'موظف')} · ${ctx.esc(c.center||ctx.typeName(c.company||'group'))}</p></div><span class="tag ${c.status==='ساري'?'positive':''}">${ctx.esc(c.status||'ساري')}</span></div>${metrics([['العدد',c.count||1],['راتب/تكلفة تعاقدية',ctx.fmtMoney(c.salary||0)],['مدة العقد',`${c.termMonths||24} شهر`]])}<small>${ctx.esc(c.source||'HR Core')}</small></article>`).join(''):'<div class="empty">لا توجد عقود توظيف مسجلة بعد.</div>';
    if(tab==='payroll')body=`<article class="list-item"><div class="list-item-head"><div><h3>Payroll & Workforce Cost</h3><p>تكلفة الرواتب منفصلة حسب الطواقم والقيادات، والتسوية النقدية تبقى يوم 27 دون مضاعفة تكلفة الرحلة.</p></div></div>${metrics([['طاقم شهري تقديري',ctx.fmtMoney(crewPayroll)],['قيادات سنوي',ctx.fmtMoney(executivePayroll)],['عقود سارية',(hr.employmentContracts||[]).filter(c=>c.status==='ساري').length],['تغطية HR',`${snap.coverage}%`]])}</article>`;
    return `${hero(photos.hq,'إدارة الموارد البشرية HR','قيادات ومنشآت فقط؛ طواقم الأصول ورواتبها ثابتة وآلية عند الشراء.','HR CORE 2.5')}${bar}<div class="list hr-center">${body}</div>`;
  }
  function renderMA(ctx){return `${hero(photos.hq,'الاستحواذ والدمج المؤسسي','مسار صفقة واضح: فحص → عناية واجبة → عرض → سيطرة → تكامل. كل زر يوضح سبب تعطيله ولا يسمح بتنفيذ مكرر.','M&A 2.5.0')}<div class="list">${ctx.competitors.map(c=>{const stake=ctx.state.stakes[c.id]||0,deal=ctx.state.maDeals?.[c.id]||{},dd=deal.dd,offer=deal.offer,control=stake>=51,integration=control&&Number(deal.integration||0)>0,nextStake=stake<10?10:stake<51?51:100,disabled=stake>=100,stage=integration?'تكامل':control?'سيطرة':offer?'عرض':dd?'عناية مكتملة':'فحص أولي';const steps=[['فحص',true],['عناية',!!dd],['عرض',!!offer],['سيطرة',control],['تكامل',integration]];return `<article class="list-item ma-deal-card"><div class="list-item-head"><div><h3>${c.name}</h3><p>${c.sector} · ${c.hq} · ${c.strategy}</p></div><span class="tag ${control?'positive':''}">${stage} · ${stake}%</span></div>${metrics([['قيمة المنشأة',ctx.fmtMoney(c.price)],['EBITDA',ctx.fmtMoney(c.ebitda)],['الدين',ctx.fmtMoney(c.debt)]])}${dd?metrics([['مخاطر DD',`${dd.riskScore}/100`],['Debt/EBITDA',`${dd.leverage.toFixed(2)}x`],['وفورات متوقعة',ctx.fmtMoney(dd.synergy)]]):'<p class="ma-guidance">ابدأ بالعناية الواجبة. لا يسمح بعرض ملزم قبل اكتمالها.</p>'}<div class="workflow-stepper ma-workflow">${steps.map(([label,done],i)=>`<div class="workflow-step ${done?'done':''} ${(!done&&steps.slice(0,i).every(x=>x[1]))?'active':''}"><span>${i+1}</span><b>${label}</b></div>`).join('')}</div><div class="action-row ma-actions"><button class="secondary-btn diligence" data-id="${c.id}" data-disabled-reason="العناية الواجبة متاحة دائمًا للتحديث.">${dd?'تحديث العناية الواجبة':'بدء العناية الواجبة'}</button><button class="primary-btn acquire-stake" data-id="${c.id}" data-stake="${nextStake}" ${disabled?'disabled data-disabled-reason="تم الاستحواذ الكامل بالفعل؛ لا توجد حصة إضافية للشراء."':''}>${stake<10?'استثمار 10%':stake<51?'تقديم عرض سيطرة 51%':'استحواذ كامل'}</button></div>${!dd?'<small class="interaction-reason">زر العرض سيبدأ العناية أولًا إذا ضغطته قبل اكتمال DD، ولن يخصم أي مبلغ.</small>':''}</article>`}).join('')}</div>`;}


  function renderDiagnostics(ctx){
    const report=ctx.state.diagnostics?.lastHealth||ctx.runDiagnostics?.({recordEvent:false})||{status:'warning',counts:{critical:0,warning:1,total:1},issues:[{severity:'warning',title:'محرك التشخيص غير متاح',detail:'تعذر تشغيل الفحص الشامل.',domain:'system'}],summary:{}};
    const statusMap={healthy:['سليم','positive'],warning:['تحذيرات',''],critical:['حالة حرجة','negative']},status=statusMap[report.status]||statusMap.warning;
    const issues=(report.issues||[]).slice(0,60),diag=ctx.state.diagnostics||{},resolved=(diag.resolvedIssues||[]).slice(0,20),recent=(diag.events||[]).slice(0,30),integrity=ctx.businessIntegrity?.()||{status:'warning',counts:{critical:0,warning:0,total:0},byDomain:{}},closure=ctx.deliveryClosure?.()||{},ledger=ctx.businessLedger?.()||{},workflow=globalThis.GH_WORKFLOW?.summary?.(ctx.state)||{count:0,lastIntegrity:null};
    const sevLabel={critical:'حرج',warning:'تحذير',info:'معلومة'};
    const checked=report.at?new Date(report.at).toLocaleTimeString('ar-SA',{hour:'2-digit',minute:'2-digit',second:'2-digit'}):'—';
    return `${hero(photos.intelligence,'صحة النظام والتشخيص','مراقبة حية تفصل المشاكل النشطة عن السجل التاريخي، وتوثق فتح المشكلة وحلها دون خلط الماضي بالحالة الحالية.','SYSTEM HEALTH')}
      <div class="list diagnostics-center">
        <article class="list-item diagnostics-summary ${report.status}"><div class="list-item-head"><div><h3>الحالة الحالية: ${status[0]}</h3><p>آخر فحص: ${ctx.esc(checked)} · تتحدث اللوحة تلقائيًا كل 10 ثوانٍ أثناء فتحها.</p></div><span class="tag ${status[1]}">${report.counts?.total||0} نشطة</span></div>${metrics([['حرج',report.counts?.critical||0,(report.counts?.critical||0)?'negative':''],['تحذيرات',report.counts?.warning||0],['سلامة الأعمال',integrity.status==='healthy'?'سليم':`${integrity.counts?.total||0} ملاحظة`],['السرعة',report.summary?.speed?`×${report.summary.speed}`:'Pause']])}${metrics([['إغلاق التسليمات',`${closure.closureRate??100}%`],['تسليمات معلقة',closure.open||0],['Event Ledger',ledger.count||0],['Workflow',workflow.count||0]])}${metrics([['سلامة المالية',integrity.byDomain?.finance||0],['سلامة التشغيل',integrity.byDomain?.operations||0],['سلامة التبعيات',integrity.byDomain?.dependencies||0],['تم حلها',resolved.length]])}<div class="action-row">${action('diagnostics-run','فحص شامل الآن')}${action('diagnostics-export','تصدير ملف .ghdiag','',true)}${action('diagnostics-clear','مسح السجل التاريخي','',true)}</div><p class="section-mini">المسح يحذف سجل الأحداث والحالات المحلولة ويحفظ النتيجة فورًا. المشكلة النشطة لن تختفي بشكل زائف؛ ستبقى حتى يزول سببها ثم تنتقل تلقائيًا إلى «تم حلها».</p></article>
        ${sectionTitle('المشاكل النشطة الآن','هذه القائمة تمثل الحالة الحالية فقط؛ الأخطاء القديمة لا تُبقي النظام في حالة تحذير بعد حلها.')}
        ${issues.length?issues.map(x=>`<article class="list-item diagnostic-issue ${ctx.esc(x.severity)}"><div class="list-item-head"><div><h3>${ctx.esc(x.title)}</h3><p>${ctx.esc(x.detail)}</p></div><span class="tag ${x.severity==='critical'?'negative':x.severity==='warning'?'':'positive'}">${sevLabel[x.severity]||ctx.esc(x.severity)}</span></div><div class="metric-row two"><div><span>المجال</span><b>${ctx.esc(x.domain||'system')}</b></div><div><span>المعرف</span><b dir="ltr">${ctx.esc(x.id||'—')}</b></div></div></article>`).join(''):'<div class="empty positive-empty">لا توجد مشاكل نشطة حاليًا.</div>'}
        ${sectionTitle('تم حلها','تنتقل المشكلة إلى هنا تلقائيًا عندما لا يعثر عليها الفحص التالي.')}
        ${resolved.length?resolved.map(x=>`<article class="list-item diagnostic-event"><div class="list-item-head"><div><h3>${ctx.esc(x.title||x.id)}</h3><p>${ctx.esc(x.domain||'system')} · ${ctx.esc(x.resolvedAt||'')}</p></div><span class="tag positive">تم الحل</span></div></article>`).join(''):'<div class="empty">لا توجد مشاكل محلولة مسجلة منذ آخر مسح.</div>'}
        ${sectionTitle('السجل التاريخي','أحداث Runtime وفتح/حل المشاكل. هذا السجل لا يغيّر حالة الصحة الحالية.')}
        ${recent.length?recent.map(e=>`<article class="list-item diagnostic-event"><div class="list-item-head"><div><h3 dir="ltr">${ctx.esc(e.type)}</h3><p>زمن المحاكاة: ${ctx.formatDuration(Number(e.simSeconds)||0)}</p></div><span class="tag ${e.severity==='critical'?'negative':''}">${sevLabel[e.severity]||'معلومة'}</span></div></article>`).join(''):'<div class="empty">السجل التاريخي فارغ.</div>'}
      </div>`;
  }

  function renderControlPlane(ctx){
    const cp=ctx.controlPlane?.()||{},health=ctx.controlHealth?.()||cp.health||{status:'unknown',counts:{critical:0,warning:0,total:0},nodes:{}},statusMap={healthy:['سليم','positive'],warning:['مراقبة',''],critical:['حرج','negative'],unknown:['غير معروف','']},status=statusMap[health.status]||statusMap.unknown;
    const engines=Object.entries(cp.registry?.engines||{}),links=cp.registry?.links||[],incidents=(cp.incidents||[]).filter(x=>x.status==='open').slice(0,30),commands=(cp.commands||[]).slice(0,30),outbox=(cp.outbox||[]).filter(x=>!x.delivered),events=(cp.events||[]).slice(0,12);
    const engineRows=engines.map(([id,e])=>`<article class="list-item control-engine"><div class="list-item-head"><div><h3>${ctx.esc(id)}</h3><p>${ctx.esc(e.role||'محرك مسجل')}</p></div><span class="tag positive">${ctx.esc(e.version||'—')}</span></div></article>`).join('');
    const linkRows=links.map(l=>`<article class="list-item control-link"><div class="list-item-head"><div><h3 dir="ltr">${ctx.esc(l.from)} → ${ctx.esc(l.to)}</h3><p>${ctx.esc(l.contract)}</p></div><span class="tag ${l.status==='healthy'?'positive':'negative'}">${ctx.esc(l.status||'unknown')}</span></div></article>`).join('');
    const incidentRows=incidents.map(x=>`<article class="list-item diagnostic-issue ${ctx.esc(x.severity)}"><div class="list-item-head"><div><h3>${ctx.esc(x.title)}</h3><p>${ctx.esc(x.detail||x.code)}</p></div><span class="tag ${x.severity==='critical'?'negative':''}">${ctx.esc(x.severity)}</span></div>${metrics([['Incident',ctx.esc(x.id)],['المجال',ctx.esc(x.domain)],['التكرار',x.occurrences||1],['الثقة',ctx.esc(x.certainty||'PROVEN')]])}<div class="action-row">${action('control-export-incident','تصدير .ghincident',`data-incident="${ctx.esc(x.id)}"`,true)}</div></article>`).join('');
    const commandRows=commands.map(x=>`<article class="list-item"><div class="list-item-head"><div><h3 dir="ltr">${ctx.esc(x.id)} · ${ctx.esc(x.name)}</h3><p>${ctx.esc(x.domain)} · ${ctx.esc(x.actor)} · revision ${ctx.esc(x.committedRevision??x.expectedRevision??'—')}</p></div><span class="tag ${x.status==='committed'?'positive':x.status==='rolled_back'||x.status==='failed'?'negative':''}">${ctx.esc(x.status)}</span></div><div class="action-row">${action('control-export-trace','تصدير Trace',`data-command="${ctx.esc(x.id)}"`,true)}</div></article>`).join('');
    return `${hero(photos.intelligence,'مركز التحكم والسلامة المركزي','المسار الرقابي الموحد للأوامر، الروابط بين الأنظمة، الحوادث، سجل الأدلة، التحديثات والحفظ. المحركات المتخصصة تظل مالكة لقواعدها، وهذه الطبقة تنظّم التغيير وتراقبه.','CENTRAL CONTROL 1.0')}
      <div class="list control-plane-center">
        <article class="list-item diagnostics-summary ${health.status}"><div class="list-item-head"><div><h3>الحالة المركزية: ${status[0]}</h3><p>Control Plane ${ctx.esc(cp.engineVersion||'—')} · App ${ctx.esc(cp.appVersion||ctx.appVersion)} · Journal head محفوظ ببصمة مترابطة.</p></div><span class="tag ${status[1]}">${health.counts?.total||0} ملاحظة</span></div>${metrics([['Revision',cp.revision||0],['أوامر ناجحة',cp.metrics?.commandsCommitted||0],['Rollback',cp.metrics?.commandsRolledBack||0],['Incidents',incidents.length]])}${metrics([['Outbox',outbox.length],['أحداث مركزية',cp.metrics?.events||0],['محركات',engines.length],['روابط',links.length]])}<div class="action-row">${action('control-run','فحص مركزي شامل')}${action('control-export-diagnostic','تصدير .ghdiagnostic','',true)}${action('control-export-health','تصدير .ghhealth','',true)}${action('control-export-support','تصدير .ghsupport','',true)}</div><p class="section-mini">التصدير لا يغيّر اللعبة. .ghsupport يجمع الأدلة والـBlack Box والـIncidents والـCommands دون الحاجة لإرسال المستودع كاملًا.</p></article>
        ${sectionTitle('المحركات المسجلة','Central authority, distributed expertise: لكل مجال مالك واضح ولا يسمح للـAI أو الواجهة أن يصبحا مالكًا مباشرًا للبيانات.')}${engineRows||'<div class="empty">لم تُسجل المحركات بعد.</div>'}
        ${sectionTitle('عقود الربط','يتم تتبع العلاقات الحرجة بين AI والمالية والحفظ والتحديث والمحاكاة.')}${linkRows||'<div class="empty">لا توجد روابط مسجلة.</div>'}
        ${sectionTitle('الحوادث النشطة','المخالفة القطعية تفتح Incident قابلًا للتصدير والتتبع، ولا تختفي بمجرد مسح سجل التشخيص.')}${incidentRows||'<div class="empty positive-empty">لا توجد حوادث مركزية نشطة.</div>'}
        ${sectionTitle('آخر الأوامر','كل تفاعل موجه عبر بوابة الأوامر يحمل Command/Correlation ID ويمكن تصدير مساره.')}${commandRows||'<div class="empty">لا توجد أوامر مسجلة بعد.</div>'}
        ${sectionTitle('الصندوق الأسود','آخر الأدلة قصيرة المدى قبل الأعطال أو الانحرافات.')}${events.map(e=>`<article class="list-item"><div class="list-item-head"><div><h3 dir="ltr">${ctx.esc(e.type)}</h3><p>${ctx.esc(e.domain)} · ${ctx.formatDuration(Number(e.simSeconds)||0)}</p></div><span class="tag">${ctx.esc(e.id)}</span></div></article>`).join('')||'<div class="empty">لا توجد أحداث بعد.</div>'}
      </div>`;
  }

  function renderSettings(ctx,updatesOnly=false){globalThis.GH_PERSISTENCE?.migrateMetadata?.(ctx.state);const slots=[0,1,2];const content=`${hero(photos.intelligence,updatesOnly?'مركز التحديثات':'إدارة النسخة والحفظ','استيراد تحديثات موقعة، نسخ احتياطي، خانات حفظ واستعادة آمنة.','SYSTEM')}
    <div class="list"><article class="list-item"><h3>تحديثات Global Holdings</h3>${metrics([['نسخة اللعبة',VERSION],['الكتالوج',ctx.state.advanced.content.catalogVersion],['حزم مثبتة',ctx.state.advanced.updateHistory.length]])}<p>اختر ملف <b dir="ltr">.saneiupdate</b> من تطبيق Files. يدعم النظام أيضًا <b dir="ltr">.ghupdate</b>، ويتحقق من النوع والإصدار وبصمة كل ملف قبل التفعيل.</p><input id="updateFileInput" class="file-input" type="file" accept=".saneiupdate,.ghupdate,application/json"><div class="action-row">${action('pick-update','اختيار ملف تحديث')}${action('rollback-update','استعادة التحديث السابق','',true)}</div><p id="updateStatus" class="result-note"></p></article>
    ${updatesOnly?'':`<article class="list-item"><h3>خانات الحفظ</h3><div class="save-slots">${slots.map(i=>`<div><b>الخانة ${i+1}</b><small>${ctx.state.advanced.saveSlots[i]?.date||'فارغة'}</small><button data-gh-action="save-slot" data-slot="${i}">حفظ</button><button data-gh-action="load-slot" data-slot="${i}" ${ctx.state.advanced.saveSlots[i]?'':'disabled'}>تحميل</button></div>`).join('')}</div><div class="action-row">${action('export-save','تصدير نسخة احتياطية',``,true)}</div></article>
    <article class="list-item danger-zone"><h3>بدء لعبة جديدة</h3><p>يمسح تقدم اللعبة وخانات الحفظ والنسخ الاستردادية وحالة الجلسة ثم يعيد شاشة تأسيس المجموعة. ملفات التحديث المثبتة نفسها لا تُحذف.</p><div class="action-row"><button type="button" class="primary-btn new-game-direct">بدء مجموعة جديدة</button></div><p class="section-mini">سيظهر ملف التأسيس فورًا داخل نفس الشاشة؛ لا يعتمد على إعادة تحميل التطبيق.</p></article>`}</div>`;return content;}

  function render(panel,arg,ctx){
    if(!ctx?.state)return null;migrate(ctx.state);
    const map={realism:()=>window.GH_REALISM?.render(ctx)||'<div class="empty">Realism Core غير متاح.</div>',companies:()=>renderCompanies(arg,ctx),leadershipHub:()=>renderLeadershipHub(ctx),workspaceHub:()=>renderWorkspaceHub(ctx),peopleHub:()=>renderPeopleHub(ctx),actionCenter:()=>renderActionCenter(ctx),governanceHub:()=>renderGovernanceHub(ctx),compliance:()=>renderCompliance(ctx),systemHub:()=>renderSystemHub(ctx),intelligence:()=>renderAI(ctx),aiApprovals:()=>renderAIApprovals(ctx),facilityManage:()=>facilityView(arg,ctx),companyManage:()=>companyView(arg,ctx),treasury:()=>renderTreasury(ctx),audit:()=>renderAudit(ctx),legal:()=>renderLegal(ctx),procurement:()=>renderManualProcurement(ctx),cyber:()=>renderCyber(ctx),safety:()=>renderSafety(ctx),energy:()=>renderEnergy(ctx),bank:()=>renderBank(ctx),governance:()=>renderGovernance(ctx),insurance:()=>renderInsurance(ctx),research:()=>renderResearch(ctx),esg:()=>renderESG(ctx),career:()=>renderCareer(ctx),news:()=>renderNews(ctx,arg),labor:()=>renderLabor(arg,ctx),ma:()=>renderMA(ctx),settings:()=>renderSettings(ctx),updates:()=>renderSettings(ctx,true),diagnostics:()=>renderDiagnostics(ctx),controlPlane:()=>renderControlPlane(ctx)};
    return map[panel]?map[panel]():null;
  }

  const logFacility = (m,text,ctx) => {m.lastAction=ctx.state.simSeconds;m.history.unshift({at:ctx.state.simSeconds,text});if(m.history.length>30)m.history.length=30;};
  function notify(ctx,text,kind='info'){if(globalThis.GH_WORKFLOW?.notify)return globalThis.GH_WORKFLOW.notify(String(text||''),kind,{state:ctx.state,panel:ctx.currentPanel});ctx.pushAlert?.(String(text||''));return true;}
  function ask(ctx,message,risk='normal'){if(globalThis.GH_WORKFLOW?.confirm)return globalThis.GH_WORKFLOW.confirm(String(message||''),{state:ctx.state,panel:ctx.currentPanel,risk});return typeof window?.confirm==='function'?window.confirm(String(message||'')):false;}
  function refresh(ctx,panel,arg){ctx.save();ctx.updateKpis();ctx.renderMap();ctx.openDrawer(panel,arg);}
  function domainCommand(ctx,domain,name,payload={},actor='ui'){const bus=globalThis.GH_DOMAIN_COMMANDS;if(!bus?.dispatch)throw new Error('Domain Command Core unavailable');return bus.dispatch({state:ctx.state,...ctx},domain,name,payload,{actor}).result;}

  async function handleAction(btn,ctx){
    const id=btn.dataset.ghAction,s=ctx.state;
    if(id==='department-review'){try{const dept=btn.dataset.dept,report=domainCommand(ctx,'departments','review',{dept,actor:'manual'},'department-ui');ctx.pushAlert(`${report.department}: اكتملت الدورة بنتيجة ${report.score}/100 (${report.grade}) وسُجلت كمعتمدة للمراجعة.`);refresh(ctx,ctx.currentPanel,ctx.currentArg);return;}catch(error){ctx.pushAlert(`تعذر تشغيل دورة القسم: ${error.message}`);return;}}
    if(id==='department-escalate'){try{const dept=btn.dataset.dept,e=domainCommand(ctx,'departments','record',{dept,actor:'manual'},'department-ui');ctx.pushAlert(`سُجل ${e.title} كمعتمد للمراجعة بمرجع ${e.id}. لا يوجد انتظار أو اعتماد إضافي.`);refresh(ctx,'aiApprovals');return;}catch(error){ctx.pushAlert(`تعذر تسجيل تقرير القسم: ${error.message}`);return;}}
    if(id==='department-work-action'){try{const result=domainCommand(ctx,'departments','act',{id:btn.dataset.work,actor:'manual'},'department-ui');if(result.status==='recorded'){ctx.pushAlert(`سُجلت معالجة ${result.workItem.title} كمعتمدة للمراجعة بمرجع ${result.escalation.id}.`);refresh(ctx,'aiApprovals');}else if(result.status==='closed'){ctx.pushAlert(`أُغلقت المهمة ${result.workItem.title} بعد زوال سببها والتحقق منه.`);refresh(ctx,ctx.currentPanel,ctx.currentArg);}else{ctx.pushAlert(`بدأت معالجة ${result.workItem.title}. ستبقى مفتوحة حتى يزول المؤشر المسبب.`);refresh(ctx,ctx.currentPanel,ctx.currentArg);}return;}catch(error){ctx.pushAlert(`تعذر معالجة مهمة القسم: ${error.message}`);return;}}
    if(id==='hr-hire-all'||id==='hr-hire-company'){
      const company=id==='hr-hire-company'?(btn.dataset.company||'all'):'all',before=globalThis.GH_HR_CORE?.snapshot?.(s,ctx,company);if(!before){ctx.pushAlert('HR Core غير متاح.');return;}if(!before.total){ctx.pushAlert('لا يوجد عجز وظيفي حقيقي حاليًا.');refresh(ctx,'labor','dashboard');return;}
      try{const result=domainCommand(ctx,'hr','hire',{company,source:company==='all'?'توظيف يدوي فوري · لوحة HR':`توظيف يدوي فوري · ${ctx.typeName(company)}`},'hr-ui');ctx.pushAlert(`تم توظيف ${result.total} فورًا. التغطية أصبحت ${result.coverageAfter}%.`);}catch(error){ctx.pushAlert(`تعذر إكمال التوظيف: ${error.message}`);}
      ctx.save?.();refresh(ctx,'labor','dashboard');return;
    }
    if(id==='esg-review'){const priorities=domainCommand(ctx,'governance','esg-review',{},'governance-review');ctx.pushAlert(`مراجعة الاستدامة: ${priorities.length?priorities.slice(0,4).join(' · '):'المؤشرات ضمن المستهدف؛ ركّز على الإفصاح والتحسين المستمر.'}`);refresh(ctx,'esg');return;}
    if(id==='esg-program'){try{domainCommand(ctx,'governance','esg-program',{id:btn.dataset.program,company:btn.dataset.company||'group',cost:Number(btn.dataset.cost)||0},'esg');ctx.pushAlert(`اعتمد برنامج الاستدامة ${btn.dataset.program}. الأثر سيظهر تدريجيًا مع النضج التشغيلي.`);}catch(error){notify(ctx,`تعذر اعتماد البرنامج: ${error.message}`);}refresh(ctx,'esg');return;}
    if(id?.startsWith('facility-')){
      const f=ctx.findFacility(btn.dataset.id);if(!f){ctx.pushAlert('تعذر تنفيذ الإجراء؛ هذا المركز لم يعد متاحًا.');return;}const company=globalThis.GH_FACILITY_CORE?.ownerCompany?.(f)||'group';
      try{
        if(id==='facility-close'){const fm=facilityModel(s,f),settlement=(fm?.staff||0)*1000+(f.dailyCost||0)*30;if(!ask(ctx,`إغلاق ${f.name}?
تسوية موظفين والتزامات: ${ctx.fmtMoney(settlement)}`))return;domainCommand(ctx,'facilities','close',{id:f.id,company,settlement},'facility-manager');ctx.pushAlert(`أُغلق ${f.name} بعد التحقق والتسوية.`);refresh(ctx,'intelligence');return;}
        if(id==='facility-task-done'){const task=domainCommand(ctx,'facilities','task-done',{id:f.id,taskId:btn.dataset.task},'facility-manager');ctx.pushAlert(task?`${f.name}: أُنجزت مهمة "${task.title}".`:'المهمة لم تعد مفتوحة.');refresh(ctx,'facilityManage',{id:f.id,tab:'people'});return;}
        const actions={'facility-budget':['budget',{cost:2000000,amount:2000000}],'facility-maintenance':['maintenance',{cost:1000000}],'facility-expand':['expand',{cost:12000000,budgetAdd:3000000}],'facility-hire':['hire',{cost:500000,hrContext:ctx}],'facility-audit':['audit',{cost:500000}],'facility-contract':['contract',{}],'facility-task':['task',{title:`مهمة جديدة أسندها ${facilityModel(s,f)?.manager||'مدير المنشأة'}`}]} ;const spec=actions[id];if(!spec){ctx.pushAlert('إجراء منشأة غير معروف.');return;}const result=domainCommand(ctx,'facilities',spec[0],{id:f.id,company,...spec[1]},'facility-manager');ctx.pushAlert(`${f.name}: ${result?.message||result||'تم تحديث الإدارة.'}`);refresh(ctx,'facilityManage',{id:f.id,tab:id==='facility-task'?'people':'command'});return;
      }catch(error){notify(ctx,`تعذر تنفيذ قرار المنشأة: ${error.message}`);return;}
    }
    if(id?.startsWith('company-')){
      const type=btn.dataset.company,cm=companyModel(s,type);if(!cm){notify(ctx,'نموذج الشركة غير متاح.');return;}if(['company-service','company-automation'].includes(id)){const last=Number(cm.upgradeCooldowns?.[id]||-Infinity),cooldown=7*86400;if(s.simSeconds-last<cooldown){notify(ctx,`هذه الترقية تحت فترة تبريد. المتبقي ${Math.ceil((cooldown-(s.simSeconds-last))/86400)} يوم محاكاة.`);return;}}
      try{const costs={'company-service':1500000,'company-automation':3000000};domainCommand(ctx,'corporate','decision',{type,action:id,cost:costs[id]||0},'company-management');ctx.pushAlert(`تم اعتماد قرار إداري في ${ctx.typeName(type)} عبر Corporate Core.`);refresh(ctx,'companyManage',{type,tab:'overview'});}catch(error){notify(ctx,`تعذر القرار: ${error.message}`);}return;
    }
    if(id==='ai-send'){const input=document.getElementById('aiPrompt'),q=input?.value.trim();if(!q){notify(ctx,'اكتب سؤالك أولًا قبل إرساله لـ GH Intelligence.');return;}const answer=aiAnswer(q,ctx);domainCommand(ctx,'ai','message',{messages:[{role:'user',text:q},{role:'assistant',text:answer.text,sources:answer.sources}]},'ai-chat');refresh(ctx,'intelligence');return;}
    if(id==='treasury-hedge'){try{domainCommand(ctx,'governance','treasury-hedge',{},'treasury');ctx.pushAlert('رفعت الخزينة نسبة التحوط عبر Governance Core.');refresh(ctx,'treasury');}catch(error){notify(ctx,`تعذر التحوط: ${error.message}`);}return;}
    if(id==='treasury-buffer'){try{domainCommand(ctx,'finance','transfer-reserve',{company:'group',amount:10000000,toReserve:true,note:'تحويل داخلي إلى احتياطي السيولة'},'treasury');ctx.pushAlert('تم تحويل $10M داخليًا للاحتياطي دون تغيير السيولة الموحدة أو إنشاء مصروف ضريبي.');}catch(error){notify(ctx,`تعذر تحويل الاحتياطي: ${error.message}`);}refresh(ctx,'treasury');return;}
    if(id==='treasury-stress'){const r=domainCommand(ctx,'governance','treasury-stress',{},'treasury');ctx.pushAlert(`اكتمل اختبار ضغط الخزينة بخسارة تقديرية ${ctx.fmtMoney(r.loss)}.`);refresh(ctx,'treasury');return;}
    if(id==='audit-run'){try{const r=domainCommand(ctx,'governance','audit-run',{},'audit');ctx.pushAlert(`اكتمل التدقيق: النتيجة ${r.score}% وعدد الملاحظات ${r.findings}.`);refresh(ctx,'audit');}catch(error){notify(ctx,`تعذر التدقيق: ${error.message}`);}return;}
    if(id==='legal-review'){try{const r=domainCommand(ctx,'governance','legal-review',{},'legal');ctx.pushAlert(`اكتملت المراجعة القانونية: امتثال ${Math.round(Number(r.compliance)||0)}%.`);refresh(ctx,'legal');}catch(error){notify(ctx,`تعذر الفحص القانوني: ${error.message}`);}return;}
    if(id==='procurement-tender'){const pool=(ctx.strategicPartners||[]).filter(x=>['fuel','parts','mro','handling','provisions'].includes(x.category)),rng=globalThis.GH_DETERMINISM,ranked=pool.map(x=>({x,r:rng?.nextFloat?.(s,'procurement-tender')??0.5})).sort((a,b)=>a.r-b.r).map(v=>v.x),bids=ranked.slice(0,Math.min(5,pool.length)).map(x=>({supplier:x.legalName||x.name,score:Math.round((x.rating*.4+(x.delivery||90)*.25+(x.compliance||95)*.2+(100-(x.costIndex||1)*80)*.15)*10)/10,annual:Math.round(s.advanced.procurement.annualSpend*(x.costIndex||1)*.22)})).sort((a,b)=>b.score-a.score||a.annual-b.annual);try{const r=domainCommand(ctx,'procurement','run-tender',{company:'group',studyCost:180000,kind:'توريد',subject:'مناقصة توريد وتشغيل متعددة القطاعات',annualSpend:Number(s.advanced.procurement.annualSpend)||0,bids},'procurement');ctx.pushAlert(`أغلقت المشتريات المناقصة ورسا العرض على ${r.winner||'أفضل مورد'} بتوفير سنوي ${ctx.fmtMoney(r.saving||0)}.`);}catch(error){notify(ctx,`تعذر إغلاق المناقصة: ${error.message}`);}refresh(ctx,'procurement');return;}
    if(id==='cyber-drill'){try{const r=domainCommand(ctx,'governance','cyber-drill',{},'cyber');ctx.pushAlert(`اكتمل تمرين الاستجابة: RTO ${r.rtoMinutes} دقيقة وتغطية ${r.coverage}%.`);refresh(ctx,'cyber');}catch(error){notify(ctx,`تعذر التمرين: ${error.message}`);}return;}
    if(id==='safety-audit'){try{const r=domainCommand(ctx,'governance','safety-audit',{},'safety');ctx.pushAlert(`اكتمل تدقيق HSE: ${r.weak} أصلًا دون 70%، النتيجة ${Math.round(Number(r.score)||0)}%.`);refresh(ctx,'safety');}catch(error){notify(ctx,`تعذر تدقيق السلامة: ${error.message}`);}return;}
    if(id==='bank-credit-review'){ctx.bankReviewCorporateLimits?.();ctx.pushAlert('راجع بنك المجموعة حدود الائتمان والتصنيفات لكل شركة حسب السيولة والأصول والدين.');refresh(ctx,'bank');return;}
    if(id==='bank-draw-facility'){const company=btn.dataset.company,amount=ctx.bankDrawCorporateFacility?.(company,10000000);if(!amount){ctx.pushAlert(`تعذر سحب التسهيل لـ ${ctx.typeName(company)}: راجع الحد الائتماني وسيولة البنك.`);}else ctx.pushAlert(`مول بنك المجموعة ${ctx.typeName(company)} بمبلغ ${ctx.fmtMoney(amount)} وسجل الدين على الشركة المستفيدة.`);refresh(ctx,'bank');return;}
    if(id==='bank-issue-lc'){const company=btn.dataset.company,doc=ctx.bankIssueTradeInstrument?.('lc',company,5000000);ctx.pushAlert(doc?`أصدر بنك المجموعة اعتمادًا مستنديًا ${doc.id} باسم ${ctx.typeName(company)} لصالح ${doc.counterparty}.`:`تعذر إصدار الاعتماد: الحد الائتماني أو السيولة/الرسوم غير كافية.`);refresh(ctx,'bank');return;}
    if(id==='bank-issue-guarantee'){const company=btn.dataset.company,doc=ctx.bankIssueTradeInstrument?.('guarantee',company,5000000);ctx.pushAlert(doc?`أصدر بنك المجموعة ضمانًا مصرفيًا ${doc.id} باسم ${ctx.typeName(company)} لصالح ${doc.counterparty}.`:`تعذر إصدار الضمان: راجع الحد الائتماني والرسوم.`);refresh(ctx,'bank');return;}
    if(id==='bank-cash-sweep'){const amount=ctx.bankCashSweep?.()||0;ctx.pushAlert(amount>0?`نفذت إدارة النقد Sweep بقيمة ${ctx.fmtMoney(amount)} من فوائض الشركات إلى بنك المجموعة مع بقاء السيولة موحدة.`:'لا توجد فوائض فوق حدود التشغيل لإجراء Cash Sweep الآن.');refresh(ctx,'bank');return;}
    if(id==='bank-stress'){const stress=domainCommand(ctx,'banking','stress',{},'bank-risk');ctx.pushAlert(`اكتمل اختبار الضغط البنكي: NPL ${Number(stress?.npl||0).toFixed(1)}%، رأس المال ${Number(stress?.capitalRatio||0).toFixed(1)}%. لم تتغير الأرصدة الفعلية.`);refresh(ctx,'bank');return;}
    if(id==='board-meeting'){try{const meeting=domainCommand(ctx,'governance','board-meeting',{},'board');ctx.pushAlert(`عقد المجلس اجتماعًا بجدول ${meeting.agenda.length} محاور وربط المحضر بالمخاطر والطلبات الحالية.`);refresh(ctx,'governance');}catch(error){notify(ctx,`تعذر عقد الاجتماع: ${error.message}`);}return;}
    if(id==='insurance-claim'){try{const claim=domainCommand(ctx,'governance','insurance-claim',{sector:btn.dataset.sector},'insurance');ctx.pushAlert(`فتحت مطالبة ${ctx.typeName(claim.sector)} باحتياطي ${ctx.fmtMoney(claim.reserve)}.`);refresh(ctx,'insurance');}catch(error){notify(ctx,`تعذر فتح المطالبة: ${error.message}`);}return;}
    if(id==='control-run'){const r=ctx.controlHealth?.();ctx.pushAlert(r?.status==='critical'?`المحرك المركزي: ${r.counts?.critical||0} حالة حرجة.`:r?.status==='warning'?`المحرك المركزي: ${r.counts?.warning||0} تحذير يحتاج متابعة.`:'المحرك المركزي: جميع العقود المسجلة سليمة حاليًا.');ctx.save?.();refresh(ctx,'controlPlane');return;}
    if(id==='control-export-diagnostic'){ctx.exportControlPlane?.('diagnostic');ctx.pushAlert('تم تجهيز ملف .ghdiagnostic من المحرك المركزي.');return;}
    if(id==='control-export-health'){ctx.exportControlPlane?.('health');ctx.pushAlert('تم تجهيز ملف .ghhealth.');return;}
    if(id==='control-export-support'){ctx.exportControlPlane?.('support');ctx.pushAlert('تم تجهيز ملف .ghsupport للصيانة والتحليل المتقدم.');return;}
    if(id==='control-export-incident'){ctx.exportControlPlane?.('incident',btn.dataset.incident);ctx.pushAlert(`تم تجهيز Incident ${btn.dataset.incident||''}.`);return;}
    if(id==='control-export-trace'){ctx.exportControlPlane?.('trace',btn.dataset.command);ctx.pushAlert(`تم تجهيز Trace للأمر ${btn.dataset.command||''}.`);return;}
    if(id==='diagnostics-run'){const r=ctx.runDiagnostics?.();ctx.pushAlert(r?.status==='critical'?`فحص النظام: ${r.counts.critical} حالة حرجة و${r.counts.warning} تحذير.`:r?.status==='warning'?`فحص النظام: ${r.counts.warning} تحذير دون حالات حرجة.`:'فحص النظام مكتمل: لم تُكتشف مشاكل حالية.');refresh(ctx,'diagnostics');return;}
    if(id==='diagnostics-export'){const bundle=ctx.exportDiagnostics?.();if(bundle)ctx.pushAlert(`تم تجهيز ملف التشخيص: ${bundle.health?.counts?.total||0} ملاحظة. أرسله عند طلب المراجعة.`);return;}
    if(id==='diagnostics-clear'){if(!ask(ctx,'مسح السجل التاريخي والحالات المحلولة؟ لن تتغير اللعبة أو المشاكل النشطة الحقيقية.'))return;ctx.clearDiagnostics?.();ctx.save?.();ctx.openDrawer?.('diagnostics');return;}
    if(id==='save-slot'){const slot=Number(btn.dataset.slot),out=globalThis.GH_PERSISTENCE?.saveSlot?.(slot,s,{appVersion:VERSION});if(!out?.ok){ctx.pushAlert(`تعذر حفظ الخانة ${slot+1}: ${out?.reason||'Persistence Core unavailable'}.`);return;}globalThis.GH_PERSISTENCE.migrateMetadata(s);ctx.save?.();ctx.pushAlert(`تم حفظ الخانة ${slot+1} عند ${out.meta?.label||'زمن المحاكاة الحالي'}.`);refresh(ctx,'settings');return;}
    if(id==='load-slot'){const slot=Number(btn.dataset.slot),status=globalThis.GH_PERSISTENCE?.slotStatus?.(slot);if(!status?.exists){ctx.pushAlert(`الخانة ${slot+1} فارغة أو غير صالحة للتحميل.`);return;}if(ask(ctx,'تحميل هذه الخانة واستبدال التقدم الحالي؟ سيتم التحقق من Save Schema ومزامنة Native Save Vault قبل إعادة التحميل.')){const out=await globalThis.GH_PERSISTENCE?.loadSlot?.(slot,{storageKey:ctx.storageKey,appVersion:VERSION,previousState:s});if(!out?.ok){ctx.pushAlert(`رفض تحميل الخانة ${slot+1}: ${out?.reason||'فشل التحقق'}.`);return;}location.reload();}return;}
    if(id==='export-save'){const out=globalThis.GH_PERSISTENCE?.exportSave?.(s,{appVersion:VERSION});ctx.pushAlert(out?.ok?`تم تجهيز النسخة الاحتياطية ${out.filename}.`:`تعذر تصدير النسخة الاحتياطية: ${out?.reason||'Persistence Core unavailable'}.`);return;}
    if(id==='pick-update'){document.getElementById('updateFileInput')?.click();return;}
    if(id==='rollback-update'){const bridge=window.webkit?.messageHandlers?.updateBridge;if(!bridge){notify(ctx,'استعادة نسخة الواجهة متاحة داخل تطبيق iPhone.');return;}bridge.postMessage({action:'rollbackWebPack',saveJSON:JSON.stringify(s)});return;}
    if(id==='new-game'){if(!ctx.hardResetGame){notify(ctx,'تعذر الوصول إلى محرك إعادة التعيين الصارم.');return;}const resetOk=await ctx.hardResetGame();if(!resetOk)notify(ctx,'لم تكتمل إعادة التعيين. حاول مرة أخرى.');return;}
  }

  async function validateUpdatePack(pack,{currentBuild=0,postInstall=false}={}){
    if(pack?.format!==UPDATE_FORMAT)throw new Error('هذا ليس ملف تحديث Global Holdings.');
    if(!pack.manifest?.version||typeof pack.operationsJSON!=='string')throw new Error('بيانات الحزمة غير مكتملة أو operationsJSON مفقود.');if(Object.prototype.hasOwnProperty.call(pack,'operations'))throw new Error('مصفوفة operations المنفردة مرفوضة؛ operationsJSON هو المصدر الوحيد للتنفيذ.');
    if(Array.isArray(pack.files)&&pack.files.length){if(pack.manifest?.packageType!=='full-web'||pack.manifest?.installMode!=='clean-snapshot-v1')throw new Error('هذا الإصدار يقبل تحديث WebApp كامل بنمط Clean Snapshot فقط؛ Overlay مرفوض.');if(Array.isArray(pack.delete)&&pack.delete.length)throw new Error('Clean Snapshot لا يقبل قائمة حذف؛ الحزمة يجب أن تحتوي النسخة الكاملة فقط.');}
    const semver=value=>String(value||'0').split('-')[0].split('.').map(v=>Math.max(0,Number.parseInt(v,10)||0));
    const compare=(a,b)=>{const x=semver(a),y=semver(b),n=Math.max(x.length,y.length);for(let i=0;i<n;i++){if((x[i]||0)!==(y[i]||0))return (x[i]||0)-(y[i]||0);}return 0;};
    const payloadVersion=Math.max(0,Number.parseInt(pack.manifest.signaturePayloadVersion,10)||0),targetBuild=Math.max(0,Number.parseInt(pack.manifest.build,10)||0),runtimeBuild=Math.max(0,Number.parseInt(currentBuild,10)||0),versionOrder=compare(pack.manifest.version,VERSION);
    if(payloadVersion>=3&&targetBuild<=0)throw new Error('رقم بناء التحديث الموقّع مفقود أو غير صالح.');
    let operations;try{operations=JSON.parse(pack.operationsJSON);}catch{throw new Error('operationsJSON غير صالح.');}if(!Array.isArray(operations))throw new Error('operationsJSON يجب أن يمثل مصفوفة عمليات.');const allowedOps=new Set(['content-config','balance-config','economy-config','add-events','visual-manifest']);for(const op of operations){if(!op||!allowedOps.has(op.type))throw new Error(`عملية تحديث غير مدعومة: ${String(op?.type||'فارغة')}`);}pack.__validatedOperations=operations;
    if(pack.manifest.minGameVersion&&compare(pack.manifest.minGameVersion,VERSION)>0)throw new Error(`تحتاج الحزمة إلى نسخة لعبة ${pack.manifest.minGameVersion} أو أحدث.`);
    if(postInstall){if(versionOrder!==0||(payloadVersion>=3&&targetBuild!==runtimeBuild))throw new Error(`حزمة العمليات لا تطابق Runtime المثبت ${VERSION} Build ${runtimeBuild}.`);}else if(versionOrder<0||(versionOrder===0&&(payloadVersion<3||targetBuild<=runtimeBuild)))throw new Error(`رفض Downgrade/إعادة تثبيت من ${VERSION} Build ${runtimeBuild} إلى ${pack.manifest.version} Build ${targetBuild||'قديم'}. الاسترجاع يملكه Native فقط.`);
    if(pack.manifest.packageType!=='full-web'||pack.manifest.installMode!=='clean-snapshot-v1')throw new Error('القناة المستقرة تقبل full-web / clean-snapshot-v1 فقط.');
    if(!globalThis.crypto?.subtle)throw new Error('هذا الجهاز لا يدعم التحقق التشفيري المطلوب للتحديث.');
    const sha256=async bytes=>{const digest=await crypto.subtle.digest('SHA-256',bytes);return [...new Uint8Array(digest)].map(v=>v.toString(16).padStart(2,'0')).join('');};
    if(typeof pack.operationsJSON!=='string')throw new Error('operationsJSON الموقّع مفقود؛ لا يسمح بإعادة بناء العمليات من مصفوفة منفصلة.');
    const operationsJSON=pack.operationsJSON;if(!/^[a-f0-9]{64}$/i.test(String(pack.manifest.operationsSha256||'')))throw new Error('الحزمة لا تحتوي بصمة SHA-256 صالحة للعمليات.');{const actual=await sha256(new TextEncoder().encode(operationsJSON));if(actual!==String(pack.manifest.operationsSha256).toLowerCase())throw new Error('فشل تحقق سلامة عمليات الحزمة.');}
    if(Array.isArray(pack.files)){
      if(Number(pack.manifest.fileCount)!==pack.files.length)throw new Error('عدد ملفات الحزمة لا يطابق الـ manifest.');
      const seen=new Set();let bytesTotal=0;
      for(const file of pack.files){
        const path=String(file?.path||'').split('\\').join('/');if(!path||path.startsWith('/')||path.split('/').some(part=>part==='..'||part===''))throw new Error(`مسار ملف غير آمن: ${path||'فارغ'}`);if(seen.has(path))throw new Error(`مسار مكرر في الحزمة: ${path}`);seen.add(path);
        let raw;try{const bin=atob(String(file.base64||''));raw=Uint8Array.from(bin,c=>c.charCodeAt(0));}catch{throw new Error(`Base64 تالف: ${path}`);}bytesTotal+=raw.byteLength;
        if(Number(file.size)!==raw.byteLength)throw new Error(`حجم غير مطابق: ${path}`);
        if(!/^[a-f0-9]{64}$/i.test(String(file.sha256||'')))throw new Error(`بصمة SHA-256 مفقودة أو غير صالحة: ${path}`);if(await sha256(raw)!==String(file.sha256).toLowerCase())throw new Error(`بصمة SHA-256 غير مطابقة: ${path}`);
      }
      if(Number(pack.manifest.unpackedBytes)!==bytesTotal)throw new Error('الحجم الإجمالي المفكوك لا يطابق الـ manifest.');
      if(!/^[a-f0-9]{64}$/i.test(String(pack.manifest.filesIndexSha256||'')))throw new Error('الحزمة لا تحتوي بصمة filesIndexSha256 صالحة.');
      // Must match scripts/build_update.py + Foundation JSONSerialization exactly:
      // file order is manifest order and each row is [path, sha256, size].
      const indexRows=pack.files.map(file=>[String(file.path||'').split('\\').join('/'),String(file.sha256||'').toLowerCase(),Number(file.size)]);
      const canonicalIndex=JSON.stringify(indexRows).replace(/\//g,'\\/');
      if(await sha256(new TextEncoder().encode(canonicalIndex))!==String(pack.manifest.filesIndexSha256).toLowerCase())throw new Error('فشل تحقق بصمة فهرس ملفات الحزمة.');
    }
  }

  function applyUpdateOperations(pack,ctx,sourceName){
    const id=pack.manifest.id||sourceName||`native-${pack.manifest.version}`;
    const duplicate=ctx.state.advanced.updateHistory.some(item=>item.id===id&&item.version===pack.manifest.version);
    if(duplicate)return false;
    const tx=globalThis.GH_TRANSACTION_CORE;if(!tx?.execute)throw new Error('Transaction Core unavailable for update operations');
    const backupKey=null,allowedOps=new Set(['content-config','balance-config','economy-config','add-events','visual-manifest']),stateSnapshot=tx.deepClone(ctx.state);
    const result=tx.execute(ctx.state,{label:`update-operations:${pack.manifest.version}`,apply:()=>{
      const ops=pack.__validatedOperations||[];for(const op of ops)if(!op||!allowedOps.has(op.type))throw new Error(`Unsupported update operation: ${String(op?.type||'empty')}`);
      const strategy=globalThis.GH_STRATEGY_CORE;if(!strategy?.execute)throw new Error('Strategy Core unavailable for runtime update state');
      strategy.execute({state:ctx.state},'apply-runtime-update',{id,version:pack.manifest.version,operations:ops,backupKey,rollbackOwner:'native-save-vault'});
      return true;
    }});
    if(!result?.committed)throw new Error(result?.reason||'Update operations transaction rejected');
    try{if(ctx.persistNow&&!ctx.persistNow({throwOnError:true}))throw new Error('Durable save failed after update operations');}
    catch(error){try{tx.restoreObject(ctx.state,stateSnapshot);}catch(restoreError){error.rollbackError=restoreError;}throw error;}
    ctx.pushAlert(`اكتمل تثبيت حزمة التحديث ${pack.manifest.version}. طُبقت عمليات الحالة ذريًا وحُفظت قبل إغلاق Pending Update.`);ctx.updateKpis();
    return true;
  }

  async function importUpdate(file,ctx){
    const status=document.getElementById('updateStatus');
    try{
      if(!file||file.size>25*1024*1024)throw new Error('حجم ملف التحديث غير صالح.');
      const pack=JSON.parse(await file.text());await validateUpdatePack(pack,{currentBuild:ctx.runtimeBuild});const nativeBridge=window.webkit?.messageHandlers?.updateBridge;
      if(!nativeBridge)throw new Error('التحديثات الموقعة تتطلب تطبيق iPhone للتحقق من توقيع Ed25519. لا يسمح بتطبيق حزمة دون التحقق Native.');
      const pendingKey=`global-holdings-pending-update`;const stagedPack={format:pack.format,manifest:pack.manifest,operationsJSON:pack.operationsJSON};localStorage.setItem(pendingKey,JSON.stringify({pack:stagedPack,sourceName:file.name,createdAt:Date.now()}));
      if(status)status.textContent='تم التحقق من البصمات. جاري التحقق Native من التوقيع والتثبيت الذري…';
      nativeBridge.postMessage({action:'installWebPack',manifest:pack.manifest,files:Array.isArray(pack.files)?pack.files:[],operationsJSON:pack.operationsJSON,saveJSON:JSON.stringify(ctx.state)});
    }catch(error){if(status)status.textContent=`فشل التحديث: ${error.message}`;}
  }

  window.addEventListener?.('gh-native-update',event=>{
    const status=document.getElementById('updateStatus'),ok=event.detail?.success===true||event.detail?.status==='success'||event.detail?.status==='installed';
    // Native owns the complete update lifecycle. This event is presentation-only;
    // re-applying operations here would create a second update owner.
    localStorage.removeItem('global-holdings-pending-update');
    if(status)status.textContent=event.detail?.message||(ok?'اكتملت عملية التحديث واعتمدها Native.':'فشل التحديث ولم تُعتمد الحزمة.');
  });

  let lastBoundContext=null;
  function bind(rootNode,ctx){lastBoundContext=ctx;
    rootNode.querySelectorAll('[data-gh-action]').forEach(btn=>{btn.dataset.interactionBound='1';btn.addEventListener('click',()=>{const runner=globalThis.GH_INTERACTION?.run;return runner?runner(btn,()=>handleAction(btn,ctx),{action:btn.dataset.ghAction,state:ctx.state,panel:ctx.currentPanel}):handleAction(btn,ctx);});});
    rootNode.querySelectorAll('[data-facility-tab]').forEach(btn=>btn.addEventListener('click',()=>ctx.openDrawer('facilityManage',{id:ctx.currentArg?.id||ctx.currentArg,tab:btn.dataset.facilityTab})));
    rootNode.querySelectorAll('[data-company-manage-tab]').forEach(btn=>btn.addEventListener('click',()=>ctx.openDrawer('companyManage',{type:ctx.currentArg?.type||String(ctx.currentArg||'').split(':')[0],tab:btn.dataset.companyManageTab})));
    rootNode.querySelectorAll('[data-ai-prompt]').forEach(btn=>btn.addEventListener('click',()=>{const q=btn.dataset.aiPrompt,answer=aiAnswer(q,ctx);domainCommand(ctx,'ai','message',{messages:[{role:'user',text:q},{role:'assistant',text:answer.text,sources:answer.sources}]},'ai-ui');ctx.save();ctx.openDrawer('intelligence');}));
    rootNode.querySelectorAll('[data-news-filter]').forEach(btn=>btn.addEventListener('click',()=>ctx.openDrawer('news',{filter:btn.dataset.newsFilter})));
    const input=rootNode.querySelector('#updateFileInput');if(input)input.addEventListener('change',()=>importUpdate(input.files?.[0],ctx));
    rootNode.querySelectorAll('img').forEach(img=>{
      if(img.dataset.ghImageBound)return;img.dataset.ghImageBound='1';
      const originalSrc=img.getAttribute('src')||'';
      const fail=()=>{
        if(img.dataset.fallbackApplied)return;img.dataset.fallbackApplied='1';
        const src=originalSrc;
        img.src=/ship|port/.test(src)?photos.port:/air|airport/.test(src)?photos.airport:/truck|logistics/.test(src)?photos.logistics:photos.hq;
        img.closest('.asset-thumb,.visual-hero,.company-visual-card')?.classList.add('image-recovered');
      };
      // Only the genuine 'error' event (network/404/decode failure) counts as a real failure.
      img.addEventListener('error',fail);
      // A 'load' that still reports zero natural size is a corrupt/empty file — also a real failure.
      img.addEventListener('load',()=>{if(img.naturalWidth===0)fail();});
      // If the browser reports the image already complete (e.g. cached) on bind, wait one frame before
      // trusting naturalWidth===0 as a failure signal — a not-yet-started `loading="lazy"` image can
      // legitimately report complete=true with naturalWidth=0 for a moment, which previously caused
      // every image to be swapped for a generic fallback the instant a panel rendered.
      if(img.complete){requestAnimationFrame(()=>{if(img.naturalWidth===0)fail();});}
    });
  }

  function onFinancialDay(state,processedDay=null){
    if(!state.advanced)return 0;
    const day=Number.isFinite(Number(processedDay))?Math.floor(Number(processedDay)):Math.floor((state.simSeconds||0)/86400);
    // All scheduled business maturities are advanced by their owning domain through the command plane.
    globalThis.GH_DOMAIN_COMMANDS?.dispatch?.({state},'strategy','tick-day',{day},{actor:'simulation-scheduler'});
    globalThis.GH_DOMAIN_COMMANDS?.dispatch?.({state},'hr','tick-day',{day},{actor:'simulation-scheduler'});
    globalThis.GH_DOMAIN_COMMANDS?.dispatch?.({state},'banking','tick-day',{day},{actor:'simulation-scheduler'});
    globalThis.GH_DOMAIN_COMMANDS?.dispatch?.({state},'facilities','tick-day',{day},{actor:'simulation-scheduler'});
    // Facility P&L is booked by the owning subsidiary in app.js. This hook now returns parent-only compliance/procurement overhead to prevent cross-company mixing.
    const compliance=(state.advanced.cyber.coverage+state.advanced.safety.score<150)?12000:4500;
    const procurementSaving=(state.advanced.procurement.savings||0)/365;
    return compliance-procurementSaving;
  }

  function adjustTripEconomics(state,asset,eco){
    const company=companyModel(state,asset.type),research=state.research||{};
    const serviceRevenue=1+Math.max(-.05,Math.min(.08,(company.serviceLevel-85)*.002));
    const fuelEfficiency=1-Math.min(.12,(research.efficiency||0)/100*.08+company.automation/100*.025);
    const crewEfficiency=1-Math.min(.10,(research.automation||0)/100*.05+company.automation/100*.035);
    const maintenanceEfficiency=1-Math.min(.08,company.automation/100*.04+(research.efficiency||0)/100*.025),su=state.sustainability||{},sustainabilityFuel=asset.type==='air'?1-Math.min(.06,(su.safShare||0)*.0004):asset.type==='sea'?1-Math.min(.05,(su.shorePower||0)*.00025):1-Math.min(.08,(su.electricRoadShare||0)*.00045);
    eco.revenue*=serviceRevenue;eco.fuelCost*=fuelEfficiency*sustainabilityFuel;eco.crewCost*=crewEfficiency;eco.maintReserve*=maintenanceEfficiency;
    eco.margin=eco.revenue-eco.fuelCost-eco.crewCost-eco.maintReserve;
    eco.cashContribution=eco.revenue-eco.fuelCost-eco.maintReserve;
    eco.modifiers={serviceRevenue,fuelEfficiency,crewEfficiency,maintenanceEfficiency};
    return eco;
  }


  function onMarketHour(state,processedHour=null){
    const m=state.advanced.economy;
    if(window.GH_REALISM?.migrate){const re=window.GH_REALISM.migrate(state).economy;globalThis.GH_DOMAIN_COMMANDS?.dispatch?.({state},'market','sync-economy',{values:{electricityPriceMWh:re.electricity,gasCostMWh:re.gas,freightIndex:re.freight,baseRate:re.baseRate,loanYield:Math.max((Number(m.depositRate)||0)+.012,re.baseRate+.028)}},{actor:'simulation-market'});return;}
    const move=(scale)=>((globalThis.GH_DETERMINISM?.nextFloat?.(state,'advanced-market')??0.5)-.5)*scale;
    const marketResult=globalThis.GH_DOMAIN_COMMANDS?.dispatch?.({state},'market','tick-economy',{move},{actor:'simulation-market'})?.result||m;
    const hour=Number.isFinite(Number(processedHour))?Math.floor(Number(processedHour)):Math.floor((state.simSeconds||0)/3600);if(hour&&hour%12===0&&state.advanced.economy.lastNewsHour!==hour){const headline=marketResult.freightIndex>125?'ارتفاع مؤشر الشحن رفع تسعير العقود البحرية والجوية.':marketResult.gasCostMWh>75?'ارتفاع الطاقة والوقود يستدعي مراجعة هوامش المسارات.':marketResult.electricityPriceMWh>105?'ارتفاع أسعار الكهرباء يعزز ربحية أصول الطاقة.':'استقرار نسبي في الشحن والطاقة مع مراقبة أسعار الفائدة.';globalThis.GH_DOMAIN_COMMANDS?.dispatch?.({state},'strategy','economy-news',{hour,text:headline},{actor:'simulation-market'});}
  }

  window.GH_ADVANCED={VERSION,SAVE_SCHEMA_VERSION,photos,migrate,meta,root,render,bind,onFinancialDay,adjustTripEconomics,onMarketHour,photoFor,validateUpdatePack,applyNativeUpdate:async(pack,ctx)=>{await validateUpdatePack(pack,{currentBuild:ctx.runtimeBuild,postInstall:true});return applyUpdateOperations(pack,ctx,'التحديث الأصلي');}};
})();

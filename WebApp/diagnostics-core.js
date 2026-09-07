(()=>{
  'use strict';
  const VERSION='2.9.1',LIMIT=240,ALLOWED_SPEEDS=[0,1,2,4];
  let installed=false,lastLongTaskAt=0,eventSeq=0;
  function ensure(state){
    state.diagnostics=state.diagnostics&&typeof state.diagnostics==='object'?state.diagnostics:{};
    state.diagnostics.events=Array.isArray(state.diagnostics.events)?state.diagnostics.events:[];
    state.diagnostics.lastHealth=state.diagnostics.lastHealth&&typeof state.diagnostics.lastHealth==='object'?state.diagnostics.lastHealth:null;
    state.diagnostics.counters=state.diagnostics.counters&&typeof state.diagnostics.counters==='object'?state.diagnostics.counters:{};
    state.diagnostics.activeIssues=state.diagnostics.activeIssues&&typeof state.diagnostics.activeIssues==='object'?state.diagnostics.activeIssues:{};
    state.diagnostics.resolvedIssues=Array.isArray(state.diagnostics.resolvedIssues)?state.diagnostics.resolvedIssues:[];
    return state.diagnostics;
  }
  function cleanDetail(value,depth=0){
    if(depth>4)return '[depth-limit]';
    if(value==null||typeof value==='string'||typeof value==='number'||typeof value==='boolean')return value;
    if(value instanceof Error)return {name:value.name,message:value.message,stack:String(value.stack||'').split('\n').slice(0,12).join('\n')};
    if(Array.isArray(value))return value.slice(0,30).map(x=>cleanDetail(x,depth+1));
    if(typeof value==='object'){
      const out={};let count=0;
      for(const [k,v] of Object.entries(value)){
        if(count++>=40){out.__truncated=true;break;}
        if(/logo|image|base64|blob|dataurl/i.test(k)&&typeof v==='string'&&v.length>400){out[k]=`[omitted ${v.length} chars]`;continue;}
        out[k]=cleanDetail(v,depth+1);
      }
      return out;
    }
    return String(value);
  }
  function record(state,type,detail={},severity='info'){
    const d=ensure(state),event={id:`DG-${Date.now()}-${++eventSeq}`,type:String(type),severity:String(severity||'info'),at:Date.now(),simSeconds:Number(state.simSeconds)||0,detail:cleanDetail(detail)};
    d.events.unshift(event);if(d.events.length>LIMIT)d.events.length=LIMIT;
    d.counters[event.type]=(Number(d.counters[event.type])||0)+1;
    return event;
  }
  function issue(id,severity,title,detail,domain='system',evidence={}){return {id,severity,title,detail,domain,evidence:cleanDetail(evidence)};}
  function finiteNumber(value){return typeof value==='number'&&Number.isFinite(value);}
  function layoutSnapshot(){
    const doc=globalThis.document;if(!doc?.querySelector)return null;
    const pack=(el)=>{if(!el?.getBoundingClientRect)return null;const r=el.getBoundingClientRect();return {left:Number(r.left)||0,top:Number(r.top)||0,right:Number(r.right)||0,bottom:Number(r.bottom)||0,width:Number(r.width)||0,height:Number(r.height)||0};};
    const actions=doc.querySelector('.topbar .top-actions');
    return {
      viewport:{width:Number(globalThis.innerWidth)||Number(doc.documentElement?.clientWidth)||0,height:Number(globalThis.innerHeight)||Number(doc.documentElement?.clientHeight)||0},
      topbar:pack(doc.querySelector('.topbar')),brand:pack(doc.querySelector('.topbar .brand')),kpis:pack(doc.querySelector('.topbar .top-kpis')),actions:pack(actions),mapActions:pack(doc.querySelector('.map-actions')),
      actionButtons:actions?[...actions.querySelectorAll('button')].filter(el=>{const st=globalThis.getComputedStyle?.(el);return st?.display!=='none'&&st?.visibility!=='hidden';}).map(el=>({id:el.id||null,rect:pack(el)})):[]
    };
  }
  function rectOverlap(a,b,tolerance=1){if(!a||!b)return false;return a.left<b.right-tolerance&&a.right>b.left+tolerance&&a.top<b.bottom-tolerance&&a.bottom>b.top+tolerance;}
  function runHealthCheck(state,extra={},options={}){
    const issues=[];ensure(state);
    const add=(id,severity,title,detail,domain,evidence)=>issues.push(issue(id,severity,title,detail,domain,evidence));
    const simSeconds=Number(state.simSeconds);
    if(!Number.isFinite(simSeconds)||simSeconds<0)add('SIM_TIME_INVALID','critical','زمن المحاكاة غير صالح','simSeconds يجب أن يكون رقمًا محدودًا وغير سالب.','simulation',{simSeconds:state.simSeconds});
    if(!ALLOWED_SPEEDS.includes(Number(state.speed)))add('SIM_SPEED_INVALID','critical','سرعة غير معتمدة','السرعة الحالية ليست ضمن Pause/×1/×2/×4.','simulation',{speed:state.speed});
    const sim=extra.simulation||{};
    if(sim.fatalError)add('SIM_FATAL_STATE','critical','المحرك في حالة خطأ قاتل',String(sim.fatalError),'simulation',sim);
    if(Number(sim.backlogSeconds)>60)add('SIM_BACKLOG_HIGH','warning','تراكم محاكاة مرتفع','يوجد backlog مرتفع وقد يؤدي إلى تباطؤ أو خفض سرعة تلقائي.','simulation',{backlogSeconds:sim.backlogSeconds});
    if(Number(sim.conflictRate)>0.1)add('SIM_CONFLICT_HIGH','warning','معدل تعارض معاملات مرتفع','تتكرر إلغاءات معاملات المحاكاة أكثر من المتوقع.','simulation',{conflictRate:sim.conflictRate});
    const recovery=state.simulationKernel?.boundaryRecovery;
    if(recovery?.failed)add('BOUNDARY_RECOVERY_FAILED','critical','فشل استرداد حدود الزمن','تم إيقاف الاسترداد بعد فشل سابق ويجب مراجعة التشخيص.','simulation',recovery);
    const lastCommit=state.simulationKernel?.lastAtomicCommit;
    if(lastCommit&&finiteNumber(lastCommit.from)&&finiteNumber(lastCommit.to)&&lastCommit.to<lastCommit.from)add('ATOMIC_COMMIT_REVERSED','critical','معاملة زمنية معكوسة','آخر Atomic Commit تحرك إلى زمن أقدم.','transaction',lastCommit);
    if(!globalThis.GH_TRANSACTION_CORE?.execute)add('TX_CORE_MISSING','critical','Transaction Core غير متاح','لا يمكن ضمان All-or-Nothing بدون Transaction Core.','transaction');
    if(!globalThis.GH_SIMULATION_CORE?.create)add('SIM_CORE_MISSING','critical','Simulation Core غير متاح','محرك الزمن المركزي غير محمل.','simulation');
    if(!globalThis.GH_SAVE_SCHEMA?.normalize)add('SAVE_SCHEMA_CORE_MISSING','critical','Save Schema Core غير متاح','طبقة التوافق مع الحفظ غير محملة.','save');
    const expected=VERSION;
    for(const [name,core] of [['transaction',globalThis.GH_TRANSACTION_CORE],['simulation',globalThis.GH_SIMULATION_CORE],['save',globalThis.GH_SAVE_SCHEMA],['determinism',globalThis.GH_DETERMINISM],['request',globalThis.GH_REQUEST_CORE],['hr',globalThis.GH_HR_CORE],['lifecycle',globalThis.GH_LIFECYCLE_CORE],['policy',globalThis.GH_POLICY_CORE],['dependencies',globalThis.GH_DEPENDENCY_CORE],['ledger',globalThis.GH_EVENT_LEDGER],['closure',globalThis.GH_DEMAND_CLOSURE],['integrity',globalThis.GH_INTEGRITY_CORE],['workflow',globalThis.GH_WORKFLOW],['departments',globalThis.GH_DEPARTMENT_CORE]])if(core?.VERSION&&String(core.VERSION)!==expected)add('CORE_VERSION_MISMATCH','critical','عدم تطابق إصدارات الأنظمة',`${name} يعمل على ${core.VERSION} بينما Diagnostics على ${expected}.`,'system',{name,version:core.VERSION,expected});
    for(const [key,label] of [['cash','السيولة الموحدة'],['debt','الدين الموحد'],['groupValue','قيمة المجموعة']]){const v=Number(state[key]);if(!Number.isFinite(v)||v<0)add(`STATE_${key.toUpperCase()}_INVALID`,'critical',`${label} غير صالحة`,`${key} يجب أن يكون رقمًا محدودًا وغير سالب.`,'finance',{value:state[key]});}
    if(String(state.saveVersion||'2.0.0')!=='2.0.0')add('SAVE_SCHEMA_UNEXPECTED','warning','نسخة الحفظ غير متوقعة','المشروع مصمم حاليًا لحفظ 2.0.0.','save',{saveVersion:state.saveVersion});

    const assets=Array.isArray(state.assets)?state.assets:[];
    const assetIds=new Set(),dupAssets=[];
    for(const a of assets){
      if(!a||typeof a!=='object'){add('ASSET_INVALID_RECORD','critical','سجل أصل تالف','يوجد عنصر غير صالح داخل state.assets.','assets');continue;}
      const id=String(a.id||'');if(!id)add('ASSET_ID_MISSING','critical','أصل بلا معرف','كل أصل يجب أن يملك ID ثابتًا.','assets',{name:a.name,type:a.type});
      else if(assetIds.has(id))dupAssets.push(id);else assetIds.add(id);
      if(a.progress!=null&&(!finiteNumber(Number(a.progress))||Number(a.progress)<0))add('ASSET_PROGRESS_INVALID','warning','تقدم أصل غير صالح',`الأصل ${id||a.name||'؟'} يحمل progress غير صالح.`,'assets',{id,progress:a.progress});
      if(a.condition!=null&&(!finiteNumber(Number(a.condition))||Number(a.condition)<0||Number(a.condition)>100))add('ASSET_CONDITION_INVALID','warning','حالة أصل خارج النطاق',`Condition يجب أن تكون بين 0 و100.`,'assets',{id,condition:a.condition});
    }
    if(dupAssets.length)add('ASSET_DUPLICATE_IDS','critical','معرفات أصول مكررة','تكرار ID قد يسبب overwrite أو بيع/توجيه الأصل الخطأ.','assets',{ids:[...new Set(dupAssets)].slice(0,20)});

    const books=state.finance?.companyBooks||state.companyBooks||{};
    for(const [company,book] of Object.entries(books||{})){
      const balance=Number(book?.balance??book?.cash??0),debt=Number(book?.debt??0);
      if(!Number.isFinite(balance))add('FIN_BALANCE_NAN','critical','رصيد شركة غير رقمي',`رصيد ${company} ليس رقمًا صالحًا.`,'finance',{company,balance:book?.balance});
      if(!Number.isFinite(debt)||debt<0)add('FIN_DEBT_INVALID','warning','دين شركة غير صالح',`دين ${company} يجب أن يكون رقمًا غير سالب.`,'finance',{company,debt:book?.debt});
    }
    const deliveries=state.realism?.procurement?.deliveries||[];
    const overdueDeliveries=Array.isArray(deliveries)?deliveries.filter(d=>d?.status==='pending'&&Number.isFinite(Number(d.dueAtSeconds))&&Number(d.dueAtSeconds)<Number(state.simSeconds||0)-5):[];
    if(overdueDeliveries.length)add('PROCUREMENT_DELIVERY_OVERDUE','warning','أصول مستحقة لم تدخل القواعد','يوجد طلب تسليم تجاوز موعده التشغيلي ولم يدخل الأصل إلى الأسطول بعد.','assets',{count:overdueDeliveries.length,ids:overdueDeliveries.slice(0,12).map(d=>d.id)});
    const simHour=Math.floor((Number(state.simSeconds)||0)/3600),aiLastHour=Number(state.advanced?.ai?.lastBalancedReviewSlot);if(Number.isFinite(aiLastHour)&&simHour-aiLastHour>2)add('AI_REVIEW_STALE','warning','مراجعة AI بالمحاكاة متأخرة','لم يسجل AI التنفيذي مراجعة خلال آخر ساعتين من وقت المحاكاة.','ai',{simHour,lastBalancedReviewSlot:aiLastHour});
    const assetRequests=state.advanced?.procurement?.assetRequests||[],openAssetStatuses=new Set(['awaiting_review','awaiting_authorization','authorized','blocked_funding','blocked_capacity','ordering','delivering','readiness']),openAssetRequests=Array.isArray(assetRequests)?assetRequests.filter(r=>openAssetStatuses.has(r?.status)):[];
    const seenRequestSignatures=new Map(),duplicateRequests=[];for(const r of openAssetRequests){const sig=String(r.signature||[r.company,r.catalogId,r.baseId,r.mode,r.tab].join('|'));if(seenRequestSignatures.has(sig))duplicateRequests.push(r.id);else seenRequestSignatures.set(sig,r.id);}
    if(duplicateRequests.length)add('ASSET_REQUEST_DUPLICATE_OPEN','critical','طلبات أصول مفتوحة مكررة','يوجد أكثر من طلب مفتوح لنفس الأصل/القاعدة؛ هذا يخالف Single Source of Truth.','ai',{ids:duplicateRequests.slice(0,20)});
    const orphanDeliveries=openAssetRequests.filter(r=>r.status==='delivering'&&!deliveries.some(d=>d.requestRef===r.id));if(orphanDeliveries.length)add('ASSET_REQUEST_DELIVERY_ORPHAN','critical','طلبات تسليم بلا أوامر مرتبطة','طلب أصل في حالة التسليم لكن لا توجد أي Delivery تحمل requestRef الخاص به.','assets',{ids:orphanDeliveries.slice(0,20).map(r=>r.id)});
    const deliveryContractMismatch=openAssetRequests.filter(r=>r.status==='delivering').map(r=>{const ds=deliveries.filter(d=>d.requestRef===r.id),qty=Math.max(1,Number(r.qty)||1);return ds.length!==qty||ds.some(d=>d.baseId!==r.baseId)?{id:r.id,qty,deliveries:ds.length,baseId:r.baseId,wrongBase:ds.filter(d=>d.baseId!==r.baseId).map(d=>d.id)}:null;}).filter(Boolean);if(deliveryContractMismatch.length)add('ASSET_REQUEST_DELIVERY_CONTRACT_MISMATCH','critical','عقد التسليم لا يطابق الطلب المعتمد','عدد أو وجهة أوامر التسليم لا يطابق عقد طلب الأصل؛ يمنع الإغلاق حتى التصحيح.','assets',{requests:deliveryContractMismatch.slice(0,20)});
    const linkedAi=state.advanced?.ai?.requests||[],fundingWithoutDependency=openAssetRequests.filter(r=>r.status==='blocked_funding'&&!linkedAi.some(x=>x.parentAssetRequestId===r.id&&x.kind==='funding'&&x.status==='بانتظار التفويض')&&r.authority?.type!=='annual-plan');if(fundingWithoutDependency.length)add('ASSET_REQUEST_FUNDING_DEPENDENCY_MISSING','warning','طلب أصل ممول جزئيًا بلا طلب تمويل مرتبط','محرك الإغلاق يجب أن يرفع طلب تمويل مرتبط بدل ترك الطلب معلقًا.','ai',{ids:fundingWithoutDependency.slice(0,20).map(r=>r.id)});
    const lastClosureHour=Number(state.advanced?.procurement?.requestCenter?.lastSweepHour);if(openAssetRequests.length&&Number.isFinite(lastClosureHour)&&simHour-lastClosureHour>2)add('ASSET_REQUEST_CLOSURE_STALE','warning','محرك إغلاق طلبات الأصول متأخر','توجد طلبات مفتوحة ولم يسجل Demand Closure Engine دورة خلال آخر ساعتين من المحاكاة.','ai',{open:openAssetRequests.length,lastSweepHour:lastClosureHour,simHour});

    const collections=[['receivables',state.finance?.receivables],['payables',state.finance?.payables],['invoices',state.finance?.invoices],['cheques',state.finance?.cheques]];
    for(const [name,list] of collections)if(list!=null&&!Array.isArray(list))add(`FIN_${name.toUpperCase()}_INVALID`,'critical',`هيكل ${name} غير صالح`,`يجب أن يكون ${name} مصفوفة.`,'finance',{type:typeof list});
    if((state.finance?.receivables?.length||0)>5000)add('AR_VOLUME_HIGH','warning','سجل الذمم المدينة ضخم','عدد السجلات مرتفع رغم نظام الضغط التاريخي.','finance',{count:state.finance.receivables.length});
    if((state.finance?.payables?.length||0)>5000)add('AP_VOLUME_HIGH','warning','سجل الذمم الدائنة ضخم','عدد السجلات مرتفع رغم نظام الضغط التاريخي.','finance',{count:state.finance.payables.length});

    const deptCore=globalThis.GH_DEPARTMENT_CORE;if(deptCore?.definitions){const overdue=[];for(const dept of Object.keys(deptCore.definitions)){if(deptCore.due?.(dept,state))overdue.push(dept);}if(overdue.length>5)add('DEPARTMENT_REVIEWS_OVERDUE','warning','مراجعات إدارية دورية متأخرة',`يوجد ${overdue.length} أقسام لم تنفذ دورتها الدورية.`, 'management',{departments:overdue});}

    const integrity=globalThis.GH_INTEGRITY_CORE?.check?.(state);
    if(integrity?.issues?.length)for(const x of integrity.issues)add(`BIZ_${x.id}`,x.severity,x.title,x.detail,x.domain||'business',x.evidence||{});
    const layout=layoutSnapshot();
    if(layout?.topbar){
      const buttons=(layout.actionButtons||[]).map(x=>x.rect).filter(Boolean);
      if(buttons.length>1){const tops=buttons.map(r=>r.top),bottoms=buttons.map(r=>r.bottom);if(Math.max(...tops)-Math.min(...tops)>4||Math.max(...bottoms)-Math.min(...bottoms)>4)add('UI_TOPBAR_ACTION_WRAP','warning','التفاف أزرار الشريط العلوي','أزرار الإجراءات ليست على صف واحد؛ قد يكون عدد الأعمدة أقل من عدد الأزرار.','ui',{layout});}
      for(const item of layout.actionButtons||[]){const r=item.rect,t=layout.topbar;if(r&&(r.top<t.top-1||r.bottom>t.bottom+1))add('UI_TOPBAR_ACTION_OVERFLOW','warning','زر خارج حدود الشريط العلوي',`الزر ${item.id||'غير معروف'} خرج عموديًا من حاوية الشريط.`,'ui',{button:item,topbar:t});}
      if(rectOverlap(layout.actions,layout.kpis,2))add('UI_TOPBAR_ACTION_KPI_OVERLAP','warning','تداخل الإجراءات مع المؤشرات','منطقة أزرار الشريط تتداخل مع بطاقات KPI.','ui',{layout});
      if(rectOverlap(layout.kpis,layout.brand,2))add('UI_TOPBAR_KPI_BRAND_OVERLAP','warning','تداخل المؤشرات مع هوية المجموعة','بطاقات KPI تتداخل مع اسم/شعار المجموعة.','ui',{layout});
      if(layout.mapActions&&layout.mapActions.top<layout.topbar.bottom+3)add('UI_MAP_TOOLS_TOPBAR_OVERLAP','warning','تداخل أدوات الخريطة مع الشريط العلوي','أدوات الخريطة بدأت قبل نهاية الشريط العلوي.','ui',{layout});
      const interactionIssues=globalThis.GH_INTERACTION?.validate?.(globalThis.document)||[];for(const ii of interactionIssues){add(ii.id||'BUTTON_INTEGRITY','warning',ii.id==='DISABLED_WITHOUT_REASON'?'زر معطل بلا سبب واضح':'خلل في ربط زر',ii.label||'زر غير معروف','ui',{button:ii});}
    }

    const diag=state.diagnostics;

    const severityRank={critical:3,warning:2,info:1,ok:0};
    issues.sort((a,b)=>(severityRank[b.severity]||0)-(severityRank[a.severity]||0));
    const critical=issues.filter(x=>x.severity==='critical').length,warning=issues.filter(x=>x.severity==='warning').length;
    const report={format:'gh-health-v3',version:VERSION,at:new Date().toISOString(),checkedAtMs:Date.now(),simSeconds:Number(state.simSeconds)||0,status:critical?'critical':warning?'warning':'healthy',counts:{critical,warning,total:issues.length},issues,summary:{assets:assets.length,events:(state.eventLog||[]).length,diagnosticEvents:(diag.events||[]).length,receivables:state.finance?.receivables?.length||0,payables:state.finance?.payables?.length||0,speed:Number(state.speed)||0},simulation:cleanDetail(sim),layout:cleanDetail(layout)};
    if(options.trackTransitions!==false){
      const previous=diag.activeIssues&&typeof diag.activeIssues==='object'?diag.activeIssues:{};
      const next={};
      for(const current of issues){
        const prior=previous[current.id];
        next[current.id]={id:current.id,severity:current.severity,title:current.title,detail:current.detail,domain:current.domain,firstSeenAt:prior?.firstSeenAt||report.at,lastSeenAt:report.at,occurrences:(Number(prior?.occurrences)||0)+1,evidence:current.evidence};
        if(!prior)record(state,'ISSUE_OPEN',{id:current.id,title:current.title,domain:current.domain},current.severity);
        else if(prior.severity!==current.severity)record(state,'ISSUE_SEVERITY_CHANGED',{id:current.id,from:prior.severity,to:current.severity,title:current.title},current.severity);
      }
      for(const [id,prior] of Object.entries(previous)){
        if(next[id])continue;
        const resolved={...prior,resolvedAt:report.at,resolvedSimSeconds:Number(state.simSeconds)||0};
        diag.resolvedIssues.unshift(resolved);
        if(diag.resolvedIssues.length>80)diag.resolvedIssues.length=80;
        record(state,'ISSUE_RESOLVED',{id,title:prior.title,domain:prior.domain},'info');
      }
      diag.activeIssues=next;
    }
    diag.lastHealth=report;
    if(options.recordEvent===true)record(state,'HEALTH_CHECK',{status:report.status,counts:report.counts},critical?'critical':warning?'warning':'info');
    return report;
  }
  function stateSummary(state){return {profile:{name:state.profile?.name||null,creditRating:state.profile?.creditRating||null},simSeconds:Number(state.simSeconds)||0,speed:Number(state.speed)||0,cash:Number(state.cash)||0,debt:Number(state.debt)||0,groupValue:Number(state.groupValue)||0,assets:(state.assets||[]).length,openedCompanies:[...(state.openedCompanies||[])],globalBases:(state.globalBases||[]).length,customHubs:(state.customHubs||[]).length,branches:(state.branches||[]).length,finance:{invoices:state.finance?.invoices?.length||0,cheques:state.finance?.cheques?.length||0,receivables:state.finance?.receivables?.length||0,payables:state.finance?.payables?.length||0},ai:{requests:state.advanced?.ai?.requests?.length||0,delegations:state.advanced?.ai?.delegations?.length||0,assetRequests:state.advanced?.procurement?.assetRequests?.length||0,assetRequestsClosed:state.advanced?.procurement?.assetClosureLog?.length||0}};}
  function exportBundle(state,extra={}){const d=ensure(state),health=runHealthCheck(state,extra,{recordEvent:false,trackTransitions:true}),integrity=globalThis.GH_INTEGRITY_CORE?.check?.(state)||null,closure=globalThis.GH_DEMAND_CLOSURE?.reconcile?.(state)||null,ledger=globalThis.GH_EVENT_LEDGER?.summary?.(state)||null,actionTasks=globalThis.GH_UI_QUALITY?.collectTasks?.(state)||[];return {format:'global-holdings-diagnostic-bundle',diagnosticsVersion:VERSION,generatedAt:new Date().toISOString(),appVersion:extra.appVersion||null,saveSchemaVersion:extra.saveSchemaVersion||state.saveVersion||null,health,integrity:cleanDetail(integrity),demandClosure:cleanDetail(closure),eventLedger:{summary:cleanDetail(ledger),events:cleanDetail((state.businessLedger?.events||[]).slice(0,160))},dependencies:cleanDetail((state.dependencyGraph?.edges||[]).slice(0,220)),actionCenter:{count:actionTasks.length,tasks:cleanDetail(actionTasks.slice(0,120))},workflow:cleanDetail(globalThis.GH_WORKFLOW?.summary?.(state)||null),departments:cleanDetail(state.advanced?.departmentLife||null),simulation:cleanDetail(extra.simulation||{}),stateSummary:stateSummary(state),events:d.events.slice(0,LIMIT),environment:{userAgent:globalThis.navigator?.userAgent||null,language:globalThis.navigator?.language||null,visibility:globalThis.document?.visibilityState||null,online:globalThis.navigator?.onLine??null}};}
  function installGlobalHandlers(stateProvider,extraProvider=()=>({})){
    if(installed||typeof globalThis.addEventListener!=='function')return;installed=true;
    const getState=()=>{try{return stateProvider?.();}catch{return null;}};
    globalThis.addEventListener('error',event=>{const s=getState();if(s)record(s,'WINDOW_ERROR',{message:event.message,filename:event.filename,lineno:event.lineno,colno:event.colno,error:event.error},'critical');});
    globalThis.addEventListener('unhandledrejection',event=>{const s=getState();if(s)record(s,'UNHANDLED_REJECTION',{reason:event.reason},'critical');});
    const originalError=globalThis.console?.error?.bind(globalThis.console),originalWarn=globalThis.console?.warn?.bind(globalThis.console);
    if(originalError)globalThis.console.error=(...args)=>{const s=getState();if(s)record(s,'CONSOLE_ERROR',{args},'critical');originalError(...args);};
    if(originalWarn)globalThis.console.warn=(...args)=>{const s=getState();if(s)record(s,'CONSOLE_WARN',{args},'warning');originalWarn(...args);};
    globalThis.addEventListener('visibilitychange',()=>{const s=getState();if(s)record(s,'VISIBILITY_CHANGE',{state:globalThis.document?.visibilityState},'info');});
    if(globalThis.PerformanceObserver){try{const observer=new PerformanceObserver(list=>{const s=getState();if(!s)return;for(const entry of list.getEntries()){if(entry.duration>=120&&Date.now()-lastLongTaskAt>250){lastLongTaskAt=Date.now();record(s,'LONG_TASK',{duration:Math.round(entry.duration),name:entry.name||'task',extra:cleanDetail(extraProvider?.())},entry.duration>=500?'warning':'info');}}});observer.observe({entryTypes:['longtask']});}catch(error){console.debug('Long Task diagnostics unavailable',error);}}
  }
  function clear(state){const d=ensure(state);d.events=[];d.counters={};d.resolvedIssues=[];d.activeIssues={};d.lastHealth=null;d.clearedAt=new Date().toISOString();d.clearedSimSeconds=Number(state?.simSeconds)||0;return {clearedAt:d.clearedAt,simSeconds:d.clearedSimSeconds};}
  const API=Object.freeze({VERSION,LIMIT,ALLOWED_SPEEDS,ensure,record,runHealthCheck,exportBundle,layoutSnapshot,installGlobalHandlers,clear});
  globalThis.GH_DIAGNOSTICS=API;if(globalThis.window&&globalThis.window!==globalThis)globalThis.window.GH_DIAGNOSTICS=API;if(typeof module!=='undefined'&&module.exports)module.exports=API;
})();

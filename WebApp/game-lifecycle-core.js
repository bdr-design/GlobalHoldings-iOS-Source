(()=>{'use strict';
  const VERSION='3.0.0';
  // Build 358: the chosen headquarters is a real place: the group HQ facility stands at these coordinates on the map.
  const FOUNDING_LOCATIONS=Object.freeze([
    {id:'RUH',country:'السعودية',city:'الرياض',coords:[24.7136,46.6753]},
    {id:'DXB',country:'الإمارات',city:'دبي',coords:[25.2048,55.2708]},
    {id:'SIN',country:'سنغافورة',city:'سنغافورة',coords:[1.2903,103.8519]},
    {id:'LON',country:'المملكة المتحدة',city:'لندن',coords:[51.5072,-0.1276]},
    {id:'NYC',country:'الولايات المتحدة',city:'نيويورك',coords:[40.7128,-74.006]}
  ].map(row=>Object.freeze({...row,coords:Object.freeze(row.coords)})));
  const FOUNDING_CAPITALS=Object.freeze({balanced:50000000,investor:250000000,sandbox:1000000000});
  const FOUNDING_ARTICLES=Object.freeze([
    Object.freeze({title:'الكيان والملكية',text:'تؤسس مجموعة قابضة مملوكة للمؤسس الوارد في هذا العقد، ويثبت اسمها ومقرها في سجل المجموعة، ويقام مبنى مقرها الرئيسي في مدينة المقر.'}),
    Object.freeze({title:'رأس المال والحسابات',text:'يودع رأس المال المبين كاملًا في الحساب الجاري للمجموعة مرة واحدة عند اعتماد العقد. العملة المحاسبية هي الدولار الأمريكي، والسنة المالية من يناير إلى ديسمبر.'}),
    Object.freeze({title:'الشركات والتشغيل',text:'تؤسس الشركات التابعة لاحقًا بعقود فتح مستقلة، ولكل شركة حسابها ومشترياتها ونتائجها. لا يمنح هذا العقد أصولًا أو قواعد تشغيلية تلقائيًا.'})
  ]);
  // Build 358: the clauses of a subsidiary opening contract. Each one states what the opening command really does.
  function openingArticles({groupName='المجموعة',legalName='الشركة',sector='',capitalText='',sourceAccount=''}={}){
    return [
      {title:'الكيان',text:`تُفتح ${legalName} شركةً تابعة مملوكة بالكامل لـ ${groupName}${sector?`، ونشاطها ${sector}`:''}، ولها سجلها التجاري وملفها الضريبي.`},
      {title:'رأس المال',text:`يُحوَّل ${capitalText} عند التوقيع من الحساب الجاري للقابضة${sourceAccount?` ${sourceAccount}`:''} إلى حساب الشركة الجديد، ويُقيَّد رأس مال مدفوعًا. لا تتغير قيمة المجموعة بالتحويل لأنه داخلها.`},
      {title:'التشغيل',text:'تبدأ الشركة بلا أصول ولا منشآت ولا طواقم. كل أصل أو منشأة يُشترى بأمر مستقل ويُدفع من حسابها.'},
      {title:'الاعتماد',text:'تُعتمد معاملات الشركة بتوقيع المؤسس المرئي، ويُعيَّن مديرها التنفيذي من الموارد البشرية.'}
    ];
  }
  function locationFor(profile={}){return FOUNDING_LOCATIONS.find(row=>row.id===profile.locationId)||FOUNDING_LOCATIONS.find(row=>row.city===profile.city)||FOUNDING_LOCATIONS[0];}
  function prepareFounding(input={}){
    const clean=(value,max,required,label)=>{const text=String(value??'').trim().replace(/\s+/g,' ');if((required&&!text)||text.length>max||/[\u0000-\u001f\u007f<>]/.test(text))throw new Error(label);return text;};
    const name=clean(input.name,42,true,'أدخل اسمًا للمجموعة من 1 إلى 42 حرفًا.'),founder=clean(input.founder,32,true,'أدخل اسم المؤسس من 1 إلى 32 حرفًا.');
    const shortName=clean(input.shortName||'GH',4,true,'اختصار المجموعة لا يتجاوز أربعة أحرف.').toUpperCase();
    if(!/^[\p{L}\p{N}]{1,4}$/u.test(shortName))throw new Error('استخدم أحرفًا أو أرقامًا فقط في الاختصار.');
    const location=FOUNDING_LOCATIONS.find(row=>row.id===input.locationId);if(!location)throw new Error('اختر مقرًا من القائمة المعتمدة.');
    if(!Object.prototype.hasOwnProperty.call(FOUNDING_CAPITALS,input.mode))throw new Error('اختر رأس مال من الخيارات المعروضة.');
    const logo=input.logo||null;if(logo){const inspect=globalThis.GH_IDENTITY?.inspectCustomLogo;if(typeof inspect!=='function')throw new Error('تعذر تشغيل فاحص الشعار الآمن.');const checked=inspect(logo);if(!checked.ok)throw new Error(`الشعار غير صالح؛ ارفع صورة أخرى. (${checked.reason})`);}
    return {name,founder,shortName,englishName:clean(input.englishName,60,false,'الاسم الإنجليزي لا يتجاوز 60 حرفًا.'),locationId:location.id,country:location.country,city:location.city,mode:input.mode,capital:FOUNDING_CAPITALS[input.mode],currency:'USD',legalForm:'شركة قابضة مساهمة مقفلة',fiscalYear:'calendar',logo};
  }
  function prepareFormationPlan(input={},signature={},options={}){
    const prepared=prepareFounding(input),engine=globalThis.GH_FORMATION_ENGINE;
    if(!engine?.prepare||!engine?.validatePlan)throw new Error('FOUNDING_FORMATION_ENGINE_UNAVAILABLE');
    const signatureRef=String(signature.signatureRef||signature.id||'').trim(),signatureVersion=Math.floor(Number(signature.version)||0);
    if(!signatureRef||signatureVersion<1)throw new Error('FOUNDING_SIGNATURE_REQUIRED');
    const plan=engine.prepare({entityKind:'group',companyId:'group',name:prepared.name,legalName:prepared.name,displayName:prepared.name,shortName:prepared.shortName,englishName:prepared.englishName,founder:prepared.founder,location:{id:prepared.locationId,city:prepared.city,country:prepared.country},capital:prepared.capital,currency:prepared.currency,signatureRef,signatureVersion,createdAt:Math.max(0,Number(options.createdAt)||0),identity:{logo:prepared.logo,legalForm:prepared.legalForm,fiscalYear:prepared.fiscalYear,mode:prepared.mode}});
    engine.validatePlan(plan);return plan;
  }
  const clone=v=>globalThis.structuredClone?structuredClone(v):JSON.parse(JSON.stringify(v));
  const bankZero=defaults=>({...clone(defaults.bank),branches:0,deposits:0,loans:0,hqla:0,stableFunding:0,requiredStableFunding:0,wholesaleFunding:0,offBalance:0,feeIncomeYTD:0,provisions:0,corporateClients:{},creditFacilities:[],lettersOfCredit:[],guarantees:[],cashSweeps:[],tradeFinance:[],riskReviews:[]});
  function pristine(defaultState,resetEpoch=Date.now()){
    const s=clone(defaultState);
    Object.assign(s,{resetEpoch,saveRevision:1,onboardingComplete:false,speed:0,godMoney:false,infiniteMoney:false,assets:[],unlockedSectors:[],openedCompanies:[],ownedCompanies:[],branches:[],globalBases:[],customHubs:[],customRoutes:[],routeEndpoints:{},routeCache:{},companyRegistry:{},companyFinance:{},contractRegistry:{},constructionContracts:[],commercialTenders:[],supplierTransactions:[],eventLog:[],alerts:[]});
    s.energy={gasMW:0,solarMW:0,windMW:0,storageMWh:0,availability:100};
    s.bank=bankZero(defaultState);s.treasury=clone(defaultState.treasury);for(const a of s.treasury.accounts)a.balance=0;s.cash=0;s.debt=0;s.groupValue=0;s.crew=(s.crew||[]).map(c=>({...c,count:0}));s.hired=[];s.finance=clone(defaultState.finance);s.operations=clone(defaultState.operations);s.saveVersion='2.0.0';globalThis.GH_MIGRATION_CORE?.migrateFleet?.(s);
    return s;
  }
  function foundGroup(state,input,defaultState,helpers={}){
    if(!state||!input)throw new Error('FOUNDING_CONTRACT_INVALID');if(!['2.0.0','3.0.0'].includes(state.saveVersion))throw new Error('FOUNDING_SCHEMA_UNSUPPORTED');
    const formation=globalThis.GH_FORMATION_ENGINE,isPlan=Boolean(formation&&input.schema===formation.SCHEMA);
    if(isPlan)formation.validatePlan(input);
    const identityAssets=isPlan&&input.identity?.identity&&typeof input.identity.identity==='object'?input.identity.identity:{};
    const prepared=isPlan?{
      name:input.identity.legalName,founder:input.founder,shortName:input.identity.shortName,englishName:input.identity.englishName||'',locationId:input.location.id,country:input.location.country,city:input.location.city,capital:Number(input.capital.amount),currency:input.capital.currency||'USD',legalForm:identityAssets.legalForm||'شركة قابضة مساهمة مقفلة',fiscalYear:identityAssets.fiscalYear||'calendar',logo:identityAssets.logo||null,mode:identityAssets.mode||'balanced'
    }:prepareFounding(input);
    const tx=globalThis.GH_TRANSACTION_CORE,C=globalThis.GH_CORPORATE_CORE,F=globalThis.GH_FINANCE_CORE;
    if(!tx?.execute||!C?.execute||!F?.execute)throw new Error('FOUNDING_OWNER_UNAVAILABLE');
    const outcome=(tx.isActive()?tx.join:tx.execute)(state,{label:'new-group',apply:()=>{
    const {capital,...identity}=prepared;
    const profile={...identity,reputation:12,creditRating:'BBB'};
    const stamp=String(helpers.nextId?.('FOUND')||`FOUND-${Date.now()}`).split('-').pop();
    const year=helpers.simYear?.()||new Date().getUTCFullYear();
    const registry={legalName:profile.name,englishName:profile.englishName,legalForm:profile.legalForm,owner:profile.founder,authorizedSignatory:profile.founder,currency:profile.currency,fiscalYear:profile.fiscalYear,taxId:`TAX-GH-${stamp}`,commercialRegistration:`CR-GH-${year}-${stamp}`,formationContract:`INC-GH-${stamp}`,incorporatedAt:Number(state.simSeconds)||0};
    const groupPayload={profile,registry,capital},capitalPayload={capital,ref:registry.formationContract};
    const groupReceipt=typeof helpers.dispatchAuthorized==='function'?helpers.dispatchAuthorized(state,'corporate','found-group',groupPayload,{idempotencyKey:isPlan?`${input.planId}:group`:registry.formationContract}):{result:C.execute({state},'found-group',groupPayload)};
    const capitalReceipt=typeof helpers.dispatchAuthorized==='function'?helpers.dispatchAuthorized(state,'finance','initialize-capital',capitalPayload,{idempotencyKey:isPlan?`${input.planId}:capital`:registry.formationContract}):{result:F.execute({state},'initialize-capital',capitalPayload)};
    const signatureSnapshot=isPlan&&typeof helpers.signatureSnapshot==='function'?helpers.signatureSnapshot(state,input.signature.signatureRef):null;
    state.companyRegistry.group.formationDocument={version:2,id:registry.formationContract,status:'signed',year,signedAt:Number(state.simSeconds)||0,name:profile.name,englishName:profile.englishName,shortName:profile.shortName,founder:profile.founder,country:profile.country,city:profile.city,legalForm:profile.legalForm,currency:'USD',capital,accountId:F.book(state,'group').accounts[0].id,formationPlanId:isPlan?input.planId:null,formationPlanHash:isPlan?input.planHash:null,signature:isPlan?{signatureRef:input.signature.signatureRef,version:input.signature.version,digest:signatureSnapshot?.digest||null}:null,signatureSnapshot:signatureSnapshot||null,authorizationProofIds:[groupReceipt?.authorizationProofId,capitalReceipt?.authorizationProofId].filter(Boolean),articles:FOUNDING_ARTICLES.map(row=>({...row}))};
    state.companyRegistry.group.paidInCapital=capital;
    state.alerts=[`اعتمد عقد ${registry.formationContract} لتأسيس ${profile.name} في ${profile.city}، ${profile.country}.`,`أودع رأس المال ${helpers.fmtMoney?.(capital)||capital} في الحساب الجاري للمجموعة. افتح الشركات التابعة من قسم الشركات.`];
    if(helpers.onCommit)tx.afterCommit(helpers.onCommit,{critical:true,priority:100,key:'save'});
    return {capital,profile,registry,planId:isPlan?input.planId:null};
    }});return outcome.value;
  }
  async function reset(state,defaultState,options={}){const next=pristine(defaultState,options.resetEpoch||Date.now());if(options.prepare)options.prepare(next);return globalThis.GH_PERSISTENCE.replaceState(next,options.checkpoint||state,{...options,apply:()=>globalThis.GH_TRANSACTION_CORE.restoreObject(state,next)});}
  window.GH_GAME_LIFECYCLE={VERSION,FOUNDING_LOCATIONS,FOUNDING_CAPITALS,FOUNDING_ARTICLES,openingArticles,locationFor,prepareFounding,prepareFormationPlan,pristine,foundGroup,reset};
})();

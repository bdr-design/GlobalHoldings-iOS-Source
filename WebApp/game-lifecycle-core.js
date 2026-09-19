(()=>{'use strict';
  const VERSION='3.0.0';
  const FOUNDING_LOCATIONS=Object.freeze([
    {id:'RUH',country:'السعودية',city:'الرياض'},
    {id:'DXB',country:'الإمارات',city:'دبي'},
    {id:'SIN',country:'سنغافورة',city:'سنغافورة'},
    {id:'LON',country:'المملكة المتحدة',city:'لندن'},
    {id:'NYC',country:'الولايات المتحدة',city:'نيويورك'}
  ].map(Object.freeze));
  const FOUNDING_CAPITALS=Object.freeze({balanced:50000000,investor:250000000,sandbox:1000000000});
  const FOUNDING_ARTICLES=Object.freeze([
    Object.freeze({title:'الكيان والملكية',text:'تؤسس مجموعة قابضة مملوكة للمؤسس الوارد في هذا العقد، ويثبت اسمها ومقرها في سجل المجموعة.'}),
    Object.freeze({title:'رأس المال والحسابات',text:'يودع رأس المال المبين كاملًا في الحساب الجاري للمجموعة مرة واحدة عند اعتماد العقد. العملة المحاسبية هي الدولار الأمريكي، والسنة المالية من يناير إلى ديسمبر.'}),
    Object.freeze({title:'الشركات والتشغيل',text:'تؤسس الشركات التابعة لاحقًا بأوامر مستقلة، ولكل شركة حسابها ومشترياتها ونتائجها. لا يمنح هذا العقد أصولًا أو قواعد تشغيلية تلقائيًا.'})
  ]);
  function prepareFounding(input={}){
    const clean=(value,max,required,label)=>{const text=String(value??'').trim().replace(/\s+/g,' ');if((required&&!text)||text.length>max||/[\u0000-\u001f\u007f<>]/.test(text))throw new Error(label);return text;};
    const name=clean(input.name,42,true,'أدخل اسمًا للمجموعة من 1 إلى 42 حرفًا.'),founder=clean(input.founder,32,true,'أدخل اسم المؤسس من 1 إلى 32 حرفًا.');
    const shortName=clean(input.shortName||'GH',4,true,'اختصار المجموعة لا يتجاوز أربعة أحرف.').toUpperCase();
    if(!/^[\p{L}\p{N}]{1,4}$/u.test(shortName))throw new Error('استخدم أحرفًا أو أرقامًا فقط في الاختصار.');
    const location=FOUNDING_LOCATIONS.find(row=>row.id===input.locationId);if(!location)throw new Error('اختر مقرًا من القائمة المعتمدة.');
    if(!Object.prototype.hasOwnProperty.call(FOUNDING_CAPITALS,input.mode))throw new Error('اختر رأس مال من الخيارات المعروضة.');
    const logo=input.logo||null;if(logo&&(typeof logo!=='string'||logo.length>280000||!/^data:image\/(?:webp|png|jpeg);base64,[A-Za-z0-9+/=]+$/.test(logo)))throw new Error('الشعار غير صالح؛ ارفع صورة أخرى.');
    if(!['teal','navy','gold','mono'].includes(input.logoStyle||'teal'))throw new Error('اختر هوية معتمدة للشعار.');
    return {name,founder,shortName,englishName:clean(input.englishName,60,false,'الاسم الإنجليزي لا يتجاوز 60 حرفًا.'),locationId:location.id,country:location.country,city:location.city,mode:input.mode,capital:FOUNDING_CAPITALS[input.mode],currency:'USD',legalForm:'شركة قابضة مساهمة مقفلة',fiscalYear:'calendar',logo,logoStyle:input.logoStyle||'teal'};
  }
  const clone=v=>globalThis.structuredClone?structuredClone(v):JSON.parse(JSON.stringify(v));
  const bankZero=defaults=>({...clone(defaults.bank),branches:0,deposits:0,loans:0,hqla:0,stableFunding:0,requiredStableFunding:0,wholesaleFunding:0,offBalance:0,feeIncomeYTD:0,provisions:0,corporateClients:{},creditFacilities:[],lettersOfCredit:[],guarantees:[],cashSweeps:[],tradeFinance:[],riskReviews:[]});
  function pristine(defaultState,resetEpoch=Date.now()){
    const s=clone(defaultState);
    Object.assign(s,{resetEpoch,saveRevision:1,onboardingComplete:false,speed:0,godMoney:false,infiniteMoney:false,assets:[],unlockedSectors:[],openedCompanies:[],ownedCompanies:[],branches:[],globalBases:[],customHubs:[],customRoutes:[],routeEndpoints:{},routeCache:{},companyRegistry:{},companyFinance:{},contractRegistry:{},constructionContracts:[],commercialTenders:[],supplierTransactions:[],eventLog:[],alerts:[]});
    s.energy={gasMW:0,solarMW:0,windMW:0,storageMWh:0,availability:100};
    s.bank=bankZero(defaultState);s.treasury=clone(defaultState.treasury);for(const a of s.treasury.accounts)a.balance=0;s.cash=0;s.debt=0;s.groupValue=0;s.crew=(s.crew||[]).map(c=>({...c,count:0}));s.hired=[];s.finance=clone(defaultState.finance);s.operations=clone(defaultState.operations);s.saveVersion='2.0.0';
    return s;
  }
  function foundGroup(state,input,defaultState,helpers={}){
    if(!state||!input)throw new Error('FOUNDING_CONTRACT_INVALID');if(state.saveVersion!=='2.0.0')throw new Error('FOUNDING_SCHEMA_UNSUPPORTED');
    const prepared=prepareFounding(input);
    const tx=globalThis.GH_TRANSACTION_CORE,C=globalThis.GH_CORPORATE_CORE,F=globalThis.GH_FINANCE_CORE;
    if(!tx?.execute||!C?.execute||!F?.execute)throw new Error('FOUNDING_OWNER_UNAVAILABLE');
    const outcome=(tx.isActive()?tx.join:tx.execute)(state,{label:'new-group',apply:()=>{
    const {capital,...identity}=prepared;
    const profile={...identity,firstSector:null,riskAppetite:'balanced',procurementPolicy:'competitive',signingAuthority:'board',reputation:12,creditRating:'BBB'};
    const stamp=String(helpers.nextId?.('FOUND')||`FOUND-${Date.now()}`).split('-').pop();
    const year=helpers.simYear?.()||new Date().getUTCFullYear();
    const registry={legalName:profile.name,englishName:profile.englishName,legalForm:profile.legalForm,owner:profile.founder,authorizedSignatory:profile.founder,currency:profile.currency,fiscalYear:profile.fiscalYear,riskAppetite:profile.riskAppetite,procurementPolicy:profile.procurementPolicy,signingAuthority:profile.signingAuthority,taxId:`TAX-GH-${stamp}`,commercialRegistration:`CR-GH-${year}-${stamp}`,formationContract:`INC-GH-${stamp}`,incorporatedAt:Number(state.simSeconds)||0,boardPolicy:'لجنة استثمار ومراجعة للصفقات الكبرى',kycStatus:'مكتمل',beneficialOwner:profile.founder};
    C.execute({state},'found-group',{profile,registry,capital});
    F.execute({state},'initialize-capital',{capital,ref:registry.formationContract});
    state.companyRegistry.group.formationDocument={version:1,id:registry.formationContract,status:'signed',year,signedAt:Number(state.simSeconds)||0,name:profile.name,englishName:profile.englishName,shortName:profile.shortName,founder:profile.founder,country:profile.country,city:profile.city,legalForm:profile.legalForm,currency:'USD',capital,accountId:F.book(state,'group').accounts[0].id,articles:FOUNDING_ARTICLES.map(row=>({...row}))};
    state.companyRegistry.group.paidInCapital=capital;
    state.alerts=[`اعتمد عقد ${registry.formationContract} لتأسيس ${profile.name} في ${profile.city}، ${profile.country}.`,`أودع رأس المال ${helpers.fmtMoney?.(capital)||capital} في الحساب الجاري للمجموعة. افتح الشركات التابعة من قسم الشركات.`];
    state.saveVersion='2.0.0';
    if(helpers.onCommit)tx.afterCommit(helpers.onCommit,{critical:true,priority:100,key:'save'});
    return {capital,profile,registry};
    }});return outcome.value;
  }
  async function reset(state,defaultState,options={}){const next=pristine(defaultState,options.resetEpoch||Date.now());if(options.prepare)options.prepare(next);return globalThis.GH_PERSISTENCE.replaceState(next,options.checkpoint||state,{...options,apply:()=>globalThis.GH_TRANSACTION_CORE.restoreObject(state,next)});}
  window.GH_GAME_LIFECYCLE={VERSION,FOUNDING_LOCATIONS,FOUNDING_CAPITALS,FOUNDING_ARTICLES,prepareFounding,pristine,foundGroup,reset};
})();

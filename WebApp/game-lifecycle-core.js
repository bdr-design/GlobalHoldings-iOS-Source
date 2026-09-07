(()=>{'use strict';
  const VERSION='2.9.0';
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
    const tx=globalThis.GH_TRANSACTION_CORE,C=globalThis.GH_CORPORATE_CORE,F=globalThis.GH_FINANCE_CORE;
    if(!tx?.execute||!C?.execute||!F?.execute)throw new Error('FOUNDING_OWNER_UNAVAILABLE');
    const outcome=(tx.isActive()?tx.join:tx.execute)(state,{label:'new-group',apply:()=>{
    const mode=input.mode||'balanced',firstSector=input.firstSector||'air';
    const capital={realistic:10000000,balanced:50000000,investor:250000000,sandbox:1000000000}[mode]||50000000;
    const profile={name:input.name||defaultState.profile.name,shortName:(input.shortName||'GH').slice(0,4),founder:input.founder||'المؤسس',englishName:input.englishName||'Global Holdings Group',country:input.country,city:input.city,firstSector,mode,legalForm:input.legalForm||'شركة قابضة مساهمة مقفلة',currency:input.currency||'USD',fiscalYear:input.fiscalYear||'calendar',riskAppetite:input.riskAppetite||'balanced',procurementPolicy:input.procurementPolicy||'competitive',signingAuthority:input.signingAuthority||'board',reputation:12,creditRating:'BBB',logo:input.logo||null,logoStyle:input.logoStyle||'teal'};
    const stamp=String(helpers.nextId?.('FOUND')||`FOUND-${Date.now()}`).split('-').pop();
    const year=helpers.simYear?.()||new Date().getUTCFullYear();
    const registry={legalName:profile.name,englishName:profile.englishName,legalForm:profile.legalForm,owner:profile.founder,authorizedSignatory:profile.founder,currency:profile.currency,fiscalYear:profile.fiscalYear,riskAppetite:profile.riskAppetite,procurementPolicy:profile.procurementPolicy,signingAuthority:profile.signingAuthority,taxId:`TAX-GH-${stamp}`,commercialRegistration:`CR-GH-${year}-${stamp}`,formationContract:`INC-GH-${stamp}`,incorporatedAt:Number(state.simSeconds)||0,boardPolicy:'لجنة استثمار ومراجعة للصفقات الكبرى',kycStatus:'مكتمل',beneficialOwner:profile.founder};
    C.execute({state},'found-group',{profile,registry,capital});
    F.execute({state},'initialize-capital',{capital,ref:registry.formationContract});
    state.alerts=[`تأسست ${profile.name} في ${profile.city}. القطاع الأول المخطط: ${helpers.typeName?.(firstSector)||firstSector}.`,`رأس المال الابتدائي ${helpers.fmtMoney?.(capital)||capital} والتصنيف الائتماني BBB. افتح الشركة ثم أضف الأصول والقواعد بنفسك.`];
    state.saveVersion='2.0.0';
    if(helpers.onCommit)tx.afterCommit(helpers.onCommit,{critical:true,priority:100,key:'save'});
    return {capital,profile,registry};
    }});return outcome.value;
  }
  async function reset(state,defaultState,options={}){const next=pristine(defaultState,options.resetEpoch||Date.now());if(options.prepare)options.prepare(next);return globalThis.GH_PERSISTENCE.replaceState(next,options.checkpoint||state,{...options,apply:()=>globalThis.GH_TRANSACTION_CORE.restoreObject(state,next)});}
  window.GH_GAME_LIFECYCLE={VERSION,pristine,foundGroup,reset};
})();

(()=>{
  'use strict';

  const VERSION='3.0.0-build334';
  const num=value=>Math.max(0,Number(value)||0),now=state=>Number(state.simSeconds)||0;
  const object=value=>!!value&&typeof value==='object'&&!Array.isArray(value);
  const platform=()=>{const api=globalThis.GH_COMPANY_PLATFORM;if(!api?.requireCompany)throw new Error('company-platform-missing');return api;};
  const identity=()=>globalThis.GH_IDENTITY||null;
  const COMPANY_TYPES=Object.freeze(platform().companyIds({includeGroup:false}));

  function checkedText(value,code,maximum,{minimum=1,allowEmpty=false}={}){
    const raw=typeof value==='string'?value:String(value??''),inspected=identity()?.inspectPlainText?.(raw,{minimum,maximum,allowEmpty});
    if(inspected){if(!inspected.ok)throw new Error(code);return inspected.text;}
    const text=raw.trim();if((!text&&!allowEmpty)||text.length<minimum||text.length>maximum||/[<>\u0000-\u001f\u007f\u202a-\u202e\u2066-\u2069]/u.test(text))throw new Error(code);return text;
  }
  function checkedLogo(value){
    if(value==null||value==='')return null;const inspector=identity()?.inspectCustomLogo;if(typeof inspector!=='function')throw new Error('identity-logo-validator-missing');const result=inspector(value);if(!result.ok)throw new Error(`invalid-company-logo:${result.reason}`);return String(value);
  }
  function checkedIdentifier(value,code='invalid-company-identifier'){
    const text=checkedText(value??'',code,180,{minimum:0,allowEmpty:true});if(/"/.test(text))throw new Error(code);return text;
  }
  function validateFoundingIdentity(payload={}){
    const profile=object(payload.profile)?payload.profile:{},registry=object(payload.registry)?payload.registry:{};checkedText(profile.name,'founding-identity-invalid',120);if(profile.shortName!=null&&profile.shortName!=='')checkedText(profile.shortName,'founding-short-name-invalid',28);if(registry.legalName!=null&&registry.legalName!=='')checkedText(registry.legalName,'founding-identity-invalid',120);if(registry.shortName!=null&&registry.shortName!=='')checkedText(registry.shortName,'founding-short-name-invalid',28);if(profile.logo!=null)checkedLogo(profile.logo);if(registry.logo!=null)checkedLogo(registry.logo);return true;
  }

  function ensure(state){
    state.companyRegistry=object(state.companyRegistry)?state.companyRegistry:{};
    state.openedCompanies=Array.isArray(state.openedCompanies)?state.openedCompanies:[];
    state.unlockedSectors=Array.isArray(state.unlockedSectors)?state.unlockedSectors:[];
    state.stakes=object(state.stakes)?state.stakes:{};state.maDeals=object(state.maDeals)?state.maDeals:{};
    state.advanced=object(state.advanced)?state.advanced:{};
    state.advanced.companies=object(state.advanced.companies)?state.advanced.companies:{};
    state.advanced.groupManagement=object(state.advanced.groupManagement)?state.advanced.groupManagement:{};
    const group=state.advanced.groupManagement;delete group.plan;
    group.history=Array.isArray(group.history)?group.history:[];return state;
  }
  function model(state,companyId){
    ensure(state);const current=state.advanced.companies[companyId]||(state.advanced.companies[companyId]={});
    for(const legacy of ['budget','growthTarget','capitalPlan','customerScore','management','riskLimit'])delete current[legacy];
    current.serviceLevel=Math.max(0,Math.min(100,Number(current.serviceLevel)||0));current.automation=Math.max(0,Math.min(100,Number(current.automation)||0));current.lastDecision=num(current.lastDecision);
    current.upgradeCooldowns=object(current.upgradeCooldowns)?current.upgradeCooldowns:{};current.history=Array.isArray(current.history)?current.history:[];
    return current;
  }
  function companyIdOf(payload={}){return String(payload.companyId||payload.type||'').trim();}
  function financeSupports(finance,state,companyId,definition=null){
    if(typeof finance?.supportsCompany==='function'){
      if(finance.supportsCompany(state,companyId)===true)return true;
      // During admission a new instance is intentionally not registered yet.
      // A generic dynamic finance adapter may admit its definition here; the
      // provisional record is created only inside the enclosing transaction.
      return Boolean(definition?.capabilities?.includes('finance.book'));
    }
    return Array.isArray(finance?.TYPES)&&finance.TYPES.includes(companyId);
  }
  function planOpenCompany(state,payload={}){
    const companyId=companyIdOf(payload),plan=platform().planInstance(state,{companyId,definitionId:payload.definitionId}),definition=plan.definition,capital=num(payload.capital??definition.founding.defaultCapital);
    if(definition.kind!=='subsidiary'||definition.lifecycle!=='active')throw new Error('company-definition-not-openable');
    if(capital<Number(definition.founding.minimumCapital||0))throw new Error('company-capital-below-minimum');
    const existing=plan.existing||{};
    const branded=platform().brandedIdentity?.(state,companyId)||null,legalName=checkedText(String(payload.legalName||payload.name||existing.legalName||branded?.legalName||definition.identity.legalDefault.ar||definition.identity.legalDefault.en),'invalid-company-name',120),shortName=checkedText(String(payload.shortName||existing.shortName||branded?.shortName||definition.identity.short),'invalid-company-short-name',28),identifiers={};for(const key of ['taxId','commercialRegistration','businessLicense','formationContract'])identifiers[key]=checkedIdentifier(payload[key]??existing[key]??'',`invalid-company-${key}`);
    if(Object.prototype.hasOwnProperty.call(payload,'logo'))checkedLogo(payload.logo);
    return {companyId,definition,capital,existing,metadata:plan.metadata,legalName,shortName,identifiers};
  }
  function validate(ctx,command,payload={}){
    const state=ctx.state||ctx,companyId=companyIdOf(payload);
    try{
      if(command==='found-group')validateFoundingIdentity(payload);
      if(command==='open-company'){
        if(state.openedCompanies?.includes(companyId))return true;
        const plan=planOpenCompany(state,payload),finance=globalThis.GH_FINANCE_CORE;
        if(!financeSupports(finance,state,'group',platform().getDefinition('group'))||!financeSupports(finance,state,companyId,plan.definition))return {ok:false,reason:`finance-company-adapter-missing:${companyId}`};
      }
      if(command==='rename-company')checkedText(String(payload.legalName||''),'invalid-company-name',60);
      if(command==='set-logo')checkedLogo(payload.logo);
      if(['decision','rename-company','set-logo'].includes(command))platform().requireCompany(state,companyId,{registered:true,operational:command!=='rename-company'&&command!=='set-logo'});
      if(command==='unlock-sector'&&!platform().isKnownSector(payload.sectorId||payload.type))return {ok:false,reason:'sector-not-found'};
      return true;
    }catch(error){return {ok:false,reason:String(error?.message||error)};}
  }
  function execute(ctx,command,payload={}){
    const state=ctx.state||ctx;ensure(state);
    if(command==='found-group'){
      if(state.onboardingComplete)throw new Error('group-already-founded');
      if(!payload.profile?.name||!payload.registry?.formationContract)throw new Error('founding-identity-invalid');validateFoundingIdentity(payload);
      const definition=platform().getDefinition('group'),metadata=platform().instanceMetadata('group',definition);
      state.profile={...payload.profile};state.companyRegistry={group:{...payload.registry,...metadata,status:'active',legalName:payload.registry.legalName||payload.profile.name,shortName:payload.registry.shortName||payload.profile.shortName||definition.identity.short}};state.groupValue=num(payload.capital);
      state.openedCompanies=[];state.unlockedSectors=[];state.ownedCompanies=[];state.stakes={};state.maDeals={};state.onboardingComplete=true;
      return {profile:state.profile,registry:state.companyRegistry.group};
    }
    if(command==='open-company'){
      const companyId=companyIdOf(payload);if(state.openedCompanies.includes(companyId))return state.companyRegistry[companyId];
      const plan=planOpenCompany(state,payload),finance=globalThis.GH_FINANCE_CORE;if(!finance?.execute||!finance?.book)throw new Error('finance-core-missing');
      if(!financeSupports(finance,state,'group',platform().getDefinition('group'))||!financeSupports(finance,state,companyId,plan.definition))throw new Error(`finance-company-adapter-missing:${companyId}`);
      // Register the legal instance before funding so the finance owner can create
      // a book for an arbitrary definition-backed company. The surrounding domain
      // transaction rolls this provisional record back if funding or validation fails.
      const existing=plan.existing||{},provisional={...existing,...plan.metadata,status:'forming',legalName:plan.legalName,shortName:plan.shortName,owner:payload.owner||existing.owner||state.profile?.name||'المجموعة',authorizedSignatory:payload.authorizedSignatory||existing.authorizedSignatory||state.profile?.founder||'المؤسس'};
      state.companyRegistry[companyId]=provisional;
      finance.execute({state},'transfer',{from:'group',to:companyId,amount:plan.capital,note:payload.note||`رأس مال مدفوع لتأسيس ${plan.legalName}`});
      state.openedCompanies.push(companyId);for(const sectorId of plan.definition.classification.sectorIds)if(!state.unlockedSectors.includes(sectorId))state.unlockedSectors.push(sectorId);
      const logo=Object.prototype.hasOwnProperty.call(payload,'logo')?checkedLogo(payload.logo):checkedLogo(existing.logo);
      const record={...existing,...plan.metadata,status:'active',legalName:plan.legalName,shortName:plan.shortName,owner:payload.owner||existing.owner||state.profile?.name||'المجموعة',authorizedSignatory:payload.authorizedSignatory||existing.authorizedSignatory||state.profile?.founder||'المؤسس',logo:logo??null,legalForm:payload.legalForm||existing.legalForm||plan.definition.founding.legalForm,currency:payload.currency||existing.currency||plan.definition.finance.currency||state.profile?.currency||'USD',...plan.identifiers,incorporatedAt:existing.incorporatedAt??now(state),paidInCapital:num(existing.paidInCapital)+plan.capital,budget:existing.budget??plan.capital,financeBookId:companyId,bankAccount:finance.book(state,companyId).accounts[0].id,documentPrefix:existing.documentPrefix||plan.metadata.documentPrefix,accountPrefix:existing.accountPrefix||plan.metadata.accountPrefix,incorporationChecklist:Array.isArray(payload.incorporationChecklist)?payload.incorporationChecklist:(Array.isArray(existing.incorporationChecklist)?existing.incorporationChecklist:[...plan.definition.founding.checklistIds]),invoiceSequence:Math.max(1,Number(existing.invoiceSequence)||1),invoices:Array.isArray(existing.invoices)?existing.invoices:(Array.isArray(payload.invoices)?payload.invoices:[])};
      state.companyRegistry[companyId]=record;platform().syncBrandedNames?.(state);model(state,companyId);return record;
    }
    if(command==='rename-company'){
      const companyId=companyIdOf(payload),name=checkedText(String(payload.legalName||''),'invalid-company-name',60),record=platform().requireCompany(state,companyId,{registered:true}).record,oldName=record?.legalName;
      record.legalName=name;if(companyId==='group'&&state.profile)state.profile.name=name;
      // A renamed subsidiary keeps its own name; a renamed group re-brands every subsidiary that follows it.
      if(companyId!=='group'){record.customName=true;delete record.tradeName;}else{platform().syncBrandedNames?.(state);for(const id of Object.keys(state.companyRegistry||{}))if(id!=='group'&&state.companyRegistry[id]?.customName===false)globalThis.GH_FINANCE_CORE?.execute?.({state},'refresh-identity',{company:id});}
      if(state.bank?.corporateClients?.[companyId])state.bank.corporateClients[companyId].name=name;globalThis.GH_FINANCE_CORE?.execute?.({state},'refresh-identity',{company:companyId});return record;
    }
    if(command==='set-logo'){
      const companyId=companyIdOf(payload),record=platform().requireCompany(state,companyId,{registered:true}).record;if(!record)throw new Error('company-not-found');const logo=checkedLogo(payload.logo);record.logo=logo;if(companyId==='group'&&state.profile)state.profile.logo=logo;globalThis.GH_FINANCE_CORE?.execute?.({state},'refresh-identity',{company:companyId});return record;
    }
    if(command==='unlock-sector'){
      const requested=String(payload.sectorId||payload.type||''),sectorId=platform().normalizeSectorId?.(requested)||requested;if(!platform().isKnownSector(sectorId))throw new Error('sector-not-found');if(!state.unlockedSectors.includes(sectorId))state.unlockedSectors.push(sectorId);return [...state.unlockedSectors];
    }
    if(command==='adjust-group-value'){const delta=Number(payload.delta)||0;state.groupValue=Math.max(0,(Number(state.groupValue)||0)+delta);return state.groupValue;}
    if(command==='set-credit-rating'){state.profile=state.profile||{};state.profile.creditRating=String(payload.grade||'BBB');return state.profile.creditRating;}
    // The annual general meeting: how shareholders read the year moves the credit rating score for a year (GH_REALISM updateRating).
    // A fleet company's maintenance policy: the condition at which an asset gets its check (GH_REALISM runMaintenance).
    if(command==='set-maintenance-policy'){const companyId=companyIdOf(payload),policy=String(payload.policy||'');if(!['preventive','standard','deferred'].includes(policy))throw new Error('maintenance-policy-invalid');if(!(state.openedCompanies||[]).includes(companyId))throw new Error('company-not-open');const company=model(state,companyId);company.maintenancePolicy=policy;return {companyId,policy};}
    // A fleet company's insurance cover: none, standard (10% deductible) or full (2%) (GH_REALISM runIncidents).
    if(command==='set-insurance-cover'){const companyId=companyIdOf(payload),cover=String(payload.cover||'');if(!['none','standard','full'].includes(cover))throw new Error('insurance-cover-invalid');if(!(state.openedCompanies||[]).includes(companyId))throw new Error('company-not-open');const company=model(state,companyId);company.insuranceCover=cover;return {companyId,cover};}
    if(command==='record-agm'){state.profile=state.profile||{};state.profile.agm={year:Math.floor(Number(payload.year)||0),day:Math.max(0,Math.floor(Number(payload.day)||0)),ratingAdjust:Math.max(-6,Math.min(6,Math.round(Number(payload.ratingAdjust)||0)))};return {...state.profile.agm};}
    if(command==='set-reputation'){state.profile=state.profile||{};state.profile.reputation=Math.max(0,Math.min(100,Number(payload.value)||0));return state.profile.reputation;}
    if(command==='set-ipo'){state.ipo={listed:!!payload.listed,ticker:String(payload.ticker||'GH').toUpperCase()};return state.ipo;}
    if(command==='decision'){
      const companyId=companyIdOf(payload),company=model(state,companyId),action=payload.action,allowed=new Set(['company-service','company-automation']);if(!allowed.has(action))throw new Error('obsolete-or-unknown-company-decision');const cost=num(payload.cost),finance=globalThis.GH_FINANCE_CORE;
      if(cost)finance.execute({state},'spend',{company:companyId,amount:cost,note:`قرار ${action} · ${state.companyRegistry[companyId]?.legalName||companyId}`,method:'تحويل بنكي',line:'other'});
      if(action==='company-service')company.serviceLevel=Math.min(100,company.serviceLevel+5);if(action==='company-automation')company.automation=Math.min(100,company.automation+8);if(['company-service','company-automation'].includes(action))company.upgradeCooldowns[action]=now(state);
      company.lastDecision=now(state);company.history.unshift({at:now(state),action});company.history=company.history.slice(0,50);return company;
    }
    throw new Error(`Unknown corporate command: ${command}`);
  }

  const API=Object.freeze({VERSION,COMPANY_TYPES,ensure,model,planOpenCompany,validate,execute});
  globalThis.GH_CORPORATE_CORE=API;globalThis.GH_DOMAIN_COMMANDS?.register?.('corporate',API);
  if(globalThis.window&&window!==globalThis)globalThis.window.GH_CORPORATE_CORE=API;
  if(typeof module!=='undefined'&&module.exports)module.exports=API;
})();

(()=>{'use strict';
  const VERSION='3.0.0';
  const clone=v=>globalThis.structuredClone?structuredClone(v):JSON.parse(JSON.stringify(v));
  function migrateCompanyPlatform(input){
    if(!input||typeof input!=='object'||Array.isArray(input))throw new Error('MIGRATION_COMPANY_STATE_INVALID');
    const platform=globalThis.GH_COMPANY_PLATFORM;if(!platform?.migrateState)return {state:clone(input),changed:false,errors:[],warnings:['company-platform-unavailable']};
    return platform.migrateState(input);
  }
  function load(options={}){
    const {defaultState,storageKey,legacyStorageKeys=[],resetMarkerKey,saveSchema}=options;
    if(!defaultState||!storageKey||!saveSchema?.validate)throw new Error('MIGRATION_LOAD_CONTRACT_INVALID');
    const nativeRaw=typeof globalThis.__GH_NATIVE_SAVE_JSON__==='string'&&globalThis.__GH_NATIVE_SAVE_JSON__.length?globalThis.__GH_NATIVE_SAVE_JSON__:null;
    let raw=nativeRaw||localStorage.getItem(storageKey),migratedLegacyKey=null,source=nativeRaw?'native':'current';
    if(!raw){migratedLegacyKey=legacyStorageKeys.find(k=>localStorage.getItem(k))||null;if(migratedLegacyKey){raw=localStorage.getItem(migratedLegacyKey);source='legacy';}}
    if(!raw){const pristine=globalThis.GH_GAME_LIFECYCLE?.pristine?globalThis.GH_GAME_LIFECYCLE.pristine(defaultState,0):clone(defaultState),companyUpgrade=migrateCompanyPlatform(pristine);return {state:saveSchema.normalize(companyUpgrade.state,defaultState),source:'default',migratedLegacyKey:null,needsCanonicalPersist:false};}
    // Validate the actual persisted root before merging defaults or normalizing.
    // A corrupt/future save remains untouched for recovery or explicit export.
    let saved;try{saved=JSON.parse(raw);}catch{throw new Error('MIGRATION_JSON_INVALID');}
    if(nativeRaw)try{delete globalThis.__GH_NATIVE_SAVE_JSON__;}catch{globalThis.__GH_NATIVE_SAVE_JSON__=null;}
    const schemaUpgrade=saveSchema.migrateLegacy?.(saved)||{state:saved,changed:false},companyUpgrade=migrateCompanyPlatform(schemaUpgrade.state),legacyUpgrade={state:companyUpgrade.state,changed:schemaUpgrade.changed===true||companyUpgrade.changed===true};saved=legacyUpgrade.state;
    const validation=saveSchema.validate(saved);
    if(!validation.ok)throw new Error(`MIGRATION_SAVE_REJECTED:${validation.errors.join(',')}`);
    // Native Save Vault already enforces resetEpoch/revision ordering. The browser
    // marker is compatibility metadata only and must not reject an authoritative native save.
    const resetEpoch=source==='native'?0:(resetMarkerKey?Number(localStorage.getItem(resetMarkerKey)||0):0);
    if(resetEpoch&&Number(saved.resetEpoch||0)<resetEpoch)throw new Error('MIGRATION_RESET_EPOCH_CONFLICT');
    const state=saveSchema.normalize({...clone(defaultState),...saved},defaultState);
    let needsCanonicalPersist=false;
    if(source==='native'){
      needsCanonicalPersist=legacyUpgrade.changed;
    }else if(migratedLegacyKey||legacyUpgrade.changed){
      const persistence=globalThis.GH_PERSISTENCE;if(!persistence?.writeState)throw new Error('MIGRATION_PERSISTENCE_UNAVAILABLE');
      const out=persistence.writeState(storageKey,state);if(!out.ok)throw new Error(`MIGRATION_CANONICAL_WRITE_FAILED:${out.reason}`);
      if(localStorage.getItem(storageKey)!==out.json)throw new Error('MIGRATION_READBACK_FAILED');
      if(migratedLegacyKey)localStorage.removeItem(migratedLegacyKey);
    }
    return {state,source,migratedLegacyKey,needsCanonicalPersist};
  }
  function structural(state,defaultState){
    if(!state||typeof state!=='object'||Array.isArray(state))throw new Error('MIGRATION_STATE_INVALID');
    const arrayKeys=['assets','unlockedSectors','openedCompanies','ownedCompanies','hired','acceptedContracts','failedBids','branches','globalBases','customHubs','customRoutes','leasedAssets','eventLog','alerts','constructionContracts','commercialTenders','supplierTransactions','insurancePolicies'];
    for(const key of arrayKeys){if(!Array.isArray(state[key]))state[key]=clone(defaultState[key]||[]);else state[key]=state[key].filter(Boolean);}
    const objectKeys=['stakes','maDeals','contractStartDays','portfolio','portfolioBook','routeEndpoints','routeCache','companyRegistry','companyModules','companyFinance','contractRegistry','governance','research','esg','ipo'];
    for(const key of objectKeys)if(!state[key]||typeof state[key]!=='object'||Array.isArray(state[key]))state[key]=clone(defaultState[key]||{});
    if(!state.profile||typeof state.profile!=='object')state.profile=clone(defaultState.profile);
    if(!state.energy||typeof state.energy!=='object')state.energy=clone(defaultState.energy);
    if(!state.bank||typeof state.bank!=='object')state.bank=clone(defaultState.bank);
    if(!state.treasury||typeof state.treasury!=='object')state.treasury=clone(defaultState.treasury);
    if(!state.operations||typeof state.operations!=='object')state.operations=clone(defaultState.operations);
    if(!state.finance||typeof state.finance!=='object')state.finance=clone(defaultState.finance);
    if(state.saveVersion!=='2.0.0')throw new Error('MIGRATION_SCHEMA_UNSUPPORTED');
    return state;
  }
  const COMPANY_METRIC_FIELDS=Object.freeze(['sectorProfitToday','tripProfitAccrued','tripRevenueAccrued','tripFuelAccrued','tripMaintenanceAccrued','tripCountAccrued','lastClosedSectorProfit']);
  function canonicalMetricInstances(state,companyPlatform){
    if(companyPlatform?.listInstances){
      const books=state.companyFinance&&typeof state.companyFinance==='object'&&!Array.isArray(state.companyFinance)?state.companyFinance:{};
      return companyPlatform.listInstances(state,{includeGroup:false}).filter(instance=>instance?.known&&instance.definition?.capabilities?.includes('finance.book')&&(instance.registered===true||instance.opened===true||Object.prototype.hasOwnProperty.call(books,instance.id)));
    }
    const ids=[...(Array.isArray(state.openedCompanies)?state.openedCompanies:[]),...Object.keys(state.companyRegistry||{}),...Object.keys(state.companyFinance||{})].map(String).filter(id=>id&&id!=='group');
    return [...new Set(ids)].map(id=>({id,known:true,registered:true,definition:null}));
  }
  function normalizeCompanyMetricMaps(state,companyPlatform){
    const instances=canonicalMetricInstances(state,companyPlatform),companyIds=new Set(instances.map(instance=>instance.id)),bySector=new Map();
    for(const instance of instances)for(const sector of instance.definition?.classification?.sectorIds||[]){const id=String(sector||'').trim();if(!id)continue;const rows=bySector.get(id)||[];rows.push(instance.id);bySector.set(id,rows);}
    const normalize=(source,label)=>{
      source=source&&typeof source==='object'&&!Array.isArray(source)?source:{};const result=Object.fromEntries([...companyIds].map(id=>[id,0]));
      for(const [rawKey,rawValue] of Object.entries(source)){
        const key=String(rawKey||'').trim(),value=Number(rawValue);if(!key||!Number.isFinite(value))throw new Error(`MIGRATION_COMPANY_METRIC_VALUE_INVALID:${label}:${key||'empty'}`);
        if(companyIds.has(key)){result[key]+=value;continue;}
        const sector=String(companyPlatform?.normalizeSectorId?.(key)||key),owners=bySector.get(sector)||[];
        if(owners.length===1){result[owners[0]]+=value;continue;}
        // Empty Build 332/333 placeholders for companies/sectors that were not
        // founded are not books and may be discarded.  Any value with no
        // unique owner is stopped before the live state is mutated.
        if(value===0)continue;
        if(owners.length>1)throw new Error(`MIGRATION_COMPANY_METRIC_AMBIGUOUS:${label}:${key}:${owners.join(',')}`);
        throw new Error(`MIGRATION_COMPANY_METRIC_OWNER_UNKNOWN:${label}:${key}`);
      }
      return result;
    };
    const normalized={};for(const field of COMPANY_METRIC_FIELDS)normalized[field]=normalize(state[field],field);
    return normalized;
  }
  function completeBusinessState(state,{defaultState,initialStocks,crewRolesSeed}){
  const companyPlatform=globalThis.GH_COMPANY_PLATFORM,companyMetricMaps=normalizeCompanyMetricMaps(state,companyPlatform);
  // قائمة أصول فارغة بعد تأسيس لاعب جديد حالة صحيحة، وليست تلفًا يحتاج إعادة أسطول تجريبي.
  if (!Array.isArray(state.assets)) state.assets = [];
  if (!Array.isArray(state.market)) state.market = clone(initialStocks);
  if (!Array.isArray(state.crew) || !state.crew.length) state.crew = clone(crewRolesSeed).map(role=>({...role,count:0}));
  if (!state.stakes) state.stakes = {};
  if (!state.maDeals||typeof state.maDeals!=='object') state.maDeals={};
  if (!state.portfolioBook || typeof state.portfolioBook!=='object') state.portfolioBook={};
  if (!state.contractStartDays) state.contractStartDays = {};
  for(const field of COMPANY_METRIC_FIELDS)state[field]=companyMetricMaps[field];
  state.lastClosedProfit=Number(state.lastClosedProfit)||0;
  if (!state.profile) state.profile = clone(defaultState.profile);
  if (!Array.isArray(state.unlockedSectors)) state.unlockedSectors = ['air','sea','road','power','bank'];
  if (!Array.isArray(state.openedCompanies)) state.openedCompanies=clone(state.unlockedSectors);
  if (!Array.isArray(state.eventLog)) state.eventLog = [];
  if (!state.energy) state.energy=clone(defaultState.energy);
  if (!state.bank) state.bank=clone(defaultState.bank);
  // Compatibility migration for older saves: normalize corporate-banking books without changing balances.
  const bankDefaults=clone(defaultState.bank);Object.entries(bankDefaults).forEach(([k,v])=>{if(state.bank[k]===undefined)state.bank[k]=clone(v);});
  ['creditFacilities','lettersOfCredit','guarantees','cashSweeps','tradeFinance','riskReviews'].forEach(k=>{if(!Array.isArray(state.bank[k]))state.bank[k]=[];});if(!state.bank.corporateClients||typeof state.bank.corporateClients!=='object'||Array.isArray(state.bank.corporateClients))state.bank.corporateClients={};

  if (!state.treasury||!Array.isArray(state.treasury.accounts)||!Array.isArray(state.treasury.ledger)) state.treasury=clone(defaultState.treasury);
  if (!Array.isArray(state.treasury.paymentQueue)) state.treasury.paymentQueue=[];
  while(state.treasury.accounts.length<3)state.treasury.accounts.push(clone(defaultState.treasury.accounts[state.treasury.accounts.length]));
  // Treasury stores the holding company's accounts. Consolidated cash also
  // includes subsidiary accounts; copying it into treasury would double count.
  if (!state.operations) state.operations=clone(defaultState.operations);
  if (!state.companyRegistry || typeof state.companyRegistry!=='object' || Array.isArray(state.companyRegistry)) state.companyRegistry={};
  if (!state.companyModules || typeof state.companyModules!=='object' || Array.isArray(state.companyModules)) state.companyModules={};
  if(!Array.isArray(state.constructionContracts))state.constructionContracts=[];if(!Array.isArray(state.commercialTenders))state.commercialTenders=[];if(!Array.isArray(state.supplierTransactions))state.supplierTransactions=[];
  if (!state.contractRegistry || typeof state.contractRegistry!=='object' || Array.isArray(state.contractRegistry)) state.contractRegistry={};
  if (!state.finance || !Array.isArray(state.finance.invoices)) state.finance=clone(defaultState.finance);
  ['payables','receivables','cheques','periods','payrollReports'].forEach(k=>{if(!Array.isArray(state.finance[k]))state.finance[k]=[];});
  if(!state.finance.paymentSequence)state.finance.paymentSequence=1;
    return state;
  }
  window.GH_MIGRATION_CORE={VERSION,load,structural,completeBusinessState,migrateCompanyPlatform};
})();

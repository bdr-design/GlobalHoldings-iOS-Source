(()=>{'use strict';
  const VERSION='2.9.1';
  const clone=v=>globalThis.structuredClone?structuredClone(v):JSON.parse(JSON.stringify(v));
  function load(options={}){
    const {defaultState,storageKey,legacyStorageKeys=[],resetMarkerKey,saveSchema}=options;
    if(!defaultState||!storageKey||!saveSchema?.validate)throw new Error('MIGRATION_LOAD_CONTRACT_INVALID');
    let raw=localStorage.getItem(storageKey),migratedLegacyKey=null;
    if(!raw){migratedLegacyKey=legacyStorageKeys.find(k=>localStorage.getItem(k))||null;if(migratedLegacyKey)raw=localStorage.getItem(migratedLegacyKey);}
    if(!raw)return {state:saveSchema.normalize(globalThis.GH_GAME_LIFECYCLE?.pristine?globalThis.GH_GAME_LIFECYCLE.pristine(defaultState,0):clone(defaultState),defaultState),source:'default',migratedLegacyKey:null};
    // Validate the actual persisted root before merging defaults or normalizing.
    // A corrupt/future save remains untouched for recovery or explicit export.
    let saved;try{saved=JSON.parse(raw);}catch{throw new Error('MIGRATION_JSON_INVALID');}
    const validation=saveSchema.validate(saved);
    if(!validation.ok)throw new Error(`MIGRATION_SAVE_REJECTED:${validation.errors.join(',')}`);
    const resetEpoch=resetMarkerKey?Number(localStorage.getItem(resetMarkerKey)||0):0;
    if(resetEpoch&&Number(saved.resetEpoch||0)<resetEpoch)throw new Error('MIGRATION_RESET_EPOCH_CONFLICT');
    const state=saveSchema.normalize({...clone(defaultState),...saved},defaultState);
    if(migratedLegacyKey){
      const persistence=globalThis.GH_PERSISTENCE;if(!persistence?.writeState)throw new Error('MIGRATION_PERSISTENCE_UNAVAILABLE');
      const out=persistence.writeState(storageKey,state);if(!out.ok)throw new Error(`MIGRATION_CANONICAL_WRITE_FAILED:${out.reason}`);
      if(localStorage.getItem(storageKey)!==out.json)throw new Error('MIGRATION_READBACK_FAILED');
      localStorage.removeItem(migratedLegacyKey);
    }
    return {state,source:migratedLegacyKey?'legacy':'current',migratedLegacyKey};
  }
  function structural(state,defaultState){
    if(!state||typeof state!=='object'||Array.isArray(state))throw new Error('MIGRATION_STATE_INVALID');
    const arrayKeys=['assets','unlockedSectors','openedCompanies','ownedCompanies','hired','acceptedContracts','failedBids','branches','globalBases','customHubs','customRoutes','leasedAssets','eventLog','alerts','constructionContracts','commercialTenders','supplierTransactions','insurancePolicies'];
    for(const key of arrayKeys){if(!Array.isArray(state[key]))state[key]=clone(defaultState[key]||[]);else state[key]=state[key].filter(Boolean);}
    const objectKeys=['stakes','maDeals','contractStartDays','portfolio','portfolioBook','routeEndpoints','routeCache','companyRegistry','companyFinance','contractRegistry','governance','research','esg','ipo'];
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
  function completeBusinessState(state,{defaultState,initialStocks,crewRolesSeed}){
  // قائمة أصول فارغة بعد تأسيس لاعب جديد حالة صحيحة، وليست تلفًا يحتاج إعادة أسطول تجريبي.
  if (!Array.isArray(state.assets)) state.assets = [];
  if (!Array.isArray(state.market)) state.market = clone(initialStocks);
  if (!Array.isArray(state.crew) || !state.crew.length) state.crew = clone(crewRolesSeed).map(role=>({...role,count:0}));
  if (!state.stakes) state.stakes = {};
  if (!state.maDeals||typeof state.maDeals!=='object') state.maDeals={};
  if (!state.portfolioBook || typeof state.portfolioBook!=='object') state.portfolioBook={};
  if (!state.contractStartDays) state.contractStartDays = {};
  if (!state.sectorProfitToday) state.sectorProfitToday = {air:0,sea:0,road:0,power:0,bank:0,mobility:0};
  state.sectorProfitToday.mobility=Number(state.sectorProfitToday.mobility)||0;
  if(!state.tripProfitAccrued||typeof state.tripProfitAccrued!=='object')state.tripProfitAccrued={air:0,sea:0,road:0,power:0,bank:0,mobility:0};
  for(const t of ['air','sea','road','power','bank','mobility'])state.tripProfitAccrued[t]=Number(state.tripProfitAccrued[t])||0;
  if(!state.tripRevenueAccrued||typeof state.tripRevenueAccrued!=='object')state.tripRevenueAccrued={air:0,sea:0,road:0,power:0,bank:0};
  for(const t of ['air','sea','road','power','bank'])state.tripRevenueAccrued[t]=Number(state.tripRevenueAccrued[t])||0;
  if(!state.tripFuelAccrued||typeof state.tripFuelAccrued!=='object')state.tripFuelAccrued={air:0,sea:0,road:0,power:0,bank:0};
  if(!state.tripMaintenanceAccrued||typeof state.tripMaintenanceAccrued!=='object')state.tripMaintenanceAccrued={air:0,sea:0,road:0,power:0,bank:0};
  if(!state.tripCountAccrued||typeof state.tripCountAccrued!=='object')state.tripCountAccrued={air:0,sea:0,road:0,power:0,bank:0};
  for(const t of ['air','sea','road','power','bank']){state.tripFuelAccrued[t]=Number(state.tripFuelAccrued[t])||0;state.tripMaintenanceAccrued[t]=Number(state.tripMaintenanceAccrued[t])||0;state.tripCountAccrued[t]=Number(state.tripCountAccrued[t])||0;}
  if(!state.lastClosedSectorProfit||typeof state.lastClosedSectorProfit!=='object')state.lastClosedSectorProfit={air:0,sea:0,road:0,power:0,bank:0};
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
  if(!Array.isArray(state.constructionContracts))state.constructionContracts=[];if(!Array.isArray(state.commercialTenders))state.commercialTenders=[];if(!Array.isArray(state.supplierTransactions))state.supplierTransactions=[];
  if (!state.contractRegistry || typeof state.contractRegistry!=='object' || Array.isArray(state.contractRegistry)) state.contractRegistry={};
  if (!state.finance || !Array.isArray(state.finance.invoices)) state.finance=clone(defaultState.finance);
  ['payables','receivables','cheques','periods'].forEach(k=>{if(!Array.isArray(state.finance[k]))state.finance[k]=[];});
  if(!state.finance.paymentSequence)state.finance.paymentSequence=1;
    return state;
  }
  window.GH_MIGRATION_CORE={VERSION,load,structural,completeBusinessState};
})();

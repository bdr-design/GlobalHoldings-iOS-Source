(()=>{'use strict';
  const VERSION='3.0.0';
  const clone=v=>globalThis.structuredClone?structuredClone(v):JSON.parse(JSON.stringify(v));
  // JSON object key insertion order is not part of the asset schema. Compare
  // canonical JSON values so migration accepts the store's stable physical
  // materialization order without losing or changing any field values.
  function canonicalJSON(value){
    const jsonValue=JSON.parse(JSON.stringify(value));
    const sort=item=>Array.isArray(item)?item.map(sort):item&&typeof item==='object'?Object.fromEntries(Object.keys(item).sort().map(key=>[key,sort(item[key])])):item;
    return JSON.stringify(sort(jsonValue));
  }
  const fleetData=()=>{const api=globalThis.GH_FLEET_DATA||(typeof require==='function'?require('./fleet-access-core.js'):null);if(!api)throw new Error('fleet-data-access-unavailable');return api;};
  const fleetStore=()=>{const api=globalThis.GH_FLEET_STORE||(typeof require==='function'?require('./fleet-store-core.js'):null);if(!api)throw new Error('fleet-store-unavailable');return api;};
  const SAVE_V2='2.0.0',SAVE_V3='3.0.0';
  function migrateDeliveryAndCrewBatches(state){
    const procurement=state.realism?.procurement,deliveries=Array.isArray(procurement?.deliveries)?procurement.deliveries:null;if(!deliveries)return false;
    const alreadyBatched=deliveries.every(row=>row.deliveryOrderId===row.id&&Array.isArray(row?.assets)&&row.count===row.assets.length&&Array.isArray(row.assetIds)&&row.assetIds.length===row.assets.length&&!Object.prototype.hasOwnProperty.call(row,'asset')&&row.assets.every((asset,index)=>asset?.id===row.assetIds[index]&&asset.deliveryOrderId===row.id&&asset.baseFacility===row.baseId))&&Number(procurement.pendingDeliveryCount)===deliveries.filter(row=>row?.status==='pending').length;
    const existingContracts=state.advanced?.labor?.employmentContracts||[],contractsBatched=existingContracts.every(contract=>contract?.automaticAssetStaffing!==true||Array.isArray(contract.assetIds)&&contract.deliveryOrderId&&contract.assetCount===contract.assetIds.length),hiringBatched=(state.advanced?.labor?.hiringLog||[]).every(row=>!row?.source?.includes('أصل آلي ثابت')||row.deliveryOrderId&&Array.isArray(row.assetIds));
    if(alreadyBatched&&contractsBatched&&hiringBatched)return false;
    const fleet=fleetData(),prepared=[],groups=new Map(),assetToOrder=new Map();let changed=false;
    for(const source of deliveries){
      const row={...source},legacyAsset=row.asset,assets=Array.isArray(row.assets)?row.assets.slice():legacyAsset?[legacyAsset]:[];
      if(!assets.length&&row.assetId){const live=fleet.get(state,row.assetId);if(live)assets.push(fleet.plain(live));}
      if(legacyAsset){delete row.asset;changed=true;}
      const explicitOrder=String(row.deliveryOrderId||row.id||''),paymentRef=String(row.payment?.ref||row.paymentRef||''),batchKey=row.requestRef&&paymentRef?JSON.stringify(['legacy-purchase',row.status,row.requestRef,row.baseId,paymentRef,row.ownerCompanyId||'',row.assetMode||row.type||'',row.catalogId||'',Number(row.orderedAtSeconds)||0]):row.deliveryOrderId?`delivery:${row.deliveryOrderId}`:`receipt:${row.id}`;
      const canGroup=assets.length>0,prior=canGroup?groups.get(batchKey):null;
      if(prior){prior.rows.push({row,assets});continue;}
      const entry={key:batchKey,rows:[{row,assets}],explicitOrder,canGroup};prepared.push(entry);if(canGroup)groups.set(batchKey,entry);
    }
    const normalized=[];
    for(const entry of prepared){
      const first=entry.rows[0].row,allAssets=entry.rows.flatMap(part=>part.assets),complete=entry.rows.every(part=>part.assets.length>0),shouldMerge=entry.rows.length>1&&complete;
      if(shouldMerge){
        const id=String(first.deliveryOrderId||first.id),assets=[];
        const seenAssets=new Set();for(const sourceAsset of allAssets){if(seenAssets.has(sourceAsset.id))throw new Error(`MIGRATION_DELIVERY_ASSET_DUPLICATE:${id}:${sourceAsset.id}`);seenAssets.add(sourceAsset.id);const asset=sourceAsset.deliveryOrderId===id&&sourceAsset.baseFacility===first.baseId?sourceAsset:{...sourceAsset,deliveryOrderId:id,baseFacility:sourceAsset.baseFacility||first.baseId};assets.push(asset);assetToOrder.set(asset.id,id);}
        const row={...first,id,deliveryOrderId:id,assets,count:assets.length,assetIds:assets.map(asset=>asset.id),purchasePrice:assets.reduce((sum,asset)=>sum+(Number(asset.purchasePrice)||0),0)};delete row.asset;normalized.push(row);changed=true;
      }else{
        const {row:sourceRow,assets:sourceAssets}=entry.rows[0],row={...sourceRow},id=String(row.deliveryOrderId||row.id||''),assets=sourceAssets.map(sourceAsset=>{if(sourceAsset.deliveryOrderId===id&&sourceAsset.baseFacility===row.baseId)return sourceAsset;return {...sourceAsset,deliveryOrderId:id,baseFacility:sourceAsset.baseFacility||row.baseId};});if(row.deliveryOrderId!==id){row.deliveryOrderId=id;changed=true;}
        if(assets.length){if(!Array.isArray(row.assets)||row.count!==assets.length||!Array.isArray(row.assetIds)||row.assetIds.length!==assets.length){row.assets=assets;row.count=assets.length;row.assetIds=assets.map(asset=>asset.id);changed=true;}else if(assets.some((asset,index)=>asset!==row.assets[index]))row.assets=assets;delete row.asset;if(sourceRow.asset)changed=true;for(const asset of assets)assetToOrder.set(asset.id,id);}
        normalized.push(row);
      }
    }
    const labor=state.advanced?.labor,contracts=Array.isArray(labor?.employmentContracts)?labor.employmentContracts:null,contractDrafts=contracts?.map(contract=>({...contract,...(Array.isArray(contract?.assetIds)?{assetIds:contract.assetIds.slice()}:{})}))||null;
    if(contractDrafts){const candidates=new Map();for(const contract of contractDrafts){if(contract?.automaticAssetStaffing!==true||contract.status!=='ساري')continue;const ids=Array.isArray(contract.assetIds)?contract.assetIds:[contract.assetId],order=String(contract.deliveryOrderId||ids.map(id=>assetToOrder.get(id)).find(Boolean)||'');if(!order)continue;const key=JSON.stringify([order,contract.ownerCompanyId||contract.company||'']);const rows=candidates.get(key)||[];rows.push({contract,ids});candidates.set(key,rows);}
      const remove=new Set();for(const rows of candidates.values()){const valid=rows.filter(row=>row.ids.length);if(valid.length<2)continue;const canonical=valid[0].contract,assetIds=[...new Set(valid.flatMap(row=>row.ids))];if(assetIds.length!==valid.reduce((sum,row)=>sum+row.ids.length,0))throw new Error(`MIGRATION_CREW_ASSET_DUPLICATE:${canonical.deliveryOrderId||canonical.id}`);const originalIds=new Set(valid.map(row=>row.contract.id));for(const row of valid)if(row.contract!==canonical)remove.add(row.contract.id);canonical.deliveryOrderId=String(canonical.deliveryOrderId||assetToOrder.get(assetIds[0]));canonical.assetIds=assetIds;canonical.assetId=assetIds[0];canonical.assetCount=assetIds.length;canonical.count=valid.reduce((sum,row)=>sum+(Number(row.contract.count)||0),0);canonical.salary=valid.reduce((sum,row)=>sum+(Number(row.contract.salary)||0),0);const receipt=normalized.find(row=>row.id===canonical.deliveryOrderId);if(receipt){const first=receipt.assets?.[0];if(first)canonical.name=`طاقم ثابت · ${first.name}${assetIds.length>1?` + ${assetIds.length-1}`:''}`;}
        for(const id of assetIds){const asset=fleet.get(state,id);if(asset&&originalIds.has(asset.staffing?.contractId)&&asset.staffing.contractId!==canonical.id)fleet.update(state,asset,{staffing:{...asset.staffing,contractId:canonical.id}});}changed=true;}
      if(remove.size)for(let index=contractDrafts.length-1;index>=0;index--)if(remove.has(contractDrafts[index]?.id))contractDrafts.splice(index,1);
      const hiring=Array.isArray(labor.hiringLog)?labor.hiringLog:null,hiringDraft=hiring?.map(row=>({...row,...(Array.isArray(row?.assetIds)?{assetIds:row.assetIds.slice()}:{})}))||null;if(hiringDraft){const hireGroups=new Map(),removeHiring=new Set();for(const row of hiringDraft){if(row?.assetId===undefined)continue;const order=String(row.deliveryOrderId||assetToOrder.get(row.assetId)||'');if(!order)continue;const key=JSON.stringify([order,row.company||'']);const rows=hireGroups.get(key)||[];rows.push(row);hireGroups.set(key,rows);}for(const rows of hireGroups.values())if(rows.length>1){const first=rows[0];first.deliveryOrderId=String(first.deliveryOrderId||assetToOrder.get(first.assetId));first.assetIds=[...new Set(rows.flatMap(row=>Array.isArray(row.assetIds)?row.assetIds:[row.assetId]).filter(id=>id!==undefined))];first.total=rows.reduce((sum,row)=>sum+(Number(row.total)||0),0);first.monthlyPayroll=rows.reduce((sum,row)=>sum+(Number(row.monthlyPayroll)||0),0);for(const row of rows.slice(1))removeHiring.add(row.id);delete first.assetId;changed=true;}if(removeHiring.size)for(let index=hiringDraft.length-1;index>=0;index--)if(removeHiring.has(hiringDraft[index]?.id))hiringDraft.splice(index,1);if(changed)labor.hiringLog=hiringDraft;}
      if(changed)labor.employmentContracts=contractDrafts;
    }
    if(normalized.length!==deliveries.length||changed)procurement.deliveries=normalized;
    const pending=normalized.reduce((count,row)=>count+(row?.status==='pending'?1:0),0);if(procurement.pendingDeliveryCount!==pending){procurement.pendingDeliveryCount=pending;changed=true;}
    return changed;
  }
  function migrateFleet(state){
    const STORE=fleetStore(),assets=Array.isArray(state.assets)?state.assets:null,existing=STORE.isStore(state.fleet),saveVersion=state.saveVersion;
    if(saveVersion!==undefined&&saveVersion!==SAVE_V2&&saveVersion!==SAVE_V3)throw new Error('MIGRATION_SCHEMA_UNSUPPORTED');
    if(existing&&assets)throw new Error('MIGRATION_FLEET_SOURCE_CONFLICT');
    let changed=false,nextStore=existing?state.fleet:null;
    if(assets){
      const at=Math.max(0,Number(state.simSeconds)||0),next=STORE.fromAssets(assets,{at});
      for(let row=0;row<assets.length;row++)if(canonicalJSON(STORE.materialize(next,row))!==canonicalJSON(assets[row]))throw new Error(`MIGRATION_FLEET_FIELD_MISMATCH:${row}`);
      STORE.buildIndex(next);nextStore=next;
    }else if(!existing){
      if(state.fleet!==undefined&&state.fleet!==null)throw new Error('MIGRATION_FLEET_STORE_INVALID');
      nextStore=STORE.create();
    }else STORE.buildIndex(state.fleet);
    const candidate={...state,fleet:nextStore};
    if(state.realism?.procurement)candidate.realism={...state.realism,procurement:{...state.realism.procurement}};
    if(state.advanced?.labor)candidate.advanced={...state.advanced,labor:{...state.advanced.labor}};
    const batchesChanged=migrateDeliveryAndCrewBatches(candidate);
    if(assets){state.fleet=nextStore;delete state.assets;changed=true;}else if(!existing){state.fleet=nextStore;changed=true;}
    if(batchesChanged){state.realism=candidate.realism;state.advanced=candidate.advanced;changed=true;}
    if(state.saveVersion===SAVE_V2||state.saveVersion===undefined){state.saveVersion=SAVE_V3;changed=true;}
    if(state.saveVersion!==SAVE_V3)throw new Error('MIGRATION_SCHEMA_UNSUPPORTED');
    if(Object.prototype.hasOwnProperty.call(state,'assets')){delete state.assets;changed=true;}
    return {state,changed};
  }
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
    if(!raw){const pristine=globalThis.GH_GAME_LIFECYCLE?.pristine?globalThis.GH_GAME_LIFECYCLE.pristine(defaultState,0):clone(defaultState),companyUpgrade=migrateCompanyPlatform(pristine),fleetUpgrade=migrateFleet(companyUpgrade.state);return {state:saveSchema.normalize(fleetUpgrade.state,defaultState),source:'default',migratedLegacyKey:null,needsCanonicalPersist:false};}
    // Validate the actual persisted root before merging defaults or normalizing.
    // A corrupt/future save remains untouched for recovery or explicit export.
    let saved;try{saved=JSON.parse(raw);if(globalThis.GH_STATE_CODEC?.decodeState)saved=globalThis.GH_STATE_CODEC.decodeState(saved);}catch{throw new Error('MIGRATION_JSON_INVALID');}
    if(nativeRaw)try{delete globalThis.__GH_NATIVE_SAVE_JSON__;}catch{globalThis.__GH_NATIVE_SAVE_JSON__=null;}
    const currentFleet=globalThis.GH_FLEET_STORE?.isStore?.(saved.fleet)===true&&saved.saveVersion===SAVE_V3,
      schemaUpgrade=currentFleet?{state:saved,changed:false}:(saveSchema.migrateLegacy?.(saved)||{state:saved,changed:false}),
      // A current store may contain a 128 MB ArrayBuffer. Company migration
      // is an upgrade for legacy saves only; cloning a current v3 root here
      // would duplicate the fleet before ordinary load normalization.
      companyUpgrade=currentFleet?{state:schemaUpgrade.state,changed:false}:migrateCompanyPlatform(schemaUpgrade.state),
      fleetUpgrade=migrateFleet(companyUpgrade.state),legacyUpgrade={state:fleetUpgrade.state,changed:schemaUpgrade.changed===true||companyUpgrade.changed===true||fleetUpgrade.changed===true};saved=legacyUpgrade.state;
    const validation=saveSchema.validate(saved);
    if(!validation.ok)throw new Error(`MIGRATION_SAVE_REJECTED:${validation.errors.join(',')}`);
    // Native Save Vault already enforces resetEpoch/revision ordering. The browser
    // marker is compatibility metadata only and must not reject an authoritative native save.
    const resetEpoch=source==='native'?0:(resetMarkerKey?Number(localStorage.getItem(resetMarkerKey)||0):0);
    if(resetEpoch&&Number(saved.resetEpoch||0)<resetEpoch)throw new Error('MIGRATION_RESET_EPOCH_CONFLICT');
    const merged={...clone(defaultState),...saved};
    // Build 357 must never let an array-mode default leak into a migrated v3
    // save. Otherwise the normalized root has both `assets` and `fleet`, and
    // the next canonical write is rejected as a mixed representation.
    if(fleetStore().isStore(merged.fleet))delete merged.assets;
    const state=saveSchema.normalize(merged,defaultState);
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
    const arrayKeys=['unlockedSectors','openedCompanies','ownedCompanies','hired','acceptedContracts','failedBids','branches','globalBases','customHubs','customRoutes','leasedAssets','eventLog','alerts','constructionContracts','commercialTenders','supplierTransactions','insurancePolicies'];
    for(const key of arrayKeys){if(!Array.isArray(state[key]))state[key]=clone(defaultState[key]||[]);else state[key]=state[key].filter(Boolean);}
    migrateFleet(state);state.routesRevision=Math.max(0,Math.floor(Number(state.routesRevision)||0));
    const objectKeys=['stakes','maDeals','contractStartDays','portfolio','portfolioBook','routeEndpoints','routeCache','companyRegistry','companyModules','companyFinance','contractRegistry','governance','research','esg','ipo'];
    for(const key of objectKeys)if(!state[key]||typeof state[key]!=='object'||Array.isArray(state[key]))state[key]=clone(defaultState[key]||{});
    if(!state.profile||typeof state.profile!=='object')state.profile=clone(defaultState.profile);
    if(!state.energy||typeof state.energy!=='object')state.energy=clone(defaultState.energy);
    if(!state.bank||typeof state.bank!=='object')state.bank=clone(defaultState.bank);
    if(!state.treasury||typeof state.treasury!=='object')state.treasury=clone(defaultState.treasury);
    if(!state.operations||typeof state.operations!=='object')state.operations=clone(defaultState.operations);
    if(!state.finance||typeof state.finance!=='object')state.finance=clone(defaultState.finance);
    if(state.saveVersion!==SAVE_V3)throw new Error('MIGRATION_SCHEMA_UNSUPPORTED');
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
  fleetData().ensure(state);
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
  window.GH_MIGRATION_CORE={VERSION,load,structural,completeBusinessState,migrateCompanyPlatform,migrateFleet};
})();

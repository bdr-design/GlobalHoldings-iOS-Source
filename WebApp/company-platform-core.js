(()=>{
  'use strict';

  const VERSION='GH-COMPANY-PLATFORM-1.0.0';
  const STATE_SCHEMA='gh-company-platform-state/v1';
  const STATE_SCHEMA_VERSION=1;
  const MINIMUM_DYNAMIC_COMPANY_BUILD=334;
  const ID=/^[A-Za-z][A-Za-z0-9]*(?:[._-][A-Za-z0-9]+)*$/;
  const DEFINITION_ID=/^[a-z][a-z0-9]*(?:[.-][a-z0-9]+)*$/;
  const PREFIX=/^[A-Z0-9][A-Z0-9-]{1,19}$/;
  const COLOR=/^#[0-9a-f]{6}$/i;
  const ASSET_PATH=/^assets\/[A-Za-z0-9_./-]+$/;
  const source=globalThis.GH_COMPANY_DEFINITIONS;
  const capabilityRegistry=globalThis.GH_CAPABILITY_REGISTRY;
  if(!source?.list)throw new Error('company-definitions-missing');
  if(!capabilityRegistry?.validate)throw new Error('capability-registry-missing');

  const definitionsById=new Map(),definitionsByDefinitionId=new Map(),aliases=new Map(),sectorAliases=new Map(),origins=new Map();
  let sealed=false;
  const object=value=>!!value&&typeof value==='object'&&!Array.isArray(value);
  const clone=value=>{
    if(value===undefined)return undefined;
    if(typeof globalThis.structuredClone==='function')try{return globalThis.structuredClone(value);}catch(_error){}
    return JSON.parse(JSON.stringify(value));
  };
  const deepFreeze=value=>{
    if(!value||typeof value!=='object'||Object.isFrozen(value))return value;
    for(const child of Object.values(value))deepFreeze(child);
    return Object.freeze(value);
  };
  const unique=rows=>[...new Set((Array.isArray(rows)?rows:[]).map(value=>String(value||'').trim()).filter(Boolean))];
  const validId=value=>ID.test(String(value||''));
  const validDefinitionId=value=>DEFINITION_ID.test(String(value||''));
  const validDataId=value=>DEFINITION_ID.test(String(value||''));
  const same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);

  function validateDefinition(definition){
    const errors=[];
    if(!object(definition))return {ok:false,errors:['definition-not-object']};
    const id=String(definition.id||''),definitionId=String(definition.definitionId||'');
    if(definition.schema!==source.FORMAT)errors.push(`definition-schema:${id||'unknown'}`);
    if(!validDefinitionId(id))errors.push(`definition-id:${id||'empty'}`);
    if(!validDefinitionId(definitionId))errors.push(`definition-versioned-id:${definitionId||'empty'}`);
    if(!Number.isSafeInteger(Number(definition.definitionVersion))||Number(definition.definitionVersion)<1)errors.push(`definition-version:${id}`);
    if(!Number.isFinite(Number(definition.order)))errors.push(`definition-order:${id}`);
    if(!['holding','subsidiary'].includes(definition.kind))errors.push(`definition-kind:${id}`);
    if(!['active','deprecated','disabled'].includes(definition.lifecycle))errors.push(`definition-lifecycle:${id}`);
    if(definition.instancePolicy!==undefined){const policy=definition.instancePolicy;if(!object(policy)||!['multi','canonical-only'].includes(policy.mode)||!['company','legacy-root'].includes(policy.stateScope)||(policy.mode==='canonical-only'&&policy.stateScope!=='legacy-root'))errors.push(`definition-instance-policy:${id}`);}
    const identity=definition.identity;
    if(!object(identity)||!String(identity?.legalDefault?.ar||'').trim()||!String(identity?.legalDefault?.en||'').trim()||!String(identity?.trade?.ar||'').trim()||!String(identity?.trade?.en||'').trim()||!String(identity?.short||'').trim())errors.push(`definition-identity:${id}`);
    if(!object(identity?.marks)||!ASSET_PATH.test(String(identity.marks.default||'')))errors.push(`definition-mark-default:${id}`);
    for(const path of Object.values(object(identity?.marks)?identity.marks:{}))if(!ASSET_PATH.test(String(path||'')))errors.push(`definition-mark:${id}`);
    if(!ASSET_PATH.test(String(identity?.hero||'')))errors.push(`definition-hero:${id}`);
    if(!object(identity?.palette)||['accent','secondary','route','onAccent'].some(key=>!COLOR.test(String(identity.palette[key]||''))))errors.push(`definition-palette:${id}`);
    const classification=definition.classification;
    if(!object(classification)||!validDataId(classification?.primarySectorId)||!validDataId(classification?.operationProfileId))errors.push(`definition-classification:${id}`);
    for(const [key,rows] of Object.entries({sectorIds:classification?.sectorIds,assetClasses:classification?.assetClasses,routeModes:classification?.routeModes})){
      if(!Array.isArray(rows)||rows.some(value=>!validDataId(value))||unique(rows).length!==rows.length)errors.push(`definition-${key}:${id}`);
    }
    if(Array.isArray(classification?.sectorIds)&&!classification.sectorIds.includes(classification.primarySectorId))errors.push(`definition-primary-sector:${id}`);
    const capabilityCheck=capabilityRegistry.validate(definition.capabilities);if(!capabilityCheck.ok)errors.push(...capabilityCheck.errors.map(error=>`${id}:${error}`));
    if(!object(definition.founding)||!Number.isFinite(Number(definition.founding.defaultCapital))||Number(definition.founding.defaultCapital)<0||!Number.isFinite(Number(definition.founding.minimumCapital))||Number(definition.founding.minimumCapital)<0||Number(definition.founding.defaultCapital)<Number(definition.founding.minimumCapital)||!Array.isArray(definition.founding.checklistIds)||definition.founding.checklistIds.some(value=>!validDataId(value))||unique(definition.founding.checklistIds).length!==definition.founding.checklistIds.length)errors.push(`definition-founding:${id}`);
    if(!object(definition.finance)||!PREFIX.test(String(definition.finance.accountPrefix||''))||!PREFIX.test(String(definition.finance.documentPrefix||''))||!validDataId(definition.finance.collectionProfileId))errors.push(`definition-finance:${id}`);
    if(!object(definition.hr)||!validDataId(definition.hr.managerRoleProfileId)||!validDataId(definition.hr.staffingProfileId))errors.push(`definition-hr:${id}`);
    if(!object(definition.facilities)||!Array.isArray(definition.facilities.directoryProviderIds)||definition.facilities.directoryProviderIds.some(value=>!validDataId(value))||!Array.isArray(definition.facilities.allowedKinds)||definition.facilities.allowedKinds.some(value=>!validDataId(value))||(definition.facilities.primaryKind!=null&&!definition.facilities.allowedKinds.includes(definition.facilities.primaryKind)))errors.push(`definition-facilities:${id}`);
    const siteTemplate=definition.facilities?.siteTemplate,usesCapitalDirectory=definition.facilities?.directoryProviderIds?.includes('world-capitals');
    if(usesCapitalDirectory||siteTemplate!==undefined){
      const facilityKind=String(siteTemplate?.facilityKind||''),cost=Number(siteTemplate?.cost),dailyCost=Number(siteTemplate?.dailyCost),deliveryCapacity=Number(siteTemplate?.deliveryCapacity),groupValueFactor=Number(siteTemplate?.groupValueFactor);
      if(!object(siteTemplate)||!String(siteTemplate.label||'').trim()||!definition.facilities.allowedKinds.includes(facilityKind)||facilityKind!==definition.facilities.primaryKind||!Number.isFinite(cost)||cost<=0||!Number.isFinite(dailyCost)||dailyCost<0||!String(siteTemplate.capacity||'').trim()||!Number.isSafeInteger(deliveryCapacity)||deliveryCapacity<0||!ASSET_PATH.test(String(siteTemplate.photo||''))||!validDataId(siteTemplate.iconKey)||!Number.isFinite(groupValueFactor)||groupValueFactor<0||groupValueFactor>1)errors.push(`definition-facility-site-template:${id}`);
    }
    if(!object(definition.ui)||!validDataId(definition.ui.shell)||!Array.isArray(definition.ui.tabs)||definition.ui.tabs.some(value=>!validDataId(value))||!Array.isArray(definition.ui.extensions)||definition.ui.extensions.some(value=>!validDataId(value)))errors.push(`definition-ui:${id}`);
    if(!object(definition.map)||!Array.isArray(definition.map.layerProviderIds)||definition.map.layerProviderIds.some(value=>!validDataId(value))||!validDataId(definition.map.filterGroup))errors.push(`definition-map:${id}`);
    if(!object(definition.conference)||!validDataId(definition.conference.providerId)||!Number.isFinite(Number(definition.conference.order)))errors.push(`definition-conference:${id}`);
    if(!object(definition.adapters))errors.push(`definition-adapters:${id}`);else for(const [kind,adapterId] of Object.entries(definition.adapters))if(!capabilityRegistry.ADAPTER_KINDS.includes(kind)||!validDataId(adapterId))errors.push(`definition-adapter:${id}:${kind}`);
    const legacy=definition.legacy,companyAliases=legacy?.companyAliases,sectorAliases=legacy?.sectorAliases,assetOwnerModes=legacy?.assetOwnerModes,routeOwnerModes=legacy?.routeOwnerModes;
    if(
      !object(legacy)
      ||!Array.isArray(companyAliases)||companyAliases.some(value=>!validId(value))||unique(companyAliases).length!==companyAliases.length||companyAliases.some(value=>value===id||value===definitionId)
      ||!Array.isArray(sectorAliases)||sectorAliases.some(value=>!validDataId(value)||classification?.sectorIds?.includes(value))||unique(sectorAliases).length!==sectorAliases.length
      ||!Array.isArray(assetOwnerModes)||assetOwnerModes.some(value=>!validDataId(value)||!classification?.assetClasses?.includes(legacy?.assetClassByMode?.[value]))||unique(assetOwnerModes).length!==assetOwnerModes.length
      ||!Array.isArray(routeOwnerModes)||routeOwnerModes.some(value=>!validDataId(value)||!classification?.routeModes?.includes(value))||unique(routeOwnerModes).length!==routeOwnerModes.length
      ||!object(legacy?.assetClassByMode)||Object.entries(legacy.assetClassByMode).some(([mode,assetClass])=>!validDataId(mode)||!validDataId(assetClass)||!assetOwnerModes?.includes(mode)||!classification?.assetClasses?.includes(assetClass))
    )errors.push(`definition-legacy:${id}`);
    return {ok:errors.length===0,errors:[...new Set(errors)]};
  }
  function assertCrossDefinitionIntegrity(candidate,ignoreId=null){
    const errors=[],candidateAliases=unique(candidate.legacy?.companyAliases);
    for(const definition of definitionsById.values()){
      if(definition.id===ignoreId)continue;
      if(definition.id===candidate.id)errors.push(`company-id-duplicate:${candidate.id}`);
      if(definition.definitionId===candidate.definitionId)errors.push(`definition-id-duplicate:${candidate.definitionId}`);
      if(definition.finance.accountPrefix===candidate.finance.accountPrefix)errors.push(`account-prefix-duplicate:${candidate.finance.accountPrefix}`);
      if(definition.finance.documentPrefix===candidate.finance.documentPrefix)errors.push(`document-prefix-duplicate:${candidate.finance.documentPrefix}`);
      const occupied=new Set([definition.id,definition.definitionId,...unique(definition.legacy?.companyAliases)]);
      for(const alias of [candidate.id,candidate.definitionId,...candidateAliases])if(occupied.has(alias))errors.push(`definition-alias-collision:${alias}`);
      for(const mode of candidate.legacy.assetOwnerModes)if(definition.legacy.assetOwnerModes.includes(mode))errors.push(`legacy-owner-mode-duplicate:asset:${mode}`);
      for(const mode of candidate.legacy.routeOwnerModes)if(definition.legacy.routeOwnerModes.includes(mode))errors.push(`legacy-owner-mode-duplicate:route:${mode}`);
      const existingCanonical=new Set(definition.classification.sectorIds),candidateCanonical=new Set(candidate.classification.sectorIds);
      for(const alias of candidate.legacy.sectorAliases)if(existingCanonical.has(alias))errors.push(`sector-alias-canonical-collision:${alias}`);
      for(const alias of definition.legacy.sectorAliases)if(candidateCanonical.has(alias))errors.push(`sector-alias-canonical-collision:${alias}`);
      for(const alias of candidate.legacy.sectorAliases)if(definition.legacy.sectorAliases.includes(alias)&&definition.classification.primarySectorId!==candidate.classification.primarySectorId)errors.push(`sector-alias-duplicate:${alias}`);
    }
    if(errors.length)throw new Error(errors.join(','));
  }
  function installDefinition(raw,options={}){
    if(sealed)throw new Error('company-platform-sealed');
    const definition=clone(raw),validation=validateDefinition(definition);
    if(!validation.ok)throw new Error(`company-definition-invalid:${validation.errors.join(',')}`);
    const existing=definitionsById.get(definition.id)||definitionsByDefinitionId.get(definition.definitionId);
    if(existing){if(same(existing,definition))return existing;throw new Error(`company-definition-conflict:${definition.id}`);}
    assertCrossDefinitionIntegrity(definition);
    const candidateAliases=unique(definition.legacy?.companyAliases),candidateSectorAliases=unique(definition.legacy?.sectorAliases);
    for(const alias of candidateAliases)if(aliases.has(alias)||definitionsById.has(alias)||definitionsByDefinitionId.has(alias))throw new Error(`company-alias-duplicate:${alias}`);
    for(const alias of candidateSectorAliases){const owner=sectorAliases.get(alias);if(owner&&owner!==definition.classification.primarySectorId)throw new Error(`sector-alias-duplicate:${alias}`);}
    const frozen=deepFreeze(definition);definitionsById.set(frozen.id,frozen);definitionsByDefinitionId.set(frozen.definitionId,frozen);origins.set(frozen.id,String(options.source||'extension'));
    for(const alias of candidateAliases)aliases.set(alias,frozen.id);
    for(const alias of candidateSectorAliases)sectorAliases.set(alias,frozen.classification.primarySectorId);
    return frozen;
  }
  function installDefinitions(rows,options={}){
    if(!Array.isArray(rows))throw new Error('company-definitions-not-array');
    const before={definitionsById:[...definitionsById],definitionsByDefinitionId:[...definitionsByDefinitionId],aliases:[...aliases],sectorAliases:[...sectorAliases],origins:[...origins]};
    try{return rows.map(row=>installDefinition(row,options));}
    catch(error){
      for(const [target,entries] of [[definitionsById,before.definitionsById],[definitionsByDefinitionId,before.definitionsByDefinitionId],[aliases,before.aliases],[sectorAliases,before.sectorAliases],[origins,before.origins]]){target.clear();for(const [key,value] of entries)target.set(key,value);}
      throw error;
    }
  }
  function listDefinitions(options={}){
    const includeGroup=options.includeGroup!==false,lifecycle=String(options.lifecycle||'');
    return [...definitionsById.values()].filter(definition=>(includeGroup||definition.kind!=='holding')&&(!lifecycle||definition.lifecycle===lifecycle)).sort((a,b)=>Number(a.order)-Number(b.order)||a.id.localeCompare(b.id));
  }
  function getDefinition(id){
    id=String(id||'').trim();const resolved=aliases.get(id)||id;
    return definitionsById.get(resolved)||definitionsByDefinitionId.get(resolved)||null;
  }
  function normalizeSectorId(id){id=String(id||'').trim();return sectorAliases.get(id)||id;}
  function getInstancePolicy(stateOrCompanyId,maybeCompanyId){const withState=object(stateOrCompanyId),definition=withState?definitionFor(stateOrCompanyId,maybeCompanyId):getDefinition(stateOrCompanyId),raw=definition?.instancePolicy;return raw?{mode:raw.mode,stateScope:raw.stateScope}:{mode:'multi',stateScope:'company'};}
  function instanceAllowed(state,companyId,definition=definitionFor(state,companyId)){const policy=definition?.instancePolicy;if(!definition)return false;return policy?.mode!=='canonical-only'||String(companyId||'')===definition.id;}
  function companyIds(options={}){return listDefinitions(options).map(definition=>definition.id);}
  function listByCapability(capabilityId,options={}){return listDefinitions(options).filter(definition=>definition.capabilities.includes(String(capabilityId||'')));}
  function isKnownCompany(companyId,state=null){return !!(state?definitionFor(state,companyId):getDefinition(companyId));}
  function isKnownSector(sectorId){sectorId=normalizeSectorId(sectorId);return listDefinitions().some(definition=>definition.classification.sectorIds.includes(sectorId));}
  function isKnownRouteMode(routeMode){routeMode=String(routeMode||'');return listDefinitions().some(definition=>definition.classification.routeModes.includes(routeMode));}
  function isKnownAssetClass(assetClassId){assetClassId=String(assetClassId||'');return listDefinitions().some(definition=>definition.classification.assetClasses.includes(assetClassId));}
  function recordFor(state,companyId){
    if(!object(state))return null;companyId=String(companyId||'');
    if(object(state.companyRegistry?.[companyId]))return state.companyRegistry[companyId];
    if(companyId==='group'&&object(state.profile))return state.profile;
    return null;
  }
  function definitionFor(state,companyId){
    companyId=String(companyId||'').trim();const record=recordFor(state,companyId),definitionId=String(record?.definitionId||record?.templateId||'').trim();
    // An explicit saved definition is authoritative. Falling back to a built-in
    // company id here would silently reinterpret a newer/unknown definition as
    // an older engine and allow writes against an incompatible save.
    return definitionId?getDefinition(definitionId):getDefinition(companyId);
  }
  function resolveCompany(state,companyId){
    companyId=String(companyId||'').trim();if(!companyId)return null;
    const record=recordFor(state,companyId),definition=definitionFor(state,companyId),opened=companyId==='group'?Boolean(state?.onboardingComplete||state?.companyRegistry?.group):Boolean(state?.openedCompanies?.includes(companyId)),versionAhead=Boolean(definition&&Number(record?.definitionVersion)>Number(definition.definitionVersion)),policyBlocked=Boolean(definition&&!instanceAllowed(state,companyId,definition));
    const orphan=!definition,held=record?.quarantine?.readOnly===true||record?.platformStatus==='definition-missing'||record?.platformStatus==='definition-newer-than-runtime'||versionAhead||policyBlocked;
    return {id:companyId,record,definition,known:Boolean(definition),registered:Boolean(record||companyId==='group'),opened,operational:Boolean(definition&&definition.lifecycle==='active'&&!held&&(companyId==='group'||opened)),orphan,status:held?'compatibility-hold':opened?'active':'registered'};
  }
  function requireCompany(state,companyId,options={}){
    const company=resolveCompany(state,companyId);
    if(!company||(!company.record&&company.id!=='group'&&options.registered===true))throw new Error(`company-not-found:${String(companyId||'')}`);
    if(!company.definition)throw new Error(`company-definition-unavailable:${String(companyId||'')}`);
    if(options.operational===true&&!company.operational)throw new Error(`company-not-operational:${String(companyId||'')}`);
    if(options.capability&&!company.definition.capabilities.includes(options.capability))throw new Error(`company-capability-missing:${company.id}:${options.capability}`);
    return company;
  }
  function listInstances(state,options={}){
    const ids=new Set();
    if(options.includeGroup!==false)ids.add('group');
    if(options.openedOnly!==true)for(const definition of listDefinitions({includeGroup:false}))ids.add(definition.id);
    for(const id of Object.keys(object(state?.companyRegistry)?state.companyRegistry:{}))if(id!=='group'||options.includeGroup!==false)ids.add(id);
    for(const id of Array.isArray(state?.openedCompanies)?state.openedCompanies:[])ids.add(String(id));
    return [...ids].map(id=>resolveCompany(state,id)).filter(Boolean).filter(company=>(options.openedOnly!==true||company.opened)&&(options.capability?Boolean(company.definition?.capabilities.includes(options.capability)):true)).sort((a,b)=>(Number(a.definition?.order)||9999)-(Number(b.definition?.order)||9999)||a.id.localeCompare(b.id));
  }
  function hasCapability(stateOrCompanyId,companyIdOrCapability,maybeCapability){
    const withState=object(stateOrCompanyId),state=withState?stateOrCompanyId:null,companyId=withState?companyIdOrCapability:stateOrCompanyId,capabilityId=withState?maybeCapability:companyIdOrCapability;
    const definition=state?definitionFor(state,companyId):getDefinition(companyId);
    return Boolean(definition?.capabilities.includes(String(capabilityId||'')));
  }
  function getSectorIds(stateOrCompanyId,maybeCompanyId){const withState=object(stateOrCompanyId),definition=withState?definitionFor(stateOrCompanyId,maybeCompanyId):getDefinition(stateOrCompanyId);return definition?[...definition.classification.sectorIds]:[];}
  function getOperationProfile(stateOrCompanyId,maybeCompanyId){const withState=object(stateOrCompanyId),definition=withState?definitionFor(stateOrCompanyId,maybeCompanyId):getDefinition(stateOrCompanyId);return definition?.classification.operationProfileId||null;}
  function getAssetClasses(stateOrCompanyId,maybeCompanyId){const withState=object(stateOrCompanyId),definition=withState?definitionFor(stateOrCompanyId,maybeCompanyId):getDefinition(stateOrCompanyId);return definition?[...definition.classification.assetClasses]:[];}
  function getRouteModes(stateOrCompanyId,maybeCompanyId){const withState=object(stateOrCompanyId),definition=withState?definitionFor(stateOrCompanyId,maybeCompanyId):getDefinition(stateOrCompanyId);return definition?[...definition.classification.routeModes]:[];}
  function resolveIdentity(state,companyId){
    const company=resolveCompany(state,companyId);if(!company)return null;
    const defaults=company.definition?.identity||{},saved=company.record||{},profile=companyId==='group'&&object(state?.profile)?state.profile:{},legalName=String(profile.name||saved.legalName||saved.name||defaults.legalDefault?.ar||defaults.legalDefault?.en||'').trim(),tradeName=String(saved.tradeName||profile.tradeName||defaults.trade?.ar||defaults.trade?.en||legalName).trim(),shortName=String(profile.shortName||saved.shortName||defaults.short||tradeName||legalName).trim(),logo=String(profile.logo||saved.logo||defaults.marks?.default||'').trim();
    return {companyId,definitionId:company.definition?.definitionId||saved.definitionId||null,definitionVersion:Number(saved.definitionVersion||company.definition?.definitionVersion)||null,legalName,tradeName,shortName,logo,custom:{legalName:Boolean(profile.name||saved.legalName||saved.name),tradeName:Boolean(saved.tradeName||profile.tradeName),shortName:Boolean(profile.shortName||saved.shortName),logo:Boolean(profile.logo||saved.logo)},orphan:company.orphan};
  }
  function resolveDocumentProfile(state,companyId){
    const company=resolveCompany(state,companyId);if(!company)return null;const identity=resolveIdentity(state,companyId),record=company.record||{},finance=company.definition?.finance||{},documentPrefix=PREFIX.test(String(record.documentPrefix||''))?String(record.documentPrefix):finance.documentPrefix||null,accountPrefix=PREFIX.test(String(record.accountPrefix||''))?String(record.accountPrefix):finance.accountPrefix||null;
    return {...identity,documentPrefix,accountPrefix,authorizedSignatory:String(record.authorizedSignatory||state?.profile?.founder||'').trim()||null,operational:company.operational};
  }
  function definitionByLegacyOwner(kind,mode){
    mode=String(mode||'');const key=kind==='route'?'routeOwnerModes':'assetOwnerModes',matches=listDefinitions({includeGroup:false}).filter(definition=>definition.legacy[key].includes(mode));
    return matches.length===1?matches[0]:null;
  }
  function ownerForLegacyAssetMode(mode){return definitionByLegacyOwner('asset',mode)?.id||null;}
  function ownerForLegacyRouteMode(mode){return definitionByLegacyOwner('route',mode)?.id||null;}
  function assetClassForLegacyMode(mode){const definition=definitionByLegacyOwner('asset',mode);return definition?.legacy.assetClassByMode?.[mode]||definition?.classification.assetClasses?.[0]||null;}
  function operationProfileForLegacyMode(mode){return definitionByLegacyOwner('asset',mode)?.classification.operationProfileId||definitionByLegacyOwner('route',mode)?.classification.operationProfileId||null;}
  function prefixHash(value){let hash=2166136261;for(const char of String(value||'')){hash^=char.charCodeAt(0);hash=Math.imul(hash,16777619);}return (hash>>>0).toString(36).toUpperCase().padStart(7,'0').slice(0,5);}
  function instancePrefix(companyId,definition,kind='document'){
    const key=kind==='account'?'accountPrefix':'documentPrefix',base=String(definition?.finance?.[key]||'CO').toUpperCase();if(companyId===definition?.id)return base;
    const stem=String(companyId||'CO').toUpperCase().replace(/[^A-Z0-9]/g,'').slice(0,12)||'CO';return `${stem}-${prefixHash(`${companyId}:${definition?.definitionId}:${kind}`)}`.slice(0,20);
  }
  function instanceMetadata(companyId,definition){
    const policy=getInstancePolicy(definition.id);return {id:companyId,companyId,definitionId:definition.definitionId,definitionVersion:definition.definitionVersion,sectorId:definition.classification.primarySectorId,sectorIds:[...definition.classification.sectorIds],operationProfileId:definition.classification.operationProfileId,assetClasses:[...definition.classification.assetClasses],routeModes:[...definition.classification.routeModes],financeBookId:companyId,documentPrefix:instancePrefix(companyId,definition,'document'),accountPrefix:instancePrefix(companyId,definition,'account'),instanceMode:policy.mode,stateScope:policy.stateScope,platformStatus:'ready'};
  }
  function planInstance(state,input={}){
    const companyId=String(input.companyId||input.type||'').trim(),definition=getDefinition(input.definitionId||companyId);
    if(!validId(companyId))throw new Error('company-id-invalid');if(!definition)throw new Error(`company-definition-unavailable:${input.definitionId||companyId}`);if(definition.kind==='holding'&&companyId!=='group')throw new Error('holding-definition-reserved');if(!instanceAllowed(state,companyId,definition))throw new Error(`company-definition-canonical-instance-only:${definition.definitionId}:${companyId}`);
    if(state?.openedCompanies?.includes(companyId))throw new Error('company-already-open');
    const existing=object(state?.companyRegistry?.[companyId])?state.companyRegistry[companyId]:null,existingDefinition=existing?getDefinition(existing.definitionId||companyId):null;
    if(existing&&existingDefinition&&existingDefinition.definitionId!==definition.definitionId)throw new Error('company-definition-conflict');
    return {companyId,definition,existing,metadata:instanceMetadata(companyId,definition)};
  }
  function setMissing(target,key,value){if(target[key]===undefined){target[key]=clone(value);return true;}return false;}
  function enrichRecord(state,companyId,raw){
    const record=object(raw)?raw:(typeof raw==='string'?{legalName:raw}:{legacyRecord:raw}),definition=getDefinition(record.definitionId||record.templateId||companyId),opened=companyId==='group'?Boolean(state.onboardingComplete):state.openedCompanies.includes(companyId);
    setMissing(record,'id',companyId);setMissing(record,'companyId',companyId);
    if(definition){
      const versionAhead=Number(record.definitionVersion)>Number(definition.definitionVersion);if(record.definitionId===undefined||record.definitionId===companyId)record.definitionId=definition.definitionId;
      if(!versionAhead)record.definitionVersion=definition.definitionVersion;
      const policy=getInstancePolicy(definition.id);setMissing(record,'sectorId',definition.classification.primarySectorId);setMissing(record,'sectorIds',definition.classification.sectorIds);setMissing(record,'operationProfileId',definition.classification.operationProfileId);setMissing(record,'assetClasses',definition.classification.assetClasses);setMissing(record,'routeModes',definition.classification.routeModes);setMissing(record,'financeBookId',companyId);setMissing(record,'documentPrefix',instancePrefix(companyId,definition,'document'));setMissing(record,'accountPrefix',instancePrefix(companyId,definition,'account'));setMissing(record,'instanceMode',policy.mode);setMissing(record,'stateScope',policy.stateScope);setMissing(record,'status',opened?'active':'registered');record.platformStatus=versionAhead?'definition-newer-than-runtime':'ready';if(record.orphanedDefinition===true)delete record.orphanedDefinition;if(!versionAhead&&['definition-missing','definition-newer-than-runtime'].includes(record.quarantine?.reason))delete record.quarantine;if(versionAhead)record.quarantine={readOnly:true,reason:'definition-newer-than-runtime'};
    }else{
      setMissing(record,'definitionId',companyId);setMissing(record,'status',opened?'active':'registered');record.platformStatus='definition-missing';record.orphanedDefinition=true;record.quarantine={readOnly:true,reason:'definition-missing'};
    }
    return record;
  }
  function migrateAsset(asset){
    if(!object(asset))return;
    const mode=String(asset.assetMode||asset.type||'').trim(),companyId=String(asset.ownerCompanyId||asset.companyId||ownerForLegacyAssetMode(mode)||'').trim();
    if(mode&&!asset.assetMode)asset.assetMode=mode;if(companyId&&!asset.ownerCompanyId)asset.ownerCompanyId=companyId;
    const assetClass=String(asset.assetClass||asset.assetClassId||assetClassForLegacyMode(mode)||'').trim();if(assetClass&&!asset.assetClass)asset.assetClass=assetClass;
    const operationProfileId=String(asset.operationProfileId||operationProfileForLegacyMode(mode)||'').trim();if(operationProfileId&&!asset.operationProfileId)asset.operationProfileId=operationProfileId;
  }
  function migrateRoute(route){
    if(!object(route))return;
    const routeMode=String(route.routeMode||route.type||'').trim(),companyId=String(route.ownerCompanyId||route.companyId||route.company||ownerForLegacyRouteMode(routeMode)||'').trim();
    if(routeMode&&!route.routeMode)route.routeMode=routeMode;
    if(companyId&&!route.ownerCompanyId)route.ownerCompanyId=companyId;
    const operationProfileId=String(route.operationProfileId||operationProfileForLegacyMode(routeMode)||'').trim();if(operationProfileId&&!route.operationProfileId)route.operationProfileId=operationProfileId;
  }
  function migrateState(input){
    if(!object(input))throw new Error('company-platform-state-invalid');
    const original=JSON.stringify(input),state=clone(input);
    state.companyRegistry=object(state.companyRegistry)?state.companyRegistry:{};state.companyModules=object(state.companyModules)?state.companyModules:{};
    state.openedCompanies=unique(state.openedCompanies);state.unlockedSectors=unique(unique(state.unlockedSectors).map(normalizeSectorId));
    const ids=new Set([...Object.keys(state.companyRegistry),...state.openedCompanies]);if(state.onboardingComplete||state.companyRegistry.group)ids.add('group');
    for(const companyId of ids){
      if(!validId(companyId))continue;
      state.companyRegistry[companyId]=enrichRecord(state,companyId,state.companyRegistry[companyId]);
      const definition=definitionFor(state,companyId);if(definition)for(const sectorId of definition.classification.sectorIds)if(!state.unlockedSectors.includes(sectorId)&&state.openedCompanies.includes(companyId))state.unlockedSectors.push(sectorId);
    }
    for(const asset of Array.isArray(state.assets)?state.assets:[])migrateAsset(asset);
    for(const delivery of Array.isArray(state.realism?.procurement?.deliveries)?state.realism.procurement.deliveries:[])migrateAsset(delivery?.asset);
    for(const route of Array.isArray(state.customRoutes)?state.customRoutes:[])migrateRoute(route);
    for(const bucket of ['globalBases','customHubs','branches']){
      for(const facility of Array.isArray(state[bucket])?state[bucket]:[]){
        if(!object(facility))continue;
        const companyId=String(facility.ownerCompanyId||facility.companyId||facility.company||'').trim();
        if(companyId&&!facility.ownerCompanyId)facility.ownerCompanyId=companyId;
        // Existing legacy aliases remain byte-compatible, but canonical records
        // never grow a second ownership field during migration.
      }
    }
    const previous=object(state.companyPlatform)?state.companyPlatform:{},definitionVersions=object(previous.definitionVersions)?{...previous.definitionVersions}:{},features=unique(previous.features),components=object(previous.components)?{...previous.components}:{};
    for(const definition of listDefinitions())definitionVersions[definition.definitionId]=Math.max(Number(definitionVersions[definition.definitionId])||0,definition.definitionVersion);
    const builtins=new Set(source.BUILTIN_COMPANY_IDS||[]),dynamic=[...ids].some(id=>id!=='group'&&!builtins.has(id)),separated=(state.customRoutes||[]).some(route=>route.ownerCompanyId&&route.routeMode&&route.ownerCompanyId!==ownerForLegacyRouteMode(route.routeMode))||(state.assets||[]).some(asset=>asset.ownerCompanyId&&asset.assetMode&&asset.ownerCompanyId!==ownerForLegacyAssetMode(asset.assetMode));
    if(dynamic&&!features.includes('dynamic-company-instances-v1'))features.push('dynamic-company-instances-v1');if(separated&&!features.includes('separated-company-ownership-v1'))features.push('separated-company-ownership-v1');features.sort();
    state.companyPlatform={...previous,schema:STATE_SCHEMA,schemaVersion:STATE_SCHEMA_VERSION,components:{...components,registry:1,ownership:1,modules:1},definitionVersions,features};if(dynamic||separated)state.companyPlatform.minimumReaderBuild=Math.max(MINIMUM_DYNAMIC_COMPANY_BUILD,Number(previous.minimumReaderBuild)||0);
    const validation=validateState(state);return {state,changed:original!==JSON.stringify(state),errors:validation.errors,warnings:validation.warnings};
  }
  function validateState(state){
    const errors=[],warnings=[];
    if(!object(state))return {ok:false,errors:['company-platform-root'],warnings};
    if(state.companyPlatform!==undefined&&(!object(state.companyPlatform)||state.companyPlatform.schema!==STATE_SCHEMA||Number(state.companyPlatform.schemaVersion)!==STATE_SCHEMA_VERSION))errors.push('company-platform-schema');
    const registry=object(state.companyRegistry)?state.companyRegistry:null;if(!registry)errors.push('company-registry-shape');
    const opened=Array.isArray(state.openedCompanies)?state.openedCompanies:[];if(!Array.isArray(state.openedCompanies))errors.push('opened-companies-shape');if(unique(opened).length!==opened.length)errors.push('opened-companies-duplicate');
    for(const [companyId,record] of Object.entries(registry||{})){
      if(!validId(companyId)||!object(record)){errors.push(`company-record-shape:${companyId}`);continue;}
      if(record.id!==undefined&&record.id!==companyId)errors.push(`company-record-id:${companyId}`);if(record.companyId!==undefined&&record.companyId!==companyId)errors.push(`company-record-company-id:${companyId}`);
      if(record.definitionId!==undefined&&!validId(record.definitionId))errors.push(`company-record-definition-id:${companyId}`);
      for(const key of ['sectorIds','assetClasses','routeModes'])if(record[key]!==undefined&&(!Array.isArray(record[key])||record[key].some(value=>!validDataId(value))))errors.push(`company-record-${key}:${companyId}`);
      const definition=definitionFor(state,companyId);if(!definition)warnings.push(`company-definition-missing:${companyId}`);else if(!instanceAllowed(state,companyId,definition))errors.push(`company-instance-policy:${companyId}:${definition.definitionId}`);
    }
    for(const companyId of opened){if(!validId(companyId))errors.push(`opened-company-id:${companyId}`);else if(!registry?.[companyId])errors.push(`opened-company-record:${companyId}`);}
    const validReference=companyId=>validId(companyId)&&Boolean(registry?.[companyId]||getDefinition(companyId));
    const validateAsset=(asset,context='asset')=>{const companyId=String(asset?.ownerCompanyId||asset?.companyId||ownerForLegacyAssetMode(asset?.assetMode||asset?.type)||'');if(!validReference(companyId))errors.push(`${context}-company-reference:${asset?.id||'unknown'}`);if(asset?.assetClass!==undefined&&!validDataId(asset.assetClass))errors.push(`${context}-class:${asset?.id||'unknown'}`);};
    for(const asset of Array.isArray(state.assets)?state.assets:[])validateAsset(asset);
    for(const delivery of Array.isArray(state.realism?.procurement?.deliveries)?state.realism.procurement.deliveries:[])if(delivery?.asset)validateAsset(delivery.asset,'delivery-asset');
    for(const route of Array.isArray(state.customRoutes)?state.customRoutes:[]){const companyId=String(route?.ownerCompanyId||route?.companyId||route?.company||ownerForLegacyRouteMode(route?.routeMode||route?.type)||''),routeMode=String(route?.routeMode||route?.type||'');if(!validReference(companyId))errors.push(`route-company-reference:${route?.id||'unknown'}`);if(!validDataId(routeMode))errors.push(`route-mode:${route?.id||'unknown'}`);}
    for(const bucket of ['globalBases','customHubs','branches'])for(const facility of Array.isArray(state[bucket])?state[bucket]:[]){const companyId=String(facility?.ownerCompanyId||facility?.companyId||facility?.company||'').trim();if(companyId&&!validReference(companyId))errors.push(`facility-company-reference:${facility?.id||'unknown'}`);}
    for(const companyId of Object.keys(object(state.companyFinance)?state.companyFinance:{}))if(!validReference(companyId))warnings.push(`company-finance-orphan:${companyId}`);
    return {ok:errors.length===0,errors:[...new Set(errors)],warnings:[...new Set(warnings)]};
  }
  function validateRegistry(){
    const errors=[];for(const definition of definitionsById.values()){const validation=validateDefinition(definition);if(!validation.ok)errors.push(...validation.errors);for(const [kind,id] of Object.entries(definition.adapters||{})){const adapter=capabilityRegistry.getAdapter(kind,id);if(!adapter){errors.push(`company-adapter-missing:${definition.id}:${kind}:${id}`);continue;}const descriptor=capabilityRegistry.validateAdapter?.(kind,id,adapter);if(descriptor&&!descriptor.ok)errors.push(...descriptor.errors.map(error=>`${definition.id}:${error}`));if(typeof adapter.supports!=='function'||adapter.supports(definition)!==true)errors.push(`company-adapter-unsupported:${definition.id}:${kind}:${id}`);}}
    if(!definitionsById.has('group')||definitionsById.get('group').kind!=='holding')errors.push('group-definition-missing');
    return {ok:errors.length===0,errors:[...new Set(errors)]};
  }
  function adapterFor(stateOrCompanyId,companyIdOrKind,maybeKind,options={}){
    const withState=object(stateOrCompanyId),state=withState?stateOrCompanyId:null,companyId=withState?companyIdOrKind:stateOrCompanyId,kind=String(withState?maybeKind:companyIdOrKind||''),definition=state?definitionFor(state,companyId):getDefinition(companyId);
    if(!definition)throw new Error(`company-definition-unavailable:${String(companyId||'')}`);const id=definition.adapters?.[kind];if(!id)throw new Error(`company-adapter-reference-missing:${definition.id}:${kind}`);const adapter=capabilityRegistry.getAdapter(kind,id,{required:true});if(adapter.supports(definition)!==true)throw new Error(`company-adapter-unsupported:${definition.id}:${kind}:${id}`);if(options.resolve===true)return adapter.resolve(options.runtime||globalThis);return adapter;
  }
  function seal(options={}){const validation=validateRegistry();if(!validation.ok)throw new Error(`company-platform-invalid:${validation.errors.join(',')}`);if(options.runtimeCheck!==false)for(const definition of definitionsById.values())for(const [kind,id] of Object.entries(definition.adapters||{})){const adapter=capabilityRegistry.getAdapter(kind,id,{required:true});try{adapter.assertAvailable(options.runtime||globalThis);}catch(error){throw new Error(`company-adapter-runtime-unavailable:${definition.id}:${kind}:${id}:${String(error?.message||error)}`);}}capabilityRegistry.seal?.();sealed=true;return snapshot();}
  function isSealed(){return sealed;}
  function snapshot(){return Object.freeze({version:VERSION,stateSchema:STATE_SCHEMA,stateSchemaVersion:STATE_SCHEMA_VERSION,sealed,definitions:definitionsById.size,companyIds:Object.freeze(companyIds()),origins:Object.freeze(Object.fromEntries(origins))});}

  installDefinitions(source.list(),{source:'builtin'});
  const API=Object.freeze({VERSION,STATE_SCHEMA,STATE_SCHEMA_VERSION,MINIMUM_DYNAMIC_COMPANY_BUILD,installDefinition,installDefinitions,listDefinitions,getDefinition,normalizeSectorId,getInstancePolicy,companyIds,listByCapability,isKnownCompany,isKnownSector,isKnownRouteMode,isKnownAssetClass,definitionFor,resolveCompany,requireCompany,listInstances,hasCapability,getSectorIds,getOperationProfile,getAssetClasses,getRouteModes,resolveIdentity,resolveDocumentProfile,ownerForLegacyAssetMode,ownerForLegacyRouteMode,assetClassForLegacyMode,operationProfileForLegacyMode,adapterFor,instanceMetadata,planInstance,migrateState,validateState,validateDefinition,validateRegistry,seal,isSealed,snapshot});
  globalThis.GH_COMPANY_PLATFORM=API;
  if(globalThis.window&&globalThis.window!==globalThis)globalThis.window.GH_COMPANY_PLATFORM=API;
  if(typeof module!=='undefined'&&module.exports)module.exports=API;
})();

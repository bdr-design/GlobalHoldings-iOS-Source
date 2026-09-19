(()=>{
  'use strict';
  const VERSION='3.0.0',SAVE_SCHEMA_VERSION='2.0.0';
  const ROUTE_TYPES=new Set(['air','sea','road']),ASSET_PHASES=new Set(['idle','delivery','turnaround','moving']);
  const ROUTE_FLEET_CAPACITY=Object.freeze({air:24,sea:24,road:64});
  const BUILTIN_ROUTES=new Set(['AIR_RUH_LHR','AIR_DXB_SIN','SEA_SIN_JED','SEA_RTM_NYC','ROAD_RUH_JED','ROAD_DXB_RUH']);
  const STATE_LIMITS=Object.freeze({customRoutes:240,routeEndpoints:360,routeCache:160,routePoints:2048,routeBytes:256*1024,routeCacheBytes:512*1024,controlEvents:240,controlCommands:120,controlIncidents:80,controlOutbox:100,controlBlackBox:120,domainCommands:240,businessEvents:240,businessWorldEvents:240,businessWorldOpportunities:120,businessWorldSponsorships:60,businessWorldCampaigns:80,businessWorldCompetitorActivity:120,businessWorldParties:500,businessWorldRelationships:1500});
  function object(v){return !!v&&typeof v==='object'&&!Array.isArray(v);}
  function finite(v){return v!==null&&v!==''&&typeof v!=='boolean'&&Number.isFinite(Number(v));}
  function structured(v){if(typeof globalThis.structuredClone==='function')try{return globalThis.structuredClone(v);}catch(_e){}return JSON.parse(JSON.stringify(v));}
  function validPoint(point){return Array.isArray(point)&&point.length>=2&&typeof point[0]==='number'&&Number.isFinite(point[0])&&typeof point[1]==='number'&&Number.isFinite(point[1])&&point[0]>=-90&&point[0]<=90&&point[1]>=-180&&point[1]<=180;}
  function serializedBytes(value){try{const json=typeof value==='string'?value:JSON.stringify(value);return globalThis.TextEncoder?new TextEncoder().encode(json).byteLength:json.length*2;}catch(_error){return Infinity;}}
  function routeSignature(route){const points=(Array.isArray(route?.route)?route.route:[]).filter(validPoint).map(point=>`${point[0].toFixed(5)},${point[1].toFixed(5)}`);if(points.length<2)return'';const a=points.join(';'),b=[...points].reverse().join(';');return `${route?.company||route?.type||''}:${route?.type||''}:${a<b?a:b}`;}
  function retiredFeatureKey(){return String.fromCharCode(97,105);}
  function retiredPanelName(){return String.fromCharCode(105,110,116,101,108,108,105,103,101,110,99,101);}
  function retiredVehicleOptionKey(){return String.fromCharCode(97,117,116,111,110,111,109,111,117,115);}
  function refreshRetiredCatalogAsset(asset){
    if(!object(asset)||!['N-T4','N-T28'].includes(asset.catalogId))return false;
    const updated=asset.catalogId==='N-T4'
      ?{model:'Hybrid Safety 24T · هجينة آمنة',drivetrain:'ديزل هجين'}
      :{model:'Electric Long Range 20T · كهربائية بعيدة',drivetrain:'كهربائي 900V'};
    let changed=false;if(asset.model!==updated.model){asset.model=updated.model;changed=true;}
    if(object(asset.specs)){const retired=retiredVehicleOptionKey();if(Object.prototype.hasOwnProperty.call(asset.specs,retired)){delete asset.specs[retired];changed=true;}if(asset.specs.drivetrain!==updated.drivetrain){asset.specs.drivetrain=updated.drivetrain;changed=true;}}
    return changed;
  }
  function transitionalRouteUser(asset){return asset?.phase==='moving'&&asset?.releaseExclusiveRouteOnArrival===true;}
  function routeCapacity(type){return ROUTE_FLEET_CAPACITY[type]||1;}
  function clearLegacyRouteAssignment(asset){asset.routeId=null;asset.routeSignature=null;asset.routeSlot=null;asset.departureScheduled=false;delete asset.departureScheduledAt;asset.releaseExclusiveRouteOnArrival=false;asset.phase='idle';asset.progress=0;asset.dwellRemaining=0;asset.reverse=false;}
  function migrationTrim(state){
    const cp=state.controlPlane;if(object(cp)){
      // Journals are newest-first. Keep their heads so journalHeadHash continues to
      // describe the latest retained event. The outbox is oldest-first: retain all
      // pending rows first, then the newest delivered evidence within the hard cap.
      cp.events=Array.isArray(cp.events)?cp.events.slice(0,STATE_LIMITS.controlEvents):[];cp.commands=Array.isArray(cp.commands)?cp.commands.slice(0,STATE_LIMITS.controlCommands):[];cp.incidents=Array.isArray(cp.incidents)?cp.incidents.slice(0,STATE_LIMITS.controlIncidents):[];cp.blackBox=Array.isArray(cp.blackBox)?cp.blackBox.slice(0,STATE_LIMITS.controlBlackBox):[];
      if(Array.isArray(cp.outbox)){
        const pendingRows=cp.outbox.filter(row=>row?.delivered!==true).slice(0,STATE_LIMITS.controlOutbox),room=Math.max(0,STATE_LIMITS.controlOutbox-pendingRows.length),delivered=cp.outbox.filter(row=>row?.delivered===true).slice(-room);
        cp.outbox=[...pendingRows,...delivered];
      }else cp.outbox=[];
    }
    if(object(state.domainRuntime)&&Array.isArray(state.domainRuntime.commands))state.domainRuntime.commands=state.domainRuntime.commands.slice(0,STATE_LIMITS.domainCommands);
    if(object(state.businessWorld)){
      for(const [key,limit] of [['events',STATE_LIMITS.businessWorldEvents],['opportunities',STATE_LIMITS.businessWorldOpportunities],['sponsorships',STATE_LIMITS.businessWorldSponsorships],['campaigns',STATE_LIMITS.businessWorldCampaigns],['competitorActivity',STATE_LIMITS.businessWorldCompetitorActivity]])state.businessWorld[key]=Array.isArray(state.businessWorld[key])?state.businessWorld[key].slice(0,limit):[];
      state.businessWorld.parties=object(state.businessWorld.parties)?state.businessWorld.parties:{};
      state.businessWorld.relationships=object(state.businessWorld.relationships)?state.businessWorld.relationships:{};
    }
    if(object(state.businessLedger)&&Array.isArray(state.businessLedger.events))state.businessLedger.events=state.businessLedger.events.slice(0,STATE_LIMITS.businessEvents);
  }
  function migrateLegacy(input){
    if(!object(input))return {state:input,changed:false};
    const state=structured(input),retired=retiredFeatureKey();let changed=false;
    if(object(state.advanced)&&Object.prototype.hasOwnProperty.call(state.advanced,retired)){delete state.advanced[retired];changed=true;}
    if(object(state.settings)&&Object.prototype.hasOwnProperty.call(state.settings,`${retired}Brief`)){delete state.settings[`${retired}Brief`];changed=true;}
    if([retiredPanelName(),`${retired}Approvals`].includes(state.lastPanel)){state.lastPanel='leadershipHub';changed=true;}
    if(object(state.controlPlane?.registry?.engines)&&Object.prototype.hasOwnProperty.call(state.controlPlane.registry.engines,retired)){delete state.controlPlane;changed=true;}
    if(object(state.domainRuntime)){
      const before=Array.isArray(state.domainRuntime.commands)?state.domainRuntime.commands.length:0;
      state.domainRuntime.commands=(state.domainRuntime.commands||[]).filter(row=>!String(row?.domain||'').toLowerCase().includes(retired)&&!String(row?.actor||'').toLowerCase().includes(retired));if(state.domainRuntime.commands.length!==before)changed=true;
    }
    const invalidRouteIds=new Set(),seenRouteIds=new Set();
    state.customRoutes=(Array.isArray(state.customRoutes)?state.customRoutes:[]).filter(route=>{
      if(!object(route)||!route.id||seenRouteIds.has(route.id)||!ROUTE_TYPES.has(route.type)||!route.fromFacility||!route.toFacility||route.fromFacility===route.toFacility||!Array.isArray(route.route)||route.route.length<2||route.route.length>STATE_LIMITS.routePoints||route.route.some(point=>!validPoint(point))||serializedBytes(route)>STATE_LIMITS.routeBytes){if(route?.id)invalidRouteIds.add(route.id);changed=true;return false;}
      seenRouteIds.add(route.id);if(route.company!==route.type){route.company=route.type;changed=true;}return true;
    });
    const assets=Array.isArray(state.assets)?state.assets:[];
    for(const asset of assets)if(refreshRetiredCatalogAsset(asset))changed=true;
    for(const delivery of Array.isArray(state.realism?.procurement?.deliveries)?state.realism.procurement.deliveries:[])if(refreshRetiredCatalogAsset(delivery?.asset))changed=true;
    for(const asset of assets)if(asset.routeId&&invalidRouteIds.has(asset.routeId)){clearLegacyRouteAssignment(asset);changed=true;}
    const routeById=new Map(state.customRoutes.map(route=>[route.id,route])),assignmentGroups=new Map();for(const asset of assets)if(asset.routeId){const rows=assignmentGroups.get(asset.routeId)||[];rows.push(asset);assignmentGroups.set(asset.routeId,rows);}
    for(const [routeId,rows] of assignmentGroups)if(rows.length>1){
      const type=routeById.get(routeId)?.type||rows[0]?.type;
      if(['air','sea','road'].includes(type)){
        const capacity=routeCapacity(type),used=new Set(),ordered=[...rows].sort((a,b)=>Number(b.phase==='moving')-Number(a.phase==='moving')||(Number.isInteger(a.routeSlot)?a.routeSlot:capacity)-(Number.isInteger(b.routeSlot)?b.routeSlot:capacity)||String(a.id).localeCompare(String(b.id)));
        for(const asset of ordered){
          if(asset.type!==type){clearLegacyRouteAssignment(asset);changed=true;continue;}
          let slot=Number.isInteger(asset.routeSlot)&&asset.routeSlot>=0&&asset.routeSlot<capacity&&!used.has(asset.routeSlot)?asset.routeSlot:0;while(slot<capacity&&used.has(slot))slot++;
          if(slot>=capacity){if(asset.phase==='moving'){if(asset.releaseExclusiveRouteOnArrival!==true){asset.releaseExclusiveRouteOnArrival=true;changed=true;}}else{clearLegacyRouteAssignment(asset);changed=true;}continue;}
          used.add(slot);if(asset.routeSlot!==slot){asset.routeSlot=slot;changed=true;}if(asset.releaseExclusiveRouteOnArrival===true){asset.releaseExclusiveRouteOnArrival=false;changed=true;}
        }
        continue;
      }
      const keeper=rows.find(asset=>asset.phase==='moving')||rows[0];if(keeper.releaseExclusiveRouteOnArrival===true){keeper.releaseExclusiveRouteOnArrival=false;changed=true;}
      for(const asset of rows)if(asset!==keeper){if(asset.phase==='moving'){if(asset.releaseExclusiveRouteOnArrival!==true){asset.releaseExclusiveRouteOnArrival=true;changed=true;}}else{clearLegacyRouteAssignment(asset);changed=true;}}
    }
    const signatureGroups=new Map();for(const route of state.customRoutes){const signature=routeSignature(route),rows=signatureGroups.get(signature)||[];rows.push(route);signatureGroups.set(signature,rows);}
    const removedRouteIds=new Set();
    for(const routes of signatureGroups.values())if(routes.length>1){
      const ids=new Set(routes.map(route=>route.id)),users=assets.filter(asset=>ids.has(asset.routeId)),type=routes[0]?.type;
      if(['air','sea','road'].includes(type)){
        const capacity=routeCapacity(type),canonical=routes.slice().sort((a,b)=>users.filter(asset=>asset.routeId===b.id).length-users.filter(asset=>asset.routeId===a.id).length||String(a.id).localeCompare(String(b.id)))[0],accepted=[],retained=new Set([canonical.id]);
        for(const asset of users.slice().sort((a,b)=>Number(b.phase==='moving')-Number(a.phase==='moving')||Number(b.routeId===canonical.id)-Number(a.routeId===canonical.id)||String(a.id).localeCompare(String(b.id)))){
          const compatible=asset.type===type&&[canonical.fromFacility,canonical.toFacility].includes(asset.baseFacility);
          if(compatible&&accepted.length<capacity){asset.routeId=canonical.id;asset.routeSignature=routeSignature(canonical);asset.routeSlot=accepted.length;if(asset.releaseExclusiveRouteOnArrival===true)asset.releaseExclusiveRouteOnArrival=false;accepted.push(asset);changed=true;continue;}
          if(asset.phase==='moving'){if(asset.releaseExclusiveRouteOnArrival!==true){asset.releaseExclusiveRouteOnArrival=true;changed=true;}retained.add(asset.routeId);}
          else{clearLegacyRouteAssignment(asset);changed=true;}
        }
        for(const route of routes)if(!retained.has(route.id)){removedRouteIds.add(route.id);changed=true;}
        continue;
      }
      const keeper=users.find(asset=>asset.phase==='moving')||users[0]||null,canonicalId=keeper?.routeId||routes[0].id;
      if(keeper?.releaseExclusiveRouteOnArrival===true){keeper.releaseExclusiveRouteOnArrival=false;changed=true;}
      for(const asset of users)if(asset!==keeper){if(asset.phase==='moving'){if(asset.releaseExclusiveRouteOnArrival!==true){asset.releaseExclusiveRouteOnArrival=true;changed=true;}}else{clearLegacyRouteAssignment(asset);changed=true;}}
      const retained=new Set(assets.map(asset=>asset.routeId).filter(id=>ids.has(id)));retained.add(canonicalId);
      for(const route of routes)if(!retained.has(route.id)){removedRouteIds.add(route.id);changed=true;}
    }
    if(removedRouteIds.size)state.customRoutes=state.customRoutes.filter(route=>!removedRouteIds.has(route.id));
    if(object(state.routeCache)){
      for(const id of Object.keys(state.routeCache))if(invalidRouteIds.has(id)||removedRouteIds.has(id)){delete state.routeCache[id];changed=true;}
      for(const route of state.customRoutes){const entry=state.routeCache[route.id];if(entry?.route){delete entry.route;entry.canonicalRouteId=route.id;entry.routeSignature=routeSignature(route);changed=true;}}
      const active=new Set([...assets.map(asset=>asset.routeId).filter(Boolean),...state.customRoutes.map(route=>route.id)]),entries=Object.entries(state.routeCache);
      entries.sort((a,b)=>Number(active.has(b[0]))-Number(active.has(a[0])));let kept=entries.slice(0,STATE_LIMITS.routeCache);while(kept.length&&serializedBytes(Object.fromEntries(kept))>STATE_LIMITS.routeCacheBytes)kept.pop();if(kept.length!==entries.length){state.routeCache=Object.fromEntries(kept);changed=true;}
    }
    if(object(state.routeEndpoints)){
      const referenced=new Set([...state.customRoutes.flatMap(route=>[route.fromFacility,route.toFacility]),...assets.map(asset=>asset.baseFacility).filter(Boolean)]);
      for(const [id,endpoint] of Object.entries(state.routeEndpoints))if(endpoint?.routeEndpoint&&!referenced.has(id)){delete state.routeEndpoints[id];changed=true;}
    }
    const before=JSON.stringify({cp:state.controlPlane?.events?.length,cc:state.controlPlane?.commands?.length,dc:state.domainRuntime?.commands?.length,be:state.businessLedger?.events?.length});migrationTrim(state);const after=JSON.stringify({cp:state.controlPlane?.events?.length,cc:state.controlPlane?.commands?.length,dc:state.domainRuntime?.commands?.length,be:state.businessLedger?.events?.length});if(before!==after)changed=true;
    return {state,changed};
  }
  function normalize(state,defaults){
    if(!object(state))throw new Error('SAVE_ROOT_INVALID');
    if(state.saveVersion!==undefined&&state.saveVersion!==SAVE_SCHEMA_VERSION)throw new Error('SAVE_SCHEMA_UNSUPPORTED');
    const s=state,d=object(defaults)?defaults:{};for(const [k,v] of Object.entries(d))if(s[k]===undefined)s[k]=structured(v);
    s.saveVersion=SAVE_SCHEMA_VERSION;s.saveRevision=Math.max(0,Math.floor(Number(s.saveRevision)||0));s.simSeconds=Math.max(0,Number(s.simSeconds)||0);s.lastFinancialDay=Math.max(0,Math.floor(Number(s.lastFinancialDay)||0));s.lastMarketHour=Math.max(0,Math.floor(Number(s.lastMarketHour)||0));
    s.timeRecovery=object(s.timeRecovery)?s.timeRecovery:{};s.timeRecovery.queue=Array.isArray(s.timeRecovery.queue)?s.timeRecovery.queue:[];s.simulationKernel=object(s.simulationKernel)?s.simulationKernel:{};s.simulationWorld=object(s.simulationWorld)?s.simulationWorld:{};s.determinism=object(s.determinism)?s.determinism:{};s.sequences=object(s.sequences)?s.sequences:{};
    if(object(s.finance)){s.finance.journalEntries=Array.isArray(s.finance.journalEntries)?s.finance.journalEntries:[];s.finance.periods=Array.isArray(s.finance.periods)?s.finance.periods:[];if(s.finance.auditArchive!=null&&!object(s.finance.auditArchive))s.finance.auditArchive={records:{},digests:[]};if(object(s.finance.auditArchive)){s.finance.auditArchive.records=object(s.finance.auditArchive.records)?s.finance.auditArchive.records:{};s.finance.auditArchive.digests=Array.isArray(s.finance.auditArchive.digests)?s.finance.auditArchive.digests:[];}}
    s.customRoutes=Array.isArray(s.customRoutes)?s.customRoutes:[];for(const route of s.customRoutes)if(object(route)&&ROUTE_TYPES.has(route.type))route.company=route.type;
    s.routeEndpoints=object(s.routeEndpoints)?s.routeEndpoints:{};s.routeCache=object(s.routeCache)?s.routeCache:{};migrationTrim(s);
    return s;
  }
  function duplicateIds(rows,getId=x=>x?.id){const seen=new Set();for(const row of Array.isArray(rows)?rows:[]){const id=String(getId(row)||'');if(!id||seen.has(id))return true;seen.add(id);}return false;}
  function validate(s){
    const errors=[];if(!object(s))errors.push('root-not-object');if(String(s?.saveVersion||'')!==SAVE_SCHEMA_VERSION)errors.push('save-version');if(s?.saveRevision!==undefined&&(!finite(s.saveRevision)||Number(s.saveRevision)<0||!Number.isSafeInteger(Number(s.saveRevision))))errors.push('save-revision');if(s?.resetEpoch!==undefined&&(!finite(s.resetEpoch)||!Number.isSafeInteger(Number(s.resetEpoch))||Number(s.resetEpoch)<0))errors.push('reset-epoch');if(!finite(s?.simSeconds)||Number(s.simSeconds)<0)errors.push('sim-seconds');
    for(const key of ['assets','market'])if(!Array.isArray(s?.[key]))errors.push(key);if(!object(s?.finance)||!Array.isArray(s.finance.invoices)||!Array.isArray(s.finance.cheques)||!Array.isArray(s.finance.payables)||!Array.isArray(s.finance.receivables)||!Array.isArray(s.finance.periods))errors.push('finance');if(!object(s?.companyFinance))errors.push('company-finance');if(!object(s?.advanced))errors.push('advanced');
    if(duplicateIds(s?.assets,x=>x?.id))errors.push('asset-id');if(duplicateIds(s?.customRoutes,x=>x?.id))errors.push('route-id');if(duplicateIds(s?.realism?.procurement?.deliveries,x=>x?.id))errors.push('delivery-id');
    if(s?.speed!==undefined&&![0,1,2,3,4,5].includes(Number(s.speed)))errors.push('speed');
    const routes=Array.isArray(s?.customRoutes)?s.customRoutes:[],routeIds=new Set(BUILTIN_ROUTES),routeSignatureGroups=new Map();
    if(routes.length>STATE_LIMITS.customRoutes)errors.push('route-capacity');
    for(const route of routes){
      if(!object(route)||!route.id||!ROUTE_TYPES.has(route.type)||(route.company||route.type)!==route.type||!route.fromFacility||!route.toFacility||route.fromFacility===route.toFacility)errors.push('route-shape');
      if(!Array.isArray(route?.route)||route.route.length<2||route.route.length>STATE_LIMITS.routePoints||route.route.some(point=>!validPoint(point))||serializedBytes(route)>STATE_LIMITS.routeBytes)errors.push('route-geometry');
      const signature=routeSignature(route);if(!signature)errors.push('route-geometry');else{const rows=routeSignatureGroups.get(signature)||[];rows.push(route);routeSignatureGroups.set(signature,rows);}
      if(route?.id)routeIds.add(route.id);
    }
    const routeUsers=new Map(),assets=Array.isArray(s?.assets)?s.assets:[];
    for(const asset of assets){
      if(!object(asset)||!String(asset.id||'').trim()||!ROUTE_TYPES.has(asset.type)||!String(asset.baseFacility||'').trim())errors.push('asset-shape');
      if(!ASSET_PHASES.has(asset.phase))errors.push('asset-phase');
      if(!finite(asset.progress)||Number(asset.progress)<0||Number(asset.progress)>1)errors.push('asset-progress');
      if(!finite(asset.fuel)||Number(asset.fuel)<0||Number(asset.fuel)>100)errors.push('asset-fuel');
      if(!finite(asset.condition)||Number(asset.condition)<0||Number(asset.condition)>100)errors.push('asset-condition');
      if(asset.routeId!=null&&(!String(asset.routeId).trim()||!routeIds.has(asset.routeId)))errors.push('asset-route-reference');
      if(['moving','turnaround'].includes(asset.phase)&&!asset.routeId)errors.push('asset-route-required');
      if(asset.routeId){const users=routeUsers.get(asset.routeId)||[];users.push(asset);routeUsers.set(asset.routeId,users);const route=routes.find(row=>row.id===asset.routeId);if(route&&route.type!==asset.type)errors.push('asset-route-company');}
    }
    for(const [routeId,users] of routeUsers){const stable=users.filter(asset=>!transitionalRouteUser(asset)),type=routes.find(route=>route.id===routeId)?.type||users[0]?.type,capacity=routeCapacity(type);if(stable.length>capacity)errors.push('asset-route-capacity');}
    for(const group of routeSignatureGroups.values())if(group.length>1){const stable=group.filter(route=>{const users=routeUsers.get(route.id)||[];return !users.length||users.some(asset=>!transitionalRouteUser(asset));});if(stable.length!==1)errors.push('route-geometry-duplicate');}
    if(object(s?.routeEndpoints)){if(Object.keys(s.routeEndpoints).length>STATE_LIMITS.routeEndpoints)errors.push('route-endpoint-capacity');for(const [id,endpoint] of Object.entries(s.routeEndpoints))if(!id||!object(endpoint)||endpoint.id!==id||!validPoint(endpoint.coords))errors.push('route-endpoint');}
    else if(s?.routeEndpoints!==undefined)errors.push('route-endpoints-shape');
    if(object(s?.routeCache)){if(Object.keys(s.routeCache).length>STATE_LIMITS.routeCache||serializedBytes(s.routeCache)>STATE_LIMITS.routeCacheBytes)errors.push('route-cache-capacity');for(const [id,entry] of Object.entries(s.routeCache)){if(!id||!object(entry)||entry.route&&(!Array.isArray(entry.route)||entry.route.length<2||entry.route.length>STATE_LIMITS.routePoints||entry.route.some(point=>!validPoint(point))))errors.push('route-cache');}}
    else if(s?.routeCache!==undefined)errors.push('route-cache-shape');
    if(object(s?.advanced)&&Object.prototype.hasOwnProperty.call(s.advanced,retiredFeatureKey()))errors.push('retired-feature-state');
    const inv=Array.isArray(s?.finance?.invoices)?s.finance.invoices:[];if(duplicateIds(inv,x=>x?.number||x?.id))errors.push('invoice-id');const chq=Array.isArray(s?.finance?.cheques)?s.finance.cheques:[];if(duplicateIds(chq,x=>x?.id))errors.push('cheque-id');
    for(const book of Object.values(object(s?.companyFinance)?s.companyFinance:{})){
      if(!Array.isArray(book?.accounts)||!book.accounts.length){errors.push('accounts');continue;}for(const account of book.accounts)if(!finite(account?.balance)||Number(account.balance)<0){errors.push('account-balance');break;}if(!finite(book?.debt)||Number(book.debt)<0)errors.push('debt');if(!finite(book?.taxPayable)||Number(book.taxPayable)<0)errors.push('tax-payable');
      const vat=book?.vat;if(vat!==undefined&&(!object(vat)||['output','input','creditCarry','periodOutputStart','periodInputStart'].some(k=>!finite(vat[k])||Number(vat[k])<0)))errors.push('vat');
    }
    for(const d of Array.isArray(s?.realism?.procurement?.deliveries)?s.realism.procurement.deliveries:[]){if(!d?.id||!d?.baseId||!String(d.status||'').trim())errors.push('delivery-shape');}
    for(const i of inv){const total=Number(i?.total),gross=Number(i?.amount??i?.total),tax=Number(i?.tax||0),subtotal=Number(i?.subtotal??(gross-tax));if(!finite(total)||total<0||!finite(gross)||gross<0||!finite(subtotal)||subtotal<0||!finite(tax)||tax<0||Math.abs(total-gross)>.02||Math.abs(total-(subtotal+tax))>.02)errors.push('invoice-math');}
    for(const p of Array.isArray(s?.finance?.periods)?s.finance.periods:[]){if(!finite(p?.amount)||Number(p.amount)<0||!['مستحق','مسدد','صفر'].includes(String(p?.status||'')))errors.push('tax-period');if(finite(p?.outputVAT)&&finite(p?.inputVAT)){const opening=Math.max(0,Number(p?.openingCredit)||0),expected=Math.max(0,Number(p.outputVAT)-Number(p.inputVAT)-opening),closing=Math.max(0,Number(p.inputVAT)+opening-Number(p.outputVAT));if(Math.abs((Number(p.amount)||0)-expected)>.02||Math.abs((Number(p?.closingCredit)||0)-closing)>.02)errors.push('tax-period-math');}}
    for(const j of Array.isArray(s?.finance?.journalEntries)?s.finance.journalEntries:[]){const lines=Array.isArray(j?.lines)?j.lines:[],dr=lines.reduce((n,x)=>n+(Number(x?.debit)||0),0),cr=lines.reduce((n,x)=>n+(Number(x?.credit)||0),0);if(!lines.length||Math.abs(dr-cr)>.02)errors.push('journal-unbalanced');}
    const archive=s?.finance?.auditArchive;if(archive!=null){if(!object(archive)||!object(archive.records)||!Array.isArray(archive.digests))errors.push('finance-audit-archive');else{for(const [kind,rows] of Object.entries(archive.records))if(!kind||!Array.isArray(rows))errors.push('finance-audit-records');for(const d of archive.digests){if(!d||typeof d.kind!=='string'||!Number.isInteger(Number(d.count))||Number(d.count)<=0||!finite(d.total)||Number(d.total)<0||typeof d.checksum!=='string'||!d.checksum)errors.push('finance-audit-digest');}}}
    const budgets=object(s?.companyBudgets)?s.companyBudgets:{};for(const b of Object.values(budgets)){const limit=Number(b?.limit),spent=Number(b?.spent),reserved=Number(b?.reserved||0);if(!finite(limit)||limit<0||!finite(spent)||spent<0||!finite(reserved)||reserved<0||(b.enabled&&limit>0&&spent+reserved>limit+.01))errors.push('budget');for(const [line,lineLimitRaw] of Object.entries(object(b?.lines)?b.lines:{})){const lineLimit=Number(lineLimitRaw)||0,lineSpent=Number(b?.spentByLine?.[line]||0),lineReserved=Number(b?.reservedByLine?.[line]||0);if(lineSpent<0||lineReserved<0||(b.enabled&&lineLimit>0&&lineSpent+lineReserved>lineLimit+.01))errors.push('budget-line');}}
    const cp=s?.controlPlane;if(cp!==undefined){if(!object(cp)||String(cp.schema||'')!=='gh-control-plane-v1'||!Array.isArray(cp.events)||!Array.isArray(cp.commands)||!Array.isArray(cp.incidents)||!Array.isArray(cp.outbox)||!Array.isArray(cp.blackBox)||!object(cp.registry)||!object(cp.registry.engines)||!Array.isArray(cp.registry.links))errors.push('control-plane-shape');else{if(cp.events.length>STATE_LIMITS.controlEvents||cp.commands.length>STATE_LIMITS.controlCommands||cp.incidents.length>STATE_LIMITS.controlIncidents||cp.outbox.length>STATE_LIMITS.controlOutbox||cp.blackBox.length>STATE_LIMITS.controlBlackBox)errors.push('control-plane-capacity');for(const key of ['revision','commandSequence','eventSequence','incidentSequence','outboxSequence'])if(!finite(cp[key])||Number(cp[key])<0||!Number.isInteger(Number(cp[key])))errors.push('control-plane-sequence');if(!/^[a-f0-9]{64}$/i.test(String(cp.journalHeadHash||'')))errors.push('control-plane-journal-head');if(duplicateIds(cp.events,x=>x?.id)||duplicateIds(cp.commands,x=>x?.id)||duplicateIds(cp.incidents,x=>x?.id)||duplicateIds(cp.outbox,x=>x?.id))errors.push('control-plane-id');for(const e of cp.events){if(!Number.isInteger(Number(e?.sequence))||Number(e.sequence)<=0||!/^[a-f0-9]{64}$/i.test(String(e?.hash||''))||!/^[a-f0-9]{64}$/i.test(String(e?.previousHash||'')))errors.push('control-plane-event');}const eventIds=new Set(cp.events.map(x=>x?.id));for(const row of cp.outbox)if(row?.delivered!==true&&!eventIds.has(row?.eventId)&&row?.payload?.id!==row?.eventId)errors.push('control-plane-outbox-reference');}}
    if(Array.isArray(s?.domainRuntime?.commands)&&s.domainRuntime.commands.length>STATE_LIMITS.domainCommands)errors.push('domain-command-capacity');if(Array.isArray(s?.businessLedger?.events)&&s.businessLedger.events.length>STATE_LIMITS.businessEvents)errors.push('business-event-capacity');
    const bw=s?.businessWorld;if(bw!==undefined){if(!object(bw)||!object(bw.parties)||!object(bw.relationships)||!Number.isInteger(Number(bw.sequence))||Number(bw.sequence)<0)errors.push('business-world-shape');else{const caps={events:STATE_LIMITS.businessWorldEvents,opportunities:STATE_LIMITS.businessWorldOpportunities,sponsorships:STATE_LIMITS.businessWorldSponsorships,campaigns:STATE_LIMITS.businessWorldCampaigns,competitorActivity:STATE_LIMITS.businessWorldCompetitorActivity};for(const [key,limit] of Object.entries(caps)){const rows=bw[key];if(!Array.isArray(rows))errors.push('business-world-'+key+'-shape');else{if(rows.length>limit)errors.push('business-world-'+key+'-capacity');if(duplicateIds(rows,x=>x?.id))errors.push('business-world-'+key+'-id');}}if(Object.keys(bw.parties).length>STATE_LIMITS.businessWorldParties)errors.push('business-world-party-capacity');if(Object.keys(bw.relationships).length>STATE_LIMITS.businessWorldRelationships)errors.push('business-world-relationship-capacity');for(const [id,p] of Object.entries(bw.parties))if(!id||!object(p)||p.id!==id||!String(p.legalName||p.displayName||'').trim()||!Array.isArray(p.roles)||!Array.isArray(p.sectors))errors.push('business-world-party');for(const [id,r] of Object.entries(bw.relationships))if(!id||!object(r)||r.id!==id||!bw.parties[r.partyId]||!String(r.company||'').trim()||!Array.isArray(r.roles))errors.push('business-world-relationship');}}
    return {ok:errors.length===0,errors:[...new Set(errors)]};
  }
  const API=Object.freeze({VERSION,SAVE_SCHEMA_VERSION,STATE_LIMITS,ROUTE_FLEET_CAPACITY,normalize,validate,migrateLegacy});globalThis.GH_SAVE_SCHEMA=API;if(globalThis.window&&globalThis.window!==globalThis)globalThis.window.GH_SAVE_SCHEMA=API;if(typeof module!=='undefined'&&module.exports)module.exports=API;
})();

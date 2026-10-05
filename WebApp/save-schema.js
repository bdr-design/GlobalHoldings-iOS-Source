(()=>{
  'use strict';
  const VERSION='3.0.0',SAVE_SCHEMA_VERSION='3.0.0';
  const ROUTE_TYPES=new Set(['air','sea','road']),ASSET_PHASES=new Set(['idle','delivery','turnaround','moving']);
  const ROUTE_FLEET_CAPACITY=Object.freeze({air:24,sea:24,road:64});
  const BUILTIN_ROUTES=new Set(['AIR_RUH_LHR','AIR_DXB_SIN','SEA_SIN_JED','SEA_RTM_NYC','ROAD_RUH_JED','ROAD_DXB_RUH']);
  const STATE_LIMITS=Object.freeze({customRoutes:960,routeEndpoints:1440,routeCache:160,routePoints:2048,routeBytes:256*1024,routeCacheBytes:512*1024,controlEvents:240,controlCommands:120,controlIncidents:80,controlOutbox:100,controlBlackBox:120,domainCommands:240,businessEvents:240,businessWorldEvents:240,businessWorldOpportunities:120,businessWorldSponsorships:60,businessWorldCompetitorActivity:120,businessWorldParties:500,businessWorldRelationships:1500,authorizationPeople:64,authorizationSeals:256,authorizationMandates:512,authorizationProofs:4000,authorizationSealBytes:32768,documentProofs:5000});
  const metricClock=()=>globalThis.performance?.now?.()??Date.now();
  const fleetData=()=>{const api=globalThis.GH_FLEET_DATA||(typeof require==='function'?require('./fleet-access-core.js'):null);if(!api)throw new Error('fleet-data-access-unavailable');return api;};
  // Save validation only needs this projection of each asset. Fleet Data
  // keeps the store behind its boundary and avoids constructing a full view.
  const FLEET_VALIDATION_FIELDS=Object.freeze(['id','name','model','status','city','country','code','iata','icao','detail','capacity','icon','year','gates','landingFeePerTon','jetA1Price','congestion','berths','maxDraftM','craneCount','bays','runwayM','elevationM','dryStorageTEU','reeferPlugs','crudeStorageBbl','fuelBunkerBbl','photo','coords','assetMode','type','ownerCompanyId','companyId','baseFacility','phase','progress','fuel','condition','routeId','releaseExclusiveRouteOnArrival']);
  function forEachSaveAsset(state,fn){
    // Validation only reads the projection (raw: no read-only proxies, one read plan per scan).
    fleetData().forEachFields(state,FLEET_VALIDATION_FIELDS,fn,{raw:true});
  }
  // Build 358 (million-asset validation): the asset checks run once per class of rows that read identically
  // (GH_FLEET_STORE.forEachClass), with progress, fuel and condition at each class's extremes. Every asset check is a
  // per-field interval check on those three or depends only on class-level values, and errors are a set, so the result
  // is the per-row result. fn(asset,count,info) also gets the class size (0 for an extreme) and its first row index.
  // options.assetScan==='rows' keeps the per-row scan (count 1 per asset) as the reference for equivalence tests.
  const FLEET_NUMERIC_FIELDS=Object.freeze(['progress','fuel','condition']);
  function forEachSaveAssetClass(state,fn,rows=false){
    if(rows){forEachSaveAsset(state,(asset,index)=>fn(asset,1,{index}));return;}
    fleetData().forEachFieldClasses(state,FLEET_VALIDATION_FIELDS,fn,{numeric:FLEET_NUMERIC_FIELDS});
  }
  const runtimeTelemetry={lastValidation:null,samples:[]};
  // Phase 1B-B: wall-clock pacing/scheduler telemetry is runtime-only. Older
  // Build 339 saves may still contain the former simulationEngine.snapshot()
  // payload inside simulationKernel; retain only semantic/audit fields there.
  const SIMULATION_KERNEL_RUNTIME_KEYS=Object.freeze([
    'version','frames','slices','chunks','hours','days','conflicts','cancels',
    'maxChunkMs','lastChunkMs','longTasks','hardTasks','droppedRealSeconds','backlogClamps','stallGaps',
    'maxCreateMs','lastCreateMs','maxFinishMs','lastFinishMs','maxCycleMs','lastCycleMs',
    'lastError','lastBoundary','lastSliceSeconds','lastMaintenanceHour','lastCancelReason','lastCommitReason','lastWorkStage',
    'governor','avgChunkMs','avgWorkMs','manualFailures','manualThrottleYields','lastProgressSim','lastProgressAt',
    'simSeconds','speed','backlog','jobActive','jobReadyToFinish','jobSlice','jobSpeed','hidden','manualAdvance',
    'pacing','config','coreVersion','transactionVersion'
  ]);
  function normalizeSimulationKernel(value){const kernel=object(value)?value:{};for(const key of SIMULATION_KERNEL_RUNTIME_KEYS)delete kernel[key];return kernel;}
  function publishValidationMetric(metric){const row={...metric,recordedAtMs:Date.now()};runtimeTelemetry.lastValidation=row;runtimeTelemetry.samples.push(row);if(runtimeTelemetry.samples.length>32)runtimeTelemetry.samples.shift();return row;}
  function object(v){return !!v&&typeof v==='object'&&!Array.isArray(v);}
  function finite(v){if(typeof v==='number')return Number.isFinite(v);return v!==null&&v!==''&&typeof v!=='boolean'&&Number.isFinite(Number(v));}
  function dataId(v){return /^[A-Za-z][A-Za-z0-9]*(?:[._-][A-Za-z0-9]+)*$/.test(String(v||''));}
  function structured(v){if(typeof globalThis.structuredClone==='function')try{return globalThis.structuredClone(v);}catch(_e){}return JSON.parse(JSON.stringify(v));}
  function validPoint(point){return Array.isArray(point)&&point.length>=2&&typeof point[0]==='number'&&Number.isFinite(point[0])&&typeof point[1]==='number'&&Number.isFinite(point[1])&&point[0]>=-90&&point[0]<=90&&point[1]>=-180&&point[1]<=180;}
  function serializedBytes(value){try{const json=typeof value==='string'?value:JSON.stringify(value);return globalThis.TextEncoder?new TextEncoder().encode(json).byteLength:json.length*2;}catch(_error){return Infinity;}}
  // Build 359 (iPhone diagnostic: every save spent 49-153 ms in this validation): the byte limits of the two proof
  // archives (13 MB + 2.3 MB) were checked by stringifying and UTF-8 encoding them whole on every save. A sealed member
  // is deep-frozen (GH_TRANSACTION_CORE), so its size is measured once and kept by identity; the size of the map is
  // exactly the size of its JSON: braces, commas, quoted keys, colons and member sizes.
  const SEALED_BYTES=new WeakMap();
  function memberBytes(value){
    if(!value||typeof value!=='object'||globalThis.GH_TRANSACTION_CORE?.isSealed?.(value)!==true)return serializedBytes(value);
    let n=SEALED_BYTES.get(value);if(n===undefined){n=serializedBytes(value);SEALED_BYTES.set(value,n);}return n;
  }
  // Routes: a checked point [lat,lng] is at most 54 bytes of JSON (two numbers of at most 25 characters, brackets and
  // a comma), so a route is within its byte limit when its other fields plus 54 bytes per point are; only a route near
  // the limit (or with longer points) is stringified to measure it exactly.
  function routeWithinBytes(route,limit){
    const points=route.route;for(let i=0;i<points.length;i++)if(points[i].length!==2)return serializedBytes(route)<=limit;
    const rest={...route};delete rest.route;if(serializedBytes(rest)+12+points.length*54<=limit)return true;
    return serializedBytes(route)<=limit;
  }
  function mapBytes(map){
    let n=2,entries=0;
    for(const key of Object.keys(map)){const value=map[key];if(value===undefined||typeof value==='function'||typeof value==='symbol')continue;n+=serializedBytes(JSON.stringify(key))+1+memberBytes(value);entries++;if(n===Infinity)return n;}
    return n+Math.max(0,entries-1);
  }
  function financeSequence(value){const matches=String(value||'').match(/(\d+)(?!.*\d)/);if(!matches)return 0;const n=Number(matches[1]);return Number.isSafeInteger(n)&&n>=0?n:0;}
  function compactDigestV2(value){
    if(!object(value))return value;
    const sources=Array.isArray(value.sources)?value.sources:[],ids=[...(Array.isArray(value.sourceDocumentIds)?value.sourceDocumentIds:[]),...sources.flatMap(row=>[row?.id,row?.sourceRef])].map(String).filter(Boolean),maxSequence=Math.max(Number(value.maxSequence)||0,...ids.map(financeSequence)),firstId=String(value?.idRange?.[0]||ids[0]||''),lastId=String(value?.idRange?.[1]||ids.at(-1)||'');
    const daily=Array.isArray(value.recentDaily)?value.recentDaily.filter(object).slice(-30).map(row=>({day:Math.max(0,Math.floor(Number(row.day)||0)),income:Math.max(0,Number(row.income)||0),expense:Math.max(0,Number(row.expense)||0),intercompany:Math.max(0,Number(row.intercompany)||0),count:Math.max(0,Math.floor(Number(row.count)||0)),total:Math.max(0,Number(row.total)||0)})):[];
    return {schema:'gh-finance-audit-digest-v2',id:String(value.id||`AUD-${String(value.kind||'legacy')}`),kind:String(value.kind||''),count:Math.max(1,Math.floor(Number(value.count)||sources.length||1)),total:Math.max(0,Number(value.total)||0),firstAt:Math.max(0,Number(value.firstAt)||0),lastAt:Math.max(0,Number(value.lastAt)||0),idRange:[firstId,lastId],checksum:String(value.checksum||''),maxSequence:Math.max(0,Math.floor(maxSequence)),intercompanyTotal:Math.max(0,Number(value.intercompanyTotal)||0),recentDaily:daily,at:Math.max(0,Number(value.at)||0)};
  }
  // Build 358: the check is a pure function of the text, so each distinct value is inspected once (thousands of
  // assets share model, status and icon texts; names are inspected once each instead of on every save).
  // One memo per (inspector, allowEmpty, maximum), keyed by the text itself: no key string is built per call, and a
  // repeated string hashes once.
  const DISPLAY_TEXT_MEMO=new Map(),DISPLAY_TEXT_MEMO_LIMIT=50000;let displayTextMemoSize=0;
  function displayTextMemo(maximum,allowEmpty,inspector=globalThis.GH_IDENTITY?.inspectPlainText){
    const group=(inspector?2:0)+(allowEmpty?1:0);let byMaximum=DISPLAY_TEXT_MEMO.get(group);if(!byMaximum){byMaximum=new Map();DISPLAY_TEXT_MEMO.set(group,byMaximum);}
    let memo=byMaximum.get(maximum);if(!memo){memo=new Map();byMaximum.set(maximum,memo);}return memo;
  }
  function safeDisplayText(value,maximum=240,{allowEmpty=true}={}){
    if(value==null)return allowEmpty;const raw=typeof value==='string'?value:String(value),inspector=globalThis.GH_IDENTITY?.inspectPlainText;
    let memo=null;if(raw.length<=512){memo=displayTextMemo(maximum,allowEmpty,inspector);const known=memo.get(raw);if(known!==undefined)return known;}
    let result;const inspected=inspector?.(raw,{minimum:allowEmpty?0:1,maximum,allowEmpty});if(inspected)result=inspected.ok===true;else{const text=raw.trim();result=(allowEmpty||Boolean(text))&&text.length<=maximum&&!/[<>\u0000-\u001f\u007f\u202a-\u202e\u2066-\u2069]/u.test(text);}
    if(memo){if(displayTextMemoSize>=DISPLAY_TEXT_MEMO_LIMIT){DISPLAY_TEXT_MEMO.clear();displayTextMemoSize=0;}else{memo.set(raw,result);displayTextMemoSize++;}}
    return result;
  }
  function safeAttributeText(value,maximum=240,{allowEmpty=false}={}){return safeDisplayText(value,maximum,{allowEmpty})&&!/"/.test(String(value??''));}
  function safeLocalImage(value){const text=String(value||'');return /^assets\/[a-zA-Z0-9_.\/-]+\.(?:svg|png|jpe?g|webp)$/i.test(text)&&!text.split('/').includes('..');}
  function validSavedLogo(value){
    if(value==null||value==='')return true;const inspector=globalThis.GH_IDENTITY?.inspectCustomLogo;if(typeof inspector==='function')return inspector(value).ok;return safeLocalImage(value);
  }
  function validateIdentityState(s,errors){
    const profile=object(s?.profile)?s.profile:{};for(const [key,maximum,required] of [['name',120,true],['legalName',120,false],['tradeName',120,false],['shortName',28,false],['founder',120,false],['englishName',120,false],['city',100,false],['country',100,false]])if(profile[key]!=null&&!safeDisplayText(profile[key],maximum,{allowEmpty:!required}))errors.push(`identity-profile-${key}`);if(!validSavedLogo(profile.logo))errors.push('identity-profile-logo');for(const source of [profile.logoVariants,profile.identity?.logos])if(object(source))for(const [usage,logo] of Object.entries(source))if(!validSavedLogo(logo))errors.push(`identity-profile-logo:${usage}`);
    const registry=object(s?.companyRegistry)?s.companyRegistry:{};for(const [company,row] of Object.entries(registry)){if(!dataId(company))errors.push(`identity-company-id:${company}`);if(!object(row)){errors.push(`identity-company-shape:${company}`);continue;}for(const [key,maximum,required] of [['name',120,false],['legalName',120,false],['tradeName',120,false],['shortName',28,false],['owner',120,false],['authorizedSignatory',120,false],['mapName',48,false]])if(row[key]!=null&&!safeDisplayText(row[key],maximum,{allowEmpty:!required}))errors.push(`identity-company-${key}:${company}`);for(const key of ['taxId','commercialRegistration','businessLicense','formationContract','bankAccount','documentPrefix','accountPrefix'])if(row[key]!=null&&!safeAttributeText(row[key],180,{allowEmpty:true}))errors.push(`identity-company-${key}:${company}`);if(!validSavedLogo(row.logo))errors.push(`identity-company-logo:${company}`);for(const source of [row.logoVariants,row.identity?.logos])if(object(source))for(const [usage,logo] of Object.entries(source))if(!validSavedLogo(logo))errors.push(`identity-company-logo:${company}:${usage}`);}
    if(s?.openedCompanies!==undefined&&(!Array.isArray(s.openedCompanies)||s.openedCompanies.some(company=>!dataId(company))||new Set(s.openedCompanies).size!==s.openedCompanies.length))errors.push('identity-opened-companies');
    const formation=s?.companyRegistry?.group?.formationDocument;if(object(formation))for(const [key,maximum] of [['name',120],['shortName',28],['founder',120],['city',100],['country',100],['englishName',120]])if(formation[key]!=null&&!safeDisplayText(formation[key],maximum))errors.push(`identity-formation-${key}`);
  }
  function validateConferenceLogoState(s,errors){
    const conference=s?.advanced?.conference;if(!object(conference))return;const archive=Array.isArray(conference.archive)?conference.archive:[];if(archive.length>20)errors.push('identity-conference-archive-capacity');const rows=[conference.current,...archive.slice(0,20)].filter(object);
    const checkBrand=(brand,label)=>{if(!object(brand))return;if(brand.logo!=null&&!validSavedLogo(brand.logo))errors.push(`identity-conference-logo:${label}`);if(object(brand.variants))for(const [usage,logo] of Object.entries(brand.variants))if(!validSavedLogo(logo))errors.push(`identity-conference-logo:${label}:${usage}`);};
    const checkText=(value,maximum,label)=>{if(value!=null&&!safeDisplayText(value,maximum))errors.push(`identity-conference-text:${label}`);},checkMetrics=(metrics,label)=>{const values=Array.isArray(metrics)?metrics:[];if(values.length>128)errors.push('identity-conference-metric-capacity');for(const [metricIndex,metric] of values.slice(0,128).entries()){checkText(metric?.id,100,`${label}:metric:${metricIndex}:id`);checkText(metric?.label,180,`${label}:metric:${metricIndex}:label`);checkText(metric?.value,500,`${label}:metric:${metricIndex}:value`);}};
    const checkContribution=(contribution,label)=>{if(!object(contribution))return;for(const [key,maximum] of [['id',100],['chapterId',100],['title',180],['kicker',120],['headline',240],['subtitle',240],['caption',500],['presenter',120],['role',160],['kind',80],['templateId',80]])checkText(contribution[key],maximum,`${label}:${key}`);checkMetrics(contribution.metrics,label);const lines=Array.isArray(contribution.narration?.lines)?contribution.narration.lines:Array.isArray(contribution.narration)?contribution.narration:[];if(lines.length>128)errors.push('identity-conference-narration-capacity');for(const [lineIndex,line] of lines.slice(0,128).entries())checkText(line,500,`${label}:narration:${lineIndex}`);};
    for(const [index,row] of rows.entries()){
      const snapshot=row.snapshot;if(object(snapshot)){const group=snapshot.group;checkBrand(group?.brand,`${index}:group`);for(const [key,maximum] of [['name',180],['founder',120],['shortName',40],['creditRating',40],['priority',240]])checkText(group?.[key],maximum,`${index}:group:${key}`);const companies=Array.isArray(snapshot.companies)?snapshot.companies:[];if(companies.length>1024)errors.push('identity-conference-company-capacity');for(const [companyIndex,company] of companies.slice(0,1024).entries()){checkBrand(company?.brand,`${index}:company:${companyIndex}`);for(const [key,maximum] of [['type',100],['companyId',100],['legalName',180],['tradeName',180],['shortName',40],['priority',240]])checkText(company?.[key],maximum,`${index}:company:${companyIndex}:${key}`);for(const [personIndex,person] of [company?.manager,...(Array.isArray(company?.executives)?company.executives.slice(0,64):[])].filter(object).entries()){checkText(person.name,120,`${index}:company:${companyIndex}:person:${personIndex}:name`);checkText(person.role,160,`${index}:company:${companyIndex}:person:${personIndex}:role`);}const contributions=Array.isArray(company?.conferenceContributions)?company.conferenceContributions:[];if(contributions.length>128)errors.push('identity-conference-contribution-capacity');for(const [contributionIndex,contribution] of contributions.slice(0,128).entries())checkContribution(contribution,`${index}:company:${companyIndex}:contribution:${contributionIndex}`);}const achievements=Array.isArray(snapshot.achievements)?snapshot.achievements:[];if(achievements.length>256)errors.push('identity-conference-achievement-capacity');for(const [achievementIndex,achievement] of achievements.slice(0,256).entries()){checkText(achievement?.title,180,`${index}:achievement:${achievementIndex}:title`);checkText(achievement?.detail,500,`${index}:achievement:${achievementIndex}:detail`);}const comments=Array.isArray(snapshot.social?.comments)?snapshot.social.comments:[];if(comments.length>256)errors.push('identity-conference-comment-capacity');for(const [commentIndex,comment] of comments.slice(0,256).entries()){checkText(comment?.handle,100,`${index}:comment:${commentIndex}:handle`);checkText(comment?.country,100,`${index}:comment:${commentIndex}:country`);checkText(comment?.text,500,`${index}:comment:${commentIndex}:text`);}}
      const modes=row.presentation?.planBundle?.modes;if(object(modes))for(const mode of ['full','brief','manual']){const scenes=Array.isArray(modes[mode])?modes[mode]:[];if(scenes.length>2048)errors.push('identity-conference-scene-capacity');for(const [sceneIndex,scene] of scenes.slice(0,2048).entries()){if(scene?.logo!=null&&!validSavedLogo(scene.logo))errors.push(`identity-conference-plan-logo:${index}:${mode}:${sceneIndex}`);checkContribution(scene,`${index}:${mode}:${sceneIndex}`);checkText(scene?.chartUnit,100,`${index}:${mode}:${sceneIndex}:chartUnit`);}}
    }
  }
  function validatePresentationTextState(s,errors,includeFleet=true,rowScan=false){
    const entityFields=[['name',180],['model',180],['status',80],['city',100],['country',100],['code',40],['iata',12],['icao',12],['detail',500],['capacity',180],['icon',16]],entityNumericFields=['year','gates','landingFeePerTon','jetA1Price','congestion','berths','maxDraftM','craneCount','bays','runwayM','elevationM','dryStorageTEU','reeferPlugs','crudeStorageBbl','fuelBunkerBbl'];
    // Per-field memos resolved once per validation: a known text is answered with one lookup (same result as safeDisplayText).
    const textChecks=entityFields.map(([key,maximum])=>[key,maximum,displayTextMemo(maximum,true)]);
    const validateEntity=(bucket,row)=>{if(!object(row))return;for(const [key,maximum,memo] of textChecks){const value=row[key];if(value==null)continue;const known=typeof value==='string'?memo.get(value):undefined;if(known===true)continue;if(known===false||!safeDisplayText(value,maximum))errors.push(`display-text-${bucket}-${key}`);}for(const key of entityNumericFields)if(row[key]!=null&&!finite(row[key]))errors.push(`display-number-${bucket}-${key}`);if(row.id!=null&&!safeAttributeText(row.id,180))errors.push(`display-attribute-${bucket}-id`);if(row.name!=null&&!safeAttributeText(row.name,180,{allowEmpty:true}))errors.push(`display-attribute-${bucket}-name`);if(row.photo!=null&&row.photo!==''&&!safeLocalImage(row.photo))errors.push(`display-image-${bucket}-photo`);if(row.coords!=null&&!validPoint(row.coords))errors.push(`display-coords-${bucket}`);};
    if(includeFleet)forEachSaveAssetClass(s,row=>validateEntity('assets',row),rowScan);for(const [bucket,rows] of [['globalBases',s?.globalBases],['customHubs',s?.customHubs],['branches',s?.branches]])for(const row of Array.isArray(rows)?rows:[])validateEntity(bucket,row);
    for(const row of Array.isArray(s?.simulationWorld?.competitors)?s.simulationWorld.competitors:[])if(object(row))for(const [key,maximum] of [['name',180],['sector',120],['hq',100],['strategy',240],['marketShare',40],['risk',40]])if(row[key]!=null&&!safeDisplayText(row[key],maximum))errors.push(`display-text-competitor-${key}`);
    for(const row of Array.isArray(s?.simulationWorld?.competitorAssets)?s.simulationWorld.competitorAssets:[])if(object(row))for(const [key,maximum] of [['name',180],['company',180],['type',40],['icon',16]])if(row[key]!=null&&!safeDisplayText(row[key],maximum))errors.push(`display-text-competitor-asset-${key}`);
    for(const [id,row] of Object.entries(object(s?.routeEndpoints)?s.routeEndpoints:{}))if(object(row)){if(!safeAttributeText(id,180)||row.id!=null&&!safeAttributeText(row.id,180))errors.push('display-attribute-route-endpoint-id');for(const [key,maximum] of [['name',180],['city',100],['country',100],['code',40],['iata',12],['icao',12],['detail',500],['kind',60],['icon',16]])if(row[key]!=null&&!safeDisplayText(row[key],maximum))errors.push(`display-text-route-endpoint-${key}`);if(row.name!=null&&!safeAttributeText(row.name,180,{allowEmpty:true}))errors.push('display-attribute-route-endpoint-name');for(const key of ['gates','landingFeePerTon','jetA1Price','congestion','berths','maxDraftM','craneCount','bays','runwayM','elevationM','dryStorageTEU','reeferPlugs','crudeStorageBbl','fuelBunkerBbl'])if(row[key]!=null&&!finite(row[key]))errors.push(`display-number-route-endpoint-${key}`);if(row.photo!=null&&row.photo!==''&&!safeLocalImage(row.photo))errors.push('display-image-route-endpoint-photo');}
    for(const row of Array.isArray(s?.customRoutes)?s.customRoutes:[])if(object(row)){if(row.id!=null&&!safeAttributeText(row.id,180))errors.push('display-attribute-route-id');for(const [key,maximum] of [['name',220],['from',160],['to',160],['routingSource',240]])if(row[key]!=null&&!safeDisplayText(row[key],maximum))errors.push(`display-text-route-${key}`);}
    const market=Array.isArray(s?.market)?s.market:[];for(const row of market)if(object(row)){if(!/^[A-Za-z0-9][A-Za-z0-9._-]{0,19}$/.test(String(row.sym||'')))errors.push('display-market-symbol');if(!safeDisplayText(row.name,120,{allowEmpty:false}))errors.push('display-market-name');for(const key of ['price','change','marketCap','pe','yield'])if(!finite(row[key]))errors.push(`display-market-${key}`);}for(const key of Object.keys(object(s?.portfolio)?s.portfolio:{}))if(!/^[A-Za-z0-9][A-Za-z0-9._-]{0,19}$/.test(key))errors.push('display-portfolio-symbol');
    for(const row of Array.isArray(s?.mobility?.vehicles)?s.mobility.vehicles:[])if(object(row)){if(!safeAttributeText(row.id,180))errors.push('display-attribute-mobility-id');for(const [key,maximum] of [['name',180],['model',180],['assetClass',80],['baseLocation',120],['status',80],['icon',16]])if(row[key]!=null&&!safeDisplayText(row[key],maximum))errors.push(`display-text-mobility-${key}`);}
    const registry=object(s?.contractRegistry)?s.contractRegistry:{};for(const [id,row] of Object.entries(registry))if(object(row)){if(!safeAttributeText(id,180)||row.number!=null&&!safeAttributeText(row.number,180))errors.push('display-attribute-contract-number');for(const [key,maximum] of [['status',80],['number',180],['companyName',180],['counterparty',180],['note',500]])if(row[key]!=null&&!safeDisplayText(row[key],maximum))errors.push(`display-text-contract-${key}`);}
    for(const bucket of ['invoices','payables','receivables'])for(const row of Array.isArray(s?.finance?.[bucket])?s.finance[bucket]:[])if(object(row)){if(row.number!=null&&!safeAttributeText(row.number,180))errors.push(`display-attribute-${bucket}-number`);if(row.id!=null&&!safeAttributeText(row.id,180))errors.push(`display-attribute-${bucket}-id`);for(const [key,maximum] of [['note',500],['counterparty',180],['companyName',180],['method',100],['status',80],['accountId',180],['sourceRef',180]])if(row[key]!=null&&!safeDisplayText(row[key],maximum))errors.push(`display-text-${bucket}-${key}`);}
    for(const row of Array.isArray(s?.finance?.cheques)?s.finance.cheques:[])if(object(row)){if(row.id!=null&&!safeAttributeText(row.id,180))errors.push('display-attribute-cheque-id');if(row.invoiceNumber!=null&&row.invoiceNumber!==''&&!safeAttributeText(row.invoiceNumber,180))errors.push('display-attribute-cheque-invoice');}
    const facilityModels=object(s?.advanced?.facilities)?s.advanced.facilities:{};if(Object.keys(facilityModels).length>2048)errors.push('display-advanced-facility-capacity');for(const [facilityId,model] of Object.entries(facilityModels)){if(!safeAttributeText(facilityId,180)||!object(model)){errors.push('display-advanced-facility-shape');continue;}if(model.manager!=null&&!safeDisplayText(model.manager,180))errors.push('display-text-advanced-facility-manager');}
    for(const report of Array.isArray(s?.finance?.payrollReports)?s.finance.payrollReports:[])for(const [key,maximum] of [['month',80],['day',40]])if(typeof report?.[key]==='string'&&!safeDisplayText(report[key],maximum))errors.push(`display-text-payroll-${key}`);
    return validateEntity;
  }
  function routeMode(route){return String(route?.routeMode||route?.type||'');}
  function routeOwner(route){return String(route?.ownerCompanyId||route?.companyId||route?.company||'');}
  function assetMode(asset){return String(asset?.assetMode||asset?.type||'');}
  function assetOwner(asset){return String(asset?.ownerCompanyId||asset?.companyId||'');}
  function knownRouteMode(mode,state,owner=''){return ROUTE_TYPES.has(mode)||globalThis.GH_COMPANY_PLATFORM?.isKnownRouteMode?.(mode)||(dataId(mode)&&owner&&object(state?.companyRegistry?.[owner]));}
  function knownAssetMode(mode,state,owner=''){return ROUTE_TYPES.has(mode)||globalThis.GH_COMPANY_PLATFORM?.ownerForLegacyAssetMode?.(mode)||(dataId(mode)&&owner&&object(state?.companyRegistry?.[owner]));}
  function routeSignature(route){const points=(Array.isArray(route?.route)?route.route:[]).filter(validPoint).map(point=>`${point[0].toFixed(5)},${point[1].toFixed(5)}`);if(points.length<2)return'';const a=points.join(';'),b=[...points].reverse().join(';');return `${routeOwner(route)||routeMode(route)}:${routeMode(route)}:${a<b?a:b}`;}
  function retiredFeatureKey(){return String.fromCharCode(97,105);}
  function retiredPanelName(){return String.fromCharCode(105,110,116,101,108,108,105,103,101,110,99,101);}
  // Build 358: the catalogue is real models. An owned asset whose catalogue line was replaced takes the real model that
  // line stood for (its legacyIds): the new id, name and specs, so its revenue, fuel, crew and resale follow the model.
  let legacyCatalog=null;
  function catalogByLegacyId(){
    const catalog=globalThis.GH_ASSET_CATALOG;if(!catalog)return null;if(legacyCatalog&&legacyCatalog.source===catalog)return legacyCatalog.map;
    const map=new Map();for(const mode of ['air','sea','road'])for(const item of [...(catalog[mode]?.new||[]),...(catalog[mode]?.used||[])])for(const id of item.legacyIds||[])map.set(id,item);
    legacyCatalog={source:catalog,map};return map;
  }
  function refreshRetiredCatalogAsset(asset){
    if(!object(asset))return false;const item=catalogByLegacyId()?.get(asset.catalogId);if(!item)return false;
    asset.catalogId=item.id;asset.model=item.name;asset.specs=JSON.parse(JSON.stringify(item.specs));return true;
  }
  function transitionalRouteUser(asset){return asset?.phase==='moving'&&asset?.releaseExclusiveRouteOnArrival===true;}
  // Build 358: a route may carry more than its mode's base capacity when its record says so (GH_FLEET_CORE.routeCapacity).
  const ROUTE_MAX_FLEET_CAPACITY=Object.freeze({air:8192,sea:8192,road:8192});
  function routeCapacity(routeOrType,fallbackType=''){
    const type=typeof routeOrType==='string'?routeOrType:(routeMode(routeOrType)||fallbackType),base=ROUTE_FLEET_CAPACITY[type]||1,stored=routeOrType&&typeof routeOrType==='object'?routeOrType.fleetCapacity:undefined;
    return Number.isSafeInteger(stored)&&stored>base?Math.min(stored,ROUTE_MAX_FLEET_CAPACITY[type]||base):base;
  }
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
      for(const [key,limit] of [['events',STATE_LIMITS.businessWorldEvents],['opportunities',STATE_LIMITS.businessWorldOpportunities],['sponsorships',STATE_LIMITS.businessWorldSponsorships],['competitorActivity',STATE_LIMITS.businessWorldCompetitorActivity]])state.businessWorld[key]=Array.isArray(state.businessWorld[key])?state.businessWorld[key].slice(0,limit):[];
      state.businessWorld.parties=object(state.businessWorld.parties)?state.businessWorld.parties:{};
      state.businessWorld.relationships=object(state.businessWorld.relationships)?state.businessWorld.relationships:{};
    }
    if(object(state.businessLedger)&&Array.isArray(state.businessLedger.events))state.businessLedger.events=state.businessLedger.events.slice(0,STATE_LIMITS.businessEvents);
  }
  function migrateLegacy(input){
    if(!object(input))return {state:input,changed:false};
    let state=structured(input),changed=false;const retired=retiredFeatureKey(),companyUpgrade=globalThis.GH_COMPANY_PLATFORM?.migrateState?.(state);
    if(companyUpgrade?.state){state=companyUpgrade.state;changed=companyUpgrade.changed===true;}
    if(Number(state.speed)===5){state.speed=1;changed=true;}
    if(object(state.advanced)&&Object.prototype.hasOwnProperty.call(state.advanced,retired)){delete state.advanced[retired];changed=true;}
    if(object(state.settings)&&Object.prototype.hasOwnProperty.call(state.settings,`${retired}Brief`)){delete state.settings[`${retired}Brief`];changed=true;}
    if([retiredPanelName(),`${retired}Approvals`].includes(state.lastPanel)){state.lastPanel='leadershipHub';changed=true;}
    if(object(state.controlPlane?.registry?.engines)&&Object.prototype.hasOwnProperty.call(state.controlPlane.registry.engines,retired)){delete state.controlPlane;changed=true;}
    if(object(state.domainRuntime)){
      const before=Array.isArray(state.domainRuntime.commands)?state.domainRuntime.commands.length:0;
      state.domainRuntime.commands=(state.domainRuntime.commands||[]).filter(row=>!String(row?.domain||'').toLowerCase().includes(retired)&&!String(row?.actor||'').toLowerCase().includes(retired));if(state.domainRuntime.commands.length!==before)changed=true;
    }
    const proofMigration=globalThis.GH_DOCUMENT_PROOF?.migrateLegacyLedgerProjections?.(state);if(proofMigration?.changed)changed=true;
    const idempotencyMigration=globalThis.GH_DOMAIN_COMMANDS?.migrateIdempotencyState?.(state);if(idempotencyMigration?.changed)changed=true;
    const invalidRouteIds=new Set(),seenRouteIds=new Set();
    state.customRoutes=(Array.isArray(state.customRoutes)?state.customRoutes:[]).filter(route=>{
      const mode=routeMode(route),owner=routeOwner(route);
      if(!object(route)||!route.id||seenRouteIds.has(route.id)||!knownRouteMode(mode,state,owner)||!owner||!route.fromFacility||!route.toFacility||route.fromFacility===route.toFacility||!Array.isArray(route.route)||route.route.length<2||route.route.length>STATE_LIMITS.routePoints||route.route.some(point=>!validPoint(point))||serializedBytes(route)>STATE_LIMITS.routeBytes){if(route?.id)invalidRouteIds.add(route.id);changed=true;return false;}
      seenRouteIds.add(route.id);return true;
    });
    // Writable drafts: the repair below edits assets in place; commit() applies it.
    const fleet=fleetData(),assets=fleet.drafts(state);
    {const legacy=catalogByLegacyId();if(legacy?.size)for(const asset of assets)if(legacy.has(asset.catalogId)){const copy=fleet.plain(asset);if(refreshRetiredCatalogAsset(copy)){asset.catalogId=copy.catalogId;asset.model=copy.model;asset.specs=copy.specs;changed=true;}}}
    for(const delivery of Array.isArray(state.realism?.procurement?.deliveries)?state.realism.procurement.deliveries:[]){if(fleetData().isCompactReceipt(delivery)){const rows=fleetData().receiptAssets(delivery);let refreshed=false;for(const asset of rows)if(refreshRetiredCatalogAsset(asset))refreshed=true;if(refreshed){delivery.assets=rows;delete delivery.assetReceipt;fleetData().compactReceipt(delivery);changed=true;}continue;}for(const asset of Array.isArray(delivery?.assets)?delivery.assets:delivery?.asset?[delivery.asset]:[])if(refreshRetiredCatalogAsset(asset))changed=true;}
    for(const asset of assets)if(asset.routeId&&invalidRouteIds.has(asset.routeId)){clearLegacyRouteAssignment(asset);changed=true;}
    const routeById=new Map(state.customRoutes.map(route=>[route.id,route])),assignmentGroups=new Map();for(const asset of assets)if(asset.routeId){const rows=assignmentGroups.get(asset.routeId)||[];rows.push(asset);assignmentGroups.set(asset.routeId,rows);}
    for(const [routeId,rows] of assignmentGroups)if(rows.length>1){
      const type=routeMode(routeById.get(routeId))||assetMode(rows[0]);
      if(['air','sea','road'].includes(type)){
        const capacity=routeCapacity(routeById.get(routeId)||type,type),used=new Set(),ordered=[...rows].sort((a,b)=>Number(b.phase==='moving')-Number(a.phase==='moving')||(Number.isInteger(a.routeSlot)?a.routeSlot:capacity)-(Number.isInteger(b.routeSlot)?b.routeSlot:capacity)||String(a.id).localeCompare(String(b.id)));
        for(const asset of ordered){
          if(assetMode(asset)!==type){clearLegacyRouteAssignment(asset);changed=true;continue;}
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
      const ids=new Set(routes.map(route=>route.id)),users=assets.filter(asset=>ids.has(asset.routeId)),type=routeMode(routes[0]);
      if(['air','sea','road'].includes(type)){
        const canonical=routes.slice().sort((a,b)=>users.filter(asset=>asset.routeId===b.id).length-users.filter(asset=>asset.routeId===a.id).length||String(a.id).localeCompare(String(b.id)))[0],capacity=routeCapacity(canonical,type),accepted=[],retained=new Set([canonical.id]);
        for(const asset of users.slice().sort((a,b)=>Number(b.phase==='moving')-Number(a.phase==='moving')||Number(b.routeId===canonical.id)-Number(a.routeId===canonical.id)||String(a.id).localeCompare(String(b.id)))){
          const compatible=assetMode(asset)===type&&routeOwner(canonical)===(assetOwner(asset)||globalThis.GH_COMPANY_PLATFORM?.ownerForLegacyAssetMode?.(assetMode(asset))||assetMode(asset))&&[canonical.fromFacility,canonical.toFacility].includes(asset.baseFacility);
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
    fleet.commit(state,assets);
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
    s.saveVersion=SAVE_SCHEMA_VERSION;s.saveRevision=Math.max(0,Math.floor(Number(s.saveRevision)||0));s.simSeconds=Math.max(0,Number(s.simSeconds)||0);s.lastFinancialDay=Math.max(0,Math.floor(Number(s.lastFinancialDay)||0));s.lastMarketHour=Math.max(0,Math.floor(Number(s.lastMarketHour)||0));if(Number(s.speed)===5)s.speed=1;
    // A legacy defaults object can still carry `assets: []`. Once fleet
    // migration has produced a v3 store, never let that default reintroduce
    // array mode into the normalized state.
    if(fleetData().mode(s)==='store')delete s.assets;
    s.timeRecovery=object(s.timeRecovery)?s.timeRecovery:{};s.timeRecovery.queue=Array.isArray(s.timeRecovery.queue)?s.timeRecovery.queue:[];s.simulationKernel=normalizeSimulationKernel(s.simulationKernel);s.simulationWorld=object(s.simulationWorld)?s.simulationWorld:{};s.determinism=object(s.determinism)?s.determinism:{};s.sequences=object(s.sequences)?s.sequences:{};
    if(object(s.finance)){s.finance.journalEntries=Array.isArray(s.finance.journalEntries)?s.finance.journalEntries:[];s.finance.periods=Array.isArray(s.finance.periods)?s.finance.periods:[];if(s.finance.auditArchive!=null&&!object(s.finance.auditArchive))s.finance.auditArchive={records:{},digests:[]};if(object(s.finance.auditArchive)){s.finance.auditArchive.records=object(s.finance.auditArchive.records)?s.finance.auditArchive.records:{};s.finance.auditArchive.digests=(Array.isArray(s.finance.auditArchive.digests)?s.finance.auditArchive.digests:[]).map(compactDigestV2);}}
    s.customRoutes=Array.isArray(s.customRoutes)?s.customRoutes:[];for(const route of s.customRoutes)if(object(route)){if(!route.routeMode&&route.type)route.routeMode=route.type;if(!route.ownerCompanyId){const owner=route.companyId||route.company||globalThis.GH_COMPANY_PLATFORM?.ownerForLegacyRouteMode?.(route.routeMode);if(owner)route.ownerCompanyId=owner;}}
    s.routeEndpoints=object(s.routeEndpoints)?s.routeEndpoints:{};s.routeCache=object(s.routeCache)?s.routeCache:{};migrationTrim(s);
    globalThis.GH_FACILITY_CORE?.migrateAssetCapacity?.(s);
    // Build 358: fleet purchases are zero-rated; reverse the input VAT older saves carried for them (once, see finance-core).
    if(object(s.finance)&&object(s.companyFinance))globalThis.GH_FINANCE_CORE?.zeroRateFleetPurchaseVat?.(s);
    // Build 358: delivered receipts saved with full asset copies are stored compactly (lossless, see fleet-access-core).
    for(const delivery of Array.isArray(s.realism?.procurement?.deliveries)?s.realism.procurement.deliveries:[])fleetData().compactReceipt(delivery);
    return s;
  }
  function duplicateIds(rows,getId=x=>x?.id){const seen=new Set();for(const row of Array.isArray(rows)?rows:[]){const id=String(getId(row)||'');if(!id||seen.has(id))return true;seen.add(id);}return false;}
  function validDigest(value){return /^[a-f0-9]{64}$/i.test(String(value||''));}
  // Build 350 verified-once ledger. Re-verifying every authorization proof and document record on every hourly commit, every
  // save and every command made validation cost grow with play time (SHA-256 in JavaScript plus a deep copy of the proof
  // stores, ~0.4 ms per record). A record that passed full verification is remembered BY OBJECT IDENTITY. The default
  // validate(state) ignores the ledger and verifies everything exactly as before. validate(state,{trustVerified:true}) skips
  // records already in the ledger and always verifies new ones. Contract: proof records are created whole by their owners and
  // never edited in place; an in-place edit of an already verified record is therefore caught by the next full validation
  // (load, import, every 10th save, any plain validate()), not by the trusted ones. Clones inherit trust via inheritVerified().
  const VERIFIED_AUTH_PROOFS=new WeakSet(),VERIFIED_DOC_RECORDS=new WeakMap();
  // Build 358: documents verified against their records, by proof id: the record digest and the exact document JSON.
  const VERIFIED_DOCUMENTS=new Map();
  function inheritVerified(source,target){
    let authorization=0,records=0;
    try{
      const pairs=[[source?.authorization?.proofsById,target?.authorization?.proofsById,'proofDigest',true],[source?.authorization?.proofArchiveById,target?.authorization?.proofArchiveById,'proofDigest',true],[source?.documentProofs?.recordsById,target?.documentProofs?.recordsById,'contentDigest',false],[source?.documentProofs?.archiveById,target?.documentProofs?.archiveById,'contentDigest',false]];
      for(const [from,to,field,isAuthorization] of pairs){
        if(!object(from)||!object(to))continue;
        for(const id of Object.keys(from)){
          const a=from[id],b=to[id];if(!object(a)||!object(b)||a[field]!==b[field])continue;
          if(isAuthorization){if(VERIFIED_AUTH_PROOFS.has(a)&&!VERIFIED_AUTH_PROOFS.has(b)){VERIFIED_AUTH_PROOFS.add(b);authorization++;}}
          else{const known=VERIFIED_DOC_RECORDS.get(a);if(known&&!VERIFIED_DOC_RECORDS.has(b)){VERIFIED_DOC_RECORDS.set(b,known);records++;}}
        }
      }
    }catch(_error){/* trust is an optimisation; failing to inherit only costs a full verification */}
    return {authorization,records};
  }
  // Verifiers normalize the top level of the store they are given (schema, version, alias maps) and only read below
  // it, so a shallow copy keeps validation from writing to the game state. Build 357 deep-cloned both proof stores
  // (~2 MB) whenever a single record or document needed verification. tests/build358-heaviness.cjs runs a full
  // validation with every nested proof object frozen.
  function verificationView(root){return root&&typeof root==='object'&&!Array.isArray(root)?{...root}:root;}
  function validateAuthorizationState(s,errors,verificationCache,metric,trust=false){
    const auth=s?.authorization;if(auth===undefined)return;
    if(!object(auth)||auth.schema!=='gh-authorization-v1'){errors.push('authorization-shape');return;}
    const people=auth.peopleById,seals=object(auth.visualSealAssetsById)?auth.visualSealAssetsById:auth.signatureAssetsById,active=object(auth.activeVisualSealByPerson)?auth.activeVisualSealByPerson:auth.activeSignatureByPerson,mandates=auth.mandatesById,proofs=auth.proofsById;
    const archived=auth.proofArchiveById||{};if(!object(archived)){errors.push('authorization-proof-archive-shape');return;}if(mapBytes(archived)>8*1024*1024)errors.push('authorization-proof-archive-byte-limit');for(const id of Object.keys(archived))if(Object.prototype.hasOwnProperty.call(proofs||{},id))errors.push('authorization-proof-residency-conflict');const allProofs={...archived,...proofs};
    if(!object(people)||!object(seals)||!object(active)||!object(mandates)||!object(proofs)){errors.push('authorization-shape');return;}
    if(Object.keys(people).length>STATE_LIMITS.authorizationPeople)errors.push('authorization-people-capacity');if(Object.keys(seals).length>STATE_LIMITS.authorizationSeals)errors.push('authorization-seal-capacity');if(Object.keys(mandates).length>STATE_LIMITS.authorizationMandates)errors.push('authorization-mandate-capacity');if(Object.keys(proofs).length>STATE_LIMITS.authorizationProofs)errors.push('authorization-proof-capacity');
    for(const [id,row] of Object.entries(people))if(!id||!object(row)||row.id!==id||!String(row.legalName||'').trim())errors.push('authorization-person');
    for(const [id,row] of Object.entries(seals)){
      const strokes=row?.strokes,pointCount=Array.isArray(strokes)?strokes.reduce((sum,stroke)=>sum+(Array.isArray(stroke)?stroke.length:9000),0):9000;
      const basic=!id||!object(row)||row.id!==id||!people[row.ownerPersonId]||!Array.isArray(strokes)||!strokes.length||strokes.length>64||pointCount>8192||serializedBytes(strokes)>STATE_LIMITS.authorizationSealBytes||!validDigest(row.digest),validator=globalThis.GH_AUTHORIZATION?.validateVisualSeal;
      if(basic||typeof validator!=='function'||!validator(row).ok)errors.push('authorization-seal');
    }
    for(const [personId,sealId] of Object.entries(active))if(!people[personId]||!seals[sealId]||seals[sealId].ownerPersonId!==personId||seals[sealId].status!=='active')errors.push('authorization-active-seal');
    for(const [id,row] of Object.entries(mandates))if(!id||!object(row)||row.id!==id||!people[row.principalId]||!Array.isArray(row.companyIds)||!row.companyIds.length||row.companyIds.length>120||!Array.isArray(row.scopes)||!row.scopes.length||row.scopes.length>120||!Number.isSafeInteger(Number(row.version))||Number(row.version)<1)errors.push('authorization-mandate');
    const verifier=globalThis.GH_AUTHORIZATION?.verifyProof;let verificationState=null,verificationStateBuilt=false;const stateForVerification=()=>{if(!verificationStateBuilt){verificationStateBuilt=true;verificationState=typeof verifier==='function'?{...s,authorization:verificationView(auth)}:null;}return verificationState;};
    const proofVerificationStart=metric?metricClock():0;for(const [id,row] of Object.entries(allProofs)){if(!id||!object(row)||row.id!==id||!people[row.signerPersonId]||!seals[row.signatureAssetId||row.visualSealAssetId]||!mandates[row.mandateId]||!validDigest(row.signatureDigest||row.visualSealDigest)||!validDigest(row.payloadDigest)||!validDigest(row.proofDigest)||!Array.isArray(row.documentDigests)||row.documentDigests.some(value=>!validDigest(value)))errors.push('authorization-proof');else if(trust&&VERIFIED_AUTH_PROOFS.has(row)){/* verified earlier in this process */}else if(typeof verifier!=='function')errors.push('authorization-proof-integrity');else if(!verifier(stateForVerification(),id,verificationCache?.authorization).ok)errors.push('authorization-proof-integrity');else VERIFIED_AUTH_PROOFS.add(row);}if(metric)metric.authorizationProofVerifyMs+=Math.max(0,metricClock()-proofVerificationStart);
  }
  function validateDocumentProofState(s,errors,verificationCache,metric,trust=false){
    const store=s?.documentProofs;if(store===undefined)return;
    if(!object(store)||store.schema!=='gh-document-proofs-v1'||!object(store.recordsById)){errors.push('document-proof-shape');return;}
    const archived=store.archiveById||{};if(!object(archived)){errors.push('document-proof-archive-shape');return;}if(mapBytes(archived)>16*1024*1024)errors.push('document-proof-archive-byte-limit');for(const id of Object.keys(archived))if(Object.prototype.hasOwnProperty.call(store.recordsById,id))errors.push('document-proof-residency-conflict');const records={...archived,...store.recordsById};if(Object.keys(store.recordsById).length>STATE_LIMITS.documentProofs)errors.push('document-proof-capacity');
    for(const [id,row] of Object.entries(records))if(!id||!object(row)||row.id!==id||!String(row.documentId||'').trim()||!validDigest(row.contentDigest)||(row.form==='archived-document-v1'?Object.prototype.hasOwnProperty.call(row,'signedContent'):!object(row.issuerSnapshot)||!object(row.signedContent))||row.authorizationProofId&&!(s.authorization?.proofsById?.[row.authorizationProofId]||s.authorization?.proofArchiveById?.[row.authorizationProofId]))errors.push('document-proof-record');
    const documentOwner=globalThis.GH_DOCUMENT_PROOF;if(typeof documentOwner?.stateDocuments!=='function'){errors.push('document-proof-owner-unavailable');return;}
    const documentCollectionStart=metric?metricClock():0,documents=documentOwner.stateDocuments(s);if(metric)metric.documentCollectionMs+=Math.max(0,metricClock()-documentCollectionStart);
    // Build 359: earlier versions kept as checkpoints, sealed by one digest per 30-day period (GH_DOCUMENT_PROOF).
    if(store.checkpointsById!==undefined&&(!object(store.checkpointsById)||mapBytes(store.checkpointsById)>8*1024*1024))errors.push('document-proof-checkpoint-byte-limit');
    {const checkpoints=globalThis.GH_DOCUMENT_PROOF?.verifyCheckpoints?.(s,verificationCache?.documents,{fresh:!trust});if(checkpoints&&!checkpoints.ok)errors.push('document-proof-checkpoint');}
    const verifier=globalThis.GH_DOCUMENT_PROOF?.verifyDocument,recordVerifier=globalThis.GH_DOCUMENT_PROOF?.verifyRecord,documentCache=verificationCache?.documents;let fullState=null;const fullVerificationState=()=>{if(fullState===null&&typeof verifier==='function')fullState={...s,authorization:s.authorization?verificationView(s.authorization):s.authorization,documentProofs:verificationView(store)};return fullState;};
    // Records already verified are answered from the cache without touching state, so only a read-only view is needed for them.
    const lightState={...s,documentProofs:{...store}};
    if(trust&&documentCache)for(const [id,row] of Object.entries(records)){const known=VERIFIED_DOC_RECORDS.get(row);if(known){documentCache.records.set(id,known.result);documentCache.signedContentStable.set(id,known.stable);}}
    const recordVerificationStart=metric?metricClock():0;if(typeof verifier==='function'&&typeof recordVerifier==='function')for(const id of Object.keys(records)){const cached=documentCache?.records?.has(id)===true,check=recordVerifier(cached?lightState:fullVerificationState(),id,new Set(),documentCache),acceptedLegacy=check?.legacy===true&&check?.readOnly===true&&check?.recordIntegrity===true;if(!check?.ok&&!acceptedLegacy)errors.push('document-proof-record-integrity');else if(check?.ok===true&&check.modern===true&&!cached){const stableText=documentCache?.signedContentStable?.get(id),row=records[id];if(stableText!==undefined&&row&&!VERIFIED_DOC_RECORDS.has(row))VERIFIED_DOC_RECORDS.set(row,{stable:stableText,result:{ok:true,modern:true}});}}if(metric)metric.documentRecordVerifyMs+=Math.max(0,metricClock()-recordVerificationStart);
    const documentVerificationStart=metric?metricClock():0,seenDocuments=new Set();
    for(const document of documents)if(document?.documentProofId){
      const proofId=document.documentProofId,record=records[proofId];
      if(!record||document.contentDigest!==record.contentDigest){errors.push('document-proof-reference');continue;}
      if(typeof verifier!=='function'){errors.push('document-proof-integrity');continue;}
      // Verification is a pure function of the document and its (separately verified) record, so a trusted pass skips
      // a document whose exact JSON and record digest were already verified; any edit, even of an unsigned field,
      // verifies it again. Full validations (load, import, every tenth save) always verify every document.
      let text=null;try{text=JSON.stringify(document);}catch(_error){text=null;}
      seenDocuments.add(proofId);const known=VERIFIED_DOCUMENTS.get(proofId);
      if(trust&&text!==null&&known&&known.digest===record.contentDigest&&known.text===text)continue;
      // A full pass may skip it too when the record is the same sealed object (it cannot have changed) and that record
      // verified in this pass: verification is then a pure function of the unchanged document JSON.
      if(!trust&&text!==null&&known&&known.record===record&&known.text===text&&documentCache?.records?.get(proofId)?.ok===true&&globalThis.GH_TRANSACTION_CORE?.isSealed?.(record))continue;
      const verification=verifier(documentCache?.records?.has(proofId)?lightState:fullVerificationState(),document,documentCache),acceptedLegacy=verification?.legacy===true&&verification?.readOnly===true&&verification?.recordIntegrity===true;
      if(!verification?.ok&&!acceptedLegacy){errors.push('document-proof-integrity');VERIFIED_DOCUMENTS.delete(proofId);}
      else if(text!==null)VERIFIED_DOCUMENTS.set(proofId,{digest:record.contentDigest,text,record});
    }
    if(!trust||VERIFIED_DOCUMENTS.size>seenDocuments.size*2+64)for(const proofId of [...VERIFIED_DOCUMENTS.keys()])if(!seenDocuments.has(proofId))VERIFIED_DOCUMENTS.delete(proofId);
    if(metric)metric.documentVerifyMs+=Math.max(0,metricClock()-documentVerificationStart);
  }
  // Build 358 (iPhone diagnostic: the post-commit schema check of each daily close was one 27-37 ms step): the same
  // validation as a sequence of sections. validationSteps() yields between them (fleet and routes, the rest of the
  // books, authorization proofs, document proofs, company platform) and returns validate()'s result; a staged
  // transaction runs one section per frame. Nothing is skipped or reordered: validate() runs every section at once.
  // Section timings exclude the time spent paused between sections.
  function validate(s,options){const steps=validationSteps(s,options);let step;while(!(step=steps.next()).done){}return step.value;}
  function* validationSteps(s,options){
    const trust=!!options&&options.trustVerified===true;let pausedMs=0;
    const pause=function*(section){const at=metricClock();yield section;pausedMs+=Math.max(0,metricClock()-at);};
    const validationStart=metricClock(),metric={totalMs:0,authorizationMs:0,authorizationProofVerifyMs:0,documentProofMs:0,documentCollectionMs:0,documentRecordVerifyMs:0,documentVerifyMs:0,companyPlatformMs:0,otherMs:0,errors:0};
    const verificationCache={authorization:{proofs:new Map(),sealDigests:new Map(),mandateDigests:new Map()},documents:{records:new Map(),signedContentStable:new Map()}};verificationCache.documents.authorization=verificationCache.authorization;
    const legacyV2=String(s?.saveVersion||'')==='2.0.0'&&Array.isArray(s?.assets);const errors=[];if(!object(s))errors.push('root-not-object');if(String(s?.saveVersion||'')!==SAVE_SCHEMA_VERSION&&!legacyV2)errors.push('save-version');if(s?.saveRevision!==undefined&&(!finite(s.saveRevision)||Number(s.saveRevision)<0||!Number.isSafeInteger(Number(s.saveRevision))))errors.push('save-revision');if(s?.resetEpoch!==undefined&&(!finite(s.resetEpoch)||!Number.isSafeInteger(Number(s.resetEpoch))||Number(s.resetEpoch)<0))errors.push('reset-epoch');if(!finite(s?.simSeconds)||Number(s.simSeconds)<0)errors.push('sim-seconds');
    validateIdentityState(s,errors);validateConferenceLogoState(s,errors);const validateAssetPresentation=validatePresentationTextState(s,errors,false);
    const fleetMode=fleetData().mode(s);if(legacyV2?fleetMode==='none':(fleetMode!=='store'||Object.prototype.hasOwnProperty.call(s,'assets')))errors.push('fleet-store');if(!Array.isArray(s?.market))errors.push('market');if(!object(s?.finance)||!Array.isArray(s.finance.invoices)||!Array.isArray(s.finance.cheques)||!Array.isArray(s.finance.payables)||!Array.isArray(s.finance.receivables)||!Array.isArray(s.finance.periods))errors.push('finance');if(!object(s?.companyFinance))errors.push('company-finance');if(!object(s?.advanced))errors.push('advanced');
    // The fleet record ceiling is an admission rule (procurement refuses a purchase that would cross it). It is not a
    // validity rule: Build 357 rejected loading any save above it, which locked players out of their own games.
    const rowScan=!!options&&options.assetScan==='rows',assetIds=new Set();let duplicateAssetId=false;if(duplicateIds(s?.customRoutes,x=>x?.id))errors.push('route-id');if(duplicateIds(s?.realism?.procurement?.deliveries,x=>x?.id))errors.push('delivery-id');
    if(s?.speed!==undefined&&![0,1,2,3,4].includes(Number(s.speed)))errors.push('speed');
    const routes=Array.isArray(s?.customRoutes)?s.customRoutes:[],routeIds=new Set(BUILTIN_ROUTES),routeById=new Map(),routeSignatureGroups=new Map();
    if(routes.length>STATE_LIMITS.customRoutes)errors.push('route-capacity');
    for(const route of routes){
      const mode=routeMode(route),owner=routeOwner(route);if(!object(route)||!route.id||!knownRouteMode(mode,s,owner)||!dataId(owner)||!route.fromFacility||!route.toFacility||route.fromFacility===route.toFacility)errors.push('route-shape');if(object(route)&&route.fleetCapacity!==undefined&&!(Number.isSafeInteger(route.fleetCapacity)&&route.fleetCapacity>=1&&route.fleetCapacity<=8192))errors.push('route-shape');
      if(!Array.isArray(route?.route)||route.route.length<2||route.route.length>STATE_LIMITS.routePoints||route.route.some(point=>!validPoint(point))||!routeWithinBytes(route,STATE_LIMITS.routeBytes))errors.push('route-geometry');
      const signature=routeSignature(route);if(!signature)errors.push('route-geometry');else{const rows=routeSignatureGroups.get(signature)||[];rows.push(route);routeSignatureGroups.set(signature,rows);}
      if(route?.id){routeIds.add(route.id);if(!routeById.has(route.id))routeById.set(route.id,route);}
    }
    // routeUsers: routeId -> {users, stable (users that are not transitional), first: index and mode of the first user}.
    const routeUsers=new Map();
    forEachSaveAssetClass(s,(asset,count,info)=>{
      validateAssetPresentation('assets',asset);if(rowScan){const id=asset?.id;if(id===undefined||assetIds.has(id))duplicateAssetId=true;else assetIds.add(id);}
      const mode=assetMode(asset),owner=assetOwner(asset)||globalThis.GH_COMPANY_PLATFORM?.ownerForLegacyAssetMode?.(mode)||mode;if(!object(asset)||!String(asset.id||'').trim()||!knownAssetMode(mode,s,owner)||!dataId(owner)||!String(asset.baseFacility||'').trim())errors.push('asset-shape');
      if(!ASSET_PHASES.has(asset.phase))errors.push('asset-phase');
      if(!finite(asset.progress)||Number(asset.progress)<0||Number(asset.progress)>1)errors.push('asset-progress');
      if(!finite(asset.fuel)||Number(asset.fuel)<0||Number(asset.fuel)>100)errors.push('asset-fuel');
      if(!finite(asset.condition)||Number(asset.condition)<0||Number(asset.condition)>100)errors.push('asset-condition');
      if(asset.routeId!=null&&(!String(asset.routeId).trim()||!routeIds.has(asset.routeId)))errors.push('asset-route-reference');
      if((asset.phase==='moving'||asset.phase==='turnaround')&&!asset.routeId)errors.push('asset-route-required');
      if(asset.routeId){
        if(count>0){let users=routeUsers.get(asset.routeId);if(!users){users={users:0,stable:0,firstIndex:Infinity,firstMode:''};routeUsers.set(asset.routeId,users);}users.users+=count;if(!transitionalRouteUser(asset))users.stable+=count;if(info.index<users.firstIndex){users.firstIndex=info.index;users.firstMode=assetMode(asset);}}
        const route=routeById.get(asset.routeId);if(route&&(routeMode(route)!==mode||routeOwner(route)!==owner))errors.push('asset-route-company');
      }
    },rowScan);
    if(!rowScan){const ids=fleetData().idCollisions(s);if(ids.duplicate||ids.missing)duplicateAssetId=true;}
    if(duplicateAssetId)errors.push('asset-id');
    for(const [routeId,users] of routeUsers){const route=routeById.get(routeId),type=routeMode(route)||users.firstMode,capacity=routeCapacity(route||type,type);if(users.stable>capacity)errors.push('asset-route-capacity');}
    for(const group of routeSignatureGroups.values())if(group.length>1){const stable=group.filter(route=>{const users=routeUsers.get(route.id);return !users||users.stable>0;});if(stable.length!==1)errors.push('route-geometry-duplicate');}
    yield* pause('fleet-routes');
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
    for(const d of Array.isArray(s?.realism?.procurement?.deliveries)?s.realism.procurement.deliveries:[]){if(!d?.id||!d?.baseId||!String(d.status||'').trim()||d.deliveryOrderId&&d.deliveryOrderId!==d.id)errors.push('delivery-shape');const compactReceipt=fleetData().isCompactReceipt(d),assets=compactReceipt?[]:Array.isArray(d?.assets)?d.assets:d?.asset?[d.asset]:[];if(compactReceipt){const L=fleetData().idLists,receipt=d.assetReceipt,ids=receipt.idsFrom==='assetIds'?d.assetIds:fleetData().receiptFields(d,['id']).map(row=>row.id);if(d.status!=='delivered'||Object.prototype.hasOwnProperty.call(d,'assets')||!L.is(ids)||!L.valid(ids)||L.length(ids)!==receipt.count||!Number.isSafeInteger(receipt.count)||receipt.count<1)errors.push('delivery-receipt');else if(Number(d.count||receipt.count)!==receipt.count||L.hasDuplicate(ids)||L.hasEmpty(ids)||fleetData().receiptDistinctFields(d,['deliveryOrderId','baseFacility']).some(row=>row.deliveryOrderId&&row.deliveryOrderId!==d.id||row.baseFacility&&row.baseFacility!==d.baseId))errors.push('delivery-assets');}if(assets.length&&(Number(d.count||assets.length)!==assets.length||new Set(assets.map(asset=>asset?.id)).size!==assets.length||assets.some(asset=>!asset?.id||asset.deliveryOrderId&&asset.deliveryOrderId!==d.id||asset.baseFacility&&asset.baseFacility!==d.baseId)))errors.push('delivery-assets');if(!compactReceipt&&d?.assetIds!==undefined&&d.assetIds!==null&&!Array.isArray(d.assetIds)&&fleetData().idLists.is(d.assetIds))errors.push('delivery-asset-ids');if(Array.isArray(d?.assetIds)&&assets.length&&(!Array.isArray(d.assetIds)||d.assetIds.length!==assets.length||d.assetIds.some((id,index)=>id!==assets[index]?.id)))errors.push('delivery-asset-ids');if(d?.status==='pending'&&!assets.length)errors.push('delivery-assets-missing');}
    for(const i of inv){const total=Number(i?.total),gross=Number(i?.amount??i?.total),tax=Number(i?.tax||0),subtotal=Number(i?.subtotal??(gross-tax));if(!finite(total)||total<0||!finite(gross)||gross<0||!finite(subtotal)||subtotal<0||!finite(tax)||tax<0||Math.abs(total-gross)>.02||Math.abs(total-(subtotal+tax))>.02)errors.push('invoice-math');}
    for(const p of Array.isArray(s?.finance?.periods)?s.finance.periods:[]){if(!finite(p?.amount)||Number(p.amount)<0||!['مستحق','مسدد','صفر'].includes(String(p?.status||'')))errors.push('tax-period');if(finite(p?.outputVAT)&&finite(p?.inputVAT)){const opening=Math.max(0,Number(p?.openingCredit)||0),expected=Math.max(0,Number(p.outputVAT)-Number(p.inputVAT)-opening),closing=Math.max(0,Number(p.inputVAT)+opening-Number(p.outputVAT));if(Math.abs((Number(p.amount)||0)-expected)>.02||Math.abs((Number(p?.closingCredit)||0)-closing)>.02)errors.push('tax-period-math');}}
    for(const j of Array.isArray(s?.finance?.journalEntries)?s.finance.journalEntries:[]){const lines=Array.isArray(j?.lines)?j.lines:[],dr=lines.reduce((n,x)=>n+(Number(x?.debit)||0),0),cr=lines.reduce((n,x)=>n+(Number(x?.credit)||0),0);if(!lines.length||Math.abs(dr-cr)>.02)errors.push('journal-unbalanced');}
    const archive=s?.finance?.auditArchive;if(archive!=null){if(!object(archive)||!object(archive.records)||!Array.isArray(archive.digests))errors.push('finance-audit-archive');else{for(const [kind,rows] of Object.entries(archive.records))if(!kind||!Array.isArray(rows))errors.push('finance-audit-records');for(const d of archive.digests){if(!d||d.schema!=='gh-finance-audit-digest-v2'||typeof d.kind!=='string'||!d.kind||!Number.isInteger(Number(d.count))||Number(d.count)<=0||!finite(d.total)||Number(d.total)<0||typeof d.checksum!=='string'||!d.checksum||!Array.isArray(d.idRange)||d.idRange.length!==2||!Number.isSafeInteger(Number(d.maxSequence))||Number(d.maxSequence)<0||!finite(d.intercompanyTotal)||Number(d.intercompanyTotal)<0||Object.prototype.hasOwnProperty.call(d,'sources')||Object.prototype.hasOwnProperty.call(d,'sourceDocumentIds')||!Array.isArray(d.recentDaily)||d.recentDaily.length>30)errors.push('finance-audit-digest');}}}
    const budgets=object(s?.companyBudgets)?s.companyBudgets:{};for(const b of Object.values(budgets)){const limit=Number(b?.limit),spent=Number(b?.spent),reserved=Number(b?.reserved||0);if(!finite(limit)||limit<0||!finite(spent)||spent<0||!finite(reserved)||reserved<0||(b.enabled&&limit>0&&spent+reserved>limit+.01))errors.push('budget');for(const [line,lineLimitRaw] of Object.entries(object(b?.lines)?b.lines:{})){const lineLimit=Number(lineLimitRaw)||0,lineSpent=Number(b?.spentByLine?.[line]||0),lineReserved=Number(b?.reservedByLine?.[line]||0);if(lineSpent<0||lineReserved<0||(b.enabled&&lineLimit>0&&lineSpent+lineReserved>lineLimit+.01))errors.push('budget-line');}}
    const cp=s?.controlPlane;if(cp!==undefined){if(!object(cp)||String(cp.schema||'')!=='gh-control-plane-v1'||!Array.isArray(cp.events)||!Array.isArray(cp.commands)||!Array.isArray(cp.incidents)||!Array.isArray(cp.outbox)||!Array.isArray(cp.blackBox)||!object(cp.registry)||!object(cp.registry.engines)||!Array.isArray(cp.registry.links))errors.push('control-plane-shape');else{if(cp.events.length>STATE_LIMITS.controlEvents||cp.commands.length>STATE_LIMITS.controlCommands||cp.incidents.length>STATE_LIMITS.controlIncidents||cp.outbox.length>STATE_LIMITS.controlOutbox||cp.blackBox.length>STATE_LIMITS.controlBlackBox)errors.push('control-plane-capacity');for(const key of ['revision','commandSequence','eventSequence','incidentSequence','outboxSequence'])if(!finite(cp[key])||Number(cp[key])<0||!Number.isInteger(Number(cp[key])))errors.push('control-plane-sequence');if(!/^[a-f0-9]{64}$/i.test(String(cp.journalHeadHash||'')))errors.push('control-plane-journal-head');if(duplicateIds(cp.events,x=>x?.id)||duplicateIds(cp.commands,x=>x?.id)||duplicateIds(cp.incidents,x=>x?.id)||duplicateIds(cp.outbox,x=>x?.id))errors.push('control-plane-id');for(const e of cp.events){if(!Number.isInteger(Number(e?.sequence))||Number(e.sequence)<=0||!/^[a-f0-9]{64}$/i.test(String(e?.hash||''))||!/^[a-f0-9]{64}$/i.test(String(e?.previousHash||'')))errors.push('control-plane-event');}const eventIds=new Set(cp.events.map(x=>x?.id));for(const row of cp.outbox)if(row?.delivered!==true&&!eventIds.has(row?.eventId)&&row?.payload?.id!==row?.eventId)errors.push('control-plane-outbox-reference');}}
    if(Array.isArray(s?.domainRuntime?.commands)&&s.domainRuntime.commands.length>STATE_LIMITS.domainCommands)errors.push('domain-command-capacity');if(Array.isArray(s?.businessLedger?.events)&&s.businessLedger.events.length>STATE_LIMITS.businessEvents)errors.push('business-event-capacity');
    const bw=s?.businessWorld;if(bw!==undefined){if(!object(bw)||!object(bw.parties)||!object(bw.relationships)||!Number.isInteger(Number(bw.sequence))||Number(bw.sequence)<0)errors.push('business-world-shape');else{const caps={events:STATE_LIMITS.businessWorldEvents,opportunities:STATE_LIMITS.businessWorldOpportunities,sponsorships:STATE_LIMITS.businessWorldSponsorships,competitorActivity:STATE_LIMITS.businessWorldCompetitorActivity};for(const [key,limit] of Object.entries(caps)){const rows=bw[key];if(!Array.isArray(rows))errors.push('business-world-'+key+'-shape');else{if(rows.length>limit)errors.push('business-world-'+key+'-capacity');if(duplicateIds(rows,x=>x?.id))errors.push('business-world-'+key+'-id');}}if(Object.keys(bw.parties).length>STATE_LIMITS.businessWorldParties)errors.push('business-world-party-capacity');if(Object.keys(bw.relationships).length>STATE_LIMITS.businessWorldRelationships)errors.push('business-world-relationship-capacity');for(const [id,p] of Object.entries(bw.parties))if(!id||!object(p)||p.id!==id||!String(p.legalName||p.displayName||'').trim()||!Array.isArray(p.roles)||!Array.isArray(p.sectors))errors.push('business-world-party');for(const [id,r] of Object.entries(bw.relationships))if(!id||!object(r)||r.id!==id||!bw.parties[r.partyId]||!String(r.company||'').trim()||!Array.isArray(r.roles))errors.push('business-world-relationship');}}
    yield* pause('books');
    let started=metricClock();validateAuthorizationState(s,errors,verificationCache,metric,trust);metric.authorizationMs=Math.max(0,metricClock()-started);
    yield* pause('authorization');
    started=metricClock();validateDocumentProofState(s,errors,verificationCache,metric,trust);metric.documentProofMs=Math.max(0,metricClock()-started);
    yield* pause('document-proofs');
    started=metricClock();const companyValidation=globalThis.GH_COMPANY_PLATFORM?.validateState?.(s,{assetScan:rowScan?'rows':'classes'});metric.companyPlatformMs=Math.max(0,metricClock()-started);if(companyValidation&&!companyValidation.ok)errors.push(...companyValidation.errors.map(error=>`company-platform:${error}`));
    metric.totalMs=Math.max(0,metricClock()-validationStart-pausedMs);metric.errors=new Set(errors).size;metric.otherMs=Math.max(0,metric.totalMs-metric.authorizationMs-metric.documentProofMs-metric.companyPlatformMs);publishValidationMetric(metric);
    return {ok:errors.length===0,errors:[...new Set(errors)]};
  }
  const API=Object.freeze({VERSION,SAVE_SCHEMA_VERSION,STATE_LIMITS,ROUTE_FLEET_CAPACITY,normalize,validate,validationSteps,inheritVerified,migrateLegacy,measure:Object.freeze({mapBytes,routeWithinBytes,serializedBytes}),telemetry:()=>JSON.parse(JSON.stringify(runtimeTelemetry))});globalThis.GH_SAVE_SCHEMA=API;if(globalThis.window&&globalThis.window!==globalThis)globalThis.window.GH_SAVE_SCHEMA=API;if(typeof module!=='undefined'&&module.exports)module.exports=API;
})();

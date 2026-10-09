(()=>{
  'use strict';
  const VERSION='3.0.0',SAVE_SCHEMA_VERSION='3.0.0';
  const ROUTE_TYPES=new Set(['air','sea','road']),ASSET_PHASES=new Set(['idle','delivery','turnaround','moving']);
  const ROUTE_FLEET_CAPACITY=Object.freeze({air:24,sea:24,road:64});
  const BUILTIN_ROUTES=new Set(['AIR_RUH_LHR','AIR_DXB_SIN','SEA_SIN_JED','SEA_RTM_NYC','ROAD_RUH_JED','ROAD_DXB_RUH']);
  const STATE_LIMITS=Object.freeze({customRoutes:960,routeEndpoints:1440,routeCache:160,routePoints:2048,routeBytes:256*1024,routeCacheBytes:512*1024,controlEvents:240,controlCommands:120,controlIncidents:80,controlOutbox:100,controlBlackBox:120,domainCommands:240,businessEvents:240,businessWorldEvents:240,businessWorldOpportunities:120,businessWorldSponsorships:60,businessWorldCompetitorActivity:120,businessWorldParties:500,businessWorldRelationships:1500,businessWorldCustomerProfiles:160,businessWorldCustomerCompanies:64,businessWorldCustomerSegments:4,businessWorldCustomerReferences:32,authorizationPeople:64,authorizationSeals:256,authorizationMandates:512,authorizationProofs:6000,authorizationSealBytes:32768,documentProofs:5000});
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
    const quarterly=Array.isArray(value.quarterly)?value.quarterly.filter(row=>object(row)&&/^\d{4}-Q[1-4]$/.test(String(row.quarter||''))).slice(-400).map(row=>({quarter:String(row.quarter),count:Math.max(0,Math.floor(Number(row.count)||0)),total:Math.max(0,Number(row.total)||0),income:Math.max(0,Number(row.income)||0),expense:Math.max(0,Number(row.expense)||0),intercompany:Math.max(0,Number(row.intercompany)||0)})):[];
    return {schema:'gh-finance-audit-digest-v2',id:String(value.id||`AUD-${String(value.kind||'legacy')}`),kind:String(value.kind||''),count:Math.max(1,Math.floor(Number(value.count)||sources.length||1)),total:Math.max(0,Number(value.total)||0),firstAt:Math.max(0,Number(value.firstAt)||0),lastAt:Math.max(0,Number(value.lastAt)||0),idRange:[firstId,lastId],checksum:String(value.checksum||''),maxSequence:Math.max(0,Math.floor(maxSequence)),intercompanyTotal:Math.max(0,Number(value.intercompanyTotal)||0),recentDaily:daily,quarterly,at:Math.max(0,Number(value.at)||0)};
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
      if(object(state.businessWorld.customers)){const customers=state.businessWorld.customers,profiles=object(customers.profiles)?customers.profiles:{},requested=Array.isArray(customers.profileOrder)?customers.profileOrder:[],order=[...new Set([...requested,...Object.keys(profiles)])].filter(key=>object(profiles[key])).slice(0,STATE_LIMITS.businessWorldCustomerProfiles);customers.profiles=Object.fromEntries(order.map(key=>[key,profiles[key]]));customers.profileOrder=order;const companies=Object.entries(object(customers.segments)?customers.segments:{}).slice(0,STATE_LIMITS.businessWorldCustomerCompanies);customers.segments=Object.fromEntries(companies.map(([company,segments])=>[company,Object.fromEntries(Object.entries(object(segments)?segments:{}).slice(0,STATE_LIMITS.businessWorldCustomerSegments))]));}
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
    const periodMigration=globalThis.GH_DOCUMENT_PROOF?.migratePeriodDigests?.(state);if(periodMigration?.changed)changed=true;
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
    globalThis.GH_FACILITY_CORE?.migrateOperatingCosts?.(s);
    globalThis.GH_HR_CORE?.migrateFacilityStaffing?.(s);
    // Build 358: fleet purchases are zero-rated; reverse the input VAT older saves carried for them (once, see finance-core).
    if(object(s.finance)&&object(s.companyFinance))globalThis.GH_FINANCE_CORE?.zeroRateFleetPurchaseVat?.(s);
    // Build 358: delivered receipts saved with full asset copies are stored compactly (lossless, see fleet-access-core).
    for(const delivery of Array.isArray(s.realism?.procurement?.deliveries)?s.realism.procurement.deliveries:[])fleetData().compactReceipt(delivery);
    return s;
  }
  function duplicateIds(rows,getId=x=>x?.id,onVisit=null){const seen=new Set();for(const row of Array.isArray(rows)?rows:[]){onVisit?.(row);const id=String(getId(row)||'');if(!id||seen.has(id))return true;seen.add(id);}return false;}
  function validDigest(value){return /^[a-f0-9]{64}$/i.test(String(value||''));}
  // Build 350 verified-once ledger. Re-verifying every authorization proof and document record on every hourly commit, every
  // save and every command made validation cost grow with play time (SHA-256 in JavaScript plus a deep copy of the proof
  // stores, ~0.4 ms per record). A record that passed full verification is remembered BY OBJECT IDENTITY. The default
  // validate(state) ignores the ledger and verifies everything exactly as before. validate(state,{trustVerified:true}) skips
  // records already in the ledger and always verifies new ones. Contract: proof records are created whole by their owners and
  // never edited in place; an in-place edit of an already verified record is therefore caught by the next full validation
  // (load, import, any plain validate()) and by the proof audit (createProofAudit), not by the trusted ones. Clones inherit
  // trust via inheritVerified().
  const VERIFIED_AUTH_PROOFS=new WeakSet(),VERIFIED_DOC_RECORDS=new WeakMap();
  // Build 358: documents verified against their records, by proof id: the record digest and the exact document JSON.
  const VERIFIED_DOCUMENTS=new Map();
  // Build 359 (iPhone: each command and each daily close serialized every document, 13,291 of them, to compare it with its
  // last verified text): a sealed document (a final finance document, frozen, see GH_FINANCE_CORE) cannot change, so it
  // is remembered by identity with the record it verified against; while it is that same object and its record is that
  // same object, it is not serialized or verified again. A full pass still requires the record verified in this pass.
  const VERIFIED_SEALED_DOCUMENTS=new WeakMap(),VERIFIED_RECORD_SHAPES=new WeakSet();
  const sealedObject=value=>globalThis.GH_TRANSACTION_CORE?.isSealed?.(value)===true;
  function inheritVerified(source,target){
    let authorization=0,records=0;
    try{
      const pairs=[[source?.authorization?.proofsById,target?.authorization?.proofsById,'proofDigest',true],[source?.authorization?.proofArchiveById,target?.authorization?.proofArchiveById,'proofDigest',true],[source?.documentProofs?.recordsById,target?.documentProofs?.recordsById,'contentDigest',false],[source?.documentProofs?.archiveById,target?.documentProofs?.archiveById,'contentDigest',false],[source?.documentProofs?.supersededById,target?.documentProofs?.supersededById,'contentDigest',false]];
      for(const [from,to,field,isAuthorization] of pairs){
        // Build 359: a draft shares a sealed container with its source (the same members): nothing to inherit.
        if(!object(from)||!object(to)||from===to)continue;
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
  let AUTHORIZATION_ARCHIVE_MEMO=null;
  function validateAuthorizationState(s,errors,verificationCache,metric,trust=false){
    const work=metric?(metric.authorizationWork={stateChecks:1,people:0,seals:0,activeSeals:0,mandates:0,residencyRows:0,proofRows:0,proofVerifyCalls:0,dependencyChecks:0,archiveByteMeasurements:0,archiveMemoHit:false,total:1}):null;
    const auth=s?.authorization;if(auth===undefined)return;
    if(!object(auth)||auth.schema!=='gh-authorization-v1'){errors.push('authorization-shape');return;}
    const people=auth.peopleById,seals=object(auth.visualSealAssetsById)?auth.visualSealAssetsById:auth.signatureAssetsById,active=object(auth.activeVisualSealByPerson)?auth.activeVisualSealByPerson:auth.activeSignatureByPerson,mandates=auth.mandatesById,proofs=auth.proofsById;
    const archived=auth.proofArchiveById||{};if(!object(archived)){errors.push('authorization-proof-archive-shape');return;}
    if(!object(people)||!object(seals)||!object(active)||!object(mandates)||!object(proofs)){errors.push('authorization-shape');return;}
    // Build 359: the proof archive is a sealed container (frozen whole, replaced by every writer). A trusted pass answers a
    // version of it that a pass verified without a fault, after checking the people, seals and mandates its proofs rely
    // on (by content: a draft copies those small maps); it then walks the hot proofs only (and checks them against the
    // archive for residency).
    let dependenciesHold=true;if(trust&&AUTHORIZATION_ARCHIVE_MEMO?.archive===archived&&sealedObject(archived))for(const [map,id,text] of AUTHORIZATION_ARCHIVE_MEMO.relied){if(work)work.dependencyChecks++;if(JSON.stringify(auth[map]?.[id])!==text){dependenciesHold=false;break;}}
    const errorsBefore=errors.length,answered=trust&&AUTHORIZATION_ARCHIVE_MEMO?.archive===archived&&sealedObject(archived)&&dependenciesHold;if(work)work.archiveMemoHit=answered;
    if(!answered){if(work)work.archiveByteMeasurements++;if(mapBytes(archived)>8*1024*1024)errors.push('authorization-proof-archive-byte-limit');}
    if(answered){for(const id of Object.keys(proofs)){if(work)work.residencyRows++;if(Object.prototype.hasOwnProperty.call(archived,id))errors.push('authorization-proof-residency-conflict');}}
    else for(const id of Object.keys(archived)){if(work)work.residencyRows++;if(Object.prototype.hasOwnProperty.call(proofs,id))errors.push('authorization-proof-residency-conflict');}
    const allProofs=answered?proofs:{...archived,...proofs},relied=new Map(),sealMap=object(auth.visualSealAssetsById)?'visualSealAssetsById':'signatureAssetsById';
    if(Object.keys(people).length>STATE_LIMITS.authorizationPeople)errors.push('authorization-people-capacity');if(Object.keys(seals).length>STATE_LIMITS.authorizationSeals)errors.push('authorization-seal-capacity');if(Object.keys(mandates).length>STATE_LIMITS.authorizationMandates)errors.push('authorization-mandate-capacity');if(Object.keys(proofs).length>STATE_LIMITS.authorizationProofs)errors.push('authorization-proof-capacity');
    for(const [id,row] of Object.entries(people)){if(work)work.people++;if(!id||!object(row)||row.id!==id||!String(row.legalName||'').trim())errors.push('authorization-person');}
    for(const [id,row] of Object.entries(seals)){
      if(work)work.seals++;
      const strokes=row?.strokes,pointCount=Array.isArray(strokes)?strokes.reduce((sum,stroke)=>sum+(Array.isArray(stroke)?stroke.length:9000),0):9000;
      const basic=!id||!object(row)||row.id!==id||!people[row.ownerPersonId]||!Array.isArray(strokes)||!strokes.length||strokes.length>64||pointCount>8192||serializedBytes(strokes)>STATE_LIMITS.authorizationSealBytes||!validDigest(row.digest),validator=globalThis.GH_AUTHORIZATION?.validateVisualSeal;
      if(basic||typeof validator!=='function'||!validator(row).ok)errors.push('authorization-seal');
    }
    for(const [personId,sealId] of Object.entries(active)){if(work)work.activeSeals++;if(!people[personId]||!seals[sealId]||seals[sealId].ownerPersonId!==personId||seals[sealId].status!=='active')errors.push('authorization-active-seal');}
    for(const [id,row] of Object.entries(mandates)){if(work)work.mandates++;if(!id||!object(row)||row.id!==id||!people[row.principalId]||!Array.isArray(row.companyIds)||!row.companyIds.length||row.companyIds.length>120||!Array.isArray(row.scopes)||!row.scopes.length||row.scopes.length>120||!Number.isSafeInteger(Number(row.version))||Number(row.version)<1)errors.push('authorization-mandate');}
    const verifier=globalThis.GH_AUTHORIZATION?.verifyProof;let verificationState=null,verificationStateBuilt=false;const stateForVerification=()=>{if(!verificationStateBuilt){verificationStateBuilt=true;verificationState=typeof verifier==='function'?{...s,authorization:verificationView(auth)}:null;}return verificationState;};
    const proofVerificationStart=metric?metricClock():0;for(const [id,row] of Object.entries(allProofs)){if(work)work.proofRows++;if(!id||!object(row)||row.id!==id||!people[row.signerPersonId]||!seals[row.signatureAssetId||row.visualSealAssetId]||!mandates[row.mandateId]||!validDigest(row.signatureDigest||row.visualSealDigest)||!validDigest(row.payloadDigest)||!validDigest(row.proofDigest)||!Array.isArray(row.documentDigests)||row.documentDigests.some(value=>!validDigest(value)))errors.push('authorization-proof');else if(trust&&VERIFIED_AUTH_PROOFS.has(row)){/* verified earlier in this process */}else if(typeof verifier!=='function')errors.push('authorization-proof-integrity');else{if(work)work.proofVerifyCalls++;if(!verifier(stateForVerification(),id,verificationCache?.authorization).ok)errors.push('authorization-proof-integrity');else VERIFIED_AUTH_PROOFS.add(row);}
      if(!answered&&archived[id]===row)for(const [map,key] of [['peopleById',row.signerPersonId],[sealMap,row.signatureAssetId||row.visualSealAssetId],['mandatesById',row.mandateId]]){if(work)work.dependencyChecks++;const ref=`${map}\u0000${key}`;if(!relied.has(ref))relied.set(ref,[map,key,JSON.stringify(auth[map]?.[key])]);}}
    if(!answered)AUTHORIZATION_ARCHIVE_MEMO=errors.length===errorsBefore&&sealedObject(archived)?{archive:archived,relied:[...relied.values()]}:null;if(metric){metric.authorizationProofVerifyMs+=Math.max(0,metricClock()-proofVerificationStart);work.total=work.stateChecks+work.people+work.seals+work.activeSeals+work.mandates+work.residencyRows+work.proofRows+work.proofVerifyCalls+work.dependencyChecks+work.archiveByteMeasurements;}
  }
  // Build 359 (a million assets: the archive part of the proof store grows with the game, and every command walked it):
  // a trusted pass answers the archive part by the identity of its sealed containers (frozen whole and replaced by every
  // writer, GH_TRANSACTION_CORE {container:true}): the archived records, the checkpoints, the period sums and seals, and
  // the finance audit archive's collections. A pass that verified them all without a fault remembers that version
  // (ARCHIVE_MEMO) with what it relied on outside it (the authorization proof each archived record of the first form
  // references, a predecessor or record still in the hot window) and an index of it (which archived records and
  // checkpoints are predecessors, which audit archive documents carry which record). A later trusted pass:
  // - on the same version, checks only those dependencies (by identity), the hot window against the archive and the
  //   checkpoints (residency), the hot records and the live documents;
  // - on a version derived from it (each writer declares what it changed, GH_TRANSACTION_CORE.deriveContainer), checks
  //   only the changes: records written or removed, checkpoints and period sums written by a trusted writer, documents
  //   added to or removed from the audit archive, and the documents whose record changed;
  // - otherwise, or when a change does not add up (an unverified checkpoint or period sum, a removed record a document or
  //   a newer record still needs), verifies the archive part in full, as before.
  // A full validation (load, import, a confirmed audit fault) never uses it.
  let ARCHIVE_MEMO=null;
  const isEmptyContainer=value=>Array.isArray(value)?value.length===0:object(value)&&Object.keys(value).length===0;
  function archiveVersion(s,store){
    const values=[store.archiveById,store.checkpointsById,store.periodDigests,store.sealedPeriods],records=s?.finance?.auditArchive?.records;
    if(object(records))for(const kind of Object.keys(records))values.push(kind,records[kind]);else values.push(records);
    return values.map(value=>({value,empty:!!value&&typeof value==='object'&&!sealedObject(value)&&isEmptyContainer(value)}));
  }
  // Only a version whose containers are all sealed (or empty, or absent) can be remembered: nothing in it can change.
  const rememberable=version=>version.every(entry=>!entry.value||typeof entry.value!=='object'||entry.empty||sealedObject(entry.value));
  function sameVersion(memo,version){if(!memo||memo.length!==version.length)return false;for(let i=0;i<memo.length;i++)if(memo[i].value!==version[i].value||memo[i].empty!==version[i].empty)return false;return true;}
  const archiveLists=s=>{const records=s?.finance?.auditArchive?.records,lists=new Map();if(object(records))for(const kind of Object.keys(records))if(Array.isArray(records[kind]))lists.set(kind,records[kind]);return lists;};
  // What a version relies on outside its containers, by owner ('r'+record id, 'd'+document proof id): [map, id, object].
  function reliedHolds(s,store,relied,work=null){
    const auth=s?.authorization,hot=store.recordsById;
    for(const rows of relied.values())for(const [map,id,value] of rows){if(work)work.dependencyChecks++;if((map==='hot'?hot[id]:map==='superseded'?store.supersededById?.[id]:auth?.proofsById?.[id]||auth?.proofArchiveById?.[id])!==value)return false;}
    return true;
  }
  // The changes from the remembered container to the current one: the lineage a writer declared, or every key/member when
  // the remembered one was empty or absent; null when they are not related.
  function changesOf(current,known){
    if(current===known)return {changed:new Set(),removed:new Set()};
    const empty=!known||typeof known!=='object'||isEmptyContainer(known);
    if(empty){if(!current||typeof current!=='object')return {changed:new Set(),removed:new Set()};return {changed:new Set(Array.isArray(current)?current:Object.keys(current)),removed:new Set()};}
    if(!current||typeof current!=='object')return {changed:new Set(),removed:new Set(Array.isArray(known)?known:Object.keys(known))};
    return globalThis.GH_TRANSACTION_CORE?.containerChanges?.(current,known)||null;
  }
  function validateDocumentProofState(s,errors,verificationCache,metric,trust=false){
    const work=metric?(metric.documentProofWork={stateChecks:1,archiveResidencyRows:0,recordRows:0,recordVerifyCalls:0,liveDocuments:0,archiveDocuments:0,documentVerifyCalls:0,dependencyChecks:0,changeSetChecks:0,changeListKinds:0,changeRemovedDocumentEntries:0,changeRemovedDocuments:0,changeRemovedRecords:0,changeRemovedCheckpoints:0,changeChangedCheckpoints:0,changeChangedPeriods:0,changeChangedRecords:0,changeRecordDocumentLinks:0,changeChangedDocumentEntries:0,changeRecheckDocuments:0,checkpointVerifyCalls:0,checkpointRows:0,checkpointPeriodRows:0,checkpointDigestRows:0,sealVerifyCalls:0,sealRows:0,archiveMode:'full',total:1}):null;
    const store=s?.documentProofs;if(store===undefined)return;
    if(!object(store)||store.schema!=='gh-document-proofs-v1'||!object(store.recordsById)){errors.push('document-proof-shape');return;}
    const archived=store.archiveById||{};if(!object(archived)){errors.push('document-proof-archive-shape');return;}
    // Build 359: supersededById (whole earlier versions standing for the archive's compact copies until maintenance) is
    // read before the archive, walked as the hot window is, and its ids are skipped in the archive; each of its ids must
    // be in the archive and not in the hot window.
    const superseded=object(store.supersededById)?store.supersededById:{};if(store.supersededById!==undefined&&!object(store.supersededById)){errors.push('document-proof-shape');return;}
    const hot=store.recordsById,own=(map,id)=>Object.prototype.hasOwnProperty.call(map,id),recordOf=id=>own(hot,id)?hot[id]:own(superseded,id)?superseded[id]:own(archived,id)?archived[id]:undefined,hotIds=Object.keys(hot),supersededIds=Object.keys(superseded);
    const documentOwner=globalThis.GH_DOCUMENT_PROOF;if(typeof documentOwner?.stateDocuments!=='function'){errors.push('document-proof-owner-unavailable');return;}
    const verifier=documentOwner.verifyDocument,recordVerifier=documentOwner.verifyRecord,documentCache=verificationCache?.documents;let fullState=null;const fullVerificationState=()=>{if(fullState===null&&typeof verifier==='function')fullState={...s,authorization:s.authorization?verificationView(s.authorization):s.authorization,documentProofs:verificationView(store)};return fullState;};
    // Records already verified are answered from the cache without touching state, so only a read-only view is needed for them.
    const lightState={...s,documentProofs:{...store}};
    // Build 359: a trusted pass answers a record of the verified-once ledger from the ledger when asked (the cache reads
    // through to it), instead of first copying the ledger's answer for every record into the cache.
    if(trust&&documentCache){
      const results=documentCache.records,texts=documentCache.signedContentStable,known=id=>{const row=recordOf(id);return row?VERIFIED_DOC_RECORDS.get(row):undefined;};
      documentCache.records={get:id=>results.has(id)?results.get(id):known(id)?.result,has:id=>results.has(id)||known(id)!==undefined,set(id,value){results.set(id,value);return this;}};
      documentCache.signedContentStable={get:id=>texts.has(id)?texts.get(id):known(id)?.stable,has:id=>texts.has(id)||known(id)!==undefined,set(id,value){texts.set(id,value);return this;}};
    }
    const accepted=check=>check?.ok===true||check?.legacy===true&&check?.readOnly===true&&check?.recordIntegrity===true;
    // One record: shape (once for a sealed one), authorization reference, integrity. Returns its dependencies, or null on a fault.
    function checkRecord(id,row,inArchive){
      if(work)work.recordRows++;
      if(!id||!object(row)||row.id!==id){errors.push('document-proof-record');return null;}
      if(!VERIFIED_RECORD_SHAPES.has(row)){if(!String(row.documentId||'').trim()||!validDigest(row.contentDigest)||(row.form==='archived-document-v1'||row.form==='archived-document-v2'||row.form==='compact-document-v1'?Object.prototype.hasOwnProperty.call(row,'signedContent'):!object(row.issuerSnapshot)||!object(row.signedContent))){errors.push('document-proof-record');return null;}if(sealedObject(row))VERIFIED_RECORD_SHAPES.add(row);}
      const released=row.form==='archived-document-v2'&&/^[a-f0-9]{64}$/i.test(String(row.authorizationDigest||'')),relied=[];
      if(row.authorizationProofId){const proof=s.authorization?.proofsById?.[row.authorizationProofId]||s.authorization?.proofArchiveById?.[row.authorizationProofId];if(!proof&&!released){errors.push('document-proof-record');return null;}if(inArchive&&proof&&!released)relied.push(['authorization',row.authorizationProofId,proof]);}
      if(inArchive&&row.previousProofId){if(own(hot,row.previousProofId))relied.push(['hot',row.previousProofId,hot[row.previousProofId]]);else if(own(superseded,row.previousProofId))relied.push(['superseded',row.previousProofId,superseded[row.previousProofId]]);}
      if(typeof verifier==='function'&&typeof recordVerifier==='function'){const answer=documentCache?.records?.get(id),cached=answer!==undefined;if(!cached&&work)work.recordVerifyCalls++;const check=cached?answer:recordVerifier(fullVerificationState(),id,new Set(),documentCache);if(!accepted(check)){errors.push('document-proof-record-integrity');return null;}if(check?.ok===true&&check.modern===true&&!cached){const stableText=documentCache?.signedContentStable?.get(id);if((stableText!==undefined||check.compact===true)&&!VERIFIED_DOC_RECORDS.has(row))VERIFIED_DOC_RECORDS.set(row,{stable:stableText,result:{ok:true,modern:true}});}}
      return relied;
    }
    // One document against its record. Returns its dependencies, or null on a fault.
    const seenDocuments=new Set();
    function checkDocument(document,inArchive){
      const proofId=document.documentProofId,record=recordOf(proofId);
      if(!record||document.contentDigest!==record.contentDigest){errors.push('document-proof-reference');return null;}
      const relied=inArchive&&own(hot,proofId)?[['hot',proofId,record]]:inArchive&&own(superseded,proofId)?[['superseded',proofId,record]]:[];
      if(typeof verifier!=='function'){errors.push('document-proof-integrity');return null;}
      if(VERIFIED_SEALED_DOCUMENTS.get(document)===record&&sealedObject(document)&&(trust||documentCache?.records?.get(proofId)?.ok===true&&sealedObject(record))){seenDocuments.add(proofId);return relied;}
      // Verification is a pure function of the document and its (separately verified) record, so a trusted pass skips
      // a document whose exact JSON and record digest were already verified; any edit, even of an unsigned field,
      // verifies it again. Full validations (load, import, a confirmed audit fault) always verify every document.
      // Build 359: a record without its signed content (compact or archived form: its issue time and chain link are read
      // only when the document is verified) must also be the very record verified then.
      let text=null;try{text=JSON.stringify(document);}catch(_error){text=null;}
      seenDocuments.add(proofId);const known=VERIFIED_DOCUMENTS.get(proofId);
      if(trust&&text!==null&&known&&known.digest===record.contentDigest&&known.text===text&&(known.record===record||object(record.signedContent))){if(known.record===record&&sealedObject(document))VERIFIED_SEALED_DOCUMENTS.set(document,record);return relied;}
      // A full pass may skip it too when the record is the same sealed object (it cannot have changed) and that record
      // verified in this pass: verification is then a pure function of the unchanged document JSON.
      if(!trust&&text!==null&&known&&known.record===record&&known.text===text&&documentCache?.records?.get(proofId)?.ok===true&&sealedObject(record)){if(sealedObject(document))VERIFIED_SEALED_DOCUMENTS.set(document,record);return relied;}
      if(work)work.documentVerifyCalls++;const verification=verifier(documentCache?.records?.has(proofId)?lightState:fullVerificationState(),document,documentCache);
      if(!accepted(verification)){errors.push('document-proof-integrity');VERIFIED_DOCUMENTS.delete(proofId);return null;}
      if(text!==null)VERIFIED_DOCUMENTS.set(proofId,{digest:record.contentDigest,text,record});if(verification?.ok===true&&sealedObject(document))VERIFIED_SEALED_DOCUMENTS.set(document,record);
      return relied;
    }
    // The changes since the remembered version, checked alone. False when they do not add up (the caller verifies the
    // archive part in full); errors found are reported and also send the caller to the full pass (its report is exact).
    function checkArchiveChanges(version){
      const memo=ARCHIVE_MEMO;if(!memo||!rememberable(version))return false;
      if(work)work.changeSetChecks+=3;
      const archiveChanges=changesOf(store.archiveById,memo.archive),checkpointChanges=changesOf(store.checkpointsById,memo.checkpoints),periodChanges=changesOf(store.periodDigests,memo.periods);
      if(!archiveChanges||!checkpointChanges||!periodChanges)return false;
      const lists=archiveLists(s),listChanges=new Map();
      for(const kind of new Set([...lists.keys(),...memo.lists.keys()])){if(work){work.changeListKinds++;work.changeSetChecks++;}const changes=changesOf(lists.get(kind),memo.lists.get(kind));if(!changes)return false;listChanges.set(kind,changes);}
      if(!reliedHolds(s,store,memo.relied,work))return false;
      const checkpoints=store.checkpointsById||{},resolves=id=>own(hot,id)||own(archived,id)||own(checkpoints,id);
      // Documents leaving or entering the audit archive.
      const removedDocuments=new Set();for(const changes of listChanges.values())for(const document of changes.removed){if(work)work.changeRemovedDocumentEntries++;removedDocuments.add(document);}
      for(const document of removedDocuments){if(work)work.changeRemovedDocuments++;const proofId=document?.documentProofId;if(!proofId)continue;const holders=memo.documents.get(proofId);if(holders){holders.delete(document);if(!holders.size)memo.documents.delete(proofId);}memo.relied.delete(`d${proofId}`);}
      // Records that left the archive: no audit archive document and no newer record may still need them.
      for(const id of archiveChanges.removed){if(work)work.changeRemovedRecords++;if(own(archived,id))continue;if(memo.documents.has(id))return false;if((memo.predecessors.get(id)||0)>0&&!resolves(id))return false;const prior=memo.recordPrevious.get(id);if(prior){const n=(memo.predecessors.get(prior)||1)-1;if(n)memo.predecessors.set(prior,n);else memo.predecessors.delete(prior);}memo.recordPrevious.delete(id);memo.relied.delete(`r${id}`);}
      for(const id of checkpointChanges.removed){if(work)work.changeRemovedCheckpoints++;if(!own(checkpoints,id)&&(memo.predecessors.get(id)||0)>0&&!resolves(id))return false;}
      // New checkpoints and period sums: written by a trusted writer (or the archive part is verified in full).
      for(const id of checkpointChanges.changed){if(work)work.changeChangedCheckpoints++;const row=checkpoints[id];if(!row)continue;if(!documentOwner.checkpointVerified?.(row)||own(hot,id)||own(archived,id))return false;}
      const periods=store.periodDigests||{};for(const period of periodChanges.changed){if(work)work.changeChangedPeriods++;const entry=periods[period];if(entry&&!documentOwner.periodVerified?.(entry))return false;}
      {if(work)work.sealVerifyCalls++;const seals=documentOwner.verifySeals?.(s);if(work)work.sealRows+=Number(seals?.stats?.sealRows)||0;if(seals&&!seals.ok)return false;}
      // Records written to the archive: checked, indexed; the archive documents carrying them are checked again.
      const recheck=new Set();
      for(const id of archiveChanges.changed){
        if(work)work.changeChangedRecords++;
        const row=archived[id];if(!row||own(superseded,id))continue;if(own(hot,id))return false;
        const relied=checkRecord(id,row,true);if(!relied)return false;
        const before=memo.recordPrevious.get(id);if(before){const n=(memo.predecessors.get(before)||1)-1;if(n)memo.predecessors.set(before,n);else memo.predecessors.delete(before);}
        if(row.previousProofId){memo.recordPrevious.set(id,row.previousProofId);memo.predecessors.set(row.previousProofId,(memo.predecessors.get(row.previousProofId)||0)+1);}else memo.recordPrevious.delete(id);
        if(relied.length)memo.relied.set(`r${id}`,relied);else memo.relied.delete(`r${id}`);
        for(const document of memo.documents.get(id)||[]){if(work)work.changeRecordDocumentLinks++;recheck.add(document);}
      }
      // Documents added to the audit archive, and those whose record changed.
      for(const changes of listChanges.values())for(const document of changes.changed){if(work)work.changeChangedDocumentEntries++;if(document&&typeof document==='object'&&document.documentProofId)recheck.add(document);}
      for(const document of recheck){if(work)work.changeRecheckDocuments++;if(removedDocuments.has(document))continue;if(work)work.archiveDocuments++;const relied=checkDocument(document,true);if(!relied)return false;const proofId=document.documentProofId;let holders=memo.documents.get(proofId);if(!holders){holders=new Set();memo.documents.set(proofId,holders);}holders.add(document);if(relied.length)memo.relied.set(`d${proofId}`,relied);else memo.relied.delete(`d${proofId}`);}
      memo.version=version;memo.archive=store.archiveById;memo.checkpoints=store.checkpointsById;memo.periods=store.periodDigests;memo.lists=lists;
      return true;
    }
    const errorsBefore=errors.length,version=trust?archiveVersion(s,store):null;
    let mode='full';if(trust&&ARCHIVE_MEMO){if(sameVersion(ARCHIVE_MEMO.version,version)&&reliedHolds(s,store,ARCHIVE_MEMO.relied,work))mode='same';else{const before=errors.length;if(checkArchiveChanges(version))mode='changes';else{errors.length=before;ARCHIVE_MEMO=null;}}}
    const answered=mode!=='full';if(metric){metric.documentArchiveAnswered=answered?1:0;work.archiveMode=mode;}
    const conflicts=new Set();
    if(answered){for(const id of hotIds){if(work)work.archiveResidencyRows++;if(own(archived,id)){conflicts.add(id);errors.push('document-proof-residency-conflict');}}}
    else for(const id of Object.keys(archived)){if(work)work.archiveResidencyRows++;if(own(hot,id)){conflicts.add(id);errors.push('document-proof-residency-conflict');}}
    for(const id of supersededIds){if(work)work.archiveResidencyRows++;if(own(hot,id)||!own(archived,id))errors.push('document-proof-residency-conflict');}
    if(hotIds.length>STATE_LIMITS.documentProofs)errors.push('document-proof-capacity');
    // The index a full pass builds for the memo.
    const index=answered?null:{relied:new Map(),predecessors:new Map(),recordPrevious:new Map(),documents:new Map()};
    // Build 359: the records are read in place (the archive's, then the hot window's; a record in both is the hot one, as
    // the merged copy {...archive,...hot} that every validation built had it), and a sealed record whose shape passed is
    // not inspected again (the reference to its authorization proof is, every time). An answered archive is not walked.
    const recordVerificationStart=metric?metricClock():0;
    if(!answered)for(const id of Object.keys(archived))if(!conflicts.has(id)&&!own(superseded,id)){const row=archived[id],relied=checkRecord(id,row,true);if(relied?.length)index.relied.set(`r${id}`,relied);if(object(row)&&row.previousProofId){index.recordPrevious.set(id,row.previousProofId);index.predecessors.set(row.previousProofId,(index.predecessors.get(row.previousProofId)||0)+1);}}
    for(const id of hotIds)checkRecord(id,hot[id],false);
    for(const id of supersededIds)checkRecord(id,superseded[id],false);
    if(metric)metric.documentRecordVerifyMs+=Math.max(0,metricClock()-recordVerificationStart);
    const documentCollectionStart=metric?metricClock():0,documents=documentOwner.stateDocuments(s,{archive:false}),live=new Set(documents),archiveDocuments=[];
    if(!answered)for(const list of archiveLists(s).values())for(const document of list)if(document&&typeof document==='object'&&!live.has(document))archiveDocuments.push(document);
    if(metric)metric.documentCollectionMs+=Math.max(0,metricClock()-documentCollectionStart);
    // Build 359: earlier versions kept as checkpoints, sealed by one digest per 30-day period (GH_DOCUMENT_PROOF). The
    // store has no byte limit: the finance audit archive's retention seals old documents (sealedPeriods, shape checked).
    // An answered archive part keeps its checkpoints and seals: only the hot window's residency is checked against them.
    if(store.checkpointsById!==undefined&&!object(store.checkpointsById))errors.push('document-proof-checkpoint-shape');
    if(answered){const checkpoints=store.checkpointsById||{};if(hotIds.some(id=>own(checkpoints,id))||supersededIds.some(id=>own(checkpoints,id)))errors.push('document-proof-checkpoint');}
    else{
      {if(work)work.sealVerifyCalls++;const seals=documentOwner.verifySeals?.(s);if(work)work.sealRows+=Number(seals?.stats?.sealRows)||0;if(seals&&!seals.ok)errors.push('document-proof-seal');}
      {if(work)work.checkpointVerifyCalls++;const checkpoints=documentOwner.verifyCheckpoints?.(s,verificationCache?.documents,{fresh:!trust});if(work){work.checkpointRows+=Number(checkpoints?.stats?.checkpointRows)||0;work.checkpointPeriodRows+=Number(checkpoints?.stats?.periodRows)||0;work.checkpointDigestRows+=Number(checkpoints?.stats?.digestRows)||0;}if(checkpoints&&!checkpoints.ok)errors.push('document-proof-checkpoint');}
    }
    const documentVerificationStart=metric?metricClock():0;
    for(const document of documents){if(work)work.liveDocuments++;if(document?.documentProofId)checkDocument(document,false);}
    for(const document of archiveDocuments){if(work)work.archiveDocuments++;if(document.documentProofId){const relied=checkDocument(document,true);const proofId=document.documentProofId;let holders=index.documents.get(proofId);if(!holders){holders=new Set();index.documents.set(proofId,holders);}holders.add(document);if(relied?.length)index.relied.set(`d${proofId}`,relied);}}
    // An answered pass did not see the archive's documents: it leaves their ledger entries alone.
    if(!answered&&(!trust||VERIFIED_DOCUMENTS.size>seenDocuments.size*2+64))for(const proofId of [...VERIFIED_DOCUMENTS.keys()])if(!seenDocuments.has(proofId))VERIFIED_DOCUMENTS.delete(proofId);
    if(metric)metric.documentVerifyMs+=Math.max(0,metricClock()-documentVerificationStart);
    // A pass that verified the archive part without a fault remembers its version, if nothing in it can change.
    if(!answered){const current=version||archiveVersion(s,store);ARCHIVE_MEMO=errors.length===errorsBefore&&rememberable(current)?{version:current,archive:store.archiveById,checkpoints:store.checkpointsById,periods:store.periodDigests,lists:archiveLists(s),...index}:null;}if(work)work.total=work.stateChecks+work.archiveResidencyRows+work.recordRows+work.recordVerifyCalls+work.liveDocuments+work.archiveDocuments+work.documentVerifyCalls+work.dependencyChecks+work.changeSetChecks+work.changeListKinds+work.changeRemovedDocumentEntries+work.changeRemovedDocuments+work.changeRemovedRecords+work.changeRemovedCheckpoints+work.changeChangedCheckpoints+work.changeChangedPeriods+work.changeChangedRecords+work.changeRecordDocumentLinks+work.changeChangedDocumentEntries+work.changeRecheckDocuments+work.checkpointVerifyCalls+work.checkpointRows+work.checkpointPeriodRows+work.checkpointDigestRows+work.sealVerifyCalls+work.sealRows;
  }
  // Build 359 (owner: no command or save may walk every document): persistence ran a full validation (every proof and
  // document verified afresh, 77 ms on iPhone at 13,291 documents) on every tenth save. That verification is now an
  // audit that walks the proofs a few at a time with a cursor (createProofAudit): maintenance gives it one step per pass
  // and it cycles over the authorization proofs, the document proof records, the documents, then the checkpoints and
  // seals. Each step verifies afresh (its own caches), skips what left the store since the cycle began, and stops at its
  // item or time budget. A step that finds a fault returns it; the caller confirms it with a full validate() before
  // acting, so a document changed between steps is never reported.
  // The walk reads the maps and lists in place, one item per pull (a for-in over each map, GH_DOCUMENT_PROOF.walkDocuments
  // and checkpointAuditSteps): no step copies a map ({...archive,...hot} and its keys, 8 ms at 13,291 documents) or lists
  // every document. A for-in still builds a map's key list on its first pull (the engine's enumeration); the proof maps
  // are bounded (hot window, 12-month audit archive). Items added while a cycle runs may be left to the next one; each
  // is verified when it is admitted.
  function createProofAudit(){
    const PHASES=['authorization','records','documents','checkpoints'],own=Object.prototype.hasOwnProperty;
    let walker=null,source=null,phase=PHASES[0],position=0,cycles=0,checked=0;
    function* keysOf(map){if(object(map))for(const id in map)if(own.call(map,id))yield id;}
    function* walk(s){
      const auth=s?.authorization,store=s?.documentProofs,owner=globalThis.GH_DOCUMENT_PROOF;
      phase='authorization';position=0;if(object(auth))for(const map of [auth.proofArchiveById,auth.proofsById])for(const id of keysOf(map)){position++;yield {kind:'authorization',id};}
      phase='records';position=0;if(object(store))for(const map of [store.archiveById,store.supersededById,store.recordsById])for(const id of keysOf(map)){position++;yield {kind:'record',id};}
      phase='documents';position=0;if(typeof owner?.walkDocuments==='function')for(const document of owner.walkDocuments(s))if(document.documentProofId){position++;yield {kind:'document',document};}
      phase='checkpoints';position=0;yield {kind:'seals'};
      if(typeof owner?.checkpointAuditSteps==='function'){const steps=owner.checkpointAuditSteps(s);let next;while(!(next=steps.next()).done){position++;yield {kind:'checkpoint'};}if(!next.value?.ok)yield {kind:'fault',reason:'document-proof-checkpoint',detail:next.value?.reason||null};}
    }
    const restart=()=>{walker=null;source=null;phase=PHASES[0];position=0;};
    function step(s,{maxItems=200,budgetMs=Infinity}={}){
      const started=metricClock(),errors=[];let done=0,cycleDone=false,fault=null;
      if(source!==s){walker=walk(s);source=s;}
      const cache={authorization:{proofs:new Map(),sealDigests:new Map(),mandateDigests:new Map()},documents:{records:new Map(),signedContentStable:new Map()}};cache.documents.authorization=cache.authorization;
      const auth=s?.authorization,store=s?.documentProofs,view={...s,authorization:object(auth)?{...auth}:auth,documentProofs:object(store)?{...store}:store};
      const proofOf=id=>auth?.proofsById?.[id]||auth?.proofArchiveById?.[id],recordOf=id=>store?.recordsById?.[id]||store?.supersededById?.[id]||store?.archiveById?.[id];
      const accepted=check=>check?.ok===true||check?.legacy===true&&check?.readOnly===true&&check?.recordIntegrity===true;
      while(done<maxItems&&metricClock()-started<budgetMs){
        const next=walker.next();if(next.done){cycles++;cycleDone=true;restart();break;}
        const item=next.value;done++;
        if(item.kind==='authorization'){if(!proofOf(item.id))continue;const verifier=globalThis.GH_AUTHORIZATION?.verifyProof;if(typeof verifier!=='function'||!verifier(view,item.id,cache.authorization).ok)errors.push('authorization-proof-integrity');}
        else if(item.kind==='record'){if(!recordOf(item.id))continue;if(!accepted(globalThis.GH_DOCUMENT_PROOF?.verifyRecord?.(view,item.id,new Set(),cache.documents)))errors.push('document-proof-record-integrity');}
        else if(item.kind==='document'){const record=recordOf(item.document.documentProofId);if(!record)continue;if(item.document.contentDigest!==record.contentDigest){errors.push('document-proof-reference');}else if(!accepted(globalThis.GH_DOCUMENT_PROOF?.verifyDocument?.(view,item.document,cache.documents)))errors.push('document-proof-integrity');}
        else if(item.kind==='seals'){const seals=globalThis.GH_DOCUMENT_PROOF?.verifySeals?.(s);if(seals&&!seals.ok)errors.push('document-proof-seal');}
        else if(item.kind==='fault')errors.push(item.reason);
        if(errors.length){fault={phase:item.kind,item:item.id||item.document?.documentProofId||item.detail||null};break;}
      }
      checked+=done;
      return {ok:errors.length===0,errors:[...new Set(errors)],fault,checked:done,phase,cycleDone,cycles,totalChecked:checked};
    }
    return {step,restart,status:()=>({phase,position,cycles,checked})};
  }
  // Build 358 (iPhone diagnostic: the post-commit schema check of each daily close was one 27-37 ms step): the same
  // validation as a sequence of sections. validationSteps() yields between them (fleet/routes, route state, finance,
  // the remaining books, authorization proofs, document proofs, company platform) and returns validate()'s result; a staged
  // transaction runs one section per frame. Nothing is skipped or reordered: validate() runs every section at once.
  // Section timings exclude the time spent paused between sections.
  function validate(s,options){const steps=validationSteps(s,options);let step;while(!(step=steps.next()).done){}return step.value;}
  function* validationSteps(s,options){
    const trust=!!options&&options.trustVerified===true;let pausedMs=0,sectionStarted=0;
    const workTotal=work=>{let total=0;for(const value of Object.values(work||{}))if(Number.isSafeInteger(value)&&value>=0)total+=value;return total;};
    const pause=function*(name,work,details={}){const pausedAt=metricClock(),sample={name,durationMs:Math.max(0,pausedAt-sectionStarted),units:workTotal(work),details:{work:{...work},...details}};metric.sectionSamples.push(sample);yield name;const resumedAt=metricClock();pausedMs+=Math.max(0,resumedAt-pausedAt);sectionStarted=resumedAt;};
    const validationStart=metricClock(),metric={totalMs:0,authorizationMs:0,authorizationProofVerifyMs:0,documentProofMs:0,documentCollectionMs:0,documentRecordVerifyMs:0,documentVerifyMs:0,companyPlatformMs:0,otherMs:0,errors:0,fleetWork:null,routeStateWork:null,financeWork:null,booksWork:null,authorizationWork:null,documentProofWork:null,companyPlatformWork:null,sectionSamples:[]};sectionStarted=validationStart;
    const verificationCache={authorization:{proofs:new Map(),sealDigests:new Map(),mandateDigests:new Map()},documents:{records:new Map(),signedContentStable:new Map()}};verificationCache.documents.authorization=verificationCache.authorization;
    const legacyV2=String(s?.saveVersion||'')==='2.0.0'&&Array.isArray(s?.assets);const errors=[];if(!object(s))errors.push('root-not-object');if(String(s?.saveVersion||'')!==SAVE_SCHEMA_VERSION&&!legacyV2)errors.push('save-version');if(s?.saveRevision!==undefined&&(!finite(s.saveRevision)||Number(s.saveRevision)<0||!Number.isSafeInteger(Number(s.saveRevision))))errors.push('save-revision');if(s?.resetEpoch!==undefined&&(!finite(s.resetEpoch)||!Number.isSafeInteger(Number(s.resetEpoch))||Number(s.resetEpoch)<0))errors.push('reset-epoch');if(!finite(s?.simSeconds)||Number(s.simSeconds)<0)errors.push('sim-seconds');
    const fleetWork=metric.fleetWork={rootChecks:1,identityValidationCalls:1,conferenceValidationCalls:1,presentationValidationCalls:1,routeIdRows:0,routeRows:0,assetFieldVisits:0,idCollisionChecks:0,routeUserGroups:0,routeSignatureGroups:0,routeSignatureRows:0};
    validateIdentityState(s,errors);validateConferenceLogoState(s,errors);const validateAssetPresentation=validatePresentationTextState(s,errors,false);
    const fleetMode=fleetData().mode(s);if(legacyV2?fleetMode==='none':(fleetMode!=='store'||Object.prototype.hasOwnProperty.call(s,'assets')))errors.push('fleet-store');if(!Array.isArray(s?.market))errors.push('market');if(!object(s?.finance)||!Array.isArray(s.finance.invoices)||!Array.isArray(s.finance.cheques)||!Array.isArray(s.finance.payables)||!Array.isArray(s.finance.receivables)||!Array.isArray(s.finance.periods))errors.push('finance');if(!object(s?.companyFinance))errors.push('company-finance');if(!object(s?.advanced))errors.push('advanced');
    // The fleet record ceiling is an admission rule (procurement refuses a purchase that would cross it). It is not a
    // validity rule: Build 357 rejected loading any save above it, which locked players out of their own games.
    const rowScan=!!options&&options.assetScan==='rows',assetIds=new Set();let duplicateAssetId=false;if(duplicateIds(s?.customRoutes,x=>x?.id,()=>fleetWork.routeIdRows++))errors.push('route-id');if(duplicateIds(s?.realism?.procurement?.deliveries,x=>x?.id,()=>fleetWork.routeIdRows++))errors.push('delivery-id');
    if(s?.speed!==undefined&&![0,1,2,3,4].includes(Number(s.speed)))errors.push('speed');
    const routes=Array.isArray(s?.customRoutes)?s.customRoutes:[],routeIds=new Set(BUILTIN_ROUTES),routeById=new Map(),routeSignatureGroups=new Map();
    if(routes.length>STATE_LIMITS.customRoutes)errors.push('route-capacity');
    for(const route of routes){
      fleetWork.routeRows++;
      const mode=routeMode(route),owner=routeOwner(route);if(!object(route)||!route.id||!knownRouteMode(mode,s,owner)||!dataId(owner)||!route.fromFacility||!route.toFacility||route.fromFacility===route.toFacility)errors.push('route-shape');if(object(route)&&route.fleetCapacity!==undefined&&!(Number.isSafeInteger(route.fleetCapacity)&&route.fleetCapacity>=1&&route.fleetCapacity<=8192))errors.push('route-shape');
      if(!Array.isArray(route?.route)||route.route.length<2||route.route.length>STATE_LIMITS.routePoints||route.route.some(point=>!validPoint(point))||!routeWithinBytes(route,STATE_LIMITS.routeBytes))errors.push('route-geometry');
      const signature=routeSignature(route);if(!signature)errors.push('route-geometry');else{const rows=routeSignatureGroups.get(signature)||[];rows.push(route);routeSignatureGroups.set(signature,rows);}
      if(route?.id){routeIds.add(route.id);if(!routeById.has(route.id))routeById.set(route.id,route);}
    }
    // routeUsers: routeId -> {users, stable (users that are not transitional), first: index and mode of the first user}.
    const routeUsers=new Map();let fleetLogicalRows=0;
    forEachSaveAssetClass(s,(asset,count,info)=>{
      fleetWork.assetFieldVisits++;if(count>0)fleetLogicalRows+=count;
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
    if(!rowScan){fleetWork.idCollisionChecks++;const ids=fleetData().idCollisions(s);if(ids.duplicate||ids.missing)duplicateAssetId=true;}
    if(duplicateAssetId)errors.push('asset-id');
    for(const [routeId,users] of routeUsers){fleetWork.routeUserGroups++;const route=routeById.get(routeId),type=routeMode(route)||users.firstMode,capacity=routeCapacity(route||type,type);if(users.stable>capacity)errors.push('asset-route-capacity');}
    for(const group of routeSignatureGroups.values()){fleetWork.routeSignatureGroups++;if(group.length>1){let stable=0;for(const route of group){fleetWork.routeSignatureRows++;const users=routeUsers.get(route.id);if(!users||users.stable>0)stable++;}if(stable!==1)errors.push('route-geometry-duplicate');}}
    yield* pause('fleet-routes',fleetWork,{logicalRows:fleetLogicalRows,scan:rowScan?'rows':'classes'});
    const routeStateWork=metric.routeStateWork={endpointRows:0,cacheRows:0,cacheByteChecks:0,retiredFeatureChecks:0};
    if(object(s?.routeEndpoints)){const entries=Object.entries(s.routeEndpoints);if(entries.length>STATE_LIMITS.routeEndpoints)errors.push('route-endpoint-capacity');for(const [id,endpoint] of entries){routeStateWork.endpointRows++;if(!id||!object(endpoint)||endpoint.id!==id||!validPoint(endpoint.coords))errors.push('route-endpoint');}}
    else if(s?.routeEndpoints!==undefined)errors.push('route-endpoints-shape');
    if(object(s?.routeCache)){const entries=Object.entries(s.routeCache);let over=entries.length>STATE_LIMITS.routeCache;if(!over){routeStateWork.cacheByteChecks++;over=serializedBytes(s.routeCache)>STATE_LIMITS.routeCacheBytes;}if(over)errors.push('route-cache-capacity');for(const [id,entry] of entries){routeStateWork.cacheRows++;if(!id||!object(entry)||entry.route&&(!Array.isArray(entry.route)||entry.route.length<2||entry.route.length>STATE_LIMITS.routePoints||entry.route.some(point=>!validPoint(point))))errors.push('route-cache');}}
    else if(s?.routeCache!==undefined)errors.push('route-cache-shape');
    if(object(s?.advanced)){routeStateWork.retiredFeatureChecks++;if(Object.prototype.hasOwnProperty.call(s.advanced,retiredFeatureKey()))errors.push('retired-feature-state');}
    yield* pause('route-state',routeStateWork);
    const financeWork=metric.financeWork={invoiceIdRows:0,chequeIdRows:0,customerReceiptRows:0,customerCreditNoteRows:0,companyBooks:0,accountRows:0,deliveryRows:0,deliveryAssetIdProjectionRows:0,deliveryAssetValidationRows:0,compactReceiptChecks:0,receiptFieldRows:0,receiptDistinctRows:0,deliveryAssetIdRows:0,invoiceMathRows:0,taxPeriodRows:0,journalRows:0,journalLineRows:0,archiveRecordBuckets:0,archiveDigestRows:0,archiveQuarterRows:0,coldArchiveChecks:0,budgetRows:0,budgetLineRows:0};
    const inv=Array.isArray(s?.finance?.invoices)?s.finance.invoices:[];if(duplicateIds(inv,x=>x?.number||x?.id,()=>financeWork.invoiceIdRows++))errors.push('invoice-id');const chq=Array.isArray(s?.finance?.cheques)?s.finance.cheques:[];if(duplicateIds(chq,x=>x?.id,()=>financeWork.chequeIdRows++))errors.push('cheque-id');
    const salePayments=Array.isArray(s?.finance?.customerSalePaymentReceipts)?s.finance.customerSalePaymentReceipts:[],loanPayments=Array.isArray(s?.finance?.customerLoanPaymentReceipts)?s.finance.customerLoanPaymentReceipts:[],financingReceipts=Array.isArray(s?.finance?.customerFinancingReceipts)?s.finance.customerFinancingReceipts:[],saleCredits=Array.isArray(s?.finance?.customerSaleCreditNotes)?s.finance.customerSaleCreditNotes:[];
    if(duplicateIds(salePayments,x=>x?.reference||x?.id,()=>financeWork.customerReceiptRows++))errors.push('customer-sale-payment-reference');
    if(duplicateIds(loanPayments,x=>x?.reference||x?.id,()=>financeWork.customerReceiptRows++))errors.push('customer-loan-payment-reference');
    if(duplicateIds(financingReceipts,x=>x?.reference||x?.id,()=>financeWork.customerReceiptRows++))errors.push('customer-financing-reference');
    if(duplicateIds(saleCredits,x=>x?.reference||x?.id,()=>financeWork.customerCreditNoteRows++))errors.push('customer-sale-credit-reference');
    const invoiceByNumber=new Map(inv.map(row=>[String(row?.number||''),row]));
    for(const row of salePayments){financeWork.customerReceiptRows++;const invoice=invoiceByNumber.get(String(row?.invoiceNumber||''));if(!row||!row.reference||!row.fingerprint||!invoice||invoice.company!==row.company||invoice.counterpartyPartyId!==row.customerId||!finite(row.amount)||Number(row.amount)<=0||!finite(row.amountPaid)||!finite(row.outstandingAmount)||Number(row.outstandingAmount)<0||!['منفذة'].includes(row.status))errors.push('customer-sale-payment-shape');}
    for(const row of loanPayments){financeWork.customerReceiptRows++;if(!row||row.company!=='bank'||!row.reference||!row.fingerprint||!row.contractId||!row.customerId||!finite(row.principalAmount)||Number(row.principalAmount)<0||!finite(row.interestAmount)||Number(row.interestAmount)<0||Math.abs(Number(row.amount)-Number(row.principalAmount)-Number(row.interestAmount))>.02||row.status!=='posted')errors.push('customer-loan-payment-shape');}
    for(const row of financingReceipts){financeWork.customerReceiptRows++;const invoice=invoiceByNumber.get(String(row?.invoiceNumber||''));if(!row||row.company!=='bank'||row.fromCompany!=='bank'||row.toCompany!=='dealership'||!row.reference||!row.fingerprint||!row.contractId||!row.customerId||!row.sourceSaleId||row.orderId!==row.sourceSaleId||row.proFormaReference!==`AUTO-ORDER-${row.sourceSaleId}`||!invoice||invoice.company!=='dealership'||invoice.counterpartyPartyId!==row.customerId||invoice.sourceRef!==`AUTO-SALE-${row.sourceSaleId}`||!finite(row.amount)||Number(row.amount)<=0||!finite(row.invoiceAmount)||Math.abs(Number(row.amount)-Number(row.invoiceAmount))>.02||Math.abs(Number(invoice.total)-Number(row.invoiceAmount))>.02||Number(row.downPayment)!==0||row.downPaymentReference!==null||!finite(row.loanPrincipal)||!finite(row.originationFee)||Math.abs(Number(row.loanPrincipal)-Number(row.originationFee)-Number(row.amount))>.02||row.status!=='posted')errors.push('customer-financing-receipt-shape');}
    for(const row of saleCredits){financeWork.customerCreditNoteRows++;const invoice=invoiceByNumber.get(String(row?.invoiceNumber||''));if(!row||!row.reference||!row.fingerprint||!row.saleId||!invoice||invoice.company!=='dealership'||invoice.sourceRef!==`AUTO-SALE-${row.saleId}`||!finite(row.amount)||Number(row.amount)<=0||!['credit-carry','open-period-reversal'].includes(row.taxTreatment)||row.status!=='معتمد')errors.push('customer-sale-credit-shape');}
    for(const book of Object.values(object(s?.companyFinance)?s.companyFinance:{})){
      financeWork.companyBooks++;if(!Array.isArray(book?.accounts)||!book.accounts.length){errors.push('accounts');continue;}for(const account of book.accounts){financeWork.accountRows++;if(!finite(account?.balance)||Number(account.balance)<0){errors.push('account-balance');break;}}if(!finite(book?.debt)||Number(book.debt)<0)errors.push('debt');if(!finite(book?.taxPayable)||Number(book.taxPayable)<0)errors.push('tax-payable');
      const vat=book?.vat;if(vat!==undefined&&(!object(vat)||['output','input','creditCarry','periodOutputStart','periodInputStart'].some(k=>!finite(vat[k])||Number(vat[k])<0)))errors.push('vat');
    }
    for(const d of Array.isArray(s?.realism?.procurement?.deliveries)?s.realism.procurement.deliveries:[]){
      financeWork.deliveryRows++;if(!d?.id||!d?.baseId||!String(d.status||'').trim()||d.deliveryOrderId&&d.deliveryOrderId!==d.id)errors.push('delivery-shape');const compactReceipt=fleetData().isCompactReceipt(d),assets=compactReceipt?[]:Array.isArray(d?.assets)?d.assets:d?.asset?[d.asset]:[];
      if(compactReceipt){
        financeWork.compactReceiptChecks++;const L=fleetData().idLists,receipt=d.assetReceipt;let ids=d.assetIds;
        if(receipt.idsFrom!=='assetIds'){ids=[];for(const row of fleetData().receiptFields(d,['id'])){financeWork.receiptFieldRows++;ids.push(row.id);}}
        if(d.status!=='delivered'||Object.prototype.hasOwnProperty.call(d,'assets')||!L.is(ids)||!L.valid(ids)||L.length(ids)!==receipt.count||!Number.isSafeInteger(receipt.count)||receipt.count<1)errors.push('delivery-receipt');
        else{let invalid=Number(d.count||receipt.count)!==receipt.count||L.hasDuplicate(ids)||L.hasEmpty(ids);if(!invalid)for(const row of fleetData().receiptDistinctFields(d,['deliveryOrderId','baseFacility'])){financeWork.receiptDistinctRows++;if(row.deliveryOrderId&&row.deliveryOrderId!==d.id||row.baseFacility&&row.baseFacility!==d.baseId){invalid=true;break;}}if(invalid)errors.push('delivery-assets');}
      }
      if(assets.length){let invalid=Number(d.count||assets.length)!==assets.length;if(!invalid){const ids=new Set();for(const asset of assets){financeWork.deliveryAssetIdProjectionRows++;ids.add(asset?.id);}invalid=ids.size!==assets.length;}if(!invalid)for(const asset of assets){financeWork.deliveryAssetValidationRows++;if(!asset?.id||asset.deliveryOrderId&&asset.deliveryOrderId!==d.id||asset.baseFacility&&asset.baseFacility!==d.baseId){invalid=true;break;}}if(invalid)errors.push('delivery-assets');}
      if(!compactReceipt&&d?.assetIds!==undefined&&d.assetIds!==null&&!Array.isArray(d.assetIds)&&fleetData().idLists.is(d.assetIds))errors.push('delivery-asset-ids');
      if(Array.isArray(d?.assetIds)&&assets.length){let invalid=d.assetIds.length!==assets.length;if(!invalid)for(let index=0;index<d.assetIds.length;index++){financeWork.deliveryAssetIdRows++;if(d.assetIds[index]!==assets[index]?.id){invalid=true;break;}}if(invalid)errors.push('delivery-asset-ids');}
      if(d?.status==='pending'&&!assets.length)errors.push('delivery-assets-missing');
    }
    for(const i of inv){financeWork.invoiceMathRows++;const total=Number(i?.total),gross=Number(i?.amount??i?.total),tax=Number(i?.tax||0),subtotal=Number(i?.subtotal??(gross-tax));if(!finite(total)||total<0||!finite(gross)||gross<0||!finite(subtotal)||subtotal<0||!finite(tax)||tax<0||Math.abs(total-gross)>.02||Math.abs(total-(subtotal+tax))>.02)errors.push('invoice-math');}
    for(const p of Array.isArray(s?.finance?.periods)?s.finance.periods:[]){financeWork.taxPeriodRows++;if(!finite(p?.amount)||Number(p.amount)<0||!['مستحق','مسدد','صفر'].includes(String(p?.status||'')))errors.push('tax-period');if(finite(p?.outputVAT)&&finite(p?.inputVAT)){const opening=Math.max(0,Number(p?.openingCredit)||0),expected=Math.max(0,Number(p.outputVAT)-Number(p.inputVAT)-opening),closing=Math.max(0,Number(p.inputVAT)+opening-Number(p.outputVAT));if(Math.abs((Number(p.amount)||0)-expected)>.02||Math.abs((Number(p?.closingCredit)||0)-closing)>.02)errors.push('tax-period-math');}}
    for(const j of Array.isArray(s?.finance?.journalEntries)?s.finance.journalEntries:[]){financeWork.journalRows++;const lines=Array.isArray(j?.lines)?j.lines:[];let dr=0,cr=0;for(const x of lines){financeWork.journalLineRows++;dr+=Number(x?.debit)||0;cr+=Number(x?.credit)||0;}if(!lines.length||Math.abs(dr-cr)>.02)errors.push('journal-unbalanced');}
    const archive=s?.finance?.auditArchive;if(archive!=null){if(!object(archive)||!object(archive.records)||!Array.isArray(archive.digests))errors.push('finance-audit-archive');else{for(const [kind,rows] of Object.entries(archive.records)){financeWork.archiveRecordBuckets++;if(!kind||!Array.isArray(rows))errors.push('finance-audit-records');}for(const d of archive.digests){financeWork.archiveDigestRows++;const quarterly=d?.quarterly;let invalid=!d||d.schema!=='gh-finance-audit-digest-v2'||typeof d.kind!=='string'||!d.kind||!Number.isInteger(Number(d.count))||Number(d.count)<=0||!finite(d.total)||Number(d.total)<0||typeof d.checksum!=='string'||!d.checksum||!Array.isArray(d.idRange)||d.idRange.length!==2||!Number.isSafeInteger(Number(d.maxSequence))||Number(d.maxSequence)<0||!finite(d.intercompanyTotal)||Number(d.intercompanyTotal)<0||Object.prototype.hasOwnProperty.call(d,'sources')||Object.prototype.hasOwnProperty.call(d,'sourceDocumentIds')||!Array.isArray(d.recentDaily)||d.recentDaily.length>30;if(!invalid&&quarterly!==undefined)invalid=!Array.isArray(quarterly)||quarterly.length>400||quarterly.some(row=>{financeWork.archiveQuarterRows++;return !object(row)||!/^\d{4}-Q[1-4]$/.test(String(row.quarter||''))||!Number.isInteger(Number(row.count))||Number(row.count)<0||['total','income','expense','intercompany'].some(key=>!finite(row[key])||Number(row[key])<0);});if(invalid)errors.push('finance-audit-digest');}}}
    {const validateColdArchive=globalThis.GH_STATE_CODEC?.validateColdArchive;if(typeof validateColdArchive==='function'){financeWork.coldArchiveChecks++;const coldArchiveCheck=validateColdArchive(s);if(coldArchiveCheck&&coldArchiveCheck.ok===false)errors.push(coldArchiveCheck.reason||'cold-archive-invalid');}}
    const budgets=object(s?.companyBudgets)?s.companyBudgets:{};for(const b of Object.values(budgets)){financeWork.budgetRows++;const limit=Number(b?.limit),spent=Number(b?.spent),reserved=Number(b?.reserved||0);if(!finite(limit)||limit<0||!finite(spent)||spent<0||!finite(reserved)||reserved<0||(b.enabled&&limit>0&&spent+reserved>limit+.01))errors.push('budget');for(const [line,lineLimitRaw] of Object.entries(object(b?.lines)?b.lines:{})){financeWork.budgetLineRows++;const lineLimit=Number(lineLimitRaw)||0,lineSpent=Number(b?.spentByLine?.[line]||0),lineReserved=Number(b?.reservedByLine?.[line]||0);if(lineSpent<0||lineReserved<0||(b.enabled&&lineLimit>0&&lineSpent+lineReserved>lineLimit+.01))errors.push('budget-line');}}
    yield* pause('finance',financeWork);
    const booksWork=metric.booksWork={controlCollectionChecks:0,controlSequenceChecks:0,controlIdRows:0,controlEventRows:0,controlOutboxRows:0,domainCollectionChecks:2,businessCollectionChecks:0,businessIdRows:0,partyRows:0,relationshipRows:0,profileOrderRows:0,customerProfileRows:0,customerCompanyRows:0,customerSegmentRows:0};
    const cp=s?.controlPlane;if(cp!==undefined){if(!object(cp)||String(cp.schema||'')!=='gh-control-plane-v1'||!Array.isArray(cp.events)||!Array.isArray(cp.commands)||!Array.isArray(cp.incidents)||!Array.isArray(cp.outbox)||!Array.isArray(cp.blackBox)||!object(cp.registry)||!object(cp.registry.engines)||!Array.isArray(cp.registry.links))errors.push('control-plane-shape');else{
      booksWork.controlCollectionChecks+=5;if(cp.events.length>STATE_LIMITS.controlEvents||cp.commands.length>STATE_LIMITS.controlCommands||cp.incidents.length>STATE_LIMITS.controlIncidents||cp.outbox.length>STATE_LIMITS.controlOutbox||cp.blackBox.length>STATE_LIMITS.controlBlackBox)errors.push('control-plane-capacity');
      for(const key of ['revision','commandSequence','eventSequence','incidentSequence','outboxSequence']){booksWork.controlSequenceChecks++;if(!finite(cp[key])||Number(cp[key])<0||!Number.isInteger(Number(cp[key])))errors.push('control-plane-sequence');}
      if(!/^[a-f0-9]{64}$/i.test(String(cp.journalHeadHash||'')))errors.push('control-plane-journal-head');
      const visitControlId=()=>booksWork.controlIdRows++;if(duplicateIds(cp.events,x=>x?.id,visitControlId)||duplicateIds(cp.commands,x=>x?.id,visitControlId)||duplicateIds(cp.incidents,x=>x?.id,visitControlId)||duplicateIds(cp.outbox,x=>x?.id,visitControlId))errors.push('control-plane-id');
      const eventIds=new Set();for(const e of cp.events){booksWork.controlEventRows++;eventIds.add(e?.id);if(!Number.isInteger(Number(e?.sequence))||Number(e.sequence)<=0||!/^[a-f0-9]{64}$/i.test(String(e?.hash||''))||!/^[a-f0-9]{64}$/i.test(String(e?.previousHash||'')))errors.push('control-plane-event');}
      for(const row of cp.outbox){booksWork.controlOutboxRows++;if(row?.delivered!==true&&!eventIds.has(row?.eventId)&&row?.payload?.id!==row?.eventId)errors.push('control-plane-outbox-reference');}
    }}
    if(Array.isArray(s?.domainRuntime?.commands)&&s.domainRuntime.commands.length>STATE_LIMITS.domainCommands)errors.push('domain-command-capacity');if(Array.isArray(s?.businessLedger?.events)&&s.businessLedger.events.length>STATE_LIMITS.businessEvents)errors.push('business-event-capacity');
    const bw=s?.businessWorld;if(bw!==undefined){if(!object(bw)||!object(bw.parties)||!object(bw.relationships)||!Number.isInteger(Number(bw.sequence))||Number(bw.sequence)<0)errors.push('business-world-shape');else{
      const caps={events:STATE_LIMITS.businessWorldEvents,opportunities:STATE_LIMITS.businessWorldOpportunities,sponsorships:STATE_LIMITS.businessWorldSponsorships,competitorActivity:STATE_LIMITS.businessWorldCompetitorActivity};for(const [key,limit] of Object.entries(caps)){booksWork.businessCollectionChecks++;const rows=bw[key];if(!Array.isArray(rows))errors.push('business-world-'+key+'-shape');else{if(rows.length>limit)errors.push('business-world-'+key+'-capacity');if(duplicateIds(rows,x=>x?.id,()=>booksWork.businessIdRows++))errors.push('business-world-'+key+'-id');}}
      const partyEntries=Object.entries(bw.parties),relationshipEntries=Object.entries(bw.relationships);if(partyEntries.length>STATE_LIMITS.businessWorldParties)errors.push('business-world-party-capacity');if(relationshipEntries.length>STATE_LIMITS.businessWorldRelationships)errors.push('business-world-relationship-capacity');
      for(const [id,p] of partyEntries){booksWork.partyRows++;if(!id||!object(p)||p.id!==id||!String(p.legalName||p.displayName||'').trim()||!Array.isArray(p.roles)||!Array.isArray(p.sectors))errors.push('business-world-party');}
      for(const [id,r] of relationshipEntries){booksWork.relationshipRows++;if(!id||!object(r)||r.id!==id||!bw.parties[r.partyId]||!String(r.company||'').trim()||!Array.isArray(r.roles))errors.push('business-world-relationship');}
      const customers=bw.customers;if(customers!==undefined){
        const profileEntries=object(customers?.profiles)?Object.entries(customers.profiles):[],companyEntries=object(customers?.segments)?Object.entries(customers.segments):[];let missingProfile=false;if(Array.isArray(customers?.profileOrder))for(const key of customers.profileOrder){booksWork.profileOrderRows++;if(!customers.profiles?.[key]){missingProfile=true;break;}}
        if(!object(customers)||!object(customers.profiles)||!object(customers.segments)||!Array.isArray(customers.profileOrder)||customers.profileOrder.length>STATE_LIMITS.businessWorldCustomerProfiles||profileEntries.length>STATE_LIMITS.businessWorldCustomerProfiles||new Set(customers.profileOrder).size!==customers.profileOrder.length||missingProfile)errors.push('business-world-customer-shape');
        else{const segmentIds=new Set(['strategic','enterprise','sme','consumer']);for(const [id,profile] of profileEntries){booksWork.customerProfileRows++;if(!id||!object(profile)||profile.id!==id||!bw.parties[profile.partyId]||!String(profile.company||'').trim()||!segmentIds.has(profile.segment)||!Array.isArray(profile.contractIds)||profile.contractIds.length>40||!Array.isArray(profile.recentReferences)||profile.recentReferences.length>STATE_LIMITS.businessWorldCustomerReferences)errors.push('business-world-customer-profile');}if(companyEntries.length>STATE_LIMITS.businessWorldCustomerCompanies)errors.push('business-world-customer-company-capacity');for(const [,segments] of companyEntries){booksWork.customerCompanyRows++;const entries=object(segments)?Object.entries(segments):[];if(!object(segments)||entries.length>STATE_LIMITS.businessWorldCustomerSegments)errors.push('business-world-customer-segment-capacity');else for(const [id,row] of entries){booksWork.customerSegmentRows++;if(!segmentIds.has(id)||!object(row)||row.segment!==id||!Array.isArray(row.recentReferences)||row.recentReferences.length>STATE_LIMITS.businessWorldCustomerReferences)errors.push('business-world-customer-segment');}}}
      }
    }}
    yield* pause('books',booksWork);
    let started=metricClock();validateAuthorizationState(s,errors,verificationCache,metric,trust);metric.authorizationMs=Math.max(0,metricClock()-started);
    // Work counters are incremented inside the existing validation walks. This
    // keeps sealed memo hits O(1) and makes a 10,000-document live scan visible.
    {const {total:_total,archiveMemoHit,...work}=metric.authorizationWork||{};yield* pause('authorization',work,{archiveMemoHit:archiveMemoHit===true});}
    started=metricClock();validateDocumentProofState(s,errors,verificationCache,metric,trust);metric.documentProofMs=Math.max(0,metricClock()-started);
    {const {total:_total,archiveMode,...work}=metric.documentProofWork||{};yield* pause('document-proofs',work,{archiveMode:archiveMode||'unavailable'});}
    started=metricClock();const companyValidator=globalThis.GH_COMPANY_PLATFORM?.validateState,companyValidation=companyValidator?.(s,{assetScan:rowScan?'rows':'classes',measureWork:true}),companyPlatformWork=metric.companyPlatformWork=object(companyValidation?.work)?companyValidation.work:{validationCalls:typeof companyValidator==='function'?1:0};metric.companyPlatformMs=Math.max(0,metricClock()-started);if(companyValidation&&!companyValidation.ok)errors.push(...companyValidation.errors.map(error=>`company-platform:${error}`));
    const validationEnded=metricClock();metric.sectionSamples.push({name:'company-platform',durationMs:Math.max(0,validationEnded-sectionStarted),units:workTotal(companyPlatformWork),details:{work:{...companyPlatformWork},logicalRows:Number.isSafeInteger(companyValidation?.logicalRows)?companyValidation.logicalRows:fleetLogicalRows,scan:rowScan?'rows':'classes'}});metric.totalMs=Math.max(0,validationEnded-validationStart-pausedMs);metric.errors=new Set(errors).size;metric.otherMs=Math.max(0,metric.totalMs-metric.authorizationMs-metric.documentProofMs-metric.companyPlatformMs);publishValidationMetric(metric);
    return {ok:errors.length===0,errors:[...new Set(errors)]};
  }
  const API=Object.freeze({VERSION,SAVE_SCHEMA_VERSION,STATE_LIMITS,ROUTE_FLEET_CAPACITY,normalize,validate,validationSteps,inheritVerified,createProofAudit,migrateLegacy,measure:Object.freeze({mapBytes,routeWithinBytes,serializedBytes}),telemetry:()=>JSON.parse(JSON.stringify(runtimeTelemetry))});globalThis.GH_SAVE_SCHEMA=API;if(globalThis.window&&globalThis.window!==globalThis)globalThis.window.GH_SAVE_SCHEMA=API;if(typeof module!=='undefined'&&module.exports)module.exports=API;
})();

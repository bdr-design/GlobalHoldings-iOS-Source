(function(){
  'use strict';
  const VERSION='3.0.0';
  const compareLabels=new Intl.Collator('ar').compare;
  const platform=()=>globalThis.GH_COMPANY_PLATFORM||null;
  const COMPANIES=Object.freeze(platform()?.listDefinitions?.({includeGroup:false}).filter(definition=>definition.facilities?.directoryProviderIds?.length).map(definition=>definition.id)||['air','sea','road','power','bank','mobility']);
  // CLDR territory aliases are not independent countries. Some WebKit versions
  // preserve these in Intl.Locale.region, so runtime canonicalization is unsafe.
  // Source: unicode-org/cldr, common/supplemental/supplementalMetadata.xml.
  // Null means the old territory split into several countries; do not guess one.
  const REGION_ALIASES=Object.freeze({AN:null,BU:'MM',CS:null,CT:'KI',DD:'DE',DY:'BJ',FQ:null,FX:'FR',HV:'BF',JT:'UM',MI:'UM',NH:'VU',NQ:'AQ',NT:null,PC:null,PU:'UM',PZ:'PA',QU:'EU',RH:'ZW',SU:null,TP:'TL',UK:'GB',VD:'VN',WK:'UM',YD:'YE',YU:null,ZR:'CD'});
  const COUNTRY_ALIASES=Object.freeze({
    SA:['السعودية'],AE:['الإمارات'],PS:['فلسطين'],MV:['المالديف'],MM:['ميانمار','Myanmar'],TL:['تيمور الشرقية'],
    HU:['المجر'],BY:['بيلاروسيا'],DK:['الدنمارك'],CD:['الكونغو الديمقراطية','Democratic republic of the congo'],
    CG:['الكونغو','Republic of the congo'],CF:['أفريقيا الوسطى'],ST:['ساو تومي وبرينسيب','Sao tome and principe'],
    BS:['الباهاما'],UY:['الأوروغواي'],KI:['كيريباس'],FM:['ميكرونيسيا','Micronesia'],
    US:['امريكا','الولايات المتحدة الامريكية','أمريكا'],GB:['بريطانيا','انجلترا','المملكة المتحدة'],KR:['كوريا','كوريا الجنوبية'],KP:['كوريا الشمالية'],
    NL:['هولندا'],CH:['سويسرا'],DE:['المانيا'],RU:['روسيا'],CN:['الصين'],IN:['الهند'],
    CV:['Cape verde'],CZ:['Czech republic'],CI:['Ivory coast'],MO:['Macao'],SO:['Somali'],
    FK:['Falkland islands','جزر فوكلاند'],
    VG:['British virgin islands'],VI:['Us virgin islands'],UM:['United states minor outlying islands'],
    SH:['Saint helena'],RE:['Reunion'],GU:['Guam'],CW:['Curacao'],HK:['Hong kong'],TR:['Turkey'],
    KN:['Saint kitts and nevis'],LC:['Saint lucia'],PM:['Saint pierre and miquelon'],
    VC:['Saint vincent and the grenadines'],GS:['South georgia and the south sandwich islands']
  });
  // Registry names with no ISO code (dissolved or unrecognized territories), shown in Arabic like every other country.
  const NATIVE_LABELS=Object.freeze({'netherlands antilles':'جزر الأنتيل الهولندية',somaliland:'أرض الصومال'});
  // World hub airports rank above other international airports (IATA codes).
  const HUB_AIRPORTS=new Set('ATL PEK PKX DXB DWC LAX HND NRT ORD LHR LGW PVG CDG DFW CAN AMS FRA IST SAW DEL BOM SIN ICN DEN BKK JFK EWR KUL SFO MAD BCN CTU SZX LAS SEA MIA MCO PHX IAH MUC SYD MEL FCO YYZ YVR YUL SVO DOH AUH SHJ JED RUH DMM MED CAI KWI BAH MCT AMM BEY CMN TUN ALG NBO JNB ADD LOS GRU MEX HKG TPE MNL CGK KIX ZRH VIE CPH OSL ARN HEL DUB LIS ATH BRU MXP GVA BOS IAD EZE BOG LIM SCL KHI LHE ISB DAC CMB MLE ESB'.split(' '));
  function normalize(value){
    return String(value??'').normalize('NFD').replace(/[\u0300-\u036f\u064b-\u065f\u0670\u06d6-\u06ed]/g,'')
      .replace(/[إأآٱ]/g,'ا').replace(/ى/g,'ي').replace(/ـ/g,'').toLowerCase().replace(/&/g,' and ')
      .replace(/[\s_-]+/g,' ').trim();
  }
  function regionCatalog(capitals){
    const byId=new Map(),byName=new Map();
    const arabic=typeof Intl.DisplayNames==='function'?new Intl.DisplayNames(['ar'],{type:'region'}):null;
    const english=typeof Intl.DisplayNames==='function'?new Intl.DisplayNames(['en'],{type:'region'}):null;
    const add=(id,label,aliases=[])=>{
      const existing=byId.get(id),names=new Set([id,label,...(existing?.aliases||[]),...aliases].filter(Boolean));
      const row={id,label:label||existing?.label||id,aliases:[...names]};byId.set(id,row);
      for(const name of names)byName.set(normalize(name),id);
      return row;
    };
    for(let first=65;first<=90;first++)for(let second=65;second<=90;second++){
      const code=String.fromCharCode(first,second);
      if(Object.prototype.hasOwnProperty.call(REGION_ALIASES,code))continue;
      const ar=arabic?.of(code),en=english?.of(code);
      if((ar&&ar!==code)||(en&&en!==code))add(code,ar||en||code,[en]);
    }
    for(const [alias,code] of Object.entries(REGION_ALIASES))if(code&&byId.has(code))add(code,byId.get(code).label,[alias]);
    for(const [code,aliases] of Object.entries(COUNTRY_ALIASES))add(code,byId.get(code)?.label||aliases[0],aliases);
    const resolve=value=>{
      const native=String(value||'').trim(),known=byId.has(native)?native:byName.get(normalize(native));
      if(known)return byId.get(known);
      const id=`native:${normalize(native)||'unknown'}`,arabic=NATIVE_LABELS[normalize(native)];
      return byId.get(id)||{id,label:arabic||native||'غير محدد',aliases:[id,native||'غير محدد',...(arabic?[arabic]:[])]};
    };
    // Preserve the saved registry's country spelling while giving every sector a common identity.
    for(const capital of capitals){const country=resolve(capital.country);add(country.id,capital.country,country.aliases);}
    return {resolve};
  }
  // Build 358: Arabic names of major cities that are not capitals (capitals bring their Arabic names from Mobility).
  // A site within CITY_ALIAS_KM of a city (capital or listed) is found by that name, so «جدة» finds Jeddah's airports.
  const CITY_ALIAS_KM=60;
  const CITY_ALIASES=Object.freeze([
    ['جدة',21.54,39.17],['مكة المكرمة',21.42,39.83],['المدينة المنورة',24.47,39.61],['الدمام',26.43,50.1],['الخبر',26.28,50.21],['الظهران',26.29,50.11],['الطائف',21.27,40.42],['أبها',18.22,42.51],['تبوك',28.38,36.57],['حائل',27.52,41.69],['بريدة',26.33,43.97],['القصيم',26.3,43.77],['جازان',16.89,42.55],['نجران',17.49,44.13],['العلا',26.61,37.92],['ينبع',24.09,38.06],['الأحساء',25.38,49.59],['الجبيل',27.0,49.66],
    ['دبي',25.2,55.27],['الشارقة',25.35,55.42],['رأس الخيمة',25.8,55.98],['العين',24.21,55.74],['الفجيرة',25.13,56.33],['صلالة',17.02,54.09],['البصرة',30.51,47.81],['أربيل',36.19,44.01],['النجف',32.0,44.34],['حلب',36.2,37.13],['اللاذقية',35.52,35.78],
    ['الإسكندرية',31.2,29.92],['شرم الشيخ',27.92,34.33],['الغردقة',27.26,33.81],['الأقصر',25.69,32.64],['أسوان',24.09,32.9],['الدار البيضاء',33.57,-7.59],['مراكش',31.63,-8.01],['طنجة',35.76,-5.83],['جربة',33.81,10.86],['وهران',35.7,-0.63],['بنغازي',32.12,20.07],
    ['إسطنبول',41.01,28.98],['أنطاليا',36.9,30.7],['إزمير',38.42,27.14],['جدة الإسلامية',21.48,39.18],
    ['نيويورك',40.71,-74.01],['لوس أنجلوس',34.05,-118.24],['شيكاغو',41.88,-87.63],['ميامي',25.76,-80.19],['سان فرانسيسكو',37.77,-122.42],['هيوستن',29.76,-95.37],['دالاس',32.78,-96.8],['أتلانتا',33.75,-84.39],['بوسطن',42.36,-71.06],['لاس فيغاس',36.17,-115.14],['سياتل',47.61,-122.33],['تورنتو',43.65,-79.38],['مونتريال',45.5,-73.57],['فانكوفر',49.28,-123.12],
    ['سيدني',-33.87,151.21],['ملبورن',-37.81,144.96],['مومباي',19.08,72.88],['كراتشي',24.86,67.0],['لاهور',31.55,74.34],['شنغهاي',31.23,121.47],['قوانغتشو',23.13,113.26],['أوساكا',34.69,135.5],['فرانكفورت',50.11,8.68],['ميونخ',48.14,11.58],['ميلانو',45.46,9.19],['برشلونة',41.39,2.17],['مانشستر',53.48,-2.24],['جنيف',46.2,6.14],['زيورخ',47.38,8.54],['إسطنبول الآسيوية',40.9,29.31],['سانت بطرسبرغ',59.93,30.36],['ريو دي جانيرو',-22.91,-43.17],['ساو باولو',-23.55,-46.63],['كيب تاون',-33.92,18.42],['جوهانسبرغ',-26.2,28.05]
  ]);
  function distanceKm(a,b){const rad=Math.PI/180,dLat=(b[0]-a[0])*rad,dLon=(b[1]-a[1])*rad,h=Math.sin(dLat/2)**2+Math.cos(a[0]*rad)*Math.cos(b[0]*rad)*Math.sin(dLon/2)**2;return 6371*2*Math.asin(Math.min(1,Math.sqrt(h)));}
  function options(rows,field,label){
    const groups=new Map();
    for(const row of rows){const id=row[field],item=groups.get(id);if(item)item.count++;else groups.set(id,{id,label:row[label],count:1});}
    return Object.freeze([...groups.values()].sort((a,b)=>compareLabels(a.label,b.label)||a.id.localeCompare(b.id)).map(Object.freeze));
  }
  function create({airports=[],ports=[],capitals=[]}={}){
    const countries=regionCatalog(capitals),countryTexts=new Map(),countryCache=new Map(),cityCache=new Map();
    // Arabic city names by 1-degree cell (a site looks at its cell and the eight around it).
    const aliasCells=new Map();
    for(const [name,lat,lng] of [...capitals.filter(capital=>Array.isArray(capital?.coords)).map(capital=>[capital.city,capital.coords[0],capital.coords[1]]),...CITY_ALIASES]){
      const key=`${Math.floor(lat)}:${Math.floor(lng)}`,cell=aliasCells.get(key);const row={name:normalize(name),coords:[lat,lng]};if(cell)cell.push(row);else aliasCells.set(key,[row]);
    }
    function cityAliases(coords){
      if(!Array.isArray(coords)||!Number.isFinite(Number(coords[0]))||!Number.isFinite(Number(coords[1])))return '';const lat=Math.floor(coords[0]),lng=Math.floor(coords[1]),names=new Set();
      for(let dLat=-1;dLat<=1;dLat++)for(let dLng=-1;dLng<=1;dLng++){const cell=aliasCells.get(`${lat+dLat}:${lng+dLng}`);if(cell)for(const row of cell)if(distanceKm(coords,row.coords)<=CITY_ALIAS_KM)names.add(row.name);}
      return [...names].join(' ');
    }
    const decoders=Object.freeze({
      'world-airports':row=>({sourceKey:`air:${row[0]}`,name:row[2],city:row[3]||row[4]||'',code:row[1]||row[0],rawCountry:row[5],extra:[row[0],row[1],row[4]],details:{coords:[row[6],row[7]],icao:row[0],iata:row[1],countryCode:row[5],elevationFt:row[8],commercial:!!row[1]}}),
      'world-ports':row=>({sourceKey:`port:${row[0]}:${row[3]}:${row[4]}`,name:row[1],city:row[1],code:row[0],rawCountry:row[2],extra:[],details:{coords:[row[3],row[4]],terminal:!!row[5]}}),
      'world-capitals':capital=>({sourceKey:`capital:${capital.id}`,capitalId:capital.id,name:capital.city,city:capital.city,code:capital.id,rawCountry:capital.country,extra:[],details:{coords:[...capital.coords]}})
    });
    const metadata=Object.freeze({
      'world-airports':row=>({sourceKey:`air:${row[0]}`,rawCountry:row[5]}),
      'world-ports':row=>({sourceKey:`port:${row[0]}:${row[3]}:${row[4]}`,rawCountry:row[2]}),
      'world-capitals':capital=>({sourceKey:`capital:${capital.id}`,rawCountry:capital.country})
    });
    function buildModel(provider,rows){
      const decode=decoders[provider],readMeta=metadata[provider],countryBuckets=new Map(),countryRows=new Map(),countryIds=new Set(),indexCountryIds=new Array(rows.length),cache={cityIds:null},seenKeys=new Set();
      for(let index=0;index<rows.length;index++){
        const meta=readMeta(rows[index]);if(seenKeys.has(meta.sourceKey))throw new Error(`directory-duplicate-key:${meta.sourceKey}`);seenKeys.add(meta.sourceKey);
        const country=countries.resolve(meta.rawCountry);indexCountryIds[index]=country.id;countryIds.add(country.id);
        if(!countryTexts.has(country.id))countryTexts.set(country.id,normalize(country.aliases.join(' ')));
        if(!countryRows.has(country.id))countryRows.set(country.id,country);
        const bucket=countryBuckets.get(country.id);if(bucket)bucket.push(index);else countryBuckets.set(country.id,[index]);
      }
      const countryOptions=Object.freeze([...countryBuckets].map(([id,bucket])=>Object.freeze({id,label:countryRows.get(id)?.label||id,count:bucket.length})).sort((a,b)=>compareLabels(a.label,b.label)||a.id.localeCompare(b.id)));
      return Object.freeze({provider,rows,decode,indexCountryIds,countryBuckets,countryOptions,countryIds:Object.freeze([...countryIds]),countryRows,cache});
    }
    const sources=new Map([['world-airports',airports],['world-ports',ports],['world-capitals',capitals]]),models=new Map();
    function modelFor(provider){if(models.has(provider))return models.get(provider);const rows=sources.get(provider);if(!rows)return null;const model=buildModel(provider,rows);models.set(provider,model);return model;}
    const definitionFor=(state,companyId)=>state?platform()?.definitionFor?.(state,companyId):platform()?.getDefinition?.(companyId);
    function companyIds(state){
      if(!state||typeof platform()?.listInstances!=='function')return [...COMPANIES];
      const ids=[];
      for(const company of platform().listInstances(state,{includeGroup:false})){
        if(!company?.definition?.facilities?.directoryProviderIds?.length||ids.includes(company.id))continue;
        ids.push(company.id);
      }
      return ids;
    }
    function requireDirectoryCompany(state,companyId){const definition=definitionFor(state,companyId);if(!definition)throw new Error(`directory-company-unknown:${companyId}`);const providers=definition.facilities?.directoryProviderIds||[];if(!providers.length)throw new Error(`directory-company-provider-missing:${companyId}`);return {definition,providers};}
    function materialize(model,index){
      const base=model.decode(model.rows[index]),countryId=model.indexCountryIds[index],country=model.countryRows.get(countryId)||countries.resolve(base.rawCountry),city=String(base.city||'مدينة غير محددة'),cityId=`${countryId}:${normalize(city)}`;
      return {sourceKey:base.sourceKey,...(base.capitalId?{capitalId:base.capitalId}:{}),name:base.name,city,code:base.code,provider:model.provider,countryId,country:country.label,cityId,...(base.details||{}),searchText:`${normalize([base.sourceKey,base.name,city,base.code,...base.extra].join(' '))} ${countryTexts.get(countryId)||''}`};
    }
    function project(row,companyId,definition){const key=row.provider==='world-capitals'?`site:${companyId}:${row.capitalId}`:row.sourceKey;return Object.freeze({...row,key,sourceKey:key,sourceProviderKey:row.sourceKey,company:companyId,companyId,ownerCompanyId:companyId,facilityKind:definition.facilities?.primaryKind||null});}
    function segmentsFor(state,explicit){
      const out=[],ids=explicit==='all'?companyIds(state):[explicit];
      for(const companyId of ids){let required;try{required=requireDirectoryCompany(state,companyId);}catch(error){if(explicit!=='all')throw error;continue;}for(const provider of required.providers){const model=modelFor(provider);if(model)out.push({companyId,definition:required.definition,model});}}
      return out;
    }
    function rowsFor(state,companyId){
      const segments=segmentsFor(state,String(companyId||'')),out=[];
      for(const segment of segments)for(let index=0;index<segment.model.rows.length;index++)out.push(project(materialize(segment.model,index),segment.companyId,segment.definition));
      return Object.freeze(out);
    }
    function modelCityIds(model){if(model.cache.cityIds)return model.cache.cityIds;const ids=new Set();for(let index=0;index<model.rows.length;index++){const row=model.decode(model.rows[index]),countryId=model.indexCountryIds[index],city=String(row.city||'مدينة غير محددة');ids.add(`${countryId}:${normalize(city)}`);}model.cache.cityIds=Object.freeze([...ids]);return model.cache.cityIds;}
    function statsForSegments(segments){
      let sites=0;const countryIds=new Set();for(const {model} of segments){sites+=model.rows.length;for(const id of model.countryIds)countryIds.add(id);}let citiesCache=null;
      return Object.freeze({sites,countries:countryIds.size,get cities(){if(citiesCache!==null)return citiesCache;const ids=new Set();for(const {model} of segments)for(const id of modelCityIds(model))ids.add(id);citiesCache=ids.size;return citiesCache;}});
    }
    function statsFor(state,companyId='all'){
      const explicit=String(companyId||'all').trim()||'all';
      if(explicit!=='all')return statsForSegments(segmentsFor(state,explicit));
      const ids=companyIds(state),segments=segmentsFor(state,'all'),companies={};
      for(const id of ids){try{companies[id]=statsForSegments(segmentsFor(state,id));}catch{companies[id]=Object.freeze({sites:0,countries:0,cities:0});}}
      const overall=statsForSegments(segments);return Object.freeze({total:overall.sites,countries:overall.countries,companies:Object.freeze(companies)});
    }
    function segmentCacheKey(segments){return segments.map(({companyId,model})=>`${companyId}:${model.provider}`).join('|');}
    function countriesFor(segments){
      const key=segmentCacheKey(segments);if(countryCache.has(key))return countryCache.get(key);
      const grouped=new Map();for(const {model} of segments)for(const row of model.countryOptions){const current=grouped.get(row.id);if(current)current.count+=row.count;else grouped.set(row.id,{id:row.id,label:row.label,count:row.count});}
      const result=Object.freeze([...grouped.values()].sort((a,b)=>compareLabels(a.label,b.label)||a.id.localeCompare(b.id)).map(Object.freeze));countryCache.set(key,result);return result;
    }
    function modelCities(model,countryId){
      const key=`${model.provider}|${countryId}`;if(cityCache.has(key))return cityCache.get(key);
      const grouped=new Map(),bucket=model.countryBuckets.get(countryId)||[];
      for(const index of bucket){const row=model.decode(model.rows[index]),city=String(row.city||'مدينة غير محددة'),id=`${countryId}:${normalize(city)}`,current=grouped.get(id);if(current)current.count++;else grouped.set(id,{id,label:city,count:1});}
      const result=Object.freeze([...grouped.values()].sort((a,b)=>compareLabels(a.label,b.label)||a.id.localeCompare(b.id)).map(Object.freeze));cityCache.set(key,result);return result;
    }
    function citiesFor(segments,countryId){
      if(!countryId)return Object.freeze([]);const key=`${segmentCacheKey(segments)}|${countryId}`;if(cityCache.has(key))return cityCache.get(key);
      const grouped=new Map();for(const {model} of segments)for(const row of modelCities(model,countryId)){const current=grouped.get(row.id);if(current)current.count+=row.count;else grouped.set(row.id,{id:row.id,label:row.label,count:row.count});}
      const result=Object.freeze([...grouped.values()].sort((a,b)=>compareLabels(a.label,b.label)||a.id.localeCompare(b.id)).map(Object.freeze));cityCache.set(key,result);return result;
    }
    // Search text per site, built once per model (names, city, codes, country names and nearby Arabic city names).
    function searchText(model,index){
      const texts=model.cache.texts||(model.cache.texts=new Array(model.rows.length));let text=texts[index];if(text!==undefined)return text;
      const row=model.decode(model.rows[index]),countryId=model.indexCountryIds[index],city=String(row.city||'مدينة غير محددة');
      text=`${normalize([row.sourceKey,row.name,city,row.code,...row.extra].join(' '))} ${countryTexts.get(countryId)||''} ${cityAliases(row.details?.coords)}`;texts[index]=text;return text;
    }
    // Main sites first: an international airport with an IATA code, then other coded airports, then airfields; a port
    // with a container terminal before other ports. Computed once per model.
    function importance(model){
      if(model.cache.importance)return model.cache.importance;const out=new Uint8Array(model.rows.length);
      for(let index=0;index<out.length;index++){const row=model.decode(model.rows[index]),d=row.details||{};out[index]=model.provider==='world-airports'?(d.iata?(HUB_AIRPORTS.has(d.iata)?3:/international|دولي/i.test(String(row.name||''))?2:1):0):model.provider==='world-ports'?(d.terminal?1:0):0;}
      model.cache.importance=out;return out;
    }
    function rankedCandidates(model,country){
      const key=`ranked|${country||''}`,cached=model.cache[key];if(cached)return cached;const weight=importance(model),base=country?(model.countryBuckets.get(country)||[]):Array.from({length:model.rows.length},(_,index)=>index);
      const out=base.slice().sort((a,b)=>weight[b]-weight[a]||a-b);model.cache[key]=out;return out;
    }
    // A query ranks an exact code (IATA, ICAO, port code) first, then a name or city that starts with the query, then
    // other matches; main sites first within each.
    function matchScore(model,index,tokens,query){
      const row=model.decode(model.rows[index]),d=row.details||{},codes=[row.code,d.iata,d.icao].filter(Boolean).map(code=>normalize(code));
      let score=0;if(tokens.length===1&&codes.includes(tokens[0]))score+=100;
      const name=normalize(row.name),city=normalize(row.city);if(name.startsWith(query)||city.startsWith(query))score+=20;else if(name.includes(query)||city.includes(query))score+=10;
      return score;
    }
    function viewFor(segment,country,city,tokens){
      const model=segment.model,candidates=rankedCandidates(model,country),totalCandidates=candidates.length;
      if(!city&&!tokens.length)return {segment,total:totalCandidates,indexAt:position=>candidates[position]};
      const matched=[],query=tokens.join(' ');for(let position=0;position<totalCandidates;position++){const index=candidates[position];if(city){const row=model.decode(model.rows[index]),rowCityId=`${model.indexCountryIds[index]}:${normalize(String(row.city||'مدينة غير محددة'))}`;if(rowCityId!==city)continue;}if(tokens.length){const text=searchText(model,index);if(!tokens.every(token=>text.includes(token)))continue;}matched.push(index);}
      if(tokens.length&&matched.length>1){const scores=new Map(matched.map((index,position)=>[index,matchScore(model,index,tokens,query)*100000-position]));matched.sort((a,b)=>scores.get(b)-scores.get(a));}
      return {segment,total:matched.length,indexAt:position=>matched[position]};
    }
    function search({state=null,company='all',companyId='',country='',city='',text='',page=0,pageSize=24}={}){
      const explicit=String(companyId||company||'all').trim()||'all',segments=segmentsFor(state,explicit),tokens=normalize(text).split(' ').filter(Boolean),views=segments.map(segment=>viewFor(segment,country,city,tokens)),total=views.reduce((sum,view)=>sum+view.total,0),size=Math.max(1,Math.min(24,Math.trunc(Number(pageSize))||24)),pages=Math.ceil(total/size),current=Math.min(Math.max(0,Math.trunc(Number(page))||0),Math.max(0,pages-1)),start=current*size,end=Math.min(total,start+size),rows=[];
      let offset=0;for(const view of views){const localStart=Math.max(0,start-offset),localEnd=Math.min(view.total,end-offset);if(localStart<localEnd)for(let position=localStart;position<localEnd;position++){const row=materialize(view.segment.model,view.indexAt(position));rows.push(project(row,view.segment.companyId,view.segment.definition));}offset+=view.total;if(offset>=end)break;}
      return {rows,total,page:current,pages,countries:countriesFor(segments),get cities(){return citiesFor(segments,country);}};
    }
    const countryMetadata=value=>{const country=countries.resolve(value);return Object.freeze({id:country.id,label:country.label});};
    return Object.freeze({search,rowsFor,get stats(){return statsFor(null,'all');},statsFor,countryMetadata,providers:Object.freeze([...sources.keys()])});
  }
  const API=Object.freeze({VERSION,COMPANIES,create,normalize});
  globalThis.GH_DIRECTORY_CORE=API;
  if(globalThis.window&&window!==globalThis)window.GH_DIRECTORY_CORE=API;
  if(typeof module!=='undefined'&&module.exports)module.exports=API;
})();

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
    CV:['Cape verde'],CZ:['Czech republic'],CI:['Ivory coast'],MO:['Macao'],SO:['Somali'],
    VG:['British virgin islands'],VI:['Us virgin islands'],UM:['United states minor outlying islands'],
    SH:['Saint helena'],RE:['Reunion'],GU:['Guam'],CW:['Curacao'],HK:['Hong kong'],TR:['Turkey'],
    KN:['Saint kitts and nevis'],LC:['Saint lucia'],PM:['Saint pierre and miquelon'],
    VC:['Saint vincent and the grenadines'],GS:['South georgia and the south sandwich islands']
  });
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
      const id=`native:${normalize(native)||'unknown'}`;
      return byId.get(id)||{id,label:native||'غير محدد',aliases:[id,native||'غير محدد']};
    };
    // Preserve the saved registry's country spelling while giving every sector a common identity.
    for(const capital of capitals){const country=resolve(capital.country);add(country.id,capital.country,country.aliases);}
    return {resolve};
  }
  function options(rows,field,label){
    const groups=new Map();
    for(const row of rows){const id=row[field],item=groups.get(id);if(item)item.count++;else groups.set(id,{id,label:row[label],count:1});}
    return Object.freeze([...groups.values()].sort((a,b)=>compareLabels(a.label,b.label)||a.id.localeCompare(b.id)).map(Object.freeze));
  }
  function create({airports=[],ports=[],capitals=[]}={}){
    const countries=regionCatalog(capitals),countryTexts=new Map(),countryCache=new Map(),cityCache=new Map();
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
    function searchText(model,index){const row=model.decode(model.rows[index]),countryId=model.indexCountryIds[index],city=String(row.city||'مدينة غير محددة');return `${normalize([row.sourceKey,row.name,city,row.code,...row.extra].join(' '))} ${countryTexts.get(countryId)||''}`;}
    function viewFor(segment,country,city,tokens){
      const model=segment.model,candidates=country?(model.countryBuckets.get(country)||[]):null,totalCandidates=candidates?candidates.length:model.rows.length;
      if(!city&&!tokens.length)return {segment,total:totalCandidates,indexAt:position=>candidates?candidates[position]:position};
      const matched=[];for(let position=0;position<totalCandidates;position++){const index=candidates?candidates[position]:position,row=model.decode(model.rows[index]),countryId=model.indexCountryIds[index],rowCityId=`${countryId}:${normalize(String(row.city||'مدينة غير محددة'))}`;if(city&&rowCityId!==city)continue;if(tokens.length){const text=searchText(model,index);if(!tokens.every(token=>text.includes(token)))continue;}matched.push(index);}
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

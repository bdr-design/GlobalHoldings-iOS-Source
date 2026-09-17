(function(){
  'use strict';
  const VERSION='3.0.0';
  const compareLabels=new Intl.Collator('ar').compare;
  const COMPANIES=Object.freeze(['air','sea','road','power','bank','mobility']);
  const SITE_COMPANIES=Object.freeze(['road','power','bank','mobility']);
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
      if(typeof Intl.Locale==='function'&&new Intl.Locale(`und-${code}`).region!==code)continue;
      const ar=arabic?.of(code),en=english?.of(code);
      if((ar&&ar!==code)||(en&&en!==code))add(code,ar||en||code,[en]);
    }
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
    const countries=regionCatalog(capitals),rows=[],keys=new Set(),texts=new Map(),countryTexts=new Map();
    const add=(row,rawCountry,extra=[])=>{
      if(keys.has(row.key))throw new Error(`directory-duplicate-key:${row.key}`);
      keys.add(row.key);
      const country=countries.resolve(rawCountry),city=String(row.city||'مدينة غير محددة');
      const indexed=Object.freeze({...row,countryId:country.id,country:country.label,cityId:`${country.id}:${normalize(city)}`,city});
      if(!countryTexts.has(country.id))countryTexts.set(country.id,normalize(country.aliases.join(' ')));
      rows.push(indexed);texts.set(indexed.key,`${normalize([indexed.key,indexed.name,indexed.city,indexed.code,...extra].join(' '))} ${countryTexts.get(country.id)}`);
    };
    for(const row of airports)add({key:`air:${row[0]}`,company:'air',name:row[2],city:row[3]||row[4]||'',code:row[1]||row[0]},row[5],[row[0],row[1],row[4]]);
    // Country names are authoritative here: several legacy UN/LOCODE prefixes disagree with their source country.
    for(const row of ports)add({key:`port:${row[0]}:${row[3]}:${row[4]}`,company:'sea',name:row[1],city:row[1],code:row[0]},row[2]);
    for(const company of SITE_COMPANIES)for(const capital of capitals)add({key:`site:${company}:${capital.id}`,company,name:capital.city,city:capital.city,code:capital.id},capital.country);
    const byCompany=new Map([['all',Object.freeze(rows)]]),countryOptions=new Map(),byCountry=new Map();
    const stats={total:rows.length,countries:new Set(rows.map(row=>row.countryId)).size,companies:{}};
    for(const company of COMPANIES)byCompany.set(company,Object.freeze(rows.filter(row=>row.company===company)));
    for(const [company,companyRows] of byCompany){
      countryOptions.set(company,options(companyRows,'countryId','country'));
      const groups=new Map();for(const row of companyRows){if(!groups.has(row.countryId))groups.set(row.countryId,[]);groups.get(row.countryId).push(row);}
      for(const [country,group] of groups)byCountry.set(`${company}|${country}`,Object.freeze(group));
      if(company!=='all')stats.companies[company]=Object.freeze({sites:companyRows.length,countries:countryOptions.get(company).length,cities:new Set(companyRows.map(row=>row.cityId)).size});
    }
    Object.freeze(stats.companies);Object.freeze(stats);
    const empty=Object.freeze([]);
    function search({company='all',country='',city='',text='',page=0,pageSize=24}={}){
      if(!byCompany.has(company))company='all';
      const source=country?(byCountry.get(`${company}|${country}`)||empty):byCompany.get(company),tokens=normalize(text).split(' ').filter(Boolean);
      const matched=!city&&!tokens.length?source:source.filter(row=>(!city||row.cityId===city)&&tokens.every(token=>texts.get(row.key).includes(token)));
      const size=Math.max(1,Math.min(24,Math.trunc(Number(pageSize))||24)),pages=Math.ceil(matched.length/size);
      const current=Math.min(Math.max(0,Math.trunc(Number(page))||0),Math.max(0,pages-1));
      // City options are read only after selecting a country in the UI. Compute them on access,
      // preserving the complete API for other callers without eagerly sorting 20k unused choices.
      return {rows:matched.slice(current*size,(current+1)*size),total:matched.length,page:current,pages,countries:countryOptions.get(company),get cities(){return options(source,'cityId','city');}};
    }
    const countryMetadata=value=>{const country=countries.resolve(value);return Object.freeze({id:country.id,label:country.label});};
    return Object.freeze({search,stats,countryMetadata});
  }
  const API=Object.freeze({VERSION,COMPANIES,create,normalize});
  globalThis.GH_DIRECTORY_CORE=API;
  if(globalThis.window&&window!==globalThis)window.GH_DIRECTORY_CORE=API;
  if(typeof module!=='undefined'&&module.exports)module.exports=API;
})();

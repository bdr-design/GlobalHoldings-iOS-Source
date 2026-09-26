(()=>{
  'use strict';

  const VERSION='GH-CAPABILITY-REGISTRY-1.0.0';
  const CAPABILITY_SCHEMA='gh-company-capability/v1';
  const CAPABILITY_ID=/^[a-z][a-z0-9]*(?:[.-][a-z0-9]+)*$/;
  const ADAPTER_KINDS=Object.freeze(['lifecycle','operations','finance','hr','facilities','map','conference','documents']);
  const BUILTIN_DEFINITIONS_RAW=Object.freeze({
    'company.core':Object.freeze({id:'company.core',domain:'company',description:'كيان قانوني داخل المجموعة'}),
    'finance.book':Object.freeze({id:'finance.book',domain:'finance',description:'دفتر مالي مستقل'}),
    'finance.budget':Object.freeze({id:'finance.budget',domain:'finance',description:'ميزانية تشغيل مستقلة'}),
    'finance.tax':Object.freeze({id:'finance.tax',domain:'finance',description:'التزامات وتسويات ضريبية'}),
    'hr.management':Object.freeze({id:'hr.management',domain:'hr',description:'إدارة وقيادة وموظفون'}),
    'documents.identity':Object.freeze({id:'documents.identity',domain:'documents',description:'هوية قانونية للمستندات'}),
    'documents.signature':Object.freeze({id:'documents.signature',domain:'documents',description:'توقيع مفوض وإصداراته'}),
    'map.company':Object.freeze({id:'map.company',domain:'map',description:'طبقات وفلاتر منشآت الشركة'}),
    'conference.host':Object.freeze({id:'conference.host',domain:'conference',description:'استضافة مؤتمر المجموعة'}),
    'conference.participant':Object.freeze({id:'conference.participant',domain:'conference',description:'مساهمة الشركة في المؤتمر'}),
    'governance.group':Object.freeze({id:'governance.group',domain:'governance',description:'حوكمة المجموعة القابضة'}),
    'treasury.parent':Object.freeze({id:'treasury.parent',domain:'finance',description:'خزينة القابضة المركزية'}),
    'operations.fleet':Object.freeze({id:'operations.fleet',domain:'operations',description:'تشغيل أسطول ومسارات'}),
    'operations.energy':Object.freeze({id:'operations.energy',domain:'operations',description:'تشغيل مشاريع الطاقة'}),
    'operations.bank':Object.freeze({id:'operations.bank',domain:'operations',description:'تشغيل الخدمات البنكية'}),
    'operations.mobility':Object.freeze({id:'operations.mobility',domain:'operations',description:'تشغيل التنقل الذكي'}),
    'asset.aircraft':Object.freeze({id:'asset.aircraft',domain:'assets',description:'امتلاك وتشغيل الطائرات'}),
    'asset.vessel':Object.freeze({id:'asset.vessel',domain:'assets',description:'امتلاك وتشغيل السفن'}),
    'asset.truck':Object.freeze({id:'asset.truck',domain:'assets',description:'امتلاك وتشغيل الشاحنات'}),
    'asset.mobility-vehicle':Object.freeze({id:'asset.mobility-vehicle',domain:'assets',description:'امتلاك مركبات التنقل'}),
    'route.air':Object.freeze({id:'route.air',domain:'routes',description:'مسارات جوية'}),
    'route.sea':Object.freeze({id:'route.sea',domain:'routes',description:'مسارات بحرية'}),
    'route.road':Object.freeze({id:'route.road',domain:'routes',description:'مسارات برية'}),
    'facility.airport':Object.freeze({id:'facility.airport',domain:'facilities',description:'قواعد ومطارات'}),
    'facility.port':Object.freeze({id:'facility.port',domain:'facilities',description:'قواعد وموانئ'}),
    'facility.logistics':Object.freeze({id:'facility.logistics',domain:'facilities',description:'مراكز لوجستية'}),
    'facility.energy':Object.freeze({id:'facility.energy',domain:'facilities',description:'منشآت طاقة'}),
    'facility.bank':Object.freeze({id:'facility.bank',domain:'facilities',description:'فروع ومرافق بنكية'}),
    'facility.mobility':Object.freeze({id:'facility.mobility',domain:'facilities',description:'مراكز تنقل ذكي'})
  });
  const BUILTIN_CAPABILITIES=Object.freeze(Object.values(BUILTIN_DEFINITIONS_RAW).map(row=>Object.freeze({schema:CAPABILITY_SCHEMA,...row})));
  const definitions=new Map(BUILTIN_CAPABILITIES.map(row=>[row.id,row]));
  const adapters=new Map(ADAPTER_KINDS.map(kind=>[kind,new Map()]));
  let sealed=false;

  function normalizeId(value){return String(value||'').trim();}
  function has(capabilityId){return definitions.has(normalizeId(capabilityId));}
  function get(capabilityId){return definitions.get(normalizeId(capabilityId))||null;}
  function list(options={}){
    const domain=normalizeId(options.domain);
    return [...definitions.values()].filter(row=>!domain||row.domain===domain);
  }
  function validateCapability(descriptor){
    const errors=[],id=normalizeId(descriptor?.id),domain=normalizeId(descriptor?.domain),description=String(descriptor?.description||'').trim();
    if(!descriptor||typeof descriptor!=='object'||Array.isArray(descriptor))return {ok:false,errors:['capability-descriptor-invalid']};
    if(descriptor.schema!==CAPABILITY_SCHEMA)errors.push(`capability-schema:${id||'empty'}`);
    if(!CAPABILITY_ID.test(id))errors.push(`capability-id:${id||'empty'}`);
    if(!CAPABILITY_ID.test(domain))errors.push(`capability-domain:${id||'empty'}`);
    if(!description||description.length>240||/[<>\u0000-\u001f\u007f]/u.test(description))errors.push(`capability-description:${id||'empty'}`);
    return {ok:errors.length===0,errors};
  }
  function registerCapability(descriptor){
    if(sealed)throw new Error('capability-registry-sealed');const validation=validateCapability(descriptor);if(!validation.ok)throw new Error(validation.errors.join(','));
    const id=normalizeId(descriptor.id),candidate=Object.freeze({schema:CAPABILITY_SCHEMA,id,domain:normalizeId(descriptor.domain),description:String(descriptor.description).trim()}),existing=definitions.get(id);
    if(existing){const same=existing.schema===candidate.schema&&existing.domain===candidate.domain&&existing.description===candidate.description;throw new Error(`${same?'capability-duplicate':'capability-conflict'}:${id}`);}
    definitions.set(id,candidate);return candidate;
  }
  function validate(capabilityIds){
    const errors=[],seen=new Set();
    if(!Array.isArray(capabilityIds))return {ok:false,errors:['capabilities-not-array']};
    for(const raw of capabilityIds){
      const id=normalizeId(raw);
      if(!CAPABILITY_ID.test(id))errors.push(`capability-id:${id||'empty'}`);
      else if(seen.has(id))errors.push(`capability-duplicate:${id}`);
      else if(!has(id))errors.push(`capability-unknown:${id}`);
      seen.add(id);
    }
    return {ok:errors.length===0,errors};
  }
  function validateAdapter(kind,id,adapter){
    const errors=[];kind=normalizeId(kind);id=normalizeId(id);
    if(!adapters.has(kind))errors.push(`adapter-kind-unknown:${kind}`);
    if(!CAPABILITY_ID.test(id))errors.push(`adapter-id-invalid:${id||'empty'}`);
    if(!adapter||typeof adapter!=='object')errors.push(`adapter-descriptor-invalid:${kind}:${id}`);
    else{
      if(adapter.schema!=='gh-company-adapter/v1')errors.push(`adapter-schema:${kind}:${id}`);
      if(adapter.kind!==kind||adapter.id!==id)errors.push(`adapter-identity:${kind}:${id}`);
      if(!Number.isSafeInteger(Number(adapter.version))||Number(adapter.version)<1)errors.push(`adapter-version:${kind}:${id}`);
      for(const method of ['supports','assertAvailable','resolve'])if(typeof adapter[method]!=='function')errors.push(`adapter-method:${kind}:${id}:${method}`);
      if(!Array.isArray(adapter.engineNames)||!adapter.engineNames.length||adapter.engineNames.some(name=>!/^GH_[A-Z0-9_]+$/.test(String(name||''))))errors.push(`adapter-engines:${kind}:${id}`);
    }
    return {ok:errors.length===0,errors};
  }
  function registerAdapter(kind,id,adapter){
    kind=normalizeId(kind);id=normalizeId(id);
    if(sealed)throw new Error('capability-registry-sealed');
    const validation=validateAdapter(kind,id,adapter);if(!validation.ok)throw new Error(validation.errors.join(','));
    const bucket=adapters.get(kind),existing=bucket.get(id);
    if(existing&&existing!==adapter)throw new Error(`adapter-duplicate:${kind}:${id}`);
    bucket.set(id,adapter);return adapter;
  }
  function getAdapter(kind,id,options={}){
    kind=normalizeId(kind);id=normalizeId(id);
    const adapter=adapters.get(kind)?.get(id)||null;
    if(!adapter&&options.required===true)throw new Error(`adapter-not-found:${kind}:${id}`);
    return adapter;
  }
  function listAdapters(kind){
    kind=normalizeId(kind);if(!adapters.has(kind))return [];
    return [...adapters.get(kind).entries()].map(([id,adapter])=>({kind,id,adapter}));
  }
  function seal(){sealed=true;return snapshot();}
  function isSealed(){return sealed;}
  function snapshot(){
    const counts={};for(const kind of ADAPTER_KINDS)counts[kind]=adapters.get(kind).size;
    return Object.freeze({version:VERSION,sealed,capabilities:definitions.size,builtinCapabilities:BUILTIN_CAPABILITIES.length,adapters:Object.freeze(counts)});
  }

  const API=Object.freeze({VERSION,CAPABILITY_SCHEMA,CAPABILITY_ID,ADAPTER_KINDS,BUILTIN_CAPABILITIES,has,get,list,validate,validateCapability,registerCapability,validateAdapter,registerAdapter,getAdapter,listAdapters,seal,isSealed,snapshot});
  globalThis.GH_CAPABILITY_REGISTRY=API;
  if(globalThis.window&&globalThis.window!==globalThis)globalThis.window.GH_CAPABILITY_REGISTRY=API;
  if(typeof module!=='undefined'&&module.exports)module.exports=API;
})();

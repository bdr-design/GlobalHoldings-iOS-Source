(()=>{
  'use strict';

  const VERSION='GH-COMPANY-ADAPTERS-1.0.0';
  const PROVIDER_SCHEMA='gh-company-adapter-provider/v1';
  const registry=globalThis.GH_CAPABILITY_REGISTRY;
  if(!registry?.registerAdapter)throw new Error('capability-registry-missing');

  const PROFILES=Object.freeze({
    lifecycle:Object.freeze({
      'holding-company-v1':['GH_GAME_LIFECYCLE','GH_CORPORATE_CORE'],
      'generic-company-v1':['GH_CORPORATE_CORE']
    }),
    operations:Object.freeze({
      'holding-governance-v1':['GH_CORPORATE_CORE'],
      'standard-company-operations-v1':['GH_CORPORATE_CORE'],
      'fleet-route-air-v1':['GH_FLEET_CORE','GH_ROUTE_CORE'],
      'fleet-route-sea-v1':['GH_FLEET_CORE','GH_ROUTE_CORE'],
      'fleet-route-road-v1':['GH_FLEET_CORE','GH_ROUTE_CORE'],
      'energy-project-v1':['GH_ENERGY_CORE'],
      'banking-services-v1':['GH_BANKING_CORE'],
      'mobility-fleet-v1':['GH_MOBILITY_CORE']
    }),
    finance:Object.freeze({
      'group-treasury-v1':['GH_FINANCE_CORE'],
      'standard-company-finance-v1':['GH_FINANCE_CORE']
    }),
    hr:Object.freeze({
      'group-governance-v1':['GH_HR_CORE','GH_CORPORATE_CORE'],
      'standard-company-hr-v1':['GH_HR_CORE']
    }),
    facilities:Object.freeze({
      'holding-facilities-v1':['GH_FACILITY_CORE'],
      'standard-company-facilities-v1':['GH_FACILITY_CORE'],
      'airport-network-v1':['GH_FACILITY_CORE'],
      'port-network-v1':['GH_FACILITY_CORE'],
      'logistics-network-v1':['GH_FACILITY_CORE'],
      'energy-sites-v1':['GH_FACILITY_CORE','GH_ENERGY_CORE'],
      'bank-network-v1':['GH_FACILITY_CORE','GH_BANKING_CORE'],
      'mobility-network-v1':['GH_FACILITY_CORE','GH_MOBILITY_CORE']
    }),
    map:Object.freeze({
      'company-map-v1':['GH_MAP_FEATURE_CORE','GH_MAP_LAYER_REGISTRY'],
      'fleet-map-v1':['GH_MAP_FEATURE_CORE','GH_MAP_LAYER_REGISTRY'],
      'mobility-map-v1':['GH_MAP_FEATURE_CORE','GH_MAP_LAYER_REGISTRY']
    }),
    conference:Object.freeze({
      'group-host-v1':['GH_CONFERENCE','GH_CONF_MODEL'],
      'generic-company-v1':['GH_CONFERENCE','GH_CONF_MODEL'],
      'fleet-company-v1':['GH_CONFERENCE','GH_CONF_MODEL'],
      'energy-company-v1':['GH_CONFERENCE','GH_CONF_MODEL'],
      'bank-company-v1':['GH_CONFERENCE','GH_CONF_MODEL'],
      'mobility-company-v1':['GH_CONFERENCE','GH_CONF_MODEL']
    }),
    documents:Object.freeze({
      'legal-documents-v1':['GH_DOCUMENT_PROOF','GH_AUTHORIZATION']
    })
  });

  const object=value=>!!value&&typeof value==='object';
  const METHOD_NAME=/^[A-Za-z][A-Za-z0-9_-]{0,79}$/;
  const RESERVED_METHODS=new Set(['constructor','prototype','__proto__','toString','valueOf','hasOwnProperty','isPrototypeOf','propertyIsEnumerable','__defineGetter__','__defineSetter__','__lookupGetter__','__lookupSetter__']);
  const providers=new Map(),activeInvocations=new Set(),stateInvocationIds=new WeakMap();let stateInvocationSequence=0;
  function resolveEngines(engineNames,runtime=globalThis){
    const engines={};
    for(const name of engineNames){const engine=runtime?.[name];if(!object(engine)&&typeof engine!=='function')throw new Error(`company-adapter-engine-unavailable:${name}`);engines[name]=engine;}
    return Object.freeze(engines);
  }
  function descriptor(kind,id,engineNames){
    const names=Object.freeze([...engineNames]);
    const adapter={
      schema:'gh-company-adapter/v1',version:1,kind,id,engineNames:names,
      supports(definition){return Boolean(definition&&definition.adapters?.[kind]===id);},
      assertAvailable(runtime=globalThis){resolveEngines(names,runtime);return true;},
      resolve(runtime=globalThis){
        const engines=resolveEngines(names,runtime),ordered=names.map(name=>engines[name]);
        return Object.freeze({
          kind,id,engines,
          engine(name){const engine=engines[name];if(!engine)throw new Error(`company-adapter-engine-not-declared:${kind}:${id}:${name}`);return engine;},
          call(method,...args){for(const engine of ordered)if(typeof engine?.[method]==='function')return engine[method](...args);throw new Error(`company-adapter-method-unavailable:${kind}:${id}:${String(method||'')}`);},
          execute(...args){const engine=ordered.find(candidate=>typeof candidate?.execute==='function');if(!engine)throw new Error(`company-adapter-execute-unavailable:${kind}:${id}`);return engine.execute(...args);}
        });
      }
    };
    return Object.freeze(adapter);
  }

  function providerKey(kind,id){return `${String(kind||'').trim()}:${String(id||'').trim()}`;}
  function providerSignature(provider){return JSON.stringify([provider.schema,provider.version,provider.kind,provider.id,provider.capabilityId,provider.engineNames,provider.methods]);}
  function validateProvider(input){
    const errors=[],kind=String(input?.kind||'').trim(),id=String(input?.id||'').trim(),capabilityId=String(input?.capabilityId||'').trim(),engineNames=input?.engineNames,methods=input?.methods;
    if(!object(input)||Array.isArray(input))return {ok:false,errors:['company-adapter-provider-invalid']};
    if(input.schema!==PROVIDER_SCHEMA)errors.push(`company-adapter-provider-schema:${id||'empty'}`);
    if(!registry.ADAPTER_KINDS.includes(kind))errors.push(`company-adapter-provider-kind:${kind||'empty'}`);
    if(!registry.CAPABILITY_ID.test(id))errors.push(`company-adapter-provider-id:${id||'empty'}`);
    if(!Number.isSafeInteger(Number(input.version))||Number(input.version)<1)errors.push(`company-adapter-provider-version:${kind||'empty'}:${id||'empty'}`);
    if(capabilityId&&!registry.CAPABILITY_ID.test(capabilityId))errors.push(`company-adapter-provider-capability:${kind||'empty'}:${id||'empty'}`);else if(capabilityId&&!registry.has(capabilityId))errors.push(`company-adapter-provider-capability-unknown:${capabilityId}`);
    if(!Array.isArray(engineNames)||!engineNames.length||new Set(engineNames).size!==engineNames.length||engineNames.some(name=>!/^GH_[A-Z0-9_]+$/.test(String(name||''))))errors.push(`company-adapter-provider-engines:${kind||'empty'}:${id||'empty'}`);
    if(!Array.isArray(methods)||!methods.length||new Set(methods).size!==methods.length||methods.some(method=>method!=='*'&&(!METHOD_NAME.test(String(method||''))||RESERVED_METHODS.has(String(method)))))errors.push(`company-adapter-provider-methods:${kind||'empty'}:${id||'empty'}`);
    return {ok:errors.length===0,errors};
  }
  function normalizeProvider(input){
    const capabilityId=String(input.capabilityId||'').trim()||null;
    return Object.freeze({schema:PROVIDER_SCHEMA,version:Number(input.version),kind:String(input.kind).trim(),id:String(input.id).trim(),capabilityId,engineNames:Object.freeze(input.engineNames.map(String)),methods:Object.freeze(input.methods.map(String))});
  }
  function preflightProviders(rows,options={}){
    if(registry.isSealed?.())throw new Error('capability-registry-sealed');if(!Array.isArray(rows)||!rows.length)throw new Error('company-adapter-provider-batch-invalid');
    const staged=[],batch=new Map();
    for(const input of rows){const validation=validateProvider(input);if(!validation.ok)throw new Error(validation.errors.join(','));const provider=normalizeProvider(input),key=providerKey(provider.kind,provider.id),seen=batch.get(key),existing=providers.get(key);if(provider.methods.includes('*')&&options.allowWildcard!==true)throw new Error(`company-adapter-provider-methods:${provider.kind}:${provider.id}`);
      if(seen)throw new Error(`company-adapter-provider-${providerSignature(seen)===providerSignature(provider)?'duplicate':'conflict'}:${key}`);
      if(existing)throw new Error(`company-adapter-provider-${providerSignature(existing)===providerSignature(provider)?'duplicate':'conflict'}:${key}`);
      if(registry.getAdapter(provider.kind,provider.id))throw new Error(`company-adapter-provider-adapter-conflict:${key}`);
      const adapter=descriptor(provider.kind,provider.id,provider.engineNames),adapterValidation=registry.validateAdapter?.(provider.kind,provider.id,adapter);if(adapterValidation&&!adapterValidation.ok)throw new Error(adapterValidation.errors.join(','));batch.set(key,provider);staged.push({key,provider,adapter});
    }
    return staged;
  }
  function commitProviders(staged){
    for(const row of staged)registry.registerAdapter(row.provider.kind,row.provider.id,row.adapter);
    for(const row of staged)providers.set(row.key,row.provider);
    return Object.freeze(staged.map(row=>row.provider));
  }
  function registerProviders(rows){return commitProviders(preflightProviders(rows));}
  function registerProvider(provider){return registerProviders([provider])[0];}
  function getProvider(kind,id){return providers.get(providerKey(kind,id))||null;}
  function listProviders(kind=''){kind=String(kind||'').trim();return [...providers.values()].filter(provider=>!kind||provider.kind===kind);}
  function resolveProvider(kind,id,runtime=globalThis){
    kind=String(kind||'').trim();id=String(id||'').trim();const provider=getProvider(kind,id);if(!provider)throw new Error(`company-adapter-provider-unknown:${kind}:${id}`);return registry.getAdapter(kind,id,{required:true}).resolve(runtime);
  }
  function resolveAdapter(state,companyId,kind,options={}){
    const platform=globalThis.GH_COMPANY_PLATFORM;if(!platform?.requireCompany)throw new Error('company-platform-missing');if(!object(state)||Array.isArray(state))throw new Error('company-adapter-state-invalid');kind=String(kind||'').trim();if(!registry.ADAPTER_KINDS.includes(kind))throw new Error(`company-adapter-provider-kind:${kind||'empty'}`);
    const company=platform.requireCompany(state,String(companyId||'').trim(),{registered:options.registered!==false,operational:options.operational===true,capability:options.capability||undefined}),providerId=String(company.definition.adapters?.[kind]||'').trim();if(!providerId)throw new Error(`company-adapter-reference-missing:${company.definition.id}:${kind}`);
    const provider=getProvider(kind,providerId);if(!provider)throw new Error(`company-adapter-provider-unknown:${kind}:${providerId}`);if(provider.capabilityId&&!company.definition.capabilities.includes(provider.capabilityId))throw new Error(`company-adapter-provider-capability-missing:${company.id}:${provider.capabilityId}`);
    const adapter=registry.getAdapter(kind,providerId,{required:true});if(adapter.supports(company.definition)!==true)throw new Error(`company-adapter-unsupported:${company.definition.id}:${kind}:${providerId}`);const resolved=adapter.resolve(options.runtime||globalThis);
    return Object.freeze({...resolved,companyId:company.id,definitionId:company.definition.definitionId,capabilityId:provider.capabilityId,provider,company});
  }
  function invocationStateId(state){let id=stateInvocationIds.get(state);if(!id){id=++stateInvocationSequence;stateInvocationIds.set(state,id);}return id;}
  function invokeAdapter(state,companyId,kind,method,args=[],options={}){
    method=String(method||'').trim();if(!METHOD_NAME.test(method)||RESERVED_METHODS.has(method))throw new Error(`company-adapter-method-invalid:${method||'empty'}`);if(!Array.isArray(args)||args.length>32)throw new Error('company-adapter-arguments-invalid');
    const binding=resolveAdapter(state,companyId,kind,options),allowed=binding.provider.methods.includes('*')||binding.provider.methods.includes(method);if(!allowed)throw new Error(`company-adapter-method-not-allowed:${binding.kind}:${binding.id}:${method}`);
    const key=`${invocationStateId(state)}:${binding.companyId}:${binding.kind}:${binding.id}:${method}`;if(activeInvocations.has(key))throw new Error(`company-adapter-recursion:${binding.companyId}:${binding.kind}:${binding.id}:${method}`);activeInvocations.add(key);
    const context=Object.freeze({state,companyId:binding.companyId,company:binding.company,definition:binding.company.definition,definitionId:binding.definitionId,capabilityId:binding.capabilityId,adapterKind:binding.kind,adapterId:binding.id});
    try{const result=method==='execute'?binding.execute(context,...args):binding.call(method,context,...args);if(result&&typeof result.then==='function')return Promise.resolve(result).finally(()=>activeInvocations.delete(key));activeInvocations.delete(key);return result;}catch(error){activeInvocations.delete(key);throw error;}
  }

  const builtinProviders=[];for(const [kind,profiles] of Object.entries(PROFILES))for(const [id,engineNames] of Object.entries(profiles))builtinProviders.push({schema:PROVIDER_SCHEMA,version:1,kind,id,capabilityId:null,engineNames,methods:['*']});commitProviders(preflightProviders(builtinProviders,{allowWildcard:true}));
  const snapshot=()=>{const counts={};for(const kind of registry.ADAPTER_KINDS)counts[kind]=listProviders(kind).length;return Object.freeze({version:VERSION,providerSchema:PROVIDER_SCHEMA,count:providers.size,providers:Object.freeze(counts),profiles:Object.freeze(Object.fromEntries(Object.entries(PROFILES).map(([kind,rows])=>[kind,Object.freeze(Object.keys(rows))])))});};
  const API=Object.freeze({VERSION,PROVIDER_SCHEMA,PROFILES,validateProvider,registerProvider,registerProviders,getProvider,listProviders,resolveProvider,resolveAdapter,invokeAdapter,resolveEngines,snapshot});
  globalThis.GH_COMPANY_ADAPTERS=API;
  if(globalThis.window&&globalThis.window!==globalThis)globalThis.window.GH_COMPANY_ADAPTERS=API;
  if(typeof module!=='undefined'&&module.exports)module.exports=API;
})();

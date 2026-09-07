(()=>{
  'use strict';
  const VERSION='2.9.1', IDEMPOTENCY_LIMIT=512, IDEMPOTENCY_TTL=7*86400;
  const owners=new Map();
  const clone=v=>globalThis.structuredClone?structuredClone(v):JSON.parse(JSON.stringify(v));
  const now=s=>Number(s?.simSeconds)||0;
  const stable=v=>Array.isArray(v)?`[${v.map(stable).join(',')}]`:v&&typeof v==='object'?`{${Object.keys(v).sort().map(k=>`${JSON.stringify(k)}:${stable(v[k])}`).join(',')}}`:JSON.stringify(v);
  function prune(r,at){
    for(const [key,row] of Object.entries(r.idempotency))if(!row||!Number.isFinite(row.at)||at-row.at>IDEMPOTENCY_TTL||row.at>at||!row.fingerprint)delete r.idempotency[key];
    const keys=Object.keys(r.idempotency).sort((a,b)=>r.idempotency[a].at-r.idempotency[b].at);
    for(const key of keys.slice(0,Math.max(0,keys.length-IDEMPOTENCY_LIMIT)))delete r.idempotency[key];
  }
  function ensureRuntime(state){
    state.domainRuntime=state.domainRuntime&&typeof state.domainRuntime==='object'&&!Array.isArray(state.domainRuntime)?state.domainRuntime:{};
    const r=state.domainRuntime;
    r.commandSequence=Math.max(0,Math.floor(Number(r.commandSequence)||0));
    r.commands=Array.isArray(r.commands)?r.commands:[];
    r.idempotency=r.idempotency&&typeof r.idempotency==='object'&&!Array.isArray(r.idempotency)?r.idempotency:{};
    r.owners=r.owners&&typeof r.owners==='object'&&!Array.isArray(r.owners)?r.owners:{};
    r.schema='gh-domain-runtime-v1';prune(r,now(state));return r;
  }
  function register(domain,api){
    domain=String(domain||'').trim();if(!domain||!api||typeof api.execute!=='function')throw new Error('Invalid domain owner registration');
    if(owners.has(domain)&&owners.get(domain)!==api)throw new Error(`Duplicate domain owner: ${domain}`);
    owners.set(domain,api);return api;
  }
  function record(state,row){const r=ensureRuntime(state);r.commands.unshift(row);r.commands=r.commands.slice(0,240);return row;}
  function validateContract(domain,name,value,payload){
    const key=domain+':'+name,object=value&&typeof value==='object'&&!Array.isArray(value);
    const fail=()=>{throw new Error('Domain result contract violated: '+key);};
    if(key==='finance:settle-cheque'&&(!object||typeof value.settled!=='boolean'||!['settled','bounced'].includes(value.status)||typeof value.reason!=='string'||!value.id))fail();
    if(key==='finance:transfer'&&(!object||value.transferred!==true||value.amount!==Number(payload.amount)||value.from!==payload.from||value.to!==payload.to))fail();
    if(key==='procurement:purchase-assets'&&(!object||value.count!==Number(payload.qty)||value.baseId!==payload.base?.id||!Array.isArray(value.deliveryOrderIds)||!Array.isArray(value.assetIds)||value.deliveryOrderIds.length!==value.count||value.assetIds.length!==value.count||new Set(value.deliveryOrderIds).size!==value.count||new Set(value.assetIds).size!==value.count))fail();
    if(key==='hr:hire'&&(!object||value.ok!==true||value.missingAfter!==0||!Number.isInteger(value.total)))fail();
    if(key==='facilities:hire'&&(!object||value.ok!==true||!Number.isFinite(value.staff)))fail();
    if(key==='fleet:record-delivery'&&(!object||value.baseFacility!==payload.baseId||value.deliveryOrderId!==payload.deliveryId||!value.id))fail();
    if(['corporate:acquire-stake','market:acquire-stake'].includes(key)&&(!object||value.id!==payload.id||value.stake!==Number(payload.stake)))fail();
    return true;
  }
  function dispatch(ctx,domain,name,payload={},options={}){
    const state=ctx?.state||ctx;if(!state||typeof state!=='object')throw new Error('Domain command requires state');
    if(globalThis.GH_PERSISTENCE?.isLocked?.())throw new Error('Lifecycle persistence operation is in progress');
    const owner=owners.get(String(domain));if(!owner)throw new Error(`No owner registered for domain ${domain}`);
    const tx=globalThis.GH_TRANSACTION_CORE;if(!tx?.execute)throw new Error('Transaction owner unavailable');
    const startedAt=now(state),key=String(options.idempotencyKey||payload?.idempotencyKey||'').trim();
    if(key.length>160)throw new Error('Idempotency key too long');
    const scopedKey=JSON.stringify([domain,name,key]),fingerprint=stable(payload);
    let id=null;
    try{
      const apply=()=>{
        const r=ensureRuntime(state),cached=key?r.idempotency[scopedKey]:null;
        if(cached){if(cached.fingerprint!==fingerprint)throw new Error('Idempotency payload conflict');return clone(cached.result);}
        id=`DOM-${String(++r.commandSequence).padStart(9,'0')}`;
        const valid=owner.validate?owner.validate(ctx,name,payload):true;
        if(valid===false||valid?.ok===false)throw new Error(valid?.reason||'validation-rejected');
        const result=owner.execute(ctx,name,clone(payload),{id,domain,startedAt,actor:options.actor||'ui',authority:options.authority||null});
        if(result?.then)throw new Error('Domain result must be synchronous');
        validateContract(domain,name,result,payload);if(owner.validateResult){const resultCheck=owner.validateResult(name,result,payload);if(resultCheck===false||resultCheck?.ok===false)throw new Error('Domain result contract violated: '+domain+':'+name);}
        const wrapped={ok:true,commandId:id,result:result===undefined?null:result};
        record(state,{id,domain,name,status:'committed',at:startedAt,completedAt:now(state),actor:options.actor||'ui'});
        if(key){r.idempotency[scopedKey]={at:startedAt,fingerprint,result:clone(wrapped)};prune(r,startedAt);}
        globalThis.GH_EVENT_LEDGER?.record?.(state,{type:'DOMAIN_COMMAND_COMMITTED',domain,commandId:id,name,at:now(state),actor:options.actor||'ui'});
        globalThis.GH_CONTROL_PLANE?.evidence?.(state,'DOMAIN_COMMAND_COMMITTED',{commandId:id,domain,name});
        tx.afterCommit(()=>{
          const integrity=globalThis.GH_INTEGRITY_CORE?.check?.(state);
          const critical=integrity?.critical||((integrity?.issues||[]).filter(x=>x.severity==='critical'));
          if(critical?.length)throw new Error(`Integrity critical after ${domain}:${name}: ${critical.map(x=>x.id||x.code||x.title).join(', ')}`);
        },{critical:true,key:'domain-integrity'});
        return wrapped;
      };
      const out=(tx.isActive()?tx.join:tx.execute)(state,{label:`${domain}:${name}`,apply});
      return out.value;
    }catch(error){
      if(!tx.isActive()){
        record(state,{id,domain,name,status:'rolled_back',at:startedAt,error:String(error?.message||error)});
        globalThis.GH_CONTROL_PLANE?.incident?.(state,{fingerprint:`domain:${domain}:${name}:${String(error?.message||error)}`,code:'DOMAIN_COMMAND_FAILED',severity:'critical',domain,title:`فشل أمر ${domain}`,detail:String(error?.message||error),evidence:{commandId:id,name}});
      }
      throw error;
    }
  }
  function health(state){const r=ensureRuntime(state);return {schema:r.schema,registered:[...owners.keys()].sort(),commands:r.commands.length,failed:r.commands.filter(x=>x.status==='rolled_back').length};}
  const API=Object.freeze({VERSION,IDEMPOTENCY_LIMIT,IDEMPOTENCY_TTL,register,dispatch,validateContract,ensureRuntime,health,owners:()=>[...owners.keys()]});
  globalThis.GH_DOMAIN_COMMANDS=API;if(globalThis.window&&window!==globalThis)window.GH_DOMAIN_COMMANDS=API;if(typeof module!=='undefined'&&module.exports)module.exports=API;
})();

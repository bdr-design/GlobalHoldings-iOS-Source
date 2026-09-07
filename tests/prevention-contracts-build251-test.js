'use strict';
const assert=require('assert'),fs=require('fs'),vm=require('vm');
const {harness,minimal}=require('./helpers/core-harness'),{scenario}=require('./helpers/business-scenario');
let passed=0;async function test(name,fn){await fn();passed++;console.log('PASS '+name);}
(async()=>{
await test('every guarded complex result rejects the former Boolean contract and rolls back',()=>{
 for(const [domain,name,payload] of [['finance','settle-cheque',{id:'C'}],['finance','transfer',{from:'group',to:'air',amount:10}],['hr','hire',{}],['facilities','hire',{}],['procurement','purchase-assets',{qty:2,base:{id:'B'}}],['fleet','record-delivery',{baseId:'B',deliveryId:'D'}],['corporate','acquire-stake',{id:'M',stake:51}],['market','acquire-stake',{id:'M',stake:51}]]){
  const {s}=harness(['transaction-core','domain-command-core']),state=minimal();state.cash=100;
  s.GH_DOMAIN_COMMANDS.register(domain,{execute(){state.cash=0;return true;}});
  assert.throws(()=>s.GH_DOMAIN_COMMANDS.dispatch({state},domain,name,payload),/result contract/);assert.strictEqual(state.cash,100);
 }
});
await test('mutating validation rejection and result-validator rejection are atomic',()=>{
 for(const phase of ['validate','validateResult']){const {s}=harness(['transaction-core','domain-command-core']),state=minimal();state.cash=100;
 s.GH_DOMAIN_COMMANDS.register('sample',{[phase](){state.cash=0;return false;},execute(){state.cash=50;return {done:true};}});
 assert.throws(()=>s.GH_DOMAIN_COMMANDS.dispatch({state},'sample','run',{}));assert.strictEqual(state.cash,100);}
});
await test('critical post-commit failure restores each business field exactly once',()=>{
 const {s}=harness(['transaction-core']);let sets=0;const target=new Proxy({cash:100},{set(o,k,v){if(k==='cash')sets++;o[k]=v;return true;}});
 assert.throws(()=>s.GH_TRANSACTION_CORE.execute(target,{apply(){target.cash=0;s.GH_TRANSACTION_CORE.afterCommit(()=>{throw new Error('quota');},{critical:true});}}),/quota/);
 assert.strictEqual(target.cash,100);assert.strictEqual(sets,2);
});
await test('swallowed inner failure still poisons the enclosing transaction',()=>{
 const {s}=harness(['transaction-core','domain-command-core']),state=minimal();state.cash=100;
 s.GH_DOMAIN_COMMANDS.register('sample',{execute(){state.cash=0;throw new Error('inner');}});
 assert.throws(()=>s.GH_TRANSACTION_CORE.execute(state,{apply(){try{s.GH_DOMAIN_COMMANDS.dispatch({state},'sample','run');}catch{}state.cash=50;}}),/inner/);assert.strictEqual(state.cash,100);
});
await test('idempotency TTL expires only after its documented simulation-time window',()=>{
 const {s}=harness(['transaction-core','domain-command-core']),state=minimal();let applied=0;
 s.GH_DOMAIN_COMMANDS.register('sample',{execute(){applied++;return {done:true};}});
 const call=()=>s.GH_DOMAIN_COMMANDS.dispatch({state},'sample','run',{}, {idempotencyKey:'K'});
 const id=call().commandId;state.simSeconds=s.GH_DOMAIN_COMMANDS.IDEMPOTENCY_TTL;assert.strictEqual(call().commandId,id);assert.strictEqual(applied,1);state.simSeconds++;assert.notStrictEqual(call().commandId,id);assert.strictEqual(applied,2);
});
await test('AI cannot record execution without a matching live authorization',()=>{
 const {command,state}=scenario();const before=state.cash;
 assert.throws(()=>command('ai','record-execution',{id:'UNAUTHORIZED',result:{ok:true}}),/authority/);
 assert.strictEqual(state.cash,before);assert.strictEqual(state.advanced.ai.executionLog?.length||0,0);
 const r=command('ai','submit',{id:'AI-TEST',company:'air',kind:'workforce',cost:0,title:'Need',study:{score:99}});
 assert.throws(()=>command('ai','record-execution',{id:r.id,result:{ok:true}}),/authority/);
 command('ai','delegate',{id:r.id,letter:{authorizedBy:'Founder'}});assert.throws(()=>command('ai','record-execution',{id:r.id,result:true}),/authority/);
});
await test('HR failure after delivery keeps the request open and never departs an understaffed asset',()=>{
 const {s,state,ctx,command,request}=scenario(),r=request(3);s.GH_REQUEST_CORE.authorize(ctx,r.id);s.GH_REQUEST_CORE.tick(ctx);state.simSeconds=61;s.GH_REQUEST_CORE.tick(ctx);
 const old=JSON.stringify(state.crew);s.GH_HR_CORE=undefined;assert.throws(()=>s.GH_REQUEST_CORE.tick(ctx),/HR|hr/);assert.notStrictEqual(r.status,'completed');assert.strictEqual(JSON.stringify(state.crew),old);
 assert.throws(()=>command('fleet','depart',{id:state.assets[0].id,route:{id:'NONE',type:'air'}}));
});
await test('save/reload migration does not copy subsidiary cash into holding treasury',()=>{
 const {s,state,defaults,load}=scenario();load('migration-core');const before=state.cash,holding=state.treasury.accounts[0].balance,books=JSON.stringify(state.companyFinance);
 const raw=JSON.parse(JSON.stringify(state));s.GH_MIGRATION_CORE.completeBusinessState(raw,{defaultState:defaults,initialStocks:[],crewRolesSeed:state.crew});s.GH_FINANCE_CORE.ensure(raw);
 assert.strictEqual(raw.cash,before);assert.strictEqual(raw.treasury.accounts[0].balance,holding);assert.strictEqual(JSON.stringify(raw.companyFinance),books);
});
await test('power reserve checks stay inactive until there is a power business and still catch active deficits',()=>{
 const {s,state,load}=scenario();load('integrity-core');state.realism.energy={reserveMargin:-5,storageHealth:50};
 assert(!s.GH_INTEGRITY_CORE.check(state).issues.some(i=>i.id.startsWith('POWER_')));
 state.openedCompanies.push('power');assert(s.GH_INTEGRITY_CORE.check(state).issues.some(i=>i.id==='POWER_RESERVE_MARGIN_NEGATIVE'&&i.severity==='critical'));
});
await test('map provider times out, opens its circuit and recovers after the cooldown',async()=>{
 const {s}=harness(['map-provider-core']);let now=100,calls=0,healthy=false;
 const provider=s.GH_MAP_PROVIDER.create({timeoutMs:5,now:()=>now,cooldownMs:50,fetchImpl:(_url,{signal})=>{calls++;if(healthy)return Promise.resolve({ok:true,json:async()=>({code:'Ok',routes:[{distance:1000,duration:100,geometry:{coordinates:[[46,24],[47,25]]}}]})});return new Promise((_resolve,reject)=>signal.addEventListener('abort',()=>reject(new Error('timeout'))));}});
 for(let i=0;i<3;i++)assert.strictEqual((await provider.road([24,46],[25,47])).status,'degraded');assert.strictEqual((await provider.road([24,46],[25,47])).status,'circuit-open');assert.strictEqual(calls,3);
 now+=51;healthy=true;assert.strictEqual((await provider.road([24,46],[25,47])).ok,true);assert.strictEqual(provider.health().failures,0);assert.strictEqual((await provider.road([91,46],[25,47])).status,'invalid-coordinates');assert.strictEqual(calls,4);
});
await test('malformed route geometry and invalid distances never enter route state',async()=>{
 const {s}=harness(['map-provider-core']);for(const route of [{distance:NaN,duration:10,geometry:{coordinates:[[46,24],[47,25]]}},{distance:1,duration:10,geometry:{coordinates:[[46,24],[999,25]]}},{distance:1,duration:10,geometry:{coordinates:[]}}]){const p=s.GH_MAP_PROVIDER.create({fetchImpl:async()=>({ok:true,json:async()=>({code:'Ok',routes:[route]})})});assert.strictEqual((await p.road([24,46],[25,47])).ok,false);}
});
await test('CI output paths cannot collide with the BUILD file on case-insensitive macOS volumes',()=>{
 const files=['.github/workflows/build-unsigned-ipa.yml','scripts/test_runner.cjs','tests/browser-e2e.js','tests/browser-failures.js'];
 const joined=files.map(file=>fs.readFileSync(file,'utf8')).join('\n');
 for(const forbidden of ['GITHUB_WORKSPACE/build',"ws / 'build' /",'build/ci','$BUILD_ROOT/ci'])assert(!joined.includes(forbidden),`unsafe CI output path remains: ${forbidden}`);
 assert(joined.includes('.ci-output/ci'));
});
await test('actual Swift bootstrap JavaScript parses, honors native durability and blocks future schema',()=>{
 const swift=fs.readFileSync('iOS/GlobalHoldings/GlobalSaveVault.swift','utf8');const body=swift.slice(swift.indexOf('func bootstrapJavaScript'),swift.indexOf('private func envelopes'));
 const template=body.match(/return (?:compatibility \+ )?"""([\s\S]*?)"""/)[1];
 const native={saveVersion:'2.0.0',saveRevision:4,resetEpoch:100,simSeconds:40,assets:[],marker:'native'};
 for(const kind of ['older','newer-unacknowledged','equal-revision-corrupt','future','empty']){
  const local=kind==='empty'?null:JSON.stringify({...native,saveVersion:kind==='future'?'9.0.0':'2.0.0',saveRevision:kind==='older'?3:kind==='newer-unacknowledged'?5:4,marker:'browser'}),m=new Map(local?[['global-holdings-world-v2.0.0',local]]:[]),sandbox={TextDecoder,Uint8Array,atob,console,localStorage:{getItem:k=>m.get(k)??null,setItem:(k,v)=>m.set(k,v)},sessionStorage:{setItem(){}}};sandbox.window=sandbox;
  const vars={b64:Buffer.from(JSON.stringify(native)).toString('base64'),forceValue:'false',pauseValue:'false',nativeSim:40,nativeRevision:4,nativeReset:100};
  const js=template.replace(/\\\((\w+)\)/g,(_m,key)=>String(vars[key]));vm.runInNewContext(js,sandbox);
  if(kind==='future'){assert.strictEqual(sandbox.GH_NATIVE_RECOVERY_BLOCKED,true);assert.strictEqual(m.get('global-holdings-world-v2.0.0'),local);}else assert.strictEqual(m.get('global-holdings-world-v2.0.0'),JSON.stringify(native));
 }
});
console.log(JSON.stringify({suite:'preventive-contracts',passed,total:passed}));
})().catch(e=>{console.error(e);process.exitCode=1;});

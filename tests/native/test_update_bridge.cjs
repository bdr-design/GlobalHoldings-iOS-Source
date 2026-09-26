'use strict';
// Runs JavaScript extracted from the native Swift string. The UI/WebKit bridge is controlled,
// not a live iPhone. WebApp validator is the complete unchanged current Build335 module.
const fs=require('fs'),path=require('path'),vm=require('vm'),assert=require('assert/strict'),crypto=require('crypto');
const args=process.argv.slice(2),get=n=>args[args.indexOf(n)+1];
const dir=get('--tests'),web=get('--web'),out=get('--out')||dir;
if(!dir)throw Error('--tests required');fs.mkdirSync(out,{recursive:true});
const swiftString=fs.readFileSync(path.join(dir,'update-script.swift-string.txt'),'utf8');
const genericPack={format:'global-holdings-update',manifest:{version:'3.0.0',build:335},operationsJSON:'[]'};
const source=swiftString.replaceAll('\\(encoded)',Buffer.from(JSON.stringify(genericPack)).toString('base64')).replaceAll('\\(version)','3.0.0').replaceAll('\\(build)','335');
if(source.includes('\\('))throw Error('Unresolved Swift interpolation');
const rows=[];async function test(name,fn){try{await fn();rows.push({name,ok:true});}catch(e){rows.push({name,ok:false,error:String(e.stack||e)});}}
(async()=>{
 const healthy=()=>({status:'healthy',counts:{critical:0,warning:0,total:0}});
 const cases=[
  ['healthy explicit apply',()=>true,healthy,'commitUpdateState'],
  ['warning not critical',()=>true,()=>({status:'warning',counts:{critical:0,warning:1,total:1}}),'commitUpdateState'],
  ['missing runtime',null,null,'updateOperationsFailed'],
  ['missing apply owner',undefined,healthy,'updateOperationsFailed'],
  ['missing integrity owner',()=>true,undefined,'updateOperationsFailed'],
  ['ambiguous false / duplicate',()=>false,healthy,'updateOperationsFailed'],
  ['undefined apply result',()=>undefined,healthy,'updateOperationsFailed'],
  ['unrecognized apply object',()=>({ok:true}),healthy,'updateOperationsFailed'],
  ['throw during apply',()=>{throw Error('injected');},healthy,'updateOperationsFailed'],
  ['rejected async apply',()=>Promise.reject(Error('async injected')),healthy,'updateOperationsFailed'],
  ['critical integrity',()=>true,()=>({status:'critical',counts:{critical:1}}),'updateOperationsFailed'],
  ['missing report',()=>true,()=>null,'updateOperationsFailed'],
  ['missing counts',()=>true,()=>({status:'healthy'}),'updateOperationsFailed'],
  ['contradictory counts',()=>true,()=>({status:'healthy',counts:{critical:5}}),'updateOperationsFailed'],
  ['unrecognized status',()=>true,()=>({status:'unknown',counts:{critical:0}}),'updateOperationsFailed'],
  ['missing state',()=>true,healthy,'updateOperationsFailed',true],
 ];
 for(const [name,apply,integrity,expected,noState] of cases)await test(name,async()=>{
   const sent=[],ctx={Uint8Array,TextDecoder,Promise,Error,JSON,atob:s=>Buffer.from(s,'base64').toString('binary')};
   ctx.window=ctx;ctx.__GH_STATE__=noState?null:{saveVersion:'2.0.0',saveRevision:1,resetEpoch:0,simSeconds:0};
   ctx.webkit={messageHandlers:{updateBridge:{postMessage:m=>sent.push(m)}}};
   if(apply!==null)ctx.GH_RUNTIME={applyNativeUpdate:apply,businessIntegrity:integrity};
   vm.runInNewContext(source,ctx,{timeout:2000});await new Promise(r=>setImmediate(r));
   assert.equal(sent.length,1);assert.equal(sent[0].action,expected);assert.equal(sent[0].build,335);assert.equal(sent[0].version,'3.0.0');
 });
 const checks=JSON.parse(fs.readFileSync(path.join(dir,'source-checks.json')));
 await test('privileged handler source gates webview/mainframe/origin',()=>assert.equal(checks.handler_origin_gate,true));
 await test('raw signed text is forwarded by native owner',()=>assert.equal(checks.raw_operations_forwarded,true));
 if(web){
   const s={console,TextEncoder,TextDecoder,Uint8Array,crypto:crypto.webcrypto};s.window=s;
   vm.runInNewContext(fs.readFileSync(path.join(web,'advanced-core.js'),'utf8'),s,{filename:'current334/advanced-core.js'});
   let emitted;
   const file=path.join(dir,'native-web-payload.json');
   if(fs.existsSync(file)) emitted=JSON.parse(fs.readFileSync(file));
   else { // Local pre-CI test only: structural surrogate, never labeled a compiled native payload.
     const operationsJSON='[\n {"type":"content-config","label":"العساف / 海 🚢"}\n]';
     emitted={format:'global-holdings-update',manifest:{version:'3.0.0',build:335,signaturePayloadVersion:3,packageType:'full-web',installMode:'clean-snapshot-v1',operationsSha256:crypto.createHash('sha256').update(operationsJSON).digest('hex')},build:335,replacedWebFiles:true};
     if(checks.raw_operations_forwarded)emitted.operationsJSON=operationsJSON;else emitted.operations=JSON.parse(operationsJSON);
   }
   await test('current335 validator accepts exact native contract',async()=>assert.equal(await s.GH_ADVANCED.validateUpdatePack(emitted,{currentBuild:335,postInstall:true}),true));
   const raw='[\n {"type":"content-config","label":"العساف / 海 🚢"}\n]';
   const good={format:'global-holdings-update',manifest:{version:'3.0.0',build:335,signaturePayloadVersion:3,packageType:'full-web',installMode:'clean-snapshot-v1',operationsSha256:crypto.createHash('sha256').update(raw).digest('hex')},operationsJSON:raw};
   for(const [name,alter] of [['tampered whitespace hash',p=>{p.operationsJSON+=' ';}],['separate mirror',p=>{p.operations=[];}],['wrong installed build',p=>{p.manifest.build=334;}],['overlay contract',p=>{p.manifest.installMode='overlay';}]])await test('current335 rejects '+name,async()=>{const p=JSON.parse(JSON.stringify(good));alter(p);await assert.rejects(s.GH_ADVANCED.validateUpdatePack(p,{currentBuild:335,postInstall:true}));});
 }
 const result={scope:'Extracted real native JS; controlled runtime/bridge. Full current335 validator if --web. This does NOT verify trusted Ed25519 signatures or install files.',native_payload_compiled:fs.existsSync(path.join(dir,'native-web-payload.json')),node:process.version,total:rows.length,passed:rows.filter(r=>r.ok).length,failed:rows.filter(r=>!r.ok).length,rows,source_checks:checks};
 fs.writeFileSync(path.join(out,'update-bridge-tests.json'),JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify({total:result.total,passed:result.passed,failed:result.failed}));process.exitCode=result.failed?1:0;
})().catch(e=>{console.error(e);process.exitCode=1;});

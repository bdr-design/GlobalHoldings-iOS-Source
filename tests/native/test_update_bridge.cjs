'use strict';
// Runs JavaScript extracted from the native Swift string. The UI/WebKit bridge is controlled,
// not a live iPhone. The WebApp validator comes from the current source tree.
const fs=require('fs'),path=require('path'),os=require('os'),vm=require('vm'),assert=require('assert/strict'),crypto=require('crypto'),{execFileSync}=require('child_process');
const args=process.argv.slice(2),get=n=>{const index=args.indexOf(n);return index<0?undefined:args[index+1];};
let dir=get('--tests');const web=get('--web');
if(!dir){
 dir=fs.mkdtempSync(path.join(os.tmpdir(),'gh-update-bridge-'));
 execFileSync('python3',[path.join(__dirname,'prepare_native_tests.py'),'--source',path.resolve(__dirname,'../..'),'--output',dir]);
}
const out=get('--out')||dir;fs.mkdirSync(out,{recursive:true});
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
   const raw=emitted.operationsJSON;
   await test('native owner forwards signed operationsJSON unchanged',()=>assert.equal(typeof raw,'string'));
   // The extracted Swift bridge fixture represents the historic 3.0.0/335 build.
   // Check the actual installed WebApp identity from this source, including future builds.
   const sourceRoot=path.resolve(__dirname,'../..');
   const currentVersion=fs.readFileSync(path.join(sourceRoot,'VERSION'),'utf8').trim();
   const currentBuild=Number(fs.readFileSync(path.join(sourceRoot,'BUILD'),'utf8').trim());
   const parts=currentVersion.split('.').map(Number);
   assert.equal(parts.length,3);
   const previousVersion=`${parts[0]}.${parts[1]}.${parts[2]-1}`;
   const futureVersion=`${parts[0]}.${parts[1]}.${parts[2]+1}`;
   const good={format:'global-holdings-update',manifest:{version:currentVersion,build:currentBuild,signaturePayloadVersion:3,packageType:'full-web',installMode:'clean-snapshot-v1',operationsSha256:crypto.createHash('sha256').update(raw).digest('hex')},operationsJSON:raw};
   await test(`Build ${currentBuild} post-install accepts its exact version and signed operations bytes`,async()=>{
     assert.equal(s.GH_ADVANCED.VERSION,currentVersion);
     assert.equal(s.GH_ADVANCED.SAVE_SCHEMA_VERSION,'2.0.0');
     assert.equal(await s.GH_ADVANCED.validateUpdatePack(good,{currentBuild,postInstall:true}),true);
   });
   for(const [name,alter] of [
     ['tampered whitespace hash',p=>{p.operationsJSON+=' ';}],
     ['separate mirror',p=>{p.operations=[];}],
     ['wrong installed build',p=>{p.manifest.build=currentBuild-1;}],
     ['old runtime version',p=>{p.manifest.version=previousVersion;}],
     ['future runtime version',p=>{p.manifest.version=futureVersion;}],
     ['overlay contract',p=>{p.manifest.installMode='overlay';}],
   ])await test(`Build ${currentBuild} post-install rejects ${name}`,async()=>{
     const p=JSON.parse(JSON.stringify(good));alter(p);
     await assert.rejects(s.GH_ADVANCED.validateUpdatePack(p,{currentBuild,postInstall:true}));
   });
 }
 const result={scope:'Extracted real native JS; controlled runtime/bridge. Current WebApp version/build validator if --web. This does NOT verify trusted Ed25519 signatures or install files.',native_payload_compiled:fs.existsSync(path.join(dir,'native-web-payload.json')),node:process.version,total:rows.length,passed:rows.filter(r=>r.ok).length,failed:rows.filter(r=>!r.ok).length,rows,source_checks:checks};
 fs.writeFileSync(path.join(out,'update-bridge-tests.json'),JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify({total:result.total,passed:result.passed,failed:result.failed}));process.exitCode=result.failed?1:0;
})().catch(e=>{console.error(e);process.exitCode=1;});

'use strict';
// Read-only reproduction: real action binding, save owner, persistence owner and
// reconciliation listener. Health checks, DOM and the Native endpoint are controlled.
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),crypto=require('node:crypto'),assert=require('node:assert/strict');
const SOURCE=path.resolve(process.env.GH_TEST_SOURCE_DIR||path.join(__dirname,'..'));
process.env.GH_TEST_SOURCE_DIR=SOURCE;
const {harness,minimal}=require(path.join(SOURCE,'tests/helpers/core-harness'));
const app=fs.readFileSync(path.join(SOURCE,'WebApp/app.js'),'utf8');
const original=fs.readFileSync(path.join(SOURCE,'WebApp/persistence-core.js'),'utf8');
const current=fs.readFileSync(path.join(SOURCE,'WebApp/persistence-core.js'),'utf8');
const hash=s=>crypto.createHash('sha256').update(s).digest('hex');
const flush=async()=>{for(let n=0;n<25;n++)await Promise.resolve();};
async function scenario({label,version='R3',action='diagnostics-run',native='valid',priorSave=false,health='healthy',expectScreen=false,expectedSaves}){
 const h=harness(['save-schema','transaction-core']),s=h.s;
 const timers=new Map(),nodes=new Map(),messages=[],events=[],incidents=[],openPanels=[];let timerSeq=0,nativeGeneration=0,reloads=0,saveCalls=0;
 s.setTimeout=(fn,ms)=>{const id=++timerSeq;timers.set(id,{fn,ms});return id;};s.clearTimeout=id=>timers.delete(id);
 s.state=minimal();s.state.speed=2;s.storageKey='reconcile-test';s.APP_VERSION='3.0.0';s.hardResetInProgress=false;s.durableCommandInProgress=false;
 s.GH_CONTROL_PLANE={sha256:hash,incident:(_state,event)=>incidents.push(event),recordBridge:()=>{}};
 s.GH_INTEGRITY_CORE={check:()=>({issues:[]})};s.pruneRouteCache=()=>{};s.reconcileConsolidatedCash=()=>{};s.diag=()=>{};s.notice=()=>{};
 s.location={reload:()=>reloads++};s.$=id=>nodes.get(id);
 const element=tag=>({tagName:tag.toUpperCase(),style:{},textContent:'',children:[],handlers:{},setAttribute(){},focus(){},addEventListener(k,f){this.handlers[k]=f;},append(...children){this.children.push(...children);for(const c of children)if(c.id)nodes.set(c.id,c);}});
 s.document={createElement:element,body:{appendChild:n=>nodes.set(n.id,n)}};
 let cancellations=0,exports=0;s.cancelSimulationPersistence=()=>cancellations++;s.exportDiagnosticsFile=()=>exports++;
 if(native!=='none')s.webkit={messageHandlers:{saveBridge:{postMessage:envelope=>{
  const parsed=JSON.parse(envelope.saveJSON);
  const same=parsed.saveRevision===envelope.saveRevision&&Number(parsed.resetEpoch||0)===envelope.resetEpoch&&hash(envelope.saveJSON)===envelope.saveHash&&envelope.saveSchemaVersion==='2.0.0';
  messages.push({requestId:envelope.requestId,jsonRevision:parsed.saveRevision,envelopeRevision:envelope.saveRevision,jsonEpoch:parsed.resetEpoch,envelopeEpoch:envelope.resetEpoch,metadataMatch:same});
  if(native==='silent')return;
  const success=native==='nack'?false:same;
  const ack={requestId:envelope.requestId,action:envelope.action,saveRevision:envelope.saveRevision,resetEpoch:envelope.resetEpoch,saveHash:native==='wrong-hash'?'0'.repeat(64):envelope.saveHash,saveSchemaVersion:'2.0.0',success,generation:++nativeGeneration,message:success?'':native==='nack'?'Injected native write refusal':'Invalid save envelope.'};
  s.GH_PERSISTENCE.receiveAck(ack);
 }}}};
 vm.runInContext(version==='original'?original:current,s,{filename:`${version}/persistence-core.js`});
 const ownerStart=app.indexOf('  function persistStateNow('),ownerEnd=app.indexOf('  if(startupLoadMeta',ownerStart);assert(ownerStart>=0&&ownerEnd>ownerStart);
 vm.runInContext(app.slice(ownerStart,ownerEnd),s,{filename:'app-save-owner.js'});
 const listenerStart=app.indexOf('  let savePressureNoticeShown=false;'),listenerEnd=app.indexOf("  window.addEventListener('gh-native-recovery'",listenerStart);assert(listenerStart>=0&&listenerEnd>listenerStart);
 vm.runInContext(app.slice(listenerStart,listenerEnd),s,{filename:'app-reconciliation-listener.js'});
 s.addEventListener('gh-persistence-status',e=>events.push(structuredClone(e.detail)));
 h.load('advanced-core');
 const attrs=s.GH_ADVANCED.actionAttributes(action),origin=/data-gh-action-origin="([^"]+)"/.exec(attrs)[1];let click;
 const button={dataset:{ghAction:action,ghActionOrigin:origin},tagName:'BUTTON',addEventListener:(event,fn)=>{if(event==='click')click=fn;},removeAttribute:()=>{}};
 const root={querySelectorAll:selector=>selector==='[data-gh-action]'?[button]:[],querySelector:()=>null};
 const report={status:health,counts:{critical:health==='critical'?1:0,warning:0,total:health==='critical'?1:0}};
 const ctx={state:s.state,save:()=>{saveCalls++;return s.save();},runDiagnostics:()=>report,controlHealth:()=>report,pushAlert:()=>{},updateKpis:()=>{},renderMap:()=>{},openDrawer:p=>openPanels.push(p)};
 s.GH_ADVANCED.bind(root,ctx);assert.equal(typeof click,'function');
 if(priorSave)ctx.save();
 await click();await flush();
 if(native==='silent'||native==='wrong-hash'){
  for(const [id,row] of [...timers])if(row.ms===10000){timers.delete(id);row.fn();}
  await flush();
 }
 const screen=nodes.get('nativeSaveReconcile'),recoveryTimers=[...timers.values()].filter(t=>t.ms===300);
 assert.equal(Boolean(screen),expectScreen,label);
 if(expectedSaves!=null)assert.equal(saveCalls,expectedSaves,`${label}: save count`);
 if(expectScreen){assert.equal(s.state.speed,0);assert.equal(s.GH_PERSISTENCE.isLocked(),true);assert.equal(recoveryTimers.length,0);assert.equal(cancellations,1);assert(nodes.get('nativeSaveReconcileReason').textContent.length>0);const retry=nodes.get('nativeSaveReconcileRetry'),exportButton=nodes.get('nativeSaveReconcileExport');assert.equal(reloads,0);exportButton.handlers.click();assert.equal(exports,1);assert.equal(reloads,0);retry.handlers.click();assert.equal(reloads,1);assert.equal(retry.disabled,true);}
 else{assert.equal(s.GH_PERSISTENCE.isLocked(),false);assert.equal(recoveryTimers.length,0);}
 for(const [id,row]of [...timers])if(row.ms===300){timers.delete(id);row.fn();}
 return {label,version,action,native,priorSave,health,saveCalls,messages,events:events.map(e=>({reason:e.reason||e.message||null,ok:e.ok,validated:!!e.validated,requiresNativeReconciliation:!!e.requiresNativeReconciliation})),screenShown:!!screen,screenText:screen?.textContent||null,reloadCalls:reloads,locked:s.GH_PERSISTENCE.isLocked(),openPanels,passed:true};
}
(async()=>{
 const cases=[
 {label:'Single diagnostics saves once with valid ack',expectedSaves:1},
 {label:'Central check saves exactly once, not twice',action:'control-run',expectedSaves:1},
 {label:'Queued earlier save retains both snapshot envelopes',priorSave:true,expectedSaves:2},
 {label:'Critical health alone does not force recovery',health:'critical',expectedSaves:1},
 {label:'Browser-only diagnostics does not enter native recovery',native:'none',expectedSaves:1},
 {label:'Native refusal displays bounded recovery with manual retry',native:'nack',expectScreen:true,expectedSaves:1},
 {label:'Lost ACK pauses and exposes manual recovery, without reload loop',native:'silent',expectScreen:true,expectedSaves:1},
 {label:'Wrong ACK rejected then protected recovery',native:'wrong-hash',expectScreen:true,expectedSaves:1}
 ];
 const results=[];for(const c of cases)try{results.push(await scenario(c));}catch(e){results.push({...c,passed:false,error:String(e.stack||e)});}
 const output={scope:'Controlled integration with explicit browser/native endpoint fixtures: real GH_ADVANCED.bind/handleAction, app save owner, GH_PERSISTENCE, app recovery listener. DOM/health/Native endpoint and timers are controlled. No iPhone, no production state or code modified.',node:process.version,hashes:{app:hash(app),originalPersistence:hash(original),R3Persistence:hash(current)},passed:results.filter(r=>r.passed).length,total:results.length,results};
 console.log(JSON.stringify(output,null,2));if(output.passed!==output.total)process.exitCode=1;
})().catch(error=>{console.error(error);process.exitCode=1;});

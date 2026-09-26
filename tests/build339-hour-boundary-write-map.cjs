'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const {scenario}=require('./helpers/business-scenario');
const ROOT=path.resolve(__dirname,'..'),app=fs.readFileSync(path.join(ROOT,'WebApp/app.js'),'utf8'),results=[];
function fragment(start,end){const a=app.indexOf(start),b=app.indexOf(end,a);assert(a>=0&&b>a,`${start} -> ${end}`);return app.slice(a,b);}
function environment(){
 const e=scenario();e.load('advanced-core');
 Object.assign(e.s,{state:e.state,dispatchSystemCommand:(ctx,d,n,p,o)=>e.s.GH_DOMAIN_COMMANDS.dispatchSystem(ctx,d,n,p,o),__GH_BUILD339_WRITE_AUDIT__:true});
 vm.runInContext(fragment('  function processMarket(processedHour=null,measure=null){','  // ---------------------------------------------------------------------------\n  // SIMULATION CORE 2.1'),e.s,{filename:'app-process-market.js'});
 e.state.simSeconds=3600;e.state.lastMarketHour=0;return e;
}
function test(name,fn){try{results.push({name,ok:true,detail:fn()});}catch(error){results.push({name,ok:false,error:String(error.stack||error)});}}
const expected=['advanced','controlPlane','deliveryClosure','domainRuntime','lastMarketHour','maPortfolio','portfolio','portfolioBook','realism','simulationWorld'];

test('actual hourly market owner publishes a stable clean-source root write map',()=>{
 const e=environment(),out=e.s.GH_TRANSACTION_CORE.execute(e.state,{label:'build339-hour-write-map',auditWrites:true,apply:()=>e.s.processMarket(1)});assert.equal(out.committed,true);const audit=e.s.GH_TRANSACTION_CORE.telemetry().last.writeAudit;assert.deepEqual(audit.mutatedRoots,expected);assert.equal(e.s.GH_INTEGRITY_CORE.check(e.state).status,'healthy');return audit;
});

test('actual hourly owner plus critical failure rolls every mutated root back byte-equivalent',()=>{
 const e=environment(),before=JSON.stringify(e.state);assert.throws(()=>e.s.GH_TRANSACTION_CORE.execute(e.state,{label:'build339-hour-rollback-proof',auditWrites:true,apply:()=>{e.s.processMarket(1);e.s.GH_TRANSACTION_CORE.afterCommit(()=>{throw new Error('build339-hour-late-failure');},{critical:true,key:'build339-hour-late-failure',owner:'build339-hour-contract',priority:100});}}),/build339-hour-late-failure/);assert.equal(JSON.stringify(e.state),before);const audit=e.s.GH_TRANSACTION_CORE.telemetry().last.writeAudit;for(const root of expected)assert(audit.mutatedRoots.includes(root),`rollback audit missed ${root}`);assert.equal(audit.stage,'failure-before-rollback');return audit;
});

const passed=results.filter(row=>row.ok).length;console.log(JSON.stringify({suite:'build339-hour-boundary-write-map',passed,total:results.length,expectedRoots:expected,results},null,2));if(passed!==results.length)process.exitCode=1;

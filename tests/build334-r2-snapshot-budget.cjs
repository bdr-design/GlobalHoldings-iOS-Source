'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const {ROOT}=require('./helpers/core-harness'),{scenario}=require('./helpers/business-scenario');
const app=fs.readFileSync(path.join(ROOT,'WebApp/app.js'),'utf8'),results=[];
function fragment(start,end){const a=app.indexOf(start),b=app.indexOf(end,a);assert(a>=0&&b>a);return app.slice(a,b);}
function fixture(count=1){
 const e=scenario();e.manualPurchase(1);e.s.GH_REALISM.onSimulationTime(e.state,60);const seed=structuredClone(e.state.assets[0]),stats={assetCopies:0};
 e.state.assets=Array.from({length:count},(_,i)=>({...structuredClone(seed),id:`R2-${i}`,routeId:'R2-ROUTE',phase:'moving',progress:0,catalogId:e.item.id}));e.state.speed=0;e.state.todayProfit=0;
 const route={id:'R2-ROUTE',type:'air',routeMode:'air',ownerCompanyId:'air',route:[[24.7,46.7],[25,47]],tripSeconds:1000,distanceKm:100};
 Object.assign(e.s,{state:e.state,COMPANY_PLATFORM:e.s.GH_COMPANY_PLATFORM,routeTemplates:{'R2-ROUTE':route},competitorAssets:[],BASE_ROUTE_IDS:new Set(['R2-ROUTE']),clone(value){if(value&&typeof value==='object'&&'phase' in value&&'progress' in value)stats.assetCopies++;return value===undefined?undefined:JSON.parse(JSON.stringify(value));},routeDistance:()=>1000,queueAssetSaleFinalize:()=>{},processFinancialDay:()=>{},processMarket:()=>{},processAssetDraft:asset=>{asset.progress=.1;},diag:()=>{}});
 vm.runInContext(fragment('  function makeSimulationEffects()', '  // Pure simulation draft:'),e.s);
 vm.runInContext(fragment('  const SIMULATION_TRANSACTION_SCOPE=', "  if(!window.GH_TRANSACTION_CORE?.execute)throw new Error('Transaction Core compatibility"),e.s);
 return {...e,stats,job:()=>e.s.createSimulationSliceJob(30,{from:e.state.simSeconds,to:e.state.simSeconds+30,speed:30})};
}
function finishWork(job){while(!job.runChunk(32)){}return job;}
function test(name,fn){try{fn();results.push({name,ok:true});}catch(e){results.push({name,ok:false,error:String(e.stack||e)});}}
test('creation captures immutable guards without eagerly decoding an asset object per seed',()=>{const e=fixture(100),before=JSON.stringify(e.state),job=e.job();assert.equal(e.stats.assetCopies,0);assert.equal(JSON.stringify(e.state),before);job.cancel();});
test('catalog identity is captured for the real normalization dependency',()=>{const e=fixture();let observed;e.s.processAssetDraft=asset=>{observed=asset.catalogId;asset.progress=.2;};const job=finishWork(e.job());assert.equal(observed,e.item.id);assert.equal(job.finish().committed,true);assert.equal(e.state.assets[0].progress,.2);});
test('catalog mutation during staged work conflicts instead of committing old economics',()=>{const e=fixture(),job=finishWork(e.job());e.state.assets[0].catalogId='CHANGED-CATALOG';const before=JSON.stringify(e.state);assert.equal(job.finish().committed,false);assert.equal(JSON.stringify(e.state),before);});
test('budgeted decoding uses slice-start nested data, never a later live object',()=>{const e=fixture();e.state.assets[0].specs={capacity:12};let observed;e.s.processAssetDraft=asset=>{observed=asset.specs.capacity;asset.specs.capacity=55;asset.progress=.8;};const job=e.job();e.state.assets[0].specs.capacity=99;finishWork(job);assert.equal(observed,12);assert.equal(e.state.assets[0].specs.capacity,99);assert.equal(job.finish().committed,false);assert.equal(e.state.simSeconds,0);});
test('undefined-to-null changes in captured inputs are not silently considered identical',()=>{const e=fixture();delete e.state.assets[0].salePending;const job=finishWork(e.job());e.state.assets[0].salePending=null;const before=JSON.stringify(e.state);assert.equal(job.finish().committed,false);assert.equal(JSON.stringify(e.state),before);});
console.log(JSON.stringify({suite:'build334-r2-snapshot-budget',scope:'actual slice factory; injected asset worker checks capture semantics, not physical frame time',passed:results.filter(x=>x.ok).length,total:results.length,results},null,2));if(results.some(x=>!x.ok))process.exitCode=1;

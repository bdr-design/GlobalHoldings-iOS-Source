'use strict';
// Build 371 regression: GH_FLEET_DATA.scanRouted reads route holders from the store's per-chunk route tables
// (GH_FLEET_STORE.refRowTables) instead of every row. Differential check against the former row pass (kept below as the
// reference, verbatim): on fleets spanning several store chunks, with rows without a route, removed rows, rows in extras,
// routes shared across chunks, and after route writes, additions, removals and a journal rollback, every caller pattern
// (follow every holder, skip a route after its first holder, skip by a rule, stop part way) sees the same calls in the
// same order with the same rows.
const assert=require('node:assert/strict'),path=require('node:path');
const ROOT=process.env.GH_TEST_SOURCE_DIR||path.resolve(__dirname,'..');
global.window=global;require(path.join(ROOT,'WebApp/transaction-core.js'));
const STORE=require(path.join(ROOT,'WebApp/fleet-store-core.js'));require(path.join(ROOT,'WebApp/fleet-event-core.js'));
const FLEET=require(path.join(ROOT,'WebApp/fleet-access-core.js'));
const {fleet,resolveRoute}=require('./helpers/fleet-fixture.js');
FLEET.configure({resolveRoute:id=>resolveRoute(id)});
const results=[];function test(name,fn){try{results.push({name,ok:true,detail:fn()});}catch(error){results.push({name,ok:false,error:String(error.stack||error).slice(0,1600)});}}

// The former implementation (Build 371 before this change), verbatim but for the module-private names it reads.
const O=STORE.O,BIT=STORE.HOT_BIT;
function referenceScanRouted(state,fields,fn){
  const names=[...new Set(['routeId',...(Array.isArray(fields)?fields:[])])],skipped=new Set(),store=FLEET.storeOf(state);
  const visit=(row,index)=>{const routeId=row.routeId;if(!routeId||skipped.has(routeId))return undefined;const out=fn(row,index);if(out===FLEET.SKIP_ROUTE)skipped.add(routeId);return out;};
  const skippedRefs=new Set(),ROUTE=BIT.routeId>>>0,SR=STORE.STRIDE,WR=STORE.WORDS_PER_ROW,ALIVE=STORE.ALIVE,EXTRAS=STORE.EXTRAS;
  for(let index=0;index<store.length;index++){
    const v=STORE.views(store),flags=v.u8[index*SR+O.flags];if(!(flags&ALIVE))continue;
    let ref=0;
    if(!(flags&EXTRAS)){
      const w=index*WR;if(!(v.u32[w+O.present]&ROUTE))continue;ref=v.u32[w+O.routeId];if(ref===0||skippedRefs.has(ref))continue;
      const value=store.values[ref];if(!value)continue;if(skipped.has(value)){skippedRefs.add(ref);continue;}
    }
    let out;FLEET.scan(state,names,(row,at)=>{out=visit(row,at);},{from:index,to:index+1});
    if(out===FLEET.STOP)return;if(out===FLEET.SKIP_ROUTE&&ref)skippedRefs.add(ref);
  }
}

let seed=12345;const rand=()=>{seed=(seed*1103515245+12345)&0x7fffffff;return seed/0x7fffffff;};
const ROUTES=Array.from({length:240},(_,i)=>`RT-${i}`);
const template=fleet().filter(a=>a.phase&&!a.salePending);
function build(count){
  const out=[];
  for(let i=0;out.length<count;i++){
    const a=structuredClone(template[i%template.length]);a.id=`RH-${String(i).padStart(7,'0')}`;a.name=`GH RH ${i}`;
    const r=rand();a.routeId=r<0.08?null:ROUTES[Math.floor(Math.pow(rand(),1.7)*ROUTES.length)];
    if(i%997===0)a.note=`extras-${i}`; // unknown field: the row lives in extras
    out.push(a);
  }
  return out;
}
const FIELDS=['id','routeId','routeSlot','phase','releaseExclusiveRouteOnArrival','ownerCompanyId','companyId','assetMode','type','assetClass'];
// Caller patterns, each run against both implementations; a record of every call (row index, id, route) and the result.
const PATTERNS={
  everyHolder:()=>()=>undefined,
  firstHolderOnly:()=>()=>FLEET.SKIP_ROUTE,
  batchRoutesFollowed:()=>{const batch=new Set(ROUTES.filter((_,i)=>i%17===3));return row=>batch.has(row.routeId)?undefined:FLEET.SKIP_ROUTE;},
  ruleBased:()=>{let n=0;return row=>(++n%3===0||String(row.id).endsWith('7'))?FLEET.SKIP_ROUTE:undefined;},
  stopPartWay:()=>{let n=0;return ()=>++n>=1234?FLEET.STOP:(n%5===0?FLEET.SKIP_ROUTE:undefined);}
};
function record(impl,state,pattern){const calls=[],fn=PATTERNS[pattern]();impl(state,FIELDS,(row,index)=>{calls.push(`${index}|${row.id}|${row.routeId}|${row.phase}`);return fn(row,index);});return calls;}
function compareAll(state,label){
  const out={};
  for(const pattern of Object.keys(PATTERNS)){
    const expected=record(referenceScanRouted,state,pattern),actual=record(FLEET.scanRouted,state,pattern);
    assert.equal(actual.length,expected.length,`${label}/${pattern}: call count`);
    for(let i=0;i<expected.length;i++)if(actual[i]!==expected[i])assert.fail(`${label}/${pattern}: call ${i}: ${actual[i]} !== ${expected[i]}`);
    out[pattern]=expected.length;
  }
  return out;
}

const CHUNK=STORE.CHUNK_ROWS;
const state={simSeconds:0,fleet:STORE.fromAssets(build(CHUNK*2+7000),{at:0})};
test('fresh fleet over three chunks',()=>compareAll(state,'fresh'));
test('after route writes (some chunks), additions and removals',()=>{
  const ids=[];FLEET.forEach(state,a=>{ids.push(a.id);});
  const drafts=[];for(let i=0;i<ids.length;i+=97){const d=FLEET.draft(state,ids[i]);d.routeId=i%5===0?null:ROUTES[(i*7)%ROUTES.length];drafts.push(d);}FLEET.commit(state,drafts);
  FLEET.removeMany(state,ids.filter((_,i)=>i%211===0));
  FLEET.addMany(state,build(900).map((a,i)=>({...a,id:`RH-ADD-${i}`})));
  return compareAll(state,'written');
});
test('cached tables reused unchanged, then a single-row write in one chunk',()=>{
  const before=compareAll(state,'reused');
  const target=FLEET.idAtRow?FLEET.idAtRow(state,CHUNK+5):null;let id=target;if(!id)FLEET.forEach(state,a=>{if(!id)id=a.id;});
  const d=FLEET.draft(state,id);d.routeId=ROUTES[ROUTES.length-1];FLEET.commit(state,[d]);
  return {before,after:compareAll(state,'one-row')};
});
test('journal rollback restores the tables the scan reads',()=>{
  const reference=compareAll(state,'pre-journal');
  const journal=FLEET.beginJournal(state);
  const ids=[];FLEET.forEach(state,a=>{ids.push(a.id);});
  const drafts=[];for(let i=3;i<ids.length;i+=53){const d=FLEET.draft(state,ids[i]);d.routeId=ROUTES[(i*11)%ROUTES.length];drafts.push(d);}FLEET.commit(state,drafts);
  compareAll(state,'inside-journal');
  FLEET.rollbackJournal(state,journal);
  const after=compareAll(state,'rolled-back');
  assert.deepEqual(after,reference,'the rolled-back fleet scans as before the journal');
  return after;
});
console.log(JSON.stringify({suite:'build371-route-holder-scan',passed:results.filter(r=>r.ok).length,total:results.length,results},null,2));
if(results.some(r=>!r.ok))process.exitCode=1;

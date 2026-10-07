'use strict';
const assert=require('node:assert/strict');
const {performance}=require('node:perf_hooks');
const fs=require('node:fs');
const path=require('node:path');
const QUERY=require('../WebApp/fleet-list-query-core.js');
const STORE=require('../WebApp/fleet-store-core.js');
const FLEET=require('../WebApp/fleet-access-core.js');

function makeRowsFleet(initial){
  let rows=initial.slice(),source={},membership=1;const metrics={scanCalls:0,rowsVisited:0};
  const api={
    source:()=>source,
    membershipRevision:()=>`rows:${membership}`,
    scanLength:()=>rows.length,
    scan(_state,fields,fn,{from=0,to=Infinity}={}){metrics.scanCalls++;const end=Math.min(rows.length,to),projection={};for(let i=from;i<end;i++){const value=rows[i];if(!value)continue;for(const key of fields)projection[key]=value[key];metrics.rowsVisited++;if(fn(projection,i)===api.STOP)return i+1;}return end;},
    idAtRow:(_state,index)=>rows[index]?.id,
    STOP:Object.freeze({stop:true})
  };
  return {api,metrics,add(row){rows.push(row);membership++;},replace(next){rows=next.slice();source={};},update(index,patch){rows[index]={...rows[index],...patch};},rows:()=>rows};
}
function statusMatch(row,status){return status==='all'||(status==='moving'?(row.phase==='moving'||row.status==='moving'):status==='ready'?(row.phase==='turnaround'||row.status==='available'):status==='service'?Number(row.condition)<85:(!['moving','turnaround'].includes(row.phase)&&row.status!=='moving'));}
function reference(rows,filter){const owner=filter.owner??filter.ownerCompanyId,q=QUERY.normalizeSearch(filter.search??filter.query??''),status=filter.status||'all';const out=[];for(let i=0;i<rows.length;i++){const row=rows[i];if(!row||row.id===undefined)continue;if(owner&&owner!=='all'&&String(row.ownerCompanyId||row.companyId||'')!==String(owner))continue;if(!statusMatch(row,status))continue;const text=QUERY.normalizeSearch(`${row.id||''} ${row.name||''} ${row.model||''} ${row.baseFacility||''}`);if(!q||text.includes(q))out.push(i);}return out;}

(async()=>{
  let passed=0;const check=(value,message)=>{assert(value,message);passed++;};
  const app=fs.readFileSync(path.join(__dirname,'../WebApp/app.js'),'utf8'),html=fs.readFileSync(path.join(__dirname,'../WebApp/index.html'),'utf8'),required=JSON.parse(fs.readFileSync(path.join(__dirname,'../WebApp/runtime-required.json'),'utf8'));
  check(html.indexOf('fleet-list-query-core.js')>html.indexOf('fleet-list-virtualizer.js')&&html.indexOf('fleet-list-query-core.js')<html.indexOf('app.js'),'the query index loads after Fleet Data and before the application');
  check(required.files.includes('fleet-list-query-core.js'),'the runtime allow-list contains the fleet query module');
  check(app.includes("stats?.(state)?.ready===true")&&app.includes('fleetListQueryEngine.queryAsync(target,')&&app.includes("code==='FLEET_LIST_QUERY_ASYNC_QUERY_REQUIRED'"),'the live fleet panel uses readiness and the sliced async search path');
  check(app.includes('const pending=fleetListQueryEngine.ensureAsync(target);')&&!app.includes('ensureAsync(target,{batchRows:32_768}'),'the live million-row index uses the bounded production slice size');
  check(app.includes("if(panel!=='assets')clearFleetListSearchRequest()")&&app.includes('cancelDrawerSearch();clearFleetListSearchRequest();')&&app.includes('cancelDrawerSearch(); clearFleetListSearchRequest();'),'leaving or closing the fleet panel aborts an unnecessary million-row search');
  check(app.includes('Date.now()-fleetListQueryFreshAt<30_000')&&!app.includes("ownedFilterStatus=e.target.value;fleetListQueryEngine?.invalidate?.(state)"),'dynamic status buckets use one bounded freshness policy instead of rebuilding for every selector click');
  check(app.includes('\\u064b-\\u065f')&&app.includes("toLocaleLowerCase('ar')"),'the application normalizer preserves Arabic diacritic-insensitive search semantics');
  const realState={simSeconds:0,fleet:STORE.fromAssets([
    {id:'REAL-AIR-1',ownerCompanyId:'air',phase:'moving',condition:96,name:'Falcon',model:'A350',baseFacility:'RUH'},
    {id:'REAL-AIR-2',ownerCompanyId:'air',phase:'idle',condition:72,name:'Cargo',model:'B777F',baseFacility:'JED'},
    {id:'REAL-SEA-1',ownerCompanyId:'sea',phase:'turnaround',condition:99,name:'Ocean',model:'VLCC',baseFacility:'JED'}
  ])},realQuery=QUERY.create({fleetData:FLEET}),realRows=realQuery.query(realState,{owner:'air',status:'service',search:'cargo'});
  check(realRows.length===1&&FLEET.idAtRow(realState,realRows[0])==='REAL-AIR-2','real GH_FLEET_DATA store query stays on the public access boundary');
  const rows=[
    {id:'A-1',ownerCompanyId:'air-one',phase:'moving',condition:96,name:'صقر الجزيرة',model:'A350',baseFacility:'RUH'},
    {id:'A-2',ownerCompanyId:'air-one',phase:'turnaround',condition:79,name:'Falcon Cargo',model:'B777F',baseFacility:'JED'},
    {id:'A-3',ownerCompanyId:'air-one',phase:'idle',status:'available',condition:88,name:'Executive One',model:'G650',baseFacility:'RUH'},
    {id:'S-1',companyId:'sea-one',phase:'moving',condition:70,name:'Red Sea',model:'VLCC',baseFacility:'JED'},
    {id:'R-1',ownerCompanyId:'road-one',phase:'idle',condition:100,name:'Truck 101',model:'Actros',baseFacility:'DMM'},
    {id:'R-2',ownerCompanyId:'road-one',phase:'idle',condition:62,name:'Truck 202',model:'Actros',baseFacility:'RUH'},
    {id:'A-4',ownerCompanyId:'air-two',phase:'idle',status:'moving',condition:92,name:'Needle Test',model:'A320',baseFacility:'MED'},
    {id:'A-5',ownerCompanyId:'air-one',phase:'idle',condition:91,name:'طائرة النُّخبة',model:'A220',baseFacility:'MED'},
    {id:'A-6',ownerCompanyId:'air-one',phase:'idle',condition:91,name:'Alpha   Spaces',model:'A220',baseFacility:'AHB'},
    {ownerCompanyId:'broken-owner',phase:'idle',condition:100,name:'Missing identity',model:'X',baseFacility:'X'}
  ];
  const small=makeRowsFleet(rows),state=Object.freeze({label:'read-only-state'}),manager=QUERY.create({fleetData:small.api,maxCacheEntries:3,maxCacheRows:32,textChunkBytes:16_384});
  const filters=[
    {owner:'air-one',status:'all',search:''},{owner:'air-one',status:'moving',search:''},{owner:'air-one',status:'ready',search:''},{owner:'air-one',status:'service',search:''},{owner:'road-one',status:'idle',search:'actros'},{owner:'all',status:'moving',search:'needle'},{owner:'air-one',status:'all',search:'النخبة'},{owner:'air-one',status:'all',search:'alpha spaces'}
  ];
  for(const filter of filters)assert.deepEqual([...manager.query(state,filter)],reference(small.rows(),filter),JSON.stringify(filter));passed+=filters.length;
  check(small.metrics.scanCalls===1,'all filter/search combinations reuse the one public fleet scan');
  check(manager.query(state,{owner:'broken-owner'}).length===0,'rows without a stable id are excluded from list results');
  const repeatedFilter={owner:'road-one',status:'idle',search:'actros'};manager.query(state,repeatedFilter);const scanAfterBuild=small.metrics.scanCalls,rowsBeforeHit=manager.stats(state).queryRowsTested,again=manager.query(state,repeatedFilter),rowsAfterHit=manager.stats(state).queryRowsTested;
  assert.deepEqual([...again],reference(small.rows(),{owner:'road-one',status:'idle',search:'actros'}));passed++;
  check(small.metrics.scanCalls===scanAfterBuild&&rowsAfterHit===rowsBeforeHit,'an exact cached query performs neither a fleet scan nor a candidate pass');
  assert.deepEqual(manager.queryIds(state,{owner:'air-one',status:'service'}),['A-2']);passed++;
  const lazy=manager.idsView(state,{owner:'air-one',status:'all'});check(lazy.length===5&&lazy.idAt(0)==='A-1'&&lazy.slice(1,3).join(',')==='A-2,A-3','lazy ids resolve from stable row numbers');
  const beforeState=JSON.stringify(state);manager.query(state,{owner:'all',status:'all',search:'a'});check(JSON.stringify(state)===beforeState,'index construction and queries do not mutate state');
  for(const query of ['falcon','cargo','executive','truck','red sea'])manager.query(state,{owner:'all',status:'all',search:query});const bounded=manager.stats(state);check(bounded.cacheEntries<=3&&bounded.cacheRows<=32,'LRU cache remains within entry and row bounds');

  // Membership and source identity are the only implicit invalidation keys.
  small.update(0,{phase:'idle'});check([...manager.query(state,{owner:'air-one',status:'moving'})].includes(0),'ordinary field writes leave the deliberate query snapshot stable');
  manager.invalidate(state);check(![...manager.query(state,{owner:'air-one',status:'moving'})].includes(0),'explicit invalidation refreshes phase/condition filters');
  small.add({id:'A-7',ownerCompanyId:'air-one',phase:'moving',condition:100,name:'New Fleet Member',model:'A321',baseFacility:'RUH'});check(manager.queryIds(state,{owner:'air-one',status:'moving'}).includes('A-7'),'membership revision rebuilds the index');
  const staleView=manager.idsView(state,{owner:'air-one'}),priorBuilds=manager.stats(state).builds;small.replace([{id:'X-1',ownerCompanyId:'new-owner',phase:'idle',condition:100,name:'Replacement',model:'X',baseFacility:'X'}]);check(staleView.rowAt(0)===undefined&&staleView.idAt(0)===undefined&&staleView.slice(0,1).length===0,'lazy rows and ids fail closed when the source changes');assert.deepEqual(manager.queryIds(state,{owner:'new-owner'}),['X-1']);passed++;check(manager.stats(state).builds===priorBuilds+1,'source replacement rebuilds even when its membership token is unchanged');
  const callerRows=manager.query(state,{owner:'new-owner'});callerRows[0]=999;assert.deepEqual(manager.queryIds(state,{owner:'new-owner'}),['X-1']);passed++;

  const asyncFixture=makeRowsFleet(Array.from({length:3_000},(_,index)=>({id:`ASYNC-${index}`,ownerCompanyId:`owner-${index%3}`,phase:index%2?'idle':'moving',condition:100,name:`Async ${index}`,model:'Test',baseFacility:'TST'}))),asyncState=Object.freeze({tag:'async-build'}),asyncManager=QUERY.create({fleetData:asyncFixture.api});let buildYields=0;
  await asyncManager.ensureAsync(asyncState,{batchRows:1_024,yieldFn:async()=>{buildYields++;}});const asyncScans=asyncFixture.metrics.scanCalls;check(buildYields===2&&asyncScans===3,'async index construction yields between public scan slices');check(asyncManager.query(asyncState,{owner:'owner-1'}).length===1_000&&asyncFixture.metrics.scanCalls===asyncScans,'query reuses an asynchronously constructed index');
  asyncManager.invalidate(asyncState);let invalidated=false;await assert.rejects(asyncManager.ensureAsync(asyncState,{batchRows:1_024,yieldFn:async()=>{if(!invalidated){invalidated=true;asyncManager.invalidate(asyncState);}}}),/invalidated|membership-changed/);passed++;

  const raceFixture=makeRowsFleet(Array.from({length:3_000},(_,index)=>({id:`RACE-${index}`,ownerCompanyId:'race',phase:'idle',condition:100,name:'old value',model:'Test',baseFacility:'TST'}))),raceState=Object.freeze({tag:'build-race'}),raceManager=QUERY.create({fleetData:raceFixture.api,maxSyncBuildRows:5_000});let raced=false;
  await raceManager.ensureAsync(raceState,{batchRows:1_024,yieldFn:async()=>{if(raced)return;raced=true;for(let i=0;i<3_000;i++)raceFixture.update(i,{name:'new value'});raceManager.ensure(raceState);}});check(raceManager.query(raceState,{owner:'race',search:'old value'}).length===0&&raceManager.query(raceState,{owner:'race',search:'new value'}).length===3_000,'an older async build cannot overwrite a newer synchronous publication');
  let block=true,releases=[];const gatedYield=()=>block?new Promise(resolve=>releases.push(resolve)):Promise.resolve();const pendingOne=raceManager.queryAsync(raceState,{owner:'race',search:'missing-one'},{batchRows:256,yieldFn:gatedYield});while(raceManager.stats(raceState).pendingQueries<1)await Promise.resolve();const pendingTwo=raceManager.queryAsync(raceState,{owner:'race',search:'missing-two'},{batchRows:256,yieldFn:gatedYield});while(raceManager.stats(raceState).pendingQueries<2)await Promise.resolve();await assert.rejects(raceManager.queryAsync(raceState,{owner:'race',search:'missing-three'},{batchRows:256,yieldFn:gatedYield}),error=>error?.code==='FLEET_LIST_QUERY_PENDING_LIMIT');passed++;block=false;for(const release of releases)release();assert.equal((await pendingOne).length,0);assert.equal((await pendingTwo).length,0);passed+=2;
  block=true;releases=[];const signalA=new AbortController(),signalB=new AbortController(),sharedA=raceManager.queryAsync(raceState,{owner:'race',search:'signal-isolation-one'},{batchRows:256,yieldFn:gatedYield,signal:signalA.signal});while(raceManager.stats(raceState).pendingQueries<1)await Promise.resolve();const sharedB=raceManager.queryAsync(raceState,{owner:'race',search:'signal-isolation-one'},{batchRows:256,yieldFn:gatedYield,signal:signalB.signal});while(raceManager.stats(raceState).pendingQueries<2)await Promise.resolve();const rejectedB=assert.rejects(sharedB,/fleet-list-query-aborted/);signalB.abort();block=false;for(const release of releases)release();assert.equal((await sharedA).length,0);await rejectedB;passed+=2;
  block=true;releases=[];const signalC=new AbortController(),sharedC=raceManager.queryAsync(raceState,{owner:'race',search:'signal-isolation-two'},{batchRows:256,yieldFn:gatedYield,signal:signalC.signal});while(raceManager.stats(raceState).pendingQueries<1)await Promise.resolve();const sharedNoSignal=raceManager.queryAsync(raceState,{owner:'race',search:'signal-isolation-two'},{batchRows:256,yieldFn:gatedYield});while(raceManager.stats(raceState).pendingQueries<2)await Promise.resolve();const rejectedC=assert.rejects(sharedC,/fleet-list-query-aborted/);signalC.abort();block=false;for(const release of releases)release();await rejectedC;assert.equal((await sharedNoSignal).length,0);passed+=2;
  const alreadyAborted=new AbortController();alreadyAborted.abort();await assert.rejects(raceManager.queryAsync(raceState,{owner:'race',search:'signal-isolation-two'},{signal:alreadyAborted.signal}),error=>error?.code==='FLEET_LIST_QUERY_ABORTED');passed++;

  // A generated SoA-like source proves the index does not need or inspect the
  // real store and keeps the million-row fixture itself essentially allocation-free.
  const MILLION=1_000_000,millionState=Object.freeze({tag:'million'}),millionSource={},millionMetrics={scanCalls:0,rowsVisited:0};
  function value(index,key){
    switch(key){
      case 'id':return `ASSET-${String(index).padStart(7,'0')}`;
      case 'ownerCompanyId':return `owner-${index%20}`;
      case 'companyId':return undefined;
      case 'phase':return index%4===0?'moving':index%4===1?'turnaround':'idle';
      case 'status':return index%13===0?'moving':(index%17===0?'available':undefined);
      case 'condition':return index%101;
      case 'name':return index%997===0?`Needle Aircraft ${index}`:`Aircraft ${index}`;
      case 'model':return `Model-${index%31}`;
      case 'baseFacility':return `BASE-${index%100}`;
      default:return undefined;
    }
  }
  const millionAPI={
    source:()=>millionSource,membershipRevision:()=>`generated:${MILLION}`,scanLength:()=>MILLION,idAtRow:(_state,index)=>value(index,'id'),
    scan(_state,fields,fn,{from=0,to=Infinity}={}){millionMetrics.scanCalls++;const end=Math.min(MILLION,to),row={};for(let i=from;i<end;i++){for(const key of fields)row[key]=value(i,key);millionMetrics.rowsVisited++;fn(row,i);}return end;}
  };
  const millionQuery=QUERY.create({fleetData:millionAPI,maxCacheEntries:4,maxCacheRows:1_100_000,textChunkBytes:1_048_576});assert.throws(()=>millionQuery.ensure(millionState),error=>error?.code==='FLEET_LIST_QUERY_ASYNC_BUILD_REQUIRED');passed++;
  let millionBuildYields=0;const started=performance.now();await millionQuery.ensureAsync(millionState,{yieldFn:async()=>{millionBuildYields++;}});const buildMs=performance.now()-started,afterMillionBuild=millionMetrics.scanCalls;check(millionBuildYields>0,'first million-row index build is sliced asynchronously with the production default batch');
  let expectedNeedles=0;for(let i=0;i<MILLION;i++)if(i%997===0)expectedNeedles++;
  assert.throws(()=>millionQuery.query(millionState,{owner:'all',status:'all',search:'needle'}),error=>error?.code==='FLEET_LIST_QUERY_ASYNC_QUERY_REQUIRED');passed++;
  let firstSearchYields=0;const needle=await millionQuery.queryAsync(millionState,{owner:'all',status:'all',search:'needle'},{batchRows:4_096,yieldFn:async()=>{firstSearchYields++;}});check(needle.length===expectedNeedles&&firstSearchYields>0,'first million-row substring query is exact and sliced asynchronously');
  const afterNeedle=millionQuery.stats(millionState),testedAfterNeedle=afterNeedle.queryRowsTested,repeat=millionQuery.query(millionState,{owner:'all',status:'all',search:'needle'});check(repeat.length===needle.length&&millionQuery.stats(millionState).queryRowsTested===testedAfterNeedle,'subsequent identical million-row query is O(1) over the query cache');
  const narrower=millionQuery.query(millionState,{owner:'all',status:'all',search:'needle aircraft 99'}),afterNarrow=millionQuery.stats(millionState);check(afterNarrow.queryRowsTested-testedAfterNeedle<=needle.length,'longer typed search narrows the cached prefix instead of revisiting one million rows');
  for(const row of narrower)assert(QUERY.normalizeSearch(`${value(row,'id')} ${value(row,'name')} ${value(row,'model')} ${value(row,'baseFacility')}`).includes('needle aircraft 99'));passed++;
  const ownerMoving=millionQuery.query(millionState,{owner:'owner-7',status:'moving'});for(const row of ownerMoving){assert.equal(value(row,'ownerCompanyId'),'owner-7');assert(statusMatch({phase:value(row,'phase'),status:value(row,'status'),condition:value(row,'condition')},'moving'));}passed++;
  let asyncYields=0;const asyncRows=await millionQuery.queryAsync(millionState,{owner:'all',status:'all',search:'model-30'},{batchRows:100_000,yieldFn:async()=>{asyncYields++;}});let expectedModel=0;for(let i=0;i<MILLION;i++)if(i%31===30)expectedModel++;check(asyncRows.length===expectedModel&&asyncYields>0,'async query yields between bounded candidate batches');
  const millionStats=millionQuery.stats(millionState);check(millionMetrics.scanCalls===afterMillionBuild&&millionMetrics.rowsVisited===MILLION,'all million-row queries reuse the original public API scan');
  check(millionStats.cacheEntries<=4&&millionStats.cacheRows<=1_100_000,'million-row cache remains bounded');
  check(millionStats.textBytes<64*1024*1024,'compressed UTF-8 search corpus stays below 64 MiB for one million rows');
  check(buildMs<60_000,'million-row index builds within the generous regression ceiling');
  check(millionStats.buildSliceP99Ms<25&&millionStats.querySliceP99Ms<25,'async build and search p99 slices stay below the host regression budget');

  console.log(JSON.stringify({suite:'build359-fleet-list-query',passed,total:passed,millionRows:MILLION,buildMs:Number(buildMs.toFixed(1)),buildSliceP99Ms:Number(millionStats.buildSliceP99Ms.toFixed(2)),querySliceP99Ms:Number(millionStats.querySliceP99Ms.toFixed(2)),maxBuildSliceMs:Number(millionStats.maxBuildSliceMs.toFixed(2)),maxQuerySliceMs:Number(millionStats.maxQuerySliceMs.toFixed(2)),textMiB:Number((millionStats.textBytes/1048576).toFixed(2)),cacheEntries:millionStats.cacheEntries,cacheRows:millionStats.cacheRows,queryRowsTested:millionStats.queryRowsTested,millionBuildYields,firstSearchYields,asyncYields},null,2));
})().catch(error=>{console.error(error);process.exitCode=1;});

'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const ROOT=path.resolve(__dirname,'..');
const golden=JSON.parse(fs.readFileSync(path.join(__dirname,'fixtures/build339-time-golden-v1.json'),'utf8'));
const timeSource=fs.readFileSync(path.join(ROOT,'WebApp/simulation-time-core.js'),'utf8');
const pacingSource=fs.readFileSync(path.join(ROOT,'WebApp/simulation-pacing-core.js'),'utf8');
const simSource=fs.readFileSync(path.join(ROOT,'WebApp/simulation-core.js'),'utf8');
const appSource=fs.readFileSync(path.join(ROOT,'WebApp/app.js'),'utf8');

function loadSimulation(){
  const sandbox={console,Date,Math};sandbox.globalThis=sandbox;sandbox.window=sandbox;
  vm.createContext(sandbox);vm.runInContext(timeSource,sandbox,{filename:'simulation-time-core.js'});vm.runInContext(pacingSource,sandbox,{filename:'simulation-pacing-core.js'});vm.runInContext(simSource,sandbox,{filename:'simulation-core.js'});
  return sandbox.GH_SIMULATION_CORE;
}
function makeClock(){let now=0;return {now:()=>now,set:v=>{now=v;},advance:v=>{now+=v;}};}
function manualAdvanceScenario(){
  const GH=loadSimulation(),clock=makeClock(),events=[],maintenance=[];let sim=0,speed=0;
  const engine=GH.create({
    getSimTime:()=>sim,setSimTime:v=>{sim=v;},getSpeed:()=>speed,setSpeed:v=>{speed=v;},
    createSliceJob:(slice,meta)=>{events.push({phase:'create',from:meta.from,to:meta.to,hour:meta.boundary.hour,day:meta.boundary.day});return {runChunk(){return true;},finish(info){events.push({phase:'finish',from:info.from,to:info.to,hour:info.boundary.hour,day:info.boundary.day});return {committed:true};}};},
    onMaintenance:hour=>maintenance.push(hour),onAdvance:()=>{}
  },{nowMs:clock.now,allowedSpeeds:[0,30,120,300,600],fallbackSpeed:30,manualBatchSeconds:3600,manualMinBatchSeconds:300,maintenanceEveryHours:12,manualFrameBudgetMs:10,frameBudgetMs:4,minRealSliceSeconds:0});
  const accepted=engine.advanceTo(90000,{speed:600,batchSeconds:3600});assert.equal(accepted.accepted,true);
  for(let i=0;i<200&&engine.snapshot().manualAdvance;i++){clock.advance(16);engine.frame(clock.now());}
  assert.equal(engine.snapshot().manualAdvance,null,'manual advance did not complete');
  const finishes=events.filter(x=>x.phase==='finish');
  const midnight=finishes.find(x=>x.to===86400);
  return {target:90000,finalSimSeconds:sim,committedSlices:finishes.length,hourBoundaries:finishes.filter(x=>x.hour!==null).length,dayBoundaries:finishes.filter(x=>x.day!==null).length,maintenanceHours:maintenance,midnightBoundary:midnight?{from:midnight.from,to:midnight.to,hour:midnight.hour,day:midnight.day}:null,lastBoundary:engine.snapshot().lastBoundary};
}
function liveBoundarySplitScenario(){
  const GH=loadSimulation(),clock=makeClock(),slices=[];let sim=3500,speed=600;
  const engine=GH.create({
    getSimTime:()=>sim,setSimTime:v=>{sim=v;},getSpeed:()=>speed,setSpeed:v=>{speed=v;},
    createSliceJob:(slice,meta)=>({runChunk(){return true;},finish(info){slices.push({from:info.from,to:info.to,hour:info.boundary.hour,day:info.boundary.day});return {committed:true};}})
  },{nowMs:clock.now,allowedSpeeds:[0,30,120,300,600],fallbackSpeed:30,quantumRealSeconds:1,maxBacklogFast:5000,maxRealDelta:3,frameBudgetMs:100,minRealSliceSeconds:0});
  engine.reset(0,'golden-start');clock.set(1000);engine.frame(1000);
  return {start:3500,realDeltaSeconds:1,speed:600,finalSimSeconds:sim,slices};
}
function stallScenario(){
  const GH=loadSimulation(),clock=makeClock();let sim=0,speed=600;
  const engine=GH.create({getSimTime:()=>sim,setSimTime:v=>{sim=v;},getSpeed:()=>speed,setSpeed:v=>{speed=v;},createSliceJob:()=>({runChunk(){return true;},finish(){return {committed:true};}})},{nowMs:clock.now,allowedSpeeds:[0,30,120,300,600],fallbackSpeed:30,maxRealDelta:3,frameBudgetMs:100,minRealSliceSeconds:0});
  engine.reset(0,'golden-start');clock.set(5000);engine.frame(5000);const snap=engine.snapshot();
  return {maxRealDelta:3,stallSeconds:5,finalSimSeconds:sim,droppedRealSeconds:snap.droppedRealSeconds,stallGaps:snap.stallGaps};
}
function boundaryOrder(){
  const day=appSource.indexOf('if(boundary.day!==null&&boundary.day!==undefined)processFinancialDay(boundary.day);');
  const hour=appSource.indexOf('if(boundary.hour!==null&&boundary.hour!==undefined)processMarket(boundary.hour);');
  assert(day>=0&&hour>=0&&day<hour,'midnight boundary order drifted: day must commit before hourly market work');
  return ['day','hour'];
}
const actual={schema:golden.schema,manualAdvance:manualAdvanceScenario(),liveBoundarySplit:liveBoundarySplitScenario(),stallPolicy:stallScenario(),boundaryOrder:boundaryOrder()};
assert.deepEqual(actual,golden);
console.log(JSON.stringify({suite:'build339-time-golden',passed:true,golden:golden.schema,actual},null,2));

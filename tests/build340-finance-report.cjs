'use strict';

const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const finance=require('../WebApp/finance-core.js');
const core=require('../WebApp/finance-report-core.js');

function makeSnapshot(reportCount=10000){
  const companyTypes=finance.companyIds({},{includeGroup:false}),reports=[];let currentDay=reportCount/2;
  for(let index=0;index<reportCount;index++){
    const day=Math.floor(index/2),companies={};for(let offset=0;offset<companyTypes.length;offset++){const type=companyTypes[offset];companies[type]={grossRevenue:(index+1)*(offset+3)%900000,expenses:(index+offset)%200000,net:((index*13+offset)%300000)-1000};}
    reports.push({day,monthKey:finance.calendarMonthForDay(day),net:(index%2?-1:1)*((index*17)%500000),group:{income:(index+1)*101%3000000,expenses:(index*29)%900000},companies});
  }
  return {months:12,companyTypes,currentMonthKey:finance.calendarMonthForDay(currentDay),reports};
}

function makeState(snapshot){return {simSeconds:Math.floor(snapshot.reports.length/2)*86400+600,finance:{dailyCompanyReports:snapshot.reports.map(row=>({day:row.day,net:row.net,group:{grossRevenue:row.group.income,expenses:row.group.expenses},companies:Object.fromEntries(snapshot.companyTypes.map(type=>[type,{grossRevenue:row.companies[type].income,expenses:row.companies[type].expenses,net:row.companies[type].net}]))}))}};}

function testParity(){
  const snapshot=makeSnapshot(),state=makeState(snapshot),expected=finance.monthlyStatement(state,{months:12}),actual=core.buildMonthlyStatement(snapshot);
  assert.deepEqual(actual,expected,'read-only worker report preserves company order, month keys, unique day counts, and signed net totals');
  assert.equal(actual.length,12);assert.equal(actual[0].monthKey,snapshot.currentMonthKey);assert.ok(actual.some(row=>row.deficit>0));
  const empty={months:12,companyTypes:snapshot.companyTypes,currentMonthKey:'2026-09',reports:[]};const blank=core.buildMonthlyStatement(empty);assert.equal(blank.length,1);assert.equal(blank[0].reportedDays,0);assert.equal(blank[0].income,0);
}

class FakeWorker{
  constructor(delay=3){this.delay=delay;this.terminated=false;}
  postMessage(message){setTimeout(()=>{if(this.terminated)return;try{const months=core.buildMonthlyStatement(message.snapshot);this.onmessage?.({data:{type:'result',requestId:message.requestId,generation:message.generation,key:message.key,version:core.VERSION,months}});}catch(error){this.onmessage?.({data:{type:'error',error:error.message}});}},this.delay);}
  terminate(){this.terminated=true;}
}
const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));

async function testLifecycle(){
  const first=makeSnapshot(100),second=makeSnapshot(200),workers=[],completed=[];let failures=0;
  const engine=core.create({workerFactory:()=>{const worker=new FakeWorker();workers.push(worker);return worker;},timeoutMs:1000,onResult:result=>completed.push(result),onFailure:()=>failures++});
  assert.equal(engine.request({key:'first',snapshot:first}).pending,true);assert.equal(engine.request({key:'second',snapshot:second}).pending,true,'newer finance snapshot supersedes old request without a queue');
  assert.equal(workers.length,2);assert.equal(workers[0].terminated,true,'superseded aggregation worker is terminated instead of queuing stale work');await wait(20);assert.equal(completed.length,1);assert.equal(completed[0].key,'second','late result cannot replace the current report snapshot');
  const cached=engine.request({key:'second',snapshot:second});assert.equal(cached.ready,true);assert.deepEqual(cached.months,core.buildMonthlyStatement(second));assert.equal(failures,0);
  engine.disable();assert.equal(workers[1].terminated,true);assert.equal(failures,1);failures=0;
  const unavailable=core.create({workerFactory:()=>{throw new Error('worker-unavailable');},onFailure:()=>failures++});assert.equal(unavailable.request({key:'x',snapshot:first}).worker,false);assert.equal(unavailable.isDisabled(),true);assert.equal(failures,1);
}

function testWorkerContractAndWiring(){
  const workerPath=path.join(__dirname,'../WebApp/finance-report-worker.js'),source=fs.readFileSync(workerPath,'utf8'),sent=[],context={Array,Map,Set,Number,String,TypeError,Error,Math,Promise,console};
  context.self=context;context.globalThis=context;context.importScripts=()=>{context.GH_FINANCE_REPORT_CORE=core;};context.addEventListener=(type,listener)=>{if(type==='message')context.receive=listener;};context.postMessage=message=>sent.push(message);
  vm.runInNewContext(source,context,{filename:workerPath});const snapshot=makeSnapshot(10);context.receive({data:{type:'aggregate',requestId:4,generation:2,key:'month-r2',snapshot}});
  assert.equal(sent[0].type,'result');assert.equal(sent[0].requestId,4);assert.equal(sent[0].version,core.VERSION);assert.deepEqual(sent[0].months,core.buildMonthlyStatement(snapshot));
  const root=path.join(__dirname,'..'),html=fs.readFileSync(path.join(root,'WebApp/index.html'),'utf8'),app=fs.readFileSync(path.join(root,'WebApp/app.js'),'utf8'),runtime=JSON.parse(fs.readFileSync(path.join(root,'WebApp/runtime-required.json'),'utf8'));
  assert.ok(html.indexOf('finance-report-core.js')<html.indexOf('app.js'));assert.match(app,/new Worker\('finance-report-worker\.js'\)/);assert.match(app,/financeReportEngine\?\.request\?\.\(input\)/);assert.ok(runtime.files.includes('finance-report-worker.js'));
}

(async()=>{testParity();await testLifecycle();testWorkerContractAndWiring();console.log('Build 340 finance report engine: 10k daily rows, exact report parity, signed balances, duplicate-day counts, stale snapshot rejection and fallback PASS');})().catch(error=>{console.error(error);process.exitCode=1;});

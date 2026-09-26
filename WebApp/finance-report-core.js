'use strict';

((root,factory)=>{
  const api=factory();
  if(typeof module==='object'&&module.exports)module.exports=api;
  if(root)root.GH_FINANCE_REPORT_CORE=api;
})(typeof globalThis!=='undefined'?globalThis:this,()=>{
  const VERSION='GH-FINANCE-REPORT-340.2.0';
  const num=value=>Math.max(0,Number(value)||0);
  const monthKey=value=>/^\d{4}-\d{2}$/.test(String(value||''));
  function buildMonthlyStatement(snapshot={}){
    const months=Math.max(1,Math.min(36,Math.floor(Number(snapshot.months)||12))),companyTypes=Array.isArray(snapshot.companyTypes)?snapshot.companyTypes.map(String):[],byMonth=new Map();
    if(companyTypes.length>256||!Array.isArray(snapshot.reports)||snapshot.reports.length>200000)throw new TypeError('finance-report-snapshot-invalid');
    for(const report of snapshot.reports){
      if(!monthKey(report?.monthKey)||!Number.isFinite(Number(report?.day)))throw new TypeError('finance-report-row-invalid');
      const key=report.monthKey,month=byMonth.get(key)||{monthKey:key,days:new Set(),group:{income:0,expenses:0,net:0},companies:{}};
      month.days.add(Number(report.day));const group=report.group||{};month.group.income+=num(group.income);month.group.expenses+=num(group.expenses);month.group.net+=Number(report.net)||0;
      for(const type of companyTypes){const source=report.companies?.[type]||{},row=month.companies[type]||(month.companies[type]={company:type,income:0,expenses:0,net:0});row.income+=num(source.income);row.expenses+=num(source.expenses);row.net+=Number(source.net)||0;}
      byMonth.set(key,month);
    }
    const currentMonthKey=String(snapshot.currentMonthKey||'');if(!monthKey(currentMonthKey))throw new TypeError('finance-report-current-month-invalid');
    if(!byMonth.has(currentMonthKey))byMonth.set(currentMonthKey,{monthKey:currentMonthKey,days:new Set(),group:{income:0,expenses:0,net:0},companies:{}});
    return [...byMonth.values()].sort((a,b)=>b.monthKey.localeCompare(a.monthKey)).slice(0,months).map(month=>({monthKey:month.monthKey,reportedDays:month.days.size,income:month.group.income,expenses:month.group.expenses,net:month.group.net,deficit:Math.max(0,-month.group.net),surplus:Math.max(0,month.group.net),companies:companyTypes.map(type=>month.companies[type]||{company:type,income:0,expenses:0,net:0})}));
  }
  function validRows(rows,snapshot){
    if(!Array.isArray(rows)||rows.length<1||rows.length>36||!Array.isArray(snapshot?.companyTypes)||rows.some(row=>!monthKey(row?.monthKey)||!Number.isInteger(row?.reportedDays)||row.reportedDays<0||!['income','expenses','net','deficit','surplus'].every(key=>Number.isFinite(row[key]))||!Array.isArray(row.companies)||row.companies.length!==snapshot.companyTypes.length))return false;
    return rows.every(row=>row.companies.every((company,index)=>company?.company===snapshot.companyTypes[index]&&['income','expenses','net'].every(key=>Number.isFinite(company[key]))));
  }
  function create(options={}){
    let worker=null,disabled=false,generation=0,nextRequestId=0,pending=null,cache=null;
    const timeoutMs=Math.max(250,Number(options.timeoutMs)||3000),workerFactory=options.workerFactory;
    const clear=()=>{if(pending?.timer)clearTimeout(pending.timer);pending=null;};
    function disable(error){if(disabled)return;disabled=true;clear();cache=null;try{worker?.terminate?.();}catch{}worker=null;try{options.onFailure?.(error instanceof Error?error:new Error(String(error||'finance-report-worker-failed')));}catch{}}
    function handleMessage(event){
      const message=event?.data||{};if(message.type==='error'){if(pending&&message.generation===pending.generation)disable(new Error(String(message.error||'finance-report-worker-error')));return;}
      if(message.type!=='result'||!pending||message.requestId!==pending.requestId||message.generation!==pending.generation||message.key!==pending.key)return;
      if(message.version!==VERSION||!validRows(message.months,pending.snapshot)){disable(new Error('finance-report-result-invalid'));return;}
      const complete=pending;clear();cache={key:complete.key,months:message.months};try{options.onResult?.({key:cache.key,months:cache.months,generation:complete.generation});}catch{}
    }
    function ensureWorker(){
      if(disabled||worker)return worker;
      try{if(typeof workerFactory!=='function')throw new Error('finance-report-worker-unavailable');worker=workerFactory();if(!worker||typeof worker.postMessage!=='function')throw new Error('finance-report-worker-invalid');worker.onmessage=handleMessage;worker.onerror=event=>disable(event?.error||new Error(event?.message||'finance-report-worker-error'));worker.onmessageerror=()=>disable(new Error('finance-report-message-error'));return worker;}catch(error){disable(error);return null;}
    }
    function request(input={}){
      let active=ensureWorker();const key=String(input.key||'');if(!active)return {ready:false,worker:false,reason:'worker-disabled'};
      if(!key||!input.snapshot||!Array.isArray(input.snapshot.reports))return {ready:false,worker:false,reason:'snapshot-invalid'};
      if(cache?.key===key)return {ready:true,worker:true,months:cache.months,generation};
      if(pending?.key===key)return {ready:false,worker:true,pending:true,generation:pending.generation};
      if(pending){clear();try{worker?.terminate?.();}catch{}worker=null;active=ensureWorker();if(!active)return {ready:false,worker:false,reason:'worker-disabled'};}
      generation++;const requestId=++nextRequestId,request={requestId,generation,key,snapshot:input.snapshot,timer:null};pending=request;request.timer=setTimeout(()=>disable(new Error('finance-report-worker-timeout')),timeoutMs);
      try{active.postMessage({type:'aggregate',requestId,generation,key,snapshot:input.snapshot});}catch(error){disable(error);return {ready:false,worker:false,reason:'post-failed'};}
      return {ready:false,worker:true,pending:true,generation};
    }
    return Object.freeze({request,isDisabled:()=>disabled,disable:()=>disable(new Error('finance-report-worker-disabled')),version:VERSION});
  }
  return Object.freeze({VERSION,buildMonthlyStatement,create});
});

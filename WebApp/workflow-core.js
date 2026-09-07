(()=>{
  'use strict';
  const VERSION='2.9.1',HISTORY_LIMIT=240;
  function state(explicit){return explicit||globalThis.__GH_STATE__||globalThis.state||globalThis.window?.state||null;}
  function ensure(s){
    if(!s)return null;
    s.workflowControl=s.workflowControl&&typeof s.workflowControl==='object'?s.workflowControl:{};
    const w=s.workflowControl;
    w.sequence=Math.max(0,Number(w.sequence)||0);
    w.history=Array.isArray(w.history)?w.history:[];
    w.lastIntegrity=w.lastIntegrity&&typeof w.lastIntegrity==='object'?w.lastIntegrity:null;
    return w;
  }
  function record(s,type,detail={},severity='info'){
    s=state(s);if(!s)return null;const w=ensure(s);w.sequence+=1;
    const item={id:`WF-${String(w.sequence).padStart(7,'0')}`,type:String(type||'WORKFLOW_EVENT'),simSeconds:Number(s.simSeconds)||0,severity,detail:detail&&typeof detail==='object'?detail:{value:detail}};
    w.history.unshift(item);if(w.history.length>HISTORY_LIMIT)w.history.length=HISTORY_LIMIT;
    try{globalThis.GH_EVENT_LEDGER?.append?.(s,{type:item.type,domain:'workflow',entityType:'workflow',entityId:item.id,actor:'user/system',detail:item.detail});}catch(error){console.warn('Workflow ledger record failed',error);}
    try{globalThis.GH_DIAGNOSTICS?.record?.(s,item.type,item.detail,severity);}catch(error){console.warn('Workflow diagnostics record failed',error);}
    return item;
  }
  function notify(message,kind='info',opts={}){
    const s=state(opts.state);const text=String(message||'').trim();if(!text)return false;
    record(s,'WORKFLOW_NOTICE',{message:text,kind,panel:opts.panel||null,action:opts.action||null},kind==='error'?'warning':'info');
    if(typeof globalThis.GH_INTERACTION_NOTICE==='function')globalThis.GH_INTERACTION_NOTICE(text,kind);
    else if(typeof globalThis.console!=='undefined')(kind==='error'?console.error:kind==='warning'?console.warn:console.info)(text);
    return true;
  }
  function confirmAction(message,opts={}){
    const s=state(opts.state),text=String(message||'').trim();
    record(s,'WORKFLOW_CONFIRM_SHOWN',{message:text,panel:opts.panel||null,action:opts.action||null,risk:opts.risk||'normal'},'info');
    const fn=opts.confirmFn||globalThis.window?.confirm||globalThis.confirm;
    const accepted=typeof fn==='function'?Boolean(fn(text)):false;
    record(s,accepted?'WORKFLOW_CONFIRM_ACCEPTED':'WORKFLOW_CONFIRM_CANCELLED',{panel:opts.panel||null,action:opts.action||null,risk:opts.risk||'normal'},'info');
    return accepted;
  }
  function issueKey(x){return `${String(x?.domain||'system')}|${String(x?.id||'UNKNOWN')}`;}
  function issueSnapshot(s){const report=globalThis.GH_INTEGRITY_CORE?.check?.(s)||{status:'healthy',counts:{critical:0,warning:0,total:0},issues:[]};return {status:report.status,counts:report.counts||{},issues:report.issues||[],keys:new Set((report.issues||[]).map(issueKey))};}
  function postCheck(s,meta={}){
    s=state(s);if(!s)return {ok:true,status:'unavailable',issues:[]};
    const report=globalThis.GH_INTEGRITY_CORE?.check?.(s)||{status:'healthy',counts:{critical:0,warning:0,total:0},issues:[]},beforeKeys=meta.beforeKeys instanceof Set?meta.beforeKeys:new Set(Array.isArray(meta.beforeIssues)?meta.beforeIssues.map(issueKey):[]),newIssues=(report.issues||[]).filter(x=>!beforeKeys.has(issueKey(x))),newWarnings=newIssues.filter(x=>x.severity==='warning'),newCritical=newIssues.filter(x=>x.severity==='critical');
    const w=ensure(s);w.lastIntegrity={at:Number(s.simSeconds)||0,status:report.status,counts:report.counts||{},newCounts:{critical:newCritical.length,warning:newWarnings.length,total:newIssues.length},action:meta.action||null,panel:meta.panel||null};
    if(report.status==='critical'){
      record(s,'WORKFLOW_POSTCHECK_CRITICAL',{action:meta.action||null,panel:meta.panel||null,counts:report.counts,newCounts:w.lastIntegrity.newCounts,issues:(report.issues||[]).slice(0,12)},'critical');
      notify(`اكتشف فحص سلامة الأعمال ${report.counts?.critical||0} حالة حرجة بعد الإجراء. راجع HLT قبل متابعة قرارات جديدة.`,'error',{state:s,panel:meta.panel,action:meta.action});
      return {ok:false,status:report.status,issues:report.issues||[],newIssues};
    }
    if(newWarnings.length)record(s,'WORKFLOW_POSTCHECK_WARNING',{action:meta.action||null,panel:meta.panel||null,counts:report.counts,newCounts:w.lastIntegrity.newCounts,issues:newWarnings.slice(0,12)},'warning');
    return {ok:true,status:newWarnings.length?'warning':'healthy',underlyingStatus:report.status,issues:report.issues||[],newIssues};
  }
  async function run(handler,opts={}){
    if(typeof handler!=='function')throw new Error('Workflow handler is missing.');
    const s=state(opts.state),meta={action:opts.action||null,panel:opts.panel||null,domain:opts.domain||null},before=opts.skipIntegrity?null:issueSnapshot(s);if(before)meta.beforeKeys=before.keys;
    record(s,'WORKFLOW_BEGIN',{action:meta.action,panel:meta.panel,domain:meta.domain},'info');
    try{
      const value=await handler();
      const integrity=opts.skipIntegrity?{ok:true,status:'skipped',issues:[]}:postCheck(s,meta);
      record(s,'WORKFLOW_OK',{...meta,integrity:integrity.status},integrity.ok?'info':'warning');
      return {ok:true,value,integrity};
    }catch(error){
      record(s,'WORKFLOW_FAILED',{...meta,error:{name:error?.name||'Error',message:error?.message||String(error)}},'warning');
      notify(`تعذر تنفيذ الإجراء: ${error?.message||error}`,'error',{state:s,panel:opts.panel,action:opts.action});
      throw error;
    }
  }
  function summary(s){const w=ensure(state(s));return w?{sequence:w.sequence,count:w.history.length,lastIntegrity:w.lastIntegrity,recent:w.history.slice(0,30)}:{sequence:0,count:0,lastIntegrity:null,recent:[]};}
  const API=Object.freeze({VERSION,HISTORY_LIMIT,ensure,record,notify,confirm:confirmAction,postCheck,run,summary});
  globalThis.GH_WORKFLOW=API;if(globalThis.window&&globalThis.window!==globalThis)globalThis.window.GH_WORKFLOW=API;if(typeof module!=='undefined'&&module.exports)module.exports=API;
})();

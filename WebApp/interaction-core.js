(()=>{
  'use strict';
  const VERSION='2.9.0';
  const locks=new WeakSet();
  function state(){return globalThis.__GH_STATE__||globalThis.state||globalThis.window?.state||null;}
  function record(type,detail={},severity='info',explicitState=null){
    const s=explicitState||state();
    try{if(s&&globalThis.GH_DIAGNOSTICS?.record)globalThis.GH_DIAGNOSTICS.record(s,type,detail,severity);}catch(error){console.warn('Interaction diagnostics record failed',error);}
  }
  function label(btn){return (btn?.textContent||btn?.getAttribute?.('aria-label')||btn?.dataset?.ghAction||btn?.dataset?.open||'زر').trim().replace(/\s+/g,' ').slice(0,120);}
  function disabledReason(btn){return btn?.dataset?.disabledReason||btn?.getAttribute?.('title')||'هذا الإجراء غير متاح في الحالة الحالية.';}
  function feedback(btn,text,kind='info'){
    if(!btn)return;
    btn.dataset.interactionFeedback=kind;
    btn.setAttribute('aria-live','polite');
    if(text)btn.setAttribute('title',text);
  }
  async function run(btn,handler,meta={}){
    if(!btn||typeof handler!=='function')throw new Error('Interaction handler is missing.');
    const info={action:meta.action||btn.dataset?.ghAction||btn.dataset?.open||null,label:label(btn),panel:meta.panel||null};
    if(locks.has(btn)){record('BUTTON_DUPLICATE_BLOCKED',info,'warning',meta.state);feedback(btn,'الإجراء قيد التنفيذ بالفعل.','busy');return {ok:false,busy:true};}
    if(btn.disabled||btn.getAttribute?.('aria-disabled')==='true'){
      const reason=disabledReason(btn);feedback(btn,reason,'disabled');record('BUTTON_DISABLED',{...info,reason},'info',meta.state);
      globalThis.GH_INTERACTION_NOTICE?.(reason,'disabled');return {ok:false,disabled:true,reason};
    }
    locks.add(btn);const oldDisabled=btn.disabled,beforeIntegrity=meta.state&&globalThis.GH_INTEGRITY_CORE?.check?.(meta.state);btn.disabled=true;btn.classList?.add('is-busy');btn.setAttribute?.('aria-busy','true');record('BUTTON_ACTION_BEGIN',info,'info',meta.state);
    try{
      const cp=globalThis.GH_CONTROL_PLANE;let value;
      if(meta.state&&cp?.executeAsync){
        const out=await cp.executeAsync(meta.state,{name:`UI:${info.action||'interaction'}`,domain:'ui',actor:'player',metadata:{label:info.label,panel:info.panel}},async()=>handler(),{verify:()=>{const check=globalThis.GH_INTEGRITY_CORE?.check?.(meta.state);const critical=(check?.issues||[]).filter(x=>x.severity==='critical');return critical.length?{ok:false,reason:`Critical integrity after UI action: ${critical.map(x=>x.id).slice(0,4).join(',')}`}:{ok:true};}});
        value=out?.value;
      }else value=await handler();
      const integrity=globalThis.GH_WORKFLOW?.postCheck?.(meta.state,{action:info.action,panel:info.panel,beforeIssues:beforeIntegrity?.issues||[]});record('BUTTON_ACTION_OK',{...info,integrity:integrity?.status||'unavailable'},'info',meta.state);feedback(btn,integrity?.ok===false?'تم التنفيذ مع ملاحظة سلامة؛ راجع HLT.':'تم تنفيذ الإجراء.',integrity?.ok===false?'warning':'success');return {ok:true,value,integrity};
    }catch(error){record('BUTTON_ACTION_FAILED',{...info,error:{name:error?.name||'Error',message:error?.message||String(error),stack:String(error?.stack||'').split('\n').slice(0,8).join('\n')}},'warning',meta.state);feedback(btn,`تعذر التنفيذ: ${error?.message||error}`,'error');globalThis.GH_INTERACTION_NOTICE?.(`تعذر تنفيذ ${info.label}: ${error?.message||error}`,'error');throw error;
    }finally{locks.delete(btn);btn.classList?.remove('is-busy');btn.removeAttribute?.('aria-busy');btn.disabled=oldDisabled;}
  }
  function validate(root=document){
    const issues=[];if(!root?.querySelectorAll)return issues;
    root.querySelectorAll('button').forEach(btn=>{
      const looksAction=btn.dataset?.ghAction||btn.dataset?.open||btn.classList?.contains('diligence')||btn.classList?.contains('acquire-stake');
      if(looksAction&&!btn.onclick&&!btn.dataset?.interactionBound&&!btn.dataset?.open&& !btn.dataset?.ghAction && !btn.classList?.contains('diligence')&&!btn.classList?.contains('acquire-stake'))issues.push({id:'BUTTON_NO_HANDLER',label:label(btn)});
      const intentionallyBusy=btn.getAttribute?.('aria-busy')==='true'||btn.classList?.contains('is-busy');
      if(btn.disabled&&!btn.dataset?.disabledReason&&!btn.title&&!intentionallyBusy)issues.push({id:'DISABLED_WITHOUT_REASON',label:label(btn)});
    });return issues;
  }
  const API={VERSION,run,record,feedback,disabledReason,validate};
  globalThis.GH_INTERACTION=API;if(globalThis.window&&globalThis.window!==globalThis)globalThis.window.GH_INTERACTION=API;if(typeof module!=='undefined'&&module.exports)module.exports=API;
})();

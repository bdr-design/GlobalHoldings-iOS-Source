(()=>{
  'use strict';
  const VERSION='2.9.0';
  const PANEL_DOMAIN={
    leadershipHub:'القيادة',workspaceHub:'النظام',actionCenter:'القيادة',intelligence:'القيادة',aiApprovals:'القيادة',programs:'القيادة',news:'القيادة',realism:'القيادة',ma:'القيادة',research:'القيادة',esg:'القيادة',career:'القيادة',
    companies:'الشركات',companyManage:'الشركات',peopleHub:'الأفراد',labor:'الأفراد',control:'التشغيل',network:'التشغيل',expansion:'التشغيل',globalRoute:'التشغيل',routes:'التشغيل',assets:'التشغيل',assetManage:'التشغيل',assignRoute:'التشغيل',ports:'التشغيل',procurement:'التشغيل',contracts:'التشغيل',facilityManage:'التشغيل',
    finance:'المالية',treasury:'المالية',invoices:'المالية',market:'المالية',bank:'المالية',
    governanceHub:'الرقابة',governance:'الرقابة',audit:'الرقابة',legal:'الرقابة',insurance:'الرقابة',cyber:'الرقابة',safety:'الرقابة',
    systemHub:'النظام',more:'النظام',diagnostics:'النظام',controlPlane:'النظام',updates:'النظام',settings:'النظام',energy:'الشركات'
  };
  function record(state,type,detail={},severity='info'){
    try{globalThis.GH_DIAGNOSTICS?.record?.(state,type,detail,severity);}catch(error){console.warn('UI quality diagnostics failed',error);}
  }
  function task(id,title,domain,priority='normal',panel=null,reason=''){return {id,title,domain,priority,panel,reason};}
  function collectTasks(state){
    const out=[],ai=state?.advanced?.ai||{},proc=state?.advanced?.procurement||{},diag=state?.diagnostics||{},now=Number(state?.simSeconds)||0;
    (ai.requests||[]).filter(r=>r?.status==='بانتظار التفويض').forEach(r=>out.push(task(`AI:${r.id}`,r.title||'طلب قرار AI','القيادة',r.priority==='critical'?'critical':'high','aiApprovals',r.reason||'')));
    (proc.assetRequests||[]).forEach(r=>{
      const blockers=Array.isArray(r.blockers)?r.blockers:[];
      const priority=blockers.length?'high':r.status==='awaiting_authorization'?'high':'normal';
      out.push(task(`AR:${r.id}`,`${r.id} · ${r.title||'طلب أصل'}`,'التشغيل',priority,'procurement',blockers.join(' · ')||r.nextAction||''));
    });
    (state?.realism?.procurement?.deliveries||[]).filter(d=>d?.status!=='delivered'&&Number(d?.dueSimSeconds||Infinity)<now).forEach(d=>out.push(task(`DEL:${d.id}`,`تسليم متأخر · ${d.asset?.model||d.catalogId||d.id}`,'التشغيل','critical','procurement',d.destination||'')));
    const activeIssues=diag.activeIssues&&typeof diag.activeIssues==='object'?Object.values(diag.activeIssues):[];
    activeIssues.forEach(i=>out.push(task(`DIAG:${i.id||i.type}`,i.message||i.title||i.id||'مشكلة نظام','النظام',i.severity==='critical'?'critical':'high','diagnostics',i.detail||'')));
    const audit=state?.advanced?.audit;if(Number(audit?.findings)>0)out.push(task('AUDIT:OPEN',`${audit.findings} ملاحظات تدقيق مفتوحة`,'الرقابة',audit.findings>=5?'critical':'high','audit','تحتاج متابعة وإغلاق.'));
    const legal=state?.advanced?.legal;if(Number(legal?.openCases)>0)out.push(task('LEGAL:OPEN',`${legal.openCases} قضايا قانونية مفتوحة`,'الرقابة','high','legal',''));
    const safety=state?.advanced?.safety;if(Number(safety?.incidents)>0)out.push(task('SAFETY:INCIDENTS',`${safety.incidents} حوادث سلامة`,'الرقابة','critical','safety',''));
    const cyber=state?.advanced?.cyber;if(Number(cyber?.incidents)>0)out.push(task('CYBER:INCIDENTS',`${cyber.incidents} حوادث سيبرانية`,'الرقابة','critical','cyber',''));
    const rank={critical:0,high:1,normal:2};return out.sort((a,b)=>(rank[a.priority]??9)-(rank[b.priority]??9)||a.domain.localeCompare(b.domain,'ar'));
  }
  function scan(root,panel,state){
    const issues=[];if(!root?.querySelectorAll)return issues;
    const ids=new Set();root.querySelectorAll('[id]').forEach(el=>{if(ids.has(el.id))issues.push({id:'UI_DUPLICATE_ID',severity:'warning',panel,elementId:el.id});ids.add(el.id);});
    root.querySelectorAll('button').forEach(btn=>{
      const actionable=btn.dataset?.ghAction||btn.dataset?.open||btn.classList?.contains('diligence')||btn.classList?.contains('acquire-stake');
      if(actionable&&!btn.dataset?.interactionBound)issues.push({id:'UI_ACTION_UNBOUND',severity:'critical',panel,label:(btn.textContent||'').trim().slice(0,100)});
      if(btn.disabled&&!btn.dataset?.disabledReason&&!btn.title)issues.push({id:'UI_DISABLED_WITHOUT_REASON',severity:'warning',panel,label:(btn.textContent||'').trim().slice(0,100)});
    });
    const box=root.getBoundingClientRect?.();if(box&&root.scrollWidth>root.clientWidth+3)issues.push({id:'UI_PANEL_HORIZONTAL_OVERFLOW',severity:'warning',panel,scrollWidth:root.scrollWidth,clientWidth:root.clientWidth});
    issues.forEach(i=>record(state,i.id,i,i.severity));return issues;
  }
  function enhance(root,{panel,state}={}){
    if(!root)return [];
    root.dataset.qualityPanel=panel||'';root.dataset.qualityDomain=PANEL_DOMAIN[panel]||'';
    root.querySelectorAll('button[disabled]').forEach(btn=>{if(!btn.dataset.disabledReason&&!btn.title)btn.dataset.disabledReason='هذا الإجراء غير متاح حتى تكتمل متطلباته الحالية.';});
    return scan(root,panel,state);
  }
  const API={VERSION,PANEL_DOMAIN,collectTasks,scan,enhance};
  globalThis.GH_UI_QUALITY=API;if(globalThis.window&&globalThis.window!==globalThis)globalThis.window.GH_UI_QUALITY=API;if(typeof module!=='undefined'&&module.exports)module.exports=API;
})();

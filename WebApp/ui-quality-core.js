(()=>{
  'use strict';
  const VERSION='3.0.0';
  const PANEL_DOMAIN={
    leadershipHub:'الإدارة',actionCenter:'الإدارة',news:'الإدارة',businessWorld:'الإدارة',realism:'الإدارة',research:'الإدارة',esg:'الإدارة',conference:'الإدارة',peopleHub:'الإدارة',labor:'الإدارة',crews:'الإدارة',groupManagement:'الإدارة',governanceHub:'الإدارة',compliance:'الإدارة',cyber:'الإدارة',safety:'الإدارة',
    companies:'الشركات',companyManage:'الشركات',energy:'الشركات',bank:'الشركات',
    control:'العمليات',network:'العمليات',expansion:'العمليات',globalRoute:'العمليات',routes:'العمليات',assets:'العمليات',assetManage:'العمليات',ports:'العمليات',procurement:'العمليات',contracts:'العمليات',maintenance:'العمليات',facilityManage:'العمليات',
    finance:'المال',treasury:'المال',invoices:'المال',market:'المال',budgets:'المال',
    systemHub:'النظام',executionLog:'النظام',diagnostics:'النظام',controlPlane:'النظام',updates:'النظام',settings:'النظام'
  };

  function record(state,type,detail={},severity='info'){
    try{globalThis.GH_DIAGNOSTICS?.record?.(state,type,detail,severity);}catch(error){console.warn('UI quality diagnostics failed',error);}
  }
  function task(id,title,domain,priority='normal',panel=null,reason=''){return {id,title,domain,priority,panel,reason};}
  function collectTasks(state){
    const out=[],diag=state?.diagnostics||{},now=Number(state?.simSeconds)||0;
    (state?.realism?.procurement?.deliveries||[]).filter(d=>d?.status!=='delivered'&&Number(d?.dueSimSeconds||Infinity)<now).forEach(d=>{const asset=(Array.isArray(d.assets)?d.assets:d.asset?[d.asset]:[])[0];out.push(task(`DEL:${d.id}`,`تسليم متأخر · ${asset?.model||d.catalogId||d.id}${Number(d.count||d.assets?.length)>1?` · ${Number(d.count||d.assets.length)} أصل`:''}`,'التشغيل','critical','procurement',d.destination||''));});
    const activeIssues=diag.activeIssues&&typeof diag.activeIssues==='object'?Object.values(diag.activeIssues):[];
    activeIssues.forEach(i=>out.push(task(`DIAG:${i.id||i.type}`,i.message||i.title||i.id||'مشكلة نظام','النظام',i.severity==='critical'?'critical':'high','diagnostics',i.detail||'')));
    // Build 359: incidents of the last 30 game days, not the count since the game began (a permanent critical alarm).
    // Safety is critical at 5 incidents per 1,000 assets in 30 days, a follow-up below that; any cyber outage is high.
    const today=Math.floor(now/86400),recent=rows=>(Array.isArray(rows)?rows:[]).filter(row=>today-Number(row?.day)<30);
    const safetyRows=recent(state?.realism?.incidents),safetyCount=safetyRows.reduce((n,row)=>n+(Number(row.count)||0),0),fleet=Math.max(1,Number(globalThis.GH_FLEET_DATA?.size?.(state))||0),perThousand=safetyCount/fleet*1000;
    if(safetyCount>0)out.push(task('SAFETY:INCIDENTS',`${safetyCount} حادث سلامة في آخر 30 يومًا`,'الرقابة',perThousand>=5?'critical':'normal','safety',`${perThousand.toFixed(1)} لكل 1,000 أصل`));
    const cyberRows=recent(state?.advanced?.cyber?.events);if(cyberRows.length)out.push(task('CYBER:INCIDENTS',`${cyberRows.length} حادث سيبراني في آخر 30 يومًا`,'الرقابة','high','cyber',''));
    const rank={critical:0,high:1,normal:2};return out.sort((a,b)=>(rank[a.priority]??9)-(rank[b.priority]??9)||a.domain.localeCompare(b.domain,'ar'));
  }
  function scan(root,panel,state){
    const issues=[];if(!root?.querySelectorAll)return issues;
    const ids=new Set();root.querySelectorAll('[id]').forEach(el=>{if(ids.has(el.id))issues.push({id:'UI_DUPLICATE_ID',severity:'warning',panel,elementId:el.id});ids.add(el.id);});
    root.querySelectorAll('button').forEach(btn=>{
      const actionable=btn.dataset?.ghAction||btn.dataset?.open;
      if(actionable&&!btn.dataset?.interactionBound)issues.push({id:'UI_ACTION_UNBOUND',severity:'critical',panel,label:(btn.textContent||'').trim().slice(0,100)});
      if(btn.disabled&&!btn.dataset?.disabledReason&&!btn.title)issues.push({id:'UI_DISABLED_WITHOUT_REASON',severity:'warning',panel,label:(btn.textContent||'').trim().slice(0,100)});
    });
    // Build 358: the overflow check reads layout. Right after a panel's HTML is replaced that forces a synchronous layout
    // (15 ms in Chromium, several times that on iPhone, on every drawer render); it now runs after the next paint, when
    // layout is already computed.
    const checkOverflow=()=>{if(!root.isConnected)return;const box=root.getBoundingClientRect?.();if(box&&root.scrollWidth>root.clientWidth+3){const row={id:'UI_PANEL_HORIZONTAL_OVERFLOW',severity:'warning',panel,scrollWidth:root.scrollWidth,clientWidth:root.clientWidth};record(state,row.id,row,row.severity);}};
    if(typeof requestAnimationFrame==='function'&&typeof setTimeout==='function')requestAnimationFrame(()=>setTimeout(checkOverflow,0));else checkOverflow();
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

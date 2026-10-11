// Build 372: the fleet part of the health check (diagnostics-core runHealthCheck), on its own so the fleet engine's
// worker can run it on its replica: with a million assets it reads every row (about 485 ms on the main thread in desktop
// Chromium), and the main thread now takes the worker's result. The code and its issues are the ones runHealthCheck had,
// in the same order; the issue texts are unchanged.
//
// assetIssues(state, fleetData) returns [id, severity, title, detail, domain, evidence] rows for runHealthCheck's add().
(()=>{
  'use strict';
  const VERSION='1.0.0';
  const finiteNumber=value=>typeof value==='number'&&Number.isFinite(value);
  // Build 358 (million-asset): the per-asset checks below only add issues for a missing or duplicate id, a progress that
  // is not a finite number >= 0, or a condition outside [0,100]. A view presents the stored value or one derived from it,
  // and derivation clamps (progress to [0,1], condition to [55,100]), so a fleet whose stored values all pass (per class of
  // rows, at each class's extremes) and whose ids are present and unique adds nothing. Otherwise the per-asset loop runs
  // and reports exactly as before.
  function fleetAssetsHealthy(state,fleet){
    if(fleet.mode?.(state)!=='store'||typeof fleet.forEachFieldClasses!=='function'||typeof fleet.idCollisions!=='function')return false;
    const ids=fleet.idCollisions(state);if(ids.duplicate||ids.missing)return false;
    let healthy=true;
    fleet.forEachFieldClasses(state,['id','progress','condition'],row=>{
      if(!healthy)return;
      // The loop compares String(id): only non-empty string ids are compared the same way by idCollisions.
      if(typeof row.id!=='string'||row.id===''){healthy=false;return;}
      if(row.progress!=null&&(!finiteNumber(Number(row.progress))||Number(row.progress)<0))healthy=false;
      else if(row.condition!=null&&(!finiteNumber(Number(row.condition))||Number(row.condition)<0||Number(row.condition)>100))healthy=false;
    },{numeric:['progress','condition']});
    return healthy;
  }
  function assetIssues(state,fleet){
    const out=[],add=(...row)=>out.push(row);
    if(fleetAssetsHealthy(state,fleet))return out;
    const assetIds=new Set(),dupAssets=[];
    fleet.forEach(state,a=>{
      if(!a||typeof a!=='object'){add('ASSET_INVALID_RECORD','critical','سجل أصل تالف','يوجد عنصر غير صالح داخل state.assets.','assets');return;}
      const id=String(a.id||'');if(!id)add('ASSET_ID_MISSING','critical','أصل بلا معرف','كل أصل يجب أن يملك ID ثابتًا.','assets',{name:a.name,type:a.type});
      else if(assetIds.has(id))dupAssets.push(id);else assetIds.add(id);
      if(a.progress!=null&&(!finiteNumber(Number(a.progress))||Number(a.progress)<0))add('ASSET_PROGRESS_INVALID','warning','تقدم أصل غير صالح',`الأصل ${id||a.name||'؟'} يحمل progress غير صالح.`,'assets',{id,progress:a.progress});
      if(a.condition!=null&&(!finiteNumber(Number(a.condition))||Number(a.condition)<0||Number(a.condition)>100))add('ASSET_CONDITION_INVALID','warning','حالة أصل خارج النطاق',`Condition يجب أن تكون بين 0 و100.`,'assets',{id,condition:a.condition});
    });
    if(dupAssets.length)add('ASSET_DUPLICATE_IDS','critical','معرفات أصول مكررة','تكرار ID قد يسبب overwrite أو بيع/توجيه الأصل الخطأ.','assets',{ids:[...new Set(dupAssets)].slice(0,20)});
    return out;
  }
  const API=Object.freeze({VERSION,assetIssues,fleetAssetsHealthy});
  globalThis.GH_FLEET_HEALTH=API;
  if(globalThis.window&&globalThis.window!==globalThis)globalThis.window.GH_FLEET_HEALTH=API;
  if(typeof module!=='undefined'&&module.exports)module.exports=API;
})();

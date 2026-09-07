(()=>{'use strict';const VERSION='2.9.0';
function normalizeAsset(asset,context={}){
    const tpl = context.route;
    if(tpl){
      asset.distanceKm = tpl.distanceKm;
      asset.tripSeconds = tpl.tripSeconds;
      asset.effectiveSpeedKmh = tpl.effectiveSpeedKmh;
      asset.dwellHours = tpl.dwellHours;
      asset.from = asset.reverse ? tpl.to : tpl.from;
      asset.to = asset.reverse ? tpl.from : tpl.to;
    }
    if(!asset.phase)asset.phase = asset.routeId ? 'moving' : 'idle';
    if(typeof asset.progress !== 'number')asset.progress = 0;
    if(typeof asset.fuel !== 'number')asset.fuel = 100;
    if(typeof asset.condition !== 'number')asset.condition = 100;
    if(!asset.specs){ const item=context.catalogItem; if(item)asset.specs=JSON.parse(JSON.stringify(item.specs)); }
    if(tpl && asset.specs){
      const rated = asset.type==='air' ? (asset.specs.speedKmh||tpl.effectiveSpeedKmh)*.9
        : asset.type==='sea' ? (asset.specs.speedKn||tpl.effectiveSpeedKmh/1.852)*1.852*.88
        : (asset.specs.speedKmh||tpl.effectiveSpeedKmh)*.76;
      asset.effectiveSpeedKmh=Math.max(20,Math.min(rated,tpl.effectiveSpeedKmh*1.08));
      asset.tripSeconds=asset.distanceKm/asset.effectiveSpeedKmh*3600;
    }

return asset;
}
function departDraft(asset,route,{crewReady,load}={}){
 if(asset.phase!=='turnaround')throw new Error('asset-not-ready-to-depart');
 if(!route||route.id!==asset.routeId||route.type!==asset.type||![route.fromFacility,route.toFacility].includes(asset.baseFacility))throw new Error('route-departure-contract');
 if(crewReady!==true)throw new Error('crew-not-ready');
 asset.reverse=asset.baseFacility===route.toFacility;asset.phase='moving';asset.progress=0;asset.dwellRemaining=0;asset.fuel=100;asset.crewBlocked=false;
 asset.from=asset.reverse?route.to:route.from;asset.to=asset.reverse?route.from:route.to;if(load!=null)asset.load=load;return asset;
}
function ensure(s){s.assets=Array.isArray(s.assets)?s.assets:[];return s.assets;}
function find(s,id){return ensure(s).find(a=>a.id===id)||null;}
function validate(ctx,cmd,p){const s=ctx.state||ctx,a=p.id?find(s,p.id):null;if(['service','assign-route','depart','request-sale','finalize-sale','return-lease','sell'].includes(cmd)&&!a)return {ok:false,reason:'asset-not-found'};if(cmd==='service'&&a.phase==='moving')return {ok:false,reason:'asset-moving'};return true;}
function execute(ctx,cmd,p){const s=ctx.state||ctx,a=p.id?find(s,p.id):null;if(cmd==='service'){if(Number(p.cost)>0){const F=globalThis.GH_FINANCE_CORE;if(!F?.execute)throw new Error('finance-core-missing');F.execute({state:s},'spend',{company:a.type,amount:Number(p.cost),note:p.note||`صيانة ${a.name}`,line:'maintenance'});}a.fuel=100;a.condition=Math.min(100,(Number(a.condition)||0)+Math.max(1,Number(p.conditionGain)||6));a.lastMaintenanceAt=Number(s.simSeconds)||0;return a;}
if(cmd==='assign-route'){if(!p.route||p.route.id!==p.routeId||p.route.type!==a.type||a.phase==='moving'||(p.phase!=null&&p.phase!=='turnaround')||(p.baseFacility!=null&&p.baseFacility!==a.baseFacility)||![p.route.fromFacility,p.route.toFacility].includes(a.baseFacility))throw new Error('route-assignment-contract');a.routeId=p.routeId||null;a.baseFacility=p.baseFacility??a.baseFacility;a.phase=p.phase||'turnaround';a.progress=0;a.dwellRemaining=0;if(p.route){const reverse=a.baseFacility===p.route.toFacility;a.reverse=reverse;a.from=reverse?p.route.to:p.route.from;a.to=reverse?p.route.from:p.route.to;}return a;}
if(cmd==='depart'){const hr=globalThis.GH_HR_CORE;return departDraft(a,p.route,{crewReady:!!hr?.snapshot&&hr.snapshot(s,ctx,a.type).crewMissing===0,load:p.load});}
if(cmd==='request-sale'){a.salePending=true;a.saleRequestedAt=Number(s.simSeconds)||0;a.saleReturnMode=p.returnMode||'owned-center';a.saleStatus=a.phase==='moving'?'finish-current-trip':'returning';if(a.phase!=='moving'&&p.clearRoute){a.routeId=null;a.phase=p.phase||'idle';a.progress=0;a.dwellRemaining=0;}else if(a.phase!=='moving'&&p.departSoon)a.dwellRemaining=0;return a;}
if(cmd==='finalize-sale'){if(a.phase==='moving')throw new Error('asset-moving');const idx=s.assets.findIndex(x=>x.id===a.id);if(idx<0)return false;s.assets.splice(idx,1);return a;}
if(cmd==='return-lease'){if(a.phase==='moving')throw new Error('asset-moving');const fee=Math.max(0,Number(p.fee)||0);if(fee&&!globalThis.GH_FINANCE_CORE?.execute)throw new Error('finance-core-missing');if(fee)globalThis.GH_FINANCE_CORE.execute({state:s},'spend',{company:a.type,amount:fee,note:`رسوم إنهاء تأجير ${a.name}`,method:'تحويل بنكي',taxable:false,line:'capex'});s.leasedAssets=Array.isArray(s.leasedAssets)?s.leasedAssets:[];s.leasedAssets=s.leasedAssets.filter(x=>x!==a.id);const idx=s.assets.findIndex(x=>x.id===a.id);if(idx<0)throw new Error('asset-not-found');s.assets.splice(idx,1);return {asset:a,fee};}
if(cmd==='sell'){if(a.phase==='moving')throw new Error('asset-moving');const proceeds=Math.max(0,Number(p.proceeds)||0);if(proceeds<=0)throw new Error('invalid-sale-proceeds');if(!globalThis.GH_FINANCE_CORE?.execute)throw new Error('finance-core-missing');globalThis.GH_FINANCE_CORE.execute({state:s},'credit',{company:a.type,amount:proceeds,note:`بيع أصل ${a.name}`,method:'تحويل مشتري',taxable:false,counterparty:p.buyer||'مشتري أصل'});const idx=s.assets.findIndex(x=>x.id===a.id);if(idx<0)throw new Error('asset-not-found');s.assets.splice(idx,1);const C=globalThis.GH_CORPORATE_CORE;if(!C?.execute)throw new Error('corporate-core-missing');C.execute({state:s},'adjust-group-value',{delta:-proceeds*.18});return {asset:a,proceeds};}
if(cmd==='remap-routes'){for(const a of s.assets||[])if(p.redirect?.[a.routeId])a.routeId=p.redirect[a.routeId];return {remapped:true};}
if(cmd==='record-delivery'){
 if(!p.asset||!p.baseId||!p.deliveryId)throw new Error('delivery-contract');
 const d=s.realism?.procurement?.deliveries?.find(x=>x.id===p.deliveryId),base=[...(s.globalBases||[]),...(s.customHubs||[])].find(f=>f.id===p.baseId);
 if(!d||d.status!=='pending'||d.asset?.id!==p.asset.id||d.baseId!==p.baseId||!base?.owned||base.company!==p.asset.type)throw new Error('delivery-destination-contract');
 const pay=d.payment,doc=pay?.kind==='invoice'?s.finance?.invoices?.find(x=>x.number===pay.ref):s.finance?.cheques?.find(x=>x.id===pay?.ref);
 if(!doc||!['مدفوعة','مسددة','مصروف'].includes(doc.status)||doc.company!==p.asset.type||Number(doc.amount)<Number(pay.amount))throw new Error('delivery-payment-unverified');
 const cap=Number(s.advanced?.facilities?.[p.baseId]?.capacity)||(['airport-base'].includes(base.kind)?24:base.kind==='port-base'?18:Number(base.bays)||42);
 if((s.assets||[]).filter(x=>x.baseFacility===p.baseId).length>=cap)throw new Error('delivery-base-full');
const asset={...p.asset,deliveryOrderId:p.deliveryId,requestRef:d.requestRef,paymentRef:pay.ref,baseFacility:p.baseId,phase:p.phase||'idle',routeId:null,progress:0,fuel:100,deliveryStatus:'delivered',deliveredDay:p.deliveredDay,deliveredAtSeconds:p.deliveredAtSeconds};if(s.assets.some(x=>x.id===asset.id))throw new Error('duplicate-asset-id');s.assets.push(asset);if(asset.ownership==='lease'){s.leasedAssets=Array.isArray(s.leasedAssets)?s.leasedAssets:[];if(!s.leasedAssets.includes(asset.id))s.leasedAssets.push(asset.id);}return asset;}
throw new Error(`Unknown fleet command: ${cmd}`);}
const API={VERSION,normalizeAsset,departDraft,ensure,find,validate,execute};globalThis.GH_FLEET_CORE=API;globalThis.GH_DOMAIN_COMMANDS?.register?.('fleet',API);if(globalThis.window&&window!==globalThis)window.GH_FLEET_CORE=API;})();

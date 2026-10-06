'use strict';
// Build 358 regression: the shared international dispatch for air and sea fleets
// must assign every eligible asset to a route when the fleet lives in the store.
// Build 357 validated each preview route by writing canonical fields onto the
// asset; store assets are read-only views, so the write threw
// fleet-view-read-only and the whole bulk departure rolled back.
const assert=require('node:assert/strict');
const {chromium}=require('playwright'),{boot}=require('./helpers/local-dom-app');

const PLAN=[
  {type:'air',facilityKind:'airport-base',qty:24,site:'OMDB'},
  {type:'sea',facilityKind:'port-base',qty:12,site:null}
];
(async()=>{
  const browser=await chromium.launch({headless:true}),errors=[];
  try{
    const {page}=await boot({browser,errors});
    for(const row of PLAN){
      const prepared=await page.evaluate(async({type,facilityKind,qty,site})=>{
        const a=__AUDIT__,s=()=>__GH_STATE__,WORLD=GH_WORLD_DATA;
        const definition=GH_COMPANY_PLATFORM.definitionFor(s(),type);
        if(!s().openedCompanies.includes(type))await a.runAuthorizedDomainCommand('corporate','open-company',{type,companyId:type,capital:Math.max(400000000,definition.founding.minimumCapital),legalName:`QA Dispatch ${type}`,formationContract:`QA-DISPATCH-${type.toUpperCase()}`},{silent:true});
        let facility;
        if(type==='air'){
          const airport=WORLD.airports.find(r=>r[0]===site);
          facility={id:`QA-${type}-${airport[0]}`,name:`QA Airport ${airport[0]}`,kind:facilityKind,company:type,ownerCompanyId:type,owned:true,sourceKey:`air:${airport[0]}`,code:airport[1]||airport[0],icao:airport[0],iata:airport[1],city:airport[3]||airport[4]||'—',country:String(airport[5]||'—'),coords:[airport[6],airport[7]]};
        }else{
          const port=WORLD.ports.find(r=>Number.isFinite(Number(r[3]))&&Number.isFinite(Number(r[4])));
          facility={id:`QA-${type}-PORT`,name:`QA Port ${port[0]}`,kind:facilityKind,company:type,ownerCompanyId:type,owned:true,sourceKey:`port:${port[0]}:${port[3]}:${port[4]}`,code:String(port[0]).slice(0,5),city:String(port[1]||port[0]),country:String(port[2]||'—'),coords:[port[3],port[4]]};
        }
        await a.runAuthorizedDomainCommand('facilities','create',{facility,bucket:'globalBases'},{silent:true});
        const model=[...GH_ASSET_CATALOG[type].used].sort((x,y)=>(x.leaseMonthly||0)-(y.leaseMonthly||0)||x.price-y.price)[0];
        const order=await a.buyAsset(type,'used',model.id,'lease',qty,facility.id,true,`QA-DISPATCH-${type}-${qty}`,type);
        const owned=GH_FLEET_DATA.filter(s(),asset=>(asset.ownerCompanyId||asset.companyId)===type);
        return {order:!!order,mode:GH_FLEET_DATA.mode(s()),owned:owned.length,routed:owned.filter(asset=>asset.routeId).length};
      },row);
      assert.equal(prepared.order,true,`${row.type}: purchase rejected`);
      assert.equal(prepared.mode,'store',`${row.type}: fleet must run in store mode`);
      assert.equal(prepared.owned,row.qty,`${row.type}: delivered assets`);
      assert.equal(prepared.routed,0,`${row.type}: assets start without routes`);

      await page.evaluate(type=>__AUDIT__.openDrawer('routes',type),row.type);
      const button=page.locator(`.dispatch-international-network[data-company="${row.type}"]`).first();
      await button.waitFor({state:'visible',timeout:30000});await button.click();
      let status=null;
      for(let i=0;i<120;i++){
        status=await page.evaluate(type=>{const owned=GH_FLEET_DATA.filter(__GH_STATE__,asset=>(asset.ownerCompanyId||asset.companyId)===type);return {owned:owned.length,routed:owned.filter(asset=>asset.routeId).length,underway:owned.filter(asset=>asset.phase==='moving'||asset.departureScheduled).length,alerts:(__GH_STATE__.alerts||[]).slice(0,3).map(r=>String(r.text||r))};},row.type);
        if(status.routed===status.owned)break;
        await page.waitForTimeout(250);
      }
      // Build 359: the dispatch assigns in chunks, so the routes show before the command ends; it reopens the routes panel
      // when it commits. Wait for that before the next panel.
      await page.waitForFunction(()=>!window.__GH_DURABLE_COMMAND_CONTEXT__&&!GH_PERSISTENCE.isLocked(),null,{timeout:180000});await page.evaluate(()=>GH_PERSISTENCE.drain());
      assert(!status.alerts.some(text=>/fleet-view-read-only|أُلغي الأمر بالكامل/.test(text)),`${row.type}: dispatch rolled back: ${JSON.stringify(status.alerts)}`);
      assert.equal(status.routed,row.qty,`${row.type}: every asset must receive a route: ${JSON.stringify(status)}`);
      assert.equal(status.underway,row.qty,`${row.type}: every asset must depart or hold a departure slot: ${JSON.stringify(status)}`);
      console.log(`${row.type}: ${status.routed}/${status.owned} routed, ${status.underway} underway`);
    }
    assert.deepEqual(errors,[]);
    console.log('BUILD358_AIR_SEA_DISPATCH_PASS');
  }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});

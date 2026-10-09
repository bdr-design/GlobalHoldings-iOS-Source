'use strict';
const assert=require('node:assert/strict');
const {chromium}=require('playwright');
const {boot}=require('./helpers/local-dom-app');

(async()=>{
  const browser=await chromium.launch({headless:true}),errors=[];
  try{
    const {page}=await boot({browser,errors,viewport:{width:1100,height:700}});
    const result=await page.evaluate(()=>{
      const a=__AUDIT__,s=a.state(),map=a.leafletMap();
      s.customHubs=s.customHubs||[];
      s.customHubs.push({id:'QA-MOB-CENTER',ownerCompanyId:'mobility',kind:'mobility-center',owned:true,capitalId:'RUH',name:'فرع التنقل · الرياض',city:'الرياض',country:'السعودية',coords:[24.7,46.7]});
      let guard=false,vehicleRows=[{id:'QA-MOB-VEHICLE',ownerCompanyId:'mobility',centerId:'RUH',status:'moving',coords:[24.71,46.71],route:[[24.7,46.7],[24.71,46.71]],tripId:'QA-MOB-TRIP'}];
      const guardedVehicles=new Proxy(vehicleRows,{get(target,key,receiver){if(guard&&key==='length')throw new Error('map-render-read-mobility-vehicles');return Reflect.get(target,key,receiver);}});
      s.mobility={vehicles:guardedVehicles,activeTrips:[{id:'QA-MOB-TRIP',vehicleId:'QA-MOB-VEHICLE',route:[[24.7,46.7],[24.71,46.71]],routeVerified:true}],capitalCenters:[{id:'QA-MOB-CENTER',facilityId:'QA-MOB-CENTER',capitalId:'RUH',city:'الرياض'}]};
      guard=true;a.setSelectedMobility('QA-MOB-VEHICLE');a.setMapMode('operations');map.setView([24.7,46.7],10);a.renderMap();a.updateMarkerPositions(true);const metrics=a.mapMetrics();guard=false;
      a.clickFacilityMarker('QA-MOB-CENTER');
      return {metrics,panel:a.currentPanel(),arg:a.currentArg()};
    });
    assert.equal(result.metrics.mobilityIds.length,0,'no mobility vehicle ids are rendered, even when one is selected');
    assert.equal(result.metrics.mobilityDomMarkers,0,'no mobility vehicle DOM marker is drawn');
    assert.equal(result.metrics.routeLines,0,'mobility routes are not drawn');
    assert.ok(result.metrics.facilityKeys.includes('QA-MOB-CENTER'),`the owned city branch remains on the map: ${JSON.stringify(result.metrics)}`);
    assert.equal(result.panel,'facilityManage','the branch marker opens facility management');
    assert.equal(result.arg.id,'QA-MOB-CENTER','the selected panel is the mobility branch');
    assert.deepEqual(errors,[]);
    console.log(JSON.stringify({suite:'build366-mobility-map-policy-browser',mobilityMarkers:result.metrics.mobilityIds.length,routeLines:result.metrics.routeLines,branchVisible:true,branchPanel:result.panel}));
  }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});

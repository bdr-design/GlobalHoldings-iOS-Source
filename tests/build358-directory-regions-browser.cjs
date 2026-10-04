'use strict';
// Build 358, from play: opening a facility listed one part of the world first (registry order), so reaching another
// country or continent needed a search. The unfiltered list now takes one site per country in turn, with regions
// alternating (main sites still first), and a region filter (Middle East, North America, South America, Europe, Asia,
// Africa, Oceania) narrows the list and its countries.
const assert=require('node:assert/strict');
const {chromium}=require('playwright'),{boot}=require('./helpers/local-dom-app');
(async()=>{
  const browser=await chromium.launch({headless:true}),errors=[];
  try{
    const {page}=await boot({browser,errors});
    const out=await page.evaluate(()=>{
      const W=GH_WORLD_DATA,D=GH_DIRECTORY_CORE,index=D.create({airports:W.airports,ports:W.ports,capitals:GH_MOBILITY_CORE.CAPITALS}),s=__GH_STATE__;
      const first=(options)=>index.search({state:s,page:0,pageSize:24,...options});
      const air=first({company:'air'}),sea=first({company:'sea'}),regionOf=new Map(air.countries.map(c=>[c.id,c.region])),seaRegionOf=new Map(sea.countries.map(c=>[c.id,c.region]));
      const summary=(result,map)=>({countries:new Set(result.rows.map(r=>r.countryId)).size,regions:new Set(result.rows.map(r=>map.get(r.countryId))).size,coded:result.rows.every(r=>r.iata||!r.icao),total:result.total});
      const byRegion={};for(const region of D.REGIONS){const r=first({company:'air',region:region.id});byRegion[region.id]={total:r.total,inRegion:r.rows.every(row=>regionOf.get(row.countryId)===region.id),countriesInRegion:r.countries.every(c=>c.region===region.id),countries:r.countries.length,rows:r.rows.length,firstCoded:r.rows.slice(0,4).every(row=>row.iata)};}
      const sum=D.REGIONS.reduce((n,region)=>n+byRegion[region.id].total,0);
      const saudi=first({company:'air',country:'SA',pageSize:4}).rows.map(r=>r.iata),bogus=first({company:'air',region:'nowhere'});
      const middleEast=first({company:'air',region:'middle-east'}).countries.map(c=>c.id);
      return {regions:air.regions.map(r=>r.id),air:summary(air,regionOf),sea:summary(sea,seaRegionOf),byRegion,sum,airTotal:air.total,saudi,bogusTotal:bogus.total,bogusRegion:bogus.region,middleEast};
    });
    assert.deepEqual(out.regions,['middle-east','europe','asia','north-america','africa','south-america','oceania'],'seven regions');
    assert.ok(out.air.countries>=20,`the first page spans countries: ${JSON.stringify(out.air)}`);
    assert.equal(out.air.regions,7,'the first page spans every region');
    assert.ok(out.air.coded,'the first page still holds coded airports');
    assert.ok(out.sea.countries>=20&&out.sea.regions>=6,`ports too: ${JSON.stringify(out.sea)}`);
    for(const [id,row] of Object.entries(out.byRegion)){
      assert.ok(row.total>0&&row.rows>0,`${id} lists sites`);assert.ok(row.inRegion,`${id}: every row in the region`);
      assert.ok(row.countriesInRegion&&row.countries>0,`${id}: the country list is the region's`);assert.ok(row.firstCoded,`${id}: main airports first`);
    }
    assert.equal(out.sum,out.airTotal,'the regions partition the directory');
    assert.ok(['SA','AE','EG','TR','IR'].every(code=>out.middleEast.includes(code)),'Middle East countries');
    assert.ok(out.saudi.every(Boolean),'a country keeps its main airports first');
    assert.equal(out.bogusRegion,'');assert.equal(out.bogusTotal,out.airTotal,'an unknown region is ignored');

    // The drawer: the region select narrows the list and the country select.
    await page.evaluate(()=>__AUDIT__.openDrawer('network'));await page.locator('#worldKind').selectOption('air');
    const select=page.locator('#worldRegion');await select.waitFor({state:'visible',timeout:30000});
    await select.selectOption('europe');
    await page.waitForFunction(()=>document.querySelector('#worldRegion')?.value==='europe');
    const drawer=await page.evaluate(()=>({countries:[...document.querySelectorAll('#worldCountry option')].map(o=>o.value).filter(Boolean)}));
    assert.ok(drawer.countries.includes('FR')&&drawer.countries.includes('DE')&&!drawer.countries.includes('US')&&!drawer.countries.includes('SA'),`the country select holds Europe only: ${drawer.countries.length}`);
    assert.deepEqual(errors,[]);
    console.log(JSON.stringify({suite:'build358-directory-regions-browser',air:out.air,sea:out.sea,europeCountries:drawer.countries.length}));
    console.log('BUILD358_DIRECTORY_REGIONS_PASS');
  }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});

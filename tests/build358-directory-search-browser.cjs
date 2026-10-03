'use strict';
// Build 358: opening a facility from the world directory. Reported from play: searching found nothing for Arabic city
// names (الرياض, جدة, دبي, لندن, القاهرة), an airport code like RUH listed German airfields before Riyadh, and a country
// listed small airfields before its international airports. Now: sites near a capital or a listed major city are found
// by its Arabic name, an exact IATA/ICAO code ranks first, and main sites (hubs, international, coded airports; ports
// with a terminal) come first.
const assert=require('node:assert/strict');
const {chromium}=require('playwright'),{boot}=require('./helpers/local-dom-app');
(async()=>{
  const browser=await chromium.launch({headless:true}),errors=[];
  try{
    const {page}=await boot({browser,errors});
    const out=await page.evaluate(()=>{
      const W=GH_WORLD_DATA,index=GH_DIRECTORY_CORE.create({airports:W.airports,ports:W.ports,capitals:GH_MOBILITY_CORE.CAPITALS}),s=__GH_STATE__;
      const first=(text,company='air')=>{const r=index.search({state:s,company,text,page:0,pageSize:5});return {total:r.total,codes:r.rows.map(row=>row.icao||row.code)};};
      const browse=index.search({state:s,company:'air',country:'SA',page:0,pageSize:6}).rows.map(row=>({icao:row.icao,iata:row.iata,name:row.name}));
      const unfiltered=index.search({state:s,company:'air',page:0,pageSize:12}).rows.map(row=>row.iata);
      const sea=index.search({state:s,company:'sea',page:0,pageSize:24});
      return {riyadh:first('الرياض'),ruh:first('RUH'),oerk:first('OERK'),jeddah:first('جدة'),dubai:first('دبي'),cairo:first('القاهرة'),london:first('لندن'),america:first('امريكا'),browse,unfiltered,seaCountriesEnglish:sea.countries.filter(c=>!/[؀-ۿ]/.test(c.label)).map(c=>c.label),seaTerminalFirst:sea.rows.every(row=>row.terminal)};
    });
    assert.equal(out.riyadh.codes[0],'OERK','الرياض finds King Khalid first');
    assert.equal(out.ruh.codes[0],'OERK','the code RUH ranks Riyadh first');assert.equal(out.oerk.codes[0],'OERK');
    assert.equal(out.jeddah.codes[0],'OEJN','جدة finds King Abdulaziz');
    assert.equal(out.dubai.codes[0],'OMDB','دبي finds Dubai International');
    assert.equal(out.cairo.codes[0],'HECA','القاهرة finds Cairo International');
    assert.ok(out.london.codes.slice(0,2).some(code=>['EGLL','EGKK'].includes(code)),`لندن finds Heathrow or Gatwick first: ${out.london.codes}`);
    assert.ok(out.america.total>10000,'امريكا matches the United States');
    assert.ok(out.browse.slice(0,4).every(row=>row.iata),`a country lists its coded airports first: ${JSON.stringify(out.browse)}`);
    assert.ok(out.unfiltered.every(Boolean),'the first page of all airports holds coded airports');
    assert.deepEqual(out.seaCountriesEnglish,[],'every port country is named in Arabic');
    assert.equal(out.seaTerminalFirst,true,'ports with a terminal come first');
    assert.deepEqual(errors,[]);
    console.log(JSON.stringify({suite:'build358-directory-search-browser',riyadh:out.riyadh.codes.slice(0,3),dubai:out.dubai.codes.slice(0,3),london:out.london.codes.slice(0,3)}));
    console.log('BUILD358_DIRECTORY_SEARCH_PASS');
  }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});

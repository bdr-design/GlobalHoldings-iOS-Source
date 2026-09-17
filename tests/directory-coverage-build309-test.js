'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const path=require('node:path');
const directory=require('../WebApp/directory-core.js');
const capitals=require('../WebApp/mobility-core.js').CAPITALS;
const context={window:{}};
vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../WebApp/world-data.js'),'utf8'),context);
const world=context.window.GH_WORLD_DATA;
const before=JSON.stringify({world,capitals});
const index=directory.create({airports:world.airports,ports:world.ports,capitals});
assert.equal(index.stats.companies.air.sites,28291);
assert.equal(index.stats.companies.air.countries,234);
assert.equal(index.stats.companies.sea.sites,3930);
for(const company of ['road','power','bank','mobility'])assert.equal(index.stats.companies[company].sites,189);

// Arabic searches must find every eligible sector and retain precise source keys.
for(const company of directory.COMPANIES){
  const found=index.search({company,text:'السُّعُودِيَّة'});
  assert(found.total>0,`${company} Arabic country search must be supported`);
  assert(found.rows.every(row=>row.company===company&&row.countryId==='SA'));
  assert(found.countries.some(row=>row.id==='SA'));
}
assert(index.search({company:'air',text:'OMDB'}).rows.some(row=>row.key==='air:OMDB'));
assert(index.search({company:'sea',text:'SGSIN'}).rows.some(row=>row.key.startsWith('port:SGSIN:')));
assert.equal(directory.normalize('إمَارَات'),directory.normalize('امارات'));
assert.equal(index.countryMetadata('United arab emirates').id,'AE');
assert.equal(index.countryMetadata('الإمارات').id,'AE');
assert.equal(index.countryMetadata('المملكة المتحدة').id,'GB');
assert.equal(index.countryMetadata('روسيا').id,'RU');
assert.equal(index.countryMetadata('الكونغو الديمقراطية').id,'CD');

// A paged browse must expose every city, with no leakage when changing companies/countries.
for(const company of ['road','power','bank','mobility']){
  const seen=new Set(),first=index.search({company});
  assert.equal(first.pages,8);
  for(let page=0;page<first.pages;page++){
    const result=index.search({company,page,pageSize:1000});
    assert(result.rows.length<=24);
    for(const row of result.rows){assert.equal(row.company,company);assert(!seen.has(row.key));seen.add(row.key);}
  }
  assert.equal(seen.size,189);
  for(const capital of capitals)assert(seen.has(`site:${company}:${capital.id}`));
}
for(const company of ['air','sea']){
  const first=index.search({company}),seen=new Set();
  for(let page=0;page<first.pages;page++)for(const row of index.search({company,page}).rows){assert(!seen.has(row.key));seen.add(row.key);}
  assert.equal(seen.size,index.stats.companies[company].sites);
}
const ae=index.search({company:'road',country:'AE',text:'does-not-exist'});
assert.equal(ae.total,0);
assert.equal(ae.cities.length,1);
assert.equal(ae.cities[0].label,'أبوظبي');
assert.equal(ae.countries.length,189);
assert.equal(index.search({company:'road',country:'AE',city:index.search({company:'road',country:'SA'}).cities[0].id}).total,0);
assert.equal(index.search({company:'road',page:999}).page,7);
assert.equal(index.search({company:'air'}).cities.length,index.stats.companies.air.cities,'callers can still request every city without selecting a country');
assert.deepEqual(index.search({company:'sea',country:'SA'}).cities,index.search({company:'sea',country:'SA',text:'missing'}).cities,'city options remain independent of the current text search');

// Known prefix/source-country mismatches must never move a port into another country.
const mismatched=world.ports.filter(row=>row[2]==='Ireland'&&row[0].startsWith('ID'));
assert(mismatched.length>0);
for(const port of mismatched){const found=index.search({company:'sea',text:port[0]});assert(found.rows.some(row=>row.key===`port:${port[0]}:${port[3]}:${port[4]}`&&row.countryId==='IE'));}
assert(index.countryMetadata('Somaliland').id.startsWith('native:'));
assert.equal(JSON.stringify({world,capitals}),before,'index construction and repeated searches must not modify the source registry');
assert.throws(()=>directory.create({airports:[world.airports[0],world.airports[0]]}),/directory-duplicate-key/);
console.log('BUILD309 directory coverage, country identity, isolation, paging and pure reads: PASS');

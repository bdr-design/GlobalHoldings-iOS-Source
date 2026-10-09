'use strict';
const assert=require('assert/strict'),fs=require('fs'),path=require('path');
const root=path.resolve(__dirname,'..'),web=path.join(root,'WebApp');
require(path.join(web,'capability-registry-core.js'));
require(path.join(web,'company-definitions.js'));
require(path.join(web,'company-platform-core.js'));
delete require.cache[require.resolve(path.join(web,'identity-system.js'))];
const identity=require(path.join(web,'identity-system.js'));
assert.equal(identity.VERSION,'GH-IDENTITY-334.2.0');
// Build 358: a player-named group brands its subsidiaries; a former stock or legacy name follows the group.
const expected={
 air:['PGRP AIR','شركة اللاعب الخاصة للطيران'],
 sea:['PGRP MARINE','شركة اللاعب الخاصة للشحن البحري'],
 road:['PGRP LOGISTICS','شركة اللاعب الخاصة للنقل'],
 power:['PGRP ENERGY','شركة اللاعب الخاصة للطاقة'],
 bank:['PGRP BANK','شركة اللاعب الخاصة المصرفية'],
 mobility:['PGRP MOBILITY','شركة اللاعب الخاصة للتنقل الذكي']
};
const legacy={air:'الشركة العالمية للطيران',sea:'الشركة العالمية للشحن البحري',road:'اللوجستيات العالمية',power:'شركة الطاقة العالمية',bank:'بنك المجموعة',mobility:'GH Mobility للتنقل الذكي'};
const customLogo='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';
const state={profile:{name:'مجموعة اللاعب الخاصة',shortName:'PGRP'},companyRegistry:{}};
for(const [type,name] of Object.entries(legacy))state.companyRegistry[type]={legalName:name};
for(const [type,[short,legal]] of Object.entries(expected)){
 assert.equal(identity.shortName(state,type),short,`${type} short identity`);
 assert.equal(identity.legalName(state,type),legal,`${type} legacy default maps to the central Build 334 legal identity`);
 const symbol=identity.resolve(state,type,{usage:'symbol'}).logo,horizontal=identity.resolve(state,type,{usage:'horizontal'}).logo;
 assert.equal(symbol,`assets/identity/approved/${({air:'air',sea:'sea',road:'road',power:'power',bank:'bank',mobility:'mobility'})[type]}-symbol.webp`,`${type} uses its approved independent symbol`);
 assert.equal(horizontal,`assets/identity/approved/${({air:'air',sea:'sea',road:'road',power:'power',bank:'bank',mobility:'mobility'})[type]}-horizontal.webp`,`${type} uses its approved horizontal lockup`);
}
assert.equal(identity.legalName(state,'group'),'مجموعة اللاعب الخاصة');
assert.equal(identity.shortName(state,'group'),'PGRP');
assert.equal(identity.resolve(state,'group',{usage:'symbol'}).logo,'assets/identity/approved/group-symbol.webp');
state.profile.logo=customLogo;assert.equal(identity.logo(state,'group'),customLogo,'the player group upload overrides its approved default');
state.companyRegistry.air={legalName:'شركة سماوات اللاعب',shortName:'SKY-X',logo:customLogo,customName:true};
assert.equal(identity.legalName(state,'air'),'شركة سماوات اللاعب','custom company name must win');
assert.equal(identity.shortName(state,'air'),'SKY-X','custom company short name must win');
assert.equal(identity.logo(state,'air'),customLogo,'custom company logo must win');
assert.match(identity.logoMarkup(state,'air'),/data-custom="true"/);
const approved=['group','air','sea','road','power','bank','mobility','insurance','realestate','telecom','dealership'].flatMap(name=>[`${name}-symbol.webp`,`${name}-horizontal.webp`]).map(name=>`assets/identity/approved/${name}`);
for(const file of approved){const bytes=fs.readFileSync(path.join(web,file));assert(bytes.length>256,`${file} is a real visual asset`);assert.equal(bytes.toString('ascii',0,4),'RIFF',`${file} has WebP RIFF header`);assert.equal(bytes.toString('ascii',8,12),'WEBP',`${file} has WebP payload`);}
const runtime=JSON.parse(fs.readFileSync(path.join(web,'runtime-required.json'),'utf8')).files;
for(const file of ['identity-system.js',...approved])assert(runtime.includes(file),`${file} required at runtime`);
const html=fs.readFileSync(path.join(web,'index.html'),'utf8');
assert(html.indexOf('identity-system.js')>html.indexOf('catalog.js')&&html.indexOf('identity-system.js')<html.indexOf('finance-core.js'),'identity must load before feature renderers');
const layout=fs.readFileSync(path.join(web,'interface-layout.css'),'utf8');
assert.match(layout,/--header:38px/);assert.match(layout,/--rail:56px/);assert.match(layout,/\.game-frame\{[^}]*grid-template-columns:minmax\(0,1fr\) auto/);assert.doesNotMatch(layout,/orientation:portrait/);
const app=fs.readFileSync(path.join(web,'app.js'),'utf8');
const build=fs.readFileSync(path.join(root,'BUILD'),'utf8').trim();
assert(app.includes(`const RUNTIME_BUILD = ${build};`),`app runtime build must match source BUILD ${build}`);assert.match(app,/identityRouteColor/);
console.log('PASS Build 334 approved independent company identities, player customization precedence, runtime manifest and map colors');

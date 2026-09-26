'use strict';
const assert=require('assert/strict'),fs=require('fs'),path=require('path');
const root=path.resolve(__dirname,'..'),web=path.join(root,'WebApp');
delete require.cache[require.resolve(path.join(web,'identity-system.js'))];
const identity=require(path.join(web,'identity-system.js'));
assert.equal(identity.VERSION,'GH-IDENTITY-333.0.0');
const expected={
 air:['GH AIR','Global Holdings Aviation Company'],
 sea:['GH MARINE','Global Holdings Marine Shipping Company'],
 road:['GH LOGISTICS','Global Holdings Logistics Company'],
 power:['GH ENERGY','Global Holdings Energy Company'],
 bank:['GH BANK','Global Holdings Banking Company'],
 mobility:['GH MOBILITY','Global Holdings Smart Mobility Company']
};
const legacy={air:'الشركة العالمية للطيران',sea:'الشركة العالمية للشحن البحري',road:'اللوجستيات العالمية',power:'شركة الطاقة العالمية',bank:'بنك المجموعة',mobility:'GH Mobility للتنقل الذكي'};
const customLogo='data:image/png;base64,AA==';
const state={profile:{name:'مجموعة اللاعب الخاصة',shortName:'PGRP',logo:customLogo},companyRegistry:{}};
for(const [type,name] of Object.entries(legacy))state.companyRegistry[type]={legalName:name};
for(const [type,[short,legal]] of Object.entries(expected)){
 assert.equal(identity.shortName(state,type),short,`${type} short identity`);
 assert.equal(identity.legalName(state,type),legal,`${type} legacy default maps to Build 333 legal name`);
 assert.equal(identity.logo(state,type),`assets/identity/gh-${type==='sea'?'marine':type==='road'?'logistics':type==='power'?'energy':type}.svg`,`${type} vector logo`);
}
assert.equal(identity.legalName(state,'group'),'مجموعة اللاعب الخاصة');
assert.equal(identity.shortName(state,'group'),'PGRP');
assert.equal(identity.logo(state,'group'),customLogo);
state.companyRegistry.air={legalName:'شركة سماوات اللاعب',shortName:'SKY-X',logo:customLogo};
assert.equal(identity.legalName(state,'air'),'شركة سماوات اللاعب','custom company name must win');
assert.equal(identity.shortName(state,'air'),'SKY-X','custom company short name must win');
assert.equal(identity.logo(state,'air'),customLogo,'custom company logo must win');
assert.match(identity.logoMarkup(state,'air'),/data-custom="true"/);
for(const file of ['global-holdings.svg','group-default.svg','gh-air.svg','gh-marine.svg','gh-logistics.svg','gh-energy.svg','gh-bank.svg','gh-mobility.svg']){
 const body=fs.readFileSync(path.join(web,'assets/identity',file),'utf8');
 assert.match(body,/^<svg\b/);assert(!/<image\b/i.test(body),`${file} must remain vector-native`);
}
const runtime=JSON.parse(fs.readFileSync(path.join(web,'runtime-required.json'),'utf8')).files;
for(const file of ['identity-system.js',...['global-holdings.svg','group-default.svg','gh-air.svg','gh-marine.svg','gh-logistics.svg','gh-energy.svg','gh-bank.svg','gh-mobility.svg'].map(x=>'assets/identity/'+x)])assert(runtime.includes(file),`${file} required at runtime`);
const html=fs.readFileSync(path.join(web,'index.html'),'utf8');
assert(html.indexOf('identity-system.js')>html.indexOf('catalog.js')&&html.indexOf('identity-system.js')<html.indexOf('finance-core.js'),'identity must load before feature renderers');
const layout=fs.readFileSync(path.join(web,'interface-layout.css'),'utf8');
assert.match(layout,/--header:52px/);assert.match(layout,/--rail:48px/);
const app=fs.readFileSync(path.join(web,'app.js'),'utf8');
assert.match(app,/const RUNTIME_BUILD = 333/);assert.match(app,/identityRouteColor/);
console.log('PASS Build 333 central vector identity, six defaults, player customization precedence, runtime manifest and map colors');

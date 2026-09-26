'use strict';
const assert=require('node:assert/strict');
const {harness}=require('./helpers/core-harness');
const {s}=harness([]);
const port=['JED','Jeddah Islamic Port','Saudi Arabia',21.48,39.17,true];
s.GH_WORLD_DATA={airports:[],ports:[port]};
s.GH_COMPANY_PLATFORM={
  definitionFor(_state,id){if(id!=='sea')return null;return {capabilities:['finance.book','operations.fleet'],classification:{routeModes:['sea'],assetClasses:['vessel']},facilities:{primaryKind:'port-base',allowedKinds:['port-base'],directoryProviderIds:['world-ports']}};},
  getDefinition(id){return this.definitionFor(null,id);},
  requireCompany(_state,id){if(id!=='sea')throw Error('bad-company');return {id:'sea',operational:true};},
  ownerForLegacyAssetMode:m=>m,assetClassForLegacyMode:()=> 'vessel'
};
s.window=s;s.globalThis=s;require('node:vm').runInContext(require('node:fs').readFileSync(require('node:path').join(process.env.GH_TEST_SOURCE_DIR||require('node:path').resolve(__dirname,'..'),'WebApp/facility-core.js'),'utf8'),s);
const state={simSeconds:0,globalBases:[],customHubs:[],branches:[],advanced:{facilities:{}},energy:{},companyRegistry:{sea:{definitionId:'sea'}},openedCompanies:['sea']};
const facility={id:'SEA-JED-1',sourceKey:'port:JED:21.48:39.17',ownerCompanyId:'sea',kind:'port-base',owned:true,code:'JED',city:'Jeddah Islamic Port',country:'السعودية',coords:[21.48,39.17],terminal:true};
const verified=s.GH_FACILITY_CORE.verifyGlobalSite(facility,'sea',state);assert.equal(verified.code,'JED');assert.equal(verified.country,'Saudi Arabia');
const created=s.GH_FACILITY_CORE.execute({state},'create',{facility,bucket:'globalBases'});assert.equal(created.ownerCompanyId,'sea');assert.equal(created.kind,'port-base');assert.equal(state.globalBases.length,1);
assert.throws(()=>s.GH_FACILITY_CORE.verifyGlobalSite({...facility,code:'BAD'},'sea',state),/identity-invalid/,'real identity fields remain protected');
console.log(JSON.stringify({suite:'build335-sea-facility-country-identity',passed:3,total:3,created:created.id},null,2));

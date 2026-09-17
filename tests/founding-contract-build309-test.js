'use strict';
const assert=require('assert');
const {harness,minimal}=require('./helpers/core-harness');
const {s}=harness(['transaction-core','domain-command-core','finance-core','corporate-core','game-lifecycle-core']);
const L=s.GH_GAME_LIFECYCLE,input={name:'مجموعة الاختبار',founder:'المؤسس',shortName:'tgh',locationId:'LON',mode:'balanced'};
const fresh=()=>({...minimal(),onboardingComplete:false,profile:{},companyRegistry:{},groupValue:0});
for(const [mode,capital] of Object.entries(L.FOUNDING_CAPITALS)){
  const state=fresh(),out=L.foundGroup(state,{...input,mode},{},{nextId:()=> 'FOUND-1',simYear:()=>2026});
  assert.strictEqual(out.capital,capital);assert.strictEqual(state.cash,capital);assert.strictEqual(state.companyFinance.group.accounts[0].balance,capital);
  assert.strictEqual(state.finance.journalEntries.length,1);assert.strictEqual(state.companyRegistry.group.formationDocument.capital,capital);
  assert.strictEqual(state.profile.country,'المملكة المتحدة');assert.strictEqual(state.profile.city,'لندن');assert.strictEqual(state.profile.shortName,'TGH');assert.strictEqual(state.profile.currency,'USD');
  assert.deepStrictEqual(Array.from(state.openedCompanies),[]);assert.deepStrictEqual(Array.from(state.assets),[]);
  const before=JSON.stringify(state);assert.throws(()=>L.foundGroup(state,{...input,mode},{},{nextId:()=> 'FOUND-2'}),/already-founded/);assert.strictEqual(JSON.stringify(state),before);
  s.GH_CORPORATE_CORE.execute({state},'rename-company',{type:'group',legalName:'اسم جديد'});assert.strictEqual(state.companyRegistry.group.formationDocument.name,input.name,'signed founding identity is historical');
}
for(const location of L.FOUNDING_LOCATIONS){const prepared=L.prepareFounding({...input,locationId:location.id,country:'wrong',city:'wrong'});assert.strictEqual(prepared.country,location.country);assert.strictEqual(prepared.city,location.city);}
for(const patch of [{name:' '},{founder:' '},{name:'x'.repeat(43)},{shortName:'<X>'},{mode:'realistic'},{mode:'invalid'},{locationId:'MISSING'},{logo:'https://example.org/logo.png'}]){
  const state=fresh(),before=JSON.stringify(state);assert.throws(()=>L.foundGroup(state,{...input,...patch},{}));assert.strictEqual(JSON.stringify(state),before);
}
const failed=fresh(),before=JSON.stringify(failed);assert.throws(()=>L.foundGroup(failed,input,{},{nextId:()=> 'FOUND-1',onCommit:()=>{throw new Error('injected-save-failure');}}),/injected-save-failure/);assert.strictEqual(JSON.stringify(failed),before);
console.log('Founding contract: exact capital, location pairs, immutable record, validation, duplicate prevention and rollback PASS');

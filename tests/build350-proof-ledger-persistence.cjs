'use strict';
// Build 350: recurring saves use the verified-once ledger, and every 10th one is a FULL validation, so an in-place edit of an
// already verified proof record is found within ten saves. Loads/imports/slots always validate fully.
const assert=require('node:assert/strict');
const path=require('node:path');
const ROOT=process.env.GH_TEST_SOURCE_DIR||path.resolve(__dirname,'..');
process.env.GH_TEST_SOURCE_DIR=ROOT;
const {scenario}=require(path.join(ROOT,'tests/helpers/business-scenario'));

const e=scenario(),s=e.s,state=e.state;state.godMoney=true;state.infiniteMoney=true;state.advanced.facilities.B1.capacity=1e6;
const base=state.globalBases.find(x=>x.id==='B1');base.deliveryCapacity=1e6;const item=e.item;
for(let i=0;i<2;i++)e.command('procurement','purchase-assets',{type:'air',ownerCompanyId:'air',tab:'new',item,base,supplier:{id:'S1',name:'S',legalName:'S'},mode:'cash',qty:5,manual:true,requestRef:`MANUAL-L${i}`,upfront:item.price*5,totalPrice:item.price*5,paymentMethod:'x',documentLeadDays:1,leadSeconds:0,immediateDelivery:true});
e.load('state-codec-core');e.load('persistence-core');
const store=new Map();s.localStorage={getItem:k=>store.has(k)?store.get(k):null,setItem:(k,v)=>store.set(k,String(v)),removeItem:k=>store.delete(k),clear:()=>store.clear(),get length(){return store.size},key:i=>[...store.keys()][i]??null};
const P=s.GH_PERSISTENCE,V=s.GH_SAVE_SCHEMA;

const recordIds=Object.keys(state.documentProofs.recordsById);
assert.ok(recordIds.length>=2,'real document proofs exist');
assert.equal(V.validate(state).ok,true,'honest state validates in full (and fills the ledger)');
assert.equal(P.commitState(state,{storageKey:'main'}).ok,true,'a recurring save of an honest state succeeds');   // 1st recurring validation

// in-place edit of an already verified record, in a field only the record itself carries
const payload=state.documentProofs.recordsById[recordIds[0]].signedContent.material.payload;payload.__probe='edited-in-place';
assert.equal(V.validate(state).ok,false,'plain validation sees the edit');
assert.equal(V.validate(state,{trustVerified:true}).ok,true,'trusted validation does not (documented contract)');
const results=[];for(let i=2;i<=12;i++)results.push([i,P.commitState(state,{storageKey:'main'}).ok]);
const failures=results.filter(([,ok])=>!ok).map(([n])=>n);
assert.deepEqual(failures,[10],`only the 10th recurring validation is full and rejects the edit (got ${JSON.stringify(failures)})`);
delete payload.__probe;
assert.equal(V.validate(state).ok,true);
// manual slots, export and recovery never use the ledger: they always validate fully
payload.__probe='edited-in-place';
assert.equal(P.saveSlot(1,state,{label:'t'}).ok,false,'a manual slot save validates in full');
payload.__probe=undefined;delete payload.__probe;
console.log(JSON.stringify({suite:'build350-proof-ledger-persistence',recurringSavesChecked:12,fullValidationEvery:10,rejectedAt:failures}));

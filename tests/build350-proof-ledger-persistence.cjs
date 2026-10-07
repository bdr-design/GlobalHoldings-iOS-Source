'use strict';
// Build 350: recurring saves use the verified-once ledger. Loads/imports/slots always validate fully. Build 359: the full
// validation of every tenth save became the maintenance proof audit (GH_SAVE_SCHEMA.createProofAudit); a confirmed audit
// fault asks persistence for full validations (requireFullValidation), checked at the end.
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

// Build 358: a recurring save seals the proof records first (GH_TRANSACTION_CORE.registerSealedCollections), so an
// in-place edit of an already verified record is impossible: it throws and leaves the record intact.
const TX=s.GH_TRANSACTION_CORE,original=state.documentProofs.recordsById[recordIds[0]];
assert.equal(TX.isSealed(original),true,'the save sealed the proof record');
assert.throws(()=>{original.signedContent.material.payload.__probe='edited-in-place';},TypeError,'an in-place edit throws');
assert.equal(V.validate(state).ok,true,'the record is intact');
// What remains is a replaced record (an edited save file, or a writer bypassing its owner): a new object is not in the
// ledger, so the very next trusted save verifies and rejects it; a full pass and a manual slot do too.
const edited=structuredClone(original);edited.signedContent.material.payload.__probe='edited-copy';state.documentProofs.recordsById[recordIds[0]]=edited;
assert.equal(V.validate(state).ok,false,'plain validation sees the replaced record');
assert.equal(V.validate(state,{trustVerified:true}).ok,false,'trusted validation sees it too (not in the ledger)');
const results=[];for(let i=2;i<=12;i++)results.push([i,P.commitState(state,{storageKey:'main'}).ok]);
const failures=results.filter(([,ok])=>!ok).map(([n])=>n);
assert.deepEqual(failures,[2,3,4,5,6,7,8,9,10,11,12],`every recurring save rejects the replaced record (got ${JSON.stringify(failures)})`);
assert.equal(P.saveSlot(1,state,{label:'t'}).ok,false,'a manual slot save validates in full');
state.documentProofs.recordsById[recordIds[0]]=original;
assert.equal(V.validate(state).ok,true);
assert.equal(P.commitState(state,{storageKey:'main'}).ok,true,'the restored record saves again');
// Build 359: after a confirmed audit fault, a recurring save validates in full even when its caller validated (trusted)
// just before, and the request clears once a full validation passes.
P.requireFullValidation('qa');assert.equal(P.fullValidationRequired(),'qa');
assert.equal(P.commitState(state,{storageKey:'main'}).ok,true,'the honest state passes the full validation');assert.equal(P.fullValidationRequired(),null,'and the request clears');
console.log(JSON.stringify({suite:'build350-proof-ledger-persistence',recurringSavesChecked:12,fullValidationOnRequest:true,sealed:true,rejectedAt:failures}));

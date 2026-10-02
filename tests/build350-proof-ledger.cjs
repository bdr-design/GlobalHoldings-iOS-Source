'use strict';
// Build 350: verified-once ledger for authorization proofs and document records.
// Guarantees proven here, against REAL proofs created by the real authorization/document owners:
//  1. Plain validate(state) is unchanged: it verifies everything and catches every kind of tampering.
//  2. validate(state,{trustVerified:true}) still fully verifies anything not yet in the ledger (new records, clones, loads)
//     and still catches tampering of the LIVE business documents (an invoice edited after signing).
//  3. Build 358: proof records and authorization proofs are sealed (deep-frozen) once a save or a full rollback snapshot
//     has seen them, so an in-place edit is impossible (it throws). Tampering means a REPLACED object, which is not in the
//     ledger and is verified even by trusted validation. (Before 358 the documented contract was that trusted validation
//     missed an in-place edit of an already verified record until the next plain validate() / clone / reload.)
//  4. Clones only inherit trust through inheritVerified(), and only for byte-identical records.
//  5. Trusted validation is much cheaper than full validation once records are verified.
const assert=require('node:assert/strict');
const path=require('node:path');
process.env.GH_TEST_SOURCE_DIR=process.env.GH_TEST_SOURCE_DIR||path.resolve(__dirname,'..');
const {harness,minimal}=require('./helpers/core-harness');

function build(commands){
  const h=harness(['save-schema','authorization-core','document-proof-core','transaction-core','domain-command-core']),{s}=h;
  const state=minimal();state.profile={name:'Ledger Holdings',founder:'Ledger Founder'};
  const Auth=s.GH_AUTHORIZATION;
  Auth.ensurePrincipal(state,{id:'founder',legalName:'Ledger Founder'});
  Auth.createVisualSeal(state,{ownerPersonId:'founder',strokes:[[{x:.1,y:.2},{x:.55,y:.65},{x:.9,y:.3}]]});
  Auth.createDefaultMandate(state,{principalId:'founder',companyIds:['*'],scopes:['audit.*']});
  Auth.registerCommandTargetResolver('audit',()=>['group']);
  s.GH_DOMAIN_COMMANDS.register('audit',{execute(ctx,name,payload){
    ctx.state.auditCount=(ctx.state.auditCount||0)+1;
    const document={id:`AUD-${ctx.state.auditCount}`,company:'group',counterparty:payload.counterparty||'Counterparty',amount:payload.amount,subtotal:payload.amount,tax:0,total:payload.amount,currency:'USD',issuedAt:ctx.state.simSeconds,note:'Ledger document'};
    s.GH_DOCUMENT_PROOF.sealDocument(ctx.state,document,{type:'audit-invoice',companyId:'group'});ctx.state.finance.invoices.unshift(document);return {document};}});
  const issue=(n)=>{for(let i=0;i<n;i++){const key=`LEDGER-${Object.keys(state.documentProofs?.recordsById||{}).length}-${i}-${Math.random()}`;
    const envelope=Auth.buildActiveEnvelope(state,{domain:'audit',name:'post',payload:{amount:100+i,counterparty:`Party ${i%7}`},idempotencyKey:key,actor:{principalId:'founder'}});
    const out=s.GH_DOMAIN_COMMANDS.dispatchEnvelope({state},envelope);assert.equal(out.ok,true);}};
  issue(commands);
  return {s,state,issue,schema:s.GH_SAVE_SCHEMA};
}
const full=(x,st)=>x.schema.validate(st),trusted=(x,st)=>x.schema.validate(st,{trustVerified:true});
const ids=st=>Object.keys(st.documentProofs.recordsById);
// Replaces a row with an edited copy (an in-place edit of a sealed row throws); returns a function restoring the original.
const replaceEdited=(container,id,edit)=>{const original=container[id],copy=structuredClone(original);edit(copy);container[id]=copy;return ()=>{container[id]=original;};};
const median=a=>[...a].sort((p,q)=>p-q)[Math.floor(a.length/2)];
const time=fn=>{const t=[];for(let i=0;i<7;i++){const s=performance.now();fn();t.push(performance.now()-s);}return median(t);};

const x=build(80);
const {state}=x;
assert.ok(ids(state).length>=80&&Object.keys(state.authorization.proofsById).length>=80,'real proofs exist');
assert.equal(full(x,state).ok,true,'plain validation of an honest state');
assert.equal(trusted(x,state).ok,true,'trusted validation of an honest state');

// (1)+(2) the business document is still checked against what was signed, in BOTH modes
{
  const invoice=state.finance.invoices[0],original=invoice.total;
  invoice.total=original+1;
  assert.equal(full(x,state).ok,false,'plain: an invoice edited after signing is rejected');
  assert.equal(trusted(x,state).ok,false,'trusted: an invoice edited after signing is STILL rejected');
  invoice.total=original;assert.equal(trusted(x,state).ok,true);
}
// (2b) editing a field that also feeds the live-document comparison (issuedAtSim) is caught even in trusted mode
{
  assert.equal(full(x,state).ok,true);
  const restore=replaceEdited(state.documentProofs.recordsById,ids(state)[1],record=>{record.signedContent.issuedAtSim+=7;});
  assert.equal(full(x,state).ok,false);assert.equal(trusted(x,state).ok,false,'trusted mode still catches edits that break the signed-document comparison');
  restore();assert.equal(trusted(x,state).ok,true);
}
// (2) a NEW record that was tampered before it was ever verified is rejected by trusted validation
{
  x.issue(1);
  const restore=replaceEdited(state.documentProofs.recordsById,ids(state).at(-1),record=>{record.signedContent.issuedAtSim+=999;});
  assert.equal(trusted(x,state).ok,false,'trusted validation verifies unverified records in full');
  restore();
  assert.equal(trusted(x,state).ok,true);
}
// (3) an already verified record cannot be edited in place; a replaced one is verified again in both modes
{
  const sealed=x.s.GH_TRANSACTION_CORE.sealCollections(state),record=state.documentProofs.recordsById[ids(state)[3]];void sealed;
  assert.equal(full(x,state).ok,true);                       // marks everything as verified
  assert.equal(x.s.GH_TRANSACTION_CORE.isSealed(record),true,'verified proof records are sealed');
  assert.throws(()=>{record.signedContent.material.payload.note='edited in place';},TypeError,'an in-place edit of a sealed record throws');
  const restore=replaceEdited(state.documentProofs.recordsById,ids(state)[3],copy=>{copy.signedContent.material.payload.note=`${copy.signedContent.material.payload.note} (edited)`;});
  assert.equal(full(x,state).ok,false,'plain validation catches a replaced (edited) record');
  assert.equal(trusted(x,state).ok,false,'trusted validation catches it too: the copy is not in the ledger');
  // (4) a clone is a fresh object graph: it inherits nothing unless inheritVerified() is called
  const clone=structuredClone(state);
  assert.equal(trusted(x,clone).ok,false,'a clone of a tampered state is fully verified and rejected');
  restore();
  const honestClone=structuredClone(state);
  const inherited=x.schema.inheritVerified(state,honestClone);
  assert.ok(inherited.records>=80&&inherited.authorization>=80,`clone inherited trust for ${inherited.records}/${inherited.authorization} verified items`);
  assert.equal(trusted(x,honestClone).ok,true);
  // inheritance is per byte-identical record: a clone whose record differs does not inherit it
  const divergent=structuredClone(state),victim=divergent.documentProofs.recordsById[ids(divergent)[5]];
  victim.contentDigest=victim.contentDigest.replace(/.$/,c=>c==='0'?'1':'0');
  const partial=x.schema.inheritVerified(state,divergent);
  assert.ok(partial.records<inherited.records,'a record with a different digest is not inherited');
  assert.equal(trusted(x,divergent).ok,false);
}
// authorization proofs: same contract
{
  const proofs=state.authorization.proofsById,id=Object.keys(proofs)[2];
  assert.equal(full(x,state).ok,true);
  assert.throws(()=>{proofs[id].payloadDigest='0';},TypeError,'an authorization proof cannot be edited in place');
  const restore=replaceEdited(proofs,id,row=>{row.payloadDigest=row.payloadDigest.replace(/.$/,c=>c==='a'?'b':'a');});
  assert.equal(full(x,state).ok,false,'plain validation catches an edited authorization proof');
  assert.equal(trusted(x,state).ok,false,'and trusted validation (the copy is not in the ledger)');
  assert.equal(trusted(x,structuredClone(state)).ok,false,'a clone of it is rejected even in trusted mode');
  restore();assert.equal(full(x,state).ok,true);
}
// (5) cost: trusted validation of an already verified state is much cheaper
{
  // Full validation of an unsealed copy recomputes every digest; on the sealed live state it reuses sealed digests.
  const plain=structuredClone(state);full(x,plain);full(x,state);trusted(x,state);
  const fullMs=time(()=>full(x,plain)),sealedFullMs=time(()=>full(x,state)),trustedMs=time(()=>trusted(x,state));
  assert.ok(trustedMs<fullMs*.6,`trusted ${trustedMs.toFixed(1)}ms should be well below full ${fullMs.toFixed(1)}ms`);
  assert.ok(sealedFullMs<fullMs,`full validation of sealed rows ${sealedFullMs.toFixed(1)}ms should be below unsealed ${fullMs.toFixed(1)}ms`);
  console.log(JSON.stringify({suite:'build350-proof-ledger',records:ids(state).length,authorizationProofs:Object.keys(state.authorization.proofsById).length,fullValidateMs:+fullMs.toFixed(2),sealedFullValidateMs:+sealedFullMs.toFixed(2),trustedValidateMs:+trustedMs.toFixed(2),speedup:+(fullMs/trustedMs).toFixed(1),environment:`node ${process.version}; not iPhone`}));
}

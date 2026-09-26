'use strict';
const assert = require('node:assert/strict');
const {harness,minimal} = require('./helpers/core-harness');

const {s}=harness(['save-schema','authorization-core','document-proof-core','domain-command-core','finance-core']);
const state=minimal();
state.profile={name:'Build336 Intercompany Projection',founder:'Founder'};
state.openedCompanies=['air','sea','bank'];
const F=s.GH_FINANCE_CORE,P=s.GH_DOCUMENT_PROOF,S=s.GH_SAVE_SCHEMA;
F.ensure(state);

function projectionFor(company,sourceProofId){
  return state.companyFinance[company].ledger.find(row=>row.sourceDocumentProofId===sourceProofId);
}
function assertProjection(row,canonical,label){
  assert.ok(row,`${label}: ledger projection must exist`);
  assert.equal(row.ledgerProjectionSchema,'gh-ledger-projection-v1',`${label}: ledger row must use the projection contract`);
  assert.equal(row.documentProofId,undefined,`${label}: ledger projection must not retain documentProofId`);
  assert.equal(row.contentDigest,undefined,`${label}: ledger projection must not retain contentDigest`);
  assert.equal(row.authorizationProofId,undefined,`${label}: ledger projection must not retain authorization proof`);
  assert.equal(row.signatureSnapshot,undefined,`${label}: ledger projection must not retain signature snapshot`);
  assert.equal(row.sourceDocumentProofId,canonical.documentProofId,`${label}: projection must point to canonical proof`);
  assert.equal(row.sourceDocumentId,canonical.documentId,`${label}: projection must point to canonical document`);
  assert.equal(row.sourceDocumentDigest,canonical.contentDigest,`${label}: projection must preserve canonical digest provenance`);
}

// Direct intercompany transfer: both sender and receiver books must receive projections only.
F.book(state,'group').accounts[0].balance=1_000_000;
F.execute({state},'transfer',{from:'group',to:'air',amount:10_000,ref:'B336-XFER-1',note:'Projection transfer'});
const transfer=state.finance.transfers.find(row=>row.id==='B336-XFER-1');
assert.ok(transfer?.documentProofId,'canonical transfer must retain legal proof');
assert.equal(P.verifyDocument(state,transfer).ok,true,'canonical transfer proof must verify');
assertProjection(projectionFor('group',transfer.documentProofId),transfer,'transfer sender');
assertProjection(projectionFor('air',transfer.documentProofId),transfer,'transfer receiver');
assert.equal(state.treasury.ledger.some(row=>row.documentProofId===transfer.documentProofId),false,'treasury ledger must not contain a legal-proof clone');

// Intercompany loan principal uses the same protected canonical/projection split on both companies.
F.execute({state},'issue-intercompany-loan',{id:'B336-LOAN-1',lender:'group',borrower:'sea',amount:20_000,annualRate:.05,termDays:365});
const principal=state.finance.transfers.find(row=>row.id==='B336-LOAN-1');
assert.ok(principal?.documentProofId,'canonical loan principal must retain legal proof');
assert.equal(P.verifyDocument(state,principal).ok,true,'canonical loan principal proof must verify');
assertProjection(projectionFor('group',principal.documentProofId),principal,'loan lender');
assertProjection(projectionFor('sea',principal.documentProofId),principal,'loan borrower');

// Settlement reverses direction and must still project to both ledgers without copying security envelopes.
F.book(state,'sea').accounts[0].balance += 50_000;
state.simSeconds=30*86400;
F.execute({state},'repay-intercompany-loan',{id:'B336-LOAN-1',amount:5_000,reference:'B336-SETTLE-1'});
const settlement=state.finance.transfers.find(row=>row.id==='B336-SETTLE-1');
assert.ok(settlement?.documentProofId,'canonical loan settlement must retain legal proof');
assert.equal(P.verifyDocument(state,settlement).ok,true,'canonical loan settlement proof must verify');
assertProjection(projectionFor('sea',settlement.documentProofId),settlement,'settlement borrower');
assertProjection(projectionFor('group',settlement.documentProofId),settlement,'settlement lender');

const validation=S.validate(state);
assert.equal(validation.ok,true,`multi-company projection state must remain schema valid: ${(validation.errors||[]).join(',')}`);
const forensic=P.forensicInspectStateProofs(state);
assert.equal(forensic.documentFailures.length,0,`forensics must be clean: ${JSON.stringify(forensic.documentFailures)}`);
assert.equal(forensic.danglingReferences.length,0,`no proof references may dangle: ${JSON.stringify(forensic.danglingReferences)}`);

console.log(JSON.stringify({
  pass:true,
  canonicalTransfers:state.finance.transfers.filter(row=>row.documentProofId).length,
  groupProjectionCount:state.companyFinance.group.ledger.filter(row=>row.ledgerProjectionSchema==='gh-ledger-projection-v1').length,
  airProjectionCount:state.companyFinance.air.ledger.filter(row=>row.ledgerProjectionSchema==='gh-ledger-projection-v1').length,
  seaProjectionCount:state.companyFinance.sea.ledger.filter(row=>row.ledgerProjectionSchema==='gh-ledger-projection-v1').length
},null,2));

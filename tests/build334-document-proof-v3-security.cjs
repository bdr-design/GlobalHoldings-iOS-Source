'use strict';
const assert=require('node:assert/strict');
const {harness,minimal}=require('./helpers/core-harness');
const {s}=harness(['authorization-core','document-proof-core']);
const Proof=s.GH_DOCUMENT_PROOF;

function state(){const value=minimal();value.profile={name:'Proof Holdings',founder:'Proof Founder'};return value;}
function sealed(type,id='DOC-1',extra={}){const value=state(),document={id,company:'group',counterparty:'Verified Counterparty',amount:100,status:'open',marker:'original',...extra};Proof.sealDocument(value,document,{type,companyId:'group'});assert.equal(Proof.verifyDocument(value,document).ok,true);return {value,document};}

for(const [index,type] of Object.keys(Proof.DOCUMENT_TYPES).entries()){
  const {value,document}=sealed(type,`TYPE-${index}`);
  document.marker='tampered';
  assert.equal(Proof.verifyDocument(value,document).ok,false,`${type}: arbitrary material mutation must fail`);
}

for(const [type,extra,mutations] of [
  ['payroll-report',{lines:[{company:'group',amount:100,paid:20,due:80,sourceRefs:['PAY-1']}],paid:20,due:80,sourceRefs:['RUN-1']},[
    doc=>{doc.status='paid';},doc=>{doc.paid=100;},doc=>{doc.due=0;},doc=>{doc.lines[0].paid=100;},doc=>{doc.lines[0].sourceRefs[0]='FORGED';}
  ]],
  ['intercompany-transfer',{fromCompany:'group',toCompany:'air',invoiceNumbers:['INV-1'],sourceRefs:['SRC-1'],accountBalanceBefore:500,accountBalanceAfter:400},[
    doc=>{doc.status='reversed';},doc=>{doc.invoiceNumbers[0]='INV-X';},doc=>{doc.sourceRefs.push('SRC-X');},doc=>{doc.accountBalanceAfter=999;}
  ]],
  ['commercial-contract',{client:'Client A',sla:{uptime:99.9},capacity:50,penalty:1000,termMonths:12},[
    doc=>{doc.status='expired';},doc=>{doc.client='Client B';},doc=>{doc.sla.uptime=80;},doc=>{doc.penalty=0;}
  ]],
  ['debt-financing',{outstanding:100,lender:'Bank A',dueDay:30},[
    doc=>{doc.status='paid';},doc=>{doc.outstanding=0;},doc=>{doc.lender='Bank B';}
  ]]
])for(const mutate of mutations){const {value,document}=sealed(type,`${type}-${Math.random()}`,structuredClone(extra));mutate(document);assert.equal(Proof.verifyDocument(value,document).ok,false,`${type}: material tamper remained valid`);}

{
  const {value,document}=sealed('invoice-payable','INV-AMEND',{number:'INV-AMEND'}),previousId=document.documentProofId,previousDigest=document.contentDigest;
  const amended=Proof.amendDocument(value,document,{transition:'invoice-payable-settled',mutate:doc=>{doc.status='settled';doc.settledAt=10;}});
  assert.equal(Proof.verifyDocument(value,document).ok,true);
  assert.notEqual(document.documentProofId,previousId);
  assert.notEqual(document.contentDigest,previousDigest);
  assert.equal(amended.record.previousProofId,previousId);
  assert.equal(amended.record.previousContentDigest,previousDigest);
  assert.equal(amended.record.transition,'invoice-payable-settled');
  document.status='forged';assert.equal(Proof.verifyDocument(value,document).ok,false);
}

{
  const {value,document}=sealed('cheque','CHQ-ROLLBACK'),beforeDocument=JSON.stringify(document),beforeStore=JSON.stringify(value.documentProofs);
  assert.throws(()=>Proof.amendDocument(value,document,{transition:'cheque-cleared',mutate:doc=>{doc.status='paid';return Promise.resolve();}}),/mutator-async/);
  assert.equal(JSON.stringify(document),beforeDocument,'async amendment must roll back document');
  assert.equal(JSON.stringify(value.documentProofs),beforeStore,'async amendment must roll back proof store and sequence');
  assert.throws(()=>Proof.amendDocument(value,document,{transition:'cheque-cleared',mutate:()=>{}}),/no-material-change/);
  assert.throws(()=>Proof.amendDocument(value,document,{transition:'forged-transition',mutate:doc=>{doc.status='x';}}),/transition-unsupported/);
}

{
  const {value,document}=sealed('audit-invoice','UNKNOWN-FIELD');document.injectedMaterial='forged';assert.equal(Proof.verifyDocument(value,document).ok,false,'new material fields must invalidate the digest');
  assert.throws(()=>Proof.sealDocument(state(),{id:'UNKNOWN-TYPE',company:'group',amount:1},{type:'future-unregistered-type'}),/type-profile-unsupported/);
}

console.log(JSON.stringify({suite:'build334-document-proof-v3-security',passed:true,types:Object.keys(Proof.DOCUMENT_TYPES).length,transitionChain:true,rollback:true},null,2));

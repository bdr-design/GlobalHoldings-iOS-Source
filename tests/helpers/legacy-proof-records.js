'use strict';
// Build 359: proof records as builds before the compact form wrote them (a save from an earlier build). The whole record
// keeps its signed content and the issuer and counterparty snapshots, rebuilt here from its document as those builds
// issued them (GH_DOCUMENT_PROOF.signedContent with the document's snapshots, the record's issue time and the chain link
// its link fields name); a bound record also keeps the signature snapshot.
function wholeRecord(Proof,document,record){
  const issuer={...structuredClone(document.issuerSnapshot),companyId:String(document.company||document.companyId||'group').trim().slice(0,100)};
  const chain=record.chainDepth>0?{previousProofId:record.previousProofId,previousContentDigest:record.previousContentDigest,transition:record.transition,depth:record.chainDepth}:null;
  const content=Proof.signedContent(document,issuer,Proof.counterpartySnapshot(document),{issuedAtSim:record.issuedAtSim,fixedIssuedAt:true,chain});
  const whole={id:record.id,version:record.version,documentId:record.documentId,documentType:record.documentType,companyId:record.companyId,materialProfile:record.materialProfile,issuerSnapshot:structuredClone(content.issuer),counterpartySnapshot:structuredClone(content.recipient),signedContent:content,contentDigest:record.contentDigest,previousProofId:record.previousProofId,previousContentDigest:record.previousContentDigest,transition:record.transition,chainDepth:record.chainDepth,authorizationKind:record.authorizationKind,authorizationProofId:record.authorizationProofId,createdAtSim:record.createdAtSim};
  if(record.signatureDigest!==null)whole.signatureSnapshot=structuredClone(document.signatureSnapshot);
  return whole;
}
// The compact current records of the live documents (finance lists and contracts) become whole records, in new maps (the
// state may be sealed). Returns the ids rewritten.
function legacyLiveRecords(Proof,state){
  const store=state.documentProofs,hot={...store.recordsById},cold={...(store.archiveById||{})},ids=[];let coldChanged=false;
  const lists=['invoices','cheques','periods','taxSettlements','debtRecords','debtSettlements','transfers','payrollReports'].map(bucket=>state.finance?.[bucket]).filter(Array.isArray);
  for(const document of [...lists.flat(),...Object.values(state.contractRegistry||{})]){
    const id=document?.documentProofId,record=id?Proof.record(state,id):null;if(!record||record.form!==Proof.COMPACT_FORM||ids.includes(id))continue;
    const whole=wholeRecord(Proof,document,record);if(hot[id]===record)hot[id]=whole;else{cold[id]=whole;coldChanged=true;}ids.push(id);
  }
  store.recordsById=hot;if(coldChanged)store.archiveById=cold;return ids;
}
module.exports={wholeRecord,legacyLiveRecords};

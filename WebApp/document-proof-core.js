(()=>{
  'use strict';
  const VERSION='1.2.0',SCHEMA='gh-document-proofs-v1',CONTENT_SCHEMA='gh-signed-document-content-v3',RECORD_VERSION=3;
  const LIMITS=Object.freeze({records:5000,archiveBytes:16*1024*1024,materialBytes:512*1024,materialDepth:16,materialArray:8192,materialKeys:2048,chainDepth:64});
  const SECURITY_FIELDS=new Set(['documentSchema','documentVersion','documentProofId','documentId','documentType','issuerSnapshot','counterpartySnapshot','contentDigest','authorizationKind','authorizationProofId','signatureSnapshot','authorization','signatureAssetId','visualSealAssetId']);
  const DOCUMENT_TYPES=Object.freeze({
    'revenue-collection':'transfer-v3','invoice-receivable':'invoice-v3','invoice-payable':'invoice-v3','audit-invoice':'invoice-v3',
    'intercompany-transfer':'transfer-v3','intercompany-interest':'transfer-v3','intercompany-loan-principal':'transfer-v3','intercompany-loan-settlement':'transfer-v3',
    'payroll-transfer':'transfer-v3','payroll-payable':'transfer-v3','payroll-report':'payroll-v3','payable-settlement':'transfer-v3',
    'tax-payment-transfer':'transfer-v3','tax-settlement':'tax-v3','cheque':'cheque-v3','founder-investment':'transfer-v3','founder-withdrawal':'transfer-v3',
    'debt-financing':'debt-v3','debt-repayment':'debt-v3','debt-payment-transfer':'transfer-v3','daily-operating-settlement':'transfer-v3',
    'asset-financing':'debt-v3','debt-adjustment':'debt-v3','vat-assessment':'tax-v3','commercial-contract':'commercial-contract-v3'
  });
  const TRANSITIONS=Object.freeze([
    'invoice-accrual-classified','invoice-payroll-classified','invoice-transfer-linked','invoice-collected','invoice-payable-settled',
    'invoice-cheque-issued','invoice-cheque-cleared','invoice-cheque-returned','payroll-report-settled','payroll-transfer-settled',
    'vat-assessment-paid','cheque-request-linked','cheque-cancelled','cheque-cleared','cheque-returned',
    'debt-repayment-applied','debt-balance-adjusted','contract-expired'
  ]),TRANSITION_SET=new Set(TRANSITIONS),TRANSITION_ID=/^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/;
  const clone=value=>value===undefined?undefined:(globalThis.structuredClone?structuredClone(value):JSON.parse(JSON.stringify(value)));
  const clean=(value,max=240)=>String(value??'').trim().slice(0,max);
  const stable=value=>globalThis.GH_AUTHORIZATION?.stable?.(value)??JSON.stringify(value);
  const digest=value=>globalThis.GH_AUTHORIZATION?.digest?.(value)??globalThis.GH_CONTROL_PLANE?.sha256?.(typeof value==='string'?value:stable(value));
  const number=value=>Number.isFinite(Number(value))?Number(value):null;

  function ensure(state){
    if(!state||typeof state!=='object'||Array.isArray(state))throw new TypeError('document-proof-state-required');
    state.documentProofs=state.documentProofs&&typeof state.documentProofs==='object'&&!Array.isArray(state.documentProofs)?state.documentProofs:{};
    const store=state.documentProofs;store.schema=SCHEMA;store.version=1;store.sequence=Math.max(0,Math.floor(Number(store.sequence)||0));
    store.recordsById=store.recordsById&&typeof store.recordsById==='object'&&!Array.isArray(store.recordsById)?store.recordsById:{};return store;
  }
  // One owner, one residency per proof. The active admission window stays 5000;
  // retained history moves to a byte-bounded archive rather than being deleted.
  // Both regions remain inside the same state transaction and save generation.
  function getRecord(state,id){
    const store=state?.documentProofs||{},hot=store.recordsById?.[id],cold=store.archiveById?.[id];
    return hot&&cold?null:(hot||cold||null);
  }
  function records(state){const store=state?.documentProofs||{};return [...Object.values(store.recordsById||{}),...Object.values(store.archiveById||{})];}
  function archiveForAdmission(state){
    const store=ensure(state),hot=store.recordsById,cold=store.archiveById||{};
    if(Object.keys(hot).length<LIMITS.records)return;
    const moving=Object.values(hot).sort((a,b)=>(Number(a.createdAtSim)||0)-(Number(b.createdAtSim)||0)||String(a.id).localeCompare(String(b.id))).slice(0,200);
    const next={...cold};
    for(const row of moving){if(Object.prototype.hasOwnProperty.call(next,row.id))throw new Error('document-proof-residency-conflict');next[row.id]=row;}
    if(new TextEncoder().encode(JSON.stringify(next)).byteLength>LIMITS.archiveBytes)throw new Error('document-proof-archive-byte-limit');
    // All fallible preparation finishes before publishing the move; no copy is
    // discarded until the archive destination has been prepared successfully.
    const nextHot={...hot};for(const row of moving)delete nextHot[row.id];
    store.archiveById=next;store.recordsById=nextHot;
  }
  function companyProfile(state,companyId){
    const platform=globalThis.GH_COMPANY_PLATFORM,id=clean(companyId||'group',100),registryRecord=state.companyRegistry?.[id]||{},record=id==='group'?{...registryRecord,...(state.profile||{})}:registryRecord,resolved=platform?.resolveDocumentProfile?.(state,id),legalName=clean(resolved?.legalName||record.legalName||record.name||(id==='group'?state.profile?.name:'')||id,240),logo=resolved?.logo||record.logo||record.logoAssetId||null;
    if(resolved)return {...clone(resolved),companyId:id,legalName,tradeName:clean(resolved.tradeName||record.tradeName||record.shortName||legalName,180),shortName:clean(resolved.shortName||record.shortName||record.tradeName||legalName,80),taxId:clean(record.taxId||record.taxNumber,80)||null,registrationNo:clean(record.registrationNo||record.registrationNumber,80)||null,jurisdiction:clean(record.jurisdiction||record.hq||state.profile?.hq,180)||null,logoAssetId:clean(record.logoAssetId||logo,160)||null,logoDigest:logo?digest(String(logo)):null,identityRevision:Math.max(0,Math.floor(Number(record.identityRevision)||0))};
    return {companyId:id,definitionId:record.templateId||record.definitionId||null,definitionVersion:Number(record.definitionVersion)||null,legalName,tradeName:clean(record.tradeName||record.shortName||legalName,180),shortName:clean(record.shortName||record.tradeName||legalName,80),taxId:clean(record.taxId||record.taxNumber,80)||null,registrationNo:clean(record.registrationNo||record.registrationNumber,80)||null,jurisdiction:clean(record.jurisdiction||state.profile?.hq,180)||null,logoAssetId:clean(record.logoAssetId,160)||null,logoDigest:logo?digest(String(logo)):null,identityRevision:Math.max(0,Math.floor(Number(record.identityRevision)||0)),documentPrefix:clean(record.documentPrefix||record.finance?.documentPrefix||id.toUpperCase(),24),accountPrefix:clean(record.accountPrefix||record.finance?.accountPrefix||id.toUpperCase(),24)};
  }
  function issuerSnapshot(state,companyId){const p=companyProfile(state,companyId);return {companyId:p.companyId,definitionId:p.definitionId||null,definitionVersion:p.definitionVersion||null,legalName:p.legalName,tradeName:p.tradeName||p.legalName,shortName:p.shortName||p.tradeName||p.legalName,taxId:p.taxId||null,registrationNo:p.registrationNo||null,jurisdiction:p.jurisdiction||null,logoAssetId:p.logoAssetId||null,logoDigest:p.logoDigest||null,identityRevision:Number(p.identityRevision)||0,documentPrefix:p.documentPrefix||null,accountPrefix:p.accountPrefix||null};}
  function counterpartySnapshot(document){return {partyId:clean(document.counterpartyPartyId||document.beneficiaryPartyId||document.toPartyId,120)||null,legalName:clean(document.counterparty||document.beneficiary||document.lender||document.taxAuthority||document.to||document.from||'طرف غير محدد',240),taxId:clean(document.counterpartyTaxId,80)||null,accountId:clean(document.counterpartyAccountId,120)||null};}
  function documentId(document,options={}){return clean(options.documentId||document.documentId||document.chequeNumber||document.settlementNumber||document.number||document.id||document.reference,180);}
  function documentType(document,options={}){return clean(options.type||document.documentType||document.type||document.kind||'financial-document',80);}
  function profileFor(type){const id=clean(type,80),profile=DOCUMENT_TYPES[id];if(!profile)throw new Error(`document-type-profile-unsupported:${id||'empty'}`);return profile;}
  const financeBuckets=['invoices','cheques','periods','taxSettlements','debtRecords','debtSettlements','transfers','payrollReports'];
  function stateDocumentEntries(state){
    // One path-aware owner for every object that the schema treats as a legal
    // document. Ledger projections are intentionally not legal documents; legacy
    // company-ledger archive buckets remain enumerable until migration repairs
    // them so corruption cannot be hidden by changing the validator surface.
    const rows=[],seen=new Set();
    const append=(document,path,role='canonical')=>{if(document&&typeof document==='object'&&!seen.has(document)){seen.add(document);rows.push({document,path,role});}};
    for(const bucket of financeBuckets){const list=Array.isArray(state.finance?.[bucket])?state.finance[bucket]:[];for(let index=0;index<list.length;index++)append(list[index],`finance.${bucket}[${index}]`);}
    for(const [id,document] of Object.entries(state.contractRegistry||{}))append(document,`contractRegistry.${id}`);
    for(const [bucket,list] of Object.entries(state.finance?.auditArchive?.records||{}))if(Array.isArray(list))for(let index=0;index<list.length;index++)append(list[index],`finance.auditArchive.records.${bucket}[${index}]`,String(bucket).startsWith('companyLedger-')?'legacy-ledger':'canonical-archive');
    return rows;
  }
  function stateDocuments(state){return stateDocumentEntries(state).map(row=>row.document);}
  function canonicalDocumentEntry(state,proofId){return stateDocumentEntries(state).find(row=>row.document?.documentProofId===proofId&&row.role!=='legacy-ledger')||null;}
  function resultProofIds(value,ids,seen=new Set()){
    if(!value||typeof value!=='object'||seen.has(value))return;seen.add(value);
    if(typeof value.documentProofId==='string'&&value.documentProofId)ids.add(value.documentProofId);
    for(const nested of Object.values(value))resultProofIds(nested,ids,seen);
  }
  function referencedProofs(state,pinned=[]){
    const seen=new Set(),roots=new Set(pinned);
    for(const document of stateDocuments(state))if(document?.documentProofId)roots.add(document.documentProofId);
    // A replay result can outlive the corresponding live history row. Its proof
    // and ancestors are still referenced, even when no UI document is present.
    const visited=new Set();for(const cached of Object.values(state.domainRuntime?.idempotency||{}))resultProofIds(cached?.result,roots,visited);
    const stack=[...roots];while(stack.length){const id=stack.pop();if(seen.has(id))continue;seen.add(id);const prior=getRecord(state,id)?.previousProofId;if(prior)stack.push(prior);}return seen;
  }
  function compact(state,target=Math.max(0,LIMITS.records-200),pinned=[]){
    const store=ensure(state),referenced=referencedProofs(state,pinned),removable=Object.values(store.recordsById).filter(row=>!referenced.has(row.id)).sort((a,b)=>(Number(a.createdAtSim)||0)-(Number(b.createdAtSim)||0)||String(a.id).localeCompare(String(b.id))),remove=Math.max(0,Object.keys(store.recordsById).length-target);
    for(const row of removable.slice(0,remove))delete store.recordsById[row.id];
    let archivedRemoved=0;for(const [id] of Object.entries(store.archiveById||{}))if(!referenced.has(id)){delete store.archiveById[id];archivedRemoved++;}
    return {records:Object.keys(store.recordsById).length,archived:Object.keys(store.archiveById||{}).length,removed:Math.min(remove,removable.length)+archivedRemoved};
  }

  function canonicalValue(value,depth=0){
    if(depth>LIMITS.materialDepth)throw new Error('document-material-depth');
    if(value===null||typeof value==='string'||typeof value==='boolean')return value;
    if(typeof value==='number'){if(!Number.isFinite(value))throw new Error('document-material-non-finite');return Object.is(value,-0)?0:value;}
    if(Array.isArray(value)){if(value.length>LIMITS.materialArray)throw new Error('document-material-array-capacity');const out=[];for(let index=0;index<value.length;index++){if(!(index in value)||value[index]===undefined)throw new Error('document-material-array-hole');out.push(canonicalValue(value[index],depth+1));}return out;}
    if(!value||typeof value!=='object'||Object.prototype.toString.call(value)!=='[object Object]'||Object.getOwnPropertySymbols(value).length)throw new Error('document-material-value');
    const keys=Object.keys(value);if(keys.length>LIMITS.materialKeys)throw new Error('document-material-key-capacity');const out={};
    for(const key of keys.sort()){if(['__proto__','prototype','constructor'].includes(key))throw new Error('document-material-key');if(value[key]!==undefined)out[key]=canonicalValue(value[key],depth+1);}return out;
  }
  function materialDetails(document,type){const profile=profileFor(type),source={};for(const [key,value] of Object.entries(document))if(!SECURITY_FIELDS.has(key)&&value!==undefined)source[key]=value;const payload=canonicalValue(source),encoded=stable(payload);if(new TextEncoder().encode(encoded).byteLength>LIMITS.materialBytes)throw new Error('document-material-size');return {profile,payload};}
  function issuedAt(document,options={}){if(options.fixedIssuedAt===true)return Math.max(0,number(options.issuedAtSim)||0);return number(document.issuedAt??document.signedAt??document.paidAt??document.at??document.closedAt??document.createdAt)??Math.max(0,number(options.issuedAtSim)||0);}
  function signedContentV2(document,issuer,counterparty,options={}){return {schema:'gh-signed-document-content-v2',version:2,documentId:documentId(document,options),documentType:documentType(document,options),references:{documentId:clean(document.documentId,180)||null,number:clean(document.number,180)||null,id:clean(document.id,180)||null,reference:clean(document.reference,180)||null,chequeNumber:clean(document.chequeNumber,180)||null,settlementNumber:clean(document.settlementNumber,180)||null,businessType:clean(document.type||document.kind,80)||null},issuer,recipient:counterparty,monetary:{currency:clean(document.currency||'USD',12),amount:number(document.amount??document.value??document.total),subtotal:number(document.subtotal),tax:number(document.tax),total:number(document.total??document.amount??document.value)},terms:{title:clean(document.title||document.name,300)||null,note:clean(document.note||document.purposeDetail,600),method:clean(document.method||document.paymentMethod,100),accountId:clean(document.accountId,120)||null,sourceRef:clean(document.sourceRef||document.reference,180)||null,invoiceNumber:clean(document.invoiceNumber,180)||null,issuePlace:clean(document.issuePlace,240)||null,paymentPlace:clean(document.paymentPlace,240)||null,dueDay:number(document.dueDay),termMonths:number(document.termMonths),sector:clean(document.sector,100)||null},issuedAtSim:number(document.issuedAt??document.signedAt??document.paidAt??document.at)??Math.max(0,Number(options.issuedAtSim)||0)};}
  function signedContent(document,issuer,counterparty,options={}){const type=documentType(document,options);return {schema:CONTENT_SCHEMA,version:RECORD_VERSION,documentId:documentId(document,options),documentType:type,references:{documentId:clean(document.documentId,180)||null,number:clean(document.number,180)||null,id:clean(document.id,180)||null,reference:clean(document.reference,180)||null,chequeNumber:clean(document.chequeNumber,180)||null,settlementNumber:clean(document.settlementNumber,180)||null,businessType:type},issuer,recipient:counterparty,monetary:{currency:clean(document.currency||'USD',12),amount:number(document.amount??document.value??document.total),subtotal:number(document.subtotal),tax:number(document.tax),total:number(document.total??document.amount??document.value)},terms:{title:clean(document.title||document.name,300)||null,note:clean(document.note||document.purposeDetail,600),method:clean(document.method||document.paymentMethod,100),accountId:clean(document.accountId,120)||null,sourceRef:clean(document.sourceRef||document.reference,180)||null,invoiceNumber:clean(document.invoiceNumber,180)||null,issuePlace:clean(document.issuePlace,240)||null,paymentPlace:clean(document.paymentPlace,240)||null,dueDay:number(document.dueDay),termMonths:number(document.termMonths),sector:clean(document.sector,100)||null},material:materialDetails(document,type),chain:options.chain||null,issuedAtSim:issuedAt(document,options)};}
  function restoreObject(target,snapshot){for(const key of Object.keys(target))delete target[key];Object.assign(target,clone(snapshot));}
  function clearSecurityEnvelope(document){for(const key of SECURITY_FIELDS)delete document[key];}
  function createRecord(state,document,options={},chain=null){
    const store=ensure(state),id=documentId(document,options),type=documentType(document,options);if(!id)throw new Error('document-id-required');profileFor(type);
    if(Object.keys(store.recordsById).length>=LIMITS.records){compact(state,Math.max(0,LIMITS.records-200),chain?.previousProofId?[chain.previousProofId]:[]);archiveForAdmission(state);if(Object.keys(store.recordsById).length>=LIMITS.records)throw new Error('document-proof-store-full');}
    const companyId=clean(options.companyId||document.company||document.companyId||'group',100),issuer=issuerSnapshot(state,companyId),counterparty=counterpartySnapshot(document);document.documentId=id;document.documentType=type;
    const content=signedContent(document,issuer,counterparty,{issuedAtSim:Number(state.simSeconds)||0,chain}),contentDigest=digest(content);if(!contentDigest)throw new Error('document-digest-owner-unavailable');
    if(!Number.isSafeInteger(store.sequence)||store.sequence>=Number.MAX_SAFE_INTEGER)throw new Error('document-proof-sequence-exhausted');
    const nextSequence=store.sequence+1,proofId=`DOCP-${String(nextSequence).padStart(9,'0')}`;if(Object.prototype.hasOwnProperty.call(store.recordsById,proofId)||Object.prototype.hasOwnProperty.call(store.archiveById||{},proofId))throw new Error('document-proof-id-collision');
    const record={id:proofId,version:RECORD_VERSION,documentId:id,documentType:type,companyId,materialProfile:content.material.profile,issuerSnapshot:issuer,counterpartySnapshot:counterparty,signedContent:content,contentDigest,previousProofId:chain?.previousProofId||null,previousContentDigest:chain?.previousContentDigest||null,transition:chain?.transition||null,chainDepth:chain?.depth||0,authorizationKind:clean(options.authorizationKind||'pending-approval',40),authorizationProofId:null,createdAtSim:Number(state.simSeconds)||0};
    store.sequence=nextSequence;store.recordsById[proofId]=record;document.documentSchema=content.schema;document.documentVersion=RECORD_VERSION;document.documentProofId=proofId;document.issuerSnapshot=clone(issuer);document.counterpartySnapshot=clone(counterparty);document.contentDigest=contentDigest;document.authorizationKind=record.authorizationKind;return clone(record);
  }
  function sealDocument(state,document,options={}){if(!document||typeof document!=='object'||Array.isArray(document))throw new TypeError('document-object-required');if(options.chain!==undefined)throw new Error('document-chain-internal-only');ensure(state);if(document.documentProofId){const verification=verifyDocument(state,document);if(!verification.ok)throw new Error(`document-proof-invalid:${verification.reason}`);return clone(getRecord(state,document.documentProofId));}return createRecord(state,document,options,null);}
  function transitionId(value){const id=String(value||'').trim();if(id.length>64||!TRANSITION_ID.test(id)||!TRANSITION_SET.has(id))throw new Error('document-transition-unsupported');return id;}
  function amendDocument(state,document,options={}){
    if(!document||typeof document!=='object'||Array.isArray(document))throw new TypeError('document-object-required');if(typeof options.mutate!=='function')throw new TypeError('document-amendment-mutator-required');
    const transition=transitionId(options.transition),store=ensure(state),documentSnapshot=clone(document),storeSnapshot=clone(store);
    try{
      const verification=verifyDocument(state,document);if(!verification.ok){if(verification.legacy&&verification.readOnly)throw new Error('document-proof-legacy-read-only');throw new Error(`document-proof-invalid:${verification.reason}`);}
      const previous=getRecord(state,document.documentProofId);if(!previous||Number(previous.version)!==RECORD_VERSION)throw new Error('document-proof-legacy-read-only');
      const depth=(Number(previous.chainDepth)||0)+1;if(!Number.isSafeInteger(depth)||depth>LIMITS.chainDepth)throw new Error('document-proof-chain-depth');
      const beforeId=documentId(document),beforeType=documentType(document),beforeCompany=clean(document.company||document.companyId||'group',100),beforeMaterial=stable(materialDetails(document,beforeType).payload),result=options.mutate(document);
      if(result&&typeof result.then==='function')throw new Error('document-amendment-mutator-async');
      const afterId=documentId(document),afterType=documentType(document),afterCompany=clean(document.company||document.companyId||'group',100);if(afterId!==beforeId)throw new Error('document-amendment-id-changed');if(afterType!==beforeType)throw new Error('document-amendment-type-changed');if(afterCompany!==beforeCompany)throw new Error('document-amendment-company-changed');
      const afterMaterial=stable(materialDetails(document,afterType).payload);if(afterMaterial===beforeMaterial)throw new Error('document-amendment-no-material-change');
      clearSecurityEnvelope(document);const chain={previousProofId:previous.id,previousContentDigest:previous.contentDigest,transition,depth},record=createRecord(state,document,{type:beforeType,documentId:beforeId,companyId:beforeCompany,authorizationKind:clean(options.authorizationKind||'pending-approval',40)},chain);return {record,result};
    }catch(error){restoreObject(document,documentSnapshot);state.documentProofs=storeSnapshot;throw error;}
  }
  function verifyAuthorizationReference(state,record,cache=null){if(!record.authorizationProofId)return {ok:true};const authorization=globalThis.GH_AUTHORIZATION?.verifyProof?.(state,record.authorizationProofId,cache?.authorization);if(!authorization?.ok)return {ok:false,reason:`authorization-${authorization?.reason||'unavailable'}`};if(!authorization.proof.documentDigests.includes(record.contentDigest)||!authorization.proof.documentIds.includes(record.documentId))return {ok:false,reason:'authorization-document-reference-missing'};return {ok:true};}
  function verifyRecord(state,proofId,seen=new Set(),cache=null){
    const cached=cache?.records?.get(proofId);if(cached)return cached;const proofRecord=getRecord(state,proofId);if(!proofRecord)return {ok:false,reason:'document-proof-not-found'};if(seen.size>=LIMITS.chainDepth+1)return {ok:false,reason:'document-proof-chain-depth'};if(seen.has(proofId))return {ok:false,reason:'document-proof-chain-cycle'};seen.add(proofId);
    try{
      let signedContentStable=cache?.signedContentStable?.get(proofId);if(signedContentStable===undefined){signedContentStable=stable(proofRecord.signedContent);cache?.signedContentStable?.set(proofId,signedContentStable);}if(digest(signedContentStable)!==proofRecord.contentDigest)return {ok:false,reason:'document-proof-record-tampered'};const authorization=verifyAuthorizationReference(state,proofRecord,cache);if(!authorization.ok)return authorization;
      if(Number(proofRecord.version)===2&&proofRecord.signedContent?.schema==='gh-signed-document-content-v2')return {ok:false,legacy:true,readOnly:true,recordIntegrity:true,modern:false,reason:'document-proof-v2-legacy-read-only',record:clone(proofRecord)};
      if(Number(proofRecord.version)!==RECORD_VERSION||proofRecord.signedContent?.schema!==CONTENT_SCHEMA)return {ok:false,reason:'document-proof-version-unsupported'};let profile;try{profile=profileFor(proofRecord.documentType);}catch(error){return {ok:false,reason:String(error?.message||error)};}
      if(proofRecord.materialProfile!==profile||proofRecord.signedContent?.material?.profile!==profile)return {ok:false,reason:'document-material-profile-mismatch'};if(proofRecord.signedContent.documentId!==proofRecord.documentId||proofRecord.signedContent.documentType!==proofRecord.documentType)return {ok:false,reason:'document-proof-record-envelope-mismatch'};if(stable(proofRecord.signedContent.issuer)!==stable(proofRecord.issuerSnapshot)||stable(proofRecord.signedContent.recipient)!==stable(proofRecord.counterpartySnapshot))return {ok:false,reason:'document-proof-record-snapshot-mismatch'};
      const chain=proofRecord.signedContent.chain,chainDepth=Number(proofRecord.chainDepth);if(!Number.isSafeInteger(chainDepth)||chainDepth<0||chainDepth>LIMITS.chainDepth)return {ok:false,reason:'document-proof-chain-depth'};
      if(chainDepth===0){if(chain!==null||proofRecord.previousProofId||proofRecord.previousContentDigest||proofRecord.transition)return {ok:false,reason:'document-proof-root-chain-invalid'};}
      else{
        if(!chain||typeof chain!=='object'||Array.isArray(chain)||Object.keys(chain).sort().join(',')!=='depth,previousContentDigest,previousProofId,transition')return {ok:false,reason:'document-proof-chain-shape'};let transition;try{transition=transitionId(chain.transition);}catch(error){return {ok:false,reason:String(error?.message||error)};}
        if(chain.previousProofId!==proofRecord.previousProofId||chain.previousContentDigest!==proofRecord.previousContentDigest||transition!==proofRecord.transition||Number(chain.depth)!==chainDepth)return {ok:false,reason:'document-proof-chain-reference-mismatch'};
        const previous=getRecord(state,proofRecord.previousProofId);if(!previous||previous.contentDigest!==proofRecord.previousContentDigest)return {ok:false,reason:'document-proof-chain-predecessor-mismatch'};if(previous.documentId!==proofRecord.documentId||previous.documentType!==proofRecord.documentType||previous.companyId!==proofRecord.companyId)return {ok:false,reason:'document-proof-chain-identity-mismatch'};if(Number(previous.chainDepth)+1!==chainDepth)return {ok:false,reason:'document-proof-chain-depth-mismatch'};
        const ancestor=verifyRecord(state,previous.id,seen,cache);if(!ancestor.ok)return ancestor;
      }
      const verified={ok:true,modern:true,record:clone(proofRecord)};cache?.records?.set(proofId,verified);return verified;
    }finally{seen.delete(proofId);}
  }
  function verifyEnvelope(document,record){if(document.contentDigest!==record.contentDigest)return {ok:false,reason:'document-digest-reference-mismatch'};const currentCompanyId=clean(document.company||document.companyId||'group',100);if(currentCompanyId!==record.companyId)return {ok:false,reason:'document-issuer-company-mismatch'};if(document.documentId!==record.documentId)return {ok:false,reason:'document-id-mismatch'};if(document.documentType!==record.documentType)return {ok:false,reason:'document-type-mismatch'};if(!document.issuerSnapshot||typeof document.issuerSnapshot!=='object'||Array.isArray(document.issuerSnapshot)||stable(document.issuerSnapshot)!==stable(record.issuerSnapshot))return {ok:false,reason:'document-issuer-snapshot-mismatch'};const currentCounterparty=counterpartySnapshot(document);if(!document.counterpartySnapshot||typeof document.counterpartySnapshot!=='object'||Array.isArray(document.counterpartySnapshot)||stable(currentCounterparty)!==stable(record.counterpartySnapshot)||stable(document.counterpartySnapshot)!==stable(record.counterpartySnapshot))return {ok:false,reason:'document-counterparty-mismatch'};if(clean(document.authorizationKind,40)!==clean(record.authorizationKind,40))return {ok:false,reason:'document-authorization-kind-mismatch'};if((document.authorizationProofId||null)!==(record.authorizationProofId||null))return {ok:false,reason:'document-authorization-reference-mismatch'};if(record.signatureSnapshot&&stable(document.signatureSnapshot)!==stable(record.signatureSnapshot))return {ok:false,reason:'document-signature-snapshot-mismatch'};return {ok:true,currentCompanyId,currentCounterparty};}
  function verifyDocument(state,document,cache=null){
    const record=getRecord(state,document?.documentProofId);if(!record)return {ok:false,reason:'document-proof-not-found'};const envelope=verifyEnvelope(document,record);if(!envelope.ok)return envelope;const recordVerification=verifyRecord(state,record.id,new Set(),cache),issuer={...clone(record.issuerSnapshot),companyId:envelope.currentCompanyId};
    if(Number(record.version)===2&&record.signedContent?.schema==='gh-signed-document-content-v2'){if(!(recordVerification.legacy&&recordVerification.recordIntegrity))return recordVerification;const content=signedContentV2(document,issuer,envelope.currentCounterparty,{issuedAtSim:record.signedContent?.issuedAtSim});const verifiedStable=cache?.signedContentStable?.get(record.id);if(verifiedStable!==undefined?stable(content)!==verifiedStable:digest(content)!==record.contentDigest)return {ok:false,reason:'document-content-tampered'};return recordVerification;}
    if(!recordVerification.ok)return recordVerification;if(Number(document.documentVersion)!==RECORD_VERSION||document.documentSchema!==CONTENT_SCHEMA)return {ok:false,reason:'document-proof-version-unsupported'};let content;try{content=signedContent(document,issuer,envelope.currentCounterparty,{issuedAtSim:record.signedContent?.issuedAtSim,fixedIssuedAt:true,chain:record.signedContent?.chain||null});}catch(error){return {ok:false,reason:String(error?.message||error)};}if(record.materialProfile!==content.material.profile)return {ok:false,reason:'document-material-profile-mismatch'};const verifiedStable=cache?.signedContentStable?.get(record.id);if(verifiedStable!==undefined?stable(content)!==verifiedStable:digest(content)!==record.contentDigest)return {ok:false,reason:'document-content-tampered'};return {ok:true,modern:true,record:clone(record)};
  }

  function firstDifferencePath(expected,actual,path='$'){
    if(Object.is(expected,actual))return null;
    if(Array.isArray(expected)||Array.isArray(actual)){
      if(!Array.isArray(expected)||!Array.isArray(actual))return path;
      if(expected.length!==actual.length)return `${path}.length`;
      for(let index=0;index<expected.length;index++){const diff=firstDifferencePath(expected[index],actual[index],`${path}[${index}]`);if(diff)return diff;}return null;
    }
    const expectedObject=expected&&typeof expected==='object',actualObject=actual&&typeof actual==='object';
    if(expectedObject||actualObject){if(!expectedObject||!actualObject)return path;const keys=[...new Set([...Object.keys(expected),...Object.keys(actual)])].sort();for(const key of keys){if(!Object.prototype.hasOwnProperty.call(expected,key)||!Object.prototype.hasOwnProperty.call(actual,key))return `${path}.${key}`;const diff=firstDifferencePath(expected[key],actual[key],`${path}.${key}`);if(diff)return diff;}return null;}
    return path;
  }
  function forensicDocument(state,entry){
    const document=entry?.document,proofId=document?.documentProofId||null,record=proofId?getRecord(state,proofId):null,verification=proofId?verifyDocument(state,document):{ok:true,reason:null};let differencePath=null,actualContentDigest=null;
    const envelopePaths={'document-digest-reference-mismatch':'$.contentDigest','document-issuer-company-mismatch':'$.company','document-id-mismatch':'$.documentId','document-type-mismatch':'$.documentType','document-issuer-snapshot-mismatch':'$.issuerSnapshot','document-counterparty-mismatch':'$.counterpartySnapshot','document-authorization-kind-mismatch':'$.authorizationKind','document-authorization-reference-mismatch':'$.authorizationProofId','document-signature-snapshot-mismatch':'$.signatureSnapshot'};differencePath=envelopePaths[verification?.reason]||null;
    if(proofId&&record&&verification?.reason==='document-content-tampered')try{const issuer={...clone(record.issuerSnapshot),companyId:clean(document.company||document.companyId||'group',100)},counterparty=counterpartySnapshot(document),content=Number(record.version)===2?signedContentV2(document,issuer,counterparty,{issuedAtSim:record.signedContent?.issuedAtSim}):signedContent(document,issuer,counterparty,{issuedAtSim:record.signedContent?.issuedAtSim,fixedIssuedAt:true,chain:record.signedContent?.chain||null});differencePath=firstDifferencePath(record.signedContent,content);actualContentDigest=digest(content);}catch(error){differencePath=`$<recompute:${String(error?.message||error)}>`;}
    return {path:entry?.path||null,role:entry?.role||null,documentId:documentId(document||{}),proofId,ok:verification?.ok===true,reason:verification?.reason||null,differencePath,expectedContentDigest:record?.contentDigest||null,actualContentDigest};
  }
  function forensicInspectStateProofs(state){
    const store=state?.documentProofs||{},recordsById=store.recordsById||{},archiveById=store.archiveById||{},documents=stateDocumentEntries(state),latent=[];
    for(const [company,book] of Object.entries(state.companyFinance||{}))if(Array.isArray(book?.ledger))for(let index=0;index<book.ledger.length;index++)if(book.ledger[index]?.documentProofId)latent.push({document:book.ledger[index],path:`companyFinance.${company}.ledger[${index}]`,role:'latent-ledger'});
    if(Array.isArray(state.treasury?.ledger))for(let index=0;index<state.treasury.ledger.length;index++)if(state.treasury.ledger[index]?.documentProofId)latent.push({document:state.treasury.ledger[index],path:`treasury.ledger[${index}]`,role:'latent-ledger'});
    const documentFailures=[],recordFailures=[],danglingReferences=[];for(const entry of [...documents,...latent]){const proofId=entry.document?.documentProofId;if(!proofId)continue;const detail=forensicDocument(state,entry);if(!getRecord(state,proofId))danglingReferences.push(detail);if(!detail.ok)documentFailures.push(detail);}
    for(const proofId of [...Object.keys(recordsById),...Object.keys(archiveById)]){const result=verifyRecord(state,proofId);if(!result.ok&&!result.legacy)recordFailures.push({proofId,reason:result.reason||null});}
    return {totalRecords:Object.keys(recordsById).length,totalArchived:Object.keys(archiveById).length,totalDocuments:documents.length,latentProtectedLedgerRows:latent.length,danglingReferences,documentFailures,recordFailures,ok:!danglingReferences.length&&!documentFailures.length&&!recordFailures.length};
  }
  function projectLedgerCopy(document,sourceRecord,overrides={}){
    const row=clone(document);clearSecurityEnvelope(row);Object.assign(row,clone(overrides||{}));row.ledgerProjectionSchema='gh-ledger-projection-v1';row.sourceDocumentProofId=sourceRecord?.id||document?.documentProofId||document?.sourceDocumentProofId||null;row.sourceDocumentId=sourceRecord?.documentId||document?.documentId||documentId(document||{})||null;row.sourceDocumentType=sourceRecord?.documentType||document?.documentType||documentType(document||{})||null;row.sourceDocumentDigest=sourceRecord?.contentDigest||document?.contentDigest||document?.sourceDocumentDigest||null;return row;
  }
  function ledgerProjection(state,document,overrides={}){
    if(!document||typeof document!=='object'||Array.isArray(document))throw new TypeError('ledger-document-object-required');if(!document.documentProofId)return Object.assign(clone(document),clone(overrides||{}));const verification=verifyDocument(state,document);if(!verification.ok)throw new Error(`ledger-source-document-invalid:${verification.reason}`);return projectLedgerCopy(document,verification.record,overrides);
  }
  function legacyLedgerProjection(state,document){
    const proofId=document?.documentProofId;if(!proofId)return clone(document);const record=getRecord(state,proofId);if(!record)throw new Error(`ledger-proof-migration:proof-not-found:${proofId}`);if(document.contentDigest!==record.contentDigest||document.documentId!==record.documentId)throw new Error(`ledger-proof-migration:envelope-mismatch:${proofId}`);const canonical=canonicalDocumentEntry(state,proofId);if(!canonical)throw new Error(`ledger-proof-migration:canonical-missing:${proofId}`);const canonicalVerification=verifyDocument(state,canonical.document);if(!canonicalVerification.ok)throw new Error(`ledger-proof-migration:canonical-invalid:${proofId}:${canonicalVerification.reason}`);
    const rowVerification=verifyDocument(state,document);if(rowVerification.ok)return projectLedgerCopy(document,record);
    // A player authorization is bound after the owner returns. Build 335 had
    // already copied the pre-authorization security envelope into company and
    // treasury ledgers, so those copies can differ from the canonical document
    // only in SECURITY_FIELDS. Material identity is sufficient to prove that
    // this is the same accounting row; any material difference still fails.
    const canonicalMaterial=clone(canonical.document),legacyMaterial=clone(document);clearSecurityEnvelope(canonicalMaterial);clearSecurityEnvelope(legacyMaterial);if(stable(canonicalMaterial)===stable(legacyMaterial))return projectLedgerCopy(canonical.document,record);
    // Build 335 also had one explicit material presentation transformation:
    // payroll-payable -> payroll-accrual changed only from/kind after sealing.
    if(record.documentType==='payroll-payable'&&document.kind==='payroll-accrual'&&document.from==='ذمم رواتب مستحقة'){
      const expected={...clone(canonical.document),from:'ذمم رواتب مستحقة',kind:'payroll-accrual'};clearSecurityEnvelope(expected);if(stable(expected)!==stable(legacyMaterial))throw new Error(`ledger-proof-migration:unexpected-payroll-diff:${proofId}`);return projectLedgerCopy(canonical.document,record,{from:'ذمم رواتب مستحقة',kind:'payroll-accrual'});
    }
    throw new Error(`ledger-proof-migration:unrecognized-invalid-ledger-copy:${proofId}:${rowVerification.reason}`);
  }
  function migrateLegacyLedgerProjections(state){
    const replacements=[];const queue=(container,index,path)=>{const row=container?.[index];if(!row?.documentProofId)return;replacements.push({container,index,path,value:legacyLedgerProjection(state,row)});};
    for(const [company,book] of Object.entries(state.companyFinance||{}))if(Array.isArray(book?.ledger))for(let index=0;index<book.ledger.length;index++)queue(book.ledger,index,`companyFinance.${company}.ledger[${index}]`);
    if(Array.isArray(state.treasury?.ledger))for(let index=0;index<state.treasury.ledger.length;index++)queue(state.treasury.ledger,index,`treasury.ledger[${index}]`);
    for(const [bucket,list] of Object.entries(state.finance?.auditArchive?.records||{}))if(String(bucket).startsWith('companyLedger-')&&Array.isArray(list))for(let index=0;index<list.length;index++)queue(list,index,`finance.auditArchive.records.${bucket}[${index}]`);
    for(const replacement of replacements)replacement.container[replacement.index]=replacement.value;
    return {changed:replacements.length>0,count:replacements.length,paths:replacements.map(row=>row.path)};
  }
  function locateDocument(state,proofId){return stateDocuments(state).find(document=>document?.documentProofId===proofId)||null;}
  function collectResultDocuments(state,result){const found=new Map(),seen=new Set();function visit(value,depth){if(!value||typeof value!=='object'||depth>7||seen.has(value))return;seen.add(value);if(value.documentProofId&&value.contentDigest){const actual=locateDocument(state,value.documentProofId)||value;found.set(value.documentProofId,{proofId:value.documentProofId,documentId:documentId(actual),digest:actual.contentDigest,document:actual});}if(Array.isArray(value)){for(const item of value)visit(item,depth+1);return;}for(const nested of Object.values(value))visit(nested,depth+1);}visit(result,0);return [...found.values()];}
  function bindAuthorization(state,documents,proof){if(!proof?.id)throw new Error('authorization-proof-required');ensure(state);const rows=Array.isArray(documents)?documents:[];for(const item of rows){const document=item.document||locateDocument(state,item.proofId),record=getRecord(state,item.proofId||document?.documentProofId);if(!document||!record)throw new Error('document-proof-not-found');if(Number(record.version)!==RECORD_VERSION)throw new Error('document-proof-legacy-read-only');const verification=verifyDocument(state,document);if(!verification.ok)throw new Error(`document-proof-invalid:${verification.reason}`);if(record.authorizationProofId&&record.authorizationProofId!==proof.id)throw new Error('document-already-authorized');if(!Array.isArray(proof.documentDigests)||!proof.documentDigests.includes(record.contentDigest))throw new Error('proof-document-digest-mismatch');if(!Array.isArray(proof.documentIds)||!proof.documentIds.includes(record.documentId))throw new Error('proof-document-id-mismatch');record.authorizationProofId=proof.id;record.authorizationKind=proof.mode;record.signatureSnapshot={kind:'visual-authorization-seal',visualSealAssetId:proof.visualSealAssetId||proof.signatureAssetId,visualSealVersion:proof.visualSealVersion??proof.signatureVersion,visualSealDigest:proof.visualSealDigest||proof.signatureDigest,signatureAssetId:proof.signatureAssetId,signatureVersion:proof.signatureVersion,signatureDigest:proof.signatureDigest,signerPersonId:proof.signerPersonId,signerNameSnapshot:proof.signerNameSnapshot,mandateId:proof.mandateId,mandateVersion:proof.mandateVersion,mandateDigest:proof.mandateDigest,signedAtSim:proof.signedAtSim};document.authorizationProofId=proof.id;document.authorizationKind=proof.mode;document.signatureSnapshot=clone(record.signatureSnapshot);}return rows.length;}
  function markLegacy(state,document,options={}){if(document.documentProofId)return verifyDocument(state,document);return sealDocument(state,document,{...options,authorizationKind:'legacy-name-only'});}
  const API=Object.freeze({VERSION,SCHEMA,CONTENT_SCHEMA,RECORD_VERSION,LIMITS,DOCUMENT_TYPES,TRANSITIONS,ensure,record:getRecord,records,compact,stateDocumentEntries,stateDocuments,companyProfile,issuerSnapshot,counterpartySnapshot,materialDetails,signedContent,sealDocument,amendDocument,markLegacy,verifyRecord,verifyDocument,forensicInspectStateProofs,ledgerProjection,migrateLegacyLedgerProjections,collectResultDocuments,bindAuthorization,locateDocument});globalThis.GH_DOCUMENT_PROOF=API;if(globalThis.window&&globalThis.window!==globalThis)globalThis.window.GH_DOCUMENT_PROOF=API;if(typeof module!=='undefined'&&module.exports)module.exports=API;
})();

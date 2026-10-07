(()=>{
  'use strict';
  const VERSION='1.2.0',SCHEMA='gh-document-proofs-v1',CONTENT_SCHEMA='gh-signed-document-content-v3',RECORD_VERSION=3;
  const LIMITS=Object.freeze({records:5000,materialBytes:512*1024,materialDepth:16,materialArray:8192,materialKeys:2048,chainDepth:64});
  const SECURITY_FIELDS=new Set(['documentSchema','documentVersion','documentProofId','documentId','documentType','issuerSnapshot','counterpartySnapshot','contentDigest','authorizationKind','authorizationProofId','signatureSnapshot','authorization','signatureAssetId','visualSealAssetId']);
  const DOCUMENT_TYPES=Object.freeze({
    'revenue-collection':'transfer-v3','invoice-receivable':'invoice-v3','invoice-payable':'invoice-v3','audit-invoice':'invoice-v3',
    'intercompany-transfer':'transfer-v3','intercompany-interest':'transfer-v3','intercompany-energy':'transfer-v3','intercompany-loan-principal':'transfer-v3','intercompany-loan-settlement':'transfer-v3',
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
  // Build 359: supersededById holds, whole, the earlier version of a document whose compact record was in the archive when
  // the document was amended (amendDocument, expandRecord); it stands for the archive's copy until maintenance makes it a
  // checkpoint (checkpointAncestors) or puts it in the archive (foldSuperseded).
  function getRecord(state,id){
    const store=state?.documentProofs||{},hot=store.recordsById?.[id],over=store.supersededById?.[id],cold=store.archiveById?.[id];
    if(over)return hot?null:over;
    return hot&&cold?null:(hot||cold||null);
  }
  function records(state){const store=state?.documentProofs||{},over=store.supersededById||{};return [...Object.values(store.recordsById||{}),...Object.values(over),...Object.entries(store.archiveById||{}).filter(([id])=>!Object.prototype.hasOwnProperty.call(over,id)).map(([,row])=>row)];}
  // Build 359 (bulk commands: one approval for hundreds of documents took 3.6 s on iPhone): a command's new records are
  // the ones its sequence range issued (createRecord is the only creator, DOCP-<sequence>), not a scan of every record
  // before and after it.
  function sequenceMark(state){const value=Number(state?.documentProofs?.sequence);return Number.isSafeInteger(value)&&value>=0?value:0;}
  function recordsSince(state,mark){const out=[],last=sequenceMark(state);for(let sequence=Math.max(0,Math.floor(Number(mark)||0))+1;sequence<=last;sequence++){const row=getRecord(state,`DOCP-${String(sequence).padStart(9,'0')}`);if(row)out.push(row);}return out;}
  // Build 359 (iPhone diagnostic: proof records were 31 MB of a 71.5 MB save): every amendment of a document (issued,
  // cheque issued, cleared, settled) adds a whole new record (~2.6-3.5 KB, its signed content copied in full), and the
  // earlier versions stay only so the newer one can prove its link to them. An earlier version whose chain verifies is
  // replaced by a checkpoint: the fields that link check reads (id, document, type, company, depth, content digest) and
  // its own link, ~300 bytes. Checkpoints are grouped by 30-day period; each period has one digest over its checkpoints
  // (periodDigests), so any edit of a checkpoint is detected. The current version of every document (what documents,
  // cheques and the documents view verify) stays a whole record.
  // Build 359 (a million assets): a period's digest is the sum (mod 2^256) of its checkpoints' own digests, so adding or
  // removing checkpoints updates it from those checkpoints alone instead of hashing the whole period again. An earlier
  // version becomes a checkpoint in the next maintenance pass whatever its age (waiting 30 days kept two whole records
  // for every cheque issued and cashed in that month), never inside a command: another copy of the document may still
  // carry the earlier version, and finding one takes every document.
  const CHECKPOINT_PERIOD_SECONDS=30*86400,CHECKPOINT_BATCH=400,CHECKPOINT_FIELDS=Object.freeze(['id','documentId','documentType','companyId','chainDepth','contentDigest','previousProofId','previousContentDigest','transition','createdAtSim','period']);
  const PERIOD_FORM='sum-v1',DIGEST_MOD=1n<<256n,isDigest=value=>/^[a-f0-9]{64}$/i.test(String(value||''));
  // Build 358 (save size): the current version of a document kept in the finance audit archive (archived rows are
  // sealed: never edited again) is stored in a compact archived form: the fields the chain, authorization and residency
  // checks read, the chain link and issue time of its signed content, and a digest of its signature snapshot. The signed
  // content (~1.8 KB) and the issuer, counterparty and signature snapshots (~0.9 KB) are not copied again: verification
  // rebuilds the signed content from the archived document and compares its digest with contentDigest (the digest the
  // authorization proof signed), so a change to the document or to the record is detected as with a whole record.
  const ARCHIVED_FORM='archived-document-v1',ARCHIVED_BATCH=200,ARCHIVED_FIELDS=Object.freeze(['id','version','form','documentId','documentType','companyId','materialProfile','contentDigest','previousProofId','previousContentDigest','transition','chainDepth','authorizationKind','authorizationProofId','createdAtSim','issuedAtSim','chain','signatureDigest']),ARCHIVED_KEYS=[...ARCHIVED_FIELDS].sort().join(',');
  // Build 359: archived-document-v2 also carries the digest of its authorization proof, recorded when that proof verified
  // whole. The document then no longer needs the proof itself (it may leave the authorization archive, whose 8 MB limit
  // stopped the daily close on a 347-day game); while the proof is still held it must verify and match that digest.
  const ARCHIVED_FORM_V2='archived-document-v2',ARCHIVED_FIELDS_V2=Object.freeze([...ARCHIVED_FIELDS,'authorizationDigest']),ARCHIVED_KEYS_V2=[...ARCHIVED_FIELDS_V2].sort().join(',');
  // Build 359: a new version of a container collection (archive, checkpoints, period sums, seals) declares what it changed
  // (GH_TRANSACTION_CORE.deriveContainer), so the save schema checks only that against the version it verified.
  const derive=(next,base,changes)=>{if(base&&next!==base)globalThis.GH_TRANSACTION_CORE?.deriveContainer?.(next,base,changes);return next;};
  const isArchivedForm=record=>!!record&&typeof record==='object'&&(record.form===ARCHIVED_FORM||record.form===ARCHIVED_FORM_V2);
  // Build 359 (owner: the live records 80% smaller): a document's current record is issued in the compact form, the
  // archived form's fields (compact-document-v1): the signed content (~2.1 KB, a copy of the document) and the issuer and
  // counterparty snapshots are not kept; verifying the document rebuilds its signed content and compares the digest the
  // record (and the authorization proof) carry. Unlike the archived forms it may be amended: the amendment keeps the
  // earlier version whole, rebuilt from the document before the change (expandRecord), for the chain and the checkpoints.
  // It does not keep the chain object either: the content's chain link is the record's own link fields (chainOf).
  const COMPACT_FORM='compact-document-v1',COMPACT_FIELDS=Object.freeze(ARCHIVED_FIELDS.filter(field=>field!=='chain')),COMPACT_KEYS=[...COMPACT_FIELDS].sort().join(',');
  const isCompactForm=record=>!!record&&typeof record==='object'&&record.form===COMPACT_FORM;
  const chainOf=record=>isCompactForm(record)?(Number(record.chainDepth)>0?{previousProofId:record.previousProofId,previousContentDigest:record.previousContentDigest,transition:record.transition,depth:record.chainDepth}:null):(record.chain??null);
  const releasesAuthorization=record=>!!record&&record.form===ARCHIVED_FORM_V2&&!!record.authorizationProofId&&isDigest(record.authorizationDigest);
  const checkpointPeriod=createdAtSim=>`P${String(Math.max(0,Math.floor((Number(createdAtSim)||0)/CHECKPOINT_PERIOD_SECONDS))).padStart(4,'0')}`;
  function getCheckpoint(state,id){const row=state?.documentProofs?.checkpointsById?.[id];return row&&typeof row==='object'&&!Array.isArray(row)?row:null;}
  function checkpointEntry(row){return CHECKPOINT_FIELDS.map(field=>row[field]??null);}
  // A checkpoint's (or a seal row's) own digest. Both are sealed (never edited), so it is computed once per row.
  const ROW_DIGEST=new WeakMap();
  function rowDigest(row,entry){let known=ROW_DIGEST.get(row);if(known===undefined){known=digest(stable(entry(row)));ROW_DIGEST.set(row,known);}return known;}
  const checkpointDigest=row=>rowDigest(row,checkpointEntry);
  const sumOf=hex=>BigInt(`0x${hex}`),hexOf=value=>value.toString(16).padStart(64,'0');
  // Period entries and checkpoints verified in this process or written by it from verified records. Rows and entries
  // are never edited (a writer replaces an entry), so identity stands for content.
  const VERIFIED_CHECKPOINTS=new WeakSet(),VERIFIED_PERIODS=new WeakSet();
  // A new period map in which rows were added (sign 1) or removed (sign -1): each touched period gets a new entry, its
  // count and digest moved by those rows alone; an emptied period is dropped. A new entry is trusted only if the entry
  // it replaces was (or there was none), so a changed entry from a save is still caught by the next full check.
  function adjustPeriods(periods,rows,sign,digestOf,trusted=VERIFIED_PERIODS){
    const next={...(periods||{})},changes=new Map();
    for(const row of rows){const change=changes.get(row.period)||{count:0,total:0n};change.count+=sign;change.total+=BigInt(sign)*sumOf(digestOf(row));changes.set(row.period,change);}
    for(const [period,change] of changes){
      const entry=next[period];if(entry&&entry.form!==PERIOD_FORM)throw new Error('document-proof-period-legacy-form');
      const count=(Number(entry?.count)||0)+change.count;if(!Number.isSafeInteger(count)||count<0)throw new Error('document-proof-period-count');
      if(!count){delete next[period];continue;}
      const fresh={period,form:PERIOD_FORM,count,digest:hexOf((((entry?sumOf(entry.digest):0n)+change.total)%DIGEST_MOD+DIGEST_MOD)%DIGEST_MOD)};
      if(trusted&&(!entry||trusted.has(entry)))trusted.add(fresh);next[period]=fresh;
    }
    return derive(next,periods,{changed:[...changes.keys()].filter(period=>next[period]),removed:[...changes.keys()].filter(period=>!next[period])});
  }
  // Build 359: a period entry written before the sum form (one digest over the period's sorted checkpoints) is checked in
  // that form once, at load, and rewritten as a sum; an entry that does not verify is left as it is and refused.
  function migratePeriodDigests(state){
    const store=state?.documentProofs,periods=store?.periodDigests;if(!periods||typeof periods!=='object'||Array.isArray(periods))return {changed:false,count:0};
    const legacy=Object.entries(periods).filter(([,entry])=>entry&&typeof entry==='object'&&entry.form===undefined);if(!legacy.length)return {changed:false,count:0};
    const grouped=new Map();for(const row of Object.values(store.checkpointsById||{})){const list=grouped.get(row?.period)||[];list.push(row);grouped.set(row?.period,list);}
    const next={...periods};let count=0;
    for(const [period,entry] of legacy){const list=grouped.get(period)||[],sorted=list.slice().sort((a,b)=>String(a.id).localeCompare(String(b.id))).map(checkpointEntry);if(entry.period!==period||entry.count!==list.length||digest(stable(sorted))!==entry.digest)continue;next[period]={period,form:PERIOD_FORM,count:list.length,digest:hexOf(list.reduce((total,row)=>(total+sumOf(checkpointDigest(row)))%DIGEST_MOD,0n))};count++;}
    if(count)store.periodDigests=derive(next,periods,{changed:legacy.map(([period])=>period).filter(period=>next[period]!==periods[period])});return {changed:count>0,count};
  }
  function checkpointRowFault(row,id){
    if(!row||typeof row!=='object'||Array.isArray(row)||row.id!==id||Object.keys(row).sort().join(',')!==CHECKPOINT_KEYS||!isDigest(row.contentDigest)||!clean(row.documentId)||!Number.isSafeInteger(row.chainDepth)||row.chainDepth<0||row.chainDepth>LIMITS.chainDepth||row.period!==checkpointPeriod(row.createdAtSim))return 'document-proof-checkpoint-record';
    if(row.chainDepth>0?!(row.previousProofId&&isDigest(row.previousContentDigest)):row.previousProofId!==null)return 'document-proof-checkpoint-chain';
    return null;
  }
  // Build 359: the fresh check of verifyCheckpoints in parts, for the proof audit (GH_SAVE_SCHEMA.createProofAudit). The
  // checkpoint map and the period map are replaced by every writer (never edited), so the maps taken when the walk starts
  // are one consistent version: each row is checked (shape, residency) and its digest added to its period's sum, one row
  // per step, then each period entry is compared with its sum, one entry per step. Nothing is copied or grouped in one
  // step (the plan this replaces grouped every checkpoint at once). Returns {ok,reason}.
  function* checkpointAuditSteps(state){
    const store=state?.documentProofs||{},rows=store.checkpointsById,periods=store.periodDigests;
    if(rows===undefined&&periods===undefined)return {ok:true};
    if(!rows||typeof rows!=='object'||Array.isArray(rows)||!periods||typeof periods!=='object'||Array.isArray(periods))return {ok:false,reason:'document-proof-checkpoint-shape'};
    const sums=new Map(),own=Object.prototype.hasOwnProperty;
    for(const id in rows){
      if(!own.call(rows,id))continue;yield 'checkpoint';const row=rows[id],fault=checkpointRowFault(row,id);if(fault)return {ok:false,reason:fault};
      if(own.call(store.recordsById||{},id)||own.call(store.archiveById||{},id)||own.call(store.supersededById||{},id))return {ok:false,reason:'document-proof-checkpoint-residency'};
      const sum=sums.get(row.period)||{count:0,total:0n};sum.count++;sum.total=(sum.total+sumOf(checkpointDigest(row)))%DIGEST_MOD;sums.set(row.period,sum);
    }
    for(const period in periods){
      if(!own.call(periods,period))continue;yield 'checkpoint-period';const entry=periods[period],sum=sums.get(period);
      if(!sum)return {ok:false,reason:'document-proof-checkpoint-period-unused'};
      if(!entry||entry.period!==period||entry.form!==PERIOD_FORM||entry.count!==sum.count||!isDigest(entry.digest))return {ok:false,reason:'document-proof-checkpoint-period'};
      if(hexOf(sum.total)!==entry.digest)return {ok:false,reason:'document-proof-checkpoint-period-tampered'};
      sums.delete(period);
    }
    if(sums.size)return {ok:false,reason:'document-proof-checkpoint-period'};
    return {ok:true};
  }
  // Build 359: every legal document of the state, one at a time and without copying a list (the proof audit's walk). A
  // list is read in place; rows put at its head while the walk is suspended are stepped over (the walk finds its place
  // again by the last row it gave, within WALK_RELOCATE rows), so a row present when the walk passes is given once.
  // Ledger projections in the audit archive are documents too, as for stateDocuments.
  const WALK_RELOCATE=20000;
  function* walkDocuments(state){
    const walkList=function*(list){
      let at=0;
      while(at<list.length){
        const row=list[at++];if(row&&typeof row==='object')yield row;
        if(list[at-1]!==row){let found=-1;for(let probe=at;probe<list.length&&probe<at+WALK_RELOCATE;probe++)if(list[probe]===row){found=probe;break;}if(found>=0)at=found+1;}
      }
    };
    for(const bucket of financeBuckets){const list=state.finance?.[bucket];if(Array.isArray(list))yield* walkList(list);}
    const registry=state.contractRegistry;if(registry&&typeof registry==='object')for(const id in registry)if(Object.prototype.hasOwnProperty.call(registry,id)&&registry[id]&&typeof registry[id]==='object')yield registry[id];
    const records=state.finance?.auditArchive?.records;if(records&&typeof records==='object')for(const kind in records)if(Object.prototype.hasOwnProperty.call(records,kind)&&Array.isArray(records[kind]))yield* walkList(records[kind]);
  }
  // The whole check (save schema, or a checkpoint not yet verified). Rows and entries verified before are not hashed again
  // unless {fresh:true}; the shape, residency and period membership are checked every time.
  function verifyCheckpoints(state,cache=null,{fresh=false}={}){
    if(cache?.checkpoints&&!fresh)return cache.checkpoints;
    const store=state?.documentProofs||{},rows=store.checkpointsById,periods=store.periodDigests;
    const done=out=>{if(cache)cache.checkpoints=out;return out;},fail=reason=>done({ok:false,reason});
    if(rows===undefined&&periods===undefined)return done({ok:true});
    if(!rows||typeof rows!=='object'||Array.isArray(rows)||!periods||typeof periods!=='object'||Array.isArray(periods))return fail('document-proof-checkpoint-shape');
    const known=row=>!fresh&&VERIFIED_CHECKPOINTS.has(row),grouped=new Map();
    for(const [id,row] of Object.entries(rows)){
      if(!known(row)){const fault=checkpointRowFault(row,id);if(fault)return fail(fault);}
      if(store.recordsById?.[id]||store.archiveById?.[id]||store.supersededById?.[id])return fail('document-proof-checkpoint-residency');
      const list=grouped.get(row.period);if(list)list.push(row);else grouped.set(row.period,[row]);
    }
    for(const key of Object.keys(periods))if(!grouped.has(key))return fail('document-proof-checkpoint-period-unused');
    for(const [period,list] of grouped){
      const entry=periods[period];if(!entry||entry.period!==period||entry.form!==PERIOD_FORM||entry.count!==list.length||!isDigest(entry.digest))return fail('document-proof-checkpoint-period');
      if(!fresh&&VERIFIED_PERIODS.has(entry)&&list.every(known))continue;
      if(hexOf(list.reduce((total,row)=>(total+sumOf(checkpointDigest(row)))%DIGEST_MOD,0n))!==entry.digest)return fail('document-proof-checkpoint-period-tampered');
      VERIFIED_PERIODS.add(entry);for(const row of list)VERIFIED_CHECKPOINTS.add(row);
    }
    return done({ok:true});
  }
  // A checkpoint predecessor is trusted when it and its period entry were verified (or written) in this process.
  function checkpointTrusted(state,row){return VERIFIED_CHECKPOINTS.has(row)&&VERIFIED_PERIODS.has(state?.documentProofs?.periodDigests?.[row.period]);}
  // Build 359: for the save schema's archive memo (a new checkpoint or period entry written by a trusted writer is not
  // checked again when only the changes since a verified version are checked).
  const checkpointVerified=row=>VERIFIED_CHECKPOINTS.has(row),periodVerified=entry=>VERIFIED_PERIODS.has(entry);
  const CHECKPOINT_KEYS=[...CHECKPOINT_FIELDS].sort().join(',');
  // Up to CHECKPOINT_BATCH earlier versions per call, oldest first. A version becomes a checkpoint only when a newer
  // record links to it, no document or ledger row points at it as its current proof, and its chain verifies now.
  // Everything is prepared before the store is published, so a failure changes nothing.
  // Build 359 (a million assets: every pass listed every record, document and ledger row, 17 ms on the desktop at 12,000
  // documents, each game hour): a version can become a checkpoint only once a newer record links to it, and records are
  // issued in sequence (DOCP-<sequence>). A pass takes the predecessors of the records issued since the last pass
  // (recordsSince) and those it left (the batch limit), per state. The first pass for a state, a pass after the sequence
  // went back (a rollback, a load) and every CHECKPOINT_SWEEP-th pass list every record instead, as before, so nothing a
  // pass skipped (a pinned version, one whose chain did not verify then) stays out for long. A document's current proof
  // is pinned: the live documents, contracts and ledgers are read each pass; an audit archive collection's proofs once
  // per version of it.
  const CHECKPOINT_PASSES=new WeakMap(),CHECKPOINT_SWEEP=24,ARCHIVE_PROOF_IDS=new WeakMap();
  function archivedProofIds(list){let ids=ARCHIVE_PROOF_IDS.get(list);if(!ids){ids=new Set();for(const row of list)if(row?.documentProofId)ids.add(row.documentProofId);if(Object.isFrozen(list))ARCHIVE_PROOF_IDS.set(list,ids);}return ids;}
  // Build 359: an earlier version kept in supersededById that does not become a checkpoint now (pinned, its chain not
  // verifying, or beyond this pass's batch and no longer pending) replaces the archive's compact copy, so the overlay
  // empties; one still pending stays for the next pass.
  function foldSuperseded(state,pending){
    const store=state.documentProofs,over=store?.supersededById;if(!over)return;
    const fold=Object.keys(over).filter(id=>!pending.has(id));if(!fold.length){if(!Object.keys(over).length)delete store.supersededById;return;}
    const cold={...(store.archiveById||{})},next={...over};for(const id of fold){cold[id]=over[id];delete next[id];}
    store.archiveById=derive(cold,store.archiveById,{changed:fold});if(Object.keys(next).length)store.supersededById=next;else delete store.supersededById;
  }
  function checkpointAncestors(state,{limit=CHECKPOINT_BATCH}={}){
    const store=ensure(state),hot=store.recordsById,cold=store.archiveById||{},mark=sequenceMark(state);
    let pass=CHECKPOINT_PASSES.get(state);
    // A pass inside a transaction that rolls back leaves the list as it was (its conversions are undone too).
    {const prior=pass?{mark:pass.mark,count:pass.count,pending:new Set(pass.pending)}:null,tx=globalThis.GH_TRANSACTION_CORE;if(tx?.isActive?.())tx.registerUndo(()=>{if(prior)CHECKPOINT_PASSES.set(state,prior);else CHECKPOINT_PASSES.delete(state);});}
    if(!pass||mark<pass.mark||pass.count%CHECKPOINT_SWEEP===0){
      const linked=new Set();for(const row of Object.values(hot))if(row?.previousProofId)linked.add(row.previousProofId);for(const row of Object.values(cold))if(row?.previousProofId)linked.add(row.previousProofId);
      pass={mark,count:(pass?.count||0)+1,pending:linked};CHECKPOINT_PASSES.set(state,pass);
    }else{for(const row of recordsSince(state,pass.mark))if(row?.previousProofId)pass.pending.add(row.previousProofId);pass.mark=mark;pass.count++;}
    if(!pass.pending.size){foldSuperseded(state,new Set());return {checkpointed:0,remaining:0};}
    const pinned=new Set(),pin=row=>{if(row?.documentProofId)pinned.add(row.documentProofId);};
    for(const bucket of financeBuckets)for(const row of Array.isArray(state.finance?.[bucket])?state.finance[bucket]:[])pin(row);
    for(const row of Object.values(state.contractRegistry||{}))pin(row);
    for(const [,book] of Object.entries(state.companyFinance||{}))if(Array.isArray(book?.ledger))for(const row of book.ledger)pin(row);
    for(const row of Array.isArray(state.treasury?.ledger)?state.treasury.ledger:[])pin(row);
    const archivedLists=Object.values(state.finance?.auditArchive?.records||{}).filter(Array.isArray).map(archivedProofIds),isPinned=id=>pinned.has(id)||archivedLists.some(ids=>ids.has(id));
    // A pending id that is pinned, already a checkpoint or gone leaves the list (the next sweep finds it again if it should).
    const candidates=[];for(const id of pass.pending){const row=getRecord(state,id);if(row&&!isPinned(row.id)&&Number(row.version)===RECORD_VERSION&&!isArchivedForm(row))candidates.push(row);else pass.pending.delete(id);}
    candidates.sort((a,b)=>(Number(a.createdAtSim)||0)-(Number(b.createdAtSim)||0)||String(a.id).localeCompare(String(b.id)));
    const cache={records:new Map(),signedContentStable:new Map()},made=[];
    for(const row of candidates){
      if(made.length>=limit)break;if(!verifyRecord(state,row.id,new Set(),cache).ok){pass.pending.delete(row.id);continue;}
      const checkpoint={};for(const field of CHECKPOINT_FIELDS)checkpoint[field]=field==='period'?checkpointPeriod(row.createdAtSim):field==='chainDepth'?Number(row.chainDepth)||0:field==='createdAtSim'?Number(row.createdAtSim)||0:(row[field]??null);
      made.push(checkpoint);
    }
    if(!made.length){foldSuperseded(state,new Set(pass.pending));return {checkpointed:0,remaining:0};}
    for(const row of made)pass.pending.delete(row.id);
    // The archive is copied only when versions leave it (an unchanged archive keeps its version).
    const madeIds=made.map(row=>row.id),fromCold=madeIds.filter(id=>Object.prototype.hasOwnProperty.call(cold,id));
    const rows={...(store.checkpointsById||{})},nextHot={...hot},nextCold=fromCold.length?{...cold}:cold;
    for(const checkpoint of made){if(rows[checkpoint.id])throw new Error('document-proof-checkpoint-collision');rows[checkpoint.id]=checkpoint;delete nextHot[checkpoint.id];if(fromCold.length)delete nextCold[checkpoint.id];}
    const periods=adjustPeriods(store.periodDigests,made,1,checkpointDigest);
    store.recordsById=nextHot;store.archiveById=fromCold.length?derive(nextCold,store.archiveById,{removed:fromCold}):cold;store.checkpointsById=derive(rows,store.checkpointsById,{changed:madeIds});store.periodDigests=periods;for(const checkpoint of made)VERIFIED_CHECKPOINTS.add(checkpoint);
    {const over=store.supersededById,gone=over?madeIds.filter(id=>Object.prototype.hasOwnProperty.call(over,id)):[];if(gone.length){const next={...over};for(const id of gone)delete next[id];store.supersededById=next;}}
    foldSuperseded(state,new Set(pass.pending));
    return {checkpointed:made.length,remaining:Math.max(0,candidates.length-made.length)};
  }
  // Up to ARCHIVED_BATCH records of documents in the finance audit archive are rewritten in the archived form, each only
  // when its document verifies whole now. Every rewritten record is verified again in its new form against its
  // document before the store is published, so a failure changes nothing.
  // Build 359 (a million assets: every pass listed every document with its path, 7 ms on the desktop at 12,000 documents,
  // each game hour): a pass reads the audit archive collections (the documents this converts) and, per state, remembers
  // each sealed collection (frozen, replaced by its writers) it read through: a later version of a collection read (a writer declared what it added,
  // GH_TRANSACTION_CORE.deriveContainer) is read for its new documents only, and one already read is skipped. Every
  // ARCHIVED_SWEEP-th pass reads them all again (a document skipped then, its record not yet convertible, is retried).
  const ARCHIVED_PASSES=new WeakMap(),ARCHIVED_SWEEP=24;
  function* archivedCandidates(state,pass){
    for(const [bucket,list] of Object.entries(state?.finance?.auditArchive?.records||{})){
      if(String(bucket).startsWith('companyLedger-')||!Array.isArray(list)||pass.read.get(list)===pass.sweep)continue;
      const base=pass.last.get(bucket),changes=base&&pass.read.get(base)===pass.sweep?globalThis.GH_TRANSACTION_CORE?.containerChanges?.(list,base):null;
      yield {bucket,list,members:changes?changes.changed:list};
    }
  }
  function compactArchivedRecords(state,{limit=ARCHIVED_BATCH}={}){
    const store=ensure(state),cache={records:new Map(),signedContentStable:new Map()},made=[];
    let pass=ARCHIVED_PASSES.get(state);if(!pass){pass={count:0,sweep:0,read:new WeakMap(),last:new Map()};ARCHIVED_PASSES.set(state,pass);}
    pass.count++;if(pass.count%ARCHIVED_SWEEP===0)pass.sweep++;
    // A pass inside a transaction that rolls back forgets the collections it read (its conversions are undone too).
    const readNow=[],tx=globalThis.GH_TRANSACTION_CORE;if(tx?.isActive?.()){const last=new Map(pass.last);tx.registerUndo(()=>{for(const list of readNow)pass.read.delete(list);pass.last=last;});}
    for(const {bucket,list,members} of archivedCandidates(state,pass)){
      let complete=true;
      for(const document of members){
        if(made.length>=limit){complete=false;break;}if(!document||typeof document!=='object')continue;
        const record=getRecord(state,document.documentProofId);
        if(!record||record.form===ARCHIVED_FORM_V2||Number(record.version)!==RECORD_VERSION||store.supersededById?.[record.id]||archivedDocument(state,record.id)!==document)continue;
        if(!isArchivedForm(record)&&!isCompactForm(record)&&record.signedContent?.schema!==CONTENT_SCHEMA)continue;
        if(!verifyDocument(state,document,cache).ok)continue;
        // Build 359: the digest of the authorization proof that verified just now (verifyDocument checked it).
        const proof=record.authorizationProofId?(state.authorization?.proofsById?.[record.authorizationProofId]||state.authorization?.proofArchiveById?.[record.authorizationProofId]):null;if(record.authorizationProofId&&!proof)continue;
        const compact={};
        if(record.form===ARCHIVED_FORM||record.form===COMPACT_FORM){for(const field of ARCHIVED_FIELDS)compact[field]=field==='form'?ARCHIVED_FORM_V2:field==='chain'?clone(chainOf(record)):(record[field]??null);}
        else for(const field of ARCHIVED_FIELDS)compact[field]=field==='form'?ARCHIVED_FORM_V2:field==='issuedAtSim'?Number(record.signedContent.issuedAtSim)||0:field==='chain'?clone(record.signedContent.chain??null):field==='signatureDigest'?signatureDigestOf(record.signatureSnapshot):(record[field]??null);
        compact.authorizationDigest=proof?proof.proofDigest:null;
        made.push({compact,hot:store.recordsById[record.id]===record});
      }
      // A collection read to its end is remembered (its next version is read for its new documents only).
      if(complete&&Object.isFrozen(list)){pass.read.set(list,pass.sweep);pass.last.set(bucket,list);readNow.push(list);}
      if(made.length>=limit)break;
    }
    if(!made.length)return {compacted:0};
    // The archive is copied only when records in it are rewritten (an unchanged archive keeps its version).
    const coldIds=made.filter(row=>!row.hot).map(row=>row.compact.id),nextHot={...store.recordsById},nextCold=coldIds.length?{...(store.archiveById||{})}:(store.archiveById||{});
    for(const {compact,hot} of made)(hot?nextHot:nextCold)[compact.id]=compact;
    const trial={...state,documentProofs:{...store,recordsById:nextHot,archiveById:nextCold}};
    for(const {compact} of made){const check=verifyDocument(trial,archivedDocument(state,compact.id));if(!check.ok)throw new Error(`document-proof-archived-form:${compact.id}:${check.reason}`);}
    store.recordsById=nextHot;if(coldIds.length)store.archiveById=derive(nextCold,store.archiveById,{changed:coldIds});
    return {compacted:made.length};
  }
  // Build 359 (owner: the live records 80% smaller): the whole current records of live documents (and contracts) issued
  // before the compact form take it, up to `limit` per pass, each only when its document verifies whole now; the compact
  // record is verified against the document before the store is published. A record in the archive is replaced in a
  // new archive (one per pass). A pass reads at most `scan` documents, from where the previous pass for this state
  // stopped (live lists, then contracts); the live lists change between passes, so a document passed over is read in a
  // later round. Records are issued compact, so once the old ones are converted a pass only reads.
  const LIVE_COMPACT_BATCH=200,LIVE_COMPACT_SCAN=2000,LIVE_CURSORS=new WeakMap();
  function compactLiveRecords(state,{limit=LIVE_COMPACT_BATCH,scan=LIVE_COMPACT_SCAN}={}){
    const store=ensure(state),cache={records:new Map(),signedContentStable:new Map()},made=[],taken=new Set(),cursor=LIVE_CURSORS.get(state)||{source:0,index:0};
    const consider=document=>{
      if(!document||typeof document!=='object'||!document.documentProofId)return;
      const record=getRecord(state,document.documentProofId);if(!record||isArchivedForm(record)||isCompactForm(record)||Number(record.version)!==RECORD_VERSION||record.signedContent?.schema!==CONTENT_SCHEMA)return;
      const hot=store.recordsById[record.id]===record,cold=!hot&&store.archiveById?.[record.id]===record;if(!hot&&!cold)return;
      if(taken.has(record.id)||!verifyDocument(state,document,cache).ok)return;
      const compact={};for(const field of COMPACT_FIELDS)compact[field]=field==='form'?COMPACT_FORM:field==='issuedAtSim'?Number(record.signedContent.issuedAtSim)||0:field==='signatureDigest'?signatureDigestOf(record.signatureSnapshot):(record[field]??null);
      taken.add(record.id);made.push({compact,document,hot});
    };
    let {source,index}=cursor,read=0;
    while(read<scan&&made.length<limit){
      if(source<financeBuckets.length){const list=state.finance?.[financeBuckets[source]];if(!Array.isArray(list)||index>=list.length){source++;index=0;continue;}consider(list[index++]);read++;continue;}
      // Contracts last (a map: the cursor counts its entries); a pass that reaches their end starts the next one from the top.
      const registry=state.contractRegistry&&typeof state.contractRegistry==='object'?state.contractRegistry:{};let position=0,end=true;
      for(const id in registry){if(!Object.prototype.hasOwnProperty.call(registry,id)||position++<index)continue;if(read>=scan||made.length>=limit){end=false;break;}consider(registry[id]);index++;read++;}
      if(end){source=0;index=0;}break;
    }
    LIVE_CURSORS.set(state,{source,index});
    if(!made.length)return {compacted:0,read};
    const nextHot={...store.recordsById},coldIds=made.filter(row=>!row.hot).map(row=>row.compact.id),nextCold=coldIds.length?{...(store.archiveById||{})}:(store.archiveById||{});
    for(const {compact,hot} of made)(hot?nextHot:nextCold)[compact.id]=compact;
    const trial={...state,documentProofs:{...store,recordsById:nextHot,archiveById:nextCold}};
    for(const {compact,document} of made){const check=verifyDocument(trial,document);if(!check.ok)throw new Error(`document-proof-compact-form:${compact.id}:${check.reason}`);}
    store.recordsById=nextHot;if(coldIds.length)store.archiveById=derive(nextCold,store.archiveById,{changed:coldIds});
    return {compacted:made.length,read};
  }
  // Build 359 (a million assets: issuing stopped at about 6,000 documents with document-proof-archive-byte-limit): the
  // oldest 200 hot records move to the archive and nothing stops an issue. The archive is bounded by the finance audit
  // archive's retention (sealDocuments) and the live lists' caps, not by a byte limit measured on every admission (that
  // serialized the whole archive, 16 MB, every 200 documents). Unreferenced records are collected by maintenance (compact).
  // Build 359: the hot count is read once every ADMISSION_STRIDE issues (Object.keys of 5,000 records on every issue was
  // the largest part of a document's own cost). A check admits from ADMISSION_STRIDE below the limit, so the hot window
  // stays under 5,000 between checks. A new map (a writer replaced it) or a lower sequence (a rollback) checks again.
  const ADMISSION_STRIDE=64,ADMISSION_CHECKED=new WeakMap();
  function admissionDue(store){
    const hot=store.recordsById,checked=ADMISSION_CHECKED.get(hot);if(checked!==undefined&&store.sequence>=checked&&store.sequence-checked<ADMISSION_STRIDE)return false;
    ADMISSION_CHECKED.set(hot,store.sequence);return Object.keys(hot).length>=LIMITS.records-ADMISSION_STRIDE;
  }
  function archiveForAdmission(state){
    const store=ensure(state),hot=store.recordsById,cold=store.archiveById||{};
    const moving=Object.values(hot).sort((a,b)=>(Number(a.createdAtSim)||0)-(Number(b.createdAtSim)||0)||String(a.id).localeCompare(String(b.id))).slice(0,200);
    const next={...cold};
    for(const row of moving){if(Object.prototype.hasOwnProperty.call(next,row.id))throw new Error('document-proof-residency-conflict');next[row.id]=row;}
    // All fallible preparation finishes before publishing the move; no copy is
    // discarded until the archive destination has been prepared successfully.
    const nextHot={...hot};for(const row of moving)delete nextHot[row.id];
    store.archiveById=derive(next,store.archiveById,{changed:moving.map(row=>row.id)});store.recordsById=nextHot;
  }
  // Build 359 (owner: a million assets with their invoices, cheques and documents; the finance audit archive keeps every
  // document in full for 12 game months and at most 20,000 documents): a document leaving the audit archive is sealed. Its
  // proof record and the checkpoints of its earlier versions leave the store; one digest per 30-day period (sealedPeriods,
  // the sum of the sealed documents' own digests, as periodDigests) keeps each sealed document's proof id, document id,
  // type, company, depth, content digest and authorization digest. A document is sealed only when it verifies whole now,
  // when it is the one canonical copy in the audit archive, and when no kept document, ledger row or other record still
  // carries its proof or an earlier version of it. Everything is prepared before the store is published.
  const SEAL_FIELDS=Object.freeze(['id','documentId','documentType','companyId','chainDepth','contentDigest','authorizationProofId','authorizationDigest','createdAtSim','period']),SEAL_KEYS=[...SEAL_FIELDS].sort().join(',');
  const sealEntry=row=>SEAL_FIELDS.map(field=>row[field]??null),sealDigest=row=>rowDigest(row,sealEntry);
  function heldAuthorizationDigest(state,record){
    if(record.form===ARCHIVED_FORM_V2)return record.authorizationDigest??null;if(!record.authorizationProofId)return null;
    const proof=state.authorization?.proofsById?.[record.authorizationProofId]||state.authorization?.proofArchiveById?.[record.authorizationProofId];return proof?.proofDigest||null;
  }
  // `deadline` (a performance.now() time) stops the verification once passed, after at least one document; `examined`
  // says how many documents were considered, so the caller keeps the rest for its next round.
  function sealDocuments(state,documents,{keep=new Set(),deadline=Infinity}={}){
    const store=ensure(state),cache={records:new Map(),signedContentStable:new Map()},linkers=new Map(),count=id=>{if(id)linkers.set(id,(linkers.get(id)||0)+1);};
    for(const row of Object.values(store.recordsById))count(row?.previousProofId);for(const row of Object.values(store.archiveById||{}))count(row?.previousProofId);for(const row of Object.values(store.checkpointsById||{}))count(row?.previousProofId);
    const sealed=[],entries=[],records=new Set(),checkpoints=[],clock=()=>globalThis.performance?.now?.()??Date.now();let examined=0;
    for(const document of documents){
      if(examined&&clock()>deadline)break;examined++;
      const id=document?.documentProofId,record=id?getRecord(state,id):null;
      if(!record||keep.has(id)||linkers.has(id)||store.supersededById?.[id]||archivedDocument(state,id)!==document||Number(record.version)!==RECORD_VERSION||!verifyDocument(state,document,cache).ok)continue;
      const chain=[],chainCheckpoints=[];let prior=record.previousProofId,ok=true;
      for(let guard=0;prior&&ok;guard++){
        if(guard>LIMITS.chainDepth||keep.has(prior)||(linkers.get(prior)||0)!==1||store.supersededById?.[prior]){ok=false;break;}
        const row=getRecord(state,prior);if(row){chain.push(prior);prior=row.previousProofId;continue;}
        const checkpoint=getCheckpoint(state,prior);if(!checkpoint){ok=false;break;}chainCheckpoints.push(checkpoint);prior=checkpoint.previousProofId;
      }
      if(!ok)continue;
      const entry={};for(const field of SEAL_FIELDS)entry[field]=field==='period'?checkpointPeriod(record.createdAtSim):field==='chainDepth'?Number(record.chainDepth)||0:field==='createdAtSim'?Number(record.createdAtSim)||0:field==='authorizationDigest'?heldAuthorizationDigest(state,record):(record[field]??null);
      sealed.push(document);entries.push(entry);records.add(id);for(const prior of chain)records.add(prior);checkpoints.push(...chainCheckpoints);
    }
    if(!sealed.length)return {sealed:[],examined,records:0,checkpoints:0};
    const nextHot={...store.recordsById},nextCold={...(store.archiveById||{})};for(const id of records){delete nextHot[id];delete nextCold[id];}
    const nextCheckpoints={...(store.checkpointsById||{})};for(const row of checkpoints)delete nextCheckpoints[row.id];
    const periods=checkpoints.length?adjustPeriods(store.periodDigests,checkpoints,-1,checkpointDigest):store.periodDigests,seals=adjustPeriods(store.sealedPeriods,entries,1,sealDigest,null);
    const cold=store.archiveById||{},coldGone=[...records].filter(id=>Object.prototype.hasOwnProperty.call(cold,id));
    store.recordsById=nextHot;if(coldGone.length)store.archiveById=derive(nextCold,store.archiveById,{removed:coldGone});if(store.checkpointsById||checkpoints.length){store.checkpointsById=derive(nextCheckpoints,store.checkpointsById,{removed:checkpoints.map(row=>row.id)});store.periodDigests=periods;}store.sealedPeriods=seals;
    return {sealed,examined,records:records.size,checkpoints:checkpoints.length};
  }
  // Sealed periods hold no rows to check them against; their shape is checked (one entry per period, a positive count, a digest).
  function verifySeals(state){
    const seals=state?.documentProofs?.sealedPeriods;if(seals===undefined)return {ok:true,documents:0};if(!seals||typeof seals!=='object'||Array.isArray(seals))return {ok:false,reason:'document-proof-seal-shape'};
    let documents=0;for(const [period,entry] of Object.entries(seals)){if(!entry||typeof entry!=='object'||Array.isArray(entry)||entry.period!==period||!/^P\d{4,}$/.test(period)||entry.form!==PERIOD_FORM||!Number.isSafeInteger(entry.count)||entry.count<1||!isDigest(entry.digest)||Object.keys(entry).length!==4)return {ok:false,reason:'document-proof-seal-period'};documents+=entry.count;}
    return {ok:true,documents};
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
  // Build 359: the documents alone, without the path text of each (every validation collected them). {archive:false}
  // leaves out the finance audit archive (a validation that answers the sealed archive by identity, GH_SAVE_SCHEMA).
  function stateDocuments(state,{archive=true}={}){
    const rows=[],seen=new Set(),append=document=>{if(document&&typeof document==='object'&&!seen.has(document)){seen.add(document);rows.push(document);}};
    for(const bucket of financeBuckets){const list=Array.isArray(state.finance?.[bucket])?state.finance[bucket]:[];for(let index=0;index<list.length;index++)append(list[index]);}
    for(const document of Object.values(state.contractRegistry||{}))append(document);
    if(archive)for(const list of Object.values(state.finance?.auditArchive?.records||{}))if(Array.isArray(list))for(let index=0;index<list.length;index++)append(list[index]);
    return rows;
  }
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
    const stack=[...roots];while(stack.length){const id=stack.pop();if(seen.has(id))continue;seen.add(id);const prior=(getRecord(state,id)||getCheckpoint(state,id))?.previousProofId;if(prior)stack.push(prior);}return seen;
  }
  function compact(state,target=Math.max(0,LIMITS.records-200),pinned=[]){
    const store=ensure(state),referenced=referencedProofs(state,pinned),removable=Object.values(store.recordsById).filter(row=>!referenced.has(row.id)).sort((a,b)=>(Number(a.createdAtSim)||0)-(Number(b.createdAtSim)||0)||String(a.id).localeCompare(String(b.id))),remove=Math.max(0,Object.keys(store.recordsById).length-target);
    // New maps, never an edit in place: maintenance keeps the members of the old ones as its rollback snapshot.
    const hot={...store.recordsById};for(const row of removable.slice(0,remove))delete hot[row.id];store.recordsById=hot;
    // The archive is replaced only when records leave it (an unchanged archive keeps its version).
    let archivedRemoved=0;if(store.archiveById){const gone=Object.keys(store.archiveById).filter(id=>!referenced.has(id));if(gone.length){const cold={...store.archiveById};for(const id of gone)delete cold[id];store.archiveById=derive(cold,store.archiveById,{removed:gone});archivedRemoved=gone.length;}}
    // An earlier version standing in supersededById goes with its archive copy.
    if(store.supersededById){const gone=Object.keys(store.supersededById).filter(id=>!referenced.has(id));if(gone.length){const over={...store.supersededById};for(const id of gone)delete over[id];if(Object.keys(over).length)store.supersededById=over;else delete store.supersededById;}}
    // Checkpoints no proof links to any more go too; their periods' digests drop them (an emptied period is dropped).
    if(store.checkpointsById){const gone=Object.values(store.checkpointsById).filter(row=>!referenced.has(row.id));if(gone.length){const rows={...store.checkpointsById};for(const row of gone)delete rows[row.id];store.periodDigests=adjustPeriods(store.periodDigests,gone,-1,checkpointDigest);store.checkpointsById=derive(rows,store.checkpointsById,{removed:gone.map(row=>row.id)});archivedRemoved+=gone.length;}}
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
  function createRecord(state,document,options={},chain=null,admit=null){
    const store=ensure(state),id=documentId(document,options),type=documentType(document,options);if(!id)throw new Error('document-id-required');profileFor(type);
    if(admit??admissionDue(store))archiveForAdmission(state);
    const companyId=clean(options.companyId||document.company||document.companyId||'group',100),issuer=issuerSnapshot(state,companyId),counterparty=counterpartySnapshot(document);document.documentId=id;document.documentType=type;
    const content=signedContent(document,issuer,counterparty,{issuedAtSim:Number(state.simSeconds)||0,chain}),contentDigest=digest(content);if(!contentDigest)throw new Error('document-digest-owner-unavailable');
    if(!Number.isSafeInteger(store.sequence)||store.sequence>=Number.MAX_SAFE_INTEGER)throw new Error('document-proof-sequence-exhausted');
    const nextSequence=store.sequence+1,proofId=`DOCP-${String(nextSequence).padStart(9,'0')}`;if(Object.prototype.hasOwnProperty.call(store.recordsById,proofId)||Object.prototype.hasOwnProperty.call(store.archiveById||{},proofId))throw new Error('document-proof-id-collision');
    const record={id:proofId,version:RECORD_VERSION,form:COMPACT_FORM,documentId:id,documentType:type,companyId,materialProfile:content.material.profile,contentDigest,previousProofId:chain?.previousProofId||null,previousContentDigest:chain?.previousContentDigest||null,transition:chain?.transition||null,chainDepth:chain?.depth||0,authorizationKind:clean(options.authorizationKind||'pending-approval',40),authorizationProofId:null,createdAtSim:Number(state.simSeconds)||0,issuedAtSim:content.issuedAtSim,signatureDigest:null};
    store.sequence=nextSequence;store.recordsById[proofId]=record;document.documentSchema=content.schema;document.documentVersion=RECORD_VERSION;document.documentProofId=proofId;document.issuerSnapshot=clone(issuer);document.counterpartySnapshot=clone(counterparty);document.contentDigest=contentDigest;document.authorizationKind=record.authorizationKind;return clone(record);
  }
  function sealDocument(state,document,options={}){if(!document||typeof document!=='object'||Array.isArray(document))throw new TypeError('document-object-required');if(options.chain!==undefined)throw new Error('document-chain-internal-only');ensure(state);if(document.documentProofId){const verification=verifyDocument(state,document);if(!verification.ok)throw new Error(`document-proof-invalid:${verification.reason}`);return clone(getRecord(state,document.documentProofId));}return createRecord(state,document,options,null);}
  function transitionId(value){const id=String(value||'').trim();if(id.length>64||!TRANSITION_ID.test(id)||!TRANSITION_SET.has(id))throw new Error('document-transition-unsupported');return id;}
  function amendDocument(state,document,options={}){
    if(!document||typeof document!=='object'||Array.isArray(document))throw new TypeError('document-object-required');if(typeof options.mutate!=='function')throw new TypeError('document-amendment-mutator-required');
    // An archived document (sealed, its record in the archived form) is never amended.
    if(globalThis.GH_TRANSACTION_CORE?.isSealed?.(document)||isArchivedForm(getRecord(state,document.documentProofId)))throw new Error('document-proof-archived-read-only');
    // Rollback snapshot of the proof store: an amendment only advances the sequence and adds, removes or archives
    // whole records (records are never edited here), so copying the store and its two record maps is exact. Build 357
    // deep-cloned the whole store (~1.5 MB) on every amendment. Build 359 (a million assets: copying both maps on every
    // amendment made each document cost more as the game grew): the maps are copied only when this record's admission
    // will archive them; otherwise the amendment adds at most its one new record (DOCP-<sequence>), and the
    // rollback removes it and restores the sequence.
    const transition=transitionId(options.transition),store=ensure(state),documentSnapshot=clone(document),sequenceBefore=store.sequence,admitting=admissionDue(store),storeSnapshot=admitting?{...store,recordsById:{...store.recordsById},...(store.archiveById&&typeof store.archiveById==='object'?{archiveById:{...store.archiveById}}:{}),...(store.supersededById&&typeof store.supersededById==='object'?{supersededById:{...store.supersededById}}:{})}:null;
    let undoExpansion=null;
    const rollbackStore=()=>{undoExpansion?.();if(storeSnapshot){state.documentProofs=storeSnapshot;return;}for(let sequence=sequenceBefore+1;sequence<=store.sequence;sequence++)delete store.recordsById[`DOCP-${String(sequence).padStart(9,'0')}`];store.sequence=sequenceBefore;state.documentProofs=store;};
    try{
      const verification=verifyDocument(state,document);if(!verification.ok){if(verification.legacy&&verification.readOnly)throw new Error('document-proof-legacy-read-only');throw new Error(`document-proof-invalid:${verification.reason}`);}
      const previous=getRecord(state,document.documentProofId);if(!previous||Number(previous.version)!==RECORD_VERSION)throw new Error('document-proof-legacy-read-only');
      const depth=(Number(previous.chainDepth)||0)+1;if(!Number.isSafeInteger(depth)||depth>LIMITS.chainDepth)throw new Error('document-proof-chain-depth');
      // Build 359: a compact earlier version is rebuilt whole now, from the document as it still is (its content would be
      // lost with the change); the whole record takes its place below.
      const expanded=isCompactForm(previous)?expandRecord(document,previous):null;
      const beforeId=documentId(document),beforeType=documentType(document),beforeCompany=clean(document.company||document.companyId||'group',100),beforeMaterial=stable(materialDetails(document,beforeType).payload),result=options.mutate(document);
      if(result&&typeof result.then==='function')throw new Error('document-amendment-mutator-async');
      const afterId=documentId(document),afterType=documentType(document),afterCompany=clean(document.company||document.companyId||'group',100);if(afterId!==beforeId)throw new Error('document-amendment-id-changed');if(afterType!==beforeType)throw new Error('document-amendment-type-changed');if(afterCompany!==beforeCompany)throw new Error('document-amendment-company-changed');
      const afterMaterial=stable(materialDetails(document,afterType).payload);if(afterMaterial===beforeMaterial)throw new Error('document-amendment-no-material-change');
      clearSecurityEnvelope(document);const chain={previousProofId:previous.id,previousContentDigest:previous.contentDigest,transition,depth},record=createRecord(state,document,{type:beforeType,documentId:beforeId,companyId:beforeCompany,authorizationKind:clean(options.authorizationKind||'pending-approval',40)},chain,admitting);
      // The whole earlier version replaces the compact one in the hot window, or (archived: the archive is a sealed
      // container, replaced only by maintenance) stands for it in supersededById until maintenance makes it a checkpoint.
      if(expanded){
        const live=state.documentProofs;
        if(live.recordsById[previous.id]===previous){live.recordsById[previous.id]=expanded;undoExpansion=()=>{if(live.recordsById[previous.id]===expanded)live.recordsById[previous.id]=previous;};}
        else if(live.archiveById?.[previous.id]===previous&&!live.supersededById?.[previous.id]){const created=!live.supersededById;if(created)live.supersededById={};live.supersededById[previous.id]=expanded;undoExpansion=()=>{if(created)delete live.supersededById;else delete live.supersededById[previous.id];};}
        else throw new Error('document-proof-residency-conflict');
      }
      return {record,result};
    }catch(error){restoreObject(document,documentSnapshot);rollbackStore();throw error;}
  }
  function verifyAuthorizationReference(state,record,cache=null){
    if(record.form===ARCHIVED_FORM_V2){
      if(!record.authorizationProofId)return record.authorizationDigest===null?{ok:true}:{ok:false,reason:'document-proof-archived-authorization-digest'};
      if(!releasesAuthorization(record))return {ok:false,reason:'document-proof-archived-authorization-digest'};
      const held=state?.authorization?.proofsById?.[record.authorizationProofId]||state?.authorization?.proofArchiveById?.[record.authorizationProofId];
      if(!held)return {ok:true,released:true};
      if(held.proofDigest!==record.authorizationDigest)return {ok:false,reason:'authorization-digest-mismatch'};
    }
    if(!record.authorizationProofId)return {ok:true};const authorization=globalThis.GH_AUTHORIZATION?.verifyProof?.(state,record.authorizationProofId,cache?.authorization);if(!authorization?.ok)return {ok:false,reason:`authorization-${authorization?.reason||'unavailable'}`};if(!authorization.proof.documentDigests.includes(record.contentDigest)||!authorization.proof.documentIds.includes(record.documentId))return {ok:false,reason:'authorization-document-reference-missing'};return {ok:true};}
  const SEALED_RECORD_CONTENT=new WeakMap();
  // A verification result carries a private copy of the record. For a sealed record (it cannot change) the copy is made
  // on first read instead of on every verification; it is the same copy on every read, as before.
  function withRecordCopy(out,record){
    if(!globalThis.GH_TRANSACTION_CORE?.isSealed?.(record)){out.record=clone(record);return out;}
    let copy;Object.defineProperty(out,'record',{enumerable:true,configurable:true,get(){if(copy===undefined)copy=clone(record);return copy;},set(value){copy=value;}});return out;
  }
  // proofId -> the canonical document in the finance audit archive. One position index per bucket array: archiveFull
  // replaces a bucket with a longer one and a rollback restores an earlier prefix, so a position is re-checked on use and
  // the index is rebuilt when the bucket's length changed since it was built.
  const ARCHIVE_BUCKET_INDEX=new WeakMap();
  function bucketIndex(list){
    let index=ARCHIVE_BUCKET_INDEX.get(list);
    if(!index||index.length!==list.length){index={length:list.length,at:new Map()};for(let i=0;i<list.length;i++){const id=list[i]?.documentProofId;if(id&&!index.at.has(id))index.at.set(id,i);}ARCHIVE_BUCKET_INDEX.set(list,index);}
    return index;
  }
  function archivedDocument(state,proofId){
    for(const [bucket,list] of Object.entries(state?.finance?.auditArchive?.records||{})){
      if(String(bucket).startsWith('companyLedger-')||!Array.isArray(list))continue;
      const at=bucketIndex(list).at.get(proofId);if(at!==undefined&&list[at]?.documentProofId===proofId)return list[at];
    }
    return null;
  }
  function archivedSignedContent(document,record){const issuer={...clone(document.issuerSnapshot),companyId:clean(document.company||document.companyId||'group',100)};return signedContent(document,issuer,counterpartySnapshot(document),{issuedAtSim:record.issuedAtSim,fixedIssuedAt:true,chain:chainOf(record)});}
  const signatureDigestOf=snapshot=>snapshot&&typeof snapshot==='object'?digest(stable(snapshot)):null;
  // What the document itself must carry for an archived-form record (the envelope a whole record checks against its copies).
  function archivedEnvelope(document,record){
    const currentCompanyId=clean(document.company||document.companyId||'group',100);
    if(document.documentProofId!==record.id||document.contentDigest!==record.contentDigest)return {ok:false,reason:'document-digest-reference-mismatch'};if(currentCompanyId!==record.companyId)return {ok:false,reason:'document-issuer-company-mismatch'};if(document.documentId!==record.documentId)return {ok:false,reason:'document-id-mismatch'};if(document.documentType!==record.documentType)return {ok:false,reason:'document-type-mismatch'};
    if(!document.issuerSnapshot||typeof document.issuerSnapshot!=='object'||Array.isArray(document.issuerSnapshot))return {ok:false,reason:'document-issuer-snapshot-mismatch'};
    const currentCounterparty=counterpartySnapshot(document);if(!document.counterpartySnapshot||typeof document.counterpartySnapshot!=='object'||Array.isArray(document.counterpartySnapshot)||stable(currentCounterparty)!==stable(document.counterpartySnapshot))return {ok:false,reason:'document-counterparty-mismatch'};
    if(clean(document.authorizationKind,40)!==clean(record.authorizationKind,40))return {ok:false,reason:'document-authorization-kind-mismatch'};if((document.authorizationProofId||null)!==(record.authorizationProofId||null))return {ok:false,reason:'document-authorization-reference-mismatch'};
    if(record.signatureDigest!==null&&signatureDigestOf(document.signatureSnapshot)!==record.signatureDigest)return {ok:false,reason:'document-signature-snapshot-mismatch'};
    return {ok:true,currentCompanyId,currentCounterparty};
  }
  // The rebuilt signed content of a sealed record and sealed document is computed once per pair.
  const ARCHIVED_CONTENT=new WeakMap();
  function archivedContentStable(document,record){
    const sealed=globalThis.GH_TRANSACTION_CORE?.isSealed,known=ARCHIVED_CONTENT.get(record);if(known&&known.document===document)return known;
    const content=archivedSignedContent(document,record),out={stable:stable(content),profile:content.material?.profile,documentId:content.documentId,documentType:content.documentType};
    if(typeof sealed==='function'&&sealed(record)&&sealed(document)){const kept={...out,document};ARCHIVED_CONTENT.set(record,kept);return kept;}return out;
  }
  function verifyArchivedRecord(state,proofRecord,seen,cache){
    if(Object.keys(proofRecord).sort().join(',')!==(proofRecord.form===ARCHIVED_FORM_V2?ARCHIVED_KEYS_V2:ARCHIVED_KEYS)||Number(proofRecord.version)!==RECORD_VERSION||!/^[a-f0-9]{64}$/i.test(String(proofRecord.contentDigest||''))||(proofRecord.signatureDigest!==null&&!/^[a-f0-9]{64}$/i.test(String(proofRecord.signatureDigest||''))))return {ok:false,reason:'document-proof-archived-shape'};
    const authorization=verifyAuthorizationReference(state,proofRecord,cache);if(!authorization.ok)return authorization;
    let profile;try{profile=profileFor(proofRecord.documentType);}catch(error){return {ok:false,reason:String(error?.message||error)};}if(proofRecord.materialProfile!==profile)return {ok:false,reason:'document-material-profile-mismatch'};
    const document=archivedDocument(state,proofRecord.id);if(!document)return {ok:false,reason:'document-proof-archived-document-missing'};
    const envelope=archivedEnvelope(document,proofRecord);if(!envelope.ok)return envelope;
    let content;try{content=archivedContentStable(document,proofRecord);}catch(error){return {ok:false,reason:String(error?.message||error)};}
    if(content.profile!==profile||content.documentId!==proofRecord.documentId||content.documentType!==proofRecord.documentType)return {ok:false,reason:'document-proof-record-envelope-mismatch'};
    // The digest of a sealed pair's rebuilt content is kept with it (computed once, as the content).
    if((content.digest??=digest(content.stable))!==proofRecord.contentDigest)return {ok:false,reason:'document-proof-record-tampered'};cache?.signedContentStable?.set(proofRecord.id,content.stable);
    const chainError=chainFailure(state,proofRecord,proofRecord.chain,seen,cache);if(chainError)return chainError;
    const verified=withRecordCopy({ok:true,modern:true},proofRecord);cache?.records?.set(proofRecord.id,verified);return verified;
  }
  // The chain link of a record (whole or archived form): its depth, its link fields against the chain its content
  // signed, and its predecessor (a record, verified recursively, or a checkpoint). A failure, or null.
  function chainFailure(state,proofRecord,chain,seen,cache){
    const chainDepth=Number(proofRecord.chainDepth);if(!Number.isSafeInteger(chainDepth)||chainDepth<0||chainDepth>LIMITS.chainDepth)return {ok:false,reason:'document-proof-chain-depth'};
    if(chainDepth===0){if(chain!==null||proofRecord.previousProofId||proofRecord.previousContentDigest||proofRecord.transition)return {ok:false,reason:'document-proof-root-chain-invalid'};}
    else{
      if(!chain||typeof chain!=='object'||Array.isArray(chain)||Object.keys(chain).sort().join(',')!=='depth,previousContentDigest,previousProofId,transition')return {ok:false,reason:'document-proof-chain-shape'};let transition;try{transition=transitionId(chain.transition);}catch(error){return {ok:false,reason:String(error?.message||error)};}
      if(chain.previousProofId!==proofRecord.previousProofId||chain.previousContentDigest!==proofRecord.previousContentDigest||transition!==proofRecord.transition||Number(chain.depth)!==chainDepth)return {ok:false,reason:'document-proof-chain-reference-mismatch'};
      // Build 359: a predecessor kept as a checkpoint ends the walk: its link fields are checked here and its period's
      // digest by verifyCheckpoints (its own chain verified when it was checkpointed).
      const checkpoint=getRecord(state,proofRecord.previousProofId)?null:getCheckpoint(state,proofRecord.previousProofId);
      if(checkpoint){
        if(checkpoint.contentDigest!==proofRecord.previousContentDigest)return {ok:false,reason:'document-proof-chain-predecessor-mismatch'};if(checkpoint.documentId!==proofRecord.documentId||checkpoint.documentType!==proofRecord.documentType||checkpoint.companyId!==proofRecord.companyId)return {ok:false,reason:'document-proof-chain-identity-mismatch'};if(Number(checkpoint.chainDepth)+1!==chainDepth)return {ok:false,reason:'document-proof-chain-depth-mismatch'};
        const periods=checkpointTrusted(state,checkpoint)?{ok:true}:verifyCheckpoints(state,cache);return periods.ok?null:periods;
      }
      const previous=getRecord(state,proofRecord.previousProofId);if(!previous||previous.contentDigest!==proofRecord.previousContentDigest)return {ok:false,reason:'document-proof-chain-predecessor-mismatch'};if(previous.documentId!==proofRecord.documentId||previous.documentType!==proofRecord.documentType||previous.companyId!==proofRecord.companyId)return {ok:false,reason:'document-proof-chain-identity-mismatch'};if(Number(previous.chainDepth)+1!==chainDepth)return {ok:false,reason:'document-proof-chain-depth-mismatch'};
      const ancestor=verifyRecord(state,previous.id,seen,cache);if(!ancestor.ok)return ancestor;
    }
    return null;
  }
  // A compact record alone: its shape, its authorization reference and its chain. Its content is the document's: it is
  // checked when the document is verified (verifyDocument rebuilds the signed content). A compact record whose document
  // is gone (a list trimmed by count) is an orphan, as a whole record would be, until the collection drops it.
  function verifyCompactRecord(state,proofRecord,seen,cache){
    if(Object.keys(proofRecord).sort().join(',')!==COMPACT_KEYS||Number(proofRecord.version)!==RECORD_VERSION||!isDigest(proofRecord.contentDigest)||(proofRecord.signatureDigest!==null&&!isDigest(proofRecord.signatureDigest))||!Number.isSafeInteger(proofRecord.chainDepth))return {ok:false,reason:'document-proof-compact-shape'};
    const authorization=verifyAuthorizationReference(state,proofRecord,cache);if(!authorization.ok)return authorization;
    let profile;try{profile=profileFor(proofRecord.documentType);}catch(error){return {ok:false,reason:String(error?.message||error)};}if(proofRecord.materialProfile!==profile)return {ok:false,reason:'document-material-profile-mismatch'};
    const chainError=chainFailure(state,proofRecord,chainOf(proofRecord),seen,cache);if(chainError)return chainError;
    const verified=withRecordCopy({ok:true,modern:true,compact:true},proofRecord);cache?.records?.set(proofRecord.id,verified);return verified;
  }
  // The whole record of a compact one, rebuilt from its document (verified against it by the caller): the signed content
  // and the snapshots a whole record keeps, its signature snapshot from the document. Its digest is checked here.
  function expandRecord(document,record){
    const content=archivedSignedContent(document,record);if(digest(content)!==record.contentDigest)throw new Error('document-proof-expand-digest');
    const whole={id:record.id,version:record.version,documentId:record.documentId,documentType:record.documentType,companyId:record.companyId,materialProfile:record.materialProfile,issuerSnapshot:clone(content.issuer),counterpartySnapshot:clone(content.recipient),signedContent:content,contentDigest:record.contentDigest,previousProofId:record.previousProofId,previousContentDigest:record.previousContentDigest,transition:record.transition,chainDepth:record.chainDepth,authorizationKind:record.authorizationKind,authorizationProofId:record.authorizationProofId,createdAtSim:record.createdAtSim};
    if(record.signatureDigest!==null){if(signatureDigestOf(document.signatureSnapshot)!==record.signatureDigest)throw new Error('document-proof-expand-signature');whole.signatureSnapshot=clone(document.signatureSnapshot);}
    return whole;
  }
  function verifyRecord(state,proofId,seen=new Set(),cache=null){
    const cached=cache?.records?.get(proofId);if(cached)return cached;const proofRecord=getRecord(state,proofId);if(!proofRecord)return {ok:false,reason:'document-proof-not-found'};if(seen.size>=LIMITS.chainDepth+1)return {ok:false,reason:'document-proof-chain-depth'};if(seen.has(proofId))return {ok:false,reason:'document-proof-chain-cycle'};seen.add(proofId);
    try{
      if(isArchivedForm(proofRecord))return verifyArchivedRecord(state,proofRecord,seen,cache);
      if(isCompactForm(proofRecord))return verifyCompactRecord(state,proofRecord,seen,cache);
      // Build 358: a sealed record (frozen, see GH_TRANSACTION_CORE.registerSealedCollections) cannot change, so its signed
      // content is canonicalized and hashed once; the chain and authorization checks below still run on every call.
      const sealedContent=SEALED_RECORD_CONTENT.get(proofRecord);let signedContentStable=sealedContent??cache?.signedContentStable?.get(proofId);if(signedContentStable===undefined){signedContentStable=stable(proofRecord.signedContent);}cache?.signedContentStable?.set(proofId,signedContentStable);if(sealedContent===undefined){if(digest(signedContentStable)!==proofRecord.contentDigest)return {ok:false,reason:'document-proof-record-tampered'};if(globalThis.GH_TRANSACTION_CORE?.isSealed?.(proofRecord))SEALED_RECORD_CONTENT.set(proofRecord,signedContentStable);}const authorization=verifyAuthorizationReference(state,proofRecord,cache);if(!authorization.ok)return authorization;
      if(Number(proofRecord.version)===2&&proofRecord.signedContent?.schema==='gh-signed-document-content-v2')return {ok:false,legacy:true,readOnly:true,recordIntegrity:true,modern:false,reason:'document-proof-v2-legacy-read-only',record:clone(proofRecord)};
      if(Number(proofRecord.version)!==RECORD_VERSION||proofRecord.signedContent?.schema!==CONTENT_SCHEMA)return {ok:false,reason:'document-proof-version-unsupported'};let profile;try{profile=profileFor(proofRecord.documentType);}catch(error){return {ok:false,reason:String(error?.message||error)};}
      if(proofRecord.materialProfile!==profile||proofRecord.signedContent?.material?.profile!==profile)return {ok:false,reason:'document-material-profile-mismatch'};if(proofRecord.signedContent.documentId!==proofRecord.documentId||proofRecord.signedContent.documentType!==proofRecord.documentType)return {ok:false,reason:'document-proof-record-envelope-mismatch'};if(stable(proofRecord.signedContent.issuer)!==stable(proofRecord.issuerSnapshot)||stable(proofRecord.signedContent.recipient)!==stable(proofRecord.counterpartySnapshot))return {ok:false,reason:'document-proof-record-snapshot-mismatch'};
      const chainError=chainFailure(state,proofRecord,proofRecord.signedContent.chain,seen,cache);if(chainError)return chainError;
      const verified=withRecordCopy({ok:true,modern:true},proofRecord);cache?.records?.set(proofId,verified);return verified;
    }finally{seen.delete(proofId);}
  }
  function verifyEnvelope(document,record){if(document.contentDigest!==record.contentDigest)return {ok:false,reason:'document-digest-reference-mismatch'};const currentCompanyId=clean(document.company||document.companyId||'group',100);if(currentCompanyId!==record.companyId)return {ok:false,reason:'document-issuer-company-mismatch'};if(document.documentId!==record.documentId)return {ok:false,reason:'document-id-mismatch'};if(document.documentType!==record.documentType)return {ok:false,reason:'document-type-mismatch'};if(!document.issuerSnapshot||typeof document.issuerSnapshot!=='object'||Array.isArray(document.issuerSnapshot)||stable(document.issuerSnapshot)!==stable(record.issuerSnapshot))return {ok:false,reason:'document-issuer-snapshot-mismatch'};const currentCounterparty=counterpartySnapshot(document);if(!document.counterpartySnapshot||typeof document.counterpartySnapshot!=='object'||Array.isArray(document.counterpartySnapshot)||stable(currentCounterparty)!==stable(record.counterpartySnapshot)||stable(document.counterpartySnapshot)!==stable(record.counterpartySnapshot))return {ok:false,reason:'document-counterparty-mismatch'};if(clean(document.authorizationKind,40)!==clean(record.authorizationKind,40))return {ok:false,reason:'document-authorization-kind-mismatch'};if((document.authorizationProofId||null)!==(record.authorizationProofId||null))return {ok:false,reason:'document-authorization-reference-mismatch'};if(record.signatureSnapshot&&stable(document.signatureSnapshot)!==stable(record.signatureSnapshot))return {ok:false,reason:'document-signature-snapshot-mismatch'};return {ok:true,currentCompanyId,currentCounterparty};}
  // A document whose record is in the archived form: its envelope, the record (verified against the canonical archived
  // document), then this document's own rebuilt content against the verified content. A compact record is verified the
  // same way (its record alone, then the document's rebuilt content against its digest).
  function verifyArchivedDocument(state,document,record,cache){
    const envelope=archivedEnvelope(document,record);if(!envelope.ok)return envelope;
    const recordVerification=verifyRecord(state,record.id,new Set(),cache);if(!recordVerification.ok)return recordVerification;
    if(Number(document.documentVersion)!==RECORD_VERSION||document.documentSchema!==CONTENT_SCHEMA)return {ok:false,reason:'document-proof-version-unsupported'};
    let content;try{content=archivedContentStable(document,record);}catch(error){return {ok:false,reason:String(error?.message||error)};}
    if(content.profile!==record.materialProfile)return {ok:false,reason:'document-material-profile-mismatch'};
    const verifiedStable=cache?.signedContentStable?.get(record.id);if(verifiedStable!==undefined?content.stable!==verifiedStable:digest(content.stable)!==record.contentDigest)return {ok:false,reason:'document-content-tampered'};
    return withRecordCopy({ok:true,modern:true},record);
  }
  function verifyDocument(state,document,cache=null){
    const record=getRecord(state,document?.documentProofId);if(!record)return {ok:false,reason:'document-proof-not-found'};if(isArchivedForm(record)||isCompactForm(record))return verifyArchivedDocument(state,document,record,cache);const envelope=verifyEnvelope(document,record);if(!envelope.ok)return envelope;const recordVerification=verifyRecord(state,record.id,new Set(),cache),issuer={...clone(record.issuerSnapshot),companyId:envelope.currentCompanyId};
    if(Number(record.version)===2&&record.signedContent?.schema==='gh-signed-document-content-v2'){if(!(recordVerification.legacy&&recordVerification.recordIntegrity))return recordVerification;const content=signedContentV2(document,issuer,envelope.currentCounterparty,{issuedAtSim:record.signedContent?.issuedAtSim});const verifiedStable=cache?.signedContentStable?.get(record.id);if(verifiedStable!==undefined?stable(content)!==verifiedStable:digest(content)!==record.contentDigest)return {ok:false,reason:'document-content-tampered'};return recordVerification;}
    if(!recordVerification.ok)return recordVerification;if(Number(document.documentVersion)!==RECORD_VERSION||document.documentSchema!==CONTENT_SCHEMA)return {ok:false,reason:'document-proof-version-unsupported'};let content;try{content=signedContent(document,issuer,envelope.currentCounterparty,{issuedAtSim:record.signedContent?.issuedAtSim,fixedIssuedAt:true,chain:record.signedContent?.chain||null});}catch(error){return {ok:false,reason:String(error?.message||error)};}if(record.materialProfile!==content.material.profile)return {ok:false,reason:'document-material-profile-mismatch'};const verifiedStable=cache?.signedContentStable?.get(record.id);if(verifiedStable!==undefined?stable(content)!==verifiedStable:digest(content)!==record.contentDigest)return {ok:false,reason:'document-content-tampered'};return withRecordCopy({ok:true,modern:true},record);
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
    // Build 359: a record without its signed content (compact or archived form) is compared with the content rebuilt from
    // the canonical document when that one verifies (a copy that differs from it, such as a ledger row); otherwise the
    // whole content ('$') differs.
    if(proofId&&record&&verification?.reason==='document-content-tampered'&&(isArchivedForm(record)||isCompactForm(record)))try{const content=archivedSignedContent(document,record),canonical=canonicalDocumentEntry(state,proofId)?.document;actualContentDigest=digest(content);differencePath=canonical&&canonical!==document&&verifyDocument(state,canonical).ok?firstDifferencePath(archivedSignedContent(canonical,record),content):'$';}catch(error){differencePath=`$<recompute:${String(error?.message||error)}>`;}
    else if(proofId&&record&&verification?.reason==='document-content-tampered')try{const issuer={...clone(record.issuerSnapshot),companyId:clean(document.company||document.companyId||'group',100)},counterparty=counterpartySnapshot(document),content=Number(record.version)===2?signedContentV2(document,issuer,counterparty,{issuedAtSim:record.signedContent?.issuedAtSim}):signedContent(document,issuer,counterparty,{issuedAtSim:record.signedContent?.issuedAtSim,fixedIssuedAt:true,chain:record.signedContent?.chain||null});differencePath=firstDifferencePath(record.signedContent,content);actualContentDigest=digest(content);}catch(error){differencePath=`$<recompute:${String(error?.message||error)}>`;}
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
    // An audit archive collection is replaced, never edited (a sealed container): its rows are replaced in a copy.
    const records=state.finance?.auditArchive?.records||{},copies=[];
    for(const [bucket,list] of Object.entries(records))if(String(bucket).startsWith('companyLedger-')&&Array.isArray(list)){const before=replacements.length,copy=list.slice();for(let index=0;index<copy.length;index++)queue(copy,index,`finance.auditArchive.records.${bucket}[${index}]`);if(replacements.length>before){records[bucket]=copy;copies.push({copy,base:list,from:before,to:replacements.length});}}
    for(const replacement of replacements)replacement.container[replacement.index]=replacement.value;
    for(const {copy,base,from,to} of copies){const replaced=replacements.slice(from,to);derive(copy,base,{changed:replaced.map(row=>row.value),removed:replaced.map(row=>base[row.index])});}
    return {changed:replacements.length>0,count:replacements.length,paths:replacements.map(row=>row.path)};
  }
  // The first document carrying this record, in stateDocumentEntries order (live finance documents, contracts, then the
  // audit archive). Build 359 (a million assets): it stops at the first match instead of listing every document first,
  // so a document issued or amended now is found among the live ones without walking the archive.
  function locateDocument(state,proofId){
    const match=document=>document&&typeof document==='object'&&document.documentProofId===proofId;
    for(const bucket of financeBuckets){const list=Array.isArray(state.finance?.[bucket])?state.finance[bucket]:[];for(let index=0;index<list.length;index++)if(match(list[index]))return list[index];}
    for(const document of Object.values(state.contractRegistry||{}))if(match(document))return document;
    for(const list of Object.values(state.finance?.auditArchive?.records||{}))if(Array.isArray(list))for(let index=0;index<list.length;index++)if(match(list[index]))return list[index];
    return null;
  }
  function collectResultDocuments(state,result){const found=new Map(),seen=new Set();function visit(value,depth){if(!value||typeof value!=='object'||depth>7||seen.has(value))return;seen.add(value);if(value.documentProofId&&value.contentDigest){const actual=locateDocument(state,value.documentProofId)||value;found.set(value.documentProofId,{proofId:value.documentProofId,documentId:documentId(actual),digest:actual.contentDigest,document:actual});}if(Array.isArray(value)){for(const item of value)visit(item,depth+1);return;}for(const nested of Object.values(value))visit(nested,depth+1);}visit(result,0);return [...found.values()];}
  // Build 359: a final finance document is sealed (frozen, see GH_FINANCE_CORE); binding one replaces it where it lives by
  // a bound copy (a document a command returned may be one an earlier transaction finalized).
  function writableDocument(state,document){
    if(!Object.isFrozen(document))return document;const copy=clone(document),replace=list=>{if(!Array.isArray(list))return false;const at=list.indexOf(document);if(at<0)return false;list[at]=copy;return true;};
    let placed=financeBuckets.some(bucket=>replace(state.finance?.[bucket]));
    if(!placed)for(const [id,row] of Object.entries(state.contractRegistry||{}))if(row===document){state.contractRegistry[id]=copy;placed=true;break;}
    if(!placed)placed=Object.values(state.finance?.auditArchive?.records||{}).some(replace);
    if(!placed)throw new Error('document-proof-document-not-found');
    globalThis.GH_FINANCE_CORE?.invalidateLookupIndexes?.();return copy;
  }
  function bindAuthorization(state,documents,proof){if(!proof?.id)throw new Error('authorization-proof-required');ensure(state);const rows=Array.isArray(documents)?documents:[];for(const item of rows){const document=item.document||locateDocument(state,item.proofId),record=getRecord(state,item.proofId||document?.documentProofId);if(!document||!record)throw new Error('document-proof-not-found');if(Number(record.version)!==RECORD_VERSION)throw new Error('document-proof-legacy-read-only');if(isArchivedForm(record))throw new Error('document-proof-archived-read-only');const verification=verifyDocument(state,document);if(!verification.ok)throw new Error(`document-proof-invalid:${verification.reason}`);if(record.authorizationProofId&&record.authorizationProofId!==proof.id)throw new Error('document-already-authorized');if(!Array.isArray(proof.documentDigests)||!proof.documentDigests.includes(record.contentDigest))throw new Error('proof-document-digest-mismatch');if(!Array.isArray(proof.documentIds)||!proof.documentIds.includes(record.documentId))throw new Error('proof-document-id-mismatch');const store=state.documentProofs,signatureSnapshot={kind:'visual-authorization-seal',visualSealAssetId:proof.visualSealAssetId||proof.signatureAssetId,visualSealVersion:proof.visualSealVersion??proof.signatureVersion,visualSealDigest:proof.visualSealDigest||proof.signatureDigest,signatureAssetId:proof.signatureAssetId,signatureVersion:proof.signatureVersion,signatureDigest:proof.signatureDigest,signerPersonId:proof.signerPersonId,signerNameSnapshot:proof.signerNameSnapshot,mandateId:proof.mandateId,mandateVersion:proof.mandateVersion,mandateDigest:proof.mandateDigest,signedAtSim:proof.signedAtSim},bound=isCompactForm(record)?{...record,authorizationProofId:proof.id,authorizationKind:proof.mode,signatureDigest:signatureDigestOf(signatureSnapshot)}:{...record,authorizationProofId:proof.id,authorizationKind:proof.mode,signatureSnapshot};
      // Proof records are sealed (shared with durable drafts, never edited): binding replaces the record where it lives.
      // Build 359: a compact record keeps the signature snapshot's digest (the document keeps the snapshot), as the archived forms do.
      if(store.recordsById?.[record.id]===record)store.recordsById[record.id]=bound;else if(store.supersededById?.[record.id]===record)store.supersededById[record.id]=bound;else if(store.archiveById?.[record.id]===record)store.archiveById=derive({...store.archiveById,[record.id]:bound},store.archiveById,{changed:[record.id]});else throw new Error('document-proof-residency-conflict');const target=writableDocument(state,document);target.authorizationProofId=proof.id;target.authorizationKind=proof.mode;target.signatureSnapshot=clone(signatureSnapshot);}return rows.length;}
  function markLegacy(state,document,options={}){if(document.documentProofId)return verifyDocument(state,document);return sealDocument(state,document,{...options,authorizationKind:'legacy-name-only'});}
  // Proof records are inserted whole and replaced, never edited (bindAuthorization replaces): durable drafts share them sealed.
  (globalThis.GH_TRANSACTION_CORE?.registerSealedCollections||((root,keys)=>(globalThis.__GH_PENDING_SEALED_COLLECTIONS__=globalThis.__GH_PENDING_SEALED_COLLECTIONS__||[]).push([root,keys])))('documentProofs',['recordsById','supersededById']);
  // Build 359: the archive, checkpoints and period sums are replaced on every change (copy-on-write), never edited: each is
  // sealed whole once its members are (a container, GH_TRANSACTION_CORE), so commands share them without walking them.
  (globalThis.GH_TRANSACTION_CORE?.registerSealedCollections||((root,keys,options)=>(globalThis.__GH_PENDING_SEALED_COLLECTIONS__=globalThis.__GH_PENDING_SEALED_COLLECTIONS__||[]).push([root,keys,options])))('documentProofs',['archiveById','checkpointsById','periodDigests','sealedPeriods'],{container:true});
  const API=Object.freeze({VERSION,ARCHIVED_FORM_V2,COMPACT_FORM,compactLiveRecords,checkpointAuditSteps,walkDocuments,checkpointVerified,periodVerified,releasesAuthorization,SCHEMA,CONTENT_SCHEMA,RECORD_VERSION,LIMITS,DOCUMENT_TYPES,TRANSITIONS,ensure,record:getRecord,records,sequenceMark,recordsSince,compact,checkpoint:getCheckpoint,checkpointAncestors,compactArchivedRecords,ARCHIVED_FORM,verifyCheckpoints,migratePeriodDigests,sealDocuments,verifySeals,stateDocumentEntries,stateDocuments,companyProfile,issuerSnapshot,counterpartySnapshot,materialDetails,signedContent,sealDocument,amendDocument,markLegacy,verifyRecord,verifyDocument,forensicInspectStateProofs,ledgerProjection,migrateLegacyLedgerProjections,collectResultDocuments,bindAuthorization,locateDocument});globalThis.GH_DOCUMENT_PROOF=API;if(globalThis.window&&globalThis.window!==globalThis)globalThis.window.GH_DOCUMENT_PROOF=API;if(typeof module!=='undefined'&&module.exports)module.exports=API;
})();

(()=>{
'use strict';
const VERSION='3.1.0',TYPES=Object.freeze(['group','air','sea','road','power','bank','mobility']);
const clone=v=>globalThis.structuredClone?structuredClone(v):JSON.parse(JSON.stringify(v));
const num=v=>Math.max(0,Number(v)||0), now=s=>Number(s.simSeconds)||0;
let activeExecutionMeta=null,activeEnsureTarget=null,activeEnsureComplete=false;
const collectionBatches=new WeakMap();
const COLLECTION_PROFILES=Object.freeze({
 group:{channel:'تحويل تحصيل عملاء المجموعة',source:'مركز تحصيل المجموعة · العملاء المعتمدون',service:'خدمات المجموعة'},
 air:{channel:'تسوية حجوزات وتذاكر وشحن جوي',source:'مركز تحصيل الطيران · وكلاء الحجز والعملاء',service:'تذاكر منفذة وشحن جوي وحجوزات شركات'},
 sea:{channel:'تحويلات فواتير شحن وبوالص بحرية',source:'مركز تحصيل الشحن البحري · الشاحنون ووكلاء الشحن',service:'حاويات وشحنات وعقود نقل بحري'},
 road:{channel:'تحصيل فواتير نقل بعد التسليم',source:'مركز تحصيل اللوجستيات · عملاء النقل والتوزيع',service:'أوامر نقل وتسليم وعقود توزيع'},
 power:{channel:'تسوية فواتير توريد الطاقة',source:'مركز تحصيل الطاقة · مشترو الطاقة والعملاء',service:'طاقة موردة وعقود شراء طاقة'},
 bank:{channel:'تحصيل فوائد ورسوم مصرفية',source:'مركز تحصيل البنك · المقترضون وعملاء الخدمات',service:'فوائد ورسوم خدمات؛ لا تشمل أصل القروض أو الودائع'},
 mobility:{channel:'تسوية نقاط البيع وبوابة الدفع',source:'مركز تحصيل التنقل · مدفوعات الركاب والعملاء',service:'رحلات مكتملة وحسابات تنقل الشركات'}
});
const GENERIC_COLLECTION_PROFILE=Object.freeze({channel:'تحويل تحصيل مؤسسي',source:'مركز تحصيل العملاء المعتمدين',service:'خدمات تشغيلية مثبتة'});
const COLLECTION_PROFILE_IDS=Object.freeze({
 'holding-revenue-v1':'group','aviation-revenue-v1':'air','marine-revenue-v1':'sea','logistics-revenue-v1':'road','energy-revenue-v1':'power','banking-revenue-v1':'bank','mobility-revenue-v1':'mobility'
});
function collectionProfile(company,s=null){
 const platform=globalThis.GH_COMPANY_PLATFORM,definition=s?platform?.resolveCompany?.(s,company)?.definition:platform?.getDefinition?.(company),profileId=definition?.finance?.collectionProfileId,legacyId=COLLECTION_PROFILE_IDS[profileId];
 return COLLECTION_PROFILES[legacyId||company]||GENERIC_COLLECTION_PROFILE;
}
function platformInstances(s,options={}){const platform=globalThis.GH_COMPANY_PLATFORM;if(!platform?.listInstances)return null;const rows=platform.listInstances(s,{includeGroup:options.includeGroup!==false,openedOnly:false,capability:'finance.book'});if(!Array.isArray(rows))throw new Error('company-platform-invalid-list');return rows.filter(row=>row?.id==='group'||row?.registered===true||row?.opened===true);}
function supportsCompany(s,value,options={}){
 const id=String(value||'').trim();if(!id)return false;const platform=globalThis.GH_COMPANY_PLATFORM;
 if(platform?.resolveCompany){const company=platform.resolveCompany(s,id);if(!company?.known||!company.definition?.capabilities?.includes('finance.book'))return false;if(options.operational===true&&!company.operational)return false;return id==='group'||company.registered||company.opened;}
 return TYPES.includes(id);
}
function companyIds(s,options={}){
 const rows=platformInstances(s,options);if(rows){const ids=rows.map(row=>String(row?.id||row?.record?.id||'')).filter(Boolean).filter(id=>id!=='group');for(const id of Object.keys(s?.companyFinance||{}))if(id!=='group'&&supportsCompany(s,id)&&!ids.includes(id))ids.push(id);if(options.includeGroup!==false)ids.unshift('group');return [...new Set(ids)];}
 return TYPES.filter(id=>options.includeGroup!==false||id!=='group');
}
function requireCompany(s,value,options={}){const raw=value==null||String(value).trim()===''?(options.defaultGroup===false?'': 'group'):String(value).trim();if(!raw)throw new Error('company-id-required');const platform=globalThis.GH_COMPANY_PLATFORM;if(platform?.requireCompany){platform.requireCompany(s,raw,{registered:true,operational:options.operational===true,capability:'finance.book'});return raw;}if(!TYPES.includes(raw))throw new Error(`company-not-found:${raw}`);return raw;}
function inactiveLegacyCompanyKey(s,id){
 const platform=globalThis.GH_COMPANY_PLATFORM,definition=platform?.getDefinition?.(id);
 return Boolean(definition?.capabilities?.includes('finance.book')&&!supportsCompany(s,id));
}
function metricNumber(value,label,id){
 if(value===null||typeof value==='boolean'||(typeof value==='string'&&!value.trim()))throw new Error(`finance-${label}-value-invalid:${id}`);
 const result=Number(value);if(!Number.isFinite(result))throw new Error(`finance-${label}-value-invalid:${id}`);return result;
}
// Finance accumulators are keyed by company *instance id*, never by an asset,
// route, or sector mode.  This is what lets two companies share an operational
// profile without sharing a book or a daily settlement bucket.
function companyMetricMap(s,source={},label='company-metric',options={}){
 const ids=companyIds(s,{includeGroup:false}),allowed=new Set(ids),result=Object.fromEntries(ids.map(id=>[id,0]));
 if(source==null)return result;if(typeof source!=='object'||Array.isArray(source))throw new Error(`finance-${label}-map-invalid`);
 for(const [id,raw] of Object.entries(source)){
  const value=metricNumber(raw,label,id);
  if(!allowed.has(id)){
   // Build 332/333 persisted all six built-in keys even when a company was not
   // founded.  Zero placeholders are safe to discard; any non-zero orphan is a
   // loss-of-ownership ambiguity and must stop the transaction.
   if(value===0&&inactiveLegacyCompanyKey(s,id)){if(options.preserveLegacyZero===true)result[id]=0;continue;}
   throw new Error(`finance-${label}-company-unknown:${id}`);
  }
  if(options.nonNegative===true&&value<0)throw new Error(`finance-${label}-value-negative:${id}`);
  if(options.integer===true&&(!Number.isSafeInteger(value)||value<0))throw new Error(`finance-${label}-value-not-integer:${id}`);
  result[id]=value;
 }
 return result;
}
function documentProfile(s,t){const platform=globalThis.GH_COMPANY_PLATFORM;if(platform?.resolveDocumentProfile)return platform.resolveDocumentProfile(s,t);const registry=t==='group'?(s.profile||s.companyRegistry?.group||{}):(s.companyRegistry?.[t]||{});return {legalName:registry.legalName||registry.name||(t==='group'?s.profile?.name:null),documentPrefix:registry.documentPrefix||registry.finance?.documentPrefix||(t==='group'?'GH':t.toUpperCase()),accountPrefix:registry.accountPrefix||registry.finance?.accountPrefix||(t==='group'?'GH':t.toUpperCase())};}
function bindSystemDocument(s,document,record,companyId){
 const proofOwner=globalThis.GH_DOCUMENT_PROOF,system=activeExecutionMeta?.systemAuthorized===true&&!globalThis.GH_DOMAIN_COMMANDS?.hasActivePlayerApproval?.();if(!system)return record;
 const authorization=globalThis.GH_AUTHORIZATION,principalId=String(activeExecutionMeta?.authority?.principalId||'').trim(),context=principalId?authorization?.findDelegatedAuthorization?.(s,{domain:'finance',name:activeExecutionMeta.name||'document',companyId,principalId,payload:{documentId:record.documentId,documentType:record.documentType,contentDigest:record.contentDigest}}):null;
 if(context){const proof=authorization.issueProof(s,context,{commandId:activeExecutionMeta.id||record.id,transactionId:globalThis.__GH_DURABLE_COMMAND_CONTEXT__?.transactionId||activeExecutionMeta.id||record.id,documentIds:[record.documentId],documentDigests:[record.contentDigest]});proofOwner.bindAuthorization(s,[{proofId:record.id,documentId:record.documentId,digest:record.contentDigest,document}],proof);}return record;
}
function protectDocument(s,document,type){
 const proofOwner=globalThis.GH_DOCUMENT_PROOF;if(!proofOwner?.sealDocument)return document;const companyId=document.company||document.companyId||'group',system=activeExecutionMeta?.systemAuthorized===true&&!globalThis.GH_DOMAIN_COMMANDS?.hasActivePlayerApproval?.(),record=proofOwner.sealDocument(s,document,{type,companyId,authorizationKind:system?'system-unsealed':'pending-approval'});return bindSystemDocument(s,document,record,companyId);
}
function amendProtectedDocument(s,document,type,transition,mutate){
 const proofOwner=globalThis.GH_DOCUMENT_PROOF;if(!proofOwner?.amendDocument){mutate(document);return null;}if(!document.documentProofId)protectDocument(s,document,type);const companyId=document.company||document.companyId||'group',system=activeExecutionMeta?.systemAuthorized===true&&!globalThis.GH_DOMAIN_COMMANDS?.hasActivePlayerApproval?.(),out=proofOwner.amendDocument(s,document,{transition,mutate,authorizationKind:system?'system-unsealed':'pending-approval'});return bindSystemDocument(s,document,out.record,companyId);
}
function recordCollection(s,{company,amount,reference,invoiceNumbers=[],counterparty='',channel='',grossAmount=amount,deductions=0,sourceRefs=[],purposeCategory='تحصيل إيراد',purposeDetail='',accountBalanceBefore=null,accountBalanceAfter=null}){
 const profile=collectionProfile(company,s),account=book(s,company).accounts[0],sender=partyMeta(s,counterparty||profile.source,'customer'),detail=String(purposeDetail||profile.service),row={id:reference,reference,at:now(s),company,beneficiaryCompany:company,from:sender.name||counterparty||profile.source,fromPartyId:sender.id,to:account.id,toAccount:account.id,amount,grossAmount,deductions,netAmount:amount,invoiceNumbers:[...invoiceNumbers],sourceRefs:sourceRefs.slice(0,80).map(String),channel:channel||profile.channel,service:profile.service,purposeCategory:String(purposeCategory||'تحصيل إيراد'),purposeDetail:detail,paymentMethod:'تحويل/تسوية مصرفية',kind:'revenue-collection',collection:true,label:'حوالة تحصيل إيراد',status:'منفذة',note:`تحصيل ${invoiceNumbers.join(' · ')} · ${detail}`};
 if(Number.isFinite(Number(accountBalanceBefore)))row.accountBalanceBefore=Number(accountBalanceBefore);if(Number.isFinite(Number(accountBalanceAfter)))row.accountBalanceAfter=Number(accountBalanceAfter);
 protectDocument(s,row,'revenue-collection');insertFinanceTransfer(s,row);ledger(s,company,row);recordWorldFinance(s,{partyId:sender.id,counterparty:row.from,company,direction:'incoming',amount,reference,transferRef:reference,documentNumber:invoiceNumbers[0]||null,note:row.note,settled:true});return row;
}
function companyName(s,t){t=requireCompany(s,t);return globalThis.GH_COMPANY_PLATFORM?.resolveIdentity?.(s,t)?.legalName||globalThis.GH_IDENTITY?.legalName?.(s,t)||documentProfile(s,t).legalName||(t==='group'?(s.profile?.name||'المجموعة'):(s.companyRegistry?.[t]?.legalName||({air:'الطيران',sea:'الشحن البحري',road:'النقل البري',power:'الطاقة',bank:'البنك',mobility:'التنقل الذكي'}[t]||t)));}
function cashPoolEligible(s,t){const definition=globalThis.GH_COMPANY_PLATFORM?.resolveCompany?.(s,t)?.definition;return definition?.finance?.cashPoolEligible!==false;}
const GENERIC_PARTY_NAMES=new Set(['طرف تعاقدي','طرف تعاقدي مسجل','عميل تعاقدي','عميل تعاقدي مسجل','جهة تمويل','مستفيد غير محدد','طرف خارجي']);
function formalCounterparty(s,company,kind,name=''){const value=String(name||'').trim();if(value&&!GENERIC_PARTY_NAMES.has(value))return value;const legal=companyName(s,requireCompany(s,company));return kind==='دخل'?`حساب العملاء المعتمدين — ${legal}`:`حساب الموردين المعتمدين — ${legal}`;}
function partyMeta(s,name,role='counterparty'){const W=globalThis.GH_BUSINESS_WORLD,id=W?.partyIdForName?.(s,name,role)||null,party=id?W?.resolveParty?.(s,id):null;return {id,name:party?.legalName||party?.displayName||String(name||'')};}
function migrateFormalParties(s){if(Number(s.finance.formalPartyMigrationVersion)>=1)return;for(const doc of s.finance.invoices||[]){if(doc.documentProofId)continue;const t=requireCompany(s,doc.company);doc.counterparty=formalCounterparty(s,t,doc.kind,doc.counterparty);}for(const bucket of [s.finance.payables||[],s.finance.receivables||[]])for(const doc of bucket){if(doc.documentProofId)continue;const t=requireCompany(s,doc.company),kind=(s.finance.invoices||[]).find(x=>x.number===doc.number)?.kind||(bucket===s.finance.receivables?'دخل':'مصروف');doc.counterparty=formalCounterparty(s,t,kind,doc.counterparty);}for(const cheque of s.finance.cheques||[]){if(cheque.documentProofId)continue;const t=requireCompany(s,cheque.company),linked=(s.finance.invoices||[]).find(x=>x.number===cheque.invoiceNumber);cheque.beneficiary=formalCounterparty(s,t,'مصروف',cheque.beneficiary||linked?.counterparty);}s.finance.formalPartyMigrationVersion=1;}
function backfillDebtRegister(s){if(Number(s.finance.debtRegisterMigrationVersion)>=2)return;for(const t of companyIds(s)){const b=s.companyFinance?.[t],debt=num(b?.debt),registered=(s.finance.debtRecords||[]).filter(x=>x.company===t&&x.status!=='مسدد').reduce((n,x)=>n+num(x.outstanding),0),gap=Math.max(0,debt-registered);if(gap>.01)s.finance.debtRecords.unshift({id:`DEBT-CARRY-${t}-B326`,company:t,companyName:companyName(s,t),lender:`رصيد تمويل مرحّل — ${companyName(s,t)}`,type:'رصيد دين مرحّل',liabilityAccount:'التزامات تمويلية مرحّلة',originalAmount:gap,outstanding:gap,issuedAt:now(s),dueDay:null,status:'قائم',legacy:true});}s.finance.debtRegisterMigrationVersion=2;}
function recordWorldFinance(s,p){try{return globalThis.GH_BUSINESS_WORLD?.execute?.({state:s},'record-finance',p)||null;}catch(error){console.warn('business-world finance bridge rejected',error);return null;}}
function makeBook(s,t,balance=0){t=requireCompany(s,t);const c=String(documentProfile(s,t).accountPrefix||t).toUpperCase().replace(/[^A-Z0-9_-]/g,'').slice(0,18)||'CO';return {type:t,companyId:t,accounts:[{id:`${c}-OPER-001`,name:'الحساب الجاري',currency:'USD',balance:num(balance)},{id:`${c}-RES-002`,name:'حساب الاحتياطي',currency:'USD',balance:0}],ledger:[],taxPayable:0,taxPaid:0,vat:{output:0,input:0,creditCarry:0,periodOutputStart:0,periodInputStart:0},debt:0,lastReconciledAt:now(s)};}
function isZeroFinancePlaceholder(book){
 if(!book||typeof book!=='object'||Array.isArray(book))return false;
 const accounts=Array.isArray(book.accounts)?book.accounts:[];
 const numeric=[...accounts.map(row=>row?.balance),book.taxPayable,book.taxPaid,book.taxAccrued,book.debt,...Object.values(book.vat&&typeof book.vat==='object'?book.vat:{})];
 if(numeric.some(value=>value!==undefined&&value!==null&&(!Number.isFinite(Number(value))||Math.abs(Number(value))>.000001)))return false;
 return accounts.length>0&&(!Array.isArray(book.ledger)||book.ledger.length===0)&&(!Array.isArray(book.auditTrail)||book.auditTrail.length===0);
}
function pruneOrphanFinanceBooks(s){
 const books=s.companyFinance&&typeof s.companyFinance==='object'&&!Array.isArray(s.companyFinance)?s.companyFinance:null;if(!books)return;
 const active=new Set((platformInstances(s)||[]).map(row=>String(row?.id||'')).filter(Boolean));
 for(const id of Object.keys(books)){
  if(active.has(id))continue;
  // Build 332/333 persisted zero placeholders for unfounded built-in sectors.
  // They are safe to discard; any non-zero or recorded orphan is a hard stop.
  if(isZeroFinancePlaceholder(books[id])){delete books[id];continue;}
  throw new Error(`finance-company-orphan:${id}`);
 }
}
function ensure(s){
 if(activeEnsureTarget===s&&activeEnsureComplete)return s.companyFinance;
 s.finance=s.finance&&typeof s.finance==='object'?s.finance:{};for(const k of ['invoices','payables','receivables','cheques','periods','journalEntries','transfers','payrollReports','dailyCompanyReports','taxSettlements','debtRecords','debtSettlements','intercompanyLoans','intercompanyLoanSettlements','cashPoolSweeps'])s.finance[k]=Array.isArray(s.finance[k])?s.finance[k]:[];
 s.finance.pendingDailyCash=companyMetricMap(s,s.finance.pendingDailyCash,'pending-daily-cash',{preserveLegacyZero:true});
 s.sectorProfitToday=companyMetricMap(s,s.sectorProfitToday,'sector-profit-today',{preserveLegacyZero:true});
 s.tripProfitAccrued=companyMetricMap(s,s.tripProfitAccrued,'trip-profit');
 s.tripRevenueAccrued=companyMetricMap(s,s.tripRevenueAccrued,'trip-revenue',{nonNegative:true});
 s.tripFuelAccrued=companyMetricMap(s,s.tripFuelAccrued,'trip-fuel',{nonNegative:true});
 s.tripMaintenanceAccrued=companyMetricMap(s,s.tripMaintenanceAccrued,'trip-maintenance',{nonNegative:true});
 s.tripCountAccrued=companyMetricMap(s,s.tripCountAccrued,'trip-count',{integer:true});
 if(s.lastClosedSectorProfit!==undefined)s.lastClosedSectorProfit=companyMetricMap(s,s.lastClosedSectorProfit,'last-closed-sector-profit');
 s.finance.paymentSequence=Math.max(1,Math.floor(Number(s.finance.paymentSequence)||1));s.finance.invoiceSequence=Math.max(1,Math.floor(Number(s.finance.invoiceSequence)||1));s.finance.taxSettlementSequence=Math.max(1,Math.floor(Number(s.finance.taxSettlementSequence)||1));s.finance.debtSettlementSequence=Math.max(1,Math.floor(Number(s.finance.debtSettlementSequence)||1));
 if(!Number.isSafeInteger(Number(s.finance.journalSequence))||Number(s.finance.journalSequence)<0){const archived=s.finance.auditArchive?.records?.journalEntries,rows=[...s.finance.journalEntries,...(Array.isArray(archived)?archived:[])],digestMax=(s.finance.auditArchive?.digests||[]).filter(d=>d?.kind==='journalEntries').reduce((max,d)=>Math.max(max,Number(d?.maxSequence)||0),0);s.finance.journalSequence=Math.max(digestMax,rows.reduce((max,row)=>{const match=/^JE-(\d+)$/.exec(String(row?.id||''));return match?Math.max(max,Number(match[1])||0):max;},0));}else s.finance.journalSequence=Math.floor(Number(s.finance.journalSequence));
 s.treasury=s.treasury&&typeof s.treasury==='object'?s.treasury:{accounts:[],ledger:[],paymentQueue:[]};s.treasury.accounts=Array.isArray(s.treasury.accounts)?s.treasury.accounts:[];s.treasury.ledger=Array.isArray(s.treasury.ledger)?s.treasury.ledger:[];
 while(s.treasury.accounts.length<3){const i=s.treasury.accounts.length;s.treasury.accounts.push({id:['GH-OPER-001','GH-RES-002','GH-INV-003'][i],name:['الحساب الجاري','حساب الاحتياطي','الاستثمارات'][i],currency:'USD',balance:0});}
 const had=s.companyFinance&&typeof s.companyFinance==='object'&&!Array.isArray(s.companyFinance)&&Object.keys(s.companyFinance).length>0;s.companyFinance=had?s.companyFinance:{};
 const ids=companyIds(s);
 s.companyFinance.group=s.companyFinance.group||makeBook(s,'group');s.companyFinance.group.accounts=s.treasury.accounts;
 for(const t of ids){if(!s.companyFinance[t])s.companyFinance[t]=makeBook(s,t);const b=s.companyFinance[t];b.type=t;b.companyId=t;b.accounts=Array.isArray(b.accounts)&&b.accounts.length?b.accounts:makeBook(s,t).accounts;b.ledger=Array.isArray(b.ledger)?b.ledger:[];for(const a of b.accounts)a.balance=Number.isFinite(Number(a.balance))?Number(a.balance):0;b.taxPayable=Number.isFinite(Number(b.taxPayable))?Number(b.taxPayable):0;b.taxPaid=Number.isFinite(Number(b.taxPaid))?Number(b.taxPaid):0;b.debt=Number.isFinite(Number(b.debt))?Number(b.debt):0;b.vat=b.vat&&typeof b.vat==='object'?b.vat:{};for(const k of ['output','input','creditCarry','periodOutputStart','periodInputStart'])b.vat[k]=Number.isFinite(Number(b.vat[k]))?Number(b.vat[k]):0;}
 for(const id of Object.keys(s.companyFinance))if(!ids.includes(id)&&!isZeroFinancePlaceholder(s.companyFinance[id]))throw new Error(`finance-company-unknown:${id}`);
 s.companyFinance.group.accounts=s.treasury.accounts;
 migrateFormalParties(s);backfillDebtRegister(s);
 if(!had&&(s.openedCompanies||[]).length){const opened=s.openedCompanies.map(t=>requireCompany(s,t)).filter(t=>t!=='group'),src=s.treasury.accounts[0],pool=num(src.balance)*.55,assetOwner=a=>String(a?.ownerCompanyId||a?.companyId||a?.company||globalThis.GH_COMPANY_PLATFORM?.ownerForLegacyAssetMode?.(a?.assetMode||a?.type)||''),weights=opened.map(t=>[t,Math.max(1,(s.assets||[]).filter(a=>assetOwner(a)===t).length*2+1)]),sw=weights.reduce((n,x)=>n+x[1],0)||1;let alloc=0;weights.forEach(([t,x],i)=>{const a=i===weights.length-1?Math.max(0,pool-alloc):Math.floor(pool*x/sw);s.companyFinance[t].accounts[0].balance=a;alloc+=a;});src.balance=Math.max(0,num(src.balance)-alloc);}
 s.companyBudgets=s.companyBudgets&&typeof s.companyBudgets==='object'&&!Array.isArray(s.companyBudgets)?s.companyBudgets:{};
 s.finance.centralTreasury=s.finance.centralTreasury&&typeof s.finance.centralTreasury==='object'&&!Array.isArray(s.finance.centralTreasury)?s.finance.centralTreasury:{};const ct=s.finance.centralTreasury;ct.minOperatingCash=ct.minOperatingCash&&typeof ct.minOperatingCash==='object'&&!Array.isArray(ct.minOperatingCash)?ct.minOperatingCash:{};for(const t of ids.filter(x=>x!=='group'))ct.minOperatingCash[t]=num(ct.minOperatingCash[t]);ct.lastPolicyAt=num(ct.lastPolicyAt);ct.lastSweepAt=num(ct.lastSweepAt);backfillPayrollTransfers(s);reconcile(s);return s.companyFinance;
}
// Historical position is not an idempotency boundary. The same owner searches
// the live register first, then full archive records without duplicating writes.
function findFinanceDocument(s,bucket,predicate){
 const live=Array.isArray(s.finance?.[bucket])?s.finance[bucket]:[],found=live.find(predicate);if(found)return found;
 const kind=bucket==='periods'?'taxPeriods':bucket,archived=s.finance?.auditArchive?.records?.[kind];return Array.isArray(archived)?archived.find(predicate):undefined;
}
function hasFinanceDocument(s,bucket,predicate){return !!findFinanceDocument(s,bucket,predicate);}
const TRANSFER_INDEX_MEMO_KEY='finance.transfer-lookup-index/v1';
const FINANCE_LIST_INDEX_MEMO_PREFIX='finance.list-number-index/v1:';
function currentTransactionMemo(key){const tx=globalThis.GH_TRANSACTION_CORE;if(!tx?.isActive?.())return undefined;return tx.transactionMemoGet?.(key);}
function rankLookup(map,key,row,rank){if(key==null)return;const current=map.get(key);if(!current||rank<current.rank)map.set(key,{row,rank});}
function addTransferIndexRow(index,row,rank){rankLookup(index.byReference,row?.reference,row,rank);rankLookup(index.byId,row?.id,row,rank);if(row?.documentNumber&&['payroll-payable','payroll-transfer'].includes(row.kind))rankLookup(index.byPayrollDocument,row.documentNumber,row,rank);}
function buildTransferLookupIndex(s){
 const index={byReference:new Map(),byId:new Map(),byPayrollDocument:new Map(),nextRank:-1},live=Array.isArray(s.finance?.transfers)?s.finance.transfers:[],archive=s.finance?.auditArchive?.records?.transfers;
 let rank=0;for(const row of live)addTransferIndexRow(index,row,rank++);for(const row of Array.isArray(archive)?archive:[])addTransferIndexRow(index,row,rank++);return index;
}
function transferLookupIndex(s){const tx=globalThis.GH_TRANSACTION_CORE;if(!tx?.isActive?.())return null;let index=tx.transactionMemoGet?.(TRANSFER_INDEX_MEMO_KEY);if(!(index instanceof Object)){index=buildTransferLookupIndex(s);tx.transactionMemoSet?.(TRANSFER_INDEX_MEMO_KEY,index);}return index;}
function bestTransferMatch(index,...matches){let found=null;for(const match of matches)if(match&&(!found||match.rank<found.rank))found=match;return found?.row;}
function findTransferByReference(s,reference){const index=transferLookupIndex(s);return index?index.byReference.get(reference)?.row:findFinanceDocument(s,'transfers',row=>row.reference===reference);}
function findTransferById(s,id){const index=transferLookupIndex(s);return index?index.byId.get(id)?.row:findFinanceDocument(s,'transfers',row=>row.id===id);}
function findTransferByIdOrReference(s,id){const index=transferLookupIndex(s);return index?bestTransferMatch(index,index.byReference.get(id),index.byId.get(id)):findFinanceDocument(s,'transfers',row=>row.reference===id||row.id===id);}
function findPayrollTransferByDocument(s,number){const index=transferLookupIndex(s);return index?index.byPayrollDocument.get(number)?.row:findFinanceDocument(s,'transfers',row=>row.documentNumber===number&&['payroll-payable','payroll-transfer'].includes(row.kind));}
function buildFinanceListIndex(s,bucket){
 const byNumber=new Map(),allByNumber=bucket==='receivables'?new Map():null,add=(rows)=>{for(const row of Array.isArray(rows)?rows:[]){const number=row?.number;if(!byNumber.has(number))byNumber.set(number,row);if(allByNumber){let matches=allByNumber.get(number);if(!matches){matches=[];allByNumber.set(number,matches);}matches.push(row);}}};
 add(s.finance?.[bucket]);if(bucket==='invoices')add(s.finance?.auditArchive?.records?.invoices);return {byNumber,allByNumber};
}
function financeListIndex(s,bucket){const tx=globalThis.GH_TRANSACTION_CORE;if(!tx?.isActive?.())return null;const key=FINANCE_LIST_INDEX_MEMO_PREFIX+bucket;let index=tx.transactionMemoGet?.(key);if(!(index instanceof Object)){index=buildFinanceListIndex(s,bucket);tx.transactionMemoSet?.(key,index);}return index;}
function invalidateFinanceLookupIndexes(){const tx=globalThis.GH_TRANSACTION_CORE;if(!tx?.isActive?.())return;tx.transactionMemoSet?.(TRANSFER_INDEX_MEMO_KEY,null);for(const bucket of ['invoices','payables','receivables','periods'])tx.transactionMemoSet?.(FINANCE_LIST_INDEX_MEMO_PREFIX+bucket,null);}
function financeRowByNumber(s,bucket,number){const index=financeListIndex(s,bucket);if(index)return index.byNumber.get(number);const rows=Array.isArray(s.finance?.[bucket])?s.finance[bucket]:[],found=rows.find(row=>row.number===number);if(found||bucket!=='invoices')return found;const archive=s.finance?.auditArchive?.records?.invoices;return Array.isArray(archive)?archive.find(row=>row.number===number):undefined;}
function insertFinanceRow(s,bucket,row){const rows=s.finance[bucket],result=rows.unshift(row),index=currentTransactionMemo(FINANCE_LIST_INDEX_MEMO_PREFIX+bucket);if(index?.byNumber instanceof Map){index.byNumber.set(row?.number,row);if(index.allByNumber){let matches=index.allByNumber.get(row?.number);if(!matches){matches=[];index.allByNumber.set(row?.number,matches);}matches.unshift(row);}}return result;}
function insertFinanceTransfer(s,row){const result=s.finance.transfers.unshift(row),index=currentTransactionMemo(TRANSFER_INDEX_MEMO_KEY);if(index?.byReference instanceof Map){const rank=index.nextRank--;addTransferIndexRow(index,row,rank);}return result;}
function withCollectionBatch(s,apply){
 if(!s||typeof s!=='object'||typeof apply!=='function')throw new TypeError('finance-collection-batch-invalid');if(!globalThis.GH_TRANSACTION_CORE?.isActive?.())throw new Error('finance-collection-batch-requires-full-transaction');
 const active=collectionBatches.get(s);if(active){active.depth++;try{const value=apply();if(value?.then)throw new Error('finance-collection-batch-must-be-synchronous');return value;}finally{active.depth--;}}
 const batch={depth:1,removedReceivables:new Set()};collectionBatches.set(s,batch);try{const value=apply();if(value?.then)throw new Error('finance-collection-batch-must-be-synchronous');return value;}finally{collectionBatches.delete(s);if(batch.removedReceivables.size)s.finance.receivables=s.finance.receivables.filter(row=>!batch.removedReceivables.has(row));}
}
function removeReceivableByNumber(s,number){
 const index=financeListIndex(s,'receivables'),matches=index?.allByNumber.get(number),batch=collectionBatches.get(s);
 if(batch){for(const row of matches||[])batch.removedReceivables.add(row);if(index){index.byNumber.delete(number);index.allByNumber.delete(number);}return;}
 s.finance.receivables=s.finance.receivables.filter(row=>row.number!==number);if(index){index.byNumber.delete(number);index.allByNumber.delete(number);}
}
function nextFinanceTransferReference(s,prefix){
 // Array length is not a sequence: archive trimming must not turn a new payment
 // into a replay of an older one at the same simulation timestamp.
 let sequence=Number(s.finance.transferSequence);
 if(!Number.isSafeInteger(sequence)||sequence<0){
  sequence=0;const inspect=value=>{const match=/^(?:TR|FND|FND-WD)-\d+-(\d+)$/.exec(String(value||''));if(match){const n=Number(match[1]);if(Number.isSafeInteger(n))sequence=Math.max(sequence,n);}};
  for(const rows of [s.finance.transfers,s.finance.auditArchive?.records?.transfers])for(const row of Array.isArray(rows)?rows:[]){inspect(row.id);inspect(row.reference);}
  for(const digest of s.finance.auditArchive?.digests||[])if(digest.kind==='transfers')sequence=Math.max(sequence,Number(digest.maxSequence)||0);
 }
 let reference;do{sequence++;if(!Number.isSafeInteger(sequence))throw new Error('finance-transfer-sequence-exhausted');reference=`${prefix}-${Math.floor(now(s))}-${sequence}`;}while(findTransferByIdOrReference(s,reference));
 s.finance.transferSequence=sequence;return reference;
}
function backfillPayrollTransfers(s){
 if(Number(s.finance.payrollTransferMigrationVersion)>=1)return;
 const index=buildTransferLookupIndex(s),payablesByNumber=new Map();for(const payable of s.finance.payables)if(!payablesByNumber.has(payable?.number))payablesByNumber.set(payable?.number,payable);
 for(const doc of s.finance.invoices){
  const payroll=doc?.budgetLine==='payroll'||doc?.payrollShortfall===true;if(!payroll)continue;
  const t=requireCompany(s,doc.company),settled=['مدفوعة','مسددة','محصلة'].includes(doc.status),reportId=String(doc.payrollReportId||''),reference=String(doc.transferReference||`PAYTR-${reportId||doc.number}-${t}${settled?'':'-DUE'}`),existing=bestTransferMatch(index,index.byReference.get(reference),index.byId.get(reference),index.byPayrollDocument.get(doc.number));
  doc.transferReference=existing?.reference||reference;const payable=payablesByNumber.get(doc.number);if(payable){payable.payrollShortfall=true;payable.payrollReportId=payable.payrollReportId||doc.payrollReportId||null;payable.transferReference=doc.transferReference;}
  if(existing)continue;const from=s.companyFinance[t]?.accounts?.[0]?.id||`${String(t).toUpperCase()}-OPER-001`;
  const transfer={id:reference,reference,at:Number(doc.at)||now(s),from,to:doc.counterparty||'حسابات الموظفين',amount:num(doc.total??doc.amount),note:doc.note||`مسير رواتب ${companyName(s,t)}`,company:t,kind:settled?'payroll-transfer':'payroll-payable',label:settled?'حوالة مسير رواتب':'حوالة رواتب مستحقة',status:settled?'منفذة':'مستحقة',documentNumber:doc.number,payrollReportId:doc.payrollReportId||null,migrated:true};
  insertFinanceTransfer(s,transfer);addTransferIndexRow(index,transfer,index.nextRank--);
 }
 s.finance.payrollTransferMigrationVersion=1;
}
function book(s,t='group'){const type=requireCompany(s,t),result=s?.companyFinance?.[type];if(!result||!Array.isArray(result.accounts)||!result.accounts.length)throw new Error(`finance-book-missing:${type}`);return result;}
function operating(s,t='group'){const value=Number(book(s,t).accounts?.[0]?.balance);return Number.isFinite(value)?value:NaN;} function total(s,t='group'){return (book(s,t).accounts||[]).reduce((n,a)=>{const value=Number(a.balance);return n+(Number.isFinite(value)?value:NaN);},0);}
function budgetView(s,t='group'){t=requireCompany(s,t);const period=Math.floor(Math.floor(now(s)/86400)/30),source=s?.companyBudgets?.[t],b=source&&typeof source==='object'?clone(source):{limit:0,spent:0,reserved:0,period,enabled:false,lines:{},spentByLine:{},reservedByLine:{}};for(const k of ['limit','spent','reserved'])b[k]=num(b[k]);b.enabled=!!b.enabled;b.lines=b.lines&&typeof b.lines==='object'?b.lines:{};b.spentByLine=b.spentByLine&&typeof b.spentByLine==='object'?b.spentByLine:{};b.reservedByLine=b.reservedByLine&&typeof b.reservedByLine==='object'?b.reservedByLine:{};for(const k of ['payroll','fuel','maintenance','marketing','insurance','technology','capex','other'])b.lines[k]=num(b.lines[k]);if(Number(b.period)!==period){b.period=period;b.spent=0;b.reserved=0;b.spentByLine={};b.reservedByLine={};}return b;}
function mutableBudget(s,t='group'){ensure(s);t=requireCompany(s,t);const view=budgetView(s,t);s.companyBudgets[t]=view;return view;}
const budget=budgetView;
function lineFor(note='',method=''){const t=`${note} ${method}`.toLowerCase();if(/راتب|رواتب|payroll/.test(t))return'payroll';if(/وقود|fuel/.test(t))return'fuel';if(/صيان|maintenance|mro/.test(t))return'maintenance';if(/تسويق|marketing/.test(t))return'marketing';if(/تأمين|insurance/.test(t))return'insurance';if(/تقنية|technology|software|نظام/.test(t))return'technology';if(/شراء|إنشاء|بناء|أصل|طائرة|سفينة|شاحن|capex/.test(t))return'capex';return'other';}
function remaining(s,t){const b=budget(s,t);return !b.enabled||b.limit<=0?Infinity:Math.max(0,b.limit-b.spent-b.reserved)} function lineRemaining(s,t,l){const b=budget(s,t),lim=num(b.lines[l]);return !b.enabled||lim<=0?Infinity:Math.max(0,lim-num(b.spentByLine[l])-num(b.reservedByLine[l]));}
function canSpend(s,t,a,l=null){a=Number(a);if(!Number.isFinite(a)||a<0)return false;if(s.godMoney&&s.infiniteMoney)return true;return operating(s,t)>=a&&remaining(s,t)>=a&&(!l||lineRemaining(s,t,l)>=a);}
// نفس فحص operating(s,t)>=a الخام + تجاوز الأموال اللانهائية فقط - بلا فحص الميزانية remaining()
// الإضافي الذي تفرضه canSpend، حتى لا يتغير سلوك هذه الدوال حين يكون وضع الإله مطفأً.
function hasFunds(s,t,a){return (s.godMoney&&s.infiniteMoney)||operating(s,t)>=Number(a);}
function coverInfiniteFunds(s,t,a,reason='تغطية وضع الأموال اللانهائية'){
 const requested=num(a),shortfall=Math.max(0,requested-operating(s,t));if(!(s.godMoney&&s.infiniteMoney)||shortfall<=0)return 0;
 const account=book(s,t).accounts[0],reference=`INF-${t}-${String((Number(s.finance?.journalSequence)||0)+1).padStart(8,'0')}`;account.balance+=shortfall;
 journal(s,t,reason,[{account:account.id,debit:shortfall},{account:'حقوق ملكية وضع اللعب',credit:shortfall}],reference);
 ledger(s,t,{at:now(s),from:'تمويل وضع اللعب',to:account.id,amount:shortfall,note:reason,company:t,kind:'sandbox-capital-cover',label:'تغطية وضع اللعب',fundingSource:'sandbox-unlimited-money',status:'منفذة',reference});return shortfall;
}
function consumeBudget(s,t,a,l){const b=mutableBudget(s,t);a=num(a);if(b.enabled&&b.limit>0)b.spent+=a;if(l)b.spentByLine[l]=num(b.spentByLine[l])+a;} // Incurred expenses are liabilities, not discretionary cash spends. Reserve them for budget tracking even when cash or the budget cap is short.
function reserveAccruedObligationBudget(s,t,a,l='other'){a=num(a);if(a<0)return null;const b=mutableBudget(s,t),totalRoom=!b.enabled||b.limit<=0?Infinity:Math.max(0,b.limit-b.spent-b.reserved),lineLimit=num(b.lines[l]),lineRoom=!b.enabled||lineLimit<=0?Infinity:Math.max(0,lineLimit-num(b.spentByLine[l])-num(b.reservedByLine[l])),reserved=Math.max(0,Math.min(a,totalRoom,lineRoom));if(b.enabled&&b.limit>0)b.reserved+=reserved;if(l)b.reservedByLine[l]=num(b.reservedByLine[l])+reserved;return {reserved,unbudgeted:Math.max(0,a-reserved)};}
function reserveBudget(s,t,a,l='other'){a=num(a);if(!canSpend(s,t,a,l))return false;const b=mutableBudget(s,t);if(b.enabled&&b.limit>0)b.reserved+=a;b.reservedByLine[l]=num(b.reservedByLine[l])+a;return true;} function consumeReserved(s,t,a,l='other'){const b=mutableBudget(s,t),held=Math.min(num(a),num(b.reservedByLine[l]));b.reserved=Math.max(0,b.reserved-held);b.reservedByLine[l]=Math.max(0,num(b.reservedByLine[l])-held);consumeBudget(s,t,a,l);} function releaseReserved(s,t,a,l='other'){const b=mutableBudget(s,t),held=Math.min(num(a),num(b.reservedByLine[l]));b.reserved=Math.max(0,b.reserved-held);b.reservedByLine[l]=Math.max(0,num(b.reservedByLine[l])-held);return held;}
function reconcile(s){if(!s.companyFinance)return Number(s.cash)||0;let cash=0,debt=0,taxPayable=0,taxPaid=0;const ids=companyIds(s);for(const id of Object.keys(s.companyFinance))if(!ids.includes(id)&&!isZeroFinancePlaceholder(s.companyFinance[id]))throw new Error(`finance-company-unknown:${id}`);for(const t of ids){const b=s.companyFinance[t];if(!b)continue;for(const account of b.accounts||[]){const value=Number(account.balance);if(!Number.isFinite(value)||value<0)throw new Error(`invalid-account-balance:${t}`);cash+=value;}for(const [key,target] of [['debt','debt'],['taxPayable','taxPayable'],['taxPaid','taxPaid']]){const value=Number(b[key]);if(!Number.isFinite(value)||value<0)throw new Error(`invalid-${key}:${t}`);if(target==='debt')debt+=value;else if(target==='taxPayable')taxPayable+=value;else taxPaid+=value;}}s.cash=cash;s.debt=debt;if(s.finance){s.finance.taxPayable=taxPayable;s.finance.taxPaid=taxPaid;}return s.cash;}
function ledgerEntry(s,e,overrides={}){const owner=globalThis.GH_DOCUMENT_PROOF;return owner?.ledgerProjection?owner.ledgerProjection(s,e,overrides):Object.assign(clone(e),clone(overrides||{}));}
function companyLedger(s,t,e,overrides={}){const row=ledgerEntry(s,e,overrides);book(s,t).ledger.unshift(row);return row;}
function ledger(s,t,e,overrides={}){const row=companyLedger(s,t,e,overrides);s.treasury.ledger.unshift(clone(row));s.treasury.ledger=s.treasury.ledger.slice(0,1200);return row;}
function journal(s,t,desc,lines,ref=''){ensure(s);const rows=(lines||[]).map(x=>({account:String(x.account||''),debit:num(x.debit),credit:num(x.credit)})).filter(x=>x.account&&(x.debit>0||x.credit>0)),dr=rows.reduce((n,x)=>n+x.debit,0),cr=rows.reduce((n,x)=>n+x.credit,0);if(!rows.length||Math.abs(dr-cr)>.02)throw new Error(`قيد غير متوازن: ${desc}`);const sequence=++s.finance.journalSequence,row={id:`JE-${String(sequence).padStart(8,'0')}`,company:t,description:desc,lines:rows,sourceRef:ref,at:now(s)};s.finance.journalEntries.unshift(row);return row;}
function refreshBookTaxPayable(s,company){const b=book(s,company),vat=b.vat||(b.vat={output:0,input:0,creditCarry:0,periodOutputStart:0,periodInputStart:0}),formalDue=(s.finance.periods||[]).filter(row=>row.company===company&&row.status==='مستحق').reduce((sum,row)=>sum+num(row.amount),0),openAccrual=Math.max(0,(num(vat.output)-num(vat.periodOutputStart))-(num(vat.input)-num(vat.periodInputStart))-num(vat.creditCarry));b.taxAccrued=openAccrual;b.taxPayable=formalDue;return b.taxPayable;}
function invoice(s,{kind,amount,note,method='تحويل بنكي',taxable=true,status='مدفوعة',company='group',counterparty='',number=null,dueDay=null,sourceRef=null,settlementAccount=null}={}){
 ensure(s);company=requireCompany(s,company);amount=num(amount);const tax=taxable?Math.round(amount*(.15/1.15)):0,subtotal=Math.max(0,amount-tax),prefix=String(documentProfile(s,company).documentPrefix||company).toUpperCase(),doc=number||`${prefix}-${String(s.finance.invoiceSequence).padStart(6,'0')}`;if(!number)s.finance.invoiceSequence++;const rawCounterparty=formalCounterparty(s,company,kind,counterparty),cp=partyMeta(s,rawCounterparty,kind==='دخل'?'customer':'supplier'),settled=['مدفوعة','مسددة','محصلة'].includes(status),row={number:doc,company,companyName:companyName(s,company),accountId:book(s,company).accounts[0].id,kind,amount,subtotal,tax,total:amount,note:String(note||''),method,status,counterparty:cp.name||rawCounterparty,counterpartyPartyId:cp.id,at:now(s)};if(dueDay!=null)row.dueDay=dueDay;else if(!settled)row.dueDay=Math.floor(now(s)/86400)+30;if(sourceRef)row.sourceRef=String(sourceRef);if(settlementAccount)row.settlementAccount=String(settlementAccount);protectDocument(s,row,kind==='دخل'?'invoice-receivable':'invoice-payable');insertFinanceRow(s,'invoices',row);recordWorldFinance(s,{partyId:cp.id,counterparty:row.counterparty,company,direction:kind==='دخل'?'incoming':'outgoing',amount,reference:sourceRef||doc,documentNumber:doc,note:row.note,settled:false});if(!settled)insertFinanceRow(s,kind==='دخل'?'receivables':'payables',{...row});const vat=book(s,company).vat;if(taxable){if(kind==='دخل')vat.output+=tax;else vat.input+=tax;}refreshBookTaxPayable(s,company);const cash=book(s,company).accounts[0].id,counter=kind==='دخل'?'ذمم مدينة':'ذمم دائنة',settlement=settlementAccount?String(settlementAccount):cash;journal(s,company,`${doc} · ${note}`,kind==='دخل'?[{account:settled?settlement:counter,debit:amount},{account:'إيرادات تشغيلية',credit:subtotal},{account:'ضريبة مخرجات VAT',credit:tax}]:[{account:'مصروف تشغيلي',debit:subtotal},{account:'ضريبة مدخلات VAT',debit:tax},{account:settled?settlement:counter,credit:amount}],sourceRef||doc);return row;
}
function syncInvoiceIndex(s,document){for(const bucket of ['payables','receivables']){const row=financeRowByNumber(s,bucket,document.number);if(!row||row===document)continue;for(const key of Object.keys(row))delete row[key];Object.assign(row,clone(document));}return document;}
function amendInvoice(s,document,transition,mutate){amendProtectedDocument(s,document,document.documentType||(document.kind==='دخل'?'invoice-receivable':'invoice-payable'),transition,mutate);return syncInvoiceIndex(s,document);}
function issueInvoice(s,p={}){
 const kind=p.kind==='مصروف'?'مصروف':p.kind==='دخل'?'دخل':null,amount=Number(p.amount),status=String(p.status||'مستحقة');
 if(!kind)throw new Error('invoice-kind-invalid');
 if(!Number.isFinite(amount)||amount<=0)throw new Error('invoice-amount-invalid');
 if(!['مستحقة','مدفوعة','مسددة','محصلة'].includes(status))throw new Error('invoice-status-invalid');
 return invoice(s,{...p,kind,amount,status});
}
function transfer(s,p){ensure(s);const a=num(p.amount),from=requireCompany(s,p.from,{defaultGroup:false}),to=requireCompany(s,p.to,{defaultGroup:false}),reference=String(p.ref||p.reference||nextFinanceTransferReference(s,'TR'));if(from===to||a<=0)throw new Error('invalid-transfer');const prior=findTransferByIdOrReference(s,reference);if(prior){if(prior.fromCompany!==from||prior.toCompany!==to||Math.abs(num(prior.amount)-a)>.01)throw new Error('transfer-reference-conflict');return {transferred:true,status:'transferred',from,to,amount:a,reference,idempotent:true};}if(!hasFunds(s,from,a))throw new Error('insufficient-cash');coverInfiniteFunds(s,from,a,'تغطية تحويل داخلي في وضع اللعب');const fa=book(s,from).accounts[0],ta=book(s,to).accounts[0];fa.balance-=a;ta.balance+=a;const e={id:reference,reference,at:now(s),from:fa.id,to:ta.id,fromCompany:from,toCompany:to,amount:a,note:p.note||'تحويل داخلي',kind:'intercompany',label:'حوالة داخلية منفذة',status:'منفذة',company:from,beneficiaryCompany:to};protectDocument(s,e,'intercompany-transfer');insertFinanceTransfer(s,{...e});ledger(s,from,e);companyLedger(s,to,e);journal(s,from,e.note,[{account:'استثمار/ذمم بين شركات المجموعة',debit:a},{account:fa.id,credit:a}],reference);journal(s,to,e.note,[{account:ta.id,debit:a},{account:'رأس مال/ذمم بين شركات المجموعة',credit:a}],reference);reconcile(s);return {transferred:true,status:'transferred',from,to,amount:a,reference,idempotent:false,documentProofId:e.documentProofId,contentDigest:e.contentDigest};}
function settleIntercompanyInterest(s,p={}){
 ensure(s);const from=requireCompany(s,p.from||p.company,{defaultGroup:false}),to=requireCompany(s,p.to||'bank'),amount=num(p.amount),reference=String(p.ref||p.reference||'').trim();
 if(from==='bank'||to!=='bank'||amount<=0)throw new Error('invalid-intercompany-interest');
 if(!reference)throw new Error('intercompany-interest-reference-required');
 const note=String(p.note||`فائدة تسهيل ائتماني · ${reference}`),requestFingerprint=JSON.stringify([from,to,amount,note]),prior=findTransferByIdOrReference(s,reference);
 if(prior){if(prior.kind!=='intercompany-interest'||prior.fromCompany!==from||prior.toCompany!==to||Math.abs(num(prior.amount)-amount)>.01||prior.requestFingerprint&&prior.requestFingerprint!==requestFingerprint)throw new Error('intercompany-interest-reference-conflict');return {settled:true,from,to,amount:0,reference,idempotent:true,cashPostedRevenue:0};}
 if(!hasFunds(s,from,amount))throw new Error('insufficient-interest-cash');
 const payer=book(s,from),receiver=book(s,to),payerName=companyName(s,from),bankName=companyName(s,to);
 coverInfiniteFunds(s,from,amount,'تغطية تسوية فائدة في وضع اللعب');payer.accounts[0].balance-=amount;receiver.accounts[0].balance+=amount;
 const expense=invoice(s,{kind:'مصروف',amount,note,method:'تسوية فائدة داخلية',taxable:false,status:'مدفوعة',company:from,counterparty:bankName,sourceRef:reference});
 const income=invoice(s,{kind:'دخل',amount,note:`دخل ${note}`,method:'تسوية فائدة داخلية',taxable:false,status:'محصلة',company:to,counterparty:payerName,sourceRef:reference});
 const event={at:now(s),from:payer.accounts[0].id,to:receiver.accounts[0].id,amount,note,kind:'intercompany-interest',company:from,beneficiaryCompany:to,reference,expenseDocumentNumber:expense.number,incomeDocumentNumber:income.number};
 Object.assign(event,{id:reference,status:'منفذة',collection:true,channel:collectionProfile(to,s).channel,service:'تحصيل فائدة تسهيل ائتماني',grossAmount:amount,deductions:0,invoiceNumbers:[income.number],sourceRefs:[reference],fromCompany:from,toCompany:to,requestFingerprint});protectDocument(s,event,'intercompany-interest');amendInvoice(s,expense,'invoice-transfer-linked',doc=>{doc.transferReference=reference;});amendInvoice(s,income,'invoice-transfer-linked',doc=>{doc.transferReference=reference;});insertFinanceTransfer(s,{...event});ledger(s,from,event);companyLedger(s,to,event);reconcile(s);
 return {settled:true,from,to,amount,reference,expenseInvoiceNumber:expense.number,incomeInvoiceNumber:income.number,idempotent:false,cashPostedRevenue:amount};
}
function bulkTransfer(s,p){const rows=Array.isArray(p.rows)?p.rows:[],seen=new Set(),clean=[];for(const x of rows){const t=requireCompany(s,x.company,{defaultGroup:false}),a=num(x.amount);if(t==='group'||a<=0)continue;if(seen.has(t))throw new Error('duplicate-beneficiary');seen.add(t);clean.push({company:t,amount:a});}if(!clean.length)throw new Error('empty-bulk-transfer');const total=clean.reduce((n,x)=>n+x.amount,0);if(!hasFunds(s,'group',total))throw new Error('insufficient-cash');const batch=p.batchId||`BULK-${Math.floor(now(s))}-${s.finance.transfers.length+1}`;for(const x of clean)transfer(s,{from:'group',to:x.company,amount:x.amount,note:`${p.note||'توزيع رأسمالي'} · ${batch}`,ref:`${batch}-${x.company}`});return {total,count:clean.length,batchId:batch};}
function centralTreasuryPolicy(s){ensure(s);return clone(s.finance.centralTreasury);}
function setCentralTreasuryPolicy(s,p={}){ensure(s);const ct=s.finance.centralTreasury,rows=p.minOperatingCash&&typeof p.minOperatingCash==='object'?p.minOperatingCash:{};for(const key of Object.keys(rows))requireCompany(s,key,{defaultGroup:false});for(const t of companyIds(s,{includeGroup:false}))if(Object.prototype.hasOwnProperty.call(rows,t))ct.minOperatingCash[t]=num(rows[t]);ct.lastPolicyAt=now(s);return clone(ct);}
function cashPoolSweep(s,p={}){
 ensure(s);const ct=s.finance.centralTreasury,companies=(Array.isArray(p.companies)?p.companies:(s.openedCompanies||[])).map(t=>requireCompany(s,t,{defaultGroup:false})).filter(t=>t!=='group'&&cashPoolEligible(s,t)),batch=String(p.batchId||`POOL-${Math.floor(now(s))}-${s.finance.cashPoolSweeps.length+1}`),rows=[];
 if(s.finance.cashPoolSweeps.some(x=>x.id===batch))return clone(s.finance.cashPoolSweeps.find(x=>x.id===batch));
 for(const t of [...new Set(companies)]){const available=num(book(s,t).accounts[0].balance),floor=num(ct.minOperatingCash[t]),surplus=Math.max(0,available-floor),requested=p.amounts&&Object.prototype.hasOwnProperty.call(p.amounts,t)?num(p.amounts[t]):surplus,amount=Math.min(surplus,requested);if(amount>.01){transfer(s,{from:t,to:'group',amount,note:`Cash Pool · فائض ${companyName(s,t)}`,ref:`${batch}-${t}`});rows.push({company:t,amount,floor,balanceBefore:available,balanceAfter:available-amount});}}
 const out={id:batch,at:now(s),rows,total:rows.reduce((n,x)=>n+x.amount,0),status:rows.length?'منفذ':'لا يوجد فائض'};s.finance.cashPoolSweeps.unshift(out);s.finance.cashPoolSweeps=s.finance.cashPoolSweeps.slice(0,120);ct.lastSweepAt=now(s);return clone(out);
}
function accrueIntercompanyLoan(s,loan){const day=Math.floor(now(s)/86400),last=Math.max(0,Number(loan.lastAccrualDay??loan.issuedDay??day)),elapsed=Math.max(0,day-last);if(elapsed&&num(loan.outstandingPrincipal)>0){loan.accruedInterest=num(loan.accruedInterest)+num(loan.outstandingPrincipal)*Math.max(0,Number(loan.annualRate)||0)*elapsed/365;loan.lastAccrualDay=day;}return loan;}
function issueIntercompanyLoan(s,p={}){
 ensure(s);const lender=requireCompany(s,p.lender||'group'),borrower=requireCompany(s,p.borrower,{defaultGroup:false}),amount=num(p.amount),annualRate=Math.max(0,Number(p.annualRate)||0),termDays=Math.max(1,Math.floor(Number(p.termDays)||365)),id=String(p.id||p.reference||`ICL-${Math.floor(now(s))}-${s.finance.intercompanyLoans.length+1}`);
 const note=String(p.note||`تمويل داخلي من ${companyName(s,lender)} إلى ${companyName(s,borrower)}`),requestFingerprint=JSON.stringify([lender,borrower,amount,annualRate,termDays,note]);if(lender===borrower||amount<=0)throw new Error('invalid-intercompany-loan');const prior=s.finance.intercompanyLoans.find(x=>x.id===id);if(prior){if(prior.requestFingerprint&&prior.requestFingerprint!==requestFingerprint||prior.lender!==lender||prior.borrower!==borrower||Math.abs(num(prior.originalPrincipal)-amount)>.01||Number(prior.annualRate)!==annualRate||Number(prior.dueDay)-Number(prior.issuedDay)!==termDays)throw new Error('intercompany-loan-reference-conflict');return clone(prior);}if(!hasFunds(s,lender,amount))throw new Error('insufficient-cash');coverInfiniteFunds(s,lender,amount,'تغطية تمويل داخلي في وضع اللعب');const lb=book(s,lender),bb=book(s,borrower),la=lb.accounts[0],ba=bb.accounts[0],day=Math.floor(now(s)/86400);la.balance-=amount;ba.balance+=amount;
 const ev={id,reference:id,at:now(s),from:la.id,to:ba.id,fromCompany:lender,toCompany:borrower,amount,note,kind:'intercompany-loan-principal',label:'تمويل بين شركات المجموعة',status:'منفذة',company:lender,beneficiaryCompany:borrower,requestFingerprint};protectDocument(s,ev,'intercompany-loan-principal');insertFinanceTransfer(s,{...ev});ledger(s,lender,ev);companyLedger(s,borrower,ev);journal(s,lender,ev.note,[{account:'قروض وذمم على شركات المجموعة',debit:amount},{account:la.id,credit:amount}],id);journal(s,borrower,ev.note,[{account:ba.id,debit:amount},{account:'قروض وذمم لشركات المجموعة',credit:amount}],id);
 const loan={id,lender,borrower,companyName:companyName(s,borrower),lenderName:companyName(s,lender),originalPrincipal:amount,outstandingPrincipal:amount,annualRate,issuedDay:day,lastAccrualDay:day,dueDay:day+termDays,accruedInterest:0,interestPaid:0,principalPaid:0,status:'قائم',createdAt:now(s),requestFingerprint,principalTransferProofId:ev.documentProofId,principalTransferContentDigest:ev.contentDigest};s.finance.intercompanyLoans.unshift(loan);reconcile(s);return clone(loan);
}
function repayIntercompanyLoan(s,p={}){
 ensure(s);const id=String(p.id||p.loanId||''),loan=s.finance.intercompanyLoans.find(x=>x.id===id);if(!loan)throw new Error('intercompany-loan-not-found');const ref=String(p.reference||`ICLSET-${id}-${s.finance.intercompanyLoanSettlements.length+1}`),requestToken=p.amount==null?'FULL':num(p.amount),requestFingerprint=JSON.stringify([id,requestToken]),prior=s.finance.intercompanyLoanSettlements.find(x=>x.id===ref);if(prior){if(prior.loanId!==id||prior.requestFingerprint&&prior.requestFingerprint!==requestFingerprint||p.amount!=null&&Math.abs(num(prior.requestedAmount)-num(p.amount))>.01)throw new Error('intercompany-loan-settlement-reference-conflict');return clone(prior);}accrueIntercompanyLoan(s,loan);if(loan.status==='مسدد')return clone(loan);const borrower=loan.borrower,lender=loan.lender,bb=book(s,borrower),lb=book(s,lender),ba=bb.accounts[0],la=lb.accounts[0],due=num(loan.outstandingPrincipal)+num(loan.accruedInterest),request=p.amount==null?due:num(p.amount),amount=Math.min(due,request);if(amount<=0)throw new Error('invalid-repayment');if(!hasFunds(s,borrower,amount))throw new Error('insufficient-cash');coverInfiniteFunds(s,borrower,amount,'تغطية سداد تمويل داخلي في وضع اللعب');const interest=Math.min(num(loan.accruedInterest),amount),principal=Math.min(num(loan.outstandingPrincipal),amount-interest);ba.balance-=amount;la.balance+=amount;
 if(principal>0){journal(s,borrower,`سداد أصل ${id}`,[{account:'قروض وذمم لشركات المجموعة',debit:principal},{account:ba.id,credit:principal}],`${ref}-P-B`);journal(s,lender,`تحصيل أصل ${id}`,[{account:la.id,debit:principal},{account:'قروض وذمم على شركات المجموعة',credit:principal}],`${ref}-P-L`);}if(interest>0){const borrowerName=companyName(s,borrower),lenderName=companyName(s,lender);const expense=invoice(s,{kind:'مصروف',amount:interest,note:`فائدة تمويل داخلي ${id}`,method:'تسوية بين شركات المجموعة',taxable:false,status:'مدفوعة',company:borrower,counterparty:lenderName,sourceRef:ref});const income=invoice(s,{kind:'دخل',amount:interest,note:`دخل فائدة تمويل داخلي ${id}`,method:'تسوية بين شركات المجموعة',taxable:false,status:'محصلة',company:lender,counterparty:borrowerName,sourceRef:ref});amendInvoice(s,expense,'invoice-transfer-linked',doc=>{doc.transferReference=ref;});amendInvoice(s,income,'invoice-transfer-linked',doc=>{doc.transferReference=ref;});}
 loan.outstandingPrincipal=Math.max(0,num(loan.outstandingPrincipal)-principal);loan.accruedInterest=Math.max(0,num(loan.accruedInterest)-interest);loan.principalPaid=num(loan.principalPaid)+principal;loan.interestPaid=num(loan.interestPaid)+interest;loan.status=loan.outstandingPrincipal<=.01&&loan.accruedInterest<=.01?'مسدد':(Math.floor(now(s)/86400)>Number(loan.dueDay)?'متأخر':'قائم');const ev={id:ref,reference:ref,at:now(s),from:ba.id,to:la.id,fromCompany:borrower,toCompany:lender,amount,principal,interest,note:`سداد تمويل داخلي ${id}`,kind:'intercompany-loan-settlement',label:'سداد تمويل بين شركات المجموعة',status:'منفذة',company:borrower,beneficiaryCompany:lender,loanId:id,requestedAmount:p.amount==null?due:num(p.amount),requestFingerprint};protectDocument(s,ev,'intercompany-loan-settlement');insertFinanceTransfer(s,{...ev});ledger(s,borrower,ev);companyLedger(s,lender,ev);const settlement={...ev,remainingPrincipal:loan.outstandingPrincipal,remainingInterest:loan.accruedInterest};s.finance.intercompanyLoanSettlements.unshift(settlement);s.finance.intercompanyLoanSettlements=s.finance.intercompanyLoanSettlements.slice(0,240);reconcile(s);return clone(settlement);
}
function intercompanyLoanSnapshot(s){ensure(s);const day=Math.floor(now(s)/86400);return s.finance.intercompanyLoans.map(row=>{const out=clone(row),last=Math.max(0,Number(out.lastAccrualDay??out.issuedDay??day)),elapsed=Math.max(0,day-last);if(elapsed&&num(out.outstandingPrincipal)>0)out.accruedInterest=num(out.accruedInterest)+num(out.outstandingPrincipal)*Math.max(0,Number(out.annualRate)||0)*elapsed/365;if(out.status!=='مسدد'&&day>Number(out.dueDay))out.status='متأخر';return out;});}
function transferReserve(s,p){const toReserve=p.toReserve!==undefined?!!p.toReserve:String(p.direction||'')!=='to-operating',b=book(s,p.company),src=toReserve?b.accounts[0]:b.accounts[1],dst=toReserve?b.accounts[1]:b.accounts[0],a=num(p.amount);if(a<=0)throw new Error('invalid-amount');if(!(s.godMoney&&s.infiniteMoney)&&num(src.balance)<a)throw new Error('insufficient-cash');if(s.godMoney&&s.infiniteMoney&&num(src.balance)<a){const shortfall=a-num(src.balance),reference=`INF-${p.company}-${String((Number(s.finance?.journalSequence)||0)+1).padStart(8,'0')}`;src.balance+=shortfall;journal(s,p.company,'تغطية احتياطي في وضع اللعب',[{account:src.id,debit:shortfall},{account:'حقوق ملكية وضع اللعب',credit:shortfall}],reference);}src.balance-=a;dst.balance+=a;const e={at:now(s),from:src.id,to:dst.id,amount:a,note:toReserve?'تحويل إلى الاحتياطي':'إعادة من الاحتياطي',company:p.company};ledger(s,p.company,e);journal(s,p.company,e.note,[{account:dst.id,debit:a},{account:src.id,credit:a}],p.ref||'');reconcile(s);return {amount:a,toReserve,from:src.id,to:dst.id};}
function spend(s,p){const t=requireCompany(s,p.company),a=num(p.amount),line=p.line||lineFor(p.note,p.method);if(!canSpend(s,t,a,line))throw new Error('insufficient-funds-or-budget');const b=book(s,t);coverInfiniteFunds(s,t,a,'تغطية مصروف في وضع اللعب');b.accounts[0].balance-=a;consumeBudget(s,t,a,line);const doc=invoice(s,{kind:'مصروف',amount:a,note:p.note,method:p.method||'تحويل بنكي',taxable:p.taxable!==false,status:p.status||'مدفوعة',company:t,counterparty:p.counterparty||''});if((p.status||'مدفوعة')==='مدفوعة'){const e={at:now(s),from:b.accounts[0].id,to:doc.counterparty,toPartyId:doc.counterpartyPartyId||null,amount:a,note:p.note,company:t,kind:'cash-document',documentNumber:doc.number,reference:doc.number,status:'منفذة'};ledger(s,t,e);recordWorldFinance(s,{partyId:doc.counterpartyPartyId,counterparty:doc.counterparty,company:t,direction:'outgoing',amount:a,reference:doc.number,transferRef:doc.number,documentNumber:doc.number,note:p.note,settled:true});}reconcile(s);return doc;}
function payPayroll(s,p={}){
  const t=requireCompany(s,p.company),a=num(p.amount),b=book(s,t),reportId=String(p.reportId||''),transferId=String(p.reference||`PAYTR-${reportId||Math.floor(now(s)/86400)}-${t}`),prior=findTransferByIdOrReference(s,transferId);
  if(prior){if(prior.company!==t||Math.abs(num(prior.amount)-a)>.01||String(prior.payrollReportId||'')!==reportId)throw new Error('payroll-reference-conflict');const priorDoc=findFinanceDocument(s,'invoices',row=>row.number===prior.documentNumber);return priorDoc||{number:prior.documentNumber||transferId,company:t,amount:prior.amount,transferReference:transferId,idempotent:true};}
  if(a<=0)throw new Error('invalid-payroll-amount');if(!hasFunds(s,t,a))throw new Error('insufficient-payroll-cash');
  coverInfiniteFunds(s,t,a,'تغطية رواتب في وضع اللعب');b.accounts[0].balance-=a;consumeBudget(s,t,a,'payroll');
  const doc=invoice(s,{kind:'مصروف',amount:a,note:p.note||`مسير رواتب ${companyName(s,t)}`,method:'تحويل رواتب',taxable:false,status:'مدفوعة',company:t,counterparty:'حسابات الموظفين'});
  amendInvoice(s,doc,'invoice-payroll-classified',row=>{row.payrollReportId=reportId||null;row.budgetLine='payroll';row.transferReference=transferId;});
  const transfer={id:transferId,reference:transferId,at:now(s),from:b.accounts[0].id,to:'حسابات الموظفين',amount:a,note:doc.note,company:t,kind:'payroll-transfer',label:'حوالة مسير رواتب',status:'منفذة',documentNumber:doc.number,payrollReportId:doc.payrollReportId};protectDocument(s,transfer,'payroll-transfer');insertFinanceTransfer(s,{...transfer});ledger(s,t,transfer);reconcile(s);return doc;
}
function accruePayroll(s,p={}){
  const t=requireCompany(s,p.company),a=num(p.amount),number=String(p.number||`PAY-${t.toUpperCase()}-${Math.floor(now(s)/86400)}`),reportId=p.reportId||null;
  if(a<=0)throw new Error('invalid-payroll-amount');const existing=findFinanceDocument(s,'invoices',row=>row.number===number);if(existing){if(existing.company!==t||Math.abs(num(existing.total??existing.amount)-a)>.01||String(existing.payrollReportId||'')!==String(reportId||''))throw new Error('payroll-accrual-reference-conflict');return existing;}
  const doc=invoice(s,{kind:'مصروف',amount:a,note:p.note||`رواتب مستحقة · ${companyName(s,t)}`,method:'تحويل رواتب',taxable:false,status:'مستحقة',company:t,counterparty:'حسابات الموظفين',number,dueDay:p.dueDay??Math.floor(now(s)/86400)});
  amendInvoice(s,doc,'invoice-payroll-classified',row=>{row.budgetLine='payroll';row.payrollShortfall=true;row.payrollReportId=reportId;});
  const payable=s.finance.payables.find(row=>row.number===number);
  const transferId=`PAYTR-${reportId||number}-${t}-DUE`,transfer={id:transferId,reference:transferId,at:now(s),from:book(s,t).accounts[0].id,to:'حسابات الموظفين',amount:a,note:doc.note,company:t,kind:'payroll-payable',label:'حوالة رواتب مستحقة',status:'مستحقة',documentNumber:number,payrollReportId:reportId};if(!Boolean(findTransferById(s,transferId))){protectDocument(s,transfer,'payroll-payable');insertFinanceTransfer(s,{...transfer});}amendInvoice(s,doc,'invoice-transfer-linked',row=>{row.transferReference=transferId;});ledger(s,t,transfer,{from:'ذمم رواتب مستحقة',kind:'payroll-accrual'});return doc;
}
function recordPayrollReport(s,p={}){const report=clone(p.report||{}),id=String(report.id||'');if(!id||!Array.isArray(report.lines))throw new Error('invalid-payroll-report');const fingerprint=JSON.stringify(report),existing=s.finance.payrollReports.find(row=>row.id===id);if(existing){if(existing.requestFingerprint&&existing.requestFingerprint!==fingerprint)throw new Error('payroll-report-reference-conflict');return existing;}report.at=Number.isFinite(Number(report.at))?Number(report.at):now(s);report.total=report.lines.reduce((sum,line)=>sum+num(line.amount),0);report.paid=report.lines.reduce((sum,line)=>sum+num(line.paid),0);report.due=Math.max(0,report.total-report.paid);report.status=report.due>0?'مسجل مع رواتب مستحقة':'مصروف بالكامل';report.requestFingerprint=fingerprint;protectDocument(s,report,'payroll-report');s.finance.payrollReports.unshift(report);s.finance.payrollReports=s.finance.payrollReports.slice(0,120);return report;}
function accrue(s,p){const t=requireCompany(s,p.company),a=num(p.amount),line=p.line||lineFor(p.note,p.method||'قيد مستحق');const budgetReservation=reserveAccruedObligationBudget(s,t,a,line);if(!budgetReservation)throw new Error('insufficient-budget');const doc=invoice(s,{kind:'مصروف',amount:a,note:p.note,method:p.method||'قيد مستحق',taxable:p.taxable!==false,status:'مستحقة',company:t,counterparty:p.counterparty||'',dueDay:p.dueDay,number:p.number});amendInvoice(s,doc,'invoice-accrual-classified',row=>{row.budgetLine=line;row.budgetReserved=budgetReservation.reserved;row.budgetUnbudgetedAmount=budgetReservation.unbudgeted;row.budgetObligation=true;});ledger(s,t,{at:now(s),from:'ذمم دائنة',to:doc.counterparty,amount:a,note:p.note,company:t,kind:'accrual-document',documentNumber:doc.number});return doc;}
function credit(s,p){
 const t=requireCompany(s,p.company),a=Number(p.amount),profile=collectionProfile(t,s);if(!Number.isFinite(a)||a<=0)throw new Error('invalid-revenue-collection');
 if(p.sourceRefs!==undefined&&!Array.isArray(p.sourceRefs))throw new Error('invalid-collection-source-refs');
 const reference=String(p.reference||p.ref||`RCPT-${t}-${s.finance.invoiceSequence}`),prior=findTransferByReference(s,reference);
 if(prior){if(prior.company!==t||Math.abs(prior.amount-a)>.01)throw new Error('collection-reference-conflict');return financeRowByNumber(s,'invoices',prior.invoiceNumbers?.[0])||{transferReference:reference,idempotent:true};}
 const day=Number(p.periodDay),hasDay=p.periodDay!==undefined&&Number.isSafeInteger(day)&&day>=0,cursors=s.finance.revenueCollectionDays||{};if(p.periodDay!==undefined&&!hasDay)throw new Error('invalid-collection-period');
 if(hasDay&&Number.isFinite(cursors[t])&&day<=cursors[t])return {transferReference:reference,idempotent:true};
 const doc=invoice(s,{kind:'دخل',amount:a,note:p.note||profile.service,method:profile.channel,taxable:p.taxable!==false,status:'مستحقة',company:t,counterparty:p.counterparty||profile.source,sourceRef:reference});
 collectReceivable(s,{number:doc.number,company:t,reference,channel:profile.channel,sourceRefs:p.sourceRefs||[]});
 if(hasDay){s.finance.revenueCollectionDays={...cursors,[t]:day};}return doc;
}
function collectReceivable(s,p){
 if(p.sourceRefs!==undefined&&!Array.isArray(p.sourceRefs))throw new Error('invalid-collection-source-refs');
 const n=String(p.number||''),item=financeRowByNumber(s,'receivables',n),inv=financeRowByNumber(s,'invoices',n);
 if(!item){if(inv?.status==='محصلة'&&inv.transferReference){if(p.company&&p.company!==inv.company)throw new Error('collection-company-mismatch');return {company:inv.company,amount:0,reference:inv.transferReference,idempotent:true};}throw new Error('receivable-not-found');}
 const t=requireCompany(s,item.company),a=Number(item.total??item.amount),b=book(s,t),reference=String(p.reference||`RCPT-${t}-${n}`);
 if(!inv||inv.kind!=='دخل'||inv.company!==t||(p.company&&p.company!==t)||!Number.isFinite(a)||a<=0||Math.abs(Number(inv.total)-a)>.01)throw new Error('invalid-receivable-collection');
 if(findTransferByReference(s,reference))throw new Error('collection-reference-conflict');
 const balanceBefore=num(b.accounts[0].balance);b.accounts[0].balance+=a;const balanceAfter=num(b.accounts[0].balance);amendInvoice(s,inv,'invoice-collected',doc=>{doc.status='محصلة';doc.settledAt=now(s);doc.transferReference=reference;});removeReceivableByNumber(s,n);
 journal(s,t,`تحصيل ${n} · ${collectionProfile(t,s).channel}`,[{account:b.accounts[0].id,debit:a},{account:'ذمم مدينة',credit:a}],reference);
 recordCollection(s,{company:t,amount:a,reference,invoiceNumbers:[n],counterparty:inv.counterparty,channel:p.channel,sourceRefs:p.sourceRefs||[],purposeCategory:'تحصيل فاتورة/إيراد',purposeDetail:inv.note||collectionProfile(t,s).service,accountBalanceBefore:balanceBefore,accountBalanceAfter:balanceAfter});reconcile(s);return {company:t,amount:a,reference,idempotent:false,balanceBefore,balanceAfter};
}
function settlePayable(s,p){
  const n=String(p.number||''),item=s.finance.payables.find(x=>x.number===n);if(!item)throw new Error('payable-not-found');
  const t=requireCompany(s,item.company),a=num(item.total??item.amount),inv=findFinanceDocument(s,'invoices',x=>x.number===n),line=inv?.budgetLine||item.budgetLine||lineFor(inv?.note||item.note||'',inv?.method||item.method||''),reserved=num(inv?.budgetReserved),budgetObligation=inv?.budgetObligation===true,payroll=inv?.payrollShortfall===true||item.payrollShortfall===true,linkedReport=s.finance.payrollReports.find(row=>row.id===(inv?.payrollReportId||item.payrollReportId)||row.lines?.some(reportLine=>reportLine.dueRef===n)),reportId=linkedReport?.id||null,b=book(s,t),method=String(p.method||'transfer');
  if(method==='cheque'){
    if(payroll)throw new Error('payroll-cheque-not-supported');
    const beneficiary=formalCounterparty(s,t,'مصروف',inv?.counterparty||item.counterparty),cheque=issueCheque(s,{company:t,amount:a,beneficiary,invoiceNumber:n,note:inv?.note||item.note||`سداد ${n}`,dueDay:p.dueDay??item.dueDay,requestRef:p.requestRef||`PAYABLE-CHQ-${n}`,draweeBank:p.draweeBank,issuePlace:p.issuePlace,paymentPlace:p.paymentPlace,authorizedSignatory:p.authorizedSignatory});
    return {company:t,amount:a,method:'cheque',status:'issued',chequeId:cheque.id,reference:cheque.id,idempotent:cheque.idempotent===true};
  }
  if(method!=='transfer')throw new Error('invalid-payable-settlement-method');
  if(!hasFunds(s,t,a))throw new Error('insufficient-cash');if(!payroll&&!reserved&&!budgetObligation&&!canSpend(s,t,a,line))throw new Error('insufficient-budget');
  coverInfiniteFunds(s,t,a,'تغطية ذمم مستحقة في وضع اللعب');const balanceBefore=num(b.accounts[0].balance);b.accounts[0].balance-=a;const balanceAfter=num(b.accounts[0].balance),budgetedAmount=Math.min(a,reserved);if(budgetedAmount>0)consumeReserved(s,t,budgetedAmount,line);if(!budgetObligation&&a>budgetedAmount)consumeBudget(s,t,a-budgetedAmount,line);
  if(inv)amendInvoice(s,inv,'invoice-payable-settled',doc=>{doc.status='مسددة';doc.settledAt=now(s);doc.budgetReserved=0;doc.paymentMethod='تحويل بنكي';});s.finance.payables=s.finance.payables.filter(x=>x.number!==n);
  if(payroll&&linkedReport){const reportLine=linkedReport.lines?.find(row=>row.dueRef===n||(row.company===t&&num(row.due)>0));if(reportLine)amendProtectedDocument(s,linkedReport,'payroll-report','payroll-report-settled',report=>{const line=report.lines?.find(row=>row.dueRef===n||(row.company===t&&num(row.due)>0));line.paid=num(line.paid)+a;line.due=Math.max(0,num(line.amount)-num(line.paid));line.settledAt=now(s);report.paid=report.lines.reduce((sum,row)=>sum+num(row.paid),0);report.total=report.lines.reduce((sum,row)=>sum+num(row.amount),0);report.due=Math.max(0,report.total-report.paid);report.status=report.due>0?'مسجل مع رواتب مستحقة':'مصروف بالكامل';if(report.due===0)report.settledAt=now(s);});}
  const beneficiary=formalCounterparty(s,t,payroll?'مصروف':'مصروف',inv?.counterparty||item.counterparty),payee=partyMeta(s,beneficiary,payroll?'employee':'supplier'),purpose=inv?.note||item.note||`سداد ${n}`,note=`${payroll?'صرف رواتب مستحقة':'سداد'} ${n} · ${purpose}`;journal(s,t,note,[{account:'ذمم دائنة',debit:a},{account:b.accounts[0].id,credit:a}],n);let reference='';
  if(payroll){const formal=findPayrollTransferByDocument(s,n);reference=formal?.reference||`PAYTR-${reportId||n}-${t}-DUE`;if(formal){amendProtectedDocument(s,formal,formal.documentType||'payroll-payable','payroll-transfer-settled',row=>{row.kind='payroll-transfer';row.label='حوالة رواتب مستحقة منفذة';row.status='منفذة';row.from=b.accounts[0].id;row.settledAt=now(s);});}else{const payrollTransfer={id:reference,reference,at:now(s),from:b.accounts[0].id,to:payee.name||beneficiary,toPartyId:payee.id,amount:a,note,company:t,kind:'payroll-transfer',label:'حوالة رواتب مستحقة منفذة',status:'منفذة',documentNumber:n,payrollReportId:reportId};protectDocument(s,payrollTransfer,'payroll-transfer');insertFinanceTransfer(s,payrollTransfer);}}
  const transferRef=reference||`PAY-${n}`,entry={id:transferRef,at:now(s),from:b.accounts[0].id,to:payee.name||beneficiary,toPartyId:payee.id,amount:a,note,purposeCategory:payroll?'رواتب':'سداد ذمة مورد',purposeDetail:purpose,paymentMethod:'تحويل بنكي',label:payroll?'حوالة رواتب مستحقة منفذة':'حوالة سداد ذمة',company:t,kind:payroll?'payroll-transfer':'payable-settlement',documentNumber:n,payrollReportId:reportId,reference:transferRef,status:'منفذة',accountBalanceBefore:balanceBefore,accountBalanceAfter:balanceAfter};
  if(!payroll){protectDocument(s,entry,'payable-settlement');insertFinanceTransfer(s,{...entry});}ledger(s,t,entry);if(!payroll)recordWorldFinance(s,{partyId:payee.id,counterparty:entry.to,company:t,direction:'outgoing',amount:a,reference:transferRef,transferRef,documentNumber:n,note,settled:true});reconcile(s);return {company:t,amount:a,payroll,reportId,method:'transfer',reference:transferRef,balanceBefore,balanceAfter};
}
function payTaxes(s,p){
 const t=requireCompany(s,p.company),periods=s.finance.periods.filter(x=>requireCompany(s,x.company)===t&&x.status==='مستحق'),a=periods.reduce((n,x)=>n+num(x.amount),0),b=book(s,t);if(a<=0)return {company:t,amount:0,count:0};if(!hasFunds(s,t,a))throw new Error('insufficient-cash');
 coverInfiniteFunds(s,t,a,'تغطية ضريبة في وضع اللعب');const account=b.accounts[0],balanceBefore=num(account.balance),sequence=s.finance.taxSettlementSequence++,settlementId=`TAX-SET-${t==='group'?'GH':t.toUpperCase()}-${String(sequence).padStart(6,'0')}`,paymentReference=`VAT-PAY-${t}-${Math.floor(now(s)/86400)}-${String(sequence).padStart(4,'0')}`;account.balance-=a;const balanceAfter=num(account.balance),entry=journal(s,t,'سداد فترات ضريبة القيمة المضافة المستحقة',[{account:'ضريبة VAT مستحقة',debit:a},{account:account.id,credit:a}],paymentReference);
 const taxAuthority=String(p.taxAuthority||'هيئة الزكاة والضريبة والجمارك'),transfer={id:paymentReference,reference:paymentReference,at:now(s),from:account.id,to:taxAuthority,amount:a,note:'سداد ضريبة القيمة المضافة المستحقة · تحويل حكومي',purposeCategory:'سداد ضريبة القيمة المضافة',purposeDetail:`تسوية ${periods.map(x=>x.period).join(' · ')}`,paymentMethod:'تحويل حكومي',kind:'tax-settlement',label:'حوالة سداد ضريبة',company:t,documentNumber:settlementId,status:'منفذة',accountBalanceBefore:balanceBefore,accountBalanceAfter:balanceAfter};protectDocument(s,transfer,'tax-payment-transfer');ledger(s,t,transfer);insertFinanceTransfer(s,{...transfer});
 const registry=t==='group'?s.profile:(s.companyRegistry?.[t]||{}),settlement={id:settlementId,settlementNumber:settlementId,company:t,companyName:companyName(s,t),taxAuthority,taxNumber:String(registry?.taxId||registry?.taxNumber||'غير مسجل'),taxType:'ضريبة القيمة المضافة (VAT)',periodIds:periods.map(x=>x.id),periods:periods.map(x=>x.period),originalAmount:a,adjustments:0,amountPaid:a,remaining:0,accountId:account.id,accountBalanceBefore:balanceBefore,accountBalanceAfter:balanceAfter,paidAt:now(s),paymentReference,journalEntryId:entry.id,status:'مسددة بالكامل'};protectDocument(s,settlement,'tax-settlement');s.finance.taxSettlements.unshift(settlement);s.finance.taxSettlements=s.finance.taxSettlements.slice(0,400);
 b.taxPaid+=a;periods.forEach(period=>amendProtectedDocument(s,period,'vat-assessment','vat-assessment-paid',row=>{row.status='مسدد';row.paidAt=now(s);row.settlementId=settlementId;row.paymentReference=paymentReference;row.journalEntryId=entry.id;}));refreshBookTaxPayable(s,t);reconcile(s);return {company:t,amount:a,count:periods.length,settlementId,paymentReference,journalEntryId:entry.id,settlement};
}
function issueCheque(s,p){
  const t=requireCompany(s,p.company),a=num(p.amount),invoiceNumber=String(p.invoiceNumber||''),linked=invoiceNumber?findFinanceDocument(s,'invoices',x=>x.number===invoiceNumber):null,payable=invoiceNumber?s.finance.payables.find(x=>x.number===invoiceNumber):null,requestRef=String(p.requestRef||'');
  if(invoiceNumber){if(!linked||!payable)throw new Error('cheque-linked-payable-not-found');if(requireCompany(s,linked.company)!==t||requireCompany(s,payable.company)!==t)throw new Error('cheque-linked-company-mismatch');if(linked.kind!=='مصروف'||['مدفوعة','مسددة','محصلة'].includes(linked.status))throw new Error('cheque-linked-invoice-not-payable');if(Math.abs(num(linked.total??linked.amount)-a)>.01||Math.abs(num(payable.total??payable.amount)-a)>.01)throw new Error('cheque-linked-amount-mismatch');const beneficiary=String(p.beneficiary||'').trim(),counterparty=String(linked.counterparty||payable.counterparty||'').trim();if(beneficiary&&counterparty&&beneficiary!==counterparty)throw new Error('cheque-linked-beneficiary-mismatch');const existing=findFinanceDocument(s,'cheques',row=>row.invoiceNumber===invoiceNumber&&row.status==='صادر');if(existing)return {...existing,idempotent:true};}
  if(requestRef){const prior=findFinanceDocument(s,'cheques',row=>row.requestRef===requestRef&&!['مرتجع','ملغى'].includes(row.status));if(prior){if(prior.company!==t||Math.abs(num(prior.amount)-a)>.01||String(prior.invoiceNumber||'')!==invoiceNumber||String(prior.beneficiary)!==String(p.beneficiary||linked?.counterparty||''))throw new Error('cheque-request-conflict');return {...prior,idempotent:true};}}
  if(a<=0)throw new Error('invalid-cheque-amount');const beneficiary=formalCounterparty(s,t,'مصروف',String(p.beneficiary||linked?.counterparty||payable?.counterparty||'').trim());if(!beneficiary)throw new Error('cheque-beneficiary-required');
  const payee=partyMeta(s,beneficiary,'supplier'),id=`${String(documentProfile(s,t).documentPrefix||t).toUpperCase()}-CHQ-${String(s.finance.paymentSequence++).padStart(6,'0')}`,issuer=companyName(s,t),dueDay=Math.max(Math.floor(now(s)/86400),Math.floor(Number(p.dueDay) || linked?.dueDay || payable?.dueDay || Math.floor(now(s)/86400))),purpose=String(p.note||linked?.note||payable?.note||'سداد التزام تجاري');
  const r={id,chequeNumber:id,company:t,companyName:issuer,drawer:issuer,draweeBank:String(p.draweeBank||'Global Holdings Treasury Bank'),accountId:book(s,t).accounts[0].id,currency:String(p.currency||'USD'),amount:a,note:purpose,purposeCategory:invoiceNumber?'سداد ذمة بالشيك':'دفعة تجارية بالشيك',purposeDetail:purpose,paymentMethod:'شيك مصرفي',beneficiary:payee.name||beneficiary,beneficiaryPartyId:payee.id,issuePlace:String(p.issuePlace||s.profile?.hq||'الرياض، المملكة العربية السعودية'),paymentPlace:String(p.paymentPlace||'المركز المالي الرئيسي'),authorizedSignatory:String(p.authorizedSignatory||s.profile?.founder||'المفوض بالتوقيع'),dueDay,status:'صادر',issuedAt:now(s),invoiceNumber,requestRef:requestRef||null,type:p.type||'شيك مصرفي'};
  for(const old of s.finance.cheques)if(old.status==='مرتجع'&&(invoiceNumber&&old.invoiceNumber===invoiceNumber||requestRef&&old.requestRef===requestRef))amendProtectedDocument(s,old,'cheque','cheque-cancelled',row=>{row.status='ملغى';row.replacedBy=id;row.cancelledAt=now(s);row.cancelReason='إعادة إصدار الشيك المرتجع';});
  protectDocument(s,r,'cheque');s.finance.cheques.unshift(r);if(linked)amendInvoice(s,linked,'invoice-cheque-issued',row=>{row.chequeId=id;row.paymentMethod='شيك مصرفي';row.status='شيك صادر';});return r;
}
function chequeResult(c,settled,reason){return {id:c.id,settled,status:settled?'settled':'bounced',reason,company:c.company,amount:c.amount,invoiceNumber:c.invoiceNumber||null,requestRef:c.requestRef||null};}
function settleCheque(s,p){
 const c=findFinanceDocument(s,'cheques',x=>x.id===p.id);if(!c)throw new Error('cheque-not-found');if(c.status==='ملغى')throw new Error('cheque-cancelled');if(c.status==='مصروف')return chequeResult(c,true,'already-settled');
 const t=requireCompany(s,c.company),a=num(c.amount),inv=c.invoiceNumber?findFinanceDocument(s,'invoices',x=>x.number===c.invoiceNumber):null,payable=c.invoiceNumber?s.finance.payables.find(x=>x.number===c.invoiceNumber):null;
 if(c.invoiceNumber){if(!inv||!payable)throw new Error('cheque-linked-payable-not-found');if(requireCompany(s,inv.company)!==t||requireCompany(s,payable.company)!==t)throw new Error('cheque-linked-company-mismatch');if(inv.kind!=='مصروف'||['مدفوعة','مسددة','محصلة'].includes(inv.status))throw new Error('cheque-linked-invoice-not-payable');if(Math.abs(num(inv.total??inv.amount)-a)>.01||Math.abs(num(payable.total??payable.amount)-a)>.01)throw new Error('cheque-linked-amount-mismatch');const counterparty=String(inv.counterparty||payable.counterparty||'').trim();if(counterparty&&String(c.beneficiary||'').trim()!==counterparty)throw new Error('cheque-linked-beneficiary-mismatch');}
 const line=p.line||inv?.budgetLine||lineFor(c.note,'شيك'),reserved=num(inv?.budgetReserved),budgetObligation=inv?.budgetObligation===true,b=book(s,t);
 if(!hasFunds(s,t,a)||(!reserved&&!budgetObligation&&!canSpend(s,t,a,line))){amendProtectedDocument(s,c,'cheque','cheque-returned',row=>{row.status='مرتجع';row.returnedAt=now(s);});if(inv)amendInvoice(s,inv,'invoice-cheque-returned',row=>{row.status='شيك مرتجع';});return chequeResult(c,false,'insufficient-funds-or-budget');}
 coverInfiniteFunds(s,t,a,'تغطية شيك في وضع اللعب');b.accounts[0].balance-=a;const budgetedAmount=Math.min(a,reserved);if(budgetedAmount>0)consumeReserved(s,t,budgetedAmount,line);if(!budgetObligation&&a>budgetedAmount)consumeBudget(s,t,a-budgetedAmount,line);amendProtectedDocument(s,c,'cheque','cheque-cleared',row=>{row.status='مصروف';row.clearedAt=now(s);});
 if(payable){if(inv)amendInvoice(s,inv,'invoice-cheque-cleared',row=>{row.status='مسددة';row.settledAt=now(s);row.budgetReserved=0;});s.finance.payables=s.finance.payables.filter(x=>x.number!==c.invoiceNumber);journal(s,t,`صرف ${c.id} · تسوية ${c.invoiceNumber}`,[{account:'ذمم دائنة',debit:a},{account:b.accounts[0].id,credit:a}],c.id);}else journal(s,t,`صرف ${c.id} · ${c.note}`,[{account:'مصروف تشغيلي',debit:a},{account:b.accounts[0].id,credit:a}],c.id);
 const payee=inv?.counterpartyPartyId?{id:inv.counterpartyPartyId,name:inv.counterparty}:partyMeta(s,c.beneficiary,'supplier'),entry={at:now(s),from:b.accounts[0].id,to:payee.name||c.beneficiary,toPartyId:payee.id||c.beneficiaryPartyId||null,amount:a,note:c.note||`صرف ${c.id}`,purposeCategory:c.purposeCategory||'سداد بالشيك',purposeDetail:c.purposeDetail||c.note||'سداد التزام',paymentMethod:'شيك مصرفي',chequeNumber:c.id,label:'تسوية شيك مصرفي',company:t,kind:'cheque-settlement',documentNumber:c.invoiceNumber||null,reference:c.id,status:'منفذة'};ledger(s,t,entry);recordWorldFinance(s,{partyId:entry.toPartyId,counterparty:entry.to,company:t,direction:'outgoing',amount:a,reference:c.id,transferRef:c.id,documentNumber:c.invoiceNumber||null,note:c.note||entry.note,settled:true});reconcile(s);return chequeResult(c,true,'settled');
}
function payByCheque(s,p={}){
  const t=requireCompany(s,p.company),a=num(p.amount),beneficiary=String(p.beneficiary||p.counterparty||'').trim(),line=p.line||lineFor(p.note,'شيك مصرفي');
  if(a<=0)throw new Error('invalid-cheque-amount');if(!beneficiary)throw new Error('cheque-beneficiary-required');
  // Resolve retries before accruing an invoice. A key can never fund a different purchase.
  const requestRef=String(p.requestRef||''),fingerprint=JSON.stringify([t,a,beneficiary,String(p.note||'شراء من مورد'),p.taxable!==false,line,String(p.number||'')]);
  const prior=requestRef?findFinanceDocument(s,'cheques',row=>row.requestRef===requestRef):null;
  let doc;
  if(prior){
    doc=findFinanceDocument(s,'invoices',row=>row.number===prior.invoiceNumber);
    if(!doc||prior.company!==t||Math.abs(num(prior.amount)-a)>.01||prior.beneficiary!==beneficiary||prior.paymentFingerprint&&prior.paymentFingerprint!==fingerprint||String(doc.note)!==String(p.note||'شراء من مورد')||p.number&&doc.number!==p.number)throw new Error('cheque-request-conflict');
    if(prior.status==='مصروف'){if(doc.status!=='مسددة')throw new Error('cheque-payment-inconsistent');return {reference:prior.id,invoice:doc,cheque:prior,settlement:chequeResult(prior,true,'already-settled'),idempotent:true};}
  }else doc=accrue(s,{company:t,amount:a,note:p.note||'شراء من مورد',method:'شيك مصرفي',taxable:p.taxable!==false,counterparty:beneficiary,dueDay:p.dueDay??Math.floor(now(s)/86400),number:p.number,line});
  const cheque=issueCheque(s,{company:t,amount:a,note:p.note||'شراء من مورد',beneficiary,invoiceNumber:doc.number,requestRef:p.requestRef||null,type:p.type||'شيك مصرفي',line,draweeBank:p.draweeBank,issuePlace:p.issuePlace,paymentPlace:p.paymentPlace,authorizedSignatory:p.authorizedSignatory,dueDay:p.dueDay});
  amendProtectedDocument(s,cheque,'cheque','cheque-request-linked',row=>{row.paymentFingerprint=fingerprint;});
  const settlement=settleCheque(s,{id:cheque.id,line});if(!settlement.settled)throw new Error(`cheque-settlement-failed:${settlement.reason}`);
  return {reference:cheque.id,invoice:doc,cheque,settlement};
}
function founderInvestment(s,p){const t=requireCompany(s,p.company),a=num(p.amount);if(a<=0)throw new Error('invalid-amount');const b=book(s,t),founder=s.profile?.founder||'المؤسس',id=p.ref||nextFinanceTransferReference(s,'FND'),prior=findTransferById(s,id)||s.treasury.ledger.find(x=>x.reference===id);if(prior){if(prior.company!==t||Math.abs(num(prior.amount)-a)>.01)throw new Error('founder-investment-reference-conflict');return {ref:id,amount:0,company:t,idempotent:true};}b.accounts[0].balance+=a;const transfer={id,reference:id,at:now(s),kind:'founder-investment',label:'حوالة استثمار واردة',from:`المستثمر · ${founder}`,to:companyName(s,t),toAccount:b.accounts[0].id,amount:a,company:t,beneficiaryCompany:t,status:'منفذة',note:p.note||'استثمار المؤسس'};protectDocument(s,transfer,'founder-investment');insertFinanceTransfer(s,{...transfer});ledger(s,t,transfer);journal(s,t,`${id} · استثمار المؤسس`,[{account:b.accounts[0].id,debit:a},{account:'حقوق ملكية المؤسس',credit:a}],id);reconcile(s);return {ref:id,amount:a,company:t,documentProofId:transfer.documentProofId,contentDigest:transfer.contentDigest};}
function founderWithdrawal(s,p){const t=requireCompany(s,p.company),requested=num(p.amount),b=book(s,t);if(requested<=0||operating(s,t)<requested)throw new Error('insufficient-cash');const a=requested,founder=s.profile?.founder||'المؤسس',id=p.ref||nextFinanceTransferReference(s,'FND-WD'),prior=findTransferById(s,id)||s.treasury.ledger.find(x=>x.reference===id);if(prior){if(prior.company!==t||Math.abs(num(prior.amount)-a)>.01)throw new Error('founder-withdrawal-reference-conflict');return {ref:id,amount:0,company:t,idempotent:true};}b.accounts[0].balance-=a;const transfer={id,reference:id,at:now(s),kind:'founder-withdrawal',label:'سحب رأس مال للمؤسس',from:companyName(s,t),fromAccount:b.accounts[0].id,to:`المستثمر · ${founder}`,amount:a,company:t,status:'منفذة',note:p.note||'تسوية رأسمالية'};protectDocument(s,transfer,'founder-withdrawal');insertFinanceTransfer(s,{...transfer});ledger(s,t,transfer);journal(s,t,`${id} · سحب رأسمالي للمؤسس`,[{account:'حقوق ملكية المؤسس',debit:a},{account:b.accounts[0].id,credit:a}],id);reconcile(s);return {ref:id,amount:a,company:t,documentProofId:transfer.documentProofId,contentDigest:transfer.contentDigest};}

function refreshIdentity(s,p){const t=requireCompany(s,p.company),name=companyName(s,t);for(const bucket of [s.finance?.invoices,s.finance?.cheques,s.finance?.payables,s.finance?.receivables,s.finance?.periods])for(const doc of (bucket||[])){if(requireCompany(s,doc.company)===t&&!doc.contentDigest){doc.company=t;doc.companyName=name;delete doc.logo;delete doc.companyLogo;delete doc.issuerLogo;}}for(const entry of (s.treasury?.ledger||[])){if(entry.company===t&&!entry.contentDigest)entry.companyName=name;if(entry.beneficiaryCompany===t&&!entry.contentDigest)entry.beneficiaryName=name;}return name;}
function raiseDebt(s,p){const t=requireCompany(s,p.company),a=num(p.amount);if(a<=0)throw new Error('invalid-amount');const b=book(s,t),id=String(p.ref||`DEBT-${Math.floor(now(s))}-${b.ledger.length+1}`),lender=formalCounterparty(s,t,'مصروف',p.lender||`بنك التمويل المؤسسي — ${companyName(s,t)}`),liabilityAccount=String(p.liabilityAccount||'تسهيلات ائتمانية مستحقة'),issuedAt=now(s),termDays=Math.max(0,Math.floor(Number(p.termDays)||0)),dueDay=termDays?Math.floor(issuedAt/86400)+termDays:null,prior=s.finance.debtRecords.find(x=>x.id===id);if(prior){if(prior.company!==t||Math.abs(num(prior.originalAmount)-a)>.01||prior.lender!==lender||prior.liabilityAccount!==liabilityAccount)throw new Error('debt-reference-conflict');return {ref:id,amount:0,debt:b.debt,idempotent:true,record:clone(prior)};}b.accounts[0].balance+=a;b.debt=num(b.debt)+a;const j=journal(s,t,p.note||'تمويل دين',[{account:b.accounts[0].id,debit:a},{account:liabilityAccount,credit:a}],id),record={id,company:t,companyName:companyName(s,t),lender,type:liabilityAccount,liabilityAccount,originalAmount:a,outstanding:a,issuedAt,dueDay,status:'قائم',journalEntryId:j.id,note:String(p.note||'تمويل دين')};protectDocument(s,record,'debt-financing');s.finance.debtRecords.unshift(record);ledger(s,t,{id,at:issuedAt,from:lender,to:b.accounts[0].id,amount:a,note:record.note,purposeCategory:'تمويل دين',purposeDetail:liabilityAccount,paymentMethod:'تحويل تمويل',company:t,kind:'debt-financing',reference:id,status:'منفذة'});reconcile(s);return {ref:id,amount:a,debt:b.debt,record};}
function repayDebt(s,p){
 const t=requireCompany(s,p.company),b=book(s,t),debtId=String(p.debtId||''),requested=num(p.amount),explicitReference=String(p.ref||''),requestFingerprint=JSON.stringify([t,requested,debtId,String(p.liabilityAccount||''),String(p.lender||''),String(p.note||'سداد أصل دين')]);
 if(explicitReference){const prior=s.finance.debtSettlements.find(row=>row.id===explicitReference||row.reference===explicitReference);if(prior){if(prior.requestFingerprint&&prior.requestFingerprint!==requestFingerprint||prior.company!==t||prior.debtId!==(debtId||null)||Math.abs(num(prior.requestedAmount??prior.amount)-requested)>.01)throw new Error('debt-repayment-reference-conflict');return {amount:0,debt:num(b.debt),debtId:debtId||null,reference:explicitReference,settlement:clone(prior),idempotent:true};}}
 const allOpen=(s.finance.debtRecords||[]).filter(x=>x.company===t&&num(x.outstanding)>0).sort((x,y)=>(Number(x.issuedAt)||0)-(Number(y.issuedAt)||0)),open=debtId?allOpen.filter(x=>x.id===debtId):allOpen,targetOutstanding=debtId?num(open[0]?.outstanding):num(b.debt),a=Math.min(requested,targetOutstanding,num(b.debt));if(a<=0)return {amount:0,debt:num(b.debt),debtId:debtId||null};if(operating(s,t)<a)throw new Error('insufficient-cash');const sequence=s.finance.debtSettlementSequence++,reference=explicitReference||`DEBT-SET-${t==='group'?'GH':t.toUpperCase()}-${String(sequence).padStart(6,'0')}`,account=b.accounts[0],balanceBefore=num(account.balance);account.balance-=a;b.debt=Math.max(0,num(b.debt)-a);let remaining=a;const allocations=[];for(const record of open){if(remaining<=.005)break;const paid=Math.min(remaining,num(record.outstanding));if(paid<=0)continue;amendProtectedDocument(s,record,record.documentType||'debt-financing','debt-repayment-applied',row=>{row.outstanding=Math.max(0,num(row.outstanding)-paid);row.status=row.outstanding<=.005?'مسدد':'مسدد جزئيًا';row.lastPaymentAt=now(s);});allocations.push({debtId:record.id,lender:record.lender,liabilityAccount:record.liabilityAccount||record.type||'تسهيلات ائتمانية مستحقة',amount:paid});remaining-=paid;}const liabilityAccount=String(p.liabilityAccount||open[0]?.liabilityAccount||'تسهيلات ائتمانية مستحقة'),lender=String(p.lender||allocations[0]?.lender||open[0]?.lender||`ممول ${companyName(s,t)}`),debitLines=allocations.length?allocations.map(x=>({account:x.liabilityAccount||liabilityAccount,debit:x.amount})):[{account:liabilityAccount,debit:a}],j=journal(s,t,p.note||'سداد أصل دين',[...debitLines,{account:account.id,credit:a}],reference),balanceAfter=num(account.balance),settlement={id:reference,reference,company:t,companyName:companyName(s,t),lender,amount:a,requestedAmount:requested,requestFingerprint,debtId:debtId||null,allocations,accountId:account.id,accountBalanceBefore:balanceBefore,accountBalanceAfter:balanceAfter,paidAt:now(s),journalEntryId:j.id,status:'منفذة',note:String(p.note||'سداد أصل دين')};protectDocument(s,settlement,'debt-repayment');s.finance.debtSettlements.unshift(settlement);s.finance.debtSettlements=s.finance.debtSettlements.slice(0,400);const transfer={id:reference,reference,at:now(s),from:account.id,to:lender,amount:a,note:settlement.note,purposeCategory:'سداد أصل دين',purposeDetail:allocations.map(x=>x.debtId).join(' · ')||liabilityAccount,paymentMethod:'تحويل بنكي',company:t,kind:'debt-repayment',documentNumber:reference,status:'منفذة',accountBalanceBefore:balanceBefore,accountBalanceAfter:balanceAfter};protectDocument(s,transfer,'debt-payment-transfer');ledger(s,t,transfer);insertFinanceTransfer(s,{...transfer});reconcile(s);return {amount:a,debt:b.debt,debtId:debtId||null,reference,settlement};
}
function raiseEquity(s,p){const t=requireCompany(s,p.company),a=num(p.amount);if(a<=0)throw new Error('invalid-amount');const b=book(s,t),id=p.ref||`EQUITY-${Math.floor(now(s))}-${s.finance.transfers.length+1}`;b.accounts[0].balance+=a;journal(s,t,p.note||'زيادة رأس مال',[{account:b.accounts[0].id,debit:a},{account:p.equityAccount||'رأس مال وعلاوة إصدار',credit:a}],id);ledger(s,t,{at:now(s),from:p.source||'مستثمرون',to:b.accounts[0].id,amount:a,note:p.note||'زيادة رأس مال',company:t,kind:'equity-financing',reference:id});reconcile(s);return {ref:id,amount:a};}

function zeroSectorMap(s){return companyMetricMap(s);}
function consumeTripAccruals(s){
  ensure(s);
  const result={
    profit:companyMetricMap(s,s.tripProfitAccrued,'trip-profit'),
    revenue:companyMetricMap(s,s.tripRevenueAccrued,'trip-revenue',{nonNegative:true}),
    fuel:companyMetricMap(s,s.tripFuelAccrued,'trip-fuel',{nonNegative:true}),
    maintenance:companyMetricMap(s,s.tripMaintenanceAccrued,'trip-maintenance',{nonNegative:true}),
    count:companyMetricMap(s,s.tripCountAccrued,'trip-count',{integer:true}),
    cash:companyMetricMap(s,s.finance.pendingDailyCash,'pending-daily-cash')
  };
  s.tripProfitAccrued=zeroSectorMap(s);s.tripRevenueAccrued=zeroSectorMap(s);s.tripFuelAccrued=zeroSectorMap(s);s.tripMaintenanceAccrued=zeroSectorMap(s);s.tripCountAccrued=zeroSectorMap(s);s.finance.pendingDailyCash=zeroSectorMap(s);
  return result;
}
function settleDailyCash(s,p={}){
  ensure(s);const t=requireCompany(s,p.company,{defaultGroup:false}),amount=Number(p.amount),day=Math.max(0,Math.floor(Number(p.day)||Math.floor(now(s)/86400))),reference=String(p.reference||`DAY-CASH-${t||'INVALID'}-${day}`);
  if(t==='group')throw new Error('invalid-daily-settlement-company');if(!Number.isFinite(amount))throw new Error('invalid-daily-settlement-amount');
  const prior=findTransferByIdOrReference(s,reference);if(prior){if(prior.company!==t||Math.abs(Number(prior.requestedAmount)-Math.abs(amount))>.01)throw new Error('daily-settlement-reference-conflict');return {company:t,amount:0,reference,idempotent:true,status:prior.status};}
  if(p.invoiceNumbers!==undefined&&(!Array.isArray(p.invoiceNumbers)||p.invoiceNumbers.length>20||p.invoiceNumbers.some(number=>!hasFinanceDocument(s,'invoices',row=>row.number===number&&row.company===t))))throw new Error('invalid-settlement-invoices');
  if([p.grossAmount,p.deductions].some(value=>value!==undefined&&(!Number.isFinite(Number(value))||Number(value)<0)))throw new Error('invalid-settlement-breakdown');
  const settledDays=s.finance.dailySettlementDays||{};if(Number.isFinite(settledDays[t])&&day<=settledDays[t])return {company:t,amount:0,reference,idempotent:true,status:'منفذة سابقًا'};
  if(Math.abs(amount)<.005&&!(Number(p.grossAmount)>0))return {company:t,amount:0,reference,idempotent:false,status:'صفر'};
  const b=book(s,t),incoming=amount>=0,requested=Math.abs(amount),settled=incoming?requested:Math.min(requested,num(b.accounts[0].balance)),shortfall=Math.max(0,requested-settled),balanceBefore=num(b.accounts[0].balance);
  if(incoming)b.accounts[0].balance+=settled;else b.accounts[0].balance-=settled;const balanceAfter=num(b.accounts[0].balance);
  if(shortfall>0)s.finance.pendingDailyCash[t]=(Number(s.finance.pendingDailyCash[t])||0)-shortfall;
  const transfer={id:reference,reference,at:now(s),day,from:incoming?'مركز التسوية التشغيلية اليومية':b.accounts[0].id,to:incoming?b.accounts[0].id:'مركز التسوية التشغيلية اليومية',amount:settled,requestedAmount:requested,shortfall,carriedAdjustment:p.grossAmount===undefined?0:amount-(num(p.grossAmount)-num(p.deductions)),signedAmount:incoming?settled:-settled,netAmount:incoming?settled:-settled,note:String(p.note||`تسوية صافي رحلات اليوم ${day} · ${companyName(s,t)}`),purposeCategory:incoming?'وصول صافي التشغيل للحساب الجاري':'تسوية عجز تشغيل',purposeDetail:String(p.note||`صافي الحركة النقدية التشغيلية لليوم ${day}`),paymentMethod:'تسوية تشغيل يومية',company:t,kind:'daily-operating-settlement',label:incoming?'وصول صافي التشغيل للحساب الجاري':'تسوية عجز التشغيل',status:shortfall>0?'منفذة جزئيًا':'منفذة',accountBalanceBefore:balanceBefore,accountBalanceAfter:balanceAfter};
  const profile=collectionProfile(t,s);Object.assign(transfer,{collection:true,channel:profile.channel,service:profile.service,invoiceNumbers:(p.invoiceNumbers||[]).slice(0,20),grossAmount:num(p.grossAmount??Math.max(0,amount)),deductions:num(p.deductions),tripCount:Math.max(0,Math.floor(Number(p.tripCount)||0)),sourceRefs:[`TRIPS-${t}-${day}`]});if(incoming)transfer.from=profile.source;
  for(const number of transfer.invoiceNumbers){const doc=findFinanceDocument(s,'invoices',row=>row.number===number&&row.company===t);if(doc&&doc.transferReference!==reference)amendInvoice(s,doc,'invoice-transfer-linked',row=>{row.transferReference=reference;});}
  protectDocument(s,transfer,'daily-operating-settlement');s.finance.dailySettlementDays={...settledDays,[t]:day};insertFinanceTransfer(s,{...transfer});if(settled>0){ledger(s,t,transfer);journal(s,t,transfer.note,incoming?[{account:b.accounts[0].id,debit:settled},{account:'مركز التسوية التشغيلية اليومية',credit:settled}]:[{account:'مركز التسوية التشغيلية اليومية',debit:settled},{account:b.accounts[0].id,credit:settled}],reference);}reconcile(s);return {company:t,amount:incoming?settled:-settled,reference,idempotent:false,status:transfer.status,shortfall,balanceBefore,balanceAfter,documentProofId:transfer.documentProofId,contentDigest:transfer.contentDigest};
}

function recordAssetFinance(s,p){
 const t=requireCompany(s,p.company),amount=num(p.amount),id=String(p.ref||'');
 if(!id||amount<=0)throw new Error('invalid-asset-finance');const prior=s.finance.debtRecords.find(row=>row.id===id);
 if(prior){if(prior.company!==t||Math.abs(prior.originalAmount-amount)>.01)throw new Error('asset-finance-reference-conflict');return clone(prior);}
 const row={id,company:t,companyName:companyName(s,t),lender:String(p.lender||'مورد الأصل'),type:'تمويل أصل',liabilityAccount:'التزامات تمويل أصول',originalAmount:amount,outstanding:amount,amount,issuedAt:now(s),dueDay:null,status:'قائم',assetCatalogId:p.assetCatalogId||null,invoiceRef:p.invoiceRef||null};
 protectDocument(s,row,'asset-financing');s.finance.debtRecords.unshift(row);book(s,t).debt+=amount;
 journal(s,t,'تمويل أصل من المورد',[{account:'أصول مشتراة بالتمويل',debit:amount},{account:row.liabilityAccount,credit:amount}],id);reconcile(s);return clone(row);
}
function setDebt(s,p){
 const t=requireCompany(s,p.company),b=book(s,t),target=num(p.amount),delta=target-num(b.debt);
 if(delta>0){const id=`DEBT-ADJUST-${t}-${++s.finance.debtSettlementSequence}`,row={id,company:t,companyName:companyName(s,t),lender:'تعديل رصيد الدين',type:'تعديل رصيد',liabilityAccount:'التزامات تمويلية مرحّلة',originalAmount:delta,outstanding:delta,amount:delta,issuedAt:now(s),dueDay:null,status:'قائم'};protectDocument(s,row,'debt-adjustment');s.finance.debtRecords.unshift(row);}
 else{let remaining=-delta;for(const row of s.finance.debtRecords.filter(x=>x.company===t&&x.status!=='مسدد')){const amount=Math.min(remaining,num(row.outstanding));if(amount>0)amendProtectedDocument(s,row,row.documentType||'debt-adjustment','debt-balance-adjusted',record=>{record.outstanding=Math.max(0,num(record.outstanding)-amount);if(record.outstanding<=.01){record.outstanding=0;record.status='مسدد';}});remaining-=amount;if(remaining<=0)break;}}
 b.debt=target;reconcile(s);return true;
}
// Compact annual ledger survives the 400-day UI window. Coverage is explicit.
const FINANCE_EPOCH=Date.UTC(2026,0,1),FINANCE_DAY=86400000;
function addAnnualReport(store,report,sign=1){
 const year=new Date(FINANCE_EPOCH+Number(report.day)*FINANCE_DAY).getUTCFullYear(),key=String(year);
 const summary=store[key]||(store[key]={year,days:[],companies:{}});
 if(sign>0&&!summary.days.includes(report.day))summary.days.push(report.day);
 for(const t of ['group',...Object.keys(report.companies||{})]){const input=t==='group'?report.group:report.companies?.[t];const row=summary.companies[t]||(summary.companies[t]={grossRevenue:0,expenses:0,net:0,tripCount:0});for(const field of ['grossRevenue','expenses','net','tripCount'])row[field]+=sign*(Number(field==='net'&&t==='group'?report.net:input?.[field])||0);}
 return summary;
}
function annualReports(s){
 if(!s.finance.annualCompanyReports||typeof s.finance.annualCompanyReports!=='object'||Array.isArray(s.finance.annualCompanyReports)){
  s.finance.annualCompanyReports={};const seen=new Set();for(const row of s.finance.dailyCompanyReports||[])if(!seen.has(row.day)){seen.add(row.day);addAnnualReport(s.finance.annualCompanyReports,row);}
 }
 return s.finance.annualCompanyReports;
}
function annualPerformance(s,t='group',year=2026){
 ensure(s);t=requireCompany(s,t);const summary=annualReports(s)[String(year)],row=summary?.companies?.[t]||{},reportedDays=summary?.days?.length||0,expectedDays=(Date.UTC(year+1,0,1)-Date.UTC(year,0,1))/FINANCE_DAY;
 return {grossRevenue:Number(row.grossRevenue)||0,expenses:Number(row.expenses)||0,net:Number(row.net)||0,tripCount:Number(row.tripCount)||0,reportedDays,expectedDays,complete:reportedDays===expectedDays};
}

function recordDailyClose(s,p){
  ensure(s);p=p&&typeof p==='object'&&!Array.isArray(p)?p:{};
  const sectors=companyMetricMap(s,p.sectors,'daily-close-sector'),rawNet=p.net===undefined?0:metricNumber(p.net,'daily-close-net','group'),rawDay=p.day===undefined?Math.floor(now(s)/86400):metricNumber(p.day,'daily-close-day','group'),day=Math.max(0,Math.floor(rawDay)),companies={},inputs=p.companies===undefined?{}:p.companies,ids=companyIds(s,{includeGroup:false}),allowed=new Set(ids);
  if(!inputs||typeof inputs!=='object'||Array.isArray(inputs))throw new Error('finance-daily-close-companies-map-invalid');
  for(const [id,row] of Object.entries(inputs))if(!allowed.has(id)){
    const fields=['grossRevenue','expenses','net','tripRevenue','operatingRevenue','tripCount'],legacyZero=row&&typeof row==='object'&&!Array.isArray(row)&&fields.every(field=>row[field]===undefined||Number.isFinite(Number(row[field]))&&Number(row[field])===0);
    if(legacyZero&&inactiveLegacyCompanyKey(s,id))continue;
    throw new Error(`finance-daily-close-company-unknown:${id}`);
  }
  for(const type of ids){
    const input=inputs[type]===undefined?{}:inputs[type];if(!input||typeof input!=='object'||Array.isArray(input))throw new Error(`finance-daily-close-company-invalid:${type}`);
    const value=(field,{nonNegative=false,integer=false,fallback=0}={})=>{const result=input[field]===undefined?fallback:metricNumber(input[field],`daily-close-${field}`,type);if(nonNegative&&result<0)throw new Error(`finance-daily-close-${field}-negative:${type}`);if(integer&&(!Number.isSafeInteger(result)||result<0))throw new Error(`finance-daily-close-${field}-not-integer:${type}`);return result;};
    const grossRevenue=value('grossRevenue',{nonNegative:true}),expenses=value('expenses',{nonNegative:true}),companyNet=value('net',{fallback:Number(sectors[type])||0});
    if((Object.prototype.hasOwnProperty.call(input,'grossRevenue')||Object.prototype.hasOwnProperty.call(input,'expenses'))&&Math.abs(grossRevenue-expenses-companyNet)>.01)throw new Error(`finance-daily-close-company-unbalanced:${type}`);
    if(p.sectors&&Object.prototype.hasOwnProperty.call(p.sectors,type)&&Math.abs(Number(sectors[type])-companyNet)>.01)throw new Error(`finance-daily-close-sector-mismatch:${type}`);
    companies[type]={grossRevenue,expenses,net:companyNet,tripRevenue:value('tripRevenue',{nonNegative:true}),operatingRevenue:value('operatingRevenue',{nonNegative:true}),tripCount:value('tripCount',{integer:true})};
  }
  const net=rawNet,companyTotals=Object.values(companies).reduce((out,row)=>{out.grossRevenue+=num(row.grossRevenue);out.expenses+=num(row.expenses);out.net+=Number(row.net)||0;out.tripCount+=Math.max(0,Number(row.tripCount)||0);return out;},{grossRevenue:0,expenses:0,net:0,tripCount:0}),groupOverhead=Math.max(0,companyTotals.net-net),groupRevenue=Math.max(0,net-companyTotals.net),closeFingerprint=JSON.stringify({day,net,sectors,companies}),report={id:`CLOSE-${day}`,day,at:now(s),net,sectors:{...sectors},companies,group:{grossRevenue:companyTotals.grossRevenue+groupRevenue,expenses:companyTotals.expenses+groupOverhead,net,tripCount:companyTotals.tripCount,overhead:groupOverhead,holdingRevenue:groupRevenue},closeFingerprint};
  const annual=annualReports(s),year=new Date(FINANCE_EPOCH+day*FINANCE_DAY).getUTCFullYear(),prior=s.finance.dailyCompanyReports.findIndex(row=>Number(row?.day)===day);
  if(prior>=0&&s.finance.dailyCompanyReports[prior].closeFingerprint===closeFingerprint)return clone(s.finance.dailyCompanyReports[prior]);
  if(prior>=0){addAnnualReport(annual,s.finance.dailyCompanyReports[prior],-1);s.finance.dailyCompanyReports.splice(prior,1);}
  else if(annual[String(year)]?.days?.includes(day))throw new Error('archived-daily-close-immutable');
  addAnnualReport(annual,report);
  s.finance.dailyCompanyReports.unshift(report);s.finance.dailyCompanyReports=s.finance.dailyCompanyReports.slice(0,400);
  s.lastClosedSectorProfit=sectors;s.lastClosedProfit=net;s.sectorProfitToday=zeroSectorMap(s);s.todayProfit=0;
  return report;
}

function performance(s,t='group',days=30){
  t=requireCompany(s,t);days=Math.max(1,Math.min(365,Math.floor(Number(days)||30)));const currentDay=Math.floor(now(s)/86400),rows=(Array.isArray(s?.finance?.dailyCompanyReports)?s.finance.dailyCompanyReports:[]).filter(row=>Number(row?.day)>currentDay-days&&Number(row?.day)<=currentDay);
  const aggregate=rows.reduce((out,row)=>{if(t==='group'){const x=row.group||{};out.grossRevenue+=num(x.grossRevenue);out.expenses+=num(x.expenses);out.net+=Number(row.net)||0;out.tripCount+=Math.max(0,Number(x.tripCount)||0);}else{const x=row.companies?.[t]||{};out.grossRevenue+=num(x.grossRevenue);out.expenses+=num(x.expenses);out.net+=Number(x.net)||0;out.tripCount+=Math.max(0,Number(x.tripCount)||0);}return out;},{grossRevenue:0,expenses:0,net:0,tripCount:0});
  const latest=rows[0],latestData=t==='group'?{grossRevenue:num(latest?.group?.grossRevenue),expenses:num(latest?.group?.expenses),net:Number(latest?.net)||0,tripCount:Math.max(0,Number(latest?.group?.tripCount)||0)}:{grossRevenue:num(latest?.companies?.[t]?.grossRevenue),expenses:num(latest?.companies?.[t]?.expenses),net:Number(latest?.companies?.[t]?.net)||0,tripCount:Math.max(0,Number(latest?.companies?.[t]?.tripCount)||0)};
  const currentNet=t==='group'?Number(s.todayProfit)||0:Number(s.sectorProfitToday?.[t])||0;
  return {company:t,days,reportedDays:rows.length,currentNet,lastDay:latest?.day??null,lastDayGross:latestData.grossRevenue,lastDayExpenses:latestData.expenses,lastDayNet:latestData.net,lastDayTrips:latestData.tripCount,grossRevenue:aggregate.grossRevenue,expenses:aggregate.expenses,net:aggregate.net,tripCount:aggregate.tripCount};
}

const CALENDAR_EPOCH_SECONDS=Date.UTC(2026,0,1)/1000;
function calendarMonthForDay(day){const date=new Date((CALENDAR_EPOCH_SECONDS+Math.max(0,Number(day)||0)*86400)*1000);return `${date.getUTCFullYear()}-${String(date.getUTCMonth()+1).padStart(2,'0')}`;}
function monthlyStatement(s,{months=12}={}){
  months=Math.max(1,Math.min(36,Math.floor(Number(months)||12)));const byMonth=new Map(),companyTypes=companyIds(s,{includeGroup:false});
  for(const report of Array.isArray(s?.finance?.dailyCompanyReports)?s.finance.dailyCompanyReports:[]){const key=calendarMonthForDay(report.day),month=byMonth.get(key)||{monthKey:key,days:new Set(),group:{income:0,expenses:0,net:0},companies:{}};month.days.add(Number(report.day));const group=report.group||{};month.group.income+=num(group.grossRevenue);month.group.expenses+=num(group.expenses);month.group.net+=Number(report.net)||0;for(const type of companyTypes){const source=report.companies?.[type]||{},row=month.companies[type]||(month.companies[type]={company:type,income:0,expenses:0,net:0});row.income+=num(source.grossRevenue);row.expenses+=num(source.expenses);row.net+=Number(source.net)||0;}byMonth.set(key,month);}
  const currentKey=calendarMonthForDay(Math.floor(now(s)/86400));if(!byMonth.has(currentKey))byMonth.set(currentKey,{monthKey:currentKey,days:new Set(),group:{income:0,expenses:0,net:0},companies:{}});
  return [...byMonth.values()].sort((a,b)=>b.monthKey.localeCompare(a.monthKey)).slice(0,months).map(month=>({monthKey:month.monthKey,reportedDays:month.days.size,income:month.group.income,expenses:month.group.expenses,net:month.group.net,deficit:Math.max(0,-month.group.net),surplus:Math.max(0,month.group.net),companies:companyTypes.map(type=>month.companies[type]||{company:type,income:0,expenses:0,net:0})}));
}

function applySimulationJournal(s,p={}){
  ensure(s);const j=p.journal===undefined?{}:p.journal;if(!j||typeof j!=='object'||Array.isArray(j))throw new Error('finance-simulation-journal-invalid');
  const types=companyIds(s,{includeGroup:false}),todayProfit=j.todayProfit===undefined?0:metricNumber(j.todayProfit,'simulation-today-profit','group'),sectorProfit=companyMetricMap(s,j.sectorProfit,'simulation-sector-profit'),tripProfit=companyMetricMap(s,j.tripProfit,'simulation-trip-profit'),tripRevenue=companyMetricMap(s,j.tripRevenue,'simulation-trip-revenue',{nonNegative:true}),tripFuel=companyMetricMap(s,j.tripFuel,'simulation-trip-fuel',{nonNegative:true}),tripMaintenance=companyMetricMap(s,j.tripMaintenance,'simulation-trip-maintenance',{nonNegative:true}),tripCount=companyMetricMap(s,j.tripCount,'simulation-trip-count',{integer:true}),cash=companyMetricMap(s,j.cash,'simulation-cash');
  s.todayProfit=(Number(s.todayProfit)||0)+todayProfit;
  for(const type of types){
    s.sectorProfitToday[type]+=sectorProfit[type];
    s.tripProfitAccrued[type]+=tripProfit[type];
    s.tripRevenueAccrued[type]+=tripRevenue[type];
    s.tripFuelAccrued[type]+=tripFuel[type];
    s.tripMaintenanceAccrued[type]+=tripMaintenance[type];
    s.tripCountAccrued[type]+=tripCount[type];
    if(cash[type])s.finance.pendingDailyCash[type]+=cash[type];
  }
  reconcile(s);return {todayProfit:Number(s.todayProfit)||0,cash:Number(s.cash)||0};
}
function initializeCapital(s,p){
 const capital=Number(p.capital);if(!Number.isFinite(capital)||capital<=0)throw new Error('invalid-initial-capital');
 if(s.finance?.foundingCapital)throw new Error('capital-already-initialized');
 const ref=String(p.ref||'');if(!ref)throw new Error('founding-capital-reference-required');
 s.companyFinance={};s.companyBudgets={};s.treasury={accounts:[],ledger:[],paymentQueue:[]};
 s.finance={invoices:[],cheques:[],payables:[],receivables:[],periods:[],journalEntries:[],transfers:[],payrollReports:[],taxSettlements:[],debtRecords:[],debtSettlements:[],intercompanyLoans:[],intercompanyLoanSettlements:[],cashPoolSweeps:[],centralTreasury:{minOperatingCash:{},lastPolicyAt:0,lastSweepAt:0},paymentSequence:1,invoiceSequence:1,taxSettlementSequence:1,debtSettlementSequence:1,journalSequence:0,taxPayable:0,taxPaid:0};
 invalidateFinanceLookupIndexes();ensure(s);if(activeEnsureTarget===s)activeEnsureComplete=true;s.advanced=s.advanced||{};if(s.advanced.treasury)s.advanced.treasury.liquidityBuffer=0;
 const result=founderInvestment(s,{company:'group',amount:capital,ref,note:'رأس المال عند تأسيس المجموعة'});
 s.finance.foundingCapital={ref,amount:capital};return result;
}
function closeVatPeriod(s,p={}){
 const day=Math.max(0,Math.floor(Number.isFinite(Number(p.day))?Number(p.day):Math.floor(now(s)/86400))),periodKey=calendarMonthForDay(day),rows=[];
 for(const t of companyIds(s)){const b=book(s,t),vat=b.vat||(b.vat={output:0,input:0,creditCarry:0,periodOutputStart:0,periodInputStart:0}),id=`TAX-${t}-${periodKey}`,existing=findFinanceDocument(s,'periods',row=>row.id===id);if(existing){if(Math.abs(num(existing.outputEnd)-num(vat.output))>.01||Math.abs(num(existing.inputEnd)-num(vat.input))>.01)throw new Error(`vat-period-already-closed:${id}`);rows.push(clone(existing));refreshBookTaxPayable(s,t);continue;}const deltaOutput=Math.max(0,num(vat.output)-num(vat.periodOutputStart)),deltaInput=Math.max(0,num(vat.input)-num(vat.periodInputStart)),openingCredit=num(vat.creditCarry),net=deltaOutput-deltaInput-openingCredit,periodTax=Math.max(0,net),closingCredit=Math.max(0,-net),outputEnd=num(vat.output),inputEnd=num(vat.input),fingerprint=JSON.stringify([t,periodKey,deltaOutput,deltaInput,openingCredit,closingCredit,periodTax,outputEnd,inputEnd]);vat.creditCarry=closingCredit;vat.periodOutputStart=outputEnd;vat.periodInputStart=inputEnd;const row={id,company:t,companyName:companyName(s,t),periodKey,period:`الفترة الضريبية ${periodKey}`,outputVAT:deltaOutput,inputVAT:deltaInput,openingCredit,closingCredit,amount:periodTax,outputEnd,inputEnd,dueDay:day+15,status:periodTax>0?'مستحق':'صفر',closeFingerprint:fingerprint,closedAt:now(s)};protectDocument(s,row,'vat-assessment');s.finance.periods.unshift(row);rows.push(row);refreshBookTaxPayable(s,t);}
 reconcile(s);return rows;
}
function execute(ctx,cmd,p={},meta={}){
 const s=ctx.state||ctx,previousMeta=activeExecutionMeta,previousEnsureTarget=activeEnsureTarget,previousEnsureComplete=activeEnsureComplete;
 activeExecutionMeta={...meta,name:cmd};activeEnsureTarget=s;activeEnsureComplete=false;
 try{
  // Capital initialization replaces the finance roots, so its own ensure must be
  // the first one in this command and must invalidate any transaction memo indexes.
  if(cmd==='initialize-capital')return initializeCapital(s,p);
  ensure(s);activeEnsureComplete=true;
  switch(cmd){
   case'ensure':return ensure(s);
   case'issue-invoice':return issueInvoice(s,p);
   case'spend':return spend(s,p);
   case'pay-by-cheque':return payByCheque(s,p);
   case'pay-payroll':return payPayroll(s,p);
   case'accrue-payroll':return accruePayroll(s,p);
   case'record-payroll-report':return recordPayrollReport(s,p);
   case'accrue-expense':return accrue(s,p);
   case'credit':return credit(s,p);
   case'transfer':return transfer(s,p);
   case'settle-intercompany-interest':return settleIntercompanyInterest(s,p);
   case'bulk-transfer':return bulkTransfer(s,p);
   case'set-central-treasury-policy':return setCentralTreasuryPolicy(s,p);
   case'cash-pool-sweep':return cashPoolSweep(s,p);
   case'issue-intercompany-loan':return issueIntercompanyLoan(s,p);
   case'repay-intercompany-loan':return repayIntercompanyLoan(s,p);
   case'transfer-reserve':return transferReserve(s,p);
   case'collect-receivable':return collectReceivable(s,p);
   case'settle-payable':return settlePayable(s,p);
   case'pay-taxes':return payTaxes(s,p);
   case'issue-cheque':return issueCheque(s,p);
   case'settle-cheque':return settleCheque(s,p);
   case'founder-investment':return founderInvestment(s,p);
   case'founder-withdrawal':return founderWithdrawal(s,p);
   case'set-budget':{const b=mutableBudget(s,p.company);b.limit=num(p.limit);b.enabled=b.limit>0;if(p.lines)b.lines={...b.lines,...p.lines};if(p.resetSpent){b.spent=0;b.reserved=0;b.spentByLine={};b.reservedByLine={};}return clone(b);}
   case'reset-budget':{const b=mutableBudget(s,p.company);b.limit=0;b.spent=0;b.reserved=0;b.enabled=false;b.lines={};b.spentByLine={};b.reservedByLine={};return clone(b);}
   case'refresh-identity':return refreshIdentity(s,p);
   case'raise-debt':return raiseDebt(s,p);
   case'raise-equity':return raiseEquity(s,p);
   case'repay-debt':return repayDebt(s,p);
   case'set-debt':return setDebt(s,p);
   case'record-asset-finance':return recordAssetFinance(s,p);
   case'consume-trip-accruals':return consumeTripAccruals(s);
   case'settle-daily-cash':return settleDailyCash(s,p);
   case'apply-simulation-journal':return applySimulationJournal(s,p);
   case'record-daily-close':return recordDailyClose(s,p);
   case'close-vat-period':return closeVatPeriod(s,p);
   default:throw new Error(`Unknown finance command: ${cmd}`);
  }
 }finally{activeExecutionMeta=previousMeta;activeEnsureTarget=previousEnsureTarget;activeEnsureComplete=previousEnsureComplete;}
}
const API={VERSION,COMPANY_METRIC_KEYSPACE:'company-instance-id/v1',annualPerformance,TYPES,companyIds,supportsCompany,requireCompany,companyMetricMap,collectionProfile,ensure,makeBook,book,operating,total,budget,remaining,lineRemaining,lineFor,canSpend,consumeBudget,reserveBudget,consumeReserved,releaseReserved,reconcile,journal,invoice,issueInvoice,payByCheque,performance,monthlyStatement,calendarMonthForDay,centralTreasuryPolicy,intercompanyLoanSnapshot,closeVatPeriod,withCollectionBatch,execute};globalThis.GH_FINANCE_CORE=API;globalThis.GH_DOMAIN_COMMANDS?.register?.('finance',API);if(globalThis.window&&window!==globalThis)window.GH_FINANCE_CORE=API;if(typeof module!=='undefined'&&module.exports)module.exports=API;
})();

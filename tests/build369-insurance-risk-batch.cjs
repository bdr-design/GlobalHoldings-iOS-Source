'use strict';
const assert=require('node:assert/strict');
const {harness,minimal}=require('./helpers/core-harness');
const {s}=harness(['advanced-core','transaction-core','insurance-core']);
const Advanced=s.GH_ADVANCED,Insurance=s.GH_INSURANCE_CORE,Transactions=s.GH_TRANSACTION_CORE;
const plain=value=>JSON.parse(JSON.stringify(value));
const risks=()=>[
  {id:'RISK-101',day:0,expiresDay:10,subject:'مصنع اختباري',officeId:'OFF-1',grade:'A',sumInsured:1000000,premium:10000,expectedLoss:1000,status:'بانتظار القرار'},
  {id:'RISK-102',day:0,expiresDay:10,subject:'مبنى اختباري',officeId:'OFF-1',grade:'B',sumInsured:2000000,premium:20000,expectedLoss:3000,status:'بانتظار القرار'}
];
function transactionState(){return {...minimal(),simSeconds:5*86400,openedCompanies:['insurance'],globalBases:[],customHubs:[],insurance:{sequence:2,offices:[],riskRequests:risks(),riskHistory:[],largeRisks:[],claimsReserve:[],dailyHistory:[],riskDecisionBatches:[]}};}

(async()=>{
  const businessState={...minimal(),globalBases:[{id:'INS-1',kind:'insurance',ownerCompanyId:'insurance',owned:true}],customHubs:[],assets:[],businessWorld:{customers:{segments:{insurance:{consumer:{namedCustomers:9000,marketCustomers:50000}}}},},insurance:{sequence:2,offices:[{id:'INS-OFF-1',facilityId:'INS-1',city:'الرياض',country:'السعودية',active:true,lines:{motor:{policies:17},health:{policies:8},property:{policies:0},commercial:{policies:0}}}],riskRequests:risks(),largeRisks:[{id:'COVER-1',startDay:0,endDay:365,sumInsured:1000000}]}};
  s.GH_INSURANCE_CORE=Insurance;
  s.GH_COMPANY_PLATFORM={definitionFor:()=>({capabilities:['operations.insurance'],facilities:{primaryKind:'insurance'}}),getDefinition:()=>null};
  const domainSummary=Insurance.summary(businessState);assert.equal(domainSummary.policies,25);assert.equal(domainSummary.activeLargeRisks,1);assert.equal(domainSummary.openRisks,2);
  const overview=Advanced.companyOverviewSummary(businessState,{id:'insurance',definition:{capabilities:['operations.insurance'],facilities:{primaryKind:'insurance'}}});
  assert.equal(overview.primaryOperatingLabel,'وثائق تأمين');
  assert.equal(overview.primaryOperatingCount,25);
  assert.deepEqual(plain(overview.metrics),[['مكاتب نشطة',1],['وثائق تأمين سارية',25],['تغطيات تجارية كبيرة',1],['مخاطر بانتظار القرار',2]]);
  assert.equal(overview.metrics.some(([label])=>label==='قاعدة العملاء'),false,'generic customer segments must not be shown as insurance policy customers');

  const uiState=transactionState();
  const coreForUi={...Insurance,MAX_OPEN_RISKS:5,ensure:state=>state.insurance,summary:()=>({offices:1,activeOffices:1,policies:4,activeLargeRisks:0,openRisks:2,net30:0,premium30:0,claims30:0,lossRatio30:0,reserve:0,reinsurance:.2}),LINE_IDS:[],LINES:{},PRICE_LEVELS:[],REINSURANCE_LEVELS:[]};
  s.GH_INSURANCE_CORE=coreForUi;
  const uiCtx={state:uiState,currentPanel:'insurance',currentArg:{tab:'overview'},esc:value=>String(value??''),fmtMoney:value=>String(value??0),fmtNumber:value=>String(value??0)};
  const html=Advanced.render('insurance',{tab:'overview'},uiCtx);
  assert.match(html,/insurance-decide-risks-batch/,'insurance panel exposes the group command');
  assert.equal((html.match(/data-insurance-risk-select=/g)||[]).length,2,'every pending risk can join the group decision');
  assert.match(html,/وثائق سارية/);

  const origin=/data-gh-action-origin="([^"]+)"/.exec(Advanced.actionAttributes('insurance-decide-risks-batch'))[1],dispatched=[],alerts=[],opened=[];
  const selections=risks().map(row=>({dataset:{insuranceRiskSelect:row.id},checked:false,addEventListener(name,fn){this[`on${name}`]=fn;}}));
  const buttons=['accept','decline'].map(decision=>({tagName:'BUTTON',dataset:{ghAction:'insurance-decide-risks-batch',ghActionOrigin:origin,decision},disabled:true,addEventListener(name,fn){if(name==='click')this.onClick=fn;}}));
  const countNode={textContent:''};
  s.document={querySelectorAll:selector=>selector==='[data-insurance-risk-select]:checked'?selections.filter(row=>row.checked):[],getElementById:()=>null};
  s.GH_WORKFLOW={confirm:()=>true};s.GH_AUTHORIZATION={digest:value=>`digest-${value.periodId}-${value.decisions.map(row=>row.id+row.decision).join('-')}`};
  const clickCtx={...uiCtx,runAuthorizedDomainCommand:async request=>(dispatched.push(plain(request)),{ok:true,result:{accepted:2,declined:0,skipped:0,totalPremium:30000,totalInsured:3000000}}),save(){},updateKpis(){},openDrawer:(...args)=>opened.push(args),pushAlert:value=>alerts.push(value)};
  const root={querySelectorAll(selector){if(selector==='[data-gh-action]')return buttons;if(selector==='[data-gh-action="insurance-decide-risks-batch"]')return buttons;if(selector==='[data-insurance-risk-select]')return selections;return [];},querySelector(selector){return selector==='#insBatchSelectedCount'?countNode:null;}};
  Advanced.bind(root,clickCtx);
  for(const input of selections){input.checked=true;input.onchange?.();}
  assert.equal(countNode.textContent,'2 / 5');assert.equal(buttons[0].disabled,false);
  await buttons[0].onClick();
  await buttons[0].onClick();
  assert.equal(dispatched.length,2,'same group click may be retried safely');
  assert.deepEqual([dispatched[0].domain,dispatched[0].name],['insurance','decide-risks-batch']);
  assert.deepEqual(dispatched[0].payload.decisions,[{id:'RISK-101',decision:'accept'},{id:'RISK-102',decision:'accept'}]);
  assert.equal(dispatched[0].idempotencyKey,dispatched[0].payload.batchId);
  assert.equal(dispatched[1].idempotencyKey,dispatched[0].idempotencyKey,'retry retains stable idempotency key');
  assert.deepEqual(dispatched[1].payload,dispatched[0].payload,'retry retains exact signed payload');
  assert.equal(dispatched[0].context.subjectId,'insurance');
  assert.equal(alerts.length,2);assert.equal(opened.length,2);

  const rollbackState=transactionState();let contractCalls=0;
  s.GH_FINANCE_CORE={execute({state},command,payload){assert.equal(command,'register-commercial-contract');contractCalls++;state.finance.contracts=state.finance.contracts||[];state.finance.contracts.push({id:payload.id});if(contractCalls===2)throw new Error('injected-document-failure');return {id:payload.id,documentProofId:`PROOF-${contractCalls}`,contentDigest:`DIGEST-${contractCalls}`};}};
  const before=plain(rollbackState);
  assert.throws(()=>Transactions.execute(rollbackState,{label:'insurance-batch-rollback-test',apply:()=>Insurance.execute({state:rollbackState},'decide-risks-batch',{batchId:'INS-ROLLBACK-1',periodId:'0',decisions:risks().map(row=>({id:row.id,decision:'accept'}))})}),/injected-document-failure/);
  assert.deepEqual(plain(rollbackState),before,'mid-batch failure rolls back policies, documents, history and batch receipt');

  const successState=transactionState();contractCalls=0;
  s.GH_FINANCE_CORE={execute({state},command,payload){assert.equal(command,'register-commercial-contract');contractCalls++;state.finance.contracts=state.finance.contracts||[];state.finance.contracts.push({id:payload.id});return {id:payload.id,documentProofId:`PROOF-${contractCalls}`,contentDigest:`DIGEST-${contractCalls}`};}};
  const payload={batchId:'INS-REPLAY-1',periodId:'0',decisions:risks().map(row=>({id:row.id,decision:'accept'}))};
  const first=Transactions.execute(successState,{label:'insurance-batch-first',apply:()=>Insurance.execute({state:successState},'decide-risks-batch',payload)}).value;
  const afterFirst=plain(successState);
  const replay=Transactions.execute(successState,{label:'insurance-batch-replay',apply:()=>Insurance.execute({state:successState},'decide-risks-batch',payload)}).value;
  assert.deepEqual(plain(replay),plain(first),'identical batch replays return the original receipt');
  assert.deepEqual(plain(successState),afterFirst,'replay creates no additional documents, risks, or batch rows');
  assert.equal(contractCalls,2,'the replay does not execute underwriting again');

  assert.throws(()=>Insurance.execute({state:transactionState()},'decide-risks-batch',{batchId:'NO-TX',decisions:[{id:'RISK-101',decision:'accept'}]}),/insurance-batch-transaction-required/);
  console.log(JSON.stringify({suite:'build369-insurance-risk-batch',passed:1,total:1,checks:['real policy summary instead of generic customer count','group approval click and signed stable payload','identical retry uses same idempotency key','transaction rollback on mid-batch document failure','batch receipt replay does not re-underwrite','batch command rejects execution outside transaction']}));
})().catch(error=>{console.error(error);process.exitCode=1;});

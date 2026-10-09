'use strict';

const assert=require('node:assert/strict');
const {harness,minimal}=require('./helpers/core-harness');
const {s}=harness(['advanced-core']);
const Advanced=s.GH_ADVANCED;

function definition(capability,primaryKind=null){return {capabilities:[capability],facilities:{primaryKind}};}
function summaryFor(state,id,capability,primaryKind=null,fleetIndex=null){
  return Advanced.companyOverviewSummary(state,{id,definition:definition(capability,primaryKind)},fleetIndex);
}
function plain(value){return JSON.parse(JSON.stringify(value));}
let renderedActionOrigin='';

{
  const state={...minimal(),globalBases:[{id:'INS-RUH',kind:'insurance',ownerCompanyId:'insurance',owned:true}],customHubs:[],assets:[],businessWorld:{customers:{segments:{insurance:{consumer:{marketCustomers:2100,namedCustomers:12}}}}}};
  s.GH_INSURANCE_CORE={summary:()=>({offices:1,activeOffices:1,policies:2840,activeLargeRisks:2,openRisks:3})};
  const overview=summaryFor(state,'insurance','operations.insurance','insurance');
  assert.equal(overview.category,'service');
  assert.equal(overview.fleetCount,0,'insurance does not receive synthetic fleet assets');
  assert.equal(overview.primaryOperatingLabel,'وثائق تأمين');
  assert.equal(overview.primaryOperatingCount,2840);
  assert.equal(overview.facilityCount,1);
  assert.equal(overview.hasPrimaryFacility,true);
  assert.deepEqual(plain(overview.metrics),[['مكاتب نشطة',1],['وثائق تأمين سارية',2840],['تغطيات تجارية كبيرة',2],['مخاطر بانتظار القرار',3]]);
  assert.equal(overview.metrics.some(([label])=>label==='قاعدة العملاء'),false,'insurance uses owned policy metrics rather than generic customer segments');
}

{
  const state={...minimal(),simSeconds:30*86400,globalBases:[],customHubs:[],realEstate:{offices:[{id:'RE-RUH'}],projects:[{id:'RE-P1',mode:'lease',status:'مكتمل',units:20,leased:8,leases:[{id:'L1',units:2,startDay:1,endDay:90},{id:'L2',units:3,startDay:1,endDay:20},{id:'L3',units:4,startDay:30,endDay:90}]}]},businessWorld:{customers:{segments:{realestate:{enterprise:{namedCustomers:3000000,marketCustomers:7000000}}}}}};
  s.GH_REALESTATE_CORE={summary:()=>({offices:1,projects:1,openRequests:4})};
  const overview=summaryFor(state,'realestate','operations.realestate','realestate');
  assert.equal(overview.category,'service');
  assert.equal(overview.fleetCount,0);
  assert.equal(overview.needsPrimaryFacility,true);
  assert.deepEqual(plain(overview.metrics),[['مكاتب',1],['مشاريع',1],['عقود إيجار نشطة',2],['وحدات مؤجرة',8],['طلبات تأجير',4]]);
  assert.equal(overview.metrics.some(([label])=>label==='قاعدة العملاء'),false,'real-estate portfolio does not read the generic customer segments');
}

{
  const state={...minimal(),globalBases:[],customHubs:[],assets:[],businessWorld:{customers:{profiles:new Proxy({},{ownKeys(){throw new Error('unbounded-customer-profile-scan');}}),segments:{telecom:{consumer:{marketCustomers:900,namedCustomers:25,billed:18000,outstanding:1500}}}}}};
  s.GH_CUSTOMER_COMPANIES_CORE={snapshot:(_state,id)=>id==='telecom'?{[id]:{company:id,customerCount:925,activeSubscriptions:800,activeServicePlans:4,monthlyBilled:25000,outstanding:3200}}:null};
  const overview=summaryFor(state,'telecom','operations.telecom');
  assert.equal(overview.category,'service');
  assert.equal(overview.primaryOperatingLabel,'قاعدة العملاء');
  assert.equal(overview.primaryOperatingCount,925);
  assert.deepEqual(plain(overview.metrics),[['قاعدة العملاء',925],['اشتراكات سارية',800],['باقات الخدمة',4],['فواتير شهرية',25000],['ذمم العملاء',3200]]);
}

{
  const state={...minimal(),globalBases:[],customHubs:[],assets:[]};
  s.GH_CUSTOMER_COMPANIES_CORE={snapshot:(_state,id)=>id==='dealership'?{[id]:{company:id,customerCount:340,inventoryUnits:18,inventorySkuCount:6,pendingSales:4,outstanding:14000}}:null};
  const overview=summaryFor(state,'dealership','operations.dealer');
  assert.equal(overview.primaryOperatingLabel,'قاعدة العملاء');
  assert.equal(overview.primaryOperatingCount,340);
  assert.deepEqual(plain(overview.metrics),[['قاعدة العملاء',340],['مخزون سيارات',18],['طرازات متاحة',6],['مبيعات معلقة',4],['ذمم العملاء',14000]]);
}

{
  const state={...minimal(),assets:[
    {id:'A1',ownerCompanyId:'air',phase:'moving',routeId:'R1'},
    {id:'A2',ownerCompanyId:'air',phase:'turnaround',routeId:'R2'}
  ],globalBases:[],customHubs:[]};
  const overview=summaryFor(state,'air','operations.fleet','airport-base');
  assert.equal(overview.category,'fleet');
  assert.equal(overview.fleetCount,2);
  assert.equal(overview.primaryOperatingLabel,'أصول متحركة');
  assert.deepEqual(plain(overview.metrics),[['أصول الأسطول',2],['رحلات جارية',1]]);
  assert.equal(overview.metrics.some(([label])=>label.includes('عميل')),false,'fleet metrics do not masquerade as customer portfolios');
}

{
  const state={...minimal(),globalBases:[{id:'BANK-RUH',kind:'bank',ownerCompanyId:'bank',owned:true}],customHubs:[],businessWorld:{customers:{segments:{bank:{consumer:{namedCustomers:1000000,marketCustomers:9000000},enterprise:{namedCustomers:500000,marketCustomers:1500000}}}}},bank:{retailCustomers:400,businessCustomers:20,branchNetwork:[{id:'BR1',retailCustomers:1200,businessCustomers:25}],loanRequests:[{id:'LR1'}]}};
  const overview=summaryFor(state,'bank','operations.bank','bank');
  assert.equal(overview.category,'service');
  assert.deepEqual(plain(overview.metrics),[['الفروع',1],['عملاء أفراد',400],['عملاء شركات',20],['طلبات تمويل',1]]);
  assert.equal(overview.metrics.some(([label])=>label==='قاعدة العملاء المسجلة'||label==='قاعدة العملاء'),false,'bank summary uses bank-owned customer totals and does not duplicate a generic portfolio count');
  const legacyState={...state,bank:{branchNetwork:[{id:'BR1',retailCustomers:1200,businessCustomers:25}],loanRequests:[]}};
  const fallback=summaryFor(legacyState,'bank','operations.bank','bank');
  assert.deepEqual(plain(fallback.metrics),[['الفروع',1],['عملاء أفراد',1200],['عملاء شركات',25],['طلبات تمويل',0]],'legacy bank saves fall back to the bank-owned branch aggregates when top-level totals are absent');
}

{
  const insuranceDefinition={id:'insurance',classification:{primarySectorId:'insurance'},identity:{short:'INS',trade:{ar:'التأمين'}},capabilities:['operations.insurance'],facilities:{primaryKind:'insurance'}},
    telecomDefinition={id:'telecom',classification:{primarySectorId:'telecom'},identity:{short:'TEL',trade:{ar:'الاتصالات'}},capabilities:['operations.telecom'],facilities:{primaryKind:null}},
    dealerDefinition={id:'dealership',classification:{primarySectorId:'dealership'},identity:{short:'AUTO',trade:{ar:'وكالة السيارات'}},capabilities:['operations.dealer'],facilities:{primaryKind:null}},
    instances=[{id:'insurance',definition:insuranceDefinition,opened:true,operational:true,known:true},{id:'telecom',definition:telecomDefinition,opened:true,operational:true,known:true},{id:'dealership',definition:dealerDefinition,opened:true,operational:true,known:true}];
  const definitionById={insurance:insuranceDefinition,telecom:telecomDefinition,dealership:dealerDefinition};
  s.GH_COMPANY_PLATFORM={listInstances:()=>instances,getDefinition:id=>definitionById[id],definitionFor:(_state,id)=>definitionById[id],resolveCompany:(_state,id)=>({id,known:true,operational:true,definition:definitionById[id]}),resolveIdentity:(_state,id)=>({legalName:id,shortName:id.toUpperCase()})};
  s.GH_INSURANCE_CORE={summary:()=>({offices:1,policies:600,openRisks:0})};
  s.GH_CUSTOMER_COMPANIES_CORE={PLANS:{mobile:{id:'mobile',label:'Mobile',monthlyPrice:38}},oemDirectory:()=>[{id:'fixture',name:'Fixture OEM',models:[{id:'sedan-x',name:'Sedan X',retail:30000}]}],snapshot:(_state,id)=>id==='telecom'?{[id]:{company:id,customerCount:925,activeSubscriptions:800,activeServicePlans:4,monthlyBilled:25000,outstanding:3200}}:id==='dealership'?{[id]:{company:id,customerCount:340,inventoryUnits:18,inventorySkuCount:6,pendingSales:4,completedSales:12,outstanding:14000,suppliers:[{legalName:'OEM Fixture',country:'Japan',brands:['Fixture Motors'],agreement:{status:'ساري',orders:2,invoiceCount:2,lastOrderReference:'PO-2026-04'},orders:[{reference:'PO-2026-04',modelId:'SEDAN-X',quantity:3,amount:90000,invoiceNumber:'INV-04',chequeId:'CHQ-04'}]}],sales:Array.from({length:12},(_,index)=>({id:`SALE-${index}`,status:'awaiting-bank-decision',customer:`Customer ${index}`,model:'Sedan X',total:30000}))}}:null};
  const state={...minimal(),profile:{name:'Fixture Holdings'},hired:[],crew:[],openedCompanies:['insurance','telecom','dealership'],companyRegistry:{insurance:{legalName:'Fixture Insurance',paidInCapital:60000000},telecom:{legalName:'Fixture Telecom',paidInCapital:45000000},dealership:{legalName:'Fixture Auto',paidInCapital:65000000}},globalBases:[{id:'INS-RUH',kind:'insurance',ownerCompanyId:'insurance',owned:true}],customHubs:[],assets:[],businessWorld:{customers:{segments:{}}},companyFinance:{},bank:{loanRequests:Array.from({length:8},(_,index)=>({id:`AUTO-LOAN-${index}`,sourceCompanyId:'dealership',sourceSaleId:`SALE-${index}`,orderId:`SALE-${index}`,borrower:`Customer ${index}`,amount:20000,invoiceAmount:30000}))}};
  const ctx={state,typeName:id=>id,esc:value=>String(value??''),fmtMoney:value=>String(value??0),fmtNumber:value=>String(value??0),companyPerformance:()=>({currentNet:0,lastDayNet:0,net:0}),companyOperatingBalance:()=>0};
  const html=Advanced.render('companies','subs',ctx);
  assert.match(html,/company-card-service/);
  assert.match(html,/قاعدة العملاء/);
  assert.match(html,/اشتراكات سارية/);
  assert.match(html,/data-open="insurance"/,'service company with its office goes directly to its operating desk');
  assert.match(html,/data-open="companyManage" data-arg="telecom:operations"/,'customer-first company without a facility routes to operations rather than to the map asset market');
  assert.doesNotMatch(html,/أسطول متحرك.{0,80}0/);
  const detail=Advanced.render('companyManage',{type:'telecom',tab:'operations'},ctx);
  assert.match(detail,/دورة عملاء الاتصالات/);
  assert.match(detail,/اشتراكات سارية/);
  assert.match(detail,/data-open="invoices" data-arg="telecom"/,'operations panel links to the existing company document flow');
  assert.match(detail,/telecom-create-subscription/,'telecom operations expose the actual subscription command');
  assert.match(detail,/telecom-set-cohort/,'telecom operations support aggregated customer cohorts');
  const dashboard=Advanced.render('companyManage',{type:'dealership',tab:'overview'},ctx);
  assert.match(dashboard,/company-quick-actions/,'company overview provides one concise direct-access panel');
  for(const target of ['operations','people','finance'])assert.match(dashboard,new RegExp(`data-company-manage-tab="${target}"`),`company dashboard links directly to ${target}`);
  assert.match(dashboard,/data-open="companyFacilities" data-arg="dealership"/,'company dashboard opens its branch and facility directory directly');
  const telecomDashboard=Advanced.render('companyManage',{type:'telecom',tab:'overview'},ctx);
  assert.match(telecomDashboard,/data-open="companyFacilities" data-arg="telecom"/,'telecom dashboard has a direct route to its accessible physical branches');
  assert.match(telecomDashboard,/قاعدة العملاء/);assert.match(telecomDashboard,/اشتراكات سارية/);assert.match(telecomDashboard,/فواتير شهرية/,'customer-led company dashboard retains its customer and billing indicators');
  const dealerDetail=Advanced.render('companyManage',{type:'dealership',tab:'operations'},ctx);
  renderedActionOrigin=(dealerDetail.match(/data-gh-action-origin="([^"]+)"/)||[])[1]||'';
  assert.match(dealerDetail,/المصنعون والموردون/);
  assert.match(dealerDetail,/OEM Fixture/);
  assert.match(dealerDetail,/CHQ-04/,'supplier purchase history shows existing cheque reference without creating a new action');
  for(const action of ['dealership-receive-stock','dealership-retail-sale','dealership-create-service-plan','dealership-settle-financed-sale','bank-customer-finance-batch'])assert.match(dealerDetail,new RegExp(action),`dealer operations expose ${action}`);
  assert.equal((dealerDetail.match(/data-customer-finance-decision=/g)||[]).length,5,'financing review is bounded by bank open-request capacity');
  assert.equal((dealerDetail.match(/data-sale="SALE-/g)||[]).length,5,'settlement view renders a bounded list of pending sales');
  assert.equal((dealerDetail.match(/Customer \d+/g)||[]).length<=10,true,'the operation view never renders the full customer population');
  const requests=Array.from({length:5},(_,index)=>({id:`RE-REQ-${index+1}`,tenant:`Tenant ${index+1}`,units:2,projectName:'Office',years:3,rentLevel:1,annualRent:280000,expiresDay:70}));s.GH_REALESTATE_CORE={MAX_OPEN_REQUESTS:5,ensure:()=>({tenantRequests:requests,projects:[],offices:[],sequence:5}),summary:()=>({offices:1,projects:0,underConstruction:0,units:0,occupancy:0,unsoldUnits:0,presold:0,revenue30:0,net30:0,capex30:0,annualRentRoll:0,openRequests:5,internalRentAccounts:0,internalRentReceivable:0})};
  const realEstateHtml=Advanced.render('realestate',{tab:'overview'},{...ctx,currentArg:{tab:'overview'}});renderedActionOrigin=(realEstateHtml.match(/data-gh-action-origin="([^"]+)"/)||[])[1]||'';assert.equal((realEstateHtml.match(/data-realestate-request-select=/g)||[]).length,5,'real-estate dashboard exposes five explicit request checkboxes');assert.equal((realEstateHtml.match(/data-gh-action="realestate-decide-requests-batch"/g)||[]).length,2,'real-estate dashboard exposes grouped accept and decline actions');assert.match(realEstateHtml,/realestate-decide-request/,'individual signed request actions remain available');
}

async function verifyActionWiring(){
  const dispatched=[],origin=renderedActionOrigin,state={...minimal(),simSeconds:86400,bank:{loanRequests:[{id:'REQ-A',sourceCompanyId:'dealership',sourceSaleId:'SALE-A',customerId:'C-A'},{id:'REQ-B',sourceCompanyId:'dealership',sourceSaleId:'SALE-B',customerId:'C-B'},{id:'REQ-OTHER',sourceCompanyId:'telecom',customerId:'C-X'}]}};
  const elements={telecomCustomerName:{value:'Customer Test'},telecomPlan:{value:'mobile'},telecomCountry:{value:'Saudi Arabia'},telecomSegment:{value:'consumer'}};
  const selects=[{dataset:{customerFinanceDecision:'REQ-A'},value:'approve'},{dataset:{customerFinanceDecision:'REQ-B'},value:'reject'}],includes=[{dataset:{customerFinanceInclude:'REQ-A'},checked:true},{dataset:{customerFinanceInclude:'REQ-B'},checked:false}];
  s.document={getElementById:id=>elements[id]||null,querySelectorAll:selector=>selector==='[data-customer-finance-decision]'?selects:selector==='[data-customer-finance-include]'?includes:[]};
  s.GH_WORKFLOW={confirm:()=>true};
  const ctx={state,currentPanel:'companyManage',runAuthorizedDomainCommand:async request=>{dispatched.push(request);return {ok:true,result:request.name==='create-subscription'?{id:request.payload.id}:request.name==='ensure'?{supplyAgreements:6}:request.name==='approve-loan-requests-batch'?{approved:1,rejected:1,skipped:0,totalPrincipal:20000}:request.name==='settle-financed-sale'?{id:request.payload.saleId,status:'sold-financed',bankDisbursementReference:'CUST-DISB-1',invoiceNumber:'INV-SETTLED'}:{id:request.payload.id,monthlyPrice:125}};},save(){},updateKpis(){},openDrawer(){},pushAlert(){},fmtNumber:String,fmtMoney:String};
  const run=async(actionId,extra={})=>{let click;const button={tagName:'BUTTON',dataset:{ghAction:actionId,ghActionOrigin:origin,...extra},addEventListener(_name,fn){click=fn;}};Advanced.bind({querySelectorAll:selector=>selector==='[data-gh-action]'?[button]:[],querySelector:()=>null},ctx);assert.equal(typeof click,'function',`${actionId} has an active click owner`);await click();};
  await run('telecom-create-subscription');
  assert.deepEqual([dispatched.at(-1).domain,dispatched.at(-1).name],['customer-companies','create-subscription']);assert.equal(dispatched.at(-1).payload.company,'telecom');
  await run('dealership-ensure');assert.deepEqual([dispatched.at(-1).domain,dispatched.at(-1).name],['customer-companies','ensure']);assert.equal(dispatched.at(-1).payload.company,'dealership');
  await run('bank-customer-finance-batch');
  const batch=dispatched.at(-1);assert.deepEqual([batch.domain,batch.name],['banking','approve-loan-requests-batch']);assert.deepEqual(Array.from(batch.payload.decisions,row=>row.id),['REQ-A'],'batch review submits only explicitly selected dealership requests');assert.equal(batch.payload.decisions[0].sourceCompanyId,'dealership');assert.ok(batch.payload.batchId.length<=120,'batch reference respects the banking owner limit');
  await run('dealership-settle-financed-sale',{sale:'SALE-1'});const settlement=dispatched.at(-1);assert.deepEqual([settlement.domain,settlement.name],['customer-companies','settle-financed-sale']);assert.equal(settlement.payload.company,'dealership');assert.equal(settlement.idempotencyKey,undefined,'pending receipt checks can be retried without replaying a cached pending result');
  const selectionInputs=Array.from({length:6},(_,index)=>({dataset:{realestateRequestSelect:`RE-REQ-${index+1}`},checked:false,addEventListener(name,fn){this[`on${name}`]=fn;}})),batchButton={tagName:'BUTTON',dataset:{ghAction:'realestate-decide-requests-batch',ghActionOrigin:origin,decision:'accept'},disabled:false,addEventListener(_name,fn){this.onClick=fn;}},countNode={textContent:''},root={querySelectorAll(selector){if(selector==='[data-gh-action]')return [batchButton];if(selector==='[data-gh-action="realestate-decide-requests-batch"]')return [batchButton];if(selector==='[data-realestate-request-select]')return selectionInputs;return [];},querySelector(selector){return selector==='#reBatchSelectedCount'?countNode:null;}};
  Object.assign(s.document,{querySelectorAll:selector=>selector==='[data-realestate-request-select]:checked'?selectionInputs.filter(input=>input.checked):[]});s.GH_AUTHORIZATION={digest:value=>`stable-${value.periodId}-${value.selected.join('-')}`};const batchCtx={state:{...minimal(),simSeconds:61*86400},currentPanel:'realestate',runAuthorizedDomainCommand:async request=>(dispatched.push(request),{ok:true,result:{accepted:5,declined:0,skipped:0,totalUnits:10,totalAnnualRent:1400000}}),openDrawer(){},pushAlert(){},save(){},updateKpis(){},fmtMoney:String};s.GH_WORKFLOW={confirm:()=>true};Advanced.bind(root,batchCtx);for(const input of selectionInputs){input.checked=true;input.onchange?.();}assert.equal(selectionInputs[5].checked,false,'UI prevents selecting more than five requests');assert.equal(countNode.textContent,'5 / 5');assert.equal(batchButton.disabled,false);await batchButton.onClick();const realEstateBatch=dispatched.at(-1);assert.deepEqual([realEstateBatch.domain,realEstateBatch.name],['realestate','decide-requests-batch']);assert.deepEqual(Array.from(realEstateBatch.payload.decisions,row=>row.id),['RE-REQ-1','RE-REQ-2','RE-REQ-3','RE-REQ-4','RE-REQ-5']);assert.equal(realEstateBatch.payload.periodId,'2');assert.equal(realEstateBatch.payload.batchId,`RE-LEASE-2-accept-${('stable-2-RE-REQ-1-RE-REQ-2-RE-REQ-3-RE-REQ-4-RE-REQ-5').slice(0,24)}`);assert.equal(realEstateBatch.idempotencyKey,realEstateBatch.payload.batchId,'UI uses one stable monthly ID for command replay');assert.equal(realEstateBatch.context.subjectId,'realestate','grouped action remains signed against the real-estate company');
  console.log(JSON.stringify({suite:'build364-company-overview-summary',passed:16,total:16,scope:'derived sector summaries, concise company navigation, bounded customer operations, and signed command click owners'}));
}
verifyActionWiring().catch(error=>{console.error(error);process.exitCode=1;});

'use strict';

const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {harness,minimal}=require('./helpers/core-harness');

const results=[];
function test(name,run){run();results.push(name);console.log('PASS',name);}

(async()=>{
  const {s,storage}=harness([
    'capability-registry-core','company-definitions','company-platform-core','identity-system',
    'route-core','fleet-core','facility-core','hr-core','business-world-core','finance-core',
    'banking-core','directory-core','realism-core','procurement-core','lifecycle-core',
    'integrity-core','save-schema','migration-core','advanced-core'
  ]);
  const P=s.GH_COMPANY_PLATFORM,F=s.GH_FINANCE_CORE,Facility=s.GH_FACILITY_CORE,HR=s.GH_HR_CORE,
    Route=s.GH_ROUTE_CORE,Fleet=s.GH_FLEET_CORE,Procurement=s.GH_PROCUREMENT_CORE,
    Banking=s.GH_BANKING_CORE,Directory=s.GH_DIRECTORY_CORE,World=s.GH_BUSINESS_WORLD,
    Realism=s.GH_REALISM,Integrity=s.GH_INTEGRITY_CORE,Save=s.GH_SAVE_SCHEMA,Migration=s.GH_MIGRATION_CORE,Advanced=s.GH_ADVANCED;

  const raw={...minimal(),onboardingComplete:true,profile:{name:'Fixture Group',shortName:'FG',founder:'Fixture Founder',riskAppetite:'balanced'},
    companyRegistry:{group:{legalName:'Fixture Group'},'air-one':{definitionId:'gh-air-v1',legalName:'Air One Holdings',shortName:'AIR ONE'},'air-two':{definitionId:'gh-air-v1',legalName:'Air Two Holdings',shortName:'AIR TWO'}},
    companyModules:{},openedCompanies:['air-one','air-two'],unlockedSectors:['air'],groupValue:300000000,debt:0,cash:0,sequences:{},alerts:[],eventLog:[],research:{},sustainability:{},energy:{},bank:{},advanced:{}};
  const migrated=P.migrateState(raw);assert.equal(migrated.errors.length,0,migrated.errors.join(','));const state=migrated.state;
  F.ensure(state);F.book(state,'group').accounts[0].balance=100000000;F.book(state,'air-one').accounts[0].balance=120000000;F.book(state,'air-two').accounts[0].balance=120000000;F.reconcile(state);

  test('same-profile instances receive distinct legal, document, account, and runtime identities',()=>{
    const one=P.resolveCompany(state,'air-one'),two=P.resolveCompany(state,'air-two');
    assert.equal(one.definition,two.definition);assert.equal(one.definition.classification.operationProfileId,'fleet-route-air-v1');
    assert.notEqual(one.record.accountPrefix,two.record.accountPrefix);assert.notEqual(one.record.documentPrefix,two.record.documentPrefix);
    assert.notEqual(F.book(state,'air-one').accounts[0].id,F.book(state,'air-two').accounts[0].id);
    assert.equal(P.resolveIdentity(state,'air-one').legalName,'Air One Holdings');assert.equal(P.resolveIdentity(state,'air-two').legalName,'Air Two Holdings');
  });

  s.GH_WORLD_DATA={airports:[
    ['OERK','RUH','King Khalid International','Riyadh','Riyadh','SA',24.9576,46.6988,2049],
    ['OEDF','DMM','King Fahd International','Dammam','Eastern Province','SA',26.4712,49.7979,72]
  ],ports:[]};
  const country=new Intl.DisplayNames(['ar'],{type:'region'}).of('SA'),facilityId=(owner,row)=>`${owner}-${row[0]}`;
  function createFacility(owner,row){return Facility.execute({state},'create',{facility:{id:facilityId(owner,row),name:`${owner} · ${row[0]}`,owned:true,ownerCompanyId:owner,kind:'airport-base',sourceKey:`air:${row[0]}`,code:row[1]||row[0],icao:row[0],iata:row[1],city:row[3]||row[4]||'—',country,countryCode:row[5],coords:[row[6],row[7]],deliveryCapacity:5}});}
  const bases={};for(const owner of ['air-one','air-two'])for(const row of s.GH_WORLD_DATA.airports)bases[facilityId(owner,row)]=createFacility(owner,row);

  test('directory and facility creation project the same physical sources into isolated company ownership',()=>{
    const directory=Directory.create({airports:s.GH_WORLD_DATA.airports,ports:[],capitals:[]}),one=directory.search({state,companyId:'air-one',pageSize:24}).rows,two=directory.search({state,companyId:'air-two',pageSize:24}).rows,all=directory.search({state,company:'all',pageSize:24});
    assert.equal(one.length,2);assert.equal(two.length,2);assert(one.every(row=>row.ownerCompanyId==='air-one'));assert(two.every(row=>row.ownerCompanyId==='air-two'));
    assert.equal(one[0].sourceProviderKey,two[0].sourceProviderKey);assert.notEqual(one[0].ownerCompanyId,two[0].ownerCompanyId);
    assert.equal(all.rows.filter(row=>row.ownerCompanyId==='air-one').length,2);assert.equal(all.rows.filter(row=>row.ownerCompanyId==='air-two').length,2);
    assert.equal(directory.statsFor(state,'air-one').sites,2);assert.equal(directory.statsFor(state,'air-two').sites,2);assert.equal(directory.statsFor(state,'all').companies['air-one'].sites,2);assert.equal(directory.statsFor(state,'all').companies['air-two'].sites,2);
    assert.equal(state.globalBases.length,4);assert.equal(new Set(state.globalBases.map(row=>`${row.ownerCompanyId}:${row.sourceKey}`)).size,4);
    assert.throws(()=>directory.search({state,companyId:'air-ghost'}),/directory-company-unknown:air-ghost/);
    const before=state.globalBases.length;assert.throws(()=>Facility.execute({state},'create',{facility:{id:'GHOST-BASE',owned:true,ownerCompanyId:'air-ghost',kind:'airport-base'}}),/company-definition-unavailable|facility-company-invalid/);assert.equal(state.globalBases.length,before);
  });

  test('HR supports both dynamic instances without a company switch and keeps every contract owned',()=>{
    const pools={};
    for(const owner of ['air-one','air-two']){
      const candidate=HR.officialManagerCandidates(state,owner);assert.equal(candidate.length,2);assert(candidate.every(row=>row.company===owner));assert(candidate.every(row=>row.templateCompanyId==='air'));pools[owner]=candidate.map(row=>row.id);
      const appointment=HR.appointOfficialManager(state,{company:owner,candidateId:candidate[0].id,termMonths:48,source:'dynamic fixture'});assert.equal(appointment.contract.ownerCompanyId,owner);
      for(const row of s.GH_WORLD_DATA.airports){const id=facilityId(owner,row),out=Facility.execute({state},'hire',{id,company:owner,cost:0});assert.equal(out.ok,true);assert(out.hired>0);}
      assert.equal(HR.snapshot(state,{},owner).facilityMissing,0);
    }
    assert.equal(pools['air-one'].some(id=>pools['air-two'].includes(id)),false);
    const active=state.advanced.labor.employmentContracts.filter(row=>row.status==='ساري');assert(active.some(row=>row.officialManager&&row.ownerCompanyId==='air-one'));assert(active.some(row=>row.officialManager&&row.ownerCompanyId==='air-two'));
    assert(active.filter(row=>row.role==='تشغيل منشأة'&&row.ownerCompanyId==='air-one').length===2);assert(active.filter(row=>row.role==='تشغيل منشأة'&&row.ownerCompanyId==='air-two').length===2);
  });

  s.GH_POLICY_CORE={procurement:()=>({approved:true,blocked:[]})};let sequence=0;
  s.GH_DETERMINISM={nextId:(_state,prefix)=>`${prefix}-${++sequence}`};
  s.GH_CORPORATE_CORE={model:()=>({}),execute:({state:target},command,payload)=>{if(command==='unlock-sector'){if(!target.unlockedSectors.includes(payload.type))target.unlockedSectors.push(payload.type);return true;}if(command==='adjust-group-value'){target.groupValue=(Number(target.groupValue)||0)+(Number(payload.delta)||0);return target.groupValue;}if(['set-credit-rating','set-reputation'].includes(command))return true;throw new Error(`fixture-corporate-command:${command}`);}};
  Realism.migrate(state);
  const catalog={air:{new:[
    {id:'jet-small',name:'Jet Small',icon:'aircraft',price:2000000,downPayment:.2,leaseMonthly:10000,condition:100,specs:{capacity:100,speedKmh:800}},
    {id:'jet-large',name:'Jet Large',icon:'aircraft',price:20000000,downPayment:.2,leaseMonthly:90000,condition:100,specs:{capacity:300,speedKmh:850}}
  ]}};
  function buy(owner,itemId,base){const item=catalog.air.new.find(row=>row.id===itemId);return Procurement.execute({state,assetCatalog:catalog},'purchase-assets',{ownerCompanyId:owner,assetMode:'air',assetClass:'aircraft',qty:1,item:{id:itemId},tab:'new',base,supplier:{id:'SUP-AIRFRAME',legalName:'Airframes Incorporated'},mode:'cash',manual:true,immediateDelivery:true,upfront:item.price,requestRef:`MANUAL-${owner}`});}
  const firstOrder=buy('air-one','jet-small',bases['air-one-OERK']),secondOrder=buy('air-two','jet-large',bases['air-two-OERK']);

  test('procurement emits canonical delivery and asset ownership for both instances',()=>{
    assert.equal(firstOrder.count,1);assert.equal(secondOrder.count,1);const deliveries=state.realism.procurement.deliveries;assert.equal(deliveries.length,2);
    for(const row of deliveries){assert(['air-one','air-two'].includes(row.ownerCompanyId));assert.equal(row.asset.ownerCompanyId,row.ownerCompanyId);assert.equal(row.asset.assetMode,'air');assert.equal(row.asset.assetClass,'aircraft');assert.equal(row.asset.operationProfileId,'fleet-route-air-v1');assert.equal(row.payment.company,row.ownerCompanyId);}
    assert.equal(state.supplierTransactions.length,2);assert.deepEqual(new Set(state.supplierTransactions.map(row=>row.ownerCompanyId)),new Set(['air-one','air-two']));assert(state.supplierTransactions.every(row=>!Object.prototype.hasOwnProperty.call(row,'company')));
    const before=JSON.stringify({books:state.companyFinance,deliveries});assert.throws(()=>buy('air-ghost','jet-small',bases['air-one-OERK']),/company-definition-unavailable:air-ghost/);assert.equal(JSON.stringify({books:state.companyFinance,deliveries}),before);
  });

  for(const delivery of state.realism.procurement.deliveries){Fleet.execute({state},'record-delivery',{deliveryId:delivery.id,baseId:delivery.baseId,asset:delivery.asset,deliveredDay:0,deliveredAtSeconds:0});delivery.status='delivered';delivery.assetId=delivery.asset.id;delivery.deliveredDay=0;delivery.deliveredAtSeconds=0;}
  const assetOne=state.assets.find(row=>row.ownerCompanyId==='air-one'),assetTwo=state.assets.find(row=>row.ownerCompanyId==='air-two');assetOne.company='Air Two Holdings';assetTwo.company='Air One Holdings';

  test('fleet staffing follows canonical owner rather than display company or shared asset mode',()=>{
    assert.equal(Fleet.assetOwnerCompanyId(assetOne),'air-one');assert.equal(Fleet.assetOwnerCompanyId(assetTwo),'air-two');assert.equal(assetOne.staffing.ready,true);assert.equal(assetTwo.staffing.ready,true);
    const contracts=state.advanced.labor.employmentContracts.filter(row=>row.automaticAssetStaffing);assert.equal(contracts.length,2);
    assert.equal(contracts.find(row=>row.assetId===assetOne.id).ownerCompanyId,'air-one');assert.equal(contracts.find(row=>row.assetId===assetTwo.id).ownerCompanyId,'air-two');
    assert.equal(Fleet.headcount(state,'air-one'),12);assert.equal(Fleet.headcount(state,'air-two'),12);assert.equal(Fleet.monthlyPayroll(state,'air-one'),Fleet.monthlyPayroll(state,'air-two'));
  });

  const routeOne=Route.execute({state},'create',{route:{id:'R-AIR-ONE',ownerCompanyId:'air-one',routeMode:'air',fromFacility:'air-one-OERK',toFacility:'air-one-OEDF',from:'Riyadh',to:'Dammam',route:[[24.9576,46.6988],[26.4712,49.7979]]}}),
    routeTwo=Route.execute({state},'create',{route:{id:'R-AIR-TWO',ownerCompanyId:'air-two',routeMode:'air',fromFacility:'air-two-OERK',toFacility:'air-two-OEDF',from:'Riyadh',to:'Dammam',route:[[24.9576,46.6988],[26.4712,49.7979]]}});
  Fleet.execute({state},'assign-routes-batch',{assignments:[
    {id:assetOne.id,routeId:routeOne.id,route:routeOne,phase:'turnaround',baseFacility:assetOne.baseFacility},
    {id:assetTwo.id,routeId:routeTwo.id,route:routeTwo,phase:'turnaround',baseFacility:assetTwo.baseFacility}
  ]});

  test('identical corridors coexist across owners while cross-owner fleet assignment fails atomically',()=>{
    assert.notEqual(Route.signature(routeOne),Route.signature(routeTwo));assert.equal(Route.corridorMetrics(routeOne,routeTwo).comparable,false);
    assert.equal(routeOne.company,undefined);assert.equal(routeTwo.company,undefined);assert.equal(assetOne.routeId,'R-AIR-ONE');assert.equal(assetTwo.routeId,'R-AIR-TWO');
    const before=JSON.stringify(assetOne);assert.throws(()=>Fleet.execute({state},'assign-route',{id:assetOne.id,routeId:routeTwo.id,route:routeTwo,phase:'turnaround',baseFacility:assetOne.baseFacility}),/route-assignment-contract/);assert.equal(JSON.stringify(assetOne),before);
    const routeCount=state.customRoutes.length;assert.throws(()=>Route.execute({state},'create',{route:{id:'R-GHOST',ownerCompanyId:'air-ghost',routeMode:'air',fromFacility:'air-one-OERK',toFacility:'air-one-OEDF',route:[[24.9576,46.6988],[26.4712,49.7979]]}}),/company-definition-unavailable|route-owner-company-unknown/);assert.equal(state.customRoutes.length,routeCount);
  });

  test('banking discovers both finance-capable instances and values assets by canonical owner',()=>{
    Banking.execute({state},'sync-corporate-clients',{});Banking.execute({state},'review-limits',{});
    const expected=company=>{const cash=F.total(state,company),assets=state.assets.filter(row=>row.ownerCompanyId===company).reduce((sum,row)=>sum+Number(row.purchasePrice)*.55,0),debt=Number(F.book(state,company).debt)||0,base=Math.max(5000000,cash*.35+assets*.12-debt*.08);return Math.max(5000000,Math.round(base/100000)*100000);};
    assert.equal(state.bank.corporateClients['air-one'].creditLimit,expected('air-one'));assert.equal(state.bank.corporateClients['air-two'].creditLimit,expected('air-two'));assert.notEqual(expected('air-one'),expected('air-two'));
  });

  test('business relationships remain separate and an unknown explicit company cannot charge the group',()=>{
    const cashOne=F.operating(state,'air-one'),cashTwo=F.operating(state,'air-two'),one=World.execute({state},'launch-campaign',{ownerCompanyId:'air-one',channel:'digital',budget:100000,days:7}),two=World.execute({state},'launch-campaign',{ownerCompanyId:'air-two',channel:'digital',budget:200000,days:7});
    assert.equal(one.ownerCompanyId,'air-one');assert.equal(two.ownerCompanyId,'air-two');assert.equal(cashOne-F.operating(state,'air-one'),100000);assert.equal(cashTwo-F.operating(state,'air-two'),200000);
    const relationships=Object.values(state.businessWorld.relationships);assert(relationships.some(row=>row.ownerCompanyId==='air-one'));assert(relationships.some(row=>row.ownerCompanyId==='air-two'));
    const before=JSON.stringify({books:state.companyFinance,world:state.businessWorld});assert.throws(()=>World.execute({state},'launch-campaign',{ownerCompanyId:'air-typo',channel:'digital',budget:100000,days:7}),/company-definition-unavailable:air-typo/);assert.equal(JSON.stringify({books:state.companyFinance,world:state.businessWorld}),before);
  });

  test('realism and company UI expose both same-sector instances independently',()=>{
    const model=Realism.migrate(state);assert(Realism.companyTypes(state).includes('air-one'));assert(Realism.companyTypes(state).includes('air-two'));assert(model.budgets['air-one']);assert(model.budgets['air-two']);
    model.market.share['air-one']=4;model.market.share['air-two']=14;model.market.competitorPressure['air-one']=50;model.market.competitorPressure['air-two']=50;model.reputation['air-one']=70;model.reputation['air-two']=70;
    const economics=()=>({revenue:1000,fuelCost:200,crewCost:100,maintReserve:50}),oneTrip=Realism.tripModifier(state,assetOne,economics()),twoTrip=Realism.tripModifier(state,assetTwo,economics());assert(twoTrip.revenue>oneTrip.revenue);
    const oneStatement=Realism.statements(state,'air-one'),twoStatement=Realism.statements(state,'air-two');assert(oneStatement.assets>F.total(state,'air-one'));assert(twoStatement.assets>F.total(state,'air-two'));assert.notEqual(oneStatement.assets,twoStatement.assets);
    const esc=value=>String(value??''),ctx={state,esc,typeName:id=>P.resolveIdentity(state,id)?.shortName||id,fmtMoney:value=>`$${Number(value)||0}`,fmtNumber:value=>String(value),companyPerformance:()=>({currentNet:0,lastDayNet:0,net:0,reportedDays:0}),companyOperatingBalance:id=>F.operating(state,id),signatureStatus:()=>({ready:true})};
    const oneHtml=Advanced.render('companyManage',{type:'air-one',tab:'overview'},ctx),twoHtml=Advanced.render('companyManage',{type:'air-two',tab:'overview'},ctx),settings=Advanced.render('settings',null,ctx);
    assert(oneHtml.includes('Air One Holdings'));assert(!oneHtml.includes('Air Two Holdings'));assert(twoHtml.includes('Air Two Holdings'));assert(settings.includes('data-open-signature'));
  });

  await (async()=>{
    let request=null;const result=await Advanced.signedDomainCommand({runAuthorizedDomainCommand:async input=>(request=input,{ok:true,result:{appointmentId:'MGR-ACK'},authorizationProofId:'PROOF-1'})},'hr','appoint-official-manager',{company:'air-one',candidateId:'CEO-AIR-ONE'},{idempotencyKey:'manager-fixture',subjectId:'air-one'});
    assert.equal(result.appointmentId,'MGR-ACK');assert.equal(request.domain,'hr');assert.equal(request.name,'appoint-official-manager');assert.equal(request.context.subjectId,'air-one');assert.equal(request.idempotencyKey,'manager-fixture');
    const before=JSON.stringify(state.advanced.labor.officialManagers);await assert.rejects(()=>Advanced.signedDomainCommand({runAuthorizedDomainCommand:async()=>({ok:false,result:null})},'hr','appoint-official-manager',{company:'air-one',candidateId:'CEO-AIR-ONE'}),/فشل اعتماد الأمر/);assert.equal(JSON.stringify(state.advanced.labor.officialManagers),before);
    const source=fs.readFileSync(path.resolve(__dirname,'../WebApp/advanced-core.js'),'utf8');assert(!source.includes('runDurableStateCommand'));assert.match(source,/signedDomainCommand\(ctx,'hr','appoint-official-manager'/);assert.match(source,/signedDomainCommand\(ctx,'hr','dismiss-official-manager'/);
    results.push('advanced manual manager commands require durable authorization and NACK is non-mutating');console.log('PASS advanced manual manager commands require durable authorization and NACK is non-mutating');
  })();

  test('integrity sees dynamic books and rejects a cross-owner delivery destination',()=>{
    F.reconcile(state);let report=Integrity.check(state);assert.equal(report.counts.critical,0,report.issues.map(row=>row.id).join(','));
    const account=F.book(state,'air-two').accounts[0],balance=account.balance;account.balance=NaN;report=Integrity.check(state);assert(report.issues.some(row=>row.id===`FINANCE_BALANCE_INVALID_${account.id}`&&row.evidence.company==='air-two'));account.balance=balance;F.reconcile(state);
    const bad={id:'DEL-CROSS-OWNER',status:'pending',baseId:'air-two-OERK',asset:{id:'PENDING-CROSS',ownerCompanyId:'air-one',assetMode:'air',assetClass:'aircraft'}};state.realism.procurement.deliveries.push(bad);report=Integrity.check(state);assert(report.issues.some(row=>row.id==='DELIVERY_DESTINATION_OWNER_MISMATCH_DEL-CROSS-OWNER'));state.realism.procurement.deliveries.pop();
  });

  test('save, schema migration, reload, and business completion preserve both dynamic owners and metrics',()=>{
    state.tripProfitAccrued={'air-one':111,'air-two':222};state.tripRevenueAccrued={'air-one':333,'air-two':444};state.sectorProfitToday={'air-one':11,'air-two':22};F.reconcile(state);
    assert.equal(Save.validate(state).ok,true,Save.validate(state).errors.join(','));const persisted=JSON.stringify(state),storageKey='GH_DYNAMIC_COMPANY_FIXTURE';storage.setItem(storageKey,persisted);
    s.GH_PERSISTENCE={writeState:(key,value)=>{const json=JSON.stringify(value);storage.setItem(key,json);return {ok:true,json};}};
    const seed=minimal(),defaultState={...seed,profile:{name:'Default Group'},bank:{},energy:{},operations:{},companyRegistry:{},companyModules:{},finance:{...seed.finance},treasury:structuredClone(seed.treasury)};
    const loaded=Migration.load({defaultState,storageKey,legacyStorageKeys:[],saveSchema:Save}).state,reloaded=Migration.completeBusinessState(loaded,{defaultState,initialStocks:[],crewRolesSeed:[]});
    assert.equal(reloaded.tripProfitAccrued['air-one'],111);assert.equal(reloaded.tripProfitAccrued['air-two'],222);assert.equal(reloaded.tripRevenueAccrued['air-one'],333);assert.equal(reloaded.tripRevenueAccrued['air-two'],444);
    assert.equal(reloaded.assets.filter(row=>row.ownerCompanyId==='air-one').length,1);assert.equal(reloaded.assets.filter(row=>row.ownerCompanyId==='air-two').length,1);assert.equal(reloaded.customRoutes.find(row=>row.id==='R-AIR-ONE').ownerCompanyId,'air-one');assert.equal(reloaded.customRoutes.find(row=>row.id==='R-AIR-TWO').ownerCompanyId,'air-two');
    assert.equal(reloaded.globalBases.filter(row=>row.ownerCompanyId==='air-one').length,2);assert.equal(reloaded.globalBases.filter(row=>row.ownerCompanyId==='air-two').length,2);assert(reloaded.advanced.labor.employmentContracts.some(row=>row.assetId===assetOne.id&&row.ownerCompanyId==='air-one'));assert(reloaded.advanced.labor.employmentContracts.some(row=>row.assetId===assetTwo.id&&row.ownerCompanyId==='air-two'));assert.equal(HR.officialManager(reloaded,'air-one').company,'air-one');assert.equal(HR.officialManager(reloaded,'air-two').company,'air-two');assert.notEqual(HR.officialManager(reloaded,'air-one').candidateId,HR.officialManager(reloaded,'air-two').candidateId);assert.equal(Save.validate(reloaded).ok,true,Save.validate(reloaded).errors.join(','));
  });

  console.log(`PASS dynamic company consumers ${results.length}/${results.length}`);
})().catch(error=>{console.error(error);process.exitCode=1;});

(()=>{
  'use strict';
  const VERSION='3.0.0';
  const num=value=>Math.max(0,Number(value)||0),now=state=>Number(state.simSeconds)||0;
  const PRODUCTS=Object.freeze({
    consumer:{name:'قروض أفراد',rate:.082,termDays:1095,provision:.018,rsf:.85,minimum:1000000,riskWeight:.75},
    mortgage:{name:'تمويل سكني',rate:.057,termDays:3650,provision:.009,rsf:.82,minimum:5000000,riskWeight:.50},
    sme:{name:'تمويل منشآت صغيرة ومتوسطة',rate:.071,termDays:1825,provision:.016,rsf:.88,minimum:5000000,riskWeight:.85},
    corporate:{name:'تمويل شركات',rate:.064,termDays:2555,provision:.012,rsf:.90,minimum:10000000,riskWeight:.72},
    project:{name:'تمويل مشاريع وبنية تحتية',rate:.068,termDays:3650,provision:.014,rsf:.92,minimum:10000000,riskWeight:.90},
    green:{name:'تمويل أخضر',rate:.052,termDays:2920,provision:.008,rsf:.86,minimum:5000000,riskWeight:.60}
  });
  const DEPOSIT_PRODUCTS=Object.freeze({
    sight:{name:'حسابات جارية',runoff:.10,asf:.90},
    savings:{name:'حسابات ادخار',runoff:.05,asf:.92},
    term:{name:'ودائع لأجل',runoff:.03,asf:.95}
  });
  const RISK_GRADES=Object.freeze({
    AAA:{pd:.001,lgd:.20},AA:{pd:.002,lgd:.24},A:{pd:.004,lgd:.28},BBB:{pd:.012,lgd:.35},BB:{pd:.035,lgd:.42},B:{pd:.08,lgd:.52},C:{pd:.18,lgd:.65}
  });
  const ASF_WHOLESALE=.50;
  const clone=value=>globalThis.structuredClone?structuredClone(value):JSON.parse(JSON.stringify(value));
  const clamp=(value,min,max)=>Math.max(min,Math.min(max,Number(value)||0));
  const companyPlatform=()=>globalThis.GH_COMPANY_PLATFORM||null;
  function canonicalOwnerCompanyId(row){return String(row?.ownerCompanyId||row?.companyId||'').trim();}
  function facilityOwnerCompanyId(row){return canonicalOwnerCompanyId(row)||String(row?.company||'').trim();}
  function assetOwnerCompanyId(row){
    const explicit=canonicalOwnerCompanyId(row);if(explicit)return explicit;
    const mode=String(row?.assetMode||row?.type||'').trim();
    return String(companyPlatform()?.ownerForLegacyAssetMode?.(mode)||'').trim();
  }
  function isOperationalFinanceCompany(state,companyId,F){
    companyId=String(companyId||'').trim();if(!companyId)return false;
    const platform=companyPlatform();
    if(platform?.resolveCompany){const company=platform.resolveCompany(state,companyId);return Boolean(company?.operational&&platform.hasCapability(state,companyId,'finance.book'));}
    return companyId==='group'||Boolean((state.openedCompanies||[]).includes(companyId)&&F?.book?.(state,companyId));
  }
  function corporateCompanyIds(state,F){
    const platform=companyPlatform();
    if(platform?.listInstances)return platform.listInstances(state,{openedOnly:true,capability:'finance.book'}).filter(company=>company.operational&&!platform.hasCapability(state,company.id,'operations.bank')).map(company=>company.id);
    return ['group',...(state.openedCompanies||[])].filter((id,index,all)=>id!=='bank'&&all.indexOf(id)===index&&isOperationalFinanceCompany(state,id,F));
  }
  function hash(text){let h=2166136261>>>0;for(const ch of String(text)){h^=ch.charCodeAt(0);h=Math.imul(h,16777619)>>>0;}return h>>>0;}
  function deterministic(seed,min,max){return min+(hash(seed)/4294967295)*(max-min);}
  function defaultPricing(state){const market=clamp(state.advanced?.economy?.depositRate||.03,0,.20);return {sight:Number((market*.40).toFixed(4)),savings:Number((market*.92).toFixed(4)),term:Number((market*1.28).toFixed(4)),lastChangedAt:now(state)};}
  function branchTemplate(state,p={}){
    return {id:String(p.branchId||p.id||''),facilityId:p.facilityId||p.branchId||null,capitalId:p.capitalId||null,city:String(p.city||'غير محدد'),country:String(p.country||'غير محدد'),openedAt:Number(p.openedAt)||now(state),servicesActive:p.servicesActive!==false,services:Array.isArray(p.services)&&p.services.length?p.services:['حسابات وودائع','تحويلات ومدفوعات','بطاقات','تمويل أفراد','تمويل شركات','تمويل مشاريع','تجارة دولية'],retailCustomers:num(p.retailCustomers),businessCustomers:num(p.businessCustomers),deposits:num(p.deposits),loans:num(p.loans),depositMix:{sight:num(p.depositMix?.sight),savings:num(p.depositMix?.savings),term:num(p.depositMix?.term)},incomeStatement:{interestIncome:num(p.incomeStatement?.interestIncome),feeIncome:num(p.incomeStatement?.feeIncome),feeBreakdown:p.incomeStatement?.feeBreakdown&&typeof p.incomeStatement.feeBreakdown==='object'?{...p.incomeStatement.feeBreakdown}:{},interestExpense:num(p.incomeStatement?.interestExpense),creditLossExpense:num(p.incomeStatement?.creditLossExpense),opex:num(p.incomeStatement?.opex),serviceOpex:num(p.incomeStatement?.serviceOpex??p.incomeStatement?.opex),facilityOpex:num(p.incomeStatement?.facilityOpex),net:Number(p.incomeStatement?.net)||0},serviceModel:p.serviceModel||'universal',lastProcessedDay:Number.isFinite(Number(p.lastProcessedDay))?Number(p.lastProcessedDay):Math.floor(now(state)/86400)};
  }
  function ensure(state){
    const bank=state.bank=state.bank&&typeof state.bank==='object'?state.bank:{};
    bank.corporateClients=bank.corporateClients&&typeof bank.corporateClients==='object'?bank.corporateClients:{};
    for(const key of ['riskReviews','lettersOfCredit','guarantees','cashSweeps','branchNetwork','loanPortfolios','corporateFacilities','dailyHistory','treasurySecurities','wholesaleFacilities','creditDecisions','delinquencyEvents','recoveries','feeEvents'])bank[key]=Array.isArray(bank[key])?bank[key].filter(Boolean):[];
    if(!bank.transactionFeeByDay||typeof bank.transactionFeeByDay!=='object'||Array.isArray(bank.transactionFeeByDay)){bank.transactionFeeByDay={};for(const row of bank.feeEvents){const day=String(Math.max(0,Math.floor(Number(row.day)||0)));bank.transactionFeeByDay[day]=num(bank.transactionFeeByDay[day])+num(row.amount);}}
    for(const type of corporateCompanyIds(state,globalThis.GH_FINANCE_CORE))if(!bank.corporateClients[type])bank.corporateClients[type]={company:type,ownerCompanyId:type,creditLimit:5000000,drawn:0,depositBalance:0,lastReview:0,rating:'BBB'};
    for(const key of ['branches','deposits','loans','npl','capitalRatio','hqla','stableFunding','requiredStableFunding','wholesaleFunding','offBalance','feeIncomeYTD','provisions','retailCustomers','businessCustomers','dailyServiceFeeRevenue','interestIncomeYTD','depositInterestExpenseYTD','creditLossExpenseYTD'])bank[key]=num(bank[key]);
    // Net income is signed: normalizing balances must not erase accumulated losses.
    const signedNet=Number(bank.netBankingIncomeYTD);bank.netBankingIncomeYTD=Number.isFinite(signedNet)?signedNet:0;
    bank.revenueYTD=bank.revenueYTD&&typeof bank.revenueYTD==='object'?bank.revenueYTD:{};for(const key of ['accounts','payments','cards','merchant','cashManagement','fx','tradeFinance','retailFinance','businessFinance','projectFinance','arrangement','treasury'])bank.revenueYTD[key]=num(bank.revenueYTD[key]);
    bank.sequence=Math.max(0,Math.floor(Number(bank.sequence)||0));
    bank.depositPricing=bank.depositPricing&&typeof bank.depositPricing==='object'?{...defaultPricing(state),...bank.depositPricing}:defaultPricing(state);
    bank.riskPolicy=bank.riskPolicy&&typeof bank.riskPolicy==='object'?bank.riskPolicy:{};
    bank.riskPolicy={maxLdr:clamp(bank.riskPolicy.maxLdr||95,55,120),minLcr:clamp(bank.riskPolicy.minLcr||110,100,200),minNsfr:clamp(bank.riskPolicy.minNsfr||105,100,180),minCet1:clamp(bank.riskPolicy.minCet1||10.5,4.5,30),sectorConcentration:clamp(bank.riskPolicy.sectorConcentration||25,10,60),...bank.riskPolicy};
    bank.alm=bank.alm&&typeof bank.alm==='object'?bank.alm:{};
    bank.alm={maturityLadder:{overnight:0,under30:0,under365:0,over365:0},interestRateGap:0,liquidityGap30d:0,weightedDepositRate:0,...bank.alm};
    bank.branchNetwork=bank.branchNetwork.map(row=>branchTemplate(state,row));
    for(const facility of bank.corporateFacilities){facility.ownerCompanyId=String(facility.ownerCompanyId||facility.company||'').trim();facility.originalAmount=num(facility.originalAmount||facility.amount);facility.outstanding=num(facility.outstanding);facility.principalArrears=num(facility.principalArrears);facility.interestArrears=num(facility.interestArrears);facility.termDays=Math.max(30,Math.floor(Number(facility.termDays)||365));facility.rate=clamp(facility.rate||.06,0,.30);facility.startDay=Math.max(0,Math.floor(Number(facility.startDay)||0));facility.lastProcessedDay=Math.max(facility.startDay,Math.floor(Number(facility.lastProcessedDay)||facility.startDay));facility.maturityDay=Math.max(facility.startDay+facility.termDays,Math.floor(Number(facility.maturityDay)||0));}
    // Runtime reads never fabricate branches. Legacy reconstruction is isolated
    // in migrateLegacyBranches() and is invoked once during save migration.
    bank.branches=bank.branchNetwork.length;
    return bank;
  }
  function migrateLegacyBranches(state){
    const legacyCount=Math.max(0,Math.floor(Number(state.bank?.branches)||0)),bank=ensure(state);let added=0;
    const facilities=(state.customHubs||[]).filter(row=>row?.owned===true&&facilityOwnerCompanyId(row)==='bank'&&row.kind==='bank');
    for(const facility of facilities)if(!bank.branchNetwork.some(row=>row.facilityId===facility.id)){bank.branchNetwork.push(branchTemplate(state,{branchId:`BR-${++bank.sequence}`,facilityId:facility.id,capitalId:facility.capitalId||null,city:facility.city,country:facility.country,openedAt:facility.openedAt,servicesActive:true,legacyMigrated:true}));added++;}
    while(bank.branchNetwork.length<legacyCount){bank.branchNetwork.push(branchTemplate(state,{branchId:`BR-${++bank.sequence}`,city:'فرع محفوظ',country:'سجل قديم',openedAt:0,servicesActive:true,legacyMigrated:true}));added++;}
    bank.branches=bank.branchNetwork.length;return {changed:added>0,added,branches:bank.branches};
  }
  function dormant(bank){return num(bank.branches)===0&&num(bank.deposits)===0&&num(bank.loans)===0&&num(bank.wholesaleFunding)===0;}
  function depositMix(bank){
    const mix=bank.branchNetwork.reduce((out,branch)=>{for(const key of Object.keys(DEPOSIT_PRODUCTS))out[key]+=num(branch.depositMix?.[key]);return out;},{sight:0,savings:0,term:0}),known=mix.sight+mix.savings+mix.term,missing=Math.max(0,num(bank.deposits)-known);
    mix.sight+=missing*.45;mix.savings+=missing*.35;mix.term+=missing*.20;return mix;
  }
  // One read-only calculator for both actual balances and credit preflight.
  // The formulas are this game's existing prudential model, not a regulatory model.
  function prudentialMetrics(bank,cash){
    const deposits=num(bank.deposits),wholesale=num(bank.wholesaleFunding),mix=depositMix(bank),securities=bank.treasurySecurities.filter(row=>row.status==='ساري');
    const securityAssets=securities.reduce((sum,row)=>sum+num(row.amount),0),securityHqla=securities.reduce((sum,row)=>sum+num(row.amount)*num(row.hqlaFactor||.85),0);
    const offBalance=[...bank.lettersOfCredit,...bank.guarantees].filter(row=>row.status==='ساري').reduce((sum,row)=>sum+num(row.amount),0);
    const hqla=Math.round(cash+securityHqla),requiredStableFunding=bank.loanPortfolios.reduce((sum,row)=>sum+num(row.outstanding)*num(row.rsfFactor||.85),0)+Object.values(bank.corporateClients).reduce((sum,row)=>sum+num(row.drawn)*.85,0)+securities.reduce((sum,row)=>sum+num(row.amount)*.15,0);
    const stressedOutflows=Math.max(1,mix.sight*DEPOSIT_PRODUCTS.sight.runoff+mix.savings*DEPOSIT_PRODUCTS.savings.runoff+mix.term*DEPOSIT_PRODUCTS.term.runoff+wholesale*.25);
    const rwa=bank.loanPortfolios.reduce((sum,row)=>sum+num(row.outstanding)*num(PRODUCTS[row.product]?.riskWeight||.72),0)+Object.values(bank.corporateClients).reduce((sum,row)=>sum+num(row.drawn)*.85,0)+offBalance*.35+num(bank.branches)*2500000;
    const equity=Math.max(0,cash+num(bank.loans)+securityAssets-deposits-wholesale-num(bank.provisions));
    const stableFunding=Math.round(mix.sight*DEPOSIT_PRODUCTS.sight.asf+mix.savings*DEPOSIT_PRODUCTS.savings.asf+mix.term*DEPOSIT_PRODUCTS.term.asf+wholesale*ASF_WHOLESALE+equity),lcr=clamp(hqla/stressedOutflows*100,0,500),nsfr=clamp(stableFunding/Math.max(1,requiredStableFunding)*100,0,400),cet1=rwa?clamp(equity/rwa*100,0,100):equity>0?100:0;
    return {offBalance,hqla,requiredStableFunding,stressedOutflows,rwa,cet1Capital:equity,stableFunding,lcr,nsfr,cet1,capitalRatio:cet1,loanDepositRatio:deposits?num(bank.loans)/deposits*100:0,alm:{weightedDepositRate:(mix.sight*num(bank.depositPricing.sight)+mix.savings*num(bank.depositPricing.savings)+mix.term*num(bank.depositPricing.term))/(deposits||1),maturityLadder:{overnight:mix.sight,under30:mix.savings*.35+wholesale*.15,under365:mix.savings*.65+mix.term*.45+wholesale*.35,over365:mix.term*.55+wholesale*.50},interestRateGap:num(bank.loans)-deposits,liquidityGap30d:hqla-stressedOutflows}};
  }
  function reconcilePrudential(state){
    const bank=ensure(state);
    if(dormant(bank)){Object.assign(bank,{hqla:0,stableFunding:0,requiredStableFunding:0,lcr:120,nsfr:112,cet1:num(bank.capitalRatio)||16.4,loanDepositRatio:0,rwa:0,stressedOutflows:0});return bank;}
    // A dormant, unfounded bank has no finance book. Keep active-bank reads strict.
    const metrics=prudentialMetrics(bank,num(globalThis.GH_FINANCE_CORE?.operating?.(state,'bank'))),{alm,...values}=metrics;
    Object.assign(bank,values);Object.assign(bank.alm,alm);return bank;
  }
  function creditRiskPreview(state,proposal={}){
    const bank=state.bank;if(!bank?.riskPolicy||!bank.corporateClients||!Array.isArray(bank.loanPortfolios))throw new Error('bank-risk-state-not-initialized');
    const delta=key=>{const value=Number(proposal[key]??0);if(!Number.isFinite(value)||(key!=='cashDelta'&&value<0))throw new Error(`bank-risk-projection-invalid:${key}`);return value;};
    const cashDelta=delta('cashDelta'),loanDelta=delta('loanDelta'),provisionDelta=delta('provisionDelta'),drawnDelta=delta('drawnDelta'),offBalanceDelta=delta('offBalanceDelta');
    // Only small, touched banking collections are copied; nothing is published or
    // persisted until the existing transaction owner accepts the original command.
    const projected={...bank,loans:num(bank.loans)+loanDelta,provisions:num(bank.provisions)+provisionDelta};
    if(proposal.portfolio)projected.loanPortfolios=[proposal.portfolio,...bank.loanPortfolios];
    if(drawnDelta){const clientId=String(proposal.clientId||''),client=bank.corporateClients[clientId];if(!client)throw new Error('bank-client-not-synced');projected.corporateClients={...bank.corporateClients,[clientId]:{...client,drawn:num(client.drawn)+drawnDelta}};}
    if(offBalanceDelta)projected.guarantees=[...bank.guarantees,{status:'ساري',amount:offBalanceDelta}];
    const cash=num(globalThis.GH_FINANCE_CORE?.operating?.(state,'bank'))+cashDelta,metrics=prudentialMetrics(projected,cash),violations=[];
    if(!Number.isFinite(cash)||cash<0)violations.push({metric:'cash',projected:cash,minimum:0});
    for(const [metric,key] of [['lcr','minLcr'],['nsfr','minNsfr'],['cet1','minCet1']]){const minimum=Number(bank.riskPolicy[key]);if(!Number.isFinite(minimum)||minimum<=0)throw new Error(`bank-risk-policy-invalid:${key}`);if(!Number.isFinite(metrics[metric])||metrics[metric]+1e-9<minimum)violations.push({metric,projected:metrics[metric],minimum});}
    const maximum=Number(bank.riskPolicy.maxLdr);if(!Number.isFinite(maximum)||maximum<=0)throw new Error('bank-risk-policy-invalid:maxLdr');
    if(num(bank.deposits)>0&&metrics.loanDepositRatio>maximum+1e-9)violations.push({metric:'loanDepositRatio',projected:metrics.loanDepositRatio,maximum});
    let concentration={status:'not-applicable',configuredLimit:num(bank.riskPolicy.sectorConcentration)};
    const proposedSector=String(proposal.sector||'').trim();
    if(proposedSector){
      const exposures=new Map(),add=(sector,amount)=>{sector=String(sector||'').trim();amount=num(amount);if(sector&&amount>0)exposures.set(sector,(exposures.get(sector)||0)+amount);};
      for(const row of bank.loanPortfolios)if(row.status!=='مسددة')add(row.sector,row.outstanding);
      for(const row of bank.corporateFacilities)if(row.status!=='مسدد'){const client=bank.corporateClients[row.ownerCompanyId||row.company];add(row.sector||client?.sector,row.outstanding);}
      add(proposedSector,loanDelta||drawnDelta||offBalanceDelta);
      const total=[...exposures.values()].reduce((sum,value)=>sum+value,0),sectorAmount=exposures.get(proposedSector)||0,pct=total>0?sectorAmount/total*100:0,maximum=num(bank.riskPolicy.sectorConcentration);
      concentration={status:'enforced',sector:proposedSector,projected:pct,maximum,totalExposure:total};
      // A first classified exposure necessarily starts at 100%. Concentration becomes
      // an enforceable portfolio limit once there is another classified exposure to
      // diversify against; this avoids making a new bank unable to originate at all.
      if(total>sectorAmount+1e-8&&pct>maximum+1e-9)violations.push({metric:'sectorConcentration',sector:proposedSector,projected:pct,maximum});
    }else if(loanDelta||drawnDelta||offBalanceDelta)concentration={status:'not-enforced-missing-sector-classification',configuredLimit:num(bank.riskPolicy.sectorConcentration)};
    return {accepted:violations.length===0,metrics,violations,concentration};
  }
  function assertProjectedCredit(state,proposal){
    const preview=creditRiskPreview(state,proposal);if(preview.accepted)return preview;
    const labels={cash:'السيولة المتاحة',lcr:'تغطية السيولة',nsfr:'التمويل المستقر',cet1:'كفاية رأس المال',loanDepositRatio:'القروض إلى الودائع',sectorConcentration:'التركّز القطاعي'};
    const error=new Error(`رُفض التمويل: يتجاوز حدود سياسة البنك بعد التنفيذ (${preview.violations.map(row=>labels[row.metric]||row.metric).join('، ')})`);error.code='bank-projected-risk-limit';error.violations=preview.violations;throw error;
  }
  function syncCorporateClients(state,p,F){
    const bank=ensure(state),types=corporateCompanyIds(state,F);
    for(const type of types){const book=F.book(state,type),existing=bank.corporateClients[type]||{},baseValue=Math.max(5000000,num(state.groupValue)*(type==='group'?.04:.025));if(!book?.accounts?.[0])throw new Error(`bank-client-finance-book-missing:${type}`);const sector=String(companyPlatform()?.definitionFor?.(state,type)?.classification?.primarySectorId||existing.sector||'').trim()||null;bank.corporateClients[type]={company:type,ownerCompanyId:type,name:p.names?.[type]||companyPlatform()?.resolveIdentity?.(state,type)?.legalName||state.companyRegistry?.[type]?.legalName||(type==='group'?state.profile?.name:type),accountId:book.accounts[0].id,depositBalance:num(existing.depositBalance),creditLimit:num(existing.creditLimit)||Math.round(baseValue),drawn:num(existing.drawn),rating:existing.rating||(type==='group'?state.profile?.creditRating:'BBB'),sector,kyc:existing.kyc||'مكتمل',lastReview:num(existing.lastReview)};}
    return bank.corporateClients;
  }
  function openBranch(state,p={}){
    if(!(state.openedCompanies||[]).includes('bank'))throw new Error('bank-company-not-open');
    const facilityCore=globalThis.GH_FACILITY_CORE;if(!facilityCore?.verifyDirectorySite)throw new Error('facility-directory-owner-missing');
    const site=facilityCore.verifyDirectorySite(p.site||p,'bank',state),facility=(state.customHubs||[]).find(row=>row?.id===p.facilityId&&row.owned===true&&facilityOwnerCompanyId(row)==='bank'&&row.kind==='bank'&&row.sourceKey===site.key);
    if(!facility)throw new Error('bank-branch-facility-required');
    const bank=ensure(state),id=String(p.branchId||`BR-${++bank.sequence}`);if(bank.branchNetwork.some(row=>row.id===id||row.facilityId===facility.id))throw new Error('bank-branch-already-open');
    const branch=branchTemplate(state,{...p,branchId:id,facilityId:facility.id,capitalId:site.capitalId,city:site.city,country:site.country});bank.branchNetwork.push(branch);bank.branches=bank.branchNetwork.length;state.unlockedSectors=Array.isArray(state.unlockedSectors)?state.unlockedSectors:[];if(!state.unlockedSectors.includes('bank'))state.unlockedSectors.push('bank');reconcilePrudential(state);return clone(branch);
  }
  function gradeFor(p,amount,product){if(RISK_GRADES[p.riskGrade])return p.riskGrade;const collateral=clamp(p.collateralCoverage||0,0,5),borrowers=Math.max(1,Number(p.borrowers)||1),size=amount/Math.max(1,product.minimum),score=72+collateral*9-Math.log10(Math.max(1,size))*5-Math.min(12,borrowers/20);return score>=88?'AA':score>=78?'A':score>=66?'BBB':score>=54?'BB':'B';}
  function recordTransactionFee(bank,{id,at,day,amount,category,sourceId}){
    const fee=num(amount);if(fee<=0)return;const key=String(Math.max(0,Math.floor(Number(day)||0)));
    if(bank.feeEvents.some(row=>row.id===id))return;
    bank.feeEvents.unshift({id,at,day:Number(key),amount:fee,category,sourceId});bank.feeEvents=bank.feeEvents.slice(0,800);
    bank.transactionFeeByDay=bank.transactionFeeByDay&&typeof bank.transactionFeeByDay==='object'&&!Array.isArray(bank.transactionFeeByDay)?bank.transactionFeeByDay:{};
    bank.transactionFeeByDay[key]=num(bank.transactionFeeByDay[key])+fee;
    const days=Object.keys(bank.transactionFeeByDay).map(Number).filter(Number.isFinite).sort((a,b)=>b-a);for(const stale of days.slice(0+400))delete bank.transactionFeeByDay[String(stale)];
  }
  function originateLoan(state,p,F){
    const bank=ensure(state),productId=String(p.product&&PRODUCTS[p.product]?p.product:'corporate'),product=PRODUCTS[productId],branch=bank.branchNetwork.find(row=>row.id===p.branchId||row.facilityId===p.branchId)||bank.branchNetwork.find(row=>row.servicesActive);if(!branch?.servicesActive)throw new Error('bank-active-branch-required');
    const requested=num(p.amount);if(requested<=0)throw new Error('bank-loan-amount-invalid');const amount=Math.max(product.minimum,requested),operating=F.operating(state,'bank'),minimumLiquidity=Math.max(5000000,num(bank.deposits)*.12);if(operating-amount<minimumLiquidity)throw new Error('bank-liquidity-buffer');
    const projectedLdr=(num(bank.loans)+amount)/Math.max(1,num(bank.deposits))*100;if(bank.deposits>0&&projectedLdr>num(bank.riskPolicy.maxLdr))throw new Error('bank-loan-deposit-limit');
    const riskGrade=gradeFor(p,amount,product),risk=RISK_GRADES[riskGrade],collateralCoverage=clamp(p.collateralCoverage||0,0,5),lgd=clamp(risk.lgd*(collateralCoverage?Math.max(.35,1-collateralCoverage*.22):1),.08,.90),expectedLoss=amount*risk.pd*lgd,fee=Math.max(25000,Math.round(amount*.006)),cashDisbursement=amount-fee,id=`LOAN-${bank.sequence+1}`;
    const termDays=Math.max(30,Math.floor(Number(p.termDays)||product.termDays)),sector=String(p.sector||p.borrowerSector||'').trim()||null;if(!sector)throw new Error('bank-borrower-sector-required');const portfolio={id,branchId:branch.id,product:productId,name:product.name,region:`${branch.city} · ${branch.country}`,borrowers:Math.max(1,Math.floor(Number(p.borrowers)||Math.max(1,amount/product.minimum))),principal:amount,outstanding:amount,rate:Number(p.rate)||product.rate,termDays,remainingDays:termDays,sector,provisionRate:num(p.provisionRate||product.provision),rsfFactor:num(p.rsfFactor||product.rsf),originationFee:fee,originatedAt:now(state),riskGrade,pd:risk.pd,lgd,expectedLoss,collateralCoverage,stage:1,daysPastDue:0,repricingDays:Math.max(30,Math.floor(Number(p.repricingDays)||365)),status:'نشطة'};
    const provision=Math.max(amount*portfolio.provisionRate,expectedLoss);
    assertProjectedCredit(state,{cashDelta:-cashDisbursement,loanDelta:amount,provisionDelta:provision,portfolio,sector:portfolio.sector});
    const book=F.book(state,'bank');bank.sequence++;
    book.accounts[0].balance-=cashDisbursement;F.journal(state,'bank',`${id} · ${product.name}`,[{account:`محفظة قروض · ${product.name}`,debit:amount},{account:book.accounts[0].id,credit:cashDisbursement},{account:'إيراد رسوم ترتيب تمويل',credit:fee}],id);
    bank.loanPortfolios.unshift(portfolio);recordTransactionFee(bank,{id:`FEE-${id}`,at:now(state),day:Math.floor(now(state)/86400),amount:fee,category:'arrangement',sourceId:id});bank.creditDecisions.unshift({id:`CRD-${id}`,loanId:id,at:now(state),decision:'موافق',riskGrade,pd:risk.pd,lgd,expectedLoss,collateralCoverage,amount,product:productId});bank.creditDecisions=bank.creditDecisions.slice(0,300);bank.loans+=amount;bank.provisions+=provision;bank.feeIncomeYTD+=fee;bank.revenueYTD.arrangement=num(bank.revenueYTD.arrangement)+fee;branch.loans+=amount;F.reconcile(state);reconcilePrudential(state);return clone(portfolio);
  }
  function setDepositPricing(state,p){const bank=ensure(state);for(const key of Object.keys(DEPOSIT_PRODUCTS)){const value=Number(p[key]);if(Number.isFinite(value)){if(value<0||value>.20)throw new Error('bank-deposit-rate-out-of-range');bank.depositPricing[key]=value;}}bank.depositPricing.lastChangedAt=now(state);return clone(bank.depositPricing);}
  function setRiskPolicy(state,p){const bank=ensure(state),policy={...bank.riskPolicy};if(p.maxLdr!==undefined)policy.maxLdr=clamp(p.maxLdr,55,120);if(p.minLcr!==undefined)policy.minLcr=clamp(p.minLcr,100,200);if(p.minNsfr!==undefined)policy.minNsfr=clamp(p.minNsfr,100,180);if(p.minCet1!==undefined)policy.minCet1=clamp(p.minCet1,4.5,30);if(p.sectorConcentration!==undefined)policy.sectorConcentration=clamp(p.sectorConcentration,10,60);policy.lastChangedAt=now(state);bank.riskPolicy=policy;bank.riskReviews.unshift({at:now(state),type:'risk-policy',policy:clone(policy)});return clone(policy);}
  function raiseWholesaleFunding(state,p,F){
    const bank=ensure(state),amount=num(p.amount),rate=clamp(p.rate||.05,0,.30),termDays=Math.max(30,Math.floor(Number(p.termDays)||365));if(amount<=0)throw new Error('bank-wholesale-amount-invalid');const account=F.book(state,'bank').accounts[0],id=`WF-${++bank.sequence}`;account.balance+=amount;bank.wholesaleFunding+=amount;const facility={id,lender:String(p.lender||'سوق التمويل المؤسسي'),amount,outstanding:amount,rate,termDays,startDay:Math.floor(now(state)/86400),maturityDay:Math.floor(now(state)/86400)+termDays,status:'ساري'};bank.wholesaleFacilities.unshift(facility);F.journal(state,'bank',`${id} · تمويل جملة`,[{account:account.id,debit:amount},{account:'تمويل جملة مستحق',credit:amount}],id);F.reconcile(state);reconcilePrudential(state);return clone(facility);
  }
  function investLiquidity(state,p,F){
    const bank=ensure(state),amount=num(p.amount),kind=['sovereign','central-bank','covered-bond'].includes(p.kind)?p.kind:'sovereign',termDays=Math.max(30,Math.floor(Number(p.termDays)||365)),yieldRate=clamp(p.yieldRate||.035,0,.25),account=F.book(state,'bank').accounts[0],minimum=Math.max(5000000,num(bank.deposits)*.12);if(amount<=0||num(account.balance)-amount<minimum)throw new Error('bank-liquidity-buffer');
    const id=`HQLA-${++bank.sequence}`,factor=kind==='sovereign'||kind==='central-bank'?1:.85;account.balance-=amount;const security={id,kind,amount,yieldRate,termDays,hqlaFactor:factor,purchasedDay:Math.floor(now(state)/86400),maturityDay:Math.floor(now(state)/86400)+termDays,status:'ساري'};bank.treasurySecurities.unshift(security);F.journal(state,'bank',`${id} · استثمار سيولة`,[{account:'أوراق مالية عالية السيولة',debit:amount},{account:account.id,credit:amount}],id);F.reconcile(state);reconcilePrudential(state);return clone(security);
  }
  function branchServiceRevenue(branch){
    const enabled=new Set(branch.services||[]),r=num(branch.retailCustomers),b=num(branch.businessCustomers),out={accounts:0,payments:0,cards:0,merchant:0,cashManagement:0,fx:0,tradeFinance:0,retailFinance:0,businessFinance:0,projectFinance:0};
    if(enabled.has('حسابات وودائع'))out.accounts=r*.35+b*2;
    if(enabled.has('تحويلات ومدفوعات'))out.payments=r*.25+b*3;
    if(enabled.has('بطاقات'))out.cards=r*.45+b*1;
    if(enabled.has('قبول التجار ونقاط البيع'))out.merchant=r*.04+b*3;
    if(enabled.has('إدارة نقد الشركات'))out.cashManagement=b*4.5;
    if(enabled.has('صرف العملات'))out.fx=r*.08+b*2;
    if(enabled.has('تجارة دولية'))out.tradeFinance=b*5;
    if(enabled.has('تمويل أفراد'))out.retailFinance=r*.12;
    if(enabled.has('تمويل شركات'))out.businessFinance=b*4;
    if(enabled.has('تمويل مشاريع'))out.projectFinance=b*3;
    for(const key of Object.keys(out))out[key]=Math.round(out[key]);
    return out;
  }
  function sumRevenueBreakdown(out,row){for(const key of Object.keys(out))out[key]+=num(row[key]);return out;}
  function operatingCosts(state,bank=ensure(state)){
    const core=globalThis.GH_FACILITY_CORE;
    if(!core?.dailyOperatingCosts){
      if([...(state.globalBases||[]),...(state.customHubs||[])].some(row=>row?.owned===true&&facilityOwnerCompanyId(row)==='bank'))throw new Error('facility-daily-cost-owner-missing');
      const serviceOpex=bank.branchNetwork.filter(row=>row.servicesActive).length*11800;
      return {serviceOpex,facilityOpex:0,opex:serviceOpex,byFacility:Object.create(null)};
    }
    const costs=core.dailyOperatingCosts(state),serviceOpex=bank.branchNetwork.filter(row=>row.servicesActive).length*11800,facilityOpex=num(costs.byCompany.bank);
    return {serviceOpex,facilityOpex,opex:serviceOpex+facilityOpex,byFacility:costs.byFacility};
  }
  function tickDay(state,p,F){
    const bank=ensure(state),day=Math.max(0,Math.floor(Number(p.day)||Math.floor(now(state)/86400)));if(bank.lastProcessedDay===day)return bank.dailyHistory.find(row=>row.day===day)||{day,idempotent:true};
    let newDeposits=0,newRetail=0,newBusiness=0,serviceFees=0,principalRepaid=0,corporatePrincipalRepaid=0,corporateInterestIncome=0,corporateOverdue=0,securitiesMatured=0,wholesalePrincipalRepaid=0,wholesaleOverdue=0,expired=0,interestIncome=0,depositInterestExpense=0,creditLossExpense=0,securityIncome=0,wholesaleInterestExpense=0,revenueBreakdown={accounts:0,payments:0,cards:0,merchant:0,cashManagement:0,fx:0,tradeFinance:0,retailFinance:0,businessFinance:0,projectFinance:0};
    const marketRate=num(state.advanced?.economy?.depositRate||.03),pricingBoost=clamp((num(bank.depositPricing.savings)+num(bank.depositPricing.term)*.65-marketRate)*9,-.25,.35);
    for(const branch of bank.branchNetwork.filter(row=>row.servicesActive)){
      if(Number(branch.lastProcessedDay)>=day)continue;const retail=Math.max(1,Math.round(deterministic(`${branch.id}:${day}:retail`,18,65)*(1+pricingBoost))),business=Math.max(0,Math.round(deterministic(`${branch.id}:${day}:business`,1,7)*(1+pricingBoost*.6))),deposits=Math.round(retail*deterministic(`${branch.id}:${day}:rdep`,9000,26000)+business*deterministic(`${branch.id}:${day}:bdep`,180000,720000));
      branch.retailCustomers+=retail;branch.businessCustomers+=business;branch.deposits+=deposits;branch.depositMix.sight+=deposits*.45;branch.depositMix.savings+=deposits*.35;branch.depositMix.term+=deposits*.20;branch.lastProcessedDay=day;newRetail+=retail;newBusiness+=business;newDeposits+=deposits;const branchRevenue=branchServiceRevenue(branch),branchServiceFees=Object.values(branchRevenue).reduce((a,v)=>a+num(v),0);branch._dailyFeeBreakdown=branchRevenue;serviceFees+=branchServiceFees;sumRevenueBreakdown(revenueBreakdown,branchRevenue);
    }
    if(newDeposits>0){const account=F.book(state,'bank').accounts[0];account.balance+=newDeposits;F.journal(state,'bank',`ودائع عملاء جديدة · يوم ${day}`,[{account:account.id,debit:newDeposits},{account:'ودائع العملاء',credit:newDeposits}],`DEP-${day}`);bank.deposits+=newDeposits;}
    const mix=depositMix(bank);depositInterestExpense=(mix.sight*num(bank.depositPricing.sight)+mix.savings*num(bank.depositPricing.savings)+mix.term*num(bank.depositPricing.term))/365;
    for(const portfolio of bank.loanPortfolios.filter(row=>row.status==='نشطة'||row.status==='مراقبة'||row.status==='متعثرة')){
      interestIncome+=num(portfolio.outstanding)*num(portfolio.rate)/365;const defaultRoll=deterministic(`${portfolio.id}:${day}:credit`,0,1),dailyPd=num(portfolio.pd||RISK_GRADES.BBB.pd)/365;
      if(defaultRoll<dailyPd&&portfolio.stage<3){portfolio.stage=portfolio.stage===1?2:3;portfolio.daysPastDue=portfolio.stage===2?30:90;portfolio.status=portfolio.stage===3?'متعثرة':'مراقبة';bank.delinquencyEvents.unshift({id:`DLQ-${portfolio.id}-${day}`,loanId:portfolio.id,day,stage:portfolio.stage,outstanding:num(portfolio.outstanding)});}
      const loss=num(portfolio.outstanding)*num(portfolio.pd||RISK_GRADES.BBB.pd)*num(portfolio.lgd||.35)/365*(portfolio.stage===3?3:portfolio.stage===2?1.8:1);creditLossExpense+=loss;if(portfolio.stage===3)continue;
      const due=Math.min(num(portfolio.outstanding),num(portfolio.principal)/Math.max(1,Number(portfolio.termDays)||1));if(due>0){portfolio.outstanding=Math.max(0,num(portfolio.outstanding)-due);portfolio.remainingDays=Math.max(0,Number(portfolio.remainingDays)-1);principalRepaid+=due;const branch=bank.branchNetwork.find(row=>row.id===portfolio.branchId);if(branch)branch.loans=Math.max(0,num(branch.loans)-due);if(portfolio.outstanding<=.01)portfolio.status='مسددة';}
    }
    if(principalRepaid>0){const account=F.book(state,'bank').accounts[0];account.balance+=principalRepaid;F.journal(state,'bank',`تحصيل أصول قروض · يوم ${day}`,[{account:account.id,debit:principalRepaid},{account:'محفظة القروض',credit:principalRepaid}],`LOAN-PRINCIPAL-${day}`);bank.loans=Math.max(0,bank.loans-principalRepaid);}
    for(const facility of bank.corporateFacilities.filter(row=>row.status==='ساري'||row.status==='متأخر')){
      if(Number(facility.lastProcessedDay)>=day)continue;const company=String(facility.ownerCompanyId||facility.company||'').trim();if(!isOperationalFinanceCompany(state,company,F))throw new Error(`bank-facility-company-invalid:${company||'missing'}`);const client=bank.corporateClients[company],outstanding=num(facility.outstanding);if(!client)throw new Error(`bank-client-not-synced:${company}`);if(outstanding<=.01){facility.outstanding=0;facility.status='مسدد';continue;}
      const dailyInterest=outstanding*num(facility.rate)/365,principalDue=Math.min(outstanding,num(facility.originalAmount)/Math.max(1,Number(facility.termDays)||1)+num(facility.principalArrears)),interestDue=dailyInterest+num(facility.interestArrears),totalDue=principalDue+interestDue,borrowerCash=F.operating(state,company);
      if(totalDue>0&&borrowerCash+1e-8>=totalDue){if(principalDue>0){F.execute({state},'transfer',{from:company,to:'bank',amount:principalDue,note:`سداد أصل تسهيل ائتماني · ${facility.id}`,ref:`CF-PRINCIPAL-${facility.id}-${day}`});F.book(state,company).debt=Math.max(0,num(F.book(state,company).debt)-principalDue);facility.outstanding=Math.max(0,outstanding-principalDue);client.drawn=Math.max(0,num(client.drawn)-principalDue);bank.loans=Math.max(0,num(bank.loans)-principalDue);corporatePrincipalRepaid+=principalDue;}if(interestDue>0){const settlement=F.execute({state},'settle-intercompany-interest',{from:company,to:'bank',amount:interestDue,note:`فائدة تسهيل ائتماني · ${facility.id}`,ref:`CF-INTEREST-${facility.id}-${day}`});corporateInterestIncome+=num(settlement.cashPostedRevenue);}facility.principalArrears=0;facility.interestArrears=0;facility.status=facility.outstanding<=.01?'مسدد':'ساري';if(facility.status==='مسدد')facility.repaidDay=day;}else{facility.principalArrears=principalDue;facility.interestArrears=interestDue;facility.status='متأخر';facility.overdueSinceDay=Number(facility.overdueSinceDay)||day;facility.daysPastDue=Math.max(1,day-facility.overdueSinceDay+1);corporateOverdue+=totalDue;}facility.lastProcessedDay=day;facility.remainingDays=Math.max(0,Number(facility.maturityDay)-day);
    }
    interestIncome+=corporateInterestIncome;principalRepaid+=corporatePrincipalRepaid;
    const bankAccount=F.book(state,'bank').accounts[0];
    for(const security of bank.treasurySecurities.filter(row=>row.status==='ساري')){
      securityIncome+=num(security.amount)*num(security.yieldRate)/365;
      if(day<Number(security.maturityDay))continue;
      const principal=num(security.amount);if(principal>0){bankAccount.balance+=principal;F.journal(state,'bank',`استرداد أصل ورقة مالية · ${security.id}`,[{account:bankAccount.id,debit:principal},{account:'أوراق مالية عالية السيولة',credit:principal}],`MATURITY-${security.id}`);securitiesMatured+=principal;}
      security.status='مستردة';security.maturedDay=day;security.redemptionAmount=principal;
    }
    for(const facility of bank.wholesaleFacilities.filter(row=>row.status==='ساري'||row.status==='متأخر')){
      const outstanding=num(facility.outstanding);if(outstanding<=0){facility.status='مسدد';continue;}
      wholesaleInterestExpense+=outstanding*num(facility.rate)/365;if(day<Number(facility.maturityDay))continue;
      if(num(bankAccount.balance)+1e-8>=outstanding){bankAccount.balance-=outstanding;F.journal(state,'bank',`سداد أصل تمويل جملة · ${facility.id}`,[{account:'تمويل جملة مستحق',debit:outstanding},{account:bankAccount.id,credit:outstanding}],`REPAY-${facility.id}`);facility.outstanding=0;facility.status='مسدد';facility.repaidDay=day;wholesalePrincipalRepaid+=outstanding;bank.wholesaleFunding=Math.max(0,num(bank.wholesaleFunding)-outstanding);}
      else{facility.status='متأخر';facility.overdueSinceDay=Number(facility.overdueSinceDay)||day;facility.daysPastDue=Math.max(1,day-facility.overdueSinceDay+1);wholesaleOverdue+=outstanding;}
    }
    for(const instrument of [...bank.lettersOfCredit,...bank.guarantees])if(instrument.status==='ساري'&&Number(instrument.expiryDay||Infinity)<=day){instrument.status='منتهي';instrument.expiredDay=day;expired++;}
    bank.retailCustomers=bank.branchNetwork.reduce((sum,row)=>sum+num(row.retailCustomers),0);bank.businessCustomers=bank.branchNetwork.reduce((sum,row)=>sum+num(row.businessCustomers),0);bank.dailyServiceFeeRevenue=serviceFees;bank.lastProcessedDay=day;bank.interestIncomeYTD+=interestIncome+securityIncome;bank.depositInterestExpenseYTD+=depositInterestExpense+wholesaleInterestExpense;bank.creditLossExpenseYTD+=creditLossExpense;bank.provisions+=creditLossExpense;bank.feeIncomeYTD+=serviceFees;for(const [key,value] of Object.entries(revenueBreakdown))bank.revenueYTD[key]=num(bank.revenueYTD[key])+num(value);bank.revenueYTD.treasury=num(bank.revenueYTD.treasury)+num(securityIncome);
    const nplAmount=bank.loanPortfolios.filter(row=>row.stage===3&&row.status!=='مسددة').reduce((sum,row)=>sum+num(row.outstanding),0);bank.npl=bank.loans?nplAmount/bank.loans*100:0;const costSnapshot=operatingCosts(state,bank),serviceOpex=costSnapshot.serviceOpex,facilityOpex=costSnapshot.facilityOpex,opex=costSnapshot.opex,feeIncome=serviceFees,transactionFeeIncome=num(bank.transactionFeeByDay?.[String(day)]),reportedFeeIncome=feeIncome+transactionFeeIncome,netBankingIncome=interestIncome+securityIncome+reportedFeeIncome-depositInterestExpense-wholesaleInterestExpense-creditLossExpense-opex;bank.netBankingIncomeYTD+=netBankingIncome;
    for(const branch of bank.branchNetwork){const loanShare=bank.loans?num(branch.loans)/bank.loans:1/Math.max(1,bank.branchNetwork.length),depositShare=bank.deposits?num(branch.deposits)/bank.deposits:1/Math.max(1,bank.branchNetwork.length),branchInterest=interestIncome*loanShare,branchFees=feeIncome*(num(branch.retailCustomers)+num(branch.businessCustomers)*8)/Math.max(1,bank.retailCustomers+bank.businessCustomers*8),branchExpense=depositInterestExpense*depositShare,branchLoss=creditLossExpense*loanShare,branchServiceOpex=branch.servicesActive?11800:0,facilityCost=costSnapshot.byFacility[branch.facilityId],branchFacilityOpex=facilityCost?.ownerCompanyId==='bank'?num(facilityCost.amount):0,branchOpex=branchServiceOpex+branchFacilityOpex;const ownBreakdown=branch._dailyFeeBreakdown||branchServiceRevenue(branch),ownFees=Object.values(ownBreakdown).reduce((a,v)=>a+num(v),0);branch.incomeStatement={interestIncome:branchInterest,feeIncome:ownFees,feeBreakdown:{...ownBreakdown},interestExpense:branchExpense,creditLossExpense:branchLoss,opex:branchOpex,serviceOpex:branchServiceOpex,facilityOpex:branchFacilityOpex,net:branchInterest+ownFees-branchExpense-branchLoss-branchOpex};delete branch._dailyFeeBreakdown;}
    const cashPostedInterestIncome=corporateInterestIncome,unpostedInterestIncome=Math.max(0,interestIncome-cashPostedInterestIncome);
    F.reconcile(state);reconcilePrudential(state);const report={day,newDeposits,newRetail,newBusiness,serviceFees,feeIncome,transactionFeeIncome,reportedFeeIncome,revenueBreakdown:{...revenueBreakdown},principalRepaid,corporatePrincipalRepaid,corporateInterestIncome,cashPostedInterestIncome,unpostedInterestIncome,corporateOverdue,securitiesMatured,wholesalePrincipalRepaid,wholesaleOverdue,expired,customers:bank.retailCustomers+bank.businessCustomers,interestIncome,securityIncome,depositInterestExpense,wholesaleInterestExpense,creditLossExpense,opex,serviceOpex,facilityOpex,netBankingIncome,lcr:bank.lcr,nsfr:bank.nsfr,cet1:bank.cet1,npl:bank.npl};bank.dailyHistory.unshift(report);bank.dailyHistory=bank.dailyHistory.slice(0,400);return clone(report);
  }
  // Called only through the existing company operations provider. Keep the
  // domain command inside the caller's atomic time/day boundary transaction.
  function onFinancialDay(ctx,p={}){
    const platform=globalThis.GH_COMPANY_PLATFORM,commands=globalThis.GH_DOMAIN_COMMANDS;
    if(!platform?.requireCompany||!commands?.dispatchSystem)throw new Error('company-daily-owner-unavailable');
    const company=platform.requireCompany(ctx.state,ctx.companyId,{registered:true,operational:true,capability:'operations.bank'});
    return commands.dispatchSystem({state:ctx.state},'banking','tick-day',{...p,ownerCompanyId:company.id},{actor:'simulation-scheduler'}).result;
  }
  function statementAdjustments(state,companyId){
    const bank=ensure(state),id=String(companyId||'');
    if(id==='bank'){
      const securities=bank.treasurySecurities.filter(row=>row.status==='ساري').reduce((sum,row)=>sum+num(row.amount),0);
      return {assets:num(bank.loans)+securities,liabilities:num(bank.deposits)+num(bank.wholesaleFunding),bankLoans:num(bank.loans),bankSecurities:securities,customerDeposits:num(bank.deposits),wholesaleFunding:num(bank.wholesaleFunding)};
    }
    const client=bank.corporateClients?.[id],depositAsset=client?num(client.depositBalance):0;
    return {assets:depositAsset,liabilities:0,bankDepositAsset:depositAsset};
  }
  function intercompanyBalanceEliminations(state){
    const bank=ensure(state),depositBalances=Object.values(bank.corporateClients||{}).reduce((sum,row)=>sum+num(row?.depositBalance),0),corporateLoans=(bank.corporateFacilities||[]).filter(row=>row.status!=='مسدد').reduce((sum,row)=>sum+num(row.outstanding),0);
    return {assets:depositBalances+corporateLoans,liabilities:depositBalances+corporateLoans,deposits:depositBalances,loans:corporateLoans};
  }
  function execute(ctx,cmd,p={}){
    const state=ctx.state||ctx,F=globalThis.GH_FINANCE_CORE,bank=ensure(state);if(!F)throw new Error('finance-core-missing');
    if(cmd==='sync-corporate-clients')return syncCorporateClients(state,p,F);
    if(cmd==='set-deposit-pricing')return setDepositPricing(state,p);
    if(cmd==='set-risk-policy')return setRiskPolicy(state,p);
    if(cmd==='raise-wholesale-funding')return raiseWholesaleFunding(state,p,F);
    if(cmd==='invest-liquidity')return investLiquidity(state,p,F);
    if(cmd==='review-limits'){for(const client of Object.values(bank.corporateClients)){const type=String(client.ownerCompanyId||client.company||'');if(!isOperationalFinanceCompany(state,type,F))continue;const assets=(state.assets||[]).filter(asset=>assetOwnerCompanyId(asset)===type).reduce((sum,asset)=>sum+num(asset.purchasePrice)*.55,0),cash=F.total(state,type),book=F.book(state,type),debt=num(book?.debt),base=Math.max(5000000,cash*.35+assets*.12-debt*.08);if(!book)throw new Error(`bank-client-finance-book-missing:${type}`);client.ownerCompanyId=type;client.creditLimit=Math.max(5000000,Math.round(base/100000)*100000);client.lastReview=now(state);client.rating=debt>cash*2?'BB':cash>debt?'A-':'BBB';}bank.riskReviews.unshift({at:now(state),type:'corporate-limits',clients:Object.keys(bank.corporateClients).length});bank.riskReviews=bank.riskReviews.slice(0,80);return true;}
    if(cmd==='draw-facility'){const type=String(p.ownerCompanyId||p.company||'').trim();if(!isOperationalFinanceCompany(state,type,F)||companyPlatform()?.hasCapability?.(state,type,'operations.bank'))throw new Error('invalid-company');const client=bank.corporateClients[type];if(!client)throw new Error('bank-client-not-synced');const amount=Math.min(num(p.amount),Math.max(0,num(client.creditLimit)-num(client.drawn)));if(amount<=0||F.operating(state,'bank')<amount)throw new Error('facility-unavailable');const fee=Math.max(25000,amount*.0035),termDays=Math.max(30,Math.floor(Number(p.termDays)||365)),rate=clamp(p.rate||.06,0,.30),startDay=Math.floor(now(state)/86400),id=`CF-${bank.sequence+1}`;if(F.operating(state,type)+amount<fee)throw new Error('borrower-fee-unavailable');const sector=String(client.sector||companyPlatform()?.definitionFor?.(state,type)?.classification?.primarySectorId||'').trim()||null;assertProjectedCredit(state,{cashDelta:fee-amount,loanDelta:amount,drawnDelta:amount,clientId:type,sector});bank.sequence++;F.execute({state},'transfer',{from:'bank',to:type,amount,note:`سحب تسهيل ائتماني من بنك المجموعة · ${id}`,ref:id});F.execute({state},'spend',{company:type,amount:fee,note:'رسوم ترتيب تسهيل ائتماني مستحقة لبنك المجموعة',method:'قيد مصرفي',taxable:false,counterparty:'بنك المجموعة',line:'other'});F.execute({state},'credit',{company:'bank',amount:fee,note:`رسوم ترتيب تسهيل ائتماني · ${type}`,method:'قيد مصرفي',taxable:false,counterparty:type});client.drawn+=amount;bank.loans+=amount;bank.feeIncomeYTD+=fee;recordTransactionFee(bank,{id:`FEE-${id}`,at:now(state),day:startDay,amount:fee,category:'corporateFacility',sourceId:id});F.book(state,type).debt+=amount;bank.corporateFacilities.unshift({id,company:type,ownerCompanyId:type,sector,amount,originalAmount:amount,outstanding:amount,principalArrears:0,interestArrears:0,rate,termDays,startDay,lastProcessedDay:startDay,maturityDay:startDay+termDays,remainingDays:termDays,status:'ساري'});reconcilePrudential(state);return amount;}
    if(cmd==='trade-instrument'){const type=String(p.ownerCompanyId||p.company||'').trim(),kind=p.kind==='lc'?'lc':'guarantee',amount=Math.max(100000,num(p.amount)),client=isOperationalFinanceCompany(state,type,F)?bank.corporateClients[type]:null;if(!client||amount>Math.max(0,num(client.creditLimit)-num(client.drawn)))throw new Error('credit-headroom');const fee=Math.max(15000,Math.round(amount*(kind==='lc'?.006:.004)));const sector=String(client.sector||companyPlatform()?.definitionFor?.(state,type)?.classification?.primarySectorId||'').trim()||null;assertProjectedCredit(state,{cashDelta:fee,offBalanceDelta:amount,sector});F.execute({state},'spend',{company:type,amount:fee,note:kind==='lc'?'رسوم اعتماد مستندي':'رسوم ضمان مصرفي',method:'قيد مصرفي',counterparty:'بنك المجموعة'});F.execute({state},'credit',{company:'bank',amount:fee,note:`رسوم ${kind==='lc'?'اعتماد مستندي':'ضمان'}`,method:'قيد مصرفي',counterparty:type});bank.feeIncomeYTD+=fee;const feeSourceId=`${kind==='lc'?'LC':'GTEE'}-${Math.floor(now(state))}-${bank.lettersOfCredit.length+bank.guarantees.length+1}`;recordTransactionFee(bank,{id:`FEE-${feeSourceId}`,at:now(state),day:Math.floor(now(state)/86400),amount:fee,category:'tradeFinance',sourceId:feeSourceId});bank.revenueYTD.tradeFinance=num(bank.revenueYTD.tradeFinance)+fee;bank.offBalance+=amount;const document={id:feeSourceId,company:type,ownerCompanyId:type,amount,fee,status:'ساري',issuedAt:now(state),expiryDay:Math.floor(now(state)/86400)+90,counterparty:String(p.counterparty||companyPlatform()?.resolveIdentity?.(state,type)?.legalName||state.companyRegistry?.[type]?.legalName||bank.corporateClients?.[type]?.name||'الجهة المستفيدة')};(kind==='lc'?bank.lettersOfCredit:bank.guarantees).unshift(document);reconcilePrudential(state);return document;}
    if(cmd==='cash-sweep'){let total=0;for(const type of corporateCompanyIds(state,F).filter(id=>id!=='group')){const client=bank.corporateClients[type];if(!client)throw new Error(`bank-client-not-synced:${type}`);const balance=F.operating(state,type),floor=Math.max(5000000,balance*.65),amount=Math.max(0,Math.floor((balance-floor)/100000)*100000);if(amount<500000)continue;F.execute({state},'transfer',{from:type,to:'bank',amount,note:'Cash sweep يومي إلى بنك المجموعة'});client.depositBalance+=amount;bank.deposits+=amount;total+=amount;}bank.cashSweeps.unshift({at:now(state),amount:total});bank.cashSweeps=bank.cashSweeps.slice(0,60);reconcilePrudential(state);return total;}
    if(cmd==='open-branch')return openBranch(state,p);
    if(cmd==='activate-market'){const branch=bank.branchNetwork.find(row=>row.id===p.branchId||row.facilityId===p.branchId);if(!branch)throw new Error('bank-branch-not-found');branch.servicesActive=true;branch.activatedAt=now(state);return clone(branch);}
    if(cmd==='set-branch-services'){const branch=bank.branchNetwork.find(row=>row.id===p.branchId||row.facilityId===p.branchId);if(!branch)throw new Error('bank-branch-not-found');branch.servicesActive=p.servicesActive!==false;if(Array.isArray(p.services)&&p.services.length)branch.services=[...new Set(p.services.map(String))];branch.serviceModel=p.serviceModel||branch.serviceModel;return clone(branch);}
    if(cmd==='originate-loan'||cmd==='issue-loans'||cmd==='fund-loan-portfolio')return originateLoan(state,{...p,product:p.product||'corporate'},F);
    if(cmd==='tick-day')return tickDay(state,p,F);
    if(cmd==='stress'){const withdrawalRate=clamp(p.withdrawalRate||.12,0,.60),nplShock=clamp(p.nplShock||2.5,0,25),rateShock=clamp(p.rateShock||.02,0,.15);state.advanced=state.advanced||{};state.advanced.bankStress={at:now(state),scenario:p.scenario||'صدمة مركبة',npl:Math.min(100,num(bank.npl)+nplShock),withdrawal:num(bank.deposits)*withdrawalRate,depositsAfter:num(bank.deposits)*(1-withdrawalRate),capitalRatio:Math.max(0,num(bank.cet1||bank.capitalRatio||16.4)-nplShock*1.24),rateShock,lcrAfter:clamp((num(bank.hqla)-num(bank.deposits)*withdrawalRate)/Math.max(1,num(bank.stressedOutflows))*100,0,500)};return state.advanced.bankStress;}
    throw new Error(`Unknown banking command: ${cmd}`);
  }
  const API={VERSION,DAILY_FINANCIAL_ORDER:100,onFinancialDay,PRODUCTS,DEPOSIT_PRODUCTS,RISK_GRADES,ensure,migrateLegacyBranches,execute,reconcilePrudential,creditRiskPreview,dormant,operatingCosts,statementAdjustments,intercompanyBalanceEliminations};globalThis.GH_BANKING_CORE=API;globalThis.GH_DOMAIN_COMMANDS?.register?.('banking',API);if(globalThis.window&&window!==globalThis)window.GH_BANKING_CORE=API;if(typeof module!=='undefined'&&module.exports)module.exports=API;
})();

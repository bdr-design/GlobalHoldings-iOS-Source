(() => {
  'use strict';
  const VERSION='3.0.0';
  const SCHEMA='2.0.0';
  const LEGACY_TYPES=['group','air','sea','road','power','bank','mobility'];
  const SECTORS=['air','sea','road','power','bank'];
  const names={group:'المجموعة',air:'الطيران',sea:'البحرية',road:'اللوجستيات',power:'الطاقة',bank:'البنك',mobility:'التنقل الذكي'};
  const clamp=(n,a,b)=>Math.max(a,Math.min(b,Number(n)||0));
  const fleetData=()=>{const api=globalThis.GH_FLEET_DATA||(typeof require==='function'?require('./fleet-access-core.js'):null);if(!api)throw new Error('fleet-data-access-unavailable');return api;};
  const money=n=>{n=Number(n)||0;const s=n<0?'-':'';n=Math.abs(n);return s+'$'+(n>=1e9?(n/1e9).toFixed(2)+'B':n>=1e6?(n/1e6).toFixed(1)+'M':n>=1e3?(n/1e3).toFixed(1)+'K':Math.round(n));};
  const esc=v=>String(v??'').replace(/[&<>\"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
  const hash=s=>{let h=2166136261>>>0;for(let i=0;i<String(s).length;i++){h^=String(s).charCodeAt(i);h=Math.imul(h,16777619);}return h>>>0;};
  const rand=(seed,min=0,max=1)=>{let x=hash(seed);x^=x<<13;x^=x>>>17;x^=x<<5;return min+((x>>>0)/4294967295)*(max-min);};
  const platform=()=>globalThis.GH_COMPANY_PLATFORM||null;
  const assetMode=asset=>String(asset?.assetMode||asset?.type||'').trim();
  function assetOwnerCompanyId(state,asset){
    const explicit=String(asset?.ownerCompanyId||asset?.companyId||'').trim();if(explicit)return explicit;
    const P=platform(),company=String(asset?.company||'').trim();if(company&&P?.resolveCompany?.(state,company)?.known)return company;
    return String(P?.ownerForLegacyAssetMode?.(assetMode(asset))||(!P?assetMode(asset):'')).trim();
  }
  function rowCompanyId(state,row,fallback='group'){
    const explicit=String(row?.ownerCompanyId||row?.companyId||row?.company||'').trim();if(!explicit)return fallback;
    const P=platform();return !P||P.resolveCompany?.(state,explicit)?.known?explicit:'';
  }
  function companyTypes(state){
    const P=platform();
    if(P?.listInstances)return P.listInstances(state,{openedOnly:true,capability:'finance.book'}).filter(company=>company.operational&&state.companyFinance?.[company.id]).map(company=>company.id);
    return LEGACY_TYPES.filter(type=>state.companyFinance?.[type]);
  }
  function sectorOfCompany(state,companyId){return platform()?.definitionFor?.(state,companyId)?.classification?.primarySectorId||companyId;}
  function companyLabel(state,companyId){return platform()?.resolveIdentity?.(state,companyId)?.legalName||state.companyRegistry?.[companyId]?.legalName||names[companyId]||companyId;}
  function operationalCompanyForCapability(state,capability){const P=platform();if(!P?.listInstances)return null;return P.listInstances(state,{includeGroup:false,openedOnly:true,capability}).find(company=>company.operational&&state.companyFinance?.[company.id])?.id||null;}
  const defaultBudget=()=>({period:0,lines:{payroll:0,fuel:0,maintenance:0,marketing:0,insurance:0,technology:0,capex:0,other:0},actual:{payroll:0,fuel:0,maintenance:0,marketing:0,insurance:0,technology:0,capex:0,other:0},forecast:{},variance:{}});
  const initial=()=>({
    schema:SCHEMA,version:VERSION,migratedAt:0,
    economy:{oil:78,jetFuel:0.86,bunker:640,diesel:0.98,electricity:72,gas:39,carbon:52,freight:100,baseRate:.046,usdIndex:100,airDemand:100,seaDemand:100,roadDemand:100,powerDemand:100,lastEvent:null,eventHistory:[],wageIndex:1},
    markets:{history:[],hedges:[]},crews:{},
    financial:{statements:{},consolidated:{},intercompanyEliminations:0,lastCloseDay:0},
    budgets:Object.fromEntries(LEGACY_TYPES.map(t=>[t,defaultBudget()])),
    aviation:{ask:0,rpk:0,loadFactor:0,yield:0,rask:0,cask:0,caskExFuel:0,otp:92,technicalDelayRate:1.8,maintenanceDue:0,aog:0,dispatchReliability:98,utilization:0,avgCondition:100,maintenanceReserveCoverage:100,healthMonitoringScore:80},
    maritime:{utilization:0,cii:'B',eexi:'Compliant',waitingHours:0,demurrage:0,dryDockDue:0,avgBunkerCost:0,attainedCii:0,requiredCii:1,ciiRatio:1,correctiveAction:false,correctivePlanStatus:'غير مطلوب',consecutiveD:0,lastCiiYear:-1,ciiHistory:[],eexiReadiness:100,fuelIntensity:0},
    logistics:{onTime:94,damageRate:.7,emptyMiles:18,warehouseUtilization:0,orderCycleHours:27,customsHours:9,throughput:0,customsScore:4,shipmentScore:4,trackingScore:4,infrastructureScore:4,serviceScore:4,timelinessScore:4,lpiProxy:4,networkBalance:80},
    energy:{storageSoc:55,roundTripEfficiency:86,degradation:1,cycles:0,capacityFactor:0,curtailment:2,ppaShare:55,spotShare:45,storageHealth:99,effectiveStorageMWh:0,availableMW:0,reserveMargin:0,renewableShare:0,storageThroughputMWh:0,roundTripLossMWh:0},
    banking:{cet1:14,tier1:15,totalCapital:17,rwa:0,lcr:120,nsfr:112,npl:1.9,costOfRisk:1.1,loanDeposit:0,hqla:0,cet1RegMin:4.5,tier1RegMin:6,totalCapitalRegMin:8,capitalConservationBuffer:2.5,cet1Headroom:0,lcrHeadroom:0,nsfrHeadroom:0,provisionCoverage:100,stableFundingBuffer:0,distributionRestricted:false},
    market:{share:{air:8,sea:6,road:7,power:4,bank:3},competitorPressure:{air:50,sea:50,road:50,power:50,bank:50},routeShares:{},lastResponseDay:0},
    reputation:{group:70,air:72,sea:70,road:71,power:73,bank:74},
    risk:{limits:{netDebtEbitda:3,minLiquidity:50000000,maxFxExposure:.20,maxCountryExposure:.30,maxCustomerExposure:.15,minBankCapital:13,minLcr:100},register:[],lastReviewDay:0},
    board:{meetings:[],resolutions:[],nextMeetingDay:30},
    procurement:{pipeline:[],deliveries:[],pendingDeliveryCount:null,leadTimes:{air:120,sea:210,road:21,power:365,bank:45},supplierScores:{}},
    projects:[],insurance:{renewalIndex:100,claimsTrend:0},
    taxFx:{fxExposure:0,taxRate:.15},rating:{grade:'BBB',outlook:'Stable',score:62},dividends:{history:[],available:0},
    people:{succession:{},executiveScore:75},morningBriefs:[],eventQueue:[],controls:{lastIntegrityDay:0,issues:[]}
  });
  function deepDefaults(target,defs){for(const [k,v] of Object.entries(defs)){if(target[k]===undefined)target[k]=typeof structuredClone==='function'?structuredClone(v):JSON.parse(JSON.stringify(v));else if(v&&typeof v==='object'&&!Array.isArray(v)&&target[k]&&typeof target[k]==='object'&&!Array.isArray(target[k]))deepDefaults(target[k],v);}return target;}
  // Runtime index only: saved counters are never trusted on first observation.
  // Publication/restore explicitly reconciles; no WeakMap state is serialized.
  const pendingDeliveryIndexes=new WeakMap();
  function reconcilePendingDeliveryCount(state,force=false){
    const procurement=state.realism?.procurement;if(!procurement)return 0;
    const deliveries=procurement.deliveries||[],cached=pendingDeliveryIndexes.get(procurement);
    if(force||!cached||cached.deliveries!==deliveries||cached.length!==deliveries.length||cached.count!==procurement.pendingDeliveryCount||!Number.isInteger(procurement.pendingDeliveryCount)||procurement.pendingDeliveryCount<0){
      procurement.pendingDeliveryCount=deliveries.reduce((n,row)=>n+(row?.status==='pending'?1:0),0);
      pendingDeliveryIndexes.set(procurement,{deliveries,length:deliveries.length,count:procurement.pendingDeliveryCount});
    }
    return procurement.pendingDeliveryCount;
  }
  // Pure admission probe for the simulation owner. The saved counter is
  // reconciled on restore/migrate and maintained by procurement/delivery owners.
  // If a malformed legacy state reaches this point, fail safe by scanning only
  // that invalid state instead of mutating it outside the simulation transaction.
  function hasPendingDeliveries(state){
    const procurement=state.realism?.procurement;if(!procurement)return false;
    const count=Number(procurement.pendingDeliveryCount);
    if(Number.isInteger(count)&&count>=0)return count>0;
    return (Array.isArray(procurement.deliveries)?procurement.deliveries:[]).some(row=>row?.status==='pending');
  }
  // Calendar advance may use wider atomic slices only when this owner has no
  // sub-hour delivery work. 600 seconds preserves the pre-fix delivery polling
  // ceiling without forcing that cost on fleets with no pending deliveries.
  // Build 358: the earliest due time of a pending delivery (-Infinity for a row whose clock is not normalized yet, so
  // it is handled at once; Infinity when none is pending). A slice that ends before it cannot deliver anything, so it
  // needs neither the delivery scope (a full copy of finance per slice on iPhone) nor 600-second slices.
  function nextDeliveryDueAt(state){
    if(!hasPendingDeliveries(state))return Infinity;let next=Infinity;
    for(const row of state.realism.procurement.deliveries||[]){if(row?.status!=='pending')continue;const due=Number(row.dueAtSeconds);if(!Number.isFinite(due))return -Infinity;if(due<next)next=due;}
    return next;
  }
  function deliveryDueBy(state,seconds){return nextDeliveryDueAt(state)<=Number(seconds);}
  function simulationSliceLimit(state){const next=nextDeliveryDueAt(state);return next-(Math.max(0,Number(state.simSeconds)||0))>3600?3600:600;}
  function migrate(state){
    state.realism=state.realism&&typeof state.realism==='object'?state.realism:initial();deepDefaults(state.realism,initial());
    const r=state.realism;r.schema=SCHEMA;r.version=VERSION;delete r[String.fromCharCode(97,105)];reconcilePendingDeliveryCount(state);for(const companyId of companyTypes(state))if(!r.budgets[companyId])r.budgets[companyId]=defaultBudget();
    if(!r.migratedAt){r.migratedAt=Number(state.simSeconds)||0;r.controls.issues=[];}
    normalizeEventQueue(state);return r;
  }
  function normalizeEventQueue(state){const q=state.realism.eventQueue;if(!Array.isArray(q))state.realism.eventQueue=[];else{const seen=new Set();state.realism.eventQueue=q.filter(x=>x&&x.id&&!seen.has(x.id)&&(seen.add(x.id),true)).sort((a,b)=>(a.at||0)-(b.at||0));}}
  function entityName(state,t){return t==='group'?(state.profile?.name||'المجموعة'):companyLabel(state,t);}
  function books(state,t){return state.companyFinance?.[t]||null;}
  function cash(state,t){const b=books(state,t);return (b?.accounts||[]).reduce((n,a)=>n+(Number(a.balance)||0),0);}
  // Build 358: the daily close reads each company's statements three times (close, budget actuals, budget base) and
  // scanned the whole fleet five times per company. Between closeFinancials() and the end of updateBudgets() nothing
  // they read is written (only realism.financial and realism.budgets change), so inside that window the fleet is grouped
  // by owner once and each company's statements are computed once. Outside it everything is computed as before.
  let closeMemo=null;
  // Build 358 (million-asset): what the statements, budgets and insured value read from a company's assets, for every
  // owner in one read-only pass in row order (GH_FLEET_DATA.scan, no view per asset): each owner's sums run in the
  // order its asset list had, so the results are the same. Kept while the fleet (revision), the simulated time and the
  // owner each class of rows resolves to are unchanged; the staged daily close computes it in slices first.
  const OWNER_TOTAL_FIELDS=Object.freeze(['ownerCompanyId','companyId','company','assetMode','type','purchasePrice','condition','ownership','monthlyLease','leaseTermMonths','leaseStartSeconds','deliveredAtSeconds','year','lastTrip','staffing']);
  const OWNER_FIELDS=Object.freeze(['ownerCompanyId','companyId','company','assetMode','type']);
  const USEFUL_YEARS=Object.freeze({air:20,sea:25,road:8,power:25,bank:12,group:20}),SALVAGE_PCT=Object.freeze({air:.12,sea:.15,road:.08,power:.10,bank:.05,group:.05});
  const EMPTY_OWNER_TOTALS=Object.freeze({assetVal:0,depr:0,leaseLiab:0,rou:0,leaseInterest:0,owned:0,fuelCost:0,maintReserve:0,payroll:0});
  let ownerTotalsMemo=null;
  function ownersFingerprint(state){const pairs=[];fleetData().forEachFieldClasses(state,OWNER_FIELDS,row=>{pairs.push([row.ownerCompanyId,row.companyId,row.company,row.assetMode,row.type,assetOwnerCompanyId(state,row)]);});return JSON.stringify(pairs);}
  function ownerTotalsKey(state){const fleet=fleetData(),revision=fleet.revision(state);return revision===null?null:{fleet:state.fleet,revision,simSeconds:Math.max(0,Number(state.simSeconds)||0),owners:ownersFingerprint(state)};}
  const sameOwnerTotalsKey=(a,b)=>!!a&&!!b&&a.fleet===b.fleet&&a.revision===b.revision&&a.simSeconds===b.simSeconds&&a.owners===b.owners;
  // The owner totals of one pass: visit(row) per asset in row order; totals per owner id.
  function ownerTotalsVisitor(state){
    const totals=new Map(),simSeconds=Math.max(0,Number(state.simSeconds)||0),simYear=2026+Math.floor(simSeconds/(365*86400)),monthlyRate=Math.pow(1.07,1/12)-1,owners=new Map();
    const visit=a=>{
      const ownerKey=`${a.ownerCompanyId}\u0000${a.companyId}\u0000${a.company}\u0000${a.assetMode}\u0000${a.type}`;let t=owners.get(ownerKey);if(t===undefined){t=assetOwnerCompanyId(state,a);owners.set(ownerKey,t);}
      let acc=totals.get(t);if(!acc){acc={assetVal:0,depr:0,leaseLiab:0,rou:0,leaseInterest:0,owned:0,fuelCost:0,maintReserve:0,payroll:0};totals.set(t,acc);}
      const price=Math.max(0,Number(a.purchasePrice)||0),condition=clamp(Number(a.condition)||100,0,100);
      if(a.ownership==='lease'){
        const monthly=Math.max(0,Number(a.monthlyLease)||0),term=Math.max(12,Number(a.leaseTermMonths)||60),start=Math.max(0,Number(a.leaseStartSeconds)||Number(a.deliveredAtSeconds)||simSeconds),elapsed=Math.min(term,Math.max(0,Math.floor((simSeconds-start)/(30*86400)))),remaining=Math.max(0,term-elapsed);
        const pv=monthlyRate?monthly*(1-Math.pow(1+monthlyRate,-remaining))/monthlyRate:monthly*remaining;acc.leaseLiab+=pv;const initialPv=monthlyRate?monthly*(1-Math.pow(1+monthlyRate,-term))/monthlyRate:monthly*term;const carrying=initialPv*Math.max(0,1-elapsed/term);acc.rou+=carrying;acc.depr+=term?initialPv/term:0;acc.leaseInterest+=pv*monthlyRate;
      }else{
        const mode=assetMode(a),life=USEFUL_YEARS[mode]||15,salvage=price*(SALVAGE_PCT[mode]||.08),modelYear=Math.min(simYear,Math.max(2000,Number(a.year)||simYear)),ageYears=Math.max(0,simYear-modelYear),annualDep=Math.max(0,(price-salvage)/life),accum=Math.min(price-salvage,annualDep*ageYears),book=Math.max(salvage,price-accum);acc.assetVal+=book*(.75+.25*condition/100);acc.depr+=annualDep/12;
        acc.owned+=(Number(a.purchasePrice)||0)*clamp((Number(a.condition)||100)/100,.4,1);
      }
      acc.fuelCost+=Number(a.lastTrip?.fuelCost)||0;acc.maintReserve+=Number(a.lastTrip?.maintReserve)||0;acc.payroll+=Number(a.staffing?.monthlyPayroll)||0;
    };
    return {visit,totals};
  }
  function* ownerFleetTotalsStages(state,slice=Infinity){
    const fleet=fleetData(),key=ownerTotalsKey(state);if(key&&ownerTotalsMemo&&ownerTotalsMemo.state===state&&sameOwnerTotalsKey(ownerTotalsMemo.key,key))return ownerTotalsMemo.totals;
    const owner=ownerTotalsVisitor(state);
    yield* fleet.scanStages(state,OWNER_TOTAL_FIELDS,owner.visit,slice,'realism.fleet-totals');
    ownerTotalsMemo={state,key,totals:owner.totals};return owner.totals;
  }
  function ownerFleetTotals(state,t){const stages=ownerFleetTotalsStages(state);let step;while(!(step=stages.next()).done){}return step.value.get(t)||EMPTY_OWNER_TOTALS;}
  const statementCopy=row=>({...row,bankingAdjustment:row.bankingAdjustment&&typeof row.bankingAdjustment==='object'?{...row.bankingAdjustment}:row.bankingAdjustment});
  function ownedValue(state,t){return ownerFleetTotals(state,t).owned;}
  function ledgerTotals(state,t,days=30){const b=books(state,t),cut=(Number(state.simSeconds)||0)-days*86400,cutDay=Math.floor(cut/86400),archive=state.finance?.auditArchive;let income=0,expense=0;const consume=e=>{if((Number(e?.at)||0)<cut)return;const amt=Number(e?.amount)||0;if(e?.kind==='intercompany'||e?.kind==='internal'||e?.kind==='bank-credit'||e?.kind==='cash-sweep'||String(e?.documentNumber||'').startsWith('INT-'))return;if(String(e?.from||'').includes('عميل')||String(e?.note||'').includes('إيراد')||String(e?.note||'').includes('فاتورة رحلة'))income+=amt;else expense+=amt;};for(const e of (b?.ledger||[]))consume(e);for(const e of (archive?.records?.[`companyLedger-${t}`]||[]))consume(e);for(const d of (archive?.digests||[]))if(d?.kind===`companyLedger-${t}`&&d?.schema==='gh-finance-audit-digest-v2')for(const row of d.recentDaily||[])if(Number(row?.day)>=cutDay){income+=Number(row?.income)||0;expense+=Number(row?.expense)||0;}return {income,expense};}
  function statements(state,t){
    const memo=closeMemo&&closeMemo.state===state?closeMemo.statements:null;if(memo?.has(t))return statementCopy(memo.get(t));
    const result=computeStatements(state,t);if(memo)memo.set(t,statementCopy(result));return result;
  }
  // A month of interest at the rate each open debt bears (GH_FINANCE_CORE.debtRate), as the daily close bills it.
  function monthlyDebtInterest(state,t){const F=globalThis.GH_FINANCE_CORE;if(!F?.debtRate)return 0;let sum=0;for(const row of state.finance?.debtRecords||[])if(row?.company===t&&F.interestBearing(row))sum+=Number(row.outstanding)*F.debtRate(state,row)/12;return sum;}
  function computeStatements(state,t){
    const b=books(state,t)||{debt:0,taxPayable:0},lt=ledgerTotals(state,t,30),c=cash(state,t),recv=(state.finance?.receivables||[]).filter(x=>rowCompanyId(state,x)===t).reduce((n,x)=>n+(Number(x.total)||0),0),pay=(state.finance?.payables||[]).filter(x=>rowCompanyId(state,x)===t).reduce((n,x)=>n+(Number(x.total)||0),0),debt=Math.max(0,Number(b.debt)||0),simSeconds=Math.max(0,Number(state.simSeconds)||0),simYear=2026+Math.floor(simSeconds/(365*86400));
    const fleetTotals=ownerFleetTotals(state,t),assetVal=fleetTotals.assetVal,depr=fleetTotals.depr,leaseLiab=fleetTotals.leaseLiab,rou=fleetTotals.rou,leaseInterest=fleetTotals.leaseInterest;
    const revenue=lt.income,leaseServiceExcluded=0,opex=Math.max(0,lt.expense-leaseServiceExcluded),ebitda=revenue-opex,interest=monthlyDebtInterest(state,t)+leaseInterest,pretax=ebitda-depr-interest,tax=Math.max(0,pretax*.15),net=pretax-tax,bankingAdjustment=globalThis.GH_BANKING_CORE?.statementAdjustments?.(state,t)||{assets:0,liabilities:0},assets=c+recv+assetVal+rou+Math.max(0,Number(bankingAdjustment.assets)||0),liabilities=pay+debt+leaseLiab+(Number(b.taxPayable)||0)+Math.max(0,Number(bankingAdjustment.liabilities)||0),equity=assets-liabilities;
    const workingCapitalDelta=recv*.03-pay*.02,operatingCF=net+depr-workingCapitalDelta,investingCF=-(state.constructionContracts||[]).filter(x=>rowCompanyId(state,x)===t&&String(x.status||'').includes('مكتمل')===false).reduce((n,x)=>n+(Number(x.amount)||0)/Math.max(1,Number(x.totalDays)||180),0),financingCF=0;
    return {revenue,opex,ebitda,depr,interest,tax,net,assets,liabilities,cash:c,receivables:recv,payables:pay,debt,leaseLiability:leaseLiab,rouAsset:rou,equity,operatingCF,investingCF,financingCF,workingCapitalDelta,bankingAdjustment};
  }
  function closeFinancials(state,day){const r=migrate(state),types=companyTypes(state),archive=state.finance?.auditArchive;let rev=0,op=0,assets=0,liab=0,net=0,ocf=0,icf=0,fcf=0;for(const t of types){const s=statements(state,t);s.equity=s.assets-s.liabilities;r.financial.statements[t]=s;rev+=s.revenue;op+=s.opex;assets+=s.assets;liab+=s.liabilities;net+=s.net;ocf+=s.operatingCF;icf+=s.investingCF;fcf+=s.financingCF;}let eliminations=0;const add=e=>{if(e?.kind==='intercompany'||e?.kind==='bank-credit'||e?.kind==='cash-sweep')eliminations+=Number(e.amount)||0;};for(const t of types){for(const e of (books(state,t)?.ledger||[]))add(e);for(const e of (archive?.records?.[`companyLedger-${t}`]||[]))add(e);for(const d of (archive?.digests||[]))if(d?.kind===`companyLedger-${t}`&&d?.schema==='gh-finance-audit-digest-v2')eliminations+=Number(d.intercompanyTotal)||0;}const balanceEliminations=globalThis.GH_BANKING_CORE?.intercompanyBalanceEliminations?.(state)||{assets:0,liabilities:0};assets=Math.max(0,assets-Math.max(0,Number(balanceEliminations.assets)||0));liab=Math.max(0,liab-Math.max(0,Number(balanceEliminations.liabilities)||0));r.financial.intercompanyEliminations=eliminations;r.financial.intercompanyBalanceEliminations=balanceEliminations;r.financial.consolidated={revenue:rev,opex:op,ebitda:rev-op,net,assets,liabilities:liab,equity:assets-liab,operatingCF:ocf,investingCF:icf,financingCF:fcf};r.financial.lastCloseDay=day;}
  function inferBudgetActual(state,t){const s=statements(state,t),fleetTotals=ownerFleetTotals(state,t),fuel=fleetTotals.fuelCost*8,maint=fleetTotals.maintReserve*8,assetPayroll=fleetTotals.payroll,contractPayroll=(state.advanced?.labor?.employmentContracts||[]).filter(c=>c.status==='ساري'&&!c.automaticAssetStaffing&&rowCompanyId(state,c)===t).reduce((n,c)=>n+(Number(c.salary)||0),0),legacyPayroll=assetPayroll||contractPayroll?0:(state.crew||[]).filter(c=>String(c.ownerCompanyId||c.companyId||c.company||c.sector||'')===t).reduce((n,c)=>n+(Number(c.count)||0)*((Number(c.salaryMin)||0)+(Number(c.salaryMax)||0))/2*30,0),payroll=assetPayroll+contractPayroll+legacyPayroll;return {payroll,fuel,maintenance:maint,marketing:s.revenue*.018,insurance:Math.max(0,ownedValue(state,t)*.0008),technology:s.revenue*.01,capex:0,other:Math.max(0,s.opex-payroll-fuel-maint)};}
  function updateBudgets(state,day){const r=migrate(state),period=Math.floor(day/30);for(const t of companyTypes(state)){const b=r.budgets[t]||(r.budgets[t]=defaultBudget());if(b.period!==period){b.period=period;b.actual=Object.fromEntries(Object.keys(b.lines).map(k=>[k,0]));}const act=inferBudgetActual(state,t);b.actual={...b.actual,...act};const s=statements(state,t),base=Math.max(500000,s.revenue||cash(state,t)*.04);const godPlan=state.companyBudgets?.[t],manualLimit=godPlan?.enabled?Math.max(0,Number(godPlan.limit)||0):0,manualLines=godPlan?.lines&&typeof godPlan.lines==='object'?godPlan.lines:null,manualLineTotal=manualLines?Object.values(manualLines).reduce((n,x)=>n+(Math.max(0,Number(x)||0)),0):0;if(manualLimit>0&&manualLineTotal>0){b.lines={payroll:Number(manualLines.payroll)||0,fuel:Number(manualLines.fuel)||0,maintenance:Number(manualLines.maintenance)||0,marketing:Number(manualLines.marketing)||0,insurance:Number(manualLines.insurance)||0,technology:Number(manualLines.technology)||0,capex:Number(manualLines.capex)||0,other:Number(manualLines.other)||0};}else if(manualLimit>0){b.lines={payroll:manualLimit*.22,fuel:manualLimit*.23,maintenance:manualLimit*.10,marketing:manualLimit*.05,insurance:manualLimit*.04,technology:manualLimit*.05,capex:manualLimit*.23,other:manualLimit*.08};}else if(!Object.values(b.lines).some(Number)){b.lines={payroll:base*.22,fuel:base*.25,maintenance:base*.10,marketing:base*.04,insurance:base*.03,technology:base*.04,capex:base*.24,other:base*.08};}const elapsed=(day%30)+1;for(const k of Object.keys(b.lines)){b.forecast[k]=(Number(b.actual[k])||0)/Math.max(1,elapsed)*30;b.variance[k]=(Number(b.forecast[k])||0)-(Number(b.lines[k])||0);}}}
  // Build 358 (million-asset): the per-asset part of the operations close is one read-only pass over the fleet in row
  // order (GH_FLEET_DATA.scan: no view per asset, stored objects read in place) split into slices of OPS_SLICE_ROWS
  // rows, each a stage of the staged daily close (the transaction holds the fleet still between slices). Every sum and
  // count runs in the order of the former per-mode lists (row order), so the results are the same. The flight counters
  // are written through a column writer (each column journaled once, not each row); the row is no longer checkpointed
  // first (that only re-based progress, fuel and condition on today's time without changing what a view presents).
  // Build 358 (iPhone diagnostic, 36,000 assets: ~10 ms per 8,192-row step): 2,048 rows keeps the newer 30k-asset
  // diagnostic's fleet-day work below half a 60 Hz frame. The scan remains one pass in the same row order.
  const OPS_SLICE_ROWS=2048,OPS_FIELDS=Object.freeze(['assetMode','type','specs','lastTrip','condition','purchasePrice','phase','flightHours','flightCycles','nextCheckHours']);
  function opsVisitor(state){
    const fleet=fleetData(),r=migrate(state),write=fleet.columnWriter(state,['flightHours','flightCycles','nextCheckHours']),demand=clamp((r.economy.airDemand||100)/100,.65,1.35),bunker=Math.max(1,r.economy.bunker);
    let ask=0,rpk=0,rev=0,cost=0,fuel=0,movingAir=0,airCondition=0,maintReserve=0,maintExposure=0,airCount=0,maintenanceDue=0,aog=0;
    let seaDistance=0,seaFuelProxy=0,seaTransport=0,seaCo2=0,seaWork=0,seaRefWork=0,seaCondition=0,movingSea=0,seaCount=0,seaDryDock=0,roadCount=0,roadWeak=0,roadDamaged=0;
    const visit=(a,index)=>{
      const mode=assetMode(a);
      if(mode==='air'){
        const cap=Math.max(0,Number(a.specs?.capacity)||0),d=Math.max(0,Number(a.lastTrip?.distanceKm)||Number(a.lastTrip?.distance)||0),condition=clamp(Number(a.condition)||100,0,100);
        const conditionFactor=clamp(.82+(condition-70)*.004,.70,1.06),lf=clamp(.78*demand*conditionFactor,.52,.96);
        ask+=cap*Math.max(1,d);rpk+=cap*lf*Math.max(1,d);rev+=Number(a.lastTrip?.revenue)||0;
        const fuelCost=Number(a.lastTrip?.fuelCost)||0,crewCost=Number(a.lastTrip?.crewCost)||0,reserve=Number(a.lastTrip?.maintReserve)||0;
        fuel+=fuelCost;maintReserve+=reserve;maintExposure+=Math.max(0,(100-condition)/100)*(Number(a.purchasePrice)||0)*.0008;cost+=fuelCost+crewCost+reserve;
        if(a.phase==='moving')movingAir++;airCondition+=condition;airCount++;
        const flightHours=(Number(a.flightHours)||0)+(a.phase==='moving'?4:0),flightCycles=(Number(a.flightCycles)||0)+(a.phase==='turnaround'?1:0),nextCheckHours=Number(a.nextCheckHours)||600;
        write(index,'flightHours',flightHours);write(index,'flightCycles',flightCycles);write(index,'nextCheckHours',nextCheckHours);
        if(flightHours>=nextCheckHours||Number(a.condition)<72)maintenanceDue++;if(Number(a.condition)<60)aog++;
      }else if(mode==='sea'){
        const d=Math.max(1,Number(a.lastTrip?.distanceKm)||Number(a.lastTrip?.distance)||1),cap=Math.max(1,Number(a.specs?.capacity)||Number(a.specs?.teu)||Number(a.specs?.dwt)||1),cond=clamp(Number(a.condition)||100,0,100);seaDistance+=d;seaTransport+=d*cap;const fuelTonnes=Math.max(0,Number(a.lastTrip?.fuelCost)||0)/bunker;seaFuelProxy+=fuelTonnes;const dwt=ciiDeadweight(a.specs);if(dwt>0&&fuelTonnes>0){const work=dwt*d/1.852;seaCo2+=fuelTonnes*CII_CO2_PER_TONNE*1e6;seaWork+=work;seaRefWork+=ciiReference(dwt)*work;}seaCondition+=cond;if(a.phase==='moving')movingSea++;
        seaCount++;if(Number(a.condition)<70)seaDryDock++;
      }else if(mode==='road'){roadCount++;if(Number(a.condition)<70)roadWeak++;if(Number(a.condition)<75)roadDamaged++;}
    };
    const finish=day=>{
    r.aviation.ask=ask;r.aviation.rpk=rpk;r.aviation.loadFactor=ask?clamp(rpk/ask*100,0,100):0;r.aviation.yield=rpk?rev/rpk:0;r.aviation.rask=ask?rev/ask:0;r.aviation.cask=ask?cost/ask:0;r.aviation.caskExFuel=ask?(cost-fuel)/ask:0;
    r.aviation.maintenanceDue=maintenanceDue;r.aviation.aog=aog;
    r.aviation.avgCondition=airCount?airCondition/airCount:100;r.aviation.utilization=airCount?movingAir/airCount*100:0;
    r.aviation.dispatchReliability=airCount?clamp(100-(r.aviation.aog/airCount*100)-(r.aviation.maintenanceDue/airCount*2.5),55,99.95):100;
    r.aviation.technicalDelayRate=clamp(100-r.aviation.dispatchReliability,.05,15);r.aviation.otp=clamp(98-r.aviation.technicalDelayRate*.65-Math.max(0,r.aviation.utilization-88)*.12,55,99.5);
    r.aviation.maintenanceReserveCoverage=maintExposure?clamp(maintReserve/maintExposure*100,0,250):100;r.aviation.healthMonitoringScore=clamp(r.aviation.dispatchReliability*.55+r.aviation.avgCondition*.35+Math.min(100,r.aviation.maintenanceReserveCoverage)*.10,0,100);

    const avgSea=seaCount?seaCondition/seaCount:100;r.maritime.utilization=seaCount?movingSea/seaCount*100:0;
    // Build 359: CII in its own units (IMO AER): grams of CO2 per deadweight tonne-mile, from each ship's last voyage
    // (fuel tonnes = fuel cost / bunker price, 3.114 t CO2 per tonne of fuel; work = deadweight × nautical miles). The
    // required value is the reference line for each ship's size (1984 × DWT^-0.489), weighted by its work, less the
    // yearly reduction (5% in 2023, 2 points a year after). The old proxy had no units and sat on its 2.5 cap (ratio 2.78).
    const simYear=Math.max(0,Math.floor(day/365)),calendarYear=CII_START_YEAR+simYear,reduction=clamp(.05+.02*(calendarYear-2023),0,.30);
    r.maritime.fuelIntensity=seaWork?seaCo2/seaWork:0;r.maritime.attainedCii=seaWork?Math.round(seaCo2/seaWork*1000)/1000:0;
    r.maritime.requiredCii=seaWork?Math.round(seaRefWork/seaWork*(1-reduction)*1000)/1000:0;r.maritime.ciiReduction=reduction;
    r.maritime.ciiRatio=seaWork&&r.maritime.requiredCii>0?r.maritime.attainedCii/r.maritime.requiredCii:1;
    const ratio=r.maritime.ciiRatio;r.maritime.cii=ratio<=.82?'A':ratio<=.93?'B':ratio<=1.08?'C':ratio<=1.20?'D':'E';
    if(r.maritime.lastCiiYear!==simYear){const prev=r.maritime.ciiHistory[0];r.maritime.consecutiveD=r.maritime.cii==='D'?(prev?.rating==='D'?(Number(prev.consecutiveD)||1)+1:1):0;r.maritime.ciiHistory.unshift({year:simYear,rating:r.maritime.cii,ratio:r.maritime.ciiRatio,consecutiveD:r.maritime.consecutiveD});r.maritime.ciiHistory=r.maritime.ciiHistory.slice(0,8);r.maritime.lastCiiYear=simYear;}
    // Build 359: an adopted corrective plan (GH_GOVERNANCE_CORE.seaCorrectivePlan, slow steaming) answers the requirement.
    const planActive=!!globalThis.GH_GOVERNANCE_CORE?.seaCorrectivePlan?.(state),planNeeded=r.maritime.cii==='E'||r.maritime.consecutiveD>=3;
    r.maritime.correctiveAction=planNeeded&&!planActive;r.maritime.correctivePlanStatus=planActive?'مفعلة (تخفيض السرعة)':r.maritime.correctiveAction?'مطلوب':r.maritime.cii==='D'?`مراقبة D (${r.maritime.consecutiveD}/3)`:'غير مطلوب';
    r.maritime.eexiReadiness=clamp(avgSea*.72+(100-Math.max(0,r.economy.bunker-640)/10)*.08+(100-r.maritime.dryDockDue*5)*.20,0,100);r.maritime.eexi=r.maritime.eexiReadiness>=70?'Compliant':'Action required';r.maritime.dryDockDue=seaDryDock;r.maritime.avgBunkerCost=r.economy.bunker;
    r.maritime.waitingHours=clamp((100-r.maritime.utilization)*.18+r.maritime.dryDockDue*6,0,96);r.maritime.demurrage=Math.round(r.maritime.waitingHours*Math.max(0,seaCount)*1200);

    const hubs=(state.customHubs||[]).filter(h=>['logistics','depot'].includes(h.kind)||platform()?.getRouteModes?.(state,rowCompanyId(state,h,''))?.includes('road')).length;
    r.logistics.warehouseUtilization=clamp(roadCount/Math.max(1,hubs*14)*100,0,100);const weakRoad=roadWeak;
    r.logistics.onTime=clamp(97-(r.logistics.warehouseUtilization>90?(r.logistics.warehouseUtilization-90)*.45:0)-weakRoad*1.5,60,99);r.logistics.emptyMiles=clamp(22-roadCount*.25+hubs*.3,7,35);r.logistics.damageRate=clamp(.45+roadDamaged*.12,.2,5);r.logistics.orderCycleHours=clamp(30+(r.logistics.warehouseUtilization-70)*.25,12,72);r.logistics.throughput=Math.round(roadCount*18*(r.logistics.onTime/100));
    r.logistics.customsHours=clamp(7+(100-r.logistics.onTime)*.22+(r.economy.freight-100)*.03,3,48);r.logistics.customsScore=clamp(5-r.logistics.customsHours/16,1,5);r.logistics.shipmentScore=clamp(3.9-(Math.max(0,r.economy.freight-100)*.012)-r.logistics.emptyMiles*.018+Math.min(0.7,roadCount*.012),1,5);r.logistics.trackingScore=clamp(2.8+(state.advanced?.cyber?.coverage||70)/100*1.4-r.logistics.damageRate*.08,1,5);r.logistics.infrastructureScore=clamp(2.6+Math.min(1,hubs/8)*1.5-Math.max(0,r.logistics.warehouseUtilization-92)*.03,1,5);r.logistics.serviceScore=clamp(2.8+(100-r.logistics.emptyMiles)/100*1.3+(r.logistics.onTime-80)*.02,1,5);r.logistics.timelinessScore=clamp(1+r.logistics.onTime/25,1,5);r.logistics.lpiProxy=(r.logistics.customsScore+r.logistics.shipmentScore+r.logistics.trackingScore+r.logistics.infrastructureScore+r.logistics.serviceScore+r.logistics.timelinessScore)/6;r.logistics.networkBalance=clamp(100-r.logistics.emptyMiles-Math.max(0,r.logistics.warehouseUtilization-85)*.6,0,100);

    const e=state.energy||{},gasMW=Number(e.gasMW)||0,solarMW=Number(e.solarMW)||0,windMW=Number(e.windMW)||0,totalMW=gasMW+solarMW+windMW,renewableMW=solarMW+windMW,availability=clamp(Number(e.availability)||90,0,100);
    const weatherFactor=clamp(.74+rand(`energy:${day}:weather`,-.08,.08),.58,.90),thermalFactor=.72;r.energy.capacityFactor=totalMW?clamp(((gasMW*thermalFactor+renewableMW*weatherFactor)/totalMW)*(availability/100)*100,0,100):0;r.energy.availableMW=totalMW*availability/100;r.energy.renewableShare=totalMW?renewableMW/totalMW*100:0;
    const storageMWh=Math.max(0,Number(e.storageMWh)||0),spread=Math.max(0,r.economy.electricity-r.economy.gas),beforeSoc=r.energy.storageSoc;
    if(storageMWh>0&&spread>25&&r.energy.storageSoc>20){r.energy.storageSoc=clamp(r.energy.storageSoc-8,5,100);r.energy.cycles+=.08;}else if(storageMWh>0&&r.economy.electricity<75&&r.energy.storageSoc<90){r.energy.storageSoc=clamp(r.energy.storageSoc+7,0,100);r.energy.cycles+=.07;}
    r.energy.roundTripEfficiency=clamp(86-r.energy.degradation*.10,78,90);r.energy.degradation=clamp(1+r.energy.cycles*.012,1,20);r.energy.storageHealth=clamp(100-r.energy.degradation,60,100);r.energy.effectiveStorageMWh=storageMWh*r.energy.storageHealth/100;r.energy.storageThroughputMWh=Math.abs(r.energy.storageSoc-beforeSoc)/100*r.energy.effectiveStorageMWh;r.energy.roundTripLossMWh=r.energy.storageThroughputMWh*(1-r.energy.roundTripEfficiency/100);r.energy.reserveMargin=totalMW?clamp((r.energy.availableMW-(totalMW*.78))/Math.max(1,totalMW*.78)*100,-50,80):0;r.energy.curtailment=clamp(Math.max(0,r.energy.renewableShare-55)*.08+Math.max(0,r.energy.storageSoc-92)*.1,0,25);
    };
    return {visit,finish};
  }
  // Baseline reported for a bank with no balance sheet: no funding means no stressed outflows,
  // so the prudential ratios are not applicable. These mirror the pristine defaults above.
  const DORMANT_LCR=120,DORMANT_NSFR=112;
  function bankingMetrics(state){
    const r=migrate(state),b=state.bank||{};
    // A bank with no branches, no deposits and no loans has no balance sheet, so LCR/NSFR are not
    // applicable rather than 0%. Reporting 0 made every brand-new game look critically insolvent.
    const bankDormant=(Number(b.branches)||0)===0&&(Number(b.deposits)||0)===0&&(Number(b.loans)||0)===0;
    const deposits=Math.max(1,Number(b.deposits)||0),loans=Math.max(0,Number(b.loans)||0),offBalance=Math.max(0,Number(b.offBalance)||0),nplPct=clamp(Number(b.npl)||0,0,100);
    const creditRwa=loans*.72,offBalanceRwa=offBalance*.35,operationalRwa=Math.max(0,(Number(b.branches)||0)*2500000),rwa=Math.max(1,creditRwa+offBalanceRwa+operationalRwa),reportedCapitalRatio=clamp(Number(b.capitalRatio)||16.4,0,40),capital=reportedCapitalRatio/100*rwa,hqlaStored=Math.max(0,Number(b.hqla)||0),wholesale=Math.max(0,Number(b.wholesaleFunding)||0),hqla=hqlaStored>0||bankDormant?hqlaStored:Math.round((Math.max(0,Number(b.deposits)||0)+wholesale)*.37);
    const stressedOutflows=Math.max(1,deposits*.18+(Number(b.wholesaleFunding)||0)*.25),lcr=clamp(hqla/stressedOutflows*100,0,400),stableFundingStored=Math.max(0,Number(b.stableFunding)||0),stableFunding=stableFundingStored>0||bankDormant?stableFundingStored:Math.round(Math.max(0,Number(b.deposits)||0)*.90+wholesale*.50),requiredStable=Math.max(1,Number(b.requiredStableFunding)||loans*.85),nsfr=clamp(stableFunding/requiredStable*100,0,300),cet1=capital/rwa*100,tier1=cet1+1,totalCapital=cet1+2.4,nplAmount=loans*nplPct/100,provisions=Math.max(0,Number(b.provisions)||0);
    return {rwa,cet1,tier1,totalCapital,hqla,stressedOutflows,lcr:bankDormant?DORMANT_LCR:lcr,stableFunding,requiredStable,nsfr:bankDormant?DORMANT_NSFR:nsfr,dormant:bankDormant,npl:nplPct,loanDeposit:loans/deposits*100,costOfRisk:nplPct*.55,provisionCoverage:nplAmount?clamp(provisions/nplAmount*100,0,500):250,cet1Headroom:cet1-(r.banking.cet1RegMin+r.banking.capitalConservationBuffer),lcrHeadroom:(bankDormant?DORMANT_LCR:lcr)-100,nsfrHeadroom:(bankDormant?DORMANT_NSFR:nsfr)-100,stableFundingBuffer:stableFunding-requiredStable,distributionRestricted:cet1<(r.banking.cet1RegMin+r.banking.capitalConservationBuffer)};
  }
  function updateBank(state){const r=migrate(state),m=bankingMetrics(state);Object.assign(r.banking,m);}
  function marketCompanyIds(state){const P=platform();return P?.listInstances?P.listInstances(state,{includeGroup:false,openedOnly:true}).filter(company=>company.operational).map(company=>company.id):SECTORS.filter(id=>(state.openedCompanies||[]).includes(id));}
  function updateMarketShare(state,day){const r=migrate(state),ids=marketCompanyIds(state),counts=fleetData().countByFields(state,OWNER_FIELDS,row=>assetOwnerCompanyId(state,row));for(const companyId of ids){const sector=sectorOfCompany(state,companyId),infra=sector==='power'?((state.energy?.gasMW||0)+(state.energy?.solarMW||0)+(state.energy?.windMW||0))/200:sector==='bank'?(state.bank?.branches||0):counts.get(companyId)||0,rep=r.reputation[companyId]??r.reputation[sector]??70,pressure=r.market.competitorPressure[companyId]??r.market.competitorPressure[sector]??50;r.reputation[companyId]=rep;r.market.competitorPressure[companyId]=pressure;r.market.share[companyId]=clamp(2+infra*1.15+(rep-65)*.18-pressure*.035,0.5,42);if(day-r.market.lastResponseDay>=7){const share=r.market.share[companyId];r.market.competitorPressure[companyId]=clamp(45+share*1.15+rand(`${day}:${companyId}:pressure`,-5,6),20,95);}}if(day-r.market.lastResponseDay>=7)r.market.lastResponseDay=day;}
  function updateRisk(state,day){
    const r=migrate(state),s=r.financial.consolidated||{},netDebt=Math.max(0,(Number(state.debt)||0)-(Number(state.cash)||0)),ebitda=Math.max(1,Number(s.ebitda)||1),lev=netDebt/ebitda,liq=Number(state.cash)||0,issues=[];
    if(lev>r.risk.limits.netDebtEbitda)issues.push({id:'LEV',severity:'high',title:'الرافعة المالية أعلى من شهية المخاطر',value:lev.toFixed(2)+'x'});
    if(liq<r.risk.limits.minLiquidity)issues.push({id:'LIQ',severity:'high',title:'السيولة أقل من الحد الوقائي',value:money(liq)});
    if(r.banking.cet1<r.banking.cet1RegMin)issues.push({id:'CET1-REG',severity:'critical',title:'CET1 دون الحد التنظيمي الأساسي',value:r.banking.cet1.toFixed(1)+'%'});else if(r.banking.cet1<r.risk.limits.minBankCapital)issues.push({id:'CET1',severity:'high',title:'CET1 دون الحد الداخلي للمجموعة',value:r.banking.cet1.toFixed(1)+'%'});if(r.banking.tier1<r.banking.tier1RegMin)issues.push({id:'TIER1-REG',severity:'critical',title:'Tier 1 دون الحد الأساسي',value:r.banking.tier1.toFixed(1)+'%'});if(r.banking.totalCapital<r.banking.totalCapitalRegMin)issues.push({id:'TCAP-REG',severity:'critical',title:'إجمالي رأس المال دون الحد الأساسي',value:r.banking.totalCapital.toFixed(1)+'%'});if(r.banking.distributionRestricted)issues.push({id:'CET1-BUFFER',severity:'medium',title:'CET1 داخل نطاق حماية رأس المال؛ التوزيعات تحتاج تحفظًا',value:r.banking.cet1.toFixed(1)+'%'});
    if(r.banking.lcr<100)issues.push({id:'LCR',severity:'high',title:'LCR دون 100%',value:r.banking.lcr.toFixed(0)+'%'});if(r.banking.nsfr<100)issues.push({id:'NSFR',severity:'high',title:'NSFR دون 100%',value:r.banking.nsfr.toFixed(0)+'%'});if(r.banking.provisionCoverage<80&&r.banking.npl>2)issues.push({id:'PROV',severity:'medium',title:'تغطية مخصصات القروض المتعثرة منخفضة',value:r.banking.provisionCoverage.toFixed(0)+'%'});
    if(r.aviation.maintenanceDue>0)issues.push({id:'MNT-AIR',severity:'medium',title:'طائرات تستحق صيانة',value:String(r.aviation.maintenanceDue)});if(r.aviation.dispatchReliability<94)issues.push({id:'AIR-REL',severity:'high',title:'اعتمادية الإقلاع منخفضة',value:r.aviation.dispatchReliability.toFixed(1)+'%'});if(r.aviation.maintenanceReserveCoverage<75)issues.push({id:'AIR-MRES',severity:'medium',title:'احتياطي الصيانة لا يغطي التعرض الفني',value:r.aviation.maintenanceReserveCoverage.toFixed(0)+'%'});
    if(r.maritime.correctiveAction)issues.push({id:'CII',severity:r.maritime.cii==='E'?'high':'medium',title:'تصنيف CII يحتاج خطة تصحيح',value:r.maritime.cii});if(r.maritime.eexiReadiness<70)issues.push({id:'EEXI',severity:'medium',title:'جاهزية EEXI منخفضة',value:r.maritime.eexiReadiness.toFixed(0)+'/100'});
    if(r.logistics.warehouseUtilization>92)issues.push({id:'WH',severity:'medium',title:'تشبع مراكز اللوجستيات',value:r.logistics.warehouseUtilization.toFixed(0)+'%'});if(r.logistics.lpiProxy<3)issues.push({id:'LPI',severity:'medium',title:'جودة الشبكة اللوجستية منخفضة',value:r.logistics.lpiProxy.toFixed(2)+'/5'});
    if(r.energy.storageSoc<10||r.energy.storageSoc>95)issues.push({id:'ESS-SOC',severity:'medium',title:'SOC التخزين خارج نطاق التشغيل المفضل',value:r.energy.storageSoc.toFixed(0)+'%'});if(r.energy.reserveMargin<0)issues.push({id:'PWR-RES',severity:'high',title:'هامش القدرة المتاحة سلبي',value:r.energy.reserveMargin.toFixed(1)+'%'});
    r.risk.register=issues;r.risk.lastReviewDay=day;
  }
  const AGM_EFFECT_DAYS=400;
  function updateRating(state){const r=migrate(state),s=r.financial.consolidated||{},ebitda=Number(s.ebitda)||0,enterprise=Math.max(1,Number(state.groupValue)||Number(s.assets)||1),lev=ebitda>1000000?(Number(state.debt)||0)/ebitda:(Number(state.debt)||0)/enterprise*2,liq=(Number(state.cash)||0)/Math.max(1,Number(state.debt)||1),operatingAdj=(Number(s.revenue)||0)<1000000?0:(s.net>0?5:-8),agm=state.profile?.agm,agmAdjust=agm&&Math.floor((Number(state.simSeconds)||0)/86400)-Number(agm.day)<=AGM_EFFECT_DAYS?Number(agm.ratingAdjust)||0:0,score=clamp(72-lev*7+Math.min(12,liq*5)+operatingAdj-r.risk.register.length*2+agmAdjust,32,95);r.rating.agmAdjust=agmAdjust;r.rating.score=Math.round(score);r.rating.grade=score>=82?'A':score>=74?'A-':score>=66?'BBB+':score>=58?'BBB':score>=50?'BBB-':score>=42?'BB+':'BB';r.rating.outlook=r.risk.register.some(x=>x.severity==='high')?'Negative':s.net>0?'Stable':'Negative';globalThis.GH_CORPORATE_CORE?.execute?.({state},'set-credit-rating',{grade:r.rating.grade});}
  // The insured fleet's condition total (row order, as GH_FLEET_DATA.sum gave it). The operations pass of the daily
  // close reads every row's condition already and leaves its total here for the same fleet revision and time.
  let conditionSumMemo=null;
  function conditionSumKey(state){const revision=fleetData().revision(state);return revision===null?null:{fleet:state.fleet,revision,simSeconds:Math.max(0,Number(state.simSeconds)||0)};}
  function fleetConditionSum(state){
    const key=conditionSumKey(state);
    if(key&&conditionSumMemo&&conditionSumMemo.state===state&&conditionSumMemo.key.fleet===key.fleet&&conditionSumMemo.key.revision===key.revision&&conditionSumMemo.key.simSeconds===key.simSeconds)return conditionSumMemo.sum;
    let sum=0;fleetData().scan(state,['condition'],a=>{sum+=Number(a.condition)||100;});return sum;
  }
  // The operations cycle's fleet condition total (GH_FLEET_DATA.sum of condition, row order) from the daily close's
  // fleet pass, while the fleet and time are those it read; null otherwise.
  function fleetReadinessTotal(state){const key=conditionSumKey(state);return key&&conditionSumMemo&&conditionSumMemo.state===state&&conditionSumMemo.key.fleet===key.fleet&&conditionSumMemo.key.revision===key.revision&&conditionSumMemo.key.simSeconds===key.simSeconds&&Number.isFinite(conditionSumMemo.readiness)?conditionSumMemo.readiness:null;}
  function updateInsurance(state){
    const r=migrate(state),condition=fleetData().size(state)?fleetConditionSum(state)/fleetData().size(state):100,incidents=(state.advanced?.safety?.incidents||0),claims=(state.advanced?.insurance?.claims||[]),F=globalThis.GH_FINANCE_CORE,internalInsurer=operationalCompanyForCapability(state,'operations.insurance');
    // تسوية المطالبات: بعد فترة فحص محاكاة (3 أيام) تُصرف المطالبة فعليًا عبر الخزينة بدل ما تبقى معلقة "قيد الفحص" للأبد.
    const REVIEW_SECONDS=3*86400,nowSec=Math.max(0,Number(state.simSeconds)||0);
    for(const c of claims){
      if(['قيد الفحص','بانتظار سيولة شركة التأمين'].includes(c.status)&&nowSec-Number(c.openedAt||0)>=REVIEW_SECONDS){
        const amount=Math.max(0,Number(c.covered)||0),companyId=rowCompanyId(state,c,'');if(amount>0&&!companyId)throw new Error(`insurance-claim-company-invalid:${c.id||'unknown'}`);
        const insurer=String(c.insurerCompanyId||'');if(insurer&&insurer===internalInsurer){if(Math.max(0,Number(F?.operating?.(state,insurer))||0)+1e-8<amount){c.status='بانتظار سيولة شركة التأمين';continue;}const settlement=F.execute({state},'settle-intercompany-service',{from:insurer,to:companyId,amount,note:`تعويض مطالبة تأمين أسطول · ${c.id}`,serviceCategory:'تعويض مطالبة تأمين أسطول',taxCode:'insurance-claim',ref:`FLEET-CLAIM-${c.id}`,sourceRefs:[c.id,c.policyReference].filter(Boolean)});c.transferReference=settlement.reference;c.provider='شركة التأمين التابعة';}
        else if(amount>0){const payment=F?.execute?.({state},'credit',{company:companyId,amount,note:`تعويض مطالبة تأمين ${c.id}`,method:'تحويل شركة تأمين',taxable:false,taxCode:'insurance-claim',reference:`EXT-FLEET-CLAIM-${c.id}`,counterparty:'شركة التأمين الخارجية'});c.transferReference=payment?.transferReference||`EXT-FLEET-CLAIM-${c.id}`;c.provider='شركة تأمين خارجية';}
        c.status='مدفوعة';c.paid=amount;c.paidAt=nowSec;
      }
    }
    const openClaims=claims.filter(c=>!['مدفوعة','مغلقة','مرفوضة'].includes(c.status)).length,paid=claims.filter(c=>c.status==='مدفوعة').reduce((n,c)=>n+(Number(c.paid)||0),0),reserve=claims.reduce((n,c)=>n+(Number(c.reserve)||0),0);
    r.insurance.claimsTrend=clamp((100-condition)*.12+incidents*1.4+openClaims*.8,0,35);r.insurance.renewalIndex=clamp(92+r.insurance.claimsTrend*2+(r.risk.register.length*1.5)+(reserve?paid/Math.max(1,reserve)*12:0)+(Number(globalThis.GH_GOVERNANCE_CORE?.programEffects?.(state)?.insuranceIndex)||0),75,190);
  }
  function supplierScores(state){const r=migrate(state);for(const tx of (state.supplierTransactions||[])){const id=tx.supplierId||tx.supplier||'unknown';const x=r.procurement.supplierScores[id]||(r.procurement.supplierScores[id]={name:tx.supplier||id,spend:0,transactions:0,score:82});x.spend+=Number(tx.amount)||0;x.transactions++;x.score=clamp(88-rand(`${id}:${x.transactions}`,0,10),60,98);}}
  function deliveryAssets(delivery){return fleetData().receiptAssets(delivery);}
  function deliveryUnitCount(delivery){return Math.max(1,fleetData().receiptAssetCount(delivery)||Math.floor(Number(delivery?.count)||0));}
  function syncManualDeliveryPipeline(state,day){const r=migrate(state),deliveries=r.procurement.deliveries||[],existing=new Map((r.procurement.pipeline||[]).map(row=>[row.sourceId,row]));r.procurement.pipeline=deliveries.slice(-400).map(d=>{const prior=existing.get(d.id)||{},first=fleetData().receiptFirstAsset(d),company=assetOwnerCompanyId(state,first)||rowCompanyId(state,d,'');return {...prior,id:`PRC2-${d.id}`,sourceId:d.id,company,ownerCompanyId:company,title:first?.name||d.assetName||d.catalogId||d.id,count:deliveryUnitCount(d),stage:d.status==='delivered'?'Delivered':d.status==='cancelled'?'Cancelled':d.blockedReason?'Destination blocked':'Paid / Delivery',createdDay:Number.isFinite(Number(d.orderedDay))?Number(d.orderedDay):day,leadDays:Math.max(0,Math.ceil((Number(d.dueAtSeconds)-Number(d.orderedAtSeconds))/86400)||0),manual:true};});return r.procurement.pipeline;}
  function updateTaxFxAndDividends(state,day){const r=migrate(state),countries=new Set((state.globalBases||[]).map(x=>x.country||x.countryCode).filter(Boolean)),baseTax=.15+Math.min(.07,countries.size*.005);r.taxFx.taxRate=baseTax;r.taxFx.fxExposure=Math.max(0,(Number(state.debt)||0)*.28);delete r.taxFx.hedgedPct;const floor=r.risk.limits.minLiquidity,excess=Math.max(0,(Number(state.cash)||0)-floor);r.dividends.available=Math.round(excess*.35);}
  function updatePrograms(state,day){
    const r=migrate(state);globalThis.GH_GOVERNANCE_CORE?.execute?.({state},'tick-sustainability',{day});globalThis.GH_GOVERNANCE_CORE?.execute?.({state},'tick-research',{day});globalThis.GH_GOVERNANCE_CORE?.execute?.({state},'tick-cyber',{day});
    const research=state.research||{};r.controls.researchEffects={efficiency:clamp((Number(research.efficiency)||0)/100,0,1),automation:clamp((Number(research.automation)||0)/100,0,1),cleanEnergy:clamp((Number(research.cleanEnergy)||0)/100,0,1)};
  }
  function updateReputation(state){
    const r=migrate(state);r.reputation.air=Math.round(clamp(58+r.aviation.otp*.18+r.aviation.dispatchReliability*.12-r.aviation.aog*2,40,96));r.reputation.sea=Math.round(clamp(68+(r.maritime.cii==='A'?12:r.maritime.cii==='B'?8:r.maritime.cii==='C'?2:-7)+(r.maritime.utilization-60)*.08-r.maritime.dryDockDue*.8,40,96));r.reputation.road=Math.round(clamp(55+r.logistics.onTime*.20+r.logistics.lpiProxy*4-r.logistics.damageRate*2,40,96));r.reputation.power=Math.round(clamp(64+r.energy.capacityFactor*.15+r.energy.storageHealth*.08-r.energy.curtailment*.45+Math.min(8,r.energy.reserveMargin*.08),40,96));r.reputation.bank=Math.round(clamp(70-r.banking.npl*2+(r.banking.lcr-100)*.035+(r.banking.nsfr-100)*.025+Math.min(6,r.banking.cet1Headroom*.6),40,96));for(const companyId of marketCompanyIds(state)){const sector=sectorOfCompany(state,companyId);if(companyId!==sector)r.reputation[companyId]=r.reputation[sector]??r.reputation[companyId]??70;}r.reputation.group=Math.round(SECTORS.reduce((n,t)=>n+r.reputation[t],0)/SECTORS.length);globalThis.GH_CORPORATE_CORE?.execute?.({state},'set-reputation',{value:r.reputation.group});
  }
  const DELIVERY_WINDOW_SECONDS=Object.freeze({air:90,sea:150,road:60});
  function compatibleDeliveryFacilities(state,asset){
    const globals=Array.isArray(state.globalBases)?state.globalBases:[],hubs=Array.isArray(state.customHubs)?state.customHubs:[];
    const rows=[...globals,...hubs].filter(f=>f&&f.owned!==false);
    const facilityCore=globalThis.GH_FACILITY_CORE;if(!facilityCore?.isAssetFacilityCompatible)throw new Error('facility-compatibility-owner-missing');return rows.filter(f=>facilityCore.isAssetFacilityCompatible(asset,f,state));
  }
  function deliveryCapacity(state,facility){
    const owner=globalThis.GH_FACILITY_CORE;if(!owner?.assetCapacity)throw new Error('facility-capacity-owner-missing');return owner.assetCapacity(facility);
  }
  function markDeliveryDelivered(state,delivery,day,at){const lifecycle=globalThis.GH_LIFECYCLE_CORE;if(lifecycle?.transition)lifecycle.transition(state,delivery,'deliveryOrder','delivered',{event:'ASSET_DELIVERED',domain:'operations',actor:'delivery-engine'});else delivery.status='delivered';delivery.deliveredDay=day;delivery.deliveredAtSeconds=at;}
  function compactDeliveredDelivery(delivery){
    if(!delivery||delivery.status!=='delivered')return delivery;
    const assets=deliveryAssets(delivery);if(!assets.length)return delivery;
    delivery.deliveryOrderId=delivery.id;delivery.assets=assets;delivery.count=assets.length;delivery.assetIds=assets.map(asset=>asset.id);delivery.assetId=assets.length===1?assets[0].id:null;
    delivery.assetName=delivery.assetName||assets[0].name||assets[0].model||delivery.catalogId||delivery.id;delivery.purchasePrice=Number(delivery.purchasePrice)||assets.reduce((sum,asset)=>sum+(Number(asset.purchasePrice)||0),0);
    delivery.ownerCompanyId=delivery.ownerCompanyId||assets[0].ownerCompanyId||assets[0].companyId||null;delivery.assetMode=delivery.assetMode||assets[0].assetMode||assets[0].type||null;delivery.assetClass=delivery.assetClass||assets[0].assetClass||null;
    delete delivery.asset;fleetData().compactReceipt(delivery);return delivery;
  }
  function deliveryCapacitySnapshot(state,deliveries){
    const occupied=new Map(),pending=new Map();
    // Build 358 (million-asset): counted per class of rows with the same base, not one view per asset.
    for(const [base,count] of fleetData().countByFields(state,['baseFacility'],asset=>asset.baseFacility))occupied.set(base,count);
    for(const delivery of deliveries)if(delivery?.status==='pending'&&delivery.baseId)pending.set(delivery.baseId,(pending.get(delivery.baseId)||0)+deliveryUnitCount(delivery));
    return {occupied,pending};
  }
  function deliverySnapshotHasRoom(state,snapshot,facility,delivery){
    const units=deliveryUnitCount(delivery),pending=(snapshot.pending.get(facility.id)||0),reserved=pending+(snapshot.occupied.get(facility.id)||0);
    return units>0&&pending>=units&&reserved<=deliveryCapacity(state,facility);
  }
  function normalizeDeliveryClock(state,d){
    const now=Math.max(0,Number(state.simSeconds)||0),base=Math.max(60,DELIVERY_WINDOW_SECONDS[assetMode(fleetData().receiptFirstAsset(d))||d.assetMode||d.type]||600);
    if(!Number.isFinite(Number(d.orderedAtSeconds)))d.orderedAtSeconds=Math.max(0,Math.min(now,Number(d.orderedDay||0)*86400));
    if(!Number.isFinite(Number(d.dueAtSeconds))){
      const legacyDue=Number(d.dueDay);
      const legacySeconds=Number.isFinite(legacyDue)?legacyDue*86400:Infinity;
      d.dueAtSeconds=Math.min(legacySeconds,now+base);
    }
    if(Number(d.dueAtSeconds)<Number(d.orderedAtSeconds))d.dueAtSeconds=Number(d.orderedAtSeconds)+base;
    return d;
  }
  function deliverDueAssetsAt(state,simSeconds){
    const r=migrate(state),deliveries=r.procurement.deliveries||[];if((Number(r.procurement.pendingDeliveryCount)||0)<=0)return 0;
    const now=Math.max(0,Number(simSeconds)||Number(state.simSeconds)||0),day=Math.floor(now/86400);
    const tx=globalThis.GH_TRANSACTION_CORE,commands=globalThis.GH_DOMAIN_COMMANDS;if(!tx?.execute||!commands?.dispatchSystem)throw new Error('delivery-transaction-unavailable');
    // Clock normalization, blocked status, fleet/HR/value, counter and pipeline
    // belong to one transaction. A late pipeline failure must roll back delivery.
    const outcome=(tx.isActive()?tx.join:tx.execute)(state,{label:'asset-delivery-poll',apply:()=>{
      const pendingDeliveries=deliveries.filter(row=>row?.status==='pending'),ready=[],alreadyDelivered=[];
      let snapshot=null;
      for(const d of pendingDeliveries){normalizeDeliveryClock(state,d);if(Number(d.dueAtSeconds)>now)continue;
        const assets=deliveryAssets(d);if(!assets.length)throw new Error(`delivery-assets-missing:${d.id}`);
        // Build once, only when needed; future reservations still count toward capacity.
        // Build 358 (million-asset): the delivery's own assets are looked up through the fleet's id index instead of a
        // map of every asset (ids are unique in a valid save).
        if(!snapshot)snapshot=deliveryCapacitySnapshot(state,pendingDeliveries);
        const existing=assets.map(asset=>fleetData().get(state,asset.id)||undefined),existingCount=existing.filter(Boolean).length;
        if(existingCount){if(existingCount!==assets.length||existing.some(asset=>asset&&(asset.baseFacility!==d.baseId||asset.deliveryOrderId!==d.id)))throw new Error('existing-delivery-evidence-mismatch');alreadyDelivered.push({delivery:d,count:assets.length});continue;}
        const base=compatibleDeliveryFacilities(state,assets[0]).find(f=>f.id===d.baseId),compatible=base&&assets.every(asset=>globalThis.GH_FACILITY_CORE.isAssetFacilityCompatible(asset,base,state));
        if(!compatible||!deliverySnapshotHasRoom(state,snapshot,base,d)){
          const asset=assets[0];d.blockedReason='approved-destination-missing-or-full';d.lastCheckedAt=now;
          if(!Number.isFinite(Number(d.lastBlockedAlertAt))||now-Number(d.lastBlockedAlertAt)>=300){d.lastBlockedAlertAt=now;if(Array.isArray(state.alerts))state.alerts.unshift(`${asset.name||'دفعة أصول'}: تسليم ${assets.length} أصل بانتظار قاعدة/مركز مملوك متوافق مع ${companyLabel(state,assetOwnerCompanyId(state,asset))||assetMode(asset)}. لن يعيد النظام توجيه الأصول تلقائيًا؛ ستبقى الدفعة على وجهتها وتُعاد المحاولة بعد معالجة السعة.`);}
          continue;
        }
        ready.push({delivery:d,assets,base});
      }
        if(ready.length){
          const inputs=ready.map(({delivery,assets,base})=>{const ownerCompanyId=assetOwnerCompanyId(state,assets[0]);if(!ownerCompanyId)throw new Error(`delivery-company-invalid:${delivery.id}`);return {deliveryId:delivery.id,baseId:base.id,assets:assets.map(asset=>({...asset,ownerCompanyId,companyName:companyLabel(state,ownerCompanyId)})),phase:'idle',deliveredDay:day,deliveredAtSeconds:now};});
          const delivered=commands.dispatchSystem({state},'fleet','record-delivery-batch',{deliveries:inputs},{actor:'delivery-engine'}),deliveredAssets=delivered?.result,expectedAssets=ready.reduce((sum,row)=>sum+row.assets.length,0);
          if(!delivered?.ok||!Array.isArray(deliveredAssets)||deliveredAssets.length!==expectedAssets||deliveredAssets.some(asset=>asset.deliveryStatus!=='delivered'||asset.staffing?.ready!==true))throw new Error('delivery-owner-rejected-batch');
          const valueDelta=ready.reduce((sum,{assets})=>sum+assets.reduce((batchSum,asset)=>batchSum+(asset.ownership==='lease'?(Number(asset.purchasePrice)||0)*.08:(Number(asset.purchasePrice)||0)*.86),0),0);
          const adjusted=commands.dispatchSystem({state},'corporate','adjust-group-value',{delta:valueDelta},{actor:'delivery-engine'});if(!adjusted?.ok)throw new Error('delivery-value-owner-rejected');
          const readyCount=ready.reduce((sum,row)=>sum+row.assets.length,0),text=readyCount===1?`تم استلام ${ready[0].assets[0].name} فورًا في ${ready[0].base.name||ready[0].delivery.destination||'القاعدة'} وتجهيز طاقمه الثابت وراتبه آليًا. الأصل جاهز للتشغيل.`:`تم استلام ${readyCount} أصلًا ضمن ${ready.length} دفعة تسليم، وتجهيز طواقمها الثابتة ورواتبها آليًا. جميع الأصول جاهزة للتشغيل.`;
          for(const {delivery} of ready){delivery.blockedReason=null;markDeliveryDelivered(state,delivery,day,now);compactDeliveredDelivery(delivery);}
          const alert=commands.dispatchSystem({state},'operations','record-alert',{text,type:'delivery'},{actor:'delivery-engine'});if(!alert?.ok)throw new Error('delivery-alert-owner-rejected');
        }
        for(const {delivery} of alreadyDelivered){markDeliveryDelivered(state,delivery,day,now);compactDeliveredDelivery(delivery);}
      const pending=deliveries.filter(x=>x.status==='pending'),history=deliveries.filter(x=>x.status!=='pending');
      r.procurement.pendingDeliveryCount=pending.length;r.procurement.deliveries=[...pending,...history];
      syncManualDeliveryPipeline(state,day);
      return ready.reduce((sum,row)=>sum+row.assets.length,0)+alreadyDelivered.reduce((sum,row)=>sum+row.count,0);
    }});
    if(!outcome?.committed)throw new Error(outcome?.reason||'delivery-batch-transaction-rejected');
    return outcome.value;
  }
  function deliverDueAssets(state,day){return deliverDueAssetsAt(state,Math.max(Number(state.simSeconds)||0,Number(day||0)*86400));}
  function updateProjects(state,day){const r=migrate(state),source=state.constructionContracts||[],commands=globalThis.GH_DOMAIN_COMMANDS;for(const c of source){const companyId=rowCompanyId(state,c,'');if(!companyId)throw new Error(`construction-company-invalid:${c.id||'unknown'}`);let p=r.projects.find(x=>x.sourceId===c.id);if(!p){const total=Math.max(1,Number(c.leadDays)||(c.facilityKind==='power'?180:c.facilityKind==='hq'?120:c.facilityKind==='bank'?90:180));p={id:`CAPEX-${c.id}`,sourceId:c.id,company:companyId,ownerCompanyId:companyId,title:c.siteName||c.facilityKind,budget:Number(c.amount)||0,startDay:Math.floor((Number(c.awardedAt)||0)/86400),totalDays:total,stage:'Construction',progress:0,status:'Active'};r.projects.push(p);}const elapsed=Math.max(0,day-p.startDay);p.progress=clamp(elapsed/p.totalDays*100,0,100);p.stage=p.progress<10?'Permits & mobilization':p.progress<70?'Construction':p.progress<95?'Commissioning':'Operational';if(p.progress>=100){p.status='Completed';const energyProject=platform()?.hasCapability?.(state,companyId,'operations.energy')||(!platform()&&companyId==='power');if(energyProject&&c.capacityKey&&c.capacityAmount&&!c.commissioned){if(!commands?.dispatchSystem)throw new Error('project-commissioning-command-owner-missing');const commissioned=commands.dispatchSystem({state},'facilities','commission-energy',{key:c.capacityKey,amount:Number(c.capacityAmount)||0,ownerCompanyId:companyId},{actor:'project-commissioning'});if(!commissioned?.ok)throw new Error('project-commissioning-rejected');globalThis.GH_PROCUREMENT_CORE?.execute?.({state},'complete-construction',{id:c.id,status:'مكتمل / مشغل'});const facility=(state.customHubs||[]).find(row=>row.constructionContractId===c.id);if(facility){facility.commissioned=true;facility.status='تشغيل تجاري';facility.dailyCost=Number(facility.plannedDailyCost)||Number(facility.dailyCost)||0;facility.capacity=`مشغل · ${Number(c.capacityAmount)||0} ${c.capacityKey==='storageMWh'?'MWh':'MW'}`;}const adjusted=commands.dispatchSystem({state},'corporate','adjust-group-value',{delta:(Number(c.amount)||0)*.44},{actor:'project-commissioning'});if(!adjusted?.ok)throw new Error('project-value-owner-rejected');const alert=commands.dispatchSystem({state},'operations','record-alert',{text:`اكتمل Commissioning لمشروع ${c.siteName||p.title}. أضيفت القدرة الجديدة إلى التشغيل الفعلي.`,type:'commissioning'},{actor:'project-commissioning'});if(!alert?.ok)throw new Error('project-alert-owner-rejected');}}}}
  function updateEventQueue(state,day){const r=migrate(state),q=r.eventQueue,add=(id,at,type,title)=>{if(!q.some(x=>x.id===id))q.push({id,at,type,title,status:'pending'});};for(const c of (state.finance?.cheques||[]))if(c.status==='صادر')add(`CHQ:${c.id}`,Number(c.dueDay)||day,'payment',`استحقاق ${c.id}`);for(const p of (state.finance?.periods||[]))if(p.status==='مستحق')add(`TAX:${p.id}`,Number(p.dueDay)||day,'tax',`استحقاق ضريبة ${p.company||'group'}`);for(const x of [...(state.bank?.lettersOfCredit||[]),...(state.bank?.guarantees||[])])if(x.status==='ساري')add(`TF:${x.id}`,Number(x.expiryDay)||day,'trade-finance',`انتهاء ${x.id}`);for(const x of q)if(x.status==='pending'&&Number(x.at)<=day)x.status='due';q.sort((a,b)=>(a.at||0)-(b.at||0));if(q.length>300)q.splice(300);}
  function board(state,day){const r=migrate(state);if(day<r.board.nextMeetingDay)return;const s=r.financial.consolidated||{},m={id:`BRD-${day}`,day,agenda:['الأداء المالي','المخاطر','السيولة','الاستثمار','السلامة','رأس مال البنك'],net:Number(s.net)||0,riskCount:r.risk.register.length,rating:r.rating.grade,status:'مكتمل'};r.board.meetings.unshift(m);r.board.meetings=r.board.meetings.slice(0,24);r.board.nextMeetingDay=day+30;}
  function succession(state){const r=migrate(state),roles=['CEO','CFO','COO','CRO','CHRO','CTO','General Counsel'];for(const role of roles){if(!r.people.succession[role])r.people.succession[role]={coverage:Math.round(rand(`succ:${role}`,55,92)),readyNow:rand(`succ-ready:${role}`)>0.55?'نعم':'خلال 12-24 شهر'};}}
  function morningBrief(state,day){const r=migrate(state);if(r.morningBriefs[0]?.day===day)return;const s=r.financial.consolidated||{},topRisks=r.risk.register.slice(0,3),pendingDeliveries=(r.procurement.deliveries||[]).filter(row=>row.status==='pending').length,brief={day,net:Number(s.net)||0,cash:Number(state.cash)||0,risks:topRisks.map(x=>x.title),pendingDeliveries,headline:topRisks.length?`أولوية اليوم: ${topRisks[0].title}`:pendingDeliveries?`${pendingDeliveries} تسليم أصول قيد الوصول`:'التشغيل ضمن الحدود الوقائية'};r.morningBriefs.unshift(brief);r.morningBriefs=r.morningBriefs.slice(0,30);}
  function causalEvent(state,hour){const r=migrate(state),day=Math.floor(hour/24);if(hour%72!==0)return;const roll=rand(`event:${Math.floor(hour/72)}`),e=r.economy;let ev=null;if(roll<.22){ev={id:`EV2-${hour}`,type:'oil',title:'اضطراب في إمدادات الطاقة',oil:+12,freight:+5,airDemand:-3,seaDemand:-1,duration:48};}else if(roll<.40){ev={id:`EV2-${hour}`,type:'ports',title:'ازدحام في ممرات بحرية رئيسية',freight:+14,bunker:+4,seaDemand:-2,duration:72};}else if(roll<.57){ev={id:`EV2-${hour}`,type:'rates',title:'تشدد ائتماني عالمي',baseRate:+.006,airDemand:-2,roadDemand:-2,duration:96};}else if(roll<.72){ev={id:`EV2-${hour}`,type:'growth',title:'ارتفاع في الطلب التجاري العالمي',airDemand:+5,seaDemand:+6,roadDemand:+5,powerDemand:+3,duration:72};}if(ev){e.lastEvent=ev;e.eventHistory.unshift({...ev,day});e.eventHistory=e.eventHistory.slice(0,30);for(const [k,v] of Object.entries(ev))if(typeof v==='number'&&k!=='duration')e[k]=Math.max(0,(Number(e[k])||0)+v);}}
  // Fuel prices follow oil; oil and gas revert to their means at a fixed rate per hour (onHour).
  const OIL_MEAN=78,OIL_REVERSION=.006,GAS_MEAN=39,GAS_REVERSION=.01,FUEL_FROM_OIL=Object.freeze({jet:oil=>.52+oil*.0045,bunker:oil=>300+oil*4.2,diesel:oil=>.48+oil*.006});
  // The expected average of a mean-reverting price over the coming days: what a swap or a fixed-price contract is priced at.
  function expectedAverage(spot,mean,reversion,days){const hours=Math.max(1,Math.floor(Number(days)||0)*24),q=1-reversion;return mean+(spot-mean)*q*(1-q**hours)/((1-q)*hours);}
  function fuelForward(state,fuel,days){const price=FUEL_FROM_OIL[fuel];if(!price)throw new Error(`fuel-unknown:${fuel}`);return price(expectedAverage(Number(migrate(state).economy.oil)||OIL_MEAN,OIL_MEAN,OIL_REVERSION,days));}
  function gasForward(state,days){return expectedAverage(Number(migrate(state).economy.gas)||GAS_MEAN,GAS_MEAN,GAS_REVERSION,days);}
  // One row per day: [day, oil, jet $/kg, bunker $/t, diesel $/l, gas $/MWh, electricity $/MWh, freight index, base rate bps].
  const MARKET_HISTORY_DAYS=365;
  function recordMarketDay(state,day){const m=migrate(state).markets,e=state.realism.economy,last=m.history[m.history.length-1];if(last&&last[0]>=day)return;const r4=v=>Math.round((Number(v)||0)*1e4)/1e4;m.history.push([day,r4(e.oil),r4(e.jetFuel),r4(e.bunker),r4(e.diesel),r4(e.gas),r4(e.electricity),r4(e.freight),Math.round((Number(e.baseRate)||0)*1e4)]);if(m.history.length>MARKET_HISTORY_DAYS)m.history.splice(0,m.history.length-MARKET_HISTORY_DAYS);for(const hedge of m.hedges)if(hedge.status==='ساري'&&day>=hedge.endDay)hedge.status='منتهي';const open=m.hedges.filter(hedge=>hedge.status==='ساري'),closed=m.hedges.filter(hedge=>hedge.status!=='ساري').slice(0,48);m.hedges=[...open,...closed];}
  function onHour(state,hour){const r=migrate(state),e=r.economy;causalEvent(state,hour);const oilDrift=(OIL_MEAN-e.oil)*OIL_REVERSION+rand(`${hour}:oil`,-.8,.8);e.oil=clamp(e.oil+oilDrift,35,180);e.jetFuel=clamp(FUEL_FROM_OIL.jet(e.oil)+rand(`${hour}:jet`,-.006,.006),.45,1.75);e.bunker=clamp(FUEL_FROM_OIL.bunker(e.oil)+rand(`${hour}:bun`,-4,4),280,1200);e.diesel=clamp(FUEL_FROM_OIL.diesel(e.oil)+rand(`${hour}:dies`,-.008,.008),.5,2.0);e.gas=clamp(e.gas+(GAS_MEAN-e.gas)*GAS_REVERSION+rand(`${hour}:gas`,-.5,.5),15,120);e.electricity=clamp(36+e.gas*.75+rand(`${hour}:elec`,-2.2,2.2),30,190);e.freight=clamp(e.freight+(100-e.freight)*.008+rand(`${hour}:freight`,-1.3,1.3),55,220);e.baseRate=clamp(e.baseRate+(0.046-e.baseRate)*.003+rand(`${hour}:rate`,-.0002,.0002),.005,.16);e.usdIndex=clamp(e.usdIndex+(100-e.usdIndex)*.005+rand(`${hour}:usd`,-.25,.25),80,130);for(const k of ['airDemand','seaDemand','roadDemand','powerDemand'])e[k]=clamp(e[k]+(100-e[k])*.01+rand(`${hour}:${k}`,-.4,.4),65,145);globalThis.GH_MARKET_CORE?.execute?.({state},'sync-economy',{values:{electricityPriceMWh:e.electricity,gasCostMWh:e.gas,baseRate:e.baseRate,freightIndex:e.freight}});}
  // Build 358 (million-asset): every asset id present, a non-empty string and unique (GH_FLEET_DATA.idCollisions, per
  // class of rows) means the per-asset id check adds nothing; anything else runs it as before.
  function fleetIdsSound(state){
    const fleet=fleetData();if(fleet.mode?.(state)!=='store'||typeof fleet.idCollisions!=='function')return false;
    const ids=fleet.idCollisions(state);if(ids.duplicate||ids.missing)return false;
    let sound=true;fleet.forEachFieldClasses(state,['id'],row=>{if(typeof row.id!=='string'||row.id==='')sound=false;});return sound;
  }
  function integrity(state,day){const r=migrate(state),issues=[];for(const t of companyTypes(state)){const b=books(state,t);if(!b||!Array.isArray(b.accounts))issues.push(`دفتر ${t} غير صالح`);else if(b.accounts.some(a=>!Number.isFinite(Number(a.balance))))issues.push(`رصيد غير رقمي في ${t}`);}if(!fleetIdsSound(state)){const ids=new Set();fleetData().forEach(state,a=>{if(!a.id||ids.has(a.id))issues.push('معرف أصل مكرر');ids.add(a.id);});}const qids=new Set();for(const q of r.eventQueue){if(qids.has(q.id))issues.push('حدث زمني مكرر');qids.add(q.id);}r.controls.issues=issues;r.controls.lastIntegrityDay=day;return issues;}
  // Build 358: the daily close as stages. The app's staged day boundary (GH_TRANSACTION_CORE.beginStaged) runs one or
  // more stages per frame inside the same transaction; onDay() runs them all at once. Order and results are identical.
  // The statements memo window (closeFinancials -> updateBudgets) never spans a pause.
  // Build 358 (million-asset): the daily close reads the fleet in ONE pass, in slices of OPS_SLICE_ROWS rows (each a
  // stage): the owner totals of the statements, budgets and insured value, the operations sums, the condition totals of
  // insurance and of the app's operations cycle, and the day's flight counters (written through a column writer).
  // Nothing the close computes before the operations stage reads the flight counters, and they change no field the
  // totals read, so every result is the one the separate passes gave; the memos keep the fleet revision after the writes.
  // Fleet maintenance (Build 358 step 3). Each company sets the condition at which an asset gets its check. The daily
  // close checks the assets below it (at most CHECKS_PER_DAY per company: the maintenance network's daily capacity),
  // restores their condition through the fleet owner, and bills the work on 7-day terms. The fleet's average
  // condition after the checks is the company's wear for the next day's trips (fuel burn and delay losses,
  // GH_SIMULATION_ASSET_CORE.computeTripEconomics and GH_ADVANCED.adjustTripEconomics).
  const MAINTENANCE_POLICIES=Object.freeze({preventive:90,standard:80,deferred:65}),CHECK_COST=Object.freeze({air:.004,sea:.003,road:.006}),CHECKS_PER_DAY=2000,MAINTENANCE_STEP=256;
  function maintenancePolicy(state,companyId){const policy=state.advanced?.companies?.[companyId]?.maintenancePolicy;return Object.prototype.hasOwnProperty.call(MAINTENANCE_POLICIES,policy)?policy:'standard';}
  function maintenanceVisitor(state){
    const companies=new Map(),owners=new Map();
    const visit=a=>{
      const ownerKey=`${a.ownerCompanyId}\u0000${a.companyId}\u0000${a.company}\u0000${a.assetMode}\u0000${a.type}`;let owner=owners.get(ownerKey);if(owner===undefined){owner=assetOwnerCompanyId(state,a);owners.set(ownerKey,owner);}
      let acc=companies.get(owner);if(!acc){acc={threshold:MAINTENANCE_POLICIES[maintenancePolicy(state,owner)],conditionSum:0,restored:0,count:0,due:[],cost:0,value:0,risk:0,premium:0,sample:[],licence:0,fine:0,unsafe:0};companies.set(owner,acc);}
      const condition=clamp(Number(a.condition)||100,0,100),mode=assetMode(a),price=Math.max(0,Number(a.purchasePrice)||0);acc.conditionSum+=condition;acc.count++;acc.value+=price;acc.risk+=INCIDENT_RATE[mode]||INCIDENT_RATE.road;acc.premium+=price*(PREMIUM_RATE[mode]||PREMIUM_RATE.road);acc.licence+=LICENCE_FEE[mode]||LICENCE_FEE.road;if(condition<UNSAFE_CONDITION){acc.unsafe++;acc.fine+=INSPECTION_FINE[mode]||INSPECTION_FINE.road;}if(acc.sample.length<INCIDENT_SAMPLE)acc.sample.push({id:a.id,price});
      if(condition<acc.threshold&&acc.due.length<CHECKS_PER_DAY){acc.due.push(a.id);acc.restored+=100-condition;acc.cost+=Math.max(0,Number(a.purchasePrice)||0)*(CHECK_COST[assetMode(a)]||CHECK_COST.road);}
    };
    return {visit,companies};
  }
  function* runMaintenance(state,maintenance,day){
    const r=migrate(state),fleet=fleetData(),F=globalThis.GH_FINANCE_CORE,stamp=Number(state.simSeconds)||0;r.maintenance=r.maintenance&&typeof r.maintenance==='object'?r.maintenance:{};r.maintenance.companies={};
    for(const [companyId,acc] of maintenance.companies){
      for(let i=0;i<acc.due.length;i+=MAINTENANCE_STEP){for(const id of acc.due.slice(i,i+MAINTENANCE_STEP))fleet.update(state,id,{condition:100,lastMaintenanceAt:stamp});yield 'realism.maintenance';}
      const cost=Math.round(acc.cost);if(cost>0&&F?.execute)F.execute({state},'accrue-expense',{company:companyId,amount:cost,note:`صيانة دورية لـ ${acc.due.length} ${acc.due.length===1?'أصل':'أصول'} · اليوم ${day}`,method:'فاتورة صيانة',taxable:true,dueDay:day+7,number:`MNT-${String(companyId).toUpperCase()}-${day}`,paymentTerms:7,counterparty:'شبكة الصيانة المعتمدة',line:'maintenance'});
      r.maintenance.companies[companyId]={day,policy:maintenancePolicy(state,companyId),threshold:acc.threshold,assets:acc.count,checks:acc.due.length,cost,avgCondition:acc.count?(acc.conditionSum+acc.restored)/acc.count:100};
    }
  }
  // Incidents and insurance (Build 358 step 3). Every asset-day carries an incident risk by mode (air, sea, road), raised
  // by the fleet's wear before the day's checks; an incident costs a share of an asset's value and leaves it at 55%.
  // The repair is billed in full (INC-<company>-<day>, 7-day terms). A company's cover (none / standard / full) opens a
  // claim for the loss above its deductible, which the insurer pays after its 3-day review (updateInsurance); the
  // premium (a share of fleet value by mode, times the market's renewal index) is billed every 30 days.
  const INCIDENT_RATE=Object.freeze({air:.000044,sea:.000077,road:.00038}),PREMIUM_RATE=Object.freeze({air:.0035,sea:.006,road:.03}),INCIDENT_SEVERITY=.15,INCIDENT_SAMPLE=64,INCIDENT_DAMAGE_LIMIT=50;
  // The regulator: an annual operating licence per asset (AOC, ship registry, transport licence), and a monthly
  // inspection that fines a company whose fleet averages under 75% for each asset under 65%.
  // Build 359: CII constants. Deadweight from the catalogue capacity: TEU about 13 t each, cubic metres of gas about
  // 0.5 t, car decks about 2.5 t a car, cruise berths as 50 gross tonnes each (cruise CII uses gross tonnage); tugs are
  // outside CII.
  const CII_CO2_PER_TONNE=3.114,CII_START_YEAR=2026,CII_DWT_PER_UNIT=Object.freeze({'TEU':13,'طن':1,'م³':.5,'سيارات':2.5,'سيارة':2.5,'راكب':50});
  function ciiDeadweight(specs){const per=CII_DWT_PER_UNIT[String(specs?.capacityUnit||'')];return per?Math.max(0,Number(specs?.capacity)||0)*per:0;}
  function ciiReference(dwt){return 1984*Math.pow(Math.max(1,dwt),-.489);}
  const LICENCE_FEE=Object.freeze({air:25000,sea:15000,road:1200}),INSPECTION_FINE=Object.freeze({air:40000,sea:30000,road:5000}),INSPECTION_LINE=75,UNSAFE_CONDITION=65;
  const INSURANCE_COVERS=Object.freeze({none:{deductible:1,premium:0},standard:{deductible:.10,minimum:250000,premium:1},full:{deductible:.02,minimum:50000,premium:1.35}});
  function insuranceCover(state,companyId){const cover=state.advanced?.companies?.[companyId]?.insuranceCover;return Object.prototype.hasOwnProperty.call(INSURANCE_COVERS,cover)?cover:'standard';}
  function* runIncidents(state,maintenance,day){
    const r=migrate(state),fleet=fleetData(),F=globalThis.GH_FINANCE_CORE,stamp=Number(state.simSeconds)||0;r.incidents=Array.isArray(r.incidents)?r.incidents:[];
    state.advanced=state.advanced||{};const book=state.advanced.insurance=state.advanced.insurance&&typeof state.advanced.insurance==='object'?state.advanced.insurance:{claims:[],annualPremium:0};book.claims=Array.isArray(book.claims)?book.claims:[];book.fleetPolicies=Array.isArray(book.fleetPolicies)?book.fleetPolicies:[];const internalInsurer=operationalCompanyForCapability(state,'operations.insurance');
    // Build 359: an active HSE corrective plan (governance safety-audit) lowers incident risk 15% and halves inspection fines.
    state.advanced=state.advanced||{};const safety=state.advanced.safety=state.advanced.safety&&typeof state.advanced.safety==='object'?state.advanced.safety:{};const planActive=!!safety.plan&&day<=Number(safety.plan.untilDay),planRisk=planActive?.85:1,planFine=planActive?.5:1;
    let fleetCount=0,unsafeCount=0;for(const acc of maintenance.companies.values()){fleetCount+=acc.count||0;unsafeCount+=acc.unsafe||0;}
    for(const [companyId,acc] of maintenance.companies){
      if(!acc.count)continue;const cover=insuranceCover(state,companyId),terms=INSURANCE_COVERS[cover],wear=clamp((100-acc.conditionSum/acc.count)/100,0,.45),expected=acc.risk*(1+wear*6)*planRisk,draw=rand(`incident:${companyId}:${day}`),count=Math.floor(expected)+(draw<expected-Math.floor(expected)?1:0);
      if(day%30===0&&terms.premium>0&&F?.execute){const premium=Math.round(acc.premium*terms.premium*clamp(r.insurance.renewalIndex||100,75,190)/100/12),policyReference=`FLEET-POLICY-${String(companyId).toUpperCase()}-${day}`;if(premium>0){if(internalInsurer&&internalInsurer!==companyId){const settlement=F.execute({state},'settle-intercompany-service',{from:companyId,to:internalInsurer,amount:premium,note:`قسط وثيقة أسطول شهرية · تغطية ${cover==='full'?'شاملة':'قياسية'}`,serviceCategory:'قسط تأمين أسطول داخلي',taxCode:'insurance-premium',line:'insurance',ref:policyReference,sourceRefs:[companyId,String(day)]});book.fleetPolicies.unshift({id:policyReference,day,company:companyId,insurerCompanyId:internalInsurer,cover,assetCount:acc.count,insuredValue:acc.value,premium,status:'سارية',transferReference:settlement.reference});book.fleetPolicies=book.fleetPolicies.slice(0,120);}else F.execute({state},'accrue-expense',{company:companyId,amount:premium,note:`قسط تأمين الأسطول الشهري · تغطية ${cover==='full'?'شاملة':'قياسية'}`,method:'فاتورة تأمين',taxable:false,taxCode:'insurance-premium',dueDay:day+7,number:`PREM-${String(companyId).toUpperCase()}-${day}`,paymentTerms:7,counterparty:'شركة التأمين الخارجية',line:'insurance'});}}
      if(day>0&&day%365===0&&acc.licence>0&&F?.execute)F.execute({state},'accrue-expense',{company:companyId,amount:Math.round(acc.licence),note:`تجديد رخص التشغيل السنوية لـ ${acc.count} أصل`,method:'رسوم حكومية',taxable:false,dueDay:day+7,number:`LIC-${String(companyId).toUpperCase()}-${day}`,paymentTerms:7,counterparty:'هيئة النقل',line:'other'});
      if(day%30===15&&acc.unsafe>0&&acc.conditionSum/acc.count<INSPECTION_LINE){const fine=Math.round(acc.fine*planFine);if(F?.execute)F.execute({state},'accrue-expense',{company:companyId,amount:fine,note:`غرامة تفتيش السلامة: ${acc.unsafe} أصل تحت ${UNSAFE_CONDITION}%`,method:'غرامة حكومية',taxable:false,dueDay:day+7,number:`FINE-${String(companyId).toUpperCase()}-${day}`,paymentTerms:7,counterparty:'هيئة السلامة',line:'other'});r.inspections=Array.isArray(r.inspections)?r.inspections:[];r.inspections.unshift({day,company:companyId,unsafe:acc.unsafe,fine,avgCondition:acc.conditionSum/acc.count});r.inspections=r.inspections.slice(0,60);}
      if(!count)continue;
      const hit=[];for(let i=0;i<Math.min(count,INCIDENT_DAMAGE_LIMIT,acc.sample.length);i++){const pick=acc.sample[Math.floor(rand(`incident:${companyId}:${day}:${i}`)*acc.sample.length)%acc.sample.length];if(!hit.includes(pick))hit.push(pick);}
      const average=acc.value/acc.count,loss=Math.round(count*average*INCIDENT_SEVERITY*(Number(globalThis.GH_GOVERNANCE_CORE?.programEffects?.(state)?.incidentRepair)||1));for(const asset of hit)fleet.update(state,asset.id,{condition:55,lastIncidentAt:stamp});
      if(loss>0&&F?.execute)F.execute({state},'accrue-expense',{company:companyId,amount:loss,note:`إصلاح أضرار ${count===1?'حادث':`${count} حوادث`} · اليوم ${day}`,method:'فاتورة إصلاح',taxable:true,dueDay:day+7,number:`INC-${String(companyId).toUpperCase()}-${day}`,paymentTerms:7,counterparty:'ورش الإصلاح المعتمدة',line:'maintenance'});
      const deductible=terms.premium>0?Math.max(terms.minimum||0,loss*terms.deductible):loss,covered=Math.max(0,loss-deductible);let claimId=null;
      if(covered>0){claimId=`CLM-${String(companyId).toUpperCase()}-${day}`;const policy=book.fleetPolicies.find(row=>row.company===companyId&&row.status==='سارية');book.claims.unshift({id:claimId,company:companyId,ownerCompanyId:companyId,insurerCompanyId:policy?.insurerCompanyId||null,policyReference:policy?.id||null,openedAt:stamp,status:'قيد الفحص',loss,deductible,covered,reserve:covered,incidents:count});book.claims=book.claims.slice(0,200);}

      r.incidents.unshift({day,company:companyId,count,loss,cover,deductible:Math.min(loss,deductible),covered,claimId,assets:hit.map(asset=>asset.id)});r.incidents=r.incidents.slice(0,120);
      yield 'realism.incidents';
    }
    // Build 359: the safety score from ratios (share of assets under the unsafe line, incidents of the last 30 days per
    // 1,000 assets), so a large fleet is not pinned at the floor; open findings are the unsafe assets now and close as
    // they are maintained. The incident counter keeps only the last 30 days.
    const recent=(r.incidents||[]).filter(row=>day-Number(row.day)<30).reduce((n,row)=>n+(Number(row.count)||0),0),perThousand=fleetCount?recent/fleetCount*1000:0;
    safety.incidents=recent;safety.openFindings=unsafeCount;safety.unsafeShare=fleetCount?Math.round(unsafeCount/fleetCount*1000)/10:0;safety.incidentsPerThousand=Math.round(perThousand*100)/100;
    safety.score=Math.round(clamp(100-safety.unsafeShare*.8-perThousand*4,0,100));safety.planActive=planActive;
  }
  // Crews (Build 358 step 3). Market wages rise about 3% a year (economy.wageIndex). A company's pay against them
  // (GH_HR_CORE.salaryMultiplier / wageIndex) sets how many of its crews quit (8% a year at market pay, more when
  // underpaid, less when overpaid) and how fast it rehires (2% of the gap a day at market pay). The staffed share of what its fleet needs is the share of
  // trips that fly; the shortage also costs overtime (computeTripEconomics / adjustTripEconomics).
  const WAGE_GROWTH=Math.pow(1.03,1/365),BASE_QUIT=.08,BASE_HIRE=.02;
  function payRatio(state,companyId){const index=Number(globalThis.GH_HR_CORE?.salaryMultiplier?.(state,companyId))||1;return index/Math.max(.5,Number(state.realism?.economy?.wageIndex)||1);}
  function updateCrews(state,day,companies){
    const r=migrate(state),e=r.economy;if(Number(r.crewsDay)>=day)return;r.crewsDay=day;e.wageIndex=Math.round((Number(e.wageIndex)||1)*WAGE_GROWTH*1e6)/1e6;r.crews=r.crews&&typeof r.crews==='object'?r.crews:{};
    for(const companyId of companies){
      let ratio;try{ratio=payRatio(state,companyId);}catch{continue;}
      const row=r.crews[companyId]=r.crews[companyId]&&typeof r.crews[companyId]==='object'?r.crews[companyId]:{staffing:1};
      const quit=BASE_QUIT*(ratio<1?1+6*(1-ratio):Math.max(.4,1-2*(ratio-1))),hire=BASE_HIRE*ratio*ratio,staffing=clamp(Number(row.staffing)||1,0,1);
      row.staffing=Math.round(clamp(staffing-staffing*quit/365+(1-staffing)*hire,.5,1)*1e6)/1e6;row.payRatio=Math.round(ratio*1e4)/1e4;row.annualQuitRate=Math.round(quit*1e4)/1e4;row.day=day;
    }
  }
  function crewShortage(state,companyId){const staffing=Number(state.realism?.crews?.[companyId]?.staffing);return Number.isFinite(staffing)?clamp(1-staffing,0,.5):0;}
  // The wear a company's trips carry: 0 for a fleet at 100%, 0.2 at an average of 80%.
  function fleetWear(state,companyId){const avg=Number(state.realism?.maintenance?.companies?.[companyId]?.avgCondition);return Number.isFinite(avg)?clamp((100-avg)/100,0,.45):0;}
  const FLEET_DAY_FIELDS=Object.freeze([...new Set(['id',...OWNER_TOTAL_FIELDS,...OPS_FIELDS])]);
  function* fleetDayPass(state){
    const fleet=fleetData(),owner=ownerTotalsVisitor(state),ops=opsVisitor(state),maintenance=maintenanceVisitor(state);let insured=0,readiness=0;
    yield* fleet.scanStages(state,FLEET_DAY_FIELDS,(a,index)=>{owner.visit(a);ops.visit(a,index);maintenance.visit(a);const condition=Number(a.condition);insured+=condition||100;readiness+=condition||0;},OPS_SLICE_ROWS,'realism.fleet-day');
    ownerTotalsMemo={state,key:ownerTotalsKey(state),totals:owner.totals};
    const key=conditionSumKey(state);conditionSumMemo=key?{state,key,sum:insured,readiness}:null;
    ops.maintenance=maintenance;return ops;
  }
  function* onDayStages(state,day){
    migrate(state);
    const ops=yield* fleetDayPass(state);
    closeMemo={state,statements:new Map()};try{closeFinancials(state,day);updateBudgets(state,day);}finally{closeMemo=null;}
    yield 'realism.budgets';
    ops.finish(day);yield 'realism.operations';
    updateCrews(state,day,[...ops.maintenance.companies.keys()]);
    yield* runIncidents(state,ops.maintenance,day);
    yield* runMaintenance(state,ops.maintenance,day);
    // Preserve the owner order and results, but return to the frame scheduler between owners. The former combined
    // market/risk and programs stages were measured as one 10-14 ms step on iPhone.
    updateBank(state);yield 'realism.bank';
    updateMarketShare(state,day);yield 'realism.market-share';
    updateRisk(state,day);yield 'realism.risk';
    updateRating(state);yield 'realism.rating';
    updateInsurance(state);yield 'realism.insurance';
    recordMarketDay(state,day);yield 'realism.market-day';
    updateTaxFxAndDividends(state,day);yield 'realism.tax-fx-dividends';
    updatePrograms(state,day);yield 'realism.programs';
    updateReputation(state);yield 'realism.reputation';
    supplierScores(state);yield 'realism.suppliers';
    deliverDueAssets(state,day);yield 'realism.deliveries';
    updateProjects(state,day);yield 'realism.projects';
    updateEventQueue(state,day);yield 'realism.events';
    board(state,day);yield 'realism.board';
    succession(state);yield 'realism.succession';
    morningBrief(state,day);yield 'realism.brief';
    integrity(state,day);
    return 0;
  }
  function onDay(state,day){const stages=onDayStages(state,day);let step;while(!(step=stages.next()).done){}return step.value;}
  function tripModifier(state,asset,eco){
    // Migration/default expansion is a boot/day-boundary concern. Running it
    // once per asset per slice made large fleets repeatedly walk the complete
    // realism tree even though trip pricing only reads an already valid model.
    const r=state.realism?.schema===SCHEMA?state.realism:migrate(state),e=r.economy,owner=assetOwnerCompanyId(state,asset),mode=assetMode(asset);if(!owner)throw new Error(`asset-company-invalid:${asset?.id||'unknown'}`);const share=r.market.share[owner]??r.market.share[mode]??5,pressure=r.market.competitorPressure[owner]??r.market.competitorPressure[mode]??50,rep=(r.reputation[owner]??r.reputation[mode]??70)+(Number(globalThis.GH_GOVERNANCE_CORE?.programEffects?.(state)?.reputation)||0);let demand=mode==='air'?e.airDemand:mode==='sea'?e.seaDemand:e.roadDemand;const demandFactor=clamp((demand/100)*(1+(rep-70)*.003)*(1+(share-5)*.006)*(1-(pressure-50)*.0015),.65,1.35);eco.revenue*=demandFactor;
    const S=globalThis.GH_SIMULATION_ASSET_CORE;eco.fuelCost*=S.fuelPriceFactor(e,mode,globalThis.GH_MARKET_CORE?.hedgeFor?.(state,owner,S.FUEL_OF_MODE[mode]||'diesel'));
    const research=state.research||{},eff=clamp((Number(research.efficiency)||0)/100,0,1),auto=clamp((Number(research.automation)||0)/100,0,1),clean=clamp((Number(research.cleanEnergy)||0)/100,0,1),su=state.sustainability||{};
    // Build 359: efficiency/automation research, SAF and electric road apply once, in GH_ADVANCED.adjustTripEconomics
    // (as the worker's computeTripEconomics); only clean energy research is applied here.
    eco.fuelCost*=1-clean*.018;
    eco.margin=eco.revenue-eco.fuelCost-eco.crewCost-eco.maintReserve-(Number(eco.fees)||0);eco.cashContribution=eco.revenue-eco.fuelCost-eco.maintReserve-(Number(eco.fees)||0);eco.market={demandFactor,share,pressure};eco.capabilityEffects={efficiencyResearch:eff,automationResearch:auto,cleanEnergyResearch:clean};return eco;
  }
  function metric(label,value,cls=''){return `<div><span>${esc(label)}</span><b class="${cls}">${esc(value)}</b></div>`;}
  function section(title,copy,body){return `<article class="list-item realism-section"><div class="list-item-head"><div><h3>${esc(title)}</h3><p>${esc(copy)}</p></div><span class="tag">2.0</span></div>${body}</article>`;}
  function render(ctx){const s=ctx.state,r=migrate(s);const f=r.financial.consolidated||{},b=r.banking,e=r.economy,br=r.morningBriefs[0]||{};return `<div class="workspace-intro realism-intro"><span>REALISM CORE 2.0</span><b>محاكاة مترابطة: اقتصاد → تشغيل → مالية → مخاطر → قرار.</b></div><div class="list">
    ${section('موجز الرئيس التنفيذي',br.headline||'لم يُغلق أول يوم مالي بعد.',`<div class="metric-row">${metric('صافي 30 يوم',money(f.net||0),(f.net||0)>=0?'positive':'negative')}${metric('السيولة',money(s.cash||0))}${metric('تسليمات معلقة',String(br.pendingDeliveries||0))}</div>${(br.risks||[]).length?`<div class="realism-alerts">${br.risks.map(x=>`<span>${esc(x)}</span>`).join('')}</div>`:''}`)}
    ${section('الاقتصاد العالمي الحي',e.lastEvent?.title||'الأسعار والطلب يتحركان بصورة مترابطة وغير عشوائية منفصلة.',`<div class="metric-row">${metric('النفط','$'+e.oil.toFixed(1))}${metric('Jet Fuel','$'+e.jetFuel.toFixed(2)+'/kg')}${metric('Bunker','$'+Math.round(e.bunker)+'/t')}</div><div class="metric-row">${metric('Freight Index',e.freight.toFixed(0))}${metric('الفائدة',(e.baseRate*100).toFixed(2)+'%')}${metric('طلب الطيران',e.airDemand.toFixed(0))}</div>`)}
    ${section('القوائم المالية الموحدة','قائمة دخل وميزانية وتدفقات نقدية مع استبعاد المعاملات الداخلية.',`<div class="metric-row">${metric('الإيراد',money(f.revenue||0))}${metric('EBITDA',money(f.ebitda||0))}${metric('صافي الربح',money(f.net||0),(f.net||0)>=0?'positive':'negative')}</div><div class="metric-row">${metric('الأصول',money(f.assets||0))}${metric('الالتزامات',money(f.liabilities||0))}${metric('إلغاءات داخلية',money(r.financial.intercompanyEliminations||0))}</div>`)}
    ${section('الطيران','ASK / RPK / Load Factor / Yield / CASK / RASK + Reliability / Health Monitoring.',`<div class="metric-row">${metric('Load Factor',r.aviation.loadFactor.toFixed(1)+'%')}${metric('OTP',r.aviation.otp.toFixed(1)+'%')}${metric('Dispatch',r.aviation.dispatchReliability.toFixed(1)+'%',r.aviation.dispatchReliability>=97?'positive':r.aviation.dispatchReliability<94?'negative':'')}</div><div class="metric-row">${metric('RASK',r.aviation.rask.toFixed(3))}${metric('CASK',r.aviation.cask.toFixed(3))}${metric('CASK ex-fuel',r.aviation.caskExFuel.toFixed(3))}</div><div class="metric-row">${metric('Utilization',r.aviation.utilization.toFixed(0)+'%')}${metric('Health',r.aviation.healthMonitoringScore.toFixed(0)+'/100')}${metric('MRO reserve',r.aviation.maintenanceReserveCoverage.toFixed(0)+'%')}</div>`)}
    ${section('البحرية','Utilization + CII/EEXI readiness + Dry Dock + Bunker/Waiting.',`<div class="metric-row">${metric('Utilization',r.maritime.utilization.toFixed(0)+'%')}${metric('CII',r.maritime.cii,r.maritime.correctiveAction?'negative':'positive')}${metric('EEXI readiness',r.maritime.eexiReadiness.toFixed(0)+'/100',r.maritime.eexiReadiness>=70?'positive':'negative')}</div><div class="metric-row">${metric('CII ratio',r.maritime.ciiRatio.toFixed(2)+'x')}${metric('Dry Dock',String(r.maritime.dryDockDue))}${metric('انتظار',r.maritime.waitingHours.toFixed(0)+'h')}</div><div class="metric-row">${metric('Bunker','$'+Math.round(r.maritime.avgBunkerCost)+'/t')}${metric('Demurrage',money(r.maritime.demurrage))}${metric('Corrective plan',r.maritime.correctivePlanStatus|| (r.maritime.correctiveAction?'مطلوب':'غير مطلوب'),r.maritime.correctiveAction?'negative':'positive')}</div>`)}
    ${section('اللوجستيات والمستودعات','On-time / Damage / Empty miles + جودة الجمارك والبنية والتتبع والتوقيت.',`<div class="metric-row">${metric('On-time',r.logistics.onTime.toFixed(1)+'%')}${metric('Utilization',r.logistics.warehouseUtilization.toFixed(0)+'%')}${metric('Empty miles',r.logistics.emptyMiles.toFixed(0)+'%')}</div><div class="metric-row">${metric('Damage',r.logistics.damageRate.toFixed(1)+'%')}${metric('Order cycle',r.logistics.orderCycleHours.toFixed(0)+'h')}${metric('Throughput',String(r.logistics.throughput))}</div><div class="metric-row">${metric('LPI proxy',r.logistics.lpiProxy.toFixed(2)+'/5',r.logistics.lpiProxy>=3.5?'positive':r.logistics.lpiProxy<3?'negative':'')}${metric('Customs',r.logistics.customsScore.toFixed(1)+'/5')}${metric('Shipments',r.logistics.shipmentScore.toFixed(1)+'/5')}${metric('Tracking',r.logistics.trackingScore.toFixed(1)+'/5')}</div>`)}
    ${section('الطاقة والتخزين','SOC / Round-trip efficiency / Storage health / Capacity factor / Reserve margin.',`<div class="metric-row">${metric('Storage SOC',r.energy.storageSoc.toFixed(0)+'%')}${metric('Efficiency',r.energy.roundTripEfficiency.toFixed(1)+'%')}${metric('Storage health',r.energy.storageHealth.toFixed(1)+'%')}</div><div class="metric-row">${metric('Capacity factor',r.energy.capacityFactor.toFixed(1)+'%')}${metric('Available MW',r.energy.availableMW.toFixed(0))}${metric('Reserve margin',r.energy.reserveMargin.toFixed(1)+'%',r.energy.reserveMargin>=0?'positive':'negative')}</div><div class="metric-row">${metric('Renewable mix',r.energy.renewableShare.toFixed(1)+'%')}${metric('Effective storage',r.energy.effectiveStorageMWh.toFixed(0)+' MWh')}${metric('Curtailment',r.energy.curtailment.toFixed(1)+'%')}</div>`)}
    ${section('البنك — Basel','CET1 / Tier 1 / RWA / LCR / NSFR / NPL + headroom والتغطية.',`<div class="metric-row">${metric('CET1',b.cet1.toFixed(1)+'%',b.cet1>=r.risk.limits.minBankCapital?'positive':'negative')}${metric('LCR',b.lcr.toFixed(0)+'%',b.lcr>=100?'positive':'negative')}${metric('NSFR',b.nsfr.toFixed(0)+'%',b.nsfr>=100?'positive':'negative')}</div><div class="metric-row">${metric('CET1 headroom',b.cet1Headroom.toFixed(1)+'pp',b.cet1Headroom>=0?'positive':'negative')}${metric('Tier 1',b.tier1.toFixed(1)+'%',b.tier1>=b.tier1RegMin?'positive':'negative')}${metric('Total capital',b.totalCapital.toFixed(1)+'%',b.totalCapital>=b.totalCapitalRegMin?'positive':'negative')}${metric('Provision cover',b.provisionCoverage.toFixed(0)+'%')}${metric('قروض/ودائع',b.loanDeposit.toFixed(0)+'%')}</div><div class="metric-row">${metric('RWA',money(b.rwa))}${metric('NPL',b.npl.toFixed(1)+'%')}${metric('Stable funding',money(b.stableFundingBuffer),b.stableFundingBuffer>=0?'positive':'negative')}</div>`)}
    ${section('المخاطر والتصنيف الائتماني',`التصنيف ${r.rating.grade} / ${r.rating.outlook}. القرارات اليدوية تُراجع مقابل حدود المخاطر والسيولة.`,`<div class="metric-row">${metric('Rating',r.rating.grade)}${metric('Risk issues',String(r.risk.register.length),r.risk.register.some(x=>x.severity==='high')?'negative':'positive')}${metric('حد السيولة',money(r.risk.limits.minLiquidity||0))}</div>${r.risk.register.length?`<div class="realism-risk-list">${r.risk.register.map(x=>`<div><b>${esc(x.title)}</b><span>${esc(x.value)}</span></div>`).join('')}</div>`:''}`)}
    ${section('المنافسة والسمعة','حصة السوق والضغط التنافسي تتغير حسب الأصول والسمعة والأداء.',`<div class="realism-mini-grid">${SECTORS.map(t=>`<div><span>${names[t]}</span><b>${r.market.share[t].toFixed(1)}%</b><small>ضغط ${r.market.competitorPressure[t].toFixed(0)}/100 · سمعة ${r.reputation[t]}</small></div>`).join('')}</div>`)}
    ${section('مجلس الإدارة والخلافة','اجتماع دوري، قرارات كبرى، وخطة بدلاء للمناصب الحرجة.',`<div class="metric-row">${metric('اجتماعات',String(r.board.meetings.length))}${metric('الاجتماع القادم','يوم '+r.board.nextMeetingDay)}${metric('Succession coverage',Math.round(Object.values(r.people.succession).reduce((n,x)=>n+(x.coverage||0),0)/Math.max(1,Object.keys(r.people.succession).length))+'%')}</div>`)}
    ${section('Procurement & المشاريع','Requisition → RFQ/RFP → تقييم → اعتماد → PO → تسليم، مع Lead Time.',`<div class="metric-row">${metric('Pipeline',String(r.procurement.pipeline.length))}${metric('مشاريع CAPEX',String(r.projects.length))}${metric('موردون مقيمون',String(Object.keys(r.procurement.supplierScores).length))}</div>`)}
    ${section('سلامة النواة','فحص وقائي يومي يمنع التكرار والأرصدة غير الرقمية والأحداث المكررة.',`<div class="metric-row">${metric('Integrity issues',String(r.controls.issues.length),r.controls.issues.length?'negative':'positive')}${metric('Schema',r.schema)}${metric('Core',r.version)}</div>${r.controls.issues.length?`<div class="realism-alerts">${r.controls.issues.map(x=>`<span>${esc(x)}</span>`).join('')}</div>`:''}`)}
  </div>`;}
  function financeHTML(state){const r=migrate(state),types=companyTypes(state);return `<article class="list-item realism-finance-appendix"><div class="list-item-head"><div><h3>القوائم المالية 2.0</h3><p>30 يومًا متحركًا · Consolidation مع استبعاد التعاملات الداخلية وLease liabilities.</p></div><span class="tag positive">${esc(r.rating.grade)}</span></div><div class="realism-mini-grid">${types.map(t=>{const s=r.financial.statements[t]||statements(state,t);return `<div><span>${esc(entityName(state,t))}</span><b>${money(s.net||0)}</b><small>إيراد ${money(s.revenue||0)} · أصول ${money(s.assets||0)}</small></div>`}).join('')}</div></article><article class="list-item realism-finance-appendix"><h3>Budget / Actual / Forecast / Variance</h3><div class="realism-budget-table">${types.map(t=>{const b=r.budgets[t]||(r.budgets[t]=defaultBudget()),plan=Object.values(b.lines).reduce((a,x)=>a+(Number(x)||0),0),actual=Object.values(b.actual).reduce((a,x)=>a+(Number(x)||0),0),forecast=Object.values(b.forecast).reduce((a,x)=>a+(Number(x)||0),0);return `<div><b>${esc(entityName(state,t))}</b><span>${money(plan)}</span><span>${money(actual)}</span><span>${money(forecast)}</span><span class="${forecast<=plan?'positive':'negative'}">${money(forecast-plan)}</span></div>`}).join('')}<div class="budget-head"><b>الشركة</b><span>Budget</span><span>Actual</span><span>Forecast</span><span>Variance</span></div></div></article>`;}
  window.GH_REALISM={VERSION,SCHEMA,migrate,fleetReadinessTotal,reconcilePendingDeliveryCount,hasPendingDeliveries,nextDeliveryDueAt,deliveryDueBy,simulationSliceLimit,onHour,onDay,onDayStages,onSimulationTime:deliverDueAssetsAt,tripModifier,fuelForward,gasForward,recordMarketDay,updateRating,MAINTENANCE_POLICIES,maintenancePolicy,fleetWear,INSURANCE_COVERS,insuranceCover,runIncidents,updateCrews,crewShortage,payRatio,render,financeHTML,statements,bankingMetrics,deliveryCapacity,companyTypes,assetMode,assetOwnerCompanyId};
})();

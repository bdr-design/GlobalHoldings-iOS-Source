(()=>{
  'use strict';
  // Build 358 (owner request: an integrated real-estate company where the customer base and realism come first). The
  // company has no fleet: its sales and leasing offices (facilities of kind "realestate", one per capital from the world
  // directory) develop projects in their city and sell or lease the units to the people and businesses there.
  //
  // Customer base. A country's households are its population over 4.5; each year some of them move (6%), and the group
  // can win a share of them that depends on its price against the market. Businesses (one per 40 people) take offices,
  // shops and warehouses. Buyers and tenants arrive day by day for each project, more slowly as the price rises above
  // the market and as the project fills; leases end every year (15% at market rent, more above it) and the units go
  // back on the market.
  //
  // Development. A project is land plus construction in three milestones (40% at the start with the land, 30% at half
  // time, 30% at completion), each paid by cheque to the contractor as capital spending (the game's construction line).
  // Units of a project for sale can be sold off-plan at 5% below the price; their revenue and cost are recognised at
  // handover (completion), later sales on the day of sale. Units for lease earn their rent day by day once completed.
  //
  // Decisions. Which project, where and how big; sale or lease; the price or rent level (85% to 125% of the market);
  // corporate tenants who ask for a block of units at their rent and term (accept or decline).
  //
  // Accounts. Construction is paid by cheque at its milestones and booked then (as every construction contract in the
  // game). The day's revenue (sales handed over, rent) and expenses (property running costs, commissions) reach the
  // group's daily close through dailyResult(); the cost of the units sold is reported for the margin only, because
  // its cash and expense already left with the construction cheques. The offices' own running costs are their facility
  // costs (the company definition's site template), posted by the close. If the company cannot pay a milestone, the
  // project waits (one day later each day) instead of failing the close. Nothing here writes a document per unit or
  // tenant.
  //
  // Load. Units and tenants are counts per project, not records; at most 30 active projects, 5 open tenant requests,
  // history capped at 90 days (the screens read 30), 40 decisions kept. No per-frame work.
  const VERSION='3.0.0';
  const num=value=>Math.max(0,Number(value)||0),now=state=>Number(state.simSeconds)||0;
  const clamp=(value,min,max)=>Math.max(min,Math.min(max,Number(value)||0));
  const clone=value=>globalThis.structuredClone?structuredClone(value):JSON.parse(JSON.stringify(value));
  function hash(text){let h=2166136261>>>0;for(const ch of String(text)){h^=ch.charCodeAt(0);h=Math.imul(h,16777619)>>>0;}return h>>>0;}
  function deterministic(seed,min,max){return min+(hash(seed)/4294967295)*(max-min);}
  const roundDraw=(value,seed)=>Math.floor(Math.max(0,value)+deterministic(seed,0,1));
  const TYPES=Object.freeze({
    residential:{name:'برج سكني',units:200,unitCost:180000,price:260000,rent:18000,days:540,buyers:'household',modes:['sale','lease']},
    villas:{name:'مجمع فلل',units:60,unitCost:420000,price:600000,rent:36000,days:420,buyers:'household',modes:['sale','lease']},
    office:{name:'برج مكاتب',units:80,unitCost:1200000,price:1800000,rent:140000,days:720,buyers:'business',modes:['lease','sale']},
    retail:{name:'مركز تجاري',units:120,unitCost:600000,price:900000,rent:70000,days:720,buyers:'business',modes:['lease']},
    logistics:{name:'مستودعات لوجستية',units:40,unitCost:900000,price:1300000,rent:85000,days:365,buyers:'business',modes:['lease','sale']}
  });
  const TYPE_IDS=Object.freeze(Object.keys(TYPES));
  const LAND_SHARE=.18,MILESTONES=Object.freeze([.4,.3,.3]),OFF_PLAN_DISCOUNT=.95,SALES_COMMISSION=.02,PROPERTY_OPEX=.012;
  const HOUSEHOLD_SIZE=4.5,MOVE_RATE=.06,BUSINESS_PER_PEOPLE=40,DEFAULT_POPULATION=10000000,BASE_LEASE_CHURN=.15;
  const PRICE_LEVELS=Object.freeze([.85,.9,.95,1,1.05,1.1,1.15,1.25]),SIZE_LEVELS=Object.freeze([.5,1,1.5,2]);
  const MAX_ACTIVE_PROJECTS=30,MAX_OPEN_REQUESTS=5,MAX_INTERNAL_LEASES=120,REQUEST_DAYS=10,INTERNAL_RENT_SETTLE_DAYS=30,HISTORY=40,DAILY_HISTORY=90;
  function countryPopulation(country){const bank=globalThis.GH_BANKING_CORE;if(typeof bank?.countryPopulation==='function')return bank.countryPopulation(country);const row=(Array.isArray(globalThis.GH_MAP_LABELS)?globalThis.GH_MAP_LABELS:[]).find(item=>item?.name===String(country||'').trim());return Number(row?.population)>0?Number(row.population):DEFAULT_POPULATION;}
  function officeTemplate(p={}){return {id:String(p.id||''),facilityId:String(p.facilityId||''),city:String(p.city||'غير محدد'),country:String(p.country||'غير محدد'),openedAt:Number(p.openedAt)||0,active:p.active!==false,marketPopulation:Number(p.marketPopulation)>0?Number(p.marketPopulation):0,today:p.today&&typeof p.today==='object'?{...p.today}:null};}
  function ensure(state){
    const re=state.realEstate=state.realEstate&&typeof state.realEstate==='object'&&!Array.isArray(state.realEstate)?state.realEstate:{};
  for(const key of ['offices','projects','dailyHistory','tenantRequests','requestHistory','completedArchive','requestDecisionBatches'])re[key]=Array.isArray(re[key])?re[key].filter(Boolean):[];
    re.internalRentAccounts=re.internalRentAccounts&&typeof re.internalRentAccounts==='object'&&!Array.isArray(re.internalRentAccounts)?re.internalRentAccounts:{};
    re.sequence=Math.max(0,Math.floor(Number(re.sequence)||0));re.offices=re.offices.map(officeTemplate);syncOffices(state,re);
    re.ytd=re.ytd&&typeof re.ytd==='object'?re.ytd:{};for(const key of ['sales','rent','costOfSales','opex','commission','net','capex'])re.ytd[key]=Number(re.ytd[key])||0;
    re.lastProcessedDay=Number.isFinite(Number(re.lastProcessedDay))?Math.floor(Number(re.lastProcessedDay)):-1;return re;
  }
  function syncOffices(state,re){
    const facilities=[...(state.customHubs||[]),...(state.globalBases||[])].filter(row=>row?.owned===true&&row.kind==='realestate'&&String(row.ownerCompanyId||row.companyId||row.company||'')==='realestate');
    for(const facility of facilities)if(!re.offices.some(row=>row.facilityId===facility.id))re.offices.push(officeTemplate({id:`RE-OFF-${++re.sequence}`,facilityId:facility.id,city:facility.city,country:facility.country,openedAt:now(state)}));
    const owned=new Set(facilities.map(row=>row.id));for(const office of re.offices)if(!owned.has(office.facilityId))office.active=false;return re.offices;
  }
  // A country's yearly movers and businesses; the group's offices there share them.
  function officeMarket(re,office){
    if(!(Number(office.marketPopulation)>0))office.marketPopulation=countryPopulation(office.country);
    const peers=Math.max(1,re.offices.filter(row=>row.active&&row.country===office.country).length),households=num(office.marketPopulation)/HOUSEHOLD_SIZE;
    return {population:num(office.marketPopulation),households:Math.round(households),moversPerDay:households*MOVE_RATE/365/peers,businesses:Math.round(num(office.marketPopulation)/BUSINESS_PER_PEOPLE/peers)};
  }
  const priceFactor=level=>clamp(Math.pow(1/Math.max(.5,level),3),.3,2.2);
  // Daily arrivals of buyers or tenants for one project at the market price: they grow with the square root of the
  // market (a 200-unit tower in Riyadh sells in about 16 months, 60 villas in Manama in about 20), shaped by the price
  // level and by how full the project already is.
  function arrivals(re,project,office){
    const market=officeMarket(re,office),type=TYPES[project.type],base=type.buyers==='household'?.012*Math.sqrt(market.moversPerDay):.0004*Math.sqrt(market.businesses);
    const free=Math.max(0,project.units-project.sold-project.presold-project.leased),room=project.units?free/project.units:0;
    return base*priceFactor(project.priceLevel)*clamp(room*1.4,0,1);
  }
  function projectQuote(type,size=1,level=1){
    const t=TYPES[type];if(!t)throw new Error('realestate-type-invalid');const units=Math.max(10,Math.round(t.units*size)),build=units*t.unitCost,land=Math.round(build*LAND_SHARE);
    return {type,name:t.name,units,land,build,total:land+build,days:Math.round(t.days*(size>1?1+(size-1)*.35:1)),unitPrice:Math.round(t.price*level),unitRent:Math.round(t.rent*level),saleValue:Math.round(units*t.price*level),annualRent:Math.round(units*t.rent*level),modes:t.modes};
  }
  function payContractor(state,project,amount,stage){
    const F=globalThis.GH_FINANCE_CORE;if(!F?.execute)throw new Error('finance-core-missing');
    const payment=F.execute({state},'pay-by-cheque',{company:'realestate',amount:Math.round(amount),note:`إنشاء ${project.name} · ${stage}`,beneficiary:`مقاول البناء · ${project.city}`,line:'capex',requestRef:`RE-BUILD-${project.id}-${stage}`});
    if(!payment?.cheque?.id||payment.cheque.status!=='مصروف')throw new Error('realestate-cheque-not-cleared');return payment.cheque.id;
  }
  // A milestone due in the daily close: paid when the company has the cash, otherwise the project waits a day.
  function payMilestone(state,project,amount,stage){
    if(num(globalThis.GH_FINANCE_CORE?.operating?.(state,'realestate'))<amount){project.completeDay++;project.waitingDays=(Number(project.waitingDays)||0)+1;return false;}
    project.cheques.push(payContractor(state,project,amount,stage));return true;
  }
  function startProject(state,p){
    const re=ensure(state),office=re.offices.find(row=>row.id===p.officeId||row.facilityId===p.officeId);if(!office||!office.active)throw new Error('realestate-office-required');
    if(re.projects.filter(row=>row.status!=='مكتمل'||row.units>row.sold).length>=MAX_ACTIVE_PROJECTS)throw new Error('realestate-project-limit');
    const type=String(p.type||''),size=Number(p.size)||1,level=Number(p.priceLevel)||1,mode=String(p.mode||'');if(!TYPES[type])throw new Error('realestate-type-invalid');if(!SIZE_LEVELS.includes(size))throw new Error('realestate-size-invalid');if(!PRICE_LEVELS.includes(level))throw new Error('realestate-price-invalid');if(!TYPES[type].modes.includes(mode))throw new Error('realestate-mode-invalid');
    const q=projectQuote(type,size,level),first=q.land+q.build*MILESTONES[0],F=globalThis.GH_FINANCE_CORE;if(num(F?.operating?.(state,'realestate'))<first)throw new Error('insufficient-cash');
    const day=Math.floor(now(state)/86400),project={id:`RE-PRJ-${++re.sequence}`,officeId:office.id,city:office.city,country:office.country,type,name:`${q.name} · ${office.city}`,mode,units:q.units,unitCost:Math.round((q.land+q.build)/q.units),landCost:q.land,buildCost:q.build,priceLevel:level,startDay:day,completeDay:day+q.days,status:'قيد الإنشاء',milestonesPaid:0,sold:0,presold:0,leased:0,handedOver:0,salesRevenue:0,rentRevenue:0,today:null};
    project.cheques=[payContractor(state,project,first,'الأرض والدفعة الأولى')];project.milestonesPaid=1;const legal=F.execute({state},'register-commercial-contract',{id:`LEGAL-${project.id}`,company:'realestate',contractType:'عقد أرض وإنشاء',counterparty:`مقاول البناء · ${project.city}`,title:`عقد تطوير ${project.name}`,startDay:day,endDay:project.completeDay,amount:q.total,terms:{officeId:office.id,country:office.country,type,mode,units:q.units,landCost:q.land,buildCost:q.build,milestones:[...MILESTONES]},sourceRefs:[project.id],linkedDocumentNumbers:project.cheques});project.legalDocumentId=legal.id;project.documentProofId=legal.documentProofId;project.contentDigest=legal.contentDigest;re.ytd.capex+=first;re.projects.push(project);return clone(project);
  }
  function setProjectPrice(state,p){const re=ensure(state),project=re.projects.find(row=>row.id===p.projectId);if(!project)throw new Error('realestate-project-not-found');const level=Number(p.level);if(!PRICE_LEVELS.includes(level))throw new Error('realestate-price-invalid');project.priceLevel=level;return clone(project);}
  // Corporate tenants: a business asks for a block of completed (or soon completed) units at its rent and term.
  const TENANTS=Object.freeze(['شركة استشارات دولية','مجموعة تجزئة إقليمية','شركة تقنية ناشئة','مكتب محاماة','بنك استثماري','شركة توزيع أغذية','مزود خدمات لوجستية']);
  function generateRequest(state,re,day){
    if(re.tenantRequests.length>=MAX_OPEN_REQUESTS||deterministic(`${day}:re-request`,0,1)>=.25)return null;
    const candidates=re.projects.filter(row=>row.mode==='lease'&&TYPES[row.type].buyers==='business'&&row.units-row.leased>=4&&(row.status==='مكتمل'||row.completeDay-day<=60));if(!candidates.length)return null;
    const project=candidates[Math.floor(deterministic(`${day}:re-request:project`,0,candidates.length))%candidates.length],free=project.units-project.leased,units=Math.max(2,Math.min(free,Math.round(free*deterministic(`${day}:re-request:units`,.1,.35)))),rentLevel=Math.round(deterministic(`${day}:re-request:rent`,.85,1.02)*100)/100,years=[3,5,7,10][Math.floor(deterministic(`${day}:re-request:term`,0,4))%4];
    const request={id:`RE-REQ-${++re.sequence}`,day,expiresDay:day+REQUEST_DAYS,tenant:TENANTS[Math.floor(deterministic(`${day}:re-request:tenant`,0,TENANTS.length))%TENANTS.length],projectId:project.id,projectName:project.name,units,rentLevel,annualRent:Math.round(units*TYPES[project.type].rent*rentLevel),years,status:'بانتظار القرار'};
    re.tenantRequests.push(request);return request;
  }
  function closeRequest(re,request,status,extra={}){re.tenantRequests=re.tenantRequests.filter(row=>row.id!==request.id);re.requestHistory.unshift({...request,...extra,status});re.requestHistory=re.requestHistory.slice(0,HISTORY);}
  function decideRequest(state,p){
    const re=ensure(state),request=re.tenantRequests.find(row=>row.id===String(p.id||''));if(!request)throw new Error('realestate-request-not-found');
    const day=Math.floor(now(state)/86400);if(day>=Number(request.expiresDay)){closeRequest(re,request,'منتهي',{decidedDay:day});return {id:request.id,status:'منتهي',reason:'realestate-request-expired'};}
    if(p.decision==='decline'){closeRequest(re,request,'معتذر عنه',{decidedDay:day});return {id:request.id,status:'معتذر عنه'};}
    if(p.decision!=='accept')throw new Error('realestate-request-decision-invalid');
    const project=re.projects.find(row=>row.id===request.projectId);if(!project)throw new Error('realestate-project-not-found');const units=Math.min(Math.floor(Number(request.units)||0),Math.max(0,project.units-project.leased));if(units<=0)throw new Error('realestate-no-free-units');
    const annualRent=Math.round(units*TYPES[project.type].rent*Number(request.rentLevel||1));project.leases=Array.isArray(project.leases)?project.leases:[];const startDay=Math.max(day,project.completeDay),endDay=startDay+request.years*365,F=globalThis.GH_FINANCE_CORE;if(!F?.execute)throw new Error('finance-core-missing');const legal=F.execute({state},'register-commercial-contract',{id:`LEGAL-LEASE-${request.id}`,company:'realestate',contractType:'عقد إيجار مؤسسي',counterparty:request.tenant,title:`إيجار ${project.name}`,startDay,endDay,amount:annualRent*request.years,terms:{projectId:project.id,units,rentLevel:request.rentLevel,annualRent,years:request.years},sourceRefs:[request.id,project.id]}),lease={id:request.id,tenant:request.tenant,units,rentLevel:request.rentLevel,annualRent,startDay,endDay,legalDocumentId:legal.id,documentProofId:legal.documentProofId,contentDigest:legal.contentDigest};project.leases.push(lease);project.leased+=units;
    closeRequest(re,request,'مقبول',{decidedDay:day,units,annualRent});return {id:request.id,status:'مقبول',units,annualRent};
  }
  function decideRequestsBatch(state,p={}){
    const tx=globalThis.GH_TRANSACTION_CORE;if(!tx?.isActive?.())throw new Error('realestate-batch-transaction-required');
    const re=ensure(state),day=Math.floor(now(state)/86400),batchId=String(p.batchId||'').trim(),periodId=String(p.periodId??Math.floor(day/30)),decisions=Array.isArray(p.decisions)?p.decisions:[];
    if(!batchId||batchId.length>120)throw new Error('realestate-batch-id-required');if(!decisions.length||decisions.length>MAX_OPEN_REQUESTS)throw new Error('realestate-request-batch-size-invalid');
    const normalized=decisions.map(row=>({id:String(row?.id||''),decision:String(row?.decision||'')})).sort((a,b)=>a.id.localeCompare(b.id));
    if(normalized.some(row=>!row.id||!['accept','decline'].includes(row.decision)))throw new Error('realestate-request-batch-decision-invalid');if(new Set(normalized.map(row=>row.id)).size!==normalized.length)throw new Error('realestate-request-batch-duplicate-id');
    const fingerprint=JSON.stringify({periodId,decisions:normalized}),prior=re.requestDecisionBatches.find(row=>row.batchId===batchId);if(prior){if(prior.fingerprint!==fingerprint)throw new Error('realestate-batch-reference-conflict');return clone(prior.result);}
    const items=[];let accepted=0,declined=0,skipped=0,totalUnits=0,totalAnnualRent=0;
    for(const item of normalized){
      const request=re.tenantRequests.find(row=>row.id===item.id);if(!request){items.push({requestId:item.id,status:'تجاوز',reason:'realestate-request-not-found'});skipped++;continue;}
      if(day>=Number(request.expiresDay)){const result=decideRequest(state,{id:item.id,decision:item.decision});items.push({...result,reason:'realestate-request-expired'});skipped++;continue;}
      if(item.decision==='accept'){
        const project=re.projects.find(row=>row.id===request.projectId);if(!project){items.push({requestId:item.id,status:'تجاوز',reason:'realestate-project-not-found'});skipped++;continue;}
        const available=Math.max(0,Math.floor(Number(project.units)||0)-Math.floor(Number(project.leased)||0));if(available<=0){items.push({requestId:item.id,status:'تجاوز',reason:'realestate-no-free-units'});skipped++;continue;}
      }
      // Any unexpected Finance/document error aborts this enclosing domain transaction, so the whole batch rolls
      // back. Expected per-item skips are classified before making writes; no half-created lease is caught here.
      const result=decideRequest(state,{id:item.id,decision:item.decision});items.push({...result});
      if(item.decision==='accept'){accepted++;totalUnits+=Number(result.units)||0;totalAnnualRent+=Number(result.annualRent)||0;}else declined++;
    }
    const result={batchId,periodId,accepted,declined,skipped,totalUnits,totalAnnualRent,items};re.requestDecisionBatches.unshift({batchId,fingerprint,result:clone(result),at:now(state)});re.requestDecisionBatches.splice(HISTORY);return result;
  }
  function leaseToCompany(state,p={}){
    const re=ensure(state),project=re.projects.find(row=>row.id===String(p.projectId||''));if(!project)throw new Error('realestate-project-not-found');
    const leaseId=String(p.leaseId||'').trim(),companyId=String(p.companyId||'').trim(),units=Number(p.units),rentLevel=Number(p.rentLevel),years=Number(p.years),type=TYPES[project.type];
    if(!leaseId)throw new Error('realestate-internal-lease-id-required');
    const duplicate=project.leases?.find(row=>row.id===leaseId);if(duplicate){if(duplicate.tenantCompanyId!==companyId||Number(duplicate.units)!==units||Number(duplicate.rentLevel)!==rentLevel||Number(duplicate.years)!==years)throw new Error('realestate-internal-lease-reference-conflict');return clone(duplicate);}
    if(project.mode!=='lease'||project.status!=='مكتمل'||!type)throw new Error('realestate-internal-lease-project-unavailable');
    if(companyId==='realestate'||companyId==='group')throw new Error('realestate-internal-lease-tenant-invalid');
    const platform=globalThis.GH_COMPANY_PLATFORM;if(!platform?.requireCompany)throw new Error('company-platform-unavailable');
    const tenant=platform.requireCompany(state,companyId,{registered:true,operational:true,capability:'finance.book'}),count=Math.floor(units),yearsAllowed=[1,3,5,10];
    if(!Number.isSafeInteger(units)||count!==units||count<1||count>Math.max(0,project.units-project.leased))throw new Error('realestate-internal-lease-units-invalid');
    if(!PRICE_LEVELS.includes(rentLevel)||!yearsAllowed.includes(years))throw new Error('realestate-internal-lease-terms-invalid');
    const internalCount=re.projects.reduce((sum,row)=>sum+(row.leases||[]).filter(lease=>lease.tenantCompanyId).length,0);if(internalCount>=MAX_INTERNAL_LEASES)throw new Error('realestate-internal-lease-capacity');
    const day=Math.floor(now(state)/86400),annualRent=Math.round(count*type.rent*rentLevel),startDay=Math.max(day,project.completeDay),endDay=startDay+years*365,F=globalThis.GH_FINANCE_CORE;
    if(!F?.execute)throw new Error('finance-core-missing');
    const legal=F.execute({state},'register-commercial-contract',{id:`LEGAL-${leaseId}`,company:'realestate',contractType:'عقد إيجار داخلي للمجموعة',counterparty:tenant.identity?.legalName||tenant.id,title:`إيجار داخلي · ${project.name}`,startDay,endDay,amount:annualRent*years,terms:{projectId:project.id,tenantCompanyId:tenant.id,units:count,rentLevel,annualRent,years,internal:true,settlementDays:INTERNAL_RENT_SETTLE_DAYS},sourceRefs:[leaseId,project.id]}),lease={id:leaseId,tenant:tenant.identity?.legalName||tenant.id,tenantCompanyId:tenant.id,internal:true,units:count,rentLevel,annualRent,years,startDay,endDay,legalDocumentId:legal.id,documentProofId:legal.documentProofId,contentDigest:legal.contentDigest};
    project.leases=Array.isArray(project.leases)?project.leases:[];project.leases.push(lease);project.leased+=count;re.sequence++;return clone(lease);
  }
  function tickDay(state,p={}){
    const re=ensure(state),day=Math.max(0,Math.floor(Number(p.day)||Math.floor(now(state)/86400)));if(re.lastProcessedDay===day)return re.dailyHistory.find(row=>row.day===day)||{day,idempotent:true};
    let sales=0,rent=0,internalRentRevenue=0,costOfSales=0,opex=0,commission=0,capex=0,newBuyers=0,newTenants=0,vacated=0;const completed=[],internalRentByCompany=new Map();
    for(const project of re.projects){
      const office=re.offices.find(row=>row.id===project.officeId),type=TYPES[project.type],today={day,sold:0,leased:0,vacated:0,rent:0,sales:0};
      // Construction milestones and completion.
      if(project.status==='قيد الإنشاء'){
        const half=project.startDay+Math.floor((project.completeDay-project.startDay)/2);
        if(project.milestonesPaid===1&&day>=half){const amount=project.buildCost*MILESTONES[1];if(payMilestone(state,project,amount,'منتصف الإنشاء')){project.milestonesPaid=2;capex+=amount;}}
        if(project.milestonesPaid===2&&day>=project.completeDay&&payMilestone(state,project,project.buildCost*MILESTONES[2],'التسليم')){const amount=project.buildCost*MILESTONES[2];project.milestonesPaid=3;capex+=amount;project.status='مكتمل';completed.push(project.id);
          // Off-plan units are handed over now: their revenue and cost are recognised at completion.
          if(project.presold){const revenue=project.presold*Math.round(type.price*project.priceLevel*OFF_PLAN_DISCOUNT);sales+=revenue;costOfSales+=project.presold*project.unitCost;commission+=revenue*SALES_COMMISSION;project.salesRevenue+=revenue;project.sold+=project.presold;project.handedOver+=project.presold;project.presold=0;today.sales+=revenue;}}
      }
      if(office&&office.active){
        const arriving=roundDraw(arrivals(re,project,office),`${project.id}:${day}:arrivals`),free=Math.max(0,project.units-project.sold-project.presold-project.leased),take=Math.min(free,arriving);
        if(take>0&&project.mode==='sale'){
          if(project.status==='مكتمل'){const revenue=take*Math.round(type.price*project.priceLevel);sales+=revenue;costOfSales+=take*project.unitCost;commission+=revenue*SALES_COMMISSION;project.salesRevenue+=revenue;project.sold+=take;project.handedOver+=take;today.sales+=revenue;}
          else project.presold+=take;
          today.sold=take;newBuyers+=take;
        }else if(take>0&&project.mode==='lease'&&project.status==='مكتمل'){project.leased+=take;today.leased=take;newTenants+=take;commission+=take*type.rent*project.priceLevel/12;}
      }
      if(project.status==='مكتمل'&&project.mode==='lease'){
        // Walk-in tenants rent at the project's level; corporate leases at their own rent until their end day.
        const leases=Array.isArray(project.leases)?project.leases:[],walkIn=Math.max(0,project.leased-leases.reduce((sum,row)=>sum+row.units,0));
        const churn=clamp(BASE_LEASE_CHURN*(1+(project.priceLevel-1)*2.5),.05,.5),leaving=Math.min(walkIn,roundDraw(walkIn*churn/365,`${project.id}:${day}:churn`));
        project.leased-=leaving;today.vacated=leaving;vacated+=leaving;
        for(const lease of leases)if(day>=lease.endDay&&!lease.ended){lease.ended=true;project.leased=Math.max(0,project.leased-lease.units);const F=globalThis.GH_FINANCE_CORE;if(lease.tenantCompanyId&&lease.legalDocumentId&&F?.ensure?.(state)?.commercialContracts?.some(row=>row.id===lease.legalDocumentId))F.execute({state},'update-commercial-contract-status',{id:lease.legalDocumentId,status:'منتهي',endedAt:day,reason:'انتهاء مدة الإيجار الداخلي'});}
        project.leases=leases.filter(row=>!row.ended);
        const activeLeases=leases.filter(row=>day>=row.startDay&&day<row.endDay),dailyRent=(Math.max(0,walkIn-leaving)*type.rent*project.priceLevel+activeLeases.reduce((sum,row)=>sum+row.units*type.rent*row.rentLevel,0))/365;
        rent+=dailyRent;project.rentRevenue+=dailyRent;today.rent=dailyRent;
        for(const lease of activeLeases)if(lease.tenantCompanyId){const amount=lease.units*type.rent*lease.rentLevel/365,companyId=lease.tenantCompanyId,row=internalRentByCompany.get(companyId)||{companyId,amount:0,sourceRefs:[]};row.amount+=amount;if(row.sourceRefs.length<80&&!row.sourceRefs.includes(lease.id))row.sourceRefs.push(lease.id);internalRentByCompany.set(companyId,row);internalRentRevenue+=amount;}
      }
      if(project.status==='مكتمل'){const held=project.mode==='lease'?project.units:Math.max(0,project.units-project.sold);opex+=held*project.unitCost*PROPERTY_OPEX/365;}
      project.today=today;
    }
    // A sold-out sale project leaves the active list for a compact archive record.
    const done=re.projects.filter(row=>row.mode==='sale'&&row.status==='مكتمل'&&row.sold>=row.units);
    for(const row of done){re.completedArchive.unshift({id:row.id,name:row.name,units:row.units,salesRevenue:row.salesRevenue,completeDay:row.completeDay});}
    re.completedArchive=re.completedArchive.slice(0,100);re.projects=re.projects.filter(row=>!done.includes(row));
    for(const request of [...re.tenantRequests])if(day>=Number(request.expiresDay))closeRequest(re,request,'منتهي',{decidedDay:day});
    const internalRentRows=[...internalRentByCompany.values()].map(row=>({...row,amount:Math.round(row.amount*100)/100})),internalRentSettlements=[],accounts=re.internalRentAccounts,F=globalThis.GH_FINANCE_CORE;
    for(const row of internalRentRows){const account=accounts[row.companyId]||(accounts[row.companyId]={companyId:row.companyId,openedDay:day,amount:0,days:0,sourceRefs:[]});account.amount=Math.round((num(account.amount)+row.amount)*100)/100;account.days=Math.max(0,Math.floor(Number(account.days)||0))+1;for(const ref of row.sourceRefs)if(account.sourceRefs.length<80&&!account.sourceRefs.includes(ref))account.sourceRefs.push(ref);}
    for(const companyId of Object.keys(accounts).sort()){
      const account=accounts[companyId];if(!account||num(account.amount)<=0){delete accounts[companyId];continue;}if(Number(account.days)<INTERNAL_RENT_SETTLE_DAYS)continue;
      try{const result=F.execute({state},'settle-intercompany-service',{from:companyId,to:'realestate',amount:account.amount,note:`إيجار عقاري داخلي · ${account.days} يومًا`,serviceCategory:'إيجار عقاري داخلي',taxCode:'intercompany-tax-group',line:'other',ref:`RE-INT-RENT-${companyId}-${day}`,sourceRefs:account.sourceRefs});internalRentSettlements.push({companyId,amount:account.amount,days:account.days,reference:result.reference});delete accounts[companyId];}
      catch(error){if(!/insufficient-service-cash-or-budget/.test(String(error?.message||error)))throw error;account.carriedOver=(Number(account.carriedOver)||0)+1;}
    }
    const revenue=sales+rent,expense=opex+commission,net=revenue-expense;
    const report={day,sales,rent,internalRentRevenue,internalRentRows,internalRentSettlements,costOfSales,opex,commission,capex,revenue,expense,net,newBuyers,newTenants,vacated,completed,newRequest:generateRequest(state,re,day)?.id||null};
    re.ytd.sales+=sales;re.ytd.rent+=rent;re.ytd.costOfSales+=costOfSales;re.ytd.opex+=opex;re.ytd.commission+=commission;re.ytd.net+=net;re.ytd.capex+=capex;
    re.dailyHistory.unshift(report);re.dailyHistory=re.dailyHistory.slice(0,DAILY_HISTORY);re.lastProcessedDay=day;return clone(report);
  }
  function dailyResult(state,day){const row=(state.realEstate?.dailyHistory||[]).find(item=>Number(item.day)===Number(day));if(!row)return {revenue:0,expense:0,cashRevenue:0,cashExpense:0,internalRentRows:[],internalRentSettlements:[]};return {revenue:num(row.revenue),expense:num(row.expense),cashRevenue:Math.max(0,num(row.revenue)-num(row.internalRentRevenue)),cashExpense:num(row.expense),internalRentRows:Array.isArray(row.internalRentRows)?row.internalRentRows:[],internalRentSettlements:Array.isArray(row.internalRentSettlements)?row.internalRentSettlements:[]};}
  function summary(state){
    const re=ensure(state),projects=re.projects,completedLease=projects.filter(row=>row.status==='مكتمل'&&row.mode==='lease'),leasable=completedLease.reduce((s,r)=>s+r.units,0),leased=completedLease.reduce((s,r)=>s+r.leased,0),window30=re.dailyHistory.slice(0,30);
    const annualRentRoll=completedLease.reduce((sum,project)=>{const type=TYPES[project.type],leases=Array.isArray(project.leases)?project.leases:[],contracted=leases.reduce((total,row)=>total+row.units*type.rent*row.rentLevel,0),walkIn=Math.max(0,project.leased-leases.reduce((total,row)=>total+row.units,0));return sum+contracted+walkIn*type.rent*project.priceLevel;},0);
    const internalRentReceivable=Object.values(re.internalRentAccounts).reduce((sum,row)=>sum+num(row?.amount),0);
    return {offices:re.offices.length,projects:projects.length,underConstruction:projects.filter(row=>row.status==='قيد الإنشاء').length,units:projects.reduce((s,r)=>s+r.units,0),occupancy:leasable?leased/leasable:0,unsoldUnits:projects.filter(row=>row.mode==='sale').reduce((s,r)=>s+Math.max(0,r.units-r.sold-r.presold),0),presold:projects.reduce((s,r)=>s+r.presold,0),revenue30:window30.reduce((s,r)=>s+num(r.revenue),0),net30:window30.reduce((s,r)=>s+Number(r.net||0),0),capex30:window30.reduce((s,r)=>s+num(r.capex),0)+projects.filter(row=>row.startDay>Math.floor(now(state)/86400)-30).reduce((s,r)=>s+num(r.landCost)+num(r.buildCost)*MILESTONES[0],0),annualRentRoll,openRequests:re.tenantRequests.length,internalRentAccounts:Object.keys(re.internalRentAccounts).length,internalRentReceivable};
  }
  function onFinancialDay(ctx,p={}){
    const platform=globalThis.GH_COMPANY_PLATFORM,commands=globalThis.GH_DOMAIN_COMMANDS;
    if(!platform?.requireCompany||!commands?.dispatchSystem)throw new Error('company-daily-owner-unavailable');
    const company=platform.requireCompany(ctx.state,ctx.companyId,{registered:true,operational:true,capability:'operations.realestate'});
    return commands.dispatchSystem({state:ctx.state},'realestate','tick-day',{...p,ownerCompanyId:company.id},{actor:'simulation-scheduler'}).result;
  }
  function execute(ctx,cmd,p={}){
    const state=ctx.state||ctx;
    if(cmd==='ensure')return ensure(state);if(cmd==='tick-day')return tickDay(state,p);if(cmd==='start-project')return startProject(state,p);if(cmd==='set-project-price')return setProjectPrice(state,p);if(cmd==='decide-request')return decideRequest(state,p);if(cmd==='decide-requests-batch')return decideRequestsBatch(state,p);if(cmd==='lease-to-company')return leaseToCompany(state,p);
    throw new Error(`Unknown real estate command: ${cmd}`);
  }
  const API={VERSION,DAILY_FINANCIAL_ORDER:350,TYPES,TYPE_IDS,PRICE_LEVELS,SIZE_LEVELS,MAX_ACTIVE_PROJECTS,MAX_INTERNAL_LEASES,MAX_OPEN_REQUESTS,ensure,officeMarket,projectQuote,arrivals,tickDay,dailyResult,summary,leaseToCompany,decideRequestsBatch,onFinancialDay,execute};
  globalThis.GH_REALESTATE_CORE=API;globalThis.GH_DOMAIN_COMMANDS?.register?.('realestate',API);if(globalThis.window&&window!==globalThis)window.GH_REALESTATE_CORE=API;if(typeof module!=='undefined'&&module.exports)module.exports=API;
})();

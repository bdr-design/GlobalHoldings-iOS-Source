(()=>{
  'use strict';
  // Build 358 (owner request: an insurance company where the customer base and realism come first). The company has no
  // fleet: its offices (facilities of kind "insurance", one per capital from the world directory) sell four lines of
  // cover to the people and businesses of their country, and the player runs it through its decisions.
  //
  // Customer base. An office serves a share of its country: 45% of the population can buy cover, the group's insurer
  // can win at most 3% of them, split between its offices in that country (300 to 200,000 policies per line and office).
  // Each line has its own buyers (households for motor, health and home cover; one business per 40 people for
  // commercial cover). New policies come in more slowly as an office fills its market and faster when its price is below
  // the market; policies lapse every year (more when the price is above the market).
  //
  // Underwriting results. Every policy earns its annual premium day by day. Claims follow each line's frequency and
  // severity, drawn deterministically per office and day (never Math.random), and rise with cheaper pricing (adverse
  // selection: a lower price attracts riskier buyers). Rare catastrophe days multiply a country's property claims.
  // Agents take a commission on the premium; reinsurance takes a quota share of premium and claims and pays a ceding
  // commission. Claims are paid 30 days after they occur: the P&L carries them when they occur, the cash leaves when
  // they are paid (the claims reserve holds the difference).
  //
  // Decisions. Price per line (85% to 125% of the market rate), the reinsurance quota share, a marketing campaign per
  // office, and large commercial risks brought to the player one by one (accept or decline).
  //
  // Accounts. The day's earned premium and the day's expenses (claims incurred, commissions, ceded premium net of the
  // ceding commission) reach the group's daily close through dailyResult(): it posts them with the same aggregated
  // daily documents as every other subsidiary. The offices' running costs are their facility costs (the company
  // definition's site template), already posted by the close. Nothing here writes a document per policy or claim.
  //
  // Load. Fixed work per office and day (four lines), at most 5 open risk requests, history capped at 90 days (the screens read 30), 40
  // decisions kept. No per-frame work.
  const VERSION='3.0.0';
  const num=value=>Math.max(0,Number(value)||0),now=state=>Number(state.simSeconds)||0;
  const clamp=(value,min,max)=>Math.max(min,Math.min(max,Number(value)||0));
  const clone=value=>globalThis.structuredClone?structuredClone(value):JSON.parse(JSON.stringify(value));
  function hash(text){let h=2166136261>>>0;for(const ch of String(text)){h^=ch.charCodeAt(0);h=Math.imul(h,16777619)>>>0;}return h>>>0;}
  function deterministic(seed,min,max){return min+(hash(seed)/4294967295)*(max-min);}
  const roundDraw=(value,seed)=>Math.floor(Math.max(0,value)+deterministic(seed,0,1));
  const LINES=Object.freeze({
    motor:{name:'تأمين المركبات',buyers:'household',premium:650,frequency:.12,severity:3500,lapse:.12,growth:[6,22]},
    health:{name:'التأمين الصحي',buyers:'household',premium:1800,frequency:.9,severity:900,lapse:.08,growth:[3,14]},
    property:{name:'تأمين المنازل والممتلكات',buyers:'household',premium:420,frequency:.02,severity:14000,lapse:.06,growth:[3,12]},
    commercial:{name:'التأمين التجاري',buyers:'business',premium:25000,frequency:.08,severity:220000,lapse:.10,growth:[0,2]}
  });
  const LINE_IDS=Object.freeze(Object.keys(LINES));
  const INSURABLE_SHARE=.45,MAX_MARKET_SHARE=.03,BUSINESS_PER_PEOPLE=40,DEFAULT_POPULATION=10000000;
  const COMMISSION=.12,CLAIMS_LAG_DAYS=30,PRICE_LEVELS=Object.freeze([.85,.9,.95,1,1.05,1.1,1.15,1.25]);
  const REINSURANCE_LEVELS=Object.freeze([0,.2,.4,.6]),CEDING_COMMISSION=.25;
  const CAMPAIGN_DAYS=30,CAMPAIGN_GROWTH=1.6;
  const MAX_OPEN_RISKS=5,RISK_DAYS=7,HISTORY=40,DAILY_HISTORY=90;
  const SMALL_STATES=Object.freeze({'الإمارات':9890000,'سنغافورة':5920000,'عُمان':4580000,'البحرين':1500000,'المالديف':520000,'أيرلندا':5120000,'مالطا':530000,'الكونغو الديمقراطية':102000000,'الكونغو':6000000,'ملاوي':20400000,'موريشيوس':1260000});
  function countryPopulation(country){
    const name=String(country||'').trim();if(SMALL_STATES[name])return SMALL_STATES[name];
    const bank=globalThis.GH_BANKING_CORE;if(typeof bank?.countryPopulation==='function')return bank.countryPopulation(name);
    const row=(Array.isArray(globalThis.GH_MAP_LABELS)?globalThis.GH_MAP_LABELS:[]).find(item=>item?.name===name);
    return Number(row?.population)>0?Number(row.population):DEFAULT_POPULATION;
  }
  const blankLine=()=>({policies:0,newToday:0,lapsedToday:0,claimsToday:0,claimsCountToday:0,premiumToday:0});
  function officeTemplate(p={}){
    const lines={};for(const id of LINE_IDS){const row=p.lines?.[id]||{};lines[id]={policies:Math.max(0,Math.floor(Number(row.policies)||0)),newToday:Math.max(0,Math.floor(Number(row.newToday)||0)),lapsedToday:Math.max(0,Math.floor(Number(row.lapsedToday)||0)),claimsToday:num(row.claimsToday),claimsCountToday:Math.max(0,Math.floor(Number(row.claimsCountToday)||0)),premiumToday:num(row.premiumToday)};}
    return {id:String(p.id||''),facilityId:String(p.facilityId||''),city:String(p.city||'غير محدد'),country:String(p.country||'غير محدد'),openedAt:Number(p.openedAt)||0,active:p.active!==false,marketPopulation:Number(p.marketPopulation)>0?Number(p.marketPopulation):0,lines,campaignUntil:Math.max(0,Math.floor(Number(p.campaignUntil)||0)),campaigns:Math.max(0,Math.floor(Number(p.campaigns)||0)),campaignSpend:num(p.campaignSpend),today:p.today&&typeof p.today==='object'?{...p.today}:null};
  }
  function ensure(state){
    const ins=state.insurance=state.insurance&&typeof state.insurance==='object'&&!Array.isArray(state.insurance)?state.insurance:{};
    for(const key of ['offices','dailyHistory','riskRequests','riskHistory','claimsReserve','largeRisks'])ins[key]=Array.isArray(ins[key])?ins[key].filter(Boolean):[];
    ins.sequence=Math.max(0,Math.floor(Number(ins.sequence)||0));
    ins.pricing=ins.pricing&&typeof ins.pricing==='object'?ins.pricing:{};for(const id of LINE_IDS)ins.pricing[id]=PRICE_LEVELS.includes(Number(ins.pricing[id]))?Number(ins.pricing[id]):1;
    ins.reinsurance=REINSURANCE_LEVELS.includes(Number(ins.reinsurance))?Number(ins.reinsurance):.2;
    ins.offices=ins.offices.map(officeTemplate);syncOffices(state,ins);
    ins.ytd=ins.ytd&&typeof ins.ytd==='object'?ins.ytd:{};for(const key of ['premium','claims','commission','ceded','cedingCommission','net','largeRiskPremium'])ins.ytd[key]=Number(ins.ytd[key])||0;
    ins.lastProcessedDay=Number.isFinite(Number(ins.lastProcessedDay))?Math.floor(Number(ins.lastProcessedDay)):-1;
    return ins;
  }
  // Every owned insurance facility is an office (the generic company facility flow opens it from the world directory).
  function syncOffices(state,ins){
    const facilities=[...(state.customHubs||[]),...(state.globalBases||[])].filter(row=>row?.owned===true&&row.kind==='insurance'&&String(row.ownerCompanyId||row.companyId||row.company||'')==='insurance');
    for(const facility of facilities)if(!ins.offices.some(row=>row.facilityId===facility.id))ins.offices.push(officeTemplate({id:`INS-OFF-${++ins.sequence}`,facilityId:facility.id,city:facility.city,country:facility.country,openedAt:now(state)}));
    const owned=new Set(facilities.map(row=>row.id));for(const office of ins.offices)if(!owned.has(office.facilityId))office.active=false;
    return ins.offices;
  }
  function officeMarket(ins,office){
    if(!(Number(office.marketPopulation)>0))office.marketPopulation=countryPopulation(office.country);
    const peers=Math.max(1,ins.offices.filter(row=>row.active&&row.country===office.country).length),households=Math.round(clamp(num(office.marketPopulation)*INSURABLE_SHARE*MAX_MARKET_SHARE/peers,300,200000));
    return {population:num(office.marketPopulation),households,businesses:Math.max(30,Math.round(households/BUSINESS_PER_PEOPLE))};
  }
  const capacityFor=(market,line)=>LINES[line].buyers==='business'?market.businesses:market.households;
  // Annual premium per policy at a price level, and the claims loading that level attracts.
  function linePrice(ins,line){return Math.round(LINES[line].premium*num(ins.pricing[line]||1));}
  function adverseSelection(level){return 1+Math.max(0,1-level)*.8;}
  // Reads the pricing without normalising the state (the daily pass holds the office rows it is updating).
  function quote(state,line){
    const ins=state.insurance&&state.insurance.pricing?state.insurance:ensure(state),level=num(ins.pricing[line]||1),row=LINES[line];
    return {line,name:row.name,level,premium:linePrice(ins,line),expectedLossRatio:row.frequency*row.severity*adverseSelection(level)/(row.premium*level),lapse:clamp(row.lapse*(1+(level-1)*2.5),.02,.4),growthFactor:clamp(1+(1-level)*2,.4,1.6)};
  }
  // Large commercial risks: a company asks the player to insure a fleet, a plant or a portfolio for a year.
  const RISK_SUBJECTS=Object.freeze([['أسطول شاحنات لشركة نقل',['road']],['مصنع بتروكيماويات',['industrial']],['مجمع تجاري',['real-estate']],['أسطول سفن حاويات',['sea']],['طائرات شركة طيران إقليمية',['air']],['محطة توليد كهرباء',['power']],['مستشفى خاص',['services']]]);
  const RISK_GRADES=Object.freeze([['A',.6],['B',1],['C',1.7]]);
  function generateRisk(state,ins,day){
    const offices=ins.offices.filter(row=>row.active);if(!offices.length||ins.riskRequests.length>=MAX_OPEN_RISKS)return null;
    if(deterministic(`${day}:ins-risk`,0,1)>=Math.min(.6,.12+.08*offices.length))return null;
    const seed=`${day}:ins-risk`,office=offices[Math.floor(deterministic(`${seed}:office`,0,offices.length))%offices.length],[subject]=RISK_SUBJECTS[Math.floor(deterministic(`${seed}:subject`,0,RISK_SUBJECTS.length))%RISK_SUBJECTS.length],[grade,riskFactor]=RISK_GRADES[Math.floor(deterministic(`${seed}:grade`,0,RISK_GRADES.length))%RISK_GRADES.length];
    const sumInsured=Math.round(deterministic(`${seed}:sum`,20,600))*1000000,rate=deterministic(`${seed}:rate`,.004,.012),premium=Math.round(sumInsured*rate/1000)*1000,expectedLoss=Math.round(premium*.62*riskFactor);
    const risk={id:`RISK-${++ins.sequence}`,day,expiresDay:day+RISK_DAYS,subject:`${subject} · ${office.city}`,officeId:office.id,grade,sumInsured,premium,expectedLoss,status:'بانتظار القرار'};
    ins.riskRequests.push(risk);return risk;
  }
  function closeRisk(ins,risk,status,extra={}){ins.riskRequests=ins.riskRequests.filter(row=>row.id!==risk.id);ins.riskHistory.unshift({...risk,...extra,status});ins.riskHistory=ins.riskHistory.slice(0,HISTORY);}
  function decideRisk(state,p){
    const ins=ensure(state),risk=ins.riskRequests.find(row=>row.id===String(p.id||''));if(!risk)throw new Error('insurance-risk-not-found');
    const day=Math.floor(now(state)/86400);if(day>=Number(risk.expiresDay)){closeRisk(ins,risk,'منتهي',{decidedDay:day});throw new Error('insurance-risk-expired');}
    if(p.decision==='decline'){closeRisk(ins,risk,'معتذر عنه',{decidedDay:day});return {id:risk.id,status:'معتذر عنه'};}
    if(p.decision!=='accept')throw new Error('insurance-risk-decision-invalid');
    // A large risk earns its premium over the year and may produce one large claim (probability from its grade).
    const claimDay=day+Math.floor(deterministic(`${risk.id}:claim-day`,20,360)),claimChance=clamp(risk.expectedLoss/Math.max(1,risk.sumInsured*.15),0,.6),claims=deterministic(`${risk.id}:claim`,0,1)<claimChance;
    const F=globalThis.GH_FINANCE_CORE;if(!F?.execute)throw new Error('finance-core-missing');const document=F.execute({state},'register-commercial-contract',{id:`LEGAL-${risk.id}`,company:'insurance',contractType:'وثيقة تأمين خطر تجاري كبير',counterparty:risk.subject,title:`وثيقة ${risk.subject}`,startDay:day,endDay:day+365,amount:risk.premium,terms:{officeId:risk.officeId,grade:risk.grade,sumInsured:risk.sumInsured,premium:risk.premium,expectedLoss:risk.expectedLoss},sourceRefs:[risk.id]});
    ins.largeRisks.push({id:risk.id,subject:risk.subject,officeId:risk.officeId,startDay:day,endDay:day+365,premium:risk.premium,dailyPremium:risk.premium/365,claimDay:claims?claimDay:null,claimAmount:claims?Math.round(risk.sumInsured*deterministic(`${risk.id}:severity`,.05,.15)):0,claimed:false,legalDocumentId:document.id,documentProofId:document.documentProofId,contentDigest:document.contentDigest});
    closeRisk(ins,risk,'مقبول',{decidedDay:day});return {id:risk.id,status:'مقبول',premium:risk.premium};
  }
  function setPricing(state,p){
    const ins=ensure(state),line=String(p.line||'');if(!LINES[line])throw new Error('insurance-line-invalid');const level=Number(p.level);if(!PRICE_LEVELS.includes(level))throw new Error('insurance-price-invalid');
    ins.pricing[line]=level;return {line,level,premium:linePrice(ins,line)};
  }
  function setReinsurance(state,p){const ins=ensure(state),share=Number(p.share);if(!REINSURANCE_LEVELS.includes(share))throw new Error('insurance-reinsurance-invalid');ins.reinsurance=share;return {share};}
  function campaignCost(ins,office){return Math.round(clamp(officeMarket(ins,{...office}).households*2,150000,3000000));}
  function officeCampaign(state,p){
    const ins=ensure(state),office=ins.offices.find(row=>row.id===p.officeId||row.facilityId===p.officeId);if(!office)throw new Error('insurance-office-not-found');if(!office.active)throw new Error('insurance-office-inactive');
    const day=Math.floor(now(state)/86400);if(office.campaignUntil>day)throw new Error('insurance-campaign-running');
    const F=globalThis.GH_FINANCE_CORE;if(!F?.execute)throw new Error('finance-core-missing');const cost=campaignCost(ins,office);
    const payment=F.execute({state},'pay-by-cheque',{company:'insurance',amount:cost,note:`حملة تسويقية · مكتب ${office.city} · ${CAMPAIGN_DAYS} يومًا`,beneficiary:`وكالة تسويق · ${office.city}`,line:'marketing',requestRef:`INS-CAMPAIGN-${office.id}-${day}`});
    if(!payment?.cheque?.id||payment.cheque.status!=='مصروف')throw new Error('insurance-campaign-cheque-not-cleared');
    office.campaignUntil=day+CAMPAIGN_DAYS;office.campaigns++;office.campaignSpend+=cost;return {officeId:office.id,city:office.city,cost,until:office.campaignUntil};
  }
  function setOfficeActive(state,p){const ins=ensure(state),office=ins.offices.find(row=>row.id===p.officeId||row.facilityId===p.officeId);if(!office)throw new Error('insurance-office-not-found');office.active=p.active!==false;return clone(office);}
  function* tickDayStages(state,p={}){
    const ins=ensure(state),day=Math.max(0,Math.floor(Number(p.day)||Math.floor(now(state)/86400)));if(ins.lastProcessedDay===day)return ins.dailyHistory.find(row=>row.day===day)||{day,idempotent:true};
    let premium=0,claims=0,claimsCount=0,newPolicies=0,lapsed=0;const byLine={};for(const id of LINE_IDS)byLine[id]={premium:0,claims:0,policies:0};
    const catastrophe=deterministic(`${day}:ins-cat`,0,1)<.004?ins.offices.filter(row=>row.active).map(row=>row.country)[Math.floor(deterministic(`${day}:ins-cat-country`,0,Math.max(1,ins.offices.length)))]||null:null;
    for(const office of ins.offices){
      const market=officeMarket(ins,office),campaign=office.campaignUntil>day,today={day,newPolicies:0,lapsed:0,claims:0,premium:0};
      for(const id of LINE_IDS){
        const row=LINES[id],line=office.lines[id],level=num(ins.pricing[id]||1),q=quote(state,id),capacity=capacityFor(market,id),room=clamp(1-line.policies/Math.max(1,capacity),0,1);
        const lapsedToday=office.active||line.policies?Math.min(line.policies,roundDraw(line.policies*q.lapse/365,`${office.id}:${day}:${id}:lapse`)):0;
        const newToday=office.active?Math.round(deterministic(`${office.id}:${day}:${id}:new`,row.growth[0],row.growth[1])*q.growthFactor*(campaign?CAMPAIGN_GROWTH:1)*room):0;
        line.policies=Math.max(0,line.policies-lapsedToday+newToday);line.newToday=newToday;line.lapsedToday=lapsedToday;
        const dailyPremium=line.policies*linePrice(ins,id)/365,expectedClaims=line.policies*row.frequency/365*adverseSelection(level)*(catastrophe===office.country&&id==='property'?5:1),count=roundDraw(expectedClaims,`${office.id}:${day}:${id}:claims`),severity=row.severity*deterministic(`${office.id}:${day}:${id}:severity`,.6,1.4),amount=count*severity;
        line.premiumToday=dailyPremium;line.claimsToday=amount;line.claimsCountToday=count;
        premium+=dailyPremium;claims+=amount;claimsCount+=count;newPolicies+=newToday;lapsed+=lapsedToday;byLine[id].premium+=dailyPremium;byLine[id].claims+=amount;byLine[id].policies+=line.policies;
        today.newPolicies+=newToday;today.lapsed+=lapsedToday;today.claims+=amount;today.premium+=dailyPremium;
      }
      office.today=today;
      yield `office:${office.id}`;
    }
    let largePremium=0,largeClaims=0;
    for(let index=0;index<ins.largeRisks.length;index++){const risk=ins.largeRisks[index];if(day>=risk.startDay&&day<risk.endDay){largePremium+=risk.dailyPremium;if(risk.claimDay===day&&!risk.claimed){risk.claimed=true;largeClaims+=risk.claimAmount;}}if(index>0&&index%64===0)yield 'large-risks';}
    ins.largeRisks=ins.largeRisks.filter(row=>day<row.endDay);
    yield 'large-risks';
    premium+=largePremium;claims+=largeClaims;
    const share=num(ins.reinsurance),ceded=premium*share,cededClaims=claims*share,netClaims=claims-cededClaims,cedingCommission=ceded*CEDING_COMMISSION,commission=(premium-largePremium)*COMMISSION;
    // Claims are paid 30 days after they occur: the reserve holds the group's share (net of reinsurance) until then.
    if(netClaims>0)ins.claimsReserve.push({id:`INS-RES-${day}`,day,amount:netClaims,payDay:day+CLAIMS_LAG_DAYS});
    const dueRows=ins.claimsReserve.filter(row=>Number(row.payDay)<=day),claimsDue=dueRows.reduce((sum,row)=>sum+num(row.amount),0),F=globalThis.GH_FINANCE_CORE,available=state.godMoney&&state.infiniteMoney?claimsDue:num(F?.operating?.(state,'insurance')),paid=Math.min(claimsDue,available);let claimSettlementReference=null;
    if(paid>.01){if(!F?.execute)throw new Error('insurance-claim-finance-core-missing');const settlement=F.execute({state},'settle-insurance-claims',{company:'insurance',amount:paid,day,reference:`INS-CLAIM-PAY-${day}`,sourceRefs:dueRows.map(row=>row.id||`INS-RES-${row.day}`)});claimSettlementReference=settlement.reference;let remaining=paid;for(let index=0;index<ins.claimsReserve.length;index++){const row=ins.claimsReserve[index];if(Number(row.payDay)<=day&&remaining>.01){const applied=Math.min(num(row.amount),remaining);row.amount=Math.max(0,num(row.amount)-applied);remaining-=applied;}if(index>0&&index%128===0)yield 'claim-reserve';}ins.claimsReserve=ins.claimsReserve.filter(row=>num(row.amount)>.01);}
    yield 'claim-settlement';
    const revenue=premium+cedingCommission,expense=netClaims+commission+ceded,net=revenue-expense,cashExpense=commission+ceded;
    const report={day,premium,largePremium,claims,cededClaims,claimsCount,claimsDue,claimsPaid:paid,claimsUnpaid:Math.max(0,claimsDue-paid),claimSettlementReference,reserve:ins.claimsReserve.reduce((sum,row)=>sum+num(row.amount),0),commission,ceded,cedingCommission,revenue,expense,cashExpense,net,newPolicies,lapsed,catastrophe,byLine,newRisk:generateRisk(state,ins,day)?.id||null};
    for(const request of [...ins.riskRequests])if(day>=Number(request.expiresDay))closeRisk(ins,request,'منتهي',{decidedDay:day});
    ins.ytd.premium+=premium;ins.ytd.claims+=claims-cededClaims;ins.ytd.commission+=commission;ins.ytd.ceded+=ceded;ins.ytd.cedingCommission+=cedingCommission;ins.ytd.net+=net;ins.ytd.largeRiskPremium+=largePremium;
    // Only the newest day keeps its per-line detail; older days keep their totals (history stays small in the save).
    if(ins.dailyHistory[0]?.byLine){const {byLine:_detail,...totals}=ins.dailyHistory[0];ins.dailyHistory[0]=totals;}
    ins.dailyHistory.unshift(report);ins.dailyHistory=ins.dailyHistory.slice(0,DAILY_HISTORY);ins.lastProcessedDay=day;return clone(report);
  }
  function tickDay(state,p={}){const stages=tickDayStages(state,p);let step;while(!(step=stages.next()).done){}return step.value;}
  // Claim cash is transferred inside tickDay on its exact due date. cashExpense therefore carries only commission and
  // ceded premium for the generic daily close, so claim payments cannot be billed again on seven-day supplier terms.
  function dailyResult(state,day){const ins=state.insurance;const row=(ins?.dailyHistory||[]).find(item=>Number(item.day)===Number(day));return row?{revenue:num(row.revenue),expense:num(row.expense),cashExpense:num(row.cashExpense??row.expense)}:{revenue:0,expense:0,cashExpense:0};}
  function summary(state){
    const ins=ensure(state),totals={};for(const id of LINE_IDS)totals[id]=ins.offices.reduce((sum,row)=>sum+num(row.lines[id]?.policies),0);
    const policies=Object.values(totals).reduce((a,b)=>a+b,0),last=ins.dailyHistory[0]||null,window30=ins.dailyHistory.slice(0,30),premium30=window30.reduce((s,r)=>s+num(r.premium),0),claims30=window30.reduce((s,r)=>s+num(r.claims),0);
    return {offices:ins.offices.length,activeOffices:ins.offices.filter(row=>row.active).length,policies,byLine:totals,last,premium30,claims30,lossRatio30:premium30?claims30/premium30:0,net30:window30.reduce((s,r)=>s+Number(r.net||0),0),reserve:ins.claimsReserve.reduce((s,r)=>s+num(r.amount),0),reinsurance:ins.reinsurance,openRisks:ins.riskRequests.length};
  }
  function onFinancialDay(ctx,p={}){
    const platform=globalThis.GH_COMPANY_PLATFORM,commands=globalThis.GH_DOMAIN_COMMANDS;
    if(!platform?.requireCompany||!commands?.dispatchSystem)throw new Error('company-daily-owner-unavailable');
    const company=platform.requireCompany(ctx.state,ctx.companyId,{registered:true,operational:true,capability:'operations.insurance'});
    return commands.dispatchSystem({state:ctx.state},'insurance','tick-day',{...p,ownerCompanyId:company.id},{actor:'simulation-scheduler'}).result;
  }
  function* onFinancialDayStages(ctx,p={}){
    const platform=globalThis.GH_COMPANY_PLATFORM;if(!platform?.requireCompany)throw new Error('company-daily-owner-unavailable');
    platform.requireCompany(ctx.state,ctx.companyId,{registered:true,operational:true,capability:'operations.insurance'});
    return yield* tickDayStages(ctx.state,p);
  }
  function execute(ctx,cmd,p={}){
    const state=ctx.state||ctx;
    if(cmd==='ensure')return ensure(state);if(cmd==='tick-day')return tickDay(state,p);if(cmd==='set-pricing')return setPricing(state,p);if(cmd==='set-reinsurance')return setReinsurance(state,p);
    if(cmd==='decide-risk')return decideRisk(state,p);if(cmd==='office-campaign')return officeCampaign(state,p);if(cmd==='set-office-active')return setOfficeActive(state,p);
    throw new Error(`Unknown insurance command: ${cmd}`);
  }
  const API={VERSION,DAILY_FINANCIAL_ORDER:300,LINES,LINE_IDS,PRICE_LEVELS,REINSURANCE_LEVELS,MAX_OPEN_RISKS,CAMPAIGN_DAYS,ensure,officeMarket,countryPopulation,quote,linePrice,campaignCost,tickDay,tickDayStages,dailyResult,summary,onFinancialDay,onFinancialDayStages,execute};
  globalThis.GH_INSURANCE_CORE=API;globalThis.GH_DOMAIN_COMMANDS?.register?.('insurance',API);if(globalThis.window&&window!==globalThis)window.GH_INSURANCE_CORE=API;if(typeof module!=='undefined'&&module.exports)module.exports=API;
})();

(()=>{'use strict';const VERSION='3.0.0',num=v=>Math.max(0,Number(v)||0),now=s=>Number(s.simSeconds)||0;
function ensure(s){
 s.portfolio=s.portfolio&&typeof s.portfolio==='object'&&!Array.isArray(s.portfolio)?s.portfolio:{};s.portfolioBook=s.portfolioBook&&typeof s.portfolioBook==='object'&&!Array.isArray(s.portfolioBook)?s.portfolioBook:{};s.portfolioLots=s.portfolioLots&&typeof s.portfolioLots==='object'&&!Array.isArray(s.portfolioLots)?s.portfolioLots:{};s.portfolioTrades=Array.isArray(s.portfolioTrades)?s.portfolioTrades:[];s.portfolioTradeSequence=Math.max(0,Math.floor(Number(s.portfolioTradeSequence)||0));
 for(const [sym,rawQty] of Object.entries(s.portfolio)){const qty=Math.max(0,Math.floor(Number(rawQty)||0));s.portfolio[sym]=qty;const b=s.portfolioBook[sym]=s.portfolioBook[sym]&&typeof s.portfolioBook[sym]==='object'?s.portfolioBook[sym]:{},quote=(s.market||[]).find(row=>row.sym===sym);b.avgCost=Number.isFinite(Number(b.avgCost))&&Number(b.avgCost)>0?Number(b.avgCost):num(quote?.price);b.acquiredDay=Number.isFinite(Number(b.acquiredDay))?Math.max(0,Math.floor(Number(b.acquiredDay))):today(s);b.lastDividendPeriod=Math.max(0,Math.floor(Number(b.lastDividendPeriod)||0));b.realizedIncome=Number(b.realizedIncome)||0;
  let lots=Array.isArray(s.portfolioLots[sym])?s.portfolioLots[sym]:[];lots=lots.filter(l=>l&&Number.isSafeInteger(Number(l.quantity))&&Number(l.quantity)>0).map((l,i)=>({id:String(l.id||`LEGACY-${sym}-${i}`),quantity:Math.floor(Number(l.quantity)),remaining:Math.max(0,Math.min(Math.floor(Number(l.quantity)),Math.floor(Number(l.remaining??l.quantity)||0))),unitCost:num(l.unitCost??b.avgCost),acquiredDay:Number.isFinite(Number(l.acquiredDay))?Math.max(0,Math.floor(Number(l.acquiredDay))):b.acquiredDay,disposals:Array.isArray(l.disposals)?l.disposals.filter(x=>x&&Number(x.quantity)>0).map(x=>({quantity:Math.floor(Number(x.quantity)),day:Math.max(0,Math.floor(Number(x.day)||0)),reference:String(x.reference||'')})):[]}));
  const lotQty=lots.reduce((sum,l)=>sum+l.remaining,0);if(qty>0&&(!lots.length||lotQty!==qty))lots=[{id:`LEGACY-${sym}-${b.acquiredDay}`,quantity:qty,remaining:qty,unitCost:b.avgCost,acquiredDay:b.acquiredDay,disposals:[]}];if(lots.length)s.portfolioLots[sym]=lots;else delete s.portfolioLots[sym];
 }
 for(const [sym,lots] of Object.entries(s.portfolioLots))if(!Object.prototype.hasOwnProperty.call(s.portfolio,sym)&&Array.isArray(lots))s.portfolioLots[sym]=lots.filter(l=>Number(l?.remaining)>0?false:true);
 s.maPortfolio=Array.isArray(s.maPortfolio)?s.maPortfolio.filter(row=>row&&typeof row.id==='string'&&num(row.stake)>0):[];s.stakes=s.stakes&&typeof s.stakes==='object'&&!Array.isArray(s.stakes)?s.stakes:{};for(const [id,stake] of Object.entries(s.stakes))if(num(stake)>0&&!s.maPortfolio.some(row=>row.id===id))s.maPortfolio.push({id,name:'',stake:num(stake),costBasis:0,acquiredDay:0,controlDay:null});for(const row of s.maPortfolio){row.acquiredDay=Math.max(0,Math.floor(Number(row.acquiredDay)||0));if(row.controlDay==null&&num(row.stake)>=CONTROL)row.controlDay=row.acquiredDay;s.stakes[row.id]=num(row.stake);}return s;
}
// Fuel swaps. The group treasury fixes the price of a share of a subsidiary's fuel for a term with the bank; trips
// then pay the swap price for that share and the market price for the rest (GH_SIMULATION_ASSET_CORE.fuelPriceFactor).
const FUEL_OF_SECTOR=Object.freeze({air:'jet',sea:'bunker',road:'diesel'}),HEDGE_SHARES=Object.freeze([.25,.5,.75]),HEDGE_MONTHS=Object.freeze([3,6,12]),HEDGE_BANK_MARGIN=.012,HEDGE_COUNTERPARTY='بنك المجموعة العالمي — مكتب السلع';
const today=s=>Math.floor(now(s)/86400);
function hedgeBook(s){const r=globalThis.GH_REALISM?.migrate?.(s)||s.realism;if(!r?.markets)throw new Error('realism-markets-unavailable');r.markets.hedges=Array.isArray(r.markets.hedges)?r.markets.hedges:[];return r.markets;}
function companyFuel(s,company){const sector=globalThis.GH_COMPANY_PLATFORM?.definitionFor?.(s,company)?.classification?.primarySectorId;return FUEL_OF_SECTOR[sector]||null;}
function hedgeQuote(s,fuel,months){if(!HEDGE_MONTHS.includes(months))throw new Error('hedge-term-invalid');const forward=globalThis.GH_REALISM.fuelForward(s,fuel,months*30),price=forward*(1+HEDGE_BANK_MARGIN+.001*months);return Math.round(price*1e4)/1e4;}
const live=(s,h)=>h.status==='ساري'&&today(s)>=h.startDay&&today(s)<h.endDay;
function hedgeFor(s,company,fuel){for(const h of s.realism?.markets?.hedges||[])if(h.company===company&&h.fuel===fuel&&live(s,h))return {share:h.share,price:h.price};return null;}
function hedgeContext(s){const out={};for(const h of s.realism?.markets?.hedges||[])if(live(s,h))(out[h.company]||(out[h.company]={}))[h.fuel]={share:h.share,price:h.price};return out;}
function hedgeFuel(s,p){
  const company=String(p.company||''),fuel=companyFuel(s,company),share=Number(p.share),months=Math.floor(Number(p.months)||0);
  if(!(s.openedCompanies||[]).includes(company))throw new Error('hedge-company-not-open');if(!fuel)throw new Error('hedge-company-uses-no-fuel');if(!HEDGE_SHARES.includes(share))throw new Error('hedge-share-invalid');
  const book=hedgeBook(s);if(book.hedges.some(h=>h.company===company&&h.fuel===fuel&&live(s,h)))throw new Error('hedge-already-active');
  const startDay=today(s),hedge={id:`HDG-${String((Number(book.sequence)||0)+1).padStart(5,'0')}`,company,fuel,share,months,price:hedgeQuote(s,fuel,months),marketAtStart:Number(s.realism.economy[{jet:'jetFuel',bunker:'bunker',diesel:'diesel'}[fuel]])||0,startDay,endDay:startDay+months*30,counterparty:HEDGE_COUNTERPARTY,status:'ساري'};
  book.sequence=(Number(book.sequence)||0)+1;book.hedges.unshift(hedge);return {...hedge};
}
// Stakes in listed competitors (simulationWorld.competitors). A stake is bought at the market value, with a 25%
// control premium on the purchase that crosses 51%, plus 1.5% fees, from the holding (its capex budget binds).
// Below control the target pays 40% of its net profit as a dividend every quarter; with control its profit is
// upstreamed monthly, with synergies building to 3% of revenue over a year. The daily close settles both.
const STAKE_TARGETS=Object.freeze([10,25,51,100]),CONTROL=51,CONTROL_PREMIUM=.25,DEAL_FEES=.015,PAYOUT=.4,SYNERGY=.03,TAX=.2;
function competitor(s,id){const row=(s.simulationWorld?.competitors||[]).find(c=>c.id===id);if(!row)throw new Error('stake-target-not-found');return row;}
function netIncome(s,c){const rate=globalThis.GH_FINANCE_CORE?.floatingDebtRate?.(s)??.067;return Math.max(0,(num(c.ebitda)*.75-num(c.debt)*rate)*(1-TAX));}
function holding(s,id){return s.maPortfolio.find(row=>row.id===id)||null;}
function stakeQuote(s,id,target){const c=competitor(s,id),current=num(holding(s,id)?.stake);if(!STAKE_TARGETS.includes(target)||target<=current)throw new Error('stake-target-invalid');const premium=target>=CONTROL&&current<CONTROL?CONTROL_PREMIUM:0;return {id,target,current,premium,cost:Math.round((target-current)/100*num(c.price)*(1+premium)*(1+DEAL_FEES))};}
function buyStake(s,p,F){const target=Math.floor(Number(p.target)||0),q=stakeQuote(s,String(p.id||''),target),c=competitor(s,q.id),day=today(s);F.execute({state:s},'spend',{company:'group',amount:q.cost,note:`استحواذ على ${target-q.current}% من ${c.name}`,method:'تسوية صفقة',taxable:false,line:'capex',counterparty:`مساهمو ${c.name}`});let row=holding(s,q.id);if(!row){row={id:q.id,name:c.name,stake:0,costBasis:0,acquiredDay:day,controlDay:null};s.maPortfolio.push(row);}row.stake=target;row.costBasis=num(row.costBasis)+q.cost;if(target>=CONTROL&&row.controlDay==null)row.controlDay=day;s.stakes[q.id]=target;return {...row,paid:q.cost,premium:q.premium};}
function sellStake(s,p,F){const row=holding(s,String(p.id||''));if(!row)throw new Error('stake-not-held');const c=competitor(s,row.id),proceeds=Math.round(row.stake/100*num(c.price)*(1-DEAL_FEES));F.execute({state:s},'credit',{company:'group',amount:proceeds,note:`بيع حصة ${row.stake}% في ${c.name}`,method:'تسوية صفقة',taxable:false,reference:`STAKE-SALE-${row.id}-${today(s)}`,counterparty:'مشترو الحصة'});s.maPortfolio=s.maPortfolio.filter(x=>x!==row);delete s.stakes[row.id];return {id:row.id,stake:row.stake,proceeds,gain:proceeds-num(row.costBasis)};}
// What a holding pays and when: a quarterly dividend below control, a monthly upstream with control.
function holdingIncome(s,row,day){const c=competitor(s,row.id),share=num(row.stake)/100,ni=netIncome(s,c);if(row.stake<CONTROL)return {kind:'dividend',every:90,due:day>row.acquiredDay&&(day-row.acquiredDay)%90===0,amount:Math.round(share*ni*PAYOUT/4)};const age=Math.max(0,day-row.controlDay);return {kind:'upstream',every:30,due:age>0&&age%30===0,amount:Math.round(share*(ni/12+num(c.revenue)*SYNERGY*Math.min(1,age/365)/12))};}
function settleListedDividend(s,stock,day,F){
 const period=Math.floor(day/90),last=Math.max(0,Math.floor(Number(stock.lastDividendPeriod)||0)),book=s.portfolioBook?.[stock.sym],lots=Array.isArray(s.portfolioLots?.[stock.sym])?s.portfolioLots[stock.sym]:[];if(period<=last)return null;let total=0,paidPeriods=0;
 for(let current=last+1;current<=period;current++){
  const recordDay=current*90;let shares=0;for(const lot of lots){if(Number(lot.acquiredDay)>recordDay)continue;const disposed=(lot.disposals||[]).reduce((sum,row)=>sum+(Number(row.day)<=recordDay?Math.floor(Number(row.quantity)||0):0),0);shares+=Math.max(0,Math.floor(Number(lot.quantity)||0)-disposed);}
  if(shares>0&&Number(stock.yield)>0){const amount=Math.round(shares*num(stock.price)*(num(stock.yield)/100)/4*100)/100;if(amount>=.01){const reference=`LISTED-DIV-${stock.sym}-P${current}`,transfer=F.execute({state:s},'settle-market-security-dividend',{company:'group',symbol:stock.sym,amount,quantity:shares,period:current,reference});total+=amount;paidPeriods++;if(book){book.realizedIncome=(Number(book.realizedIncome)||0)+amount;book.lastDividendTransfer=transfer.reference;book.lastDividendDay=day;}}}
  stock.lastDividendPeriod=current;if(book)book.lastDividendPeriod=current;
 }
 if(period>last){const retained=[];for(const lot of lots){const alreadyDisposed=(lot.disposals||[]).filter(row=>Number(row.day)<=day).reduce((sum,row)=>sum+Math.floor(Number(row.quantity)||0),0);lot.quantity=Math.max(0,Math.floor(Number(lot.quantity)||0)-alreadyDisposed);lot.disposals=(lot.disposals||[]).filter(row=>Number(row.day)>day);if(lot.remaining>0)retained.push(lot);}if(retained.length)s.portfolioLots[stock.sym]=retained;else delete s.portfolioLots[stock.sym];}
 return total>0?{symbol:stock.sym,kind:'listed-dividend',amount:total,periods:paidPeriods,reference:`LISTED-DIV-${stock.sym}-P${period}`}:null;
}
function* settleListedDividendStages(s,day,F){const out=[];for(const stock of Array.isArray(s.market)?s.market:[]){const payout=settleListedDividend(s,stock,day,F);if(payout)out.push(payout);yield 'market.holdings.listed';}return out;}
function settleHolding(s,row,day,F){if(!(s.simulationWorld?.competitors||[]).some(c=>c.id===row.id))return null;const income=holdingIncome(s,row,day);if(!income.due||income.amount<1)return null;const c=competitor(s,row.id);F.execute({state:s},'credit',{company:'group',amount:income.amount,note:income.kind==='dividend'?`أرباح موزعة من ${c.name} · حصة ${row.stake}%`:`أرباح ${c.name} المحولة للقابضة · حصة ${row.stake}%`,method:'توزيعات أرباح',taxable:false,reference:`${income.kind==='dividend'?'DIV':'UPS'}-${row.id}-${day}`,counterparty:c.name});return {id:row.id,kind:income.kind,amount:income.amount};}
function tradeStock(s,p,F){
 const sym=String(p.sym||''),stock=(s.market||[]).find(row=>row.sym===sym);if(!stock)throw new Error('symbol-not-found');const signed=Math.trunc(Number(p.qty)||0),quantity=Math.abs(signed),day=today(s),current=Math.max(0,Math.floor(Number(s.portfolio[sym])||0));if(!quantity||!Number.isFinite(Number(stock.price))||Number(stock.price)<=0)throw new Error('invalid-qty');if(signed<0&&current<quantity)throw new Error('insufficient-shares');
 const side=signed>0?'buy':'sell',unitPrice=Number(stock.price),amount=Math.round(unitPrice*quantity*100)/100,reference=`STOCK-${side.toUpperCase()}-${sym}-${day}-${String(Number(s.portfolioTradeSequence)+1).padStart(6,'0')}`;let allocations=[],costBasis=0;
 const matchingLot=side==='buy'?(s.portfolioLots[sym]||[]).find(row=>row.remaining>0&&row.acquiredDay===day&&Math.abs(row.unitCost-unitPrice)<.000001):null,totalLots=Object.values(s.portfolioLots).reduce((sum,rows)=>sum+(Array.isArray(rows)?rows.length:0),0);if(side==='buy'&&!matchingLot&&totalLots>=4096)throw new Error('market-position-lot-cap');
 if(side==='sell'){
  let remain=quantity;for(const lot of [...(s.portfolioLots[sym]||[])].filter(row=>Number(row.remaining)>0).sort((a,b)=>a.acquiredDay-b.acquiredDay||a.id.localeCompare(b.id))){if(remain<=0)break;const sold=Math.min(remain,Math.floor(Number(lot.remaining)||0));if(!sold)continue;const basis=Math.round(Number(lot.unitCost)*sold*100)/100;allocations.push({lot,sold,basis});costBasis+=basis;remain-=sold;}if(remain>0)throw new Error('portfolio-lots-do-not-match-shares');costBasis=Math.round(costBasis*100)/100;
 }
 const realizedGain=side==='sell'?Math.round((amount-costBasis)*100)/100:0; s.portfolioTradeSequence++;const transfer=F.execute({state:s},'settle-market-security-trade',{company:'group',side,symbol:sym,quantity,amount,costBasis,realizedGain,reference});
 if(side==='buy'){
  const b=s.portfolioBook[sym]||(s.portfolioBook[sym]={avgCost:0,acquiredDay:day,lastDividendPeriod:Math.max(0,Math.floor(Number(stock.lastDividendPeriod)||0)),realizedIncome:0}),newQty=current+quantity;b.avgCost=((current*num(b.avgCost)+amount)/newQty);if(current===0)b.acquiredDay=day;b.closedDay=null;
  const lots=s.portfolioLots[sym]||(s.portfolioLots[sym]=[]);if(matchingLot){matchingLot.quantity+=quantity;matchingLot.remaining+=quantity;}else lots.push({id:reference,quantity,remaining:quantity,unitCost:unitPrice,acquiredDay:day,disposals:[]});s.portfolio[sym]=newQty;
 }else{
  for(const row of allocations){row.lot.remaining-=row.sold;row.lot.disposals.push({quantity:row.sold,day,reference});}
  s.portfolio[sym]=current-quantity;const b=s.portfolioBook[sym];b.realizedIncome=(Number(b.realizedIncome)||0)+realizedGain;if(s.portfolio[sym]===0){delete s.portfolio[sym];b.closedDay=day;}
 }
 s.portfolioTrades.unshift({reference,symbol:sym,side,quantity,unitPrice,amount,costBasis:side==='sell'?costBasis:amount,realizedGain,day,at:now(s),remaining:Number(s.portfolio[sym])||0,financeTransferReference:transfer.reference});s.portfolioTrades=s.portfolioTrades.slice(0,1000);return {symbol:sym,qty:signed,value:amount,costBasis:side==='sell'?costBasis:amount,realizedGain,transferReference:transfer.reference,reference};
}
function* settleHoldingsStages(s,p,F=globalThis.GH_FINANCE_CORE){ensure(s);const day=Math.floor(Number(p.day)),out=[];for(const row of Array.isArray(s.maPortfolio)?s.maPortfolio:[]){const payout=settleHolding(s,row,day,F);if(payout)out.push(payout);yield 'market.holdings.private';}const listedDividends=yield* settleListedDividendStages(s,day,F);return {day,payouts:out,listedDividends};}
function settleHoldings(s,p,F){const stages=settleHoldingsStages(s,p,F);let step;while(!(step=stages.next()).done){}return step.value;}
function executeStages(ctx,cmd,p={}){const s=ctx.state||ctx,F=globalThis.GH_FINANCE_CORE;if(cmd==='settle-holdings')return settleHoldingsStages(s,p,F);throw new Error(`Unknown staged market command: ${cmd}`);}
function execute(ctx,cmd,p={}){const s=ctx.state||ctx,F=globalThis.GH_FINANCE_CORE;
// The daily close settles holdings without touching the portfolio roots (holdings are normalized at load).
if(cmd==='settle-holdings')return settleHoldings(s,p,F);
ensure(s);if(cmd==='trade-stock')return tradeStock(s,p,F);
if(cmd==='hedge-fuel')return hedgeFuel(s,p);
if(cmd==='buy-stake')return buyStake(s,p,F);if(cmd==='sell-stake')return sellStake(s,p,F);
if(cmd==='sync-economy'){s.advanced=s.advanced||{};s.advanced.economy=s.advanced.economy||{};Object.assign(s.advanced.economy,p.values||{});return {...s.advanced.economy};}
if(cmd==='tick-economy'){s.advanced=s.advanced||{};const m=s.advanced.economy=s.advanced.economy||{};const move=typeof p.move==='function'?p.move:()=>0;m.electricityPriceMWh=Math.max(35,Math.min(160,num(m.electricityPriceMWh||90)*(1+move(.018))));m.gasCostMWh=Math.max(18,Math.min(110,num(m.gasCostMWh||39)*(1+move(.015))));m.freightIndex=Math.max(55,Math.min(190,num(m.freightIndex||100)*(1+move(.009))));m.loanYield=Math.max(num(m.depositRate)+.012,Math.min(.16,num(m.loanYield||.07)+move(.0005)));return {...m};}
if(cmd==='tick-prices'){
  const hour=Math.max(0,Math.floor(Number(p.hour)||0));
  const rnd=globalThis.GH_DETERMINISM;
  if(!rnd?.nextFloat)throw new Error('determinism-core-unavailable');
  s.market=Array.isArray(s.market)?s.market:[];
  s.simulationWorld=s.simulationWorld&&typeof s.simulationWorld==='object'?s.simulationWorld:{};
  s.simulationWorld.competitors=Array.isArray(s.simulationWorld.competitors)?s.simulationWorld.competitors:[];
  for(const row of s.market){
    const fundamentals=(rnd.nextFloat(s,'market-fundamentals')-.49)*.006;
    const sentiment=(rnd.nextFloat(s,'market-sentiment')-.5)*.012;
    const change=Math.max(-4.5,Math.min(4.5,(fundamentals+sentiment)*100));
    row.change=change;row.price=Math.max(2,num(row.price)*(1+change/100));
  }
  for(const rival of s.simulationWorld.competitors){
    rival.price=Math.max(num(rival.revenue)*.2,num(rival.price)*(1+(rnd.nextFloat(s,'competitor-price')-.5)*.003));
  }
  return {hour,stocks:s.market.length,competitors:s.simulationWorld.competitors.length};
}
throw new Error(`Unknown market command: ${cmd}`)}
const API={VERSION,ensure,execute,executeStages,HEDGE_SHARES,HEDGE_MONTHS,companyFuel,hedgeQuote,hedgeFor,hedgeContext,STAKE_TARGETS,CONTROL,stakeQuote,netIncome,holdingIncome,settleHoldingsStages};globalThis.GH_MARKET_CORE=API;globalThis.GH_DOMAIN_COMMANDS?.register?.('market',API);if(globalThis.window&&window!==globalThis)window.GH_MARKET_CORE=API;})();

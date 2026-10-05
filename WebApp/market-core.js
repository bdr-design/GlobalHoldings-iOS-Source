(()=>{'use strict';const VERSION='3.0.0',num=v=>Math.max(0,Number(v)||0),now=s=>Number(s.simSeconds)||0;
function ensure(s){s.portfolio=s.portfolio&&typeof s.portfolio==='object'?s.portfolio:{};s.portfolioBook=s.portfolioBook&&typeof s.portfolioBook==='object'?s.portfolioBook:{};s.maPortfolio=Array.isArray(s.maPortfolio)?s.maPortfolio.filter(row=>row&&typeof row.id==='string'&&num(row.stake)>0):[];s.stakes=s.stakes&&typeof s.stakes==='object'&&!Array.isArray(s.stakes)?s.stakes:{};for(const [id,stake] of Object.entries(s.stakes))if(num(stake)>0&&!s.maPortfolio.some(row=>row.id===id))s.maPortfolio.push({id,name:'',stake:num(stake),costBasis:0,acquiredDay:0,controlDay:null});for(const row of s.maPortfolio){row.acquiredDay=Math.max(0,Math.floor(Number(row.acquiredDay)||0));if(row.controlDay==null&&num(row.stake)>=CONTROL)row.controlDay=row.acquiredDay;s.stakes[row.id]=num(row.stake);}return s;}
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
function settleHoldings(s,p,F){const day=Math.floor(Number(p.day)),out=[];for(const row of Array.isArray(s.maPortfolio)?s.maPortfolio:[]){if(!(s.simulationWorld?.competitors||[]).some(c=>c.id===row.id))continue;const income=holdingIncome(s,row,day);if(!income.due||income.amount<1)continue;const c=competitor(s,row.id);F.execute({state:s},'credit',{company:'group',amount:income.amount,note:income.kind==='dividend'?`أرباح موزعة من ${c.name} · حصة ${row.stake}%`:`أرباح ${c.name} المحولة للقابضة · حصة ${row.stake}%`,method:'توزيعات أرباح',taxable:false,reference:`${income.kind==='dividend'?'DIV':'UPS'}-${row.id}-${day}`,counterparty:c.name});out.push({id:row.id,kind:income.kind,amount:income.amount});}return {day,payouts:out};}
function execute(ctx,cmd,p={}){const s=ctx.state||ctx,F=globalThis.GH_FINANCE_CORE;
// The daily close settles holdings without touching the portfolio roots (holdings are normalized at load).
if(cmd==='settle-holdings')return settleHoldings(s,p,F);
ensure(s);if(cmd==='trade-stock'){const row=(s.market||[]).find(x=>x.sym===p.sym);if(!row)throw new Error('symbol-not-found');const qty=Math.trunc(Number(p.qty)||0),cur=Number(s.portfolio[p.sym])||0;if(!qty)throw new Error('invalid-qty');if(qty<0&&cur<Math.abs(qty))throw new Error('insufficient-shares');const value=num(row.price)*Math.abs(qty),b=s.portfolioBook[p.sym]||{avgCost:num(row.price)};if(qty>0){F.execute({state:s},'spend',{company:'group',amount:value,note:`شراء أسهم ${p.sym}`,method:'تسوية سوقية',taxable:false,line:'other'});b.avgCost=((cur*b.avgCost)+(qty*num(row.price)))/(cur+qty);s.portfolioBook[p.sym]=b;}else{F.execute({state:s},'credit',{company:'group',amount:value,note:`بيع أسهم ${p.sym}`,method:'تسوية سوقية',taxable:false});if(cur+qty<=0)delete s.portfolioBook[p.sym];}s.portfolio[p.sym]=cur+qty;if(s.portfolio[p.sym]<=0)delete s.portfolio[p.sym];return {symbol:p.sym,qty,value};}
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
const API={VERSION,ensure,execute,HEDGE_SHARES,HEDGE_MONTHS,companyFuel,hedgeQuote,hedgeFor,hedgeContext,STAKE_TARGETS,CONTROL,stakeQuote,netIncome,holdingIncome};globalThis.GH_MARKET_CORE=API;globalThis.GH_DOMAIN_COMMANDS?.register?.('market',API);if(globalThis.window&&window!==globalThis)window.GH_MARKET_CORE=API;})();

(()=>{'use strict';const VERSION='3.0.0',num=v=>Math.max(0,Number(v)||0),now=s=>Number(s.simSeconds)||0;
function ensure(s){s.portfolio=s.portfolio&&typeof s.portfolio==='object'?s.portfolio:{};s.portfolioBook=s.portfolioBook&&typeof s.portfolioBook==='object'?s.portfolioBook:{};s.maPortfolio=Array.isArray(s.maPortfolio)?s.maPortfolio:[];return s;}
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
function execute(ctx,cmd,p={}){const s=ctx.state||ctx,F=globalThis.GH_FINANCE_CORE;ensure(s);if(cmd==='trade-stock'){const row=(s.market||[]).find(x=>x.sym===p.sym);if(!row)throw new Error('symbol-not-found');const qty=Math.trunc(Number(p.qty)||0),cur=Number(s.portfolio[p.sym])||0;if(!qty)throw new Error('invalid-qty');if(qty<0&&cur<Math.abs(qty))throw new Error('insufficient-shares');const value=num(row.price)*Math.abs(qty),b=s.portfolioBook[p.sym]||{avgCost:num(row.price)};if(qty>0){F.execute({state:s},'spend',{company:'group',amount:value,note:`شراء أسهم ${p.sym}`,method:'تسوية سوقية',taxable:false,line:'other'});b.avgCost=((cur*b.avgCost)+(qty*num(row.price)))/(cur+qty);s.portfolioBook[p.sym]=b;}else{F.execute({state:s},'credit',{company:'group',amount:value,note:`بيع أسهم ${p.sym}`,method:'تسوية سوقية',taxable:false});if(cur+qty<=0)delete s.portfolioBook[p.sym];}s.portfolio[p.sym]=cur+qty;if(s.portfolio[p.sym]<=0)delete s.portfolio[p.sym];return {symbol:p.sym,qty,value};}
if(cmd==='hedge-fuel')return hedgeFuel(s,p);
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
const API={VERSION,ensure,execute,HEDGE_SHARES,HEDGE_MONTHS,companyFuel,hedgeQuote,hedgeFor,hedgeContext};globalThis.GH_MARKET_CORE=API;globalThis.GH_DOMAIN_COMMANDS?.register?.('market',API);if(globalThis.window&&window!==globalThis)window.GH_MARKET_CORE=API;})();

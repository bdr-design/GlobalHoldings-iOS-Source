(()=>{'use strict';const VERSION='2.9.1',num=v=>Math.max(0,Number(v)||0),now=s=>Number(s.simSeconds)||0;
function ensure(s){s.portfolio=s.portfolio&&typeof s.portfolio==='object'?s.portfolio:{};s.portfolioBook=s.portfolioBook&&typeof s.portfolioBook==='object'?s.portfolioBook:{};s.maPortfolio=Array.isArray(s.maPortfolio)?s.maPortfolio:[];return s;}
function execute(ctx,cmd,p={}){const s=ctx.state||ctx,F=globalThis.GH_FINANCE_CORE;ensure(s);if(cmd==='trade-stock'){const row=(s.market||[]).find(x=>x.sym===p.sym);if(!row)throw new Error('symbol-not-found');const qty=Math.trunc(Number(p.qty)||0),cur=Number(s.portfolio[p.sym])||0;if(!qty)throw new Error('invalid-qty');if(qty<0&&cur<Math.abs(qty))throw new Error('insufficient-shares');const value=num(row.price)*Math.abs(qty),b=s.portfolioBook[p.sym]||{avgCost:num(row.price)};if(qty>0){F.execute({state:s},'spend',{company:'group',amount:value,note:`شراء أسهم ${p.sym}`,method:'تسوية سوقية',taxable:false,line:'other'});b.avgCost=((cur*b.avgCost)+(qty*num(row.price)))/(cur+qty);s.portfolioBook[p.sym]=b;}else{F.execute({state:s},'credit',{company:'group',amount:value,note:`بيع أسهم ${p.sym}`,method:'تسوية سوقية',taxable:false});if(cur+qty<=0)delete s.portfolioBook[p.sym];}s.portfolio[p.sym]=cur+qty;if(s.portfolio[p.sym]<=0)delete s.portfolio[p.sym];return {symbol:p.sym,qty,value};}
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
if(cmd==='due-diligence'){s.advanced=s.advanced||{};s.advanced.ma=s.advanced.ma||{reviews:[]};s.advanced.ma.reviews=Array.isArray(s.advanced.ma.reviews)?s.advanced.ma.reviews:[];const row={id:p.id,at:now(s),score:Number(p.score)||0,riskScore:Number(p.riskScore??p.score)||0,leverage:Number(p.leverage)||0,margin:Number(p.margin)||0,synergy:num(p.synergy),quality:Number(p.quality)||80,notes:p.notes||[],status:'مكتمل'};s.advanced.ma.reviews.unshift(row);const C=globalThis.GH_CORPORATE_CORE;if(!C?.execute)throw new Error('corporate-core-missing');C.execute({state:s},'record-dd',{id:p.id,data:{riskScore:row.riskScore,leverage:row.leverage,margin:row.margin,synergy:row.synergy,quality:row.quality}});return row;}
if(cmd==='acquire-stake'){const C=globalThis.GH_CORPORATE_CORE;if(!C?.execute)throw new Error('corporate-core-missing');const row=C.execute({state:s},'acquire-stake',p);s.maPortfolio.unshift(row);return row;}throw new Error(`Unknown market command: ${cmd}`)}
const API={VERSION,ensure,execute};globalThis.GH_MARKET_CORE=API;globalThis.GH_DOMAIN_COMMANDS?.register?.('market',API);if(globalThis.window&&window!==globalThis)window.GH_MARKET_CORE=API;})();

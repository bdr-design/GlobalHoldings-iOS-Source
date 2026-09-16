(()=>{'use strict';
const VERSION='3.0.0';
const num=v=>Number(v)||0;
function companyModel(state,type){
  const core=globalThis.GH_CORPORATE_CORE;
  if(core?.model)return core.model(state,type);
  return state.advanced?.companies?.[type]||{serviceLevel:86,automation:48};
}
function sectorEconomics(state,options={}){
  const e=state.energy||{},m=state.advanced?.economy||{},availability=Math.max(0,Math.min(1,num(e.availability||100)/100));
  const requestedDay=Number.isFinite(Number(options.day))?Math.floor(Number(options.day)):null,energyClose=options.preferDailyReport&&requestedDay!==null?(e.dailyHistory||[]).find(row=>Number(row.day)===requestedDay):null,energyDetail=energyClose||globalThis.GH_ENERGY_CORE?.economics?.(state,m),gasMWh=num(e.gasMW)*24*.56*availability,solarMWh=num(e.solarMW)*24*.25*availability,windMWh=num(e.windMW)*24*.39*availability;
  const generation=energyDetail?.generation??(gasMWh+solarMWh+windMWh),revenue=energyDetail?.powerRevenue??(generation*num(m.electricityPriceMWh||90));
  const gasFuel=energyDetail?.gasFuel??(gasMWh*num(m.gasCostMWh||39)),carbon=energyDetail?.carbon??(gasMWh*.36*num(m.carbonPriceTon||0)),om=energyDetail?.operations??((num(e.gasMW)*18+num(e.solarMW)*7+num(e.windMW)*12)*availability);
  const storageMargin=energyDetail?.storageRevenue??(num(e.storageMWh)*.16*Math.max(8,num(m.electricityPriceMWh||90)-num(m.gasCostMWh||39))*.22);
  const powerCompany=companyModel(state,'power'),bankCompany=companyModel(state,'bank');
  const powerRevenue=energyClose?num(energyClose.powerRevenue):(energyDetail?.powerRevenue??(revenue+storageMargin))*(1+(num(powerCompany.serviceLevel)-85)*.0015)*(1+num(powerCompany.automation)*.00035),powerExpense=energyClose?num(energyClose.powerExpense):(energyDetail?.powerExpense??(gasFuel+carbon+om))*(1-Math.min(.12,num(powerCompany.automation)*.0012)),powerDebtPrincipal=num(energyDetail?.debtPrincipal),powerDebtInterest=num(energyDetail?.debtInterest),powerDebtService=powerDebtPrincipal+powerDebtInterest,power=powerRevenue-powerExpense-powerDebtInterest,powerFreeCash=power-powerDebtPrincipal;

  // The daily close estimates today's banking P&L from the live institutional
  // balance sheet. It does not reuse yesterday's report and therefore avoids a
  // one-day lag or double booking when Banking Core posts its day-end report.
  const b=globalThis.GH_BANKING_CORE?.reconcilePrudential?.(state)||state.bank||{},bankClose=options.preferDailyReport&&requestedDay!==null?(b.dailyHistory||[]).find(row=>Number(row.day)===requestedDay):null,activePortfolios=(b.loanPortfolios||[]).filter(row=>['نشطة','مراقبة','متعثرة'].includes(row.status)),pricedPrincipal=activePortfolios.reduce((sum,row)=>sum+num(row.outstanding),0),portfolioInterest=activePortfolios.reduce((sum,row)=>sum+num(row.outstanding)*num(row.rate||m.loanYield||.07)/365,0),otherLoanPrincipal=Math.max(0,num(b.loans)-pricedPrincipal),interestIncome=bankClose?num(bankClose.interestIncome):portfolioInterest+otherLoanPrincipal*num(m.loanYield||.07)/365;
  const branchMix=(b.branchNetwork||[]).reduce((out,row)=>{out.sight+=num(row.depositMix?.sight);out.savings+=num(row.depositMix?.savings);out.term+=num(row.depositMix?.term);return out;},{sight:0,savings:0,term:0}),knownDeposits=branchMix.sight+branchMix.savings+branchMix.term,unclassifiedDeposits=Math.max(0,num(b.deposits)-knownDeposits);branchMix.sight+=unclassifiedDeposits*.45;branchMix.savings+=unclassifiedDeposits*.35;branchMix.term+=unclassifiedDeposits*.20;
  const pricing=b.depositPricing||{sight:num(m.depositRate||.03)*.4,savings:num(m.depositRate||.03)*.92,term:num(m.depositRate||.03)*1.28},depositExpense=bankClose?num(bankClose.depositInterestExpense):(branchMix.sight*num(pricing.sight)+branchMix.savings*num(pricing.savings)+branchMix.term*num(pricing.term))/365;
  const securityIncome=bankClose?num(bankClose.securityIncome):(b.treasurySecurities||[]).filter(row=>row.status==='ساري').reduce((sum,row)=>sum+num(row.amount)*num(row.yieldRate)/365,0),securityHqla=(b.treasurySecurities||[]).filter(row=>row.status==='ساري').reduce((sum,row)=>sum+num(row.amount)*num(row.hqlaFactor||.85),0),liquidityCarry=bankClose?0:Math.max(0,num(b.hqla)-securityHqla)*.018/365;
  const wholesaleInterestExpense=bankClose?num(bankClose.wholesaleInterestExpense):(b.wholesaleFacilities||[]).filter(row=>row.status==='ساري'||row.status==='متأخر').reduce((sum,row)=>sum+num(row.outstanding)*num(row.rate)/365,0),expectedLoss=bankClose?num(bankClose.creditLossExpense):activePortfolios.reduce((sum,row)=>sum+num(row.outstanding)*num(row.pd||.012)*num(row.lgd||.35)/365*(row.stage===3?3:row.stage===2?1.8:1),0)+Math.max(0,num(b.loans)-pricedPrincipal)*(num(b.npl)/100)*.08/365;
  const activeBranches=(b.branchNetwork||[]).filter(row=>row.servicesActive),bankOpex=bankClose?num(bankClose.opex):(activeBranches.length||num(b.branches))*11800,modeledFees=activeBranches.reduce((sum,row)=>sum+num(row.retailCustomers)*1.2+num(row.businessCustomers)*18,0),feeIncome=bankClose?num(bankClose.feeIncome):Math.max(num(b.dailyServiceFeeRevenue),modeledFees);
  const bankFactor=(1+(num(bankCompany.serviceLevel)-85)*.001)*(1+num(bankCompany.automation)*.0002),bankRevenue=bankClose?interestIncome+securityIncome+feeIncome:(interestIncome+securityIncome+feeIncome+liquidityCarry)*bankFactor;
  // Reports written before BUILD305.1 do not have unpostedInterestIncome.
  // Their corporate interest was already moved as cash by Banking Core, so
  // infer the unposted remainder instead of reposting it or dropping all
  // non-corporate interest during an interrupted-close recovery.
  const explicitUnposted=Number(bankClose?.unpostedInterestIncome),cashPostedInterest=Number(bankClose?.cashPostedInterestIncome??bankClose?.corporateInterestIncome),unpostedInterestIncome=bankClose?(Number.isFinite(explicitUnposted)?Math.max(0,explicitUnposted):Math.max(0,interestIncome-(Number.isFinite(cashPostedInterest)?Math.max(0,cashPostedInterest):0))):interestIncome;
  const bankCashRevenueToPost=bankClose?unpostedInterestIncome+securityIncome+feeIncome:bankRevenue,bankExpense=bankClose?depositExpense+wholesaleInterestExpense+expectedLoss+bankOpex:(depositExpense+wholesaleInterestExpense+expectedLoss+bankOpex)*bankFactor,bank=bankRevenue-bankExpense;
  return {power,powerFreeCash,bank,detail:{generation,revenue,gasFuel,carbon,storageMargin,ppaRevenue:num(energyDetail?.ppaRevenue),spotRevenue:num(energyDetail?.spotRevenue),ppaMWh:num(energyDetail?.ppaMWh),interestIncome,securityIncome,depositExpense,wholesaleInterestExpense,expectedLoss,powerRevenue,powerExpense,powerDebtPrincipal,powerDebtInterest,powerDebtService,bankRevenue,bankCashRevenueToPost,bankExpense,bankOpex,feeIncome,liquidityCarry}};
}
const API=Object.freeze({VERSION,sectorEconomics});globalThis.GH_ECONOMICS_CORE=API;if(globalThis.window&&window!==globalThis)window.GH_ECONOMICS_CORE=API;if(typeof module!=='undefined'&&module.exports)module.exports=API;
})();

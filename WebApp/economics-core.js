(()=>{'use strict';
const VERSION='2.9.0';
const num=v=>Number(v)||0;
function companyModel(state,type){
  const core=globalThis.GH_CORPORATE_CORE;
  if(core?.model)return core.model(state,type);
  return state.advanced?.companies?.[type]||{serviceLevel:86,automation:48};
}
function sectorEconomics(state){
  const e=state.energy||{},m=state.advanced?.economy||{},availability=Math.max(0,Math.min(1,num(e.availability||100)/100));
  const gasMWh=num(e.gasMW)*24*.56*availability,solarMWh=num(e.solarMW)*24*.25*availability,windMWh=num(e.windMW)*24*.39*availability;
  const generation=gasMWh+solarMWh+windMWh,revenue=generation*num(m.electricityPriceMWh||90);
  const gasFuel=gasMWh*num(m.gasCostMWh||39),carbon=gasMWh*.36*num(m.carbonPriceTon||0),om=(num(e.gasMW)*18+num(e.solarMW)*7+num(e.windMW)*12)*availability;
  const storageMargin=num(e.storageMWh)*.16*Math.max(8,num(m.electricityPriceMWh||90)-num(m.gasCostMWh||39))*.22;
  const powerCompany=companyModel(state,'power'),bankCompany=companyModel(state,'bank');
  const powerRevenue=(revenue+storageMargin)*(1+(num(powerCompany.serviceLevel)-85)*.0015)*(1+num(powerCompany.automation)*.00035),powerExpense=(gasFuel+carbon+om)*(1+num(powerCompany.automation)*.00035),power=powerRevenue-powerExpense;
  const b=state.bank||{},interestIncome=num(b.loans)*num(m.loanYield||.07)/365,depositExpense=num(b.deposits)*num(m.depositRate||.03)/365;
  const expectedLoss=num(b.loans)*(num(b.npl)/100)*.08/365,bankOpex=num(b.branches)*11800,feeIncome=num(b.feeIncomeYTD)/365,liquidityCarry=num(b.hqla)*.018/365;
  const bankFactor=(1+(num(bankCompany.serviceLevel)-85)*.001)*(1+num(bankCompany.automation)*.0002),bankRevenue=(interestIncome+feeIncome+liquidityCarry)*bankFactor,bankExpense=(depositExpense+expectedLoss+bankOpex)*bankFactor,bank=bankRevenue-bankExpense;
  return {power,bank,detail:{generation,revenue,gasFuel,carbon,storageMargin,interestIncome,depositExpense,expectedLoss,powerRevenue,powerExpense,bankRevenue,bankExpense,bankOpex,feeIncome,liquidityCarry}};
}
const API=Object.freeze({VERSION,sectorEconomics});globalThis.GH_ECONOMICS_CORE=API;if(globalThis.window&&window!==globalThis)window.GH_ECONOMICS_CORE=API;if(typeof module!=='undefined'&&module.exports)module.exports=API;
})();

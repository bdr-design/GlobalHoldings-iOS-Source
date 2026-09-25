(() => {
  'use strict';

  const VERSION = '3.0.0';
  const number = value => Number(value) || 0;

  function companyModel(state, type) {
    const corporateCore = globalThis.GH_CORPORATE_CORE;
    if (corporateCore?.model) return corporateCore.model(state, type);
    return state.advanced?.companies?.[type] || {serviceLevel: 86, automation: 48};
  }

  function facilityExpense(state, companyId) {
    const facilityCore = globalThis.GH_FACILITY_CORE;
    if (facilityCore?.dailyOperatingCosts) {
      return number(facilityCore.dailyOperatingCosts(state).byCompany[companyId]);
    }

    const facilities = [...(state.globalBases || []), ...(state.customHubs || [])];
    const hasOwnedCompanyFacility = facilities.some(row =>
      row?.owned === true &&
      String(row.ownerCompanyId || row.companyId || row.company || '') === companyId
    );
    if (hasOwnedCompanyFacility) throw new Error('facility-daily-cost-owner-missing');
    return 0;
  }

  function requestedReportDay(options) {
    return Number.isFinite(Number(options.day)) ? Math.floor(Number(options.day)) : null;
  }

  function reportForDay(history, day) {
    return day === null ? null : (history || []).find(row => Number(row.day) === day);
  }

  function powerEconomics(state, options, day, market) {
    const energy = state.energy || {};
    const availability = Math.max(0, Math.min(1, number(energy.availability || 100) / 100));
    const dailyReport = options.preferDailyReport
      ? reportForDay(energy.dailyHistory, day)
      : null;
    const energyDetail = dailyReport || globalThis.GH_ENERGY_CORE?.economics?.(state, market);

    const gasMWh = number(energy.gasMW) * 24 * 0.56 * availability;
    const solarMWh = number(energy.solarMW) * 24 * 0.25 * availability;
    const windMWh = number(energy.windMW) * 24 * 0.39 * availability;
    const generation = energyDetail?.generation ?? (gasMWh + solarMWh + windMWh);
    const revenue = energyDetail?.powerRevenue ??
      (generation * number(market.electricityPriceMWh || 90));
    const gasFuel = energyDetail?.gasFuel ??
      (gasMWh * number(market.gasCostMWh || 39));
    const carbon = energyDetail?.carbon ??
      (gasMWh * 0.36 * number(market.carbonPriceTon || 0));
    const operations = energyDetail?.operations ??
      ((number(energy.gasMW) * 18 +
        number(energy.solarMW) * 7 +
        number(energy.windMW) * 12) * availability);
    const storageMargin = energyDetail?.storageRevenue ??
      (number(energy.storageMWh) * 0.16 *
        Math.max(8, number(market.electricityPriceMWh || 90) -
          number(market.gasCostMWh || 39)) * 0.22);

    const powerCompany = companyModel(state, 'power');
    const bankCompany = companyModel(state, 'bank');
    const powerFacilityExpense = dailyReport &&
      Number.isFinite(Number(dailyReport.facilityOpex))
      ? number(dailyReport.facilityOpex)
      : facilityExpense(state, 'power');

    const powerRevenue = dailyReport
      ? number(dailyReport.powerRevenue)
      : (energyDetail?.powerRevenue ?? (revenue + storageMargin)) *
        (1 + (number(powerCompany.serviceLevel) - 85) * 0.0015) *
        (1 + number(powerCompany.automation) * 0.00035);
    const powerVariableExpense = dailyReport
      ? Math.max(
        0,
        number(dailyReport.powerExpense) -
          (dailyReport.facilityOpex === undefined ? 0 : powerFacilityExpense)
      )
      : Math.max(
        0,
        (energyDetail?.powerExpense ?? (gasFuel + carbon + operations)) -
          number(energyDetail?.facilityOpex)
      ) *
        (1 - Math.min(0.12, number(powerCompany.automation) * 0.0012));
    const powerExpense = powerVariableExpense + powerFacilityExpense;
    const powerExpenseToPost = Math.max(
      0,
      powerVariableExpense - number(dailyReport?.takeOrPayAccrued)
    );
    const powerDebtPrincipal = number(energyDetail?.debtPrincipal);
    const powerDebtInterest = number(energyDetail?.debtInterest);
    const powerDebtService = powerDebtPrincipal + powerDebtInterest;
    const power = powerRevenue - powerExpense - powerDebtInterest;
    const powerFreeCash = power - powerDebtPrincipal;

    return {
      power,
      powerFreeCash,
      values: {
        generation,
        revenue,
        gasFuel,
        carbon,
        storageMargin,
        ppaRevenue: number(energyDetail?.ppaRevenue),
        spotRevenue: number(energyDetail?.spotRevenue),
        ppaMWh: number(energyDetail?.ppaMWh),
        powerRevenue,
        powerExpense,
        powerDebtPrincipal,
        powerDebtInterest,
        powerDebtService,
        powerExpenseToPost,
        powerFacilityExpense,
        takeOrPayAccrued: number(dailyReport?.takeOrPayAccrued)
      },
      dailyReport,
      bankCompany,
      powerVariableExpense,
      powerFacilityExpense,
      powerDebtPrincipal,
      powerDebtInterest
    };
  }

  function bankEconomics(state, options, day, bankCompany, market) {
    const bankCore = globalThis.GH_BANKING_CORE;
    const bank = bankCore?.reconcilePrudential?.(state) || state.bank || {};
    const dailyReport = options.preferDailyReport
      ? reportForDay(bank.dailyHistory, day)
      : null;
    const activePortfolios = (bank.loanPortfolios || []).filter(row =>
      ['نشطة', 'مراقبة', 'متعثرة'].includes(row.status)
    );
    const pricedPrincipal = activePortfolios.reduce(
      (sum, row) => sum + number(row.outstanding),
      0
    );
    const portfolioInterest = activePortfolios.reduce(
      (sum, row) =>
        sum + number(row.outstanding) * number(row.rate || market.loanYield || 0.07) / 365,
      0
    );
    const otherLoanPrincipal = Math.max(0, number(bank.loans) - pricedPrincipal);
    const interestIncome = dailyReport
      ? number(dailyReport.interestIncome)
      : portfolioInterest + otherLoanPrincipal * number(market.loanYield || 0.07) / 365;

    const branchMix = (bank.branchNetwork || []).reduce((totals, row) => {
      totals.sight += number(row.depositMix?.sight);
      totals.savings += number(row.depositMix?.savings);
      totals.term += number(row.depositMix?.term);
      return totals;
    }, {sight: 0, savings: 0, term: 0});
    const knownDeposits = branchMix.sight + branchMix.savings + branchMix.term;
    const unclassifiedDeposits = Math.max(0, number(bank.deposits) - knownDeposits);
    branchMix.sight += unclassifiedDeposits * 0.45;
    branchMix.savings += unclassifiedDeposits * 0.35;
    branchMix.term += unclassifiedDeposits * 0.20;

    const depositPricing = bank.depositPricing || {
      sight: number(market.depositRate || 0.03) * 0.4,
      savings: number(market.depositRate || 0.03) * 0.92,
      term: number(market.depositRate || 0.03) * 1.28
    };
    const depositExpense = dailyReport
      ? number(dailyReport.depositInterestExpense)
      : (
        branchMix.sight * number(depositPricing.sight) +
        branchMix.savings * number(depositPricing.savings) +
        branchMix.term * number(depositPricing.term)
      ) / 365;

    const activeSecurities = (bank.treasurySecurities || [])
      .filter(row => row.status === 'ساري');
    const securityIncome = dailyReport
      ? number(dailyReport.securityIncome)
      : activeSecurities.reduce(
        (sum, row) => sum + number(row.amount) * number(row.yieldRate) / 365,
        0
      );
    const securityHqla = activeSecurities.reduce(
      (sum, row) => sum + number(row.amount) * number(row.hqlaFactor || 0.85),
      0
    );
    const liquidityCarry = dailyReport
      ? 0
      : Math.max(0, number(bank.hqla) - securityHqla) * 0.018 / 365;

    const wholesaleFacilities = (bank.wholesaleFacilities || [])
      .filter(row => row.status === 'ساري' || row.status === 'متأخر');
    const wholesaleInterestExpense = dailyReport
      ? number(dailyReport.wholesaleInterestExpense)
      : wholesaleFacilities.reduce(
        (sum, row) => sum + number(row.outstanding) * number(row.rate) / 365,
        0
      );
    const expectedLoss = dailyReport
      ? number(dailyReport.creditLossExpense)
      : activePortfolios.reduce((sum, row) =>
        sum + number(row.outstanding) *
          number(row.pd || 0.012) *
          number(row.lgd || 0.35) / 365 *
          (row.stage === 3 ? 3 : row.stage === 2 ? 1.8 : 1),
      0) +
      Math.max(0, number(bank.loans) - pricedPrincipal) *
        (number(bank.npl) / 100) * 0.08 / 365;

    const activeBranches = (bank.branchNetwork || [])
      .filter(row => row.servicesActive);
    const bankFacilityExpense = dailyReport &&
      Number.isFinite(Number(dailyReport.facilityOpex))
      ? number(dailyReport.facilityOpex)
      : facilityExpense(state, 'bank');
    const bankOpex = dailyReport
      ? number(dailyReport.opex) +
        (dailyReport.facilityOpex === undefined ? bankFacilityExpense : 0)
      : (activeBranches.length || number(bank.branches)) * 11800 +
        bankFacilityExpense;
    const modeledFees = activeBranches.reduce(
      (sum, row) =>
        sum + number(row.retailCustomers) * 1.2 +
          number(row.businessCustomers) * 18,
      0
    );
    const feeIncome = dailyReport
      ? number(dailyReport.feeIncome)
      : Math.max(number(bank.dailyServiceFeeRevenue), modeledFees);
    const transactionFeeIncome = dailyReport
      ? number(dailyReport.transactionFeeIncome)
      : 0;
    const reportedFeeIncome = feeIncome + transactionFeeIncome;

    const bankFactor =
      (1 + (number(bankCompany.serviceLevel) - 85) * 0.001) *
      (1 + number(bankCompany.automation) * 0.0002);
    const bankRevenue = dailyReport
      ? interestIncome + securityIncome + reportedFeeIncome
      : (interestIncome + securityIncome + feeIncome + liquidityCarry) * bankFactor;

    // Older reports stored the corporate cash posting instead of the remaining
    // unposted interest amount, so derive the remainder during recovery.
    const explicitUnposted = Number(dailyReport?.unpostedInterestIncome);
    const cashPostedInterest = Number(
      dailyReport?.cashPostedInterestIncome ??
        dailyReport?.corporateInterestIncome
    );
    const unpostedInterestIncome = dailyReport
      ? Number.isFinite(explicitUnposted)
        ? Math.max(0, explicitUnposted)
        : Math.max(
          0,
          interestIncome -
            (Number.isFinite(cashPostedInterest)
              ? Math.max(0, cashPostedInterest)
              : 0)
        )
      : interestIncome;
    const bankCashRevenueToPost = dailyReport
      ? unpostedInterestIncome + securityIncome + feeIncome
      : bankRevenue;
    const bankExpenseToPost = dailyReport
      ? depositExpense + wholesaleInterestExpense + expectedLoss +
        bankOpex - bankFacilityExpense
      : (depositExpense + wholesaleInterestExpense + expectedLoss +
        bankOpex - bankFacilityExpense) * bankFactor;
    const bankExpense = bankExpenseToPost + bankFacilityExpense;
    const profit = bankRevenue - bankExpense;

    return {
      bank: profit,
      dailyReport,
      values: {
        interestIncome,
        securityIncome,
        depositExpense,
        wholesaleInterestExpense,
        expectedLoss,
        bankRevenue,
        bankCashRevenueToPost,
        bankExpense,
        bankExpenseToPost,
        bankFacilityExpense,
        bankOpex,
        feeIncome,
        transactionFeeIncome,
        reportedFeeIncome,
        liquidityCarry
      }
    };
  }

  function sectorEconomics(state, options = {}) {
    const market = state.advanced?.economy || {};
    const day = requestedReportDay(options);
    const power = powerEconomics(state, options, day, market);
    const bank = bankEconomics(state, options, day, power.bankCompany, market);

    return {
      power: power.power,
      powerFreeCash: power.powerFreeCash,
      bank: bank.bank,
      detail: {
        generation: power.values.generation,
        revenue: power.values.revenue,
        gasFuel: power.values.gasFuel,
        carbon: power.values.carbon,
        storageMargin: power.values.storageMargin,
        ppaRevenue: power.values.ppaRevenue,
        spotRevenue: power.values.spotRevenue,
        ppaMWh: power.values.ppaMWh,
        interestIncome: bank.values.interestIncome,
        securityIncome: bank.values.securityIncome,
        depositExpense: bank.values.depositExpense,
        wholesaleInterestExpense: bank.values.wholesaleInterestExpense,
        expectedLoss: bank.values.expectedLoss,
        powerRevenue: power.values.powerRevenue,
        powerExpense: power.values.powerExpense,
        powerDebtPrincipal: power.values.powerDebtPrincipal,
        powerDebtInterest: power.values.powerDebtInterest,
        powerDebtService: power.values.powerDebtService,
        bankRevenue: bank.values.bankRevenue,
        bankCashRevenueToPost: bank.values.bankCashRevenueToPost,
        bankExpense: bank.values.bankExpense,
        bankExpenseToPost: bank.values.bankExpenseToPost,
        bankFacilityExpense: bank.values.bankFacilityExpense,
        powerExpenseToPost: power.values.powerExpenseToPost,
        powerFacilityExpense: power.values.powerFacilityExpense,
        takeOrPayAccrued: power.values.takeOrPayAccrued,
        bankOpex: bank.values.bankOpex,
        feeIncome: bank.values.feeIncome,
        transactionFeeIncome: bank.values.transactionFeeIncome,
        reportedFeeIncome: bank.values.reportedFeeIncome,
        liquidityCarry: bank.values.liquidityCarry
      }
    };
  }

  const API = Object.freeze({VERSION, sectorEconomics});
  globalThis.GH_ECONOMICS_CORE = API;
  if (globalThis.window && window !== globalThis) {
    window.GH_ECONOMICS_CORE = API;
  }
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = API;
  }
})();

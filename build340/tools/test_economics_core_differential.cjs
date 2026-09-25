'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const workspace = path.resolve(__dirname, '../BUILD340_REWRITE_WORKSPACE');
const reference = path.resolve(__dirname, '../BUILD339_REFERENCE');
const sourceFor = root => fs.readFileSync(
  path.join(root, 'WebApp/economics-core.js'),
  'utf8'
);

function load(source) {
  const scope = {console, structuredClone};
  scope.window = scope;
  scope.globalThis = scope;
  vm.createContext(scope);
  vm.runInContext(source, scope, {filename: 'economics-core.js'});
  return scope;
}

function random(seed) {
  let state = seed >>> 0;
  return () => {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    return (state >>> 0) / 0x100000000;
  };
}

function choose(rng, values) {
  return values[Math.floor(rng() * values.length)];
}

function maybeNumber(rng, scale = 100000) {
  return choose(rng, [
    undefined,
    null,
    0,
    Math.round((rng() - 0.2) * scale * 100) / 100,
    String(Math.round(rng() * scale)),
    'not-a-number'
  ]);
}

function maybeFields(rng, keys, scale = 100000) {
  const output = {};
  for (const key of keys) {
    if (rng() < 0.72) output[key] = maybeNumber(rng, scale);
  }
  return output;
}

function report(rng, day) {
  return {
    day,
    ...maybeFields(rng, [
      'facilityOpex', 'powerRevenue', 'powerExpense', 'takeOrPayAccrued',
      'generation', 'gasFuel', 'carbon', 'operations', 'storageRevenue',
      'ppaRevenue', 'spotRevenue', 'ppaMWh', 'debtPrincipal', 'debtInterest',
      'interestIncome', 'securityIncome', 'depositInterestExpense',
      'wholesaleInterestExpense', 'creditLossExpense', 'opex', 'feeIncome',
      'transactionFeeIncome', 'unpostedInterestIncome',
      'cashPostedInterestIncome', 'corporateInterestIncome'
    ])
  };
}

function portfolio(rng) {
  return {
    status: choose(rng, ['نشطة', 'مراقبة', 'متعثرة', 'مسددة', 'other']),
    outstanding: maybeNumber(rng),
    rate: maybeNumber(rng, 1),
    pd: maybeNumber(rng, 1),
    lgd: maybeNumber(rng, 1),
    stage: choose(rng, [undefined, 1, 2, 3, 4])
  };
}

function branch(rng) {
  return {
    depositMix: maybeFields(rng, ['sight', 'savings', 'term']),
    servicesActive: choose(rng, [true, false, undefined]),
    retailCustomers: maybeNumber(rng, 100000),
    businessCustomers: maybeNumber(rng, 10000)
  };
}

function bank(rng, day) {
  return {
    dailyHistory: rng() < 0.55
      ? Array.from({length: 3}, (_, index) => report(rng, day - index))
      : undefined,
    loanPortfolios: rng() < 0.8
      ? Array.from({length: Math.floor(rng() * 6)}, () => portfolio(rng))
      : undefined,
    branchNetwork: rng() < 0.8
      ? Array.from({length: Math.floor(rng() * 5)}, () => branch(rng))
      : undefined,
    treasurySecurities: Array.from({length: Math.floor(rng() * 5)}, () => ({
      status: choose(rng, ['ساري', 'مستحق']),
      amount: maybeNumber(rng),
      yieldRate: maybeNumber(rng, 1),
      hqlaFactor: maybeNumber(rng, 1)
    })),
    wholesaleFacilities: Array.from({length: Math.floor(rng() * 4)}, () => ({
      status: choose(rng, ['ساري', 'متأخر', 'مغلق']),
      outstanding: maybeNumber(rng),
      rate: maybeNumber(rng, 1)
    })),
    depositPricing: rng() < 0.5
      ? maybeFields(rng, ['sight', 'savings', 'term'], 1)
      : undefined,
    loans: maybeNumber(rng),
    deposits: maybeNumber(rng),
    hqla: maybeNumber(rng),
    npl: maybeNumber(rng, 100),
    branches: maybeNumber(rng),
    dailyServiceFeeRevenue: maybeNumber(rng)
  };
}

function createCase(rng, index) {
  const day = Math.floor(rng() * 90) + 1;
  const energyReports = rng() < 0.6
    ? Array.from({length: 4}, (_, offset) => report(rng, day - offset))
    : undefined;
  const companies = {};
  if (rng() < 0.85) {
    companies.power = maybeFields(rng, ['serviceLevel', 'automation'], 200);
  }
  if (rng() < 0.85) {
    companies.bank = maybeFields(rng, ['serviceLevel', 'automation'], 200);
  }

  const state = {
    advanced: {
      economy: maybeFields(rng, [
        'electricityPriceMWh', 'gasCostMWh', 'carbonPriceTon',
        'loanYield', 'depositRate'
      ], 1000),
      companies
    },
    energy: {
      availability: maybeNumber(rng, 150),
      gasMW: maybeNumber(rng, 100000),
      solarMW: maybeNumber(rng, 100000),
      windMW: maybeNumber(rng, 100000),
      storageMWh: maybeNumber(rng, 100000),
      dailyHistory: energyReports
    },
    bank: bank(rng, day),
    globalBases: rng() < 0.1
      ? [{owned: true, ownerCompanyId: choose(rng, ['power', 'bank', 'other'])}]
      : [],
    customHubs: rng() < 0.1
      ? [{owned: true, company: choose(rng, ['power', 'bank', 'other'])}]
      : [],
    __day: day,
    __index: index,
    __energyDetail: rng() < 0.65
      ? maybeFields(rng, [
        'generation', 'powerRevenue', 'gasFuel', 'carbon', 'operations',
        'powerExpense', 'facilityOpex', 'storageRevenue', 'debtPrincipal',
        'debtInterest', 'ppaRevenue', 'spotRevenue', 'ppaMWh'
      ])
      : null,
    __reconciledBank: rng() < 0.7 ? bank(rng, day) : null,
    __facilityCosts: {
      byCompany: {
        power: maybeNumber(rng),
        bank: maybeNumber(rng)
      }
    }
  };

  const options = {
    day: choose(rng, [day, day - 1, String(day), null, undefined, 'invalid']),
    preferDailyReport: rng() < 0.7
  };
  const features = {
    corporate: rng() < 0.7,
    facility: rng() < 0.85,
    energy: rng() < 0.7,
    banking: rng() < 0.7
  };
  return {state, options, features};
}

function configure(scope, features) {
  delete scope.GH_CORPORATE_CORE;
  delete scope.GH_FACILITY_CORE;
  delete scope.GH_ENERGY_CORE;
  delete scope.GH_BANKING_CORE;
  if (features.corporate) {
    scope.GH_CORPORATE_CORE = {
      model(state, type) {
        return state.advanced.companies[type] ||
          {serviceLevel: 86, automation: 48};
      }
    };
  }
  if (features.facility) {
    scope.GH_FACILITY_CORE = {
      dailyOperatingCosts(state) {
        return state.__facilityCosts;
      }
    };
  }
  if (features.energy) {
    scope.GH_ENERGY_CORE = {
      economics(state) {
        return state.__energyDetail;
      }
    };
  }
  if (features.banking) {
    scope.GH_BANKING_CORE = {
      reconcilePrudential(state) {
        return state.__reconciledBank;
      }
    };
  }
}

function evaluate(api, input) {
  try {
    return {value: JSON.parse(JSON.stringify(
      api.GH_ECONOMICS_CORE.sectorEconomics(input.state, input.options)
    ))};
  } catch (error) {
    return {
      error: {
        name: String(error?.name || 'Error'),
        message: String(error?.message || error)
      }
    };
  }
}

const oldScope = load(sourceFor(reference));
const newScope = load(sourceFor(workspace));
const rng = random(0x340ec04);
const total = 25000;
let failed = 0;

for (let index = 0; index < total; index++) {
  const input = createCase(rng, index);
  configure(oldScope, input.features);
  configure(newScope, input.features);
  const before = JSON.stringify(input.state);
  const oldResult = evaluate(oldScope, input);
  const newResult = evaluate(newScope, input);
  const after = JSON.stringify(input.state);
  assert.equal(after, before, 'economics calculation must not mutate state');
  try {
    assert.deepEqual(newResult, oldResult);
  } catch (error) {
    failed++;
    console.error(JSON.stringify({
      index,
      input,
      oldResult,
      newResult,
      error: String(error.message || error)
    }, null, 2));
    break;
  }
}

assert.equal(failed, 0);
console.log(JSON.stringify({
  scope: 'Deterministic differential comparison against the immutable Build 339 economics module',
  cases: total,
  passed: total - failed,
  seed: '0x340ec04',
  workspaceModule: path.relative(process.cwd(), path.join(workspace, 'WebApp/economics-core.js'))
}, null, 2));

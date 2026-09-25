(() => {
  'use strict';

  const VERSION = '3.0.0';
  const COMPANY_METRIC_FIELDS = Object.freeze([
    'sectorProfitToday',
    'tripProfitAccrued',
    'tripRevenueAccrued',
    'tripFuelAccrued',
    'tripMaintenanceAccrued',
    'tripCountAccrued',
    'lastClosedSectorProfit'
  ]);
  const STRUCTURAL_ARRAY_KEYS = Object.freeze([
    'assets',
    'unlockedSectors',
    'openedCompanies',
    'ownedCompanies',
    'hired',
    'acceptedContracts',
    'failedBids',
    'branches',
    'globalBases',
    'customHubs',
    'customRoutes',
    'leasedAssets',
    'eventLog',
    'alerts',
    'constructionContracts',
    'commercialTenders',
    'supplierTransactions',
    'insurancePolicies'
  ]);
  const STRUCTURAL_OBJECT_KEYS = Object.freeze([
    'stakes',
    'maDeals',
    'contractStartDays',
    'portfolio',
    'portfolioBook',
    'routeEndpoints',
    'routeCache',
    'companyRegistry',
    'companyModules',
    'companyFinance',
    'contractRegistry',
    'governance',
    'research',
    'esg',
    'ipo'
  ]);

  const clone = value => globalThis.structuredClone
    ? structuredClone(value)
    : JSON.parse(JSON.stringify(value));

  function migrateCompanyPlatform(input) {
    if (!input || typeof input !== 'object' || Array.isArray(input)) {
      throw new Error('MIGRATION_COMPANY_STATE_INVALID');
    }

    const platform = globalThis.GH_COMPANY_PLATFORM;
    if (!platform?.migrateState) {
      return {
        state: clone(input),
        changed: false,
        errors: [],
        warnings: ['company-platform-unavailable']
      };
    }
    return platform.migrateState(input);
  }

  function load(options = {}) {
    const {
      defaultState,
      storageKey,
      legacyStorageKeys = [],
      resetMarkerKey,
      saveSchema
    } = options;

    if (!defaultState || !storageKey || !saveSchema?.validate) {
      throw new Error('MIGRATION_LOAD_CONTRACT_INVALID');
    }

    const nativeJSON = typeof globalThis.__GH_NATIVE_SAVE_JSON__ === 'string'
      && globalThis.__GH_NATIVE_SAVE_JSON__.length
      ? globalThis.__GH_NATIVE_SAVE_JSON__
      : null;
    let raw = nativeJSON || localStorage.getItem(storageKey);
    let migratedLegacyKey = null;
    let source = nativeJSON ? 'native' : 'current';

    if (!raw) {
      migratedLegacyKey = legacyStorageKeys.find(key => localStorage.getItem(key)) || null;
      if (migratedLegacyKey) {
        raw = localStorage.getItem(migratedLegacyKey);
        source = 'legacy';
      }
    }

    if (!raw) {
      const pristine = globalThis.GH_GAME_LIFECYCLE?.pristine
        ? globalThis.GH_GAME_LIFECYCLE.pristine(defaultState, 0)
        : clone(defaultState);
      const companyUpgrade = migrateCompanyPlatform(pristine);
      return {
        state: saveSchema.normalize(companyUpgrade.state, defaultState),
        source: 'default',
        migratedLegacyKey: null,
        needsCanonicalPersist: false
      };
    }

    // Validate the persisted root before merging defaults or normalizing it. A
    // corrupt or future save stays intact for recovery or explicit export.
    let saved;
    try {
      saved = JSON.parse(raw);
    } catch {
      throw new Error('MIGRATION_JSON_INVALID');
    }

    if (nativeJSON) {
      try {
        delete globalThis.__GH_NATIVE_SAVE_JSON__;
      } catch {
        globalThis.__GH_NATIVE_SAVE_JSON__ = null;
      }
    }

    const schemaUpgrade = saveSchema.migrateLegacy?.(saved)
      || { state: saved, changed: false };
    const companyUpgrade = migrateCompanyPlatform(schemaUpgrade.state);
    const legacyUpgrade = {
      state: companyUpgrade.state,
      changed: schemaUpgrade.changed === true || companyUpgrade.changed === true
    };
    saved = legacyUpgrade.state;

    const validation = saveSchema.validate(saved);
    if (!validation.ok) {
      throw new Error(`MIGRATION_SAVE_REJECTED:${validation.errors.join(',')}`);
    }

    // Native Save Vault owns reset ordering. The browser marker is compatibility
    // metadata and cannot reject an authoritative native snapshot.
    const resetEpoch = source === 'native'
      ? 0
      : (resetMarkerKey ? Number(localStorage.getItem(resetMarkerKey) || 0) : 0);
    if (resetEpoch && Number(saved.resetEpoch || 0) < resetEpoch) {
      throw new Error('MIGRATION_RESET_EPOCH_CONFLICT');
    }

    const state = saveSchema.normalize({ ...clone(defaultState), ...saved }, defaultState);
    let needsCanonicalPersist = false;

    if (source === 'native') {
      needsCanonicalPersist = legacyUpgrade.changed;
    } else if (migratedLegacyKey || legacyUpgrade.changed) {
      const persistence = globalThis.GH_PERSISTENCE;
      if (!persistence?.writeState) throw new Error('MIGRATION_PERSISTENCE_UNAVAILABLE');

      const result = persistence.writeState(storageKey, state);
      if (!result.ok) {
        throw new Error(`MIGRATION_CANONICAL_WRITE_FAILED:${result.reason}`);
      }
      if (localStorage.getItem(storageKey) !== result.json) {
        throw new Error('MIGRATION_READBACK_FAILED');
      }
      if (migratedLegacyKey) localStorage.removeItem(migratedLegacyKey);
    }

    return { state, source, migratedLegacyKey, needsCanonicalPersist };
  }

  function structural(state, defaultState) {
    if (!state || typeof state !== 'object' || Array.isArray(state)) {
      throw new Error('MIGRATION_STATE_INVALID');
    }

    for (const key of STRUCTURAL_ARRAY_KEYS) {
      if (!Array.isArray(state[key])) state[key] = clone(defaultState[key] || []);
      else state[key] = state[key].filter(Boolean);
    }

    for (const key of STRUCTURAL_OBJECT_KEYS) {
      if (!state[key] || typeof state[key] !== 'object' || Array.isArray(state[key])) {
        state[key] = clone(defaultState[key] || {});
      }
    }

    if (!state.profile || typeof state.profile !== 'object') {
      state.profile = clone(defaultState.profile);
    }
    if (!state.energy || typeof state.energy !== 'object') state.energy = clone(defaultState.energy);
    if (!state.bank || typeof state.bank !== 'object') state.bank = clone(defaultState.bank);
    if (!state.treasury || typeof state.treasury !== 'object') {
      state.treasury = clone(defaultState.treasury);
    }
    if (!state.operations || typeof state.operations !== 'object') {
      state.operations = clone(defaultState.operations);
    }
    if (!state.finance || typeof state.finance !== 'object') state.finance = clone(defaultState.finance);

    if (state.saveVersion !== '2.0.0') throw new Error('MIGRATION_SCHEMA_UNSUPPORTED');
    return state;
  }

  function canonicalMetricInstances(state, companyPlatform) {
    if (companyPlatform?.listInstances) {
      const books = state.companyFinance
        && typeof state.companyFinance === 'object'
        && !Array.isArray(state.companyFinance)
        ? state.companyFinance
        : {};
      return companyPlatform.listInstances(state, { includeGroup: false }).filter(instance => (
        instance?.known
        && instance.definition?.capabilities?.includes('finance.book')
        && (instance.registered === true
          || instance.opened === true
          || Object.prototype.hasOwnProperty.call(books, instance.id))
      ));
    }

    const ids = [
      ...(Array.isArray(state.openedCompanies) ? state.openedCompanies : []),
      ...Object.keys(state.companyRegistry || {}),
      ...Object.keys(state.companyFinance || {})
    ].map(String).filter(id => id && id !== 'group');
    return [...new Set(ids)].map(id => ({ id, known: true, registered: true, definition: null }));
  }

  function normalizeCompanyMetricMaps(state, companyPlatform) {
    const instances = canonicalMetricInstances(state, companyPlatform);
    const companyIds = new Set(instances.map(instance => instance.id));
    const companiesBySector = new Map();

    for (const instance of instances) {
      for (const sector of instance.definition?.classification?.sectorIds || []) {
        const id = String(sector || '').trim();
        if (!id) continue;
        const owners = companiesBySector.get(id) || [];
        owners.push(instance.id);
        companiesBySector.set(id, owners);
      }
    }

    const normalizeMap = (source, label) => {
      const values = source && typeof source === 'object' && !Array.isArray(source) ? source : {};
      const result = Object.fromEntries([...companyIds].map(id => [id, 0]));

      for (const [rawKey, rawValue] of Object.entries(values)) {
        const key = String(rawKey || '').trim();
        const value = Number(rawValue);
        if (!key || !Number.isFinite(value)) {
          throw new Error(`MIGRATION_COMPANY_METRIC_VALUE_INVALID:${label}:${key || 'empty'}`);
        }
        if (companyIds.has(key)) {
          result[key] += value;
          continue;
        }

        const sector = String(companyPlatform?.normalizeSectorId?.(key) || key);
        const owners = companiesBySector.get(sector) || [];
        if (owners.length === 1) {
          result[owners[0]] += value;
          continue;
        }

        // Empty legacy placeholders may be dropped; nonzero values need one
        // unambiguous owner before any live state is changed.
        if (value === 0) continue;
        if (owners.length > 1) {
          throw new Error(`MIGRATION_COMPANY_METRIC_AMBIGUOUS:${label}:${key}:${owners.join(',')}`);
        }
        throw new Error(`MIGRATION_COMPANY_METRIC_OWNER_UNKNOWN:${label}:${key}`);
      }
      return result;
    };

    const normalized = {};
    for (const field of COMPANY_METRIC_FIELDS) normalized[field] = normalizeMap(state[field], field);
    return normalized;
  }

  function completeBusinessState(state, { defaultState, initialStocks, crewRolesSeed }) {
    const companyPlatform = globalThis.GH_COMPANY_PLATFORM;
    const companyMetricMaps = normalizeCompanyMetricMaps(state, companyPlatform);

    // An empty fleet after starting a new game is valid and must stay empty.
    if (!Array.isArray(state.assets)) state.assets = [];
    if (!Array.isArray(state.market)) state.market = clone(initialStocks);
    if (!Array.isArray(state.crew) || !state.crew.length) {
      state.crew = clone(crewRolesSeed).map(role => ({ ...role, count: 0 }));
    }
    if (!state.stakes) state.stakes = {};
    if (!state.maDeals || typeof state.maDeals !== 'object') state.maDeals = {};
    if (!state.portfolioBook || typeof state.portfolioBook !== 'object') state.portfolioBook = {};
    if (!state.contractStartDays) state.contractStartDays = {};

    for (const field of COMPANY_METRIC_FIELDS) state[field] = companyMetricMaps[field];
    state.lastClosedProfit = Number(state.lastClosedProfit) || 0;
    if (!state.profile) state.profile = clone(defaultState.profile);
    if (!Array.isArray(state.unlockedSectors)) {
      state.unlockedSectors = ['air', 'sea', 'road', 'power', 'bank'];
    }
    if (!Array.isArray(state.openedCompanies)) {
      state.openedCompanies = clone(state.unlockedSectors);
    }
    if (!Array.isArray(state.eventLog)) state.eventLog = [];
    if (!state.energy) state.energy = clone(defaultState.energy);
    if (!state.bank) state.bank = clone(defaultState.bank);

    // Complete old corporate-banking books without changing existing balances.
    const bankDefaults = clone(defaultState.bank);
    for (const [key, value] of Object.entries(bankDefaults)) {
      if (state.bank[key] === undefined) state.bank[key] = clone(value);
    }
    for (const key of [
      'creditFacilities',
      'lettersOfCredit',
      'guarantees',
      'cashSweeps',
      'tradeFinance',
      'riskReviews'
    ]) {
      if (!Array.isArray(state.bank[key])) state.bank[key] = [];
    }
    if (!state.bank.corporateClients
      || typeof state.bank.corporateClients !== 'object'
      || Array.isArray(state.bank.corporateClients)) {
      state.bank.corporateClients = {};
    }

    if (!state.treasury
      || !Array.isArray(state.treasury.accounts)
      || !Array.isArray(state.treasury.ledger)) {
      state.treasury = clone(defaultState.treasury);
    }
    if (!Array.isArray(state.treasury.paymentQueue)) state.treasury.paymentQueue = [];
    while (state.treasury.accounts.length < 3) {
      state.treasury.accounts.push(clone(defaultState.treasury.accounts[state.treasury.accounts.length]));
    }
    // Treasury owns holding-company accounts. Consolidated cash also includes
    // subsidiary accounts, so copying that total here would double count it.
    if (!state.operations) state.operations = clone(defaultState.operations);
    if (!state.companyRegistry || typeof state.companyRegistry !== 'object' || Array.isArray(state.companyRegistry)) {
      state.companyRegistry = {};
    }
    if (!state.companyModules || typeof state.companyModules !== 'object' || Array.isArray(state.companyModules)) {
      state.companyModules = {};
    }
    if (!Array.isArray(state.constructionContracts)) state.constructionContracts = [];
    if (!Array.isArray(state.commercialTenders)) state.commercialTenders = [];
    if (!Array.isArray(state.supplierTransactions)) state.supplierTransactions = [];
    if (!state.contractRegistry || typeof state.contractRegistry !== 'object' || Array.isArray(state.contractRegistry)) {
      state.contractRegistry = {};
    }
    if (!state.finance || !Array.isArray(state.finance.invoices)) {
      state.finance = clone(defaultState.finance);
    }
    for (const key of ['payables', 'receivables', 'cheques', 'periods', 'payrollReports']) {
      if (!Array.isArray(state.finance[key])) state.finance[key] = [];
    }
    if (!state.finance.paymentSequence) state.finance.paymentSequence = 1;
    return state;
  }

  window.GH_MIGRATION_CORE = {
    VERSION,
    load,
    structural,
    completeBusinessState,
    migrateCompanyPlatform
  };
})();

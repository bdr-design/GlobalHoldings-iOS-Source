'use strict';

const assert = require('node:assert/strict');
const {harness, minimal} = require('./helpers/core-harness');

const {s} = harness([
  'capability-registry-core',
  'company-definitions',
  'company-platform-core'
]);
const Platform = s.GH_COMPANY_PLATFORM;
const defects = [];
const check = (condition, id, evidence) => {
  if (!condition) defects.push({id, evidence});
};

const futureDefinition = {
  ...minimal(),
  onboardingComplete: true,
  companyRegistry: {
    air: {
      definitionId: 'future-air-v9',
      definitionVersion: 9,
      legalName: 'Future Air'
    }
  },
  openedCompanies: ['air']
};
const futureMigration = Platform.migrateState(futureDefinition);
const futureCompany = Platform.resolveCompany(futureMigration.state, 'air');
const futureValidation = Platform.validateState(futureMigration.state);

let futureCommandRejected = false;
try { Platform.requireCompany(futureMigration.state, 'air'); }
catch (error) { futureCommandRejected = /company-definition-unavailable:air/.test(String(error?.message || error)); }
check(
  futureCompany.known === false && futureCompany.orphan === true && futureCompany.definition === null &&
    futureValidation.warnings.includes('company-definition-missing:air') && futureCommandRejected,
  'EXPLICIT_UNKNOWN_DEFINITION_FALLS_BACK_TO_STALE_BUILTIN',
  {
    known: futureCompany.known,
    orphan: futureCompany.orphan,
    resolvedDefinitionId: futureCompany.definition?.definitionId || null,
    warnings: futureValidation.warnings,
    commandRejected: futureCommandRejected
  }
);

const canonicalOnly = {
  ...minimal(),
  onboardingComplete: true,
  companyRegistry: {
    'air-one': {definitionId: 'gh-air-v1', legalName: 'Air One'}
  },
  openedCompanies: ['air-one'],
  customRoutes: [{
    id: 'CANONICAL-ROUTE',
    ownerCompanyId: 'air-one',
    routeMode: 'air',
    operationProfileId: 'fleet-route-air-v1',
    fromFacility: 'BASE-A',
    toFacility: 'BASE-B',
    route: [[24, 46], [25, 47]]
  }],
  assets: [{
    id: 'CANONICAL-ASSET',
    ownerCompanyId: 'air-one',
    assetMode: 'air',
    assetClass: 'aircraft',
    operationProfileId: 'fleet-route-air-v1',
    baseFacility: 'BASE-A'
  }],
  customHubs: [{
    id: 'CANONICAL-FACILITY',
    ownerCompanyId: 'air-one',
    facilityKind: 'airport-base'
  }]
};
const canonicalMigration = Platform.migrateState(canonicalOnly).state;
const route = canonicalMigration.customRoutes[0];
const asset = canonicalMigration.assets[0];
const facility = canonicalMigration.customHubs[0];

const aliasesWritten = {
  route: ['type', 'company', 'companyId'].filter(key => Object.hasOwn(route, key)),
  asset: ['type', 'company', 'companyId'].filter(key => Object.hasOwn(asset, key)),
  facility: ['company', 'companyId'].filter(key => Object.hasOwn(facility, key))
};
check(
  Object.values(aliasesWritten).every(keys => keys.length === 0),
  'CANONICAL_MIGRATION_SYNTHESIZES_LEGACY_ALIASES',
  aliasesWritten
);

console.log(JSON.stringify({
  passed: defects.length === 0,
  defects,
  contracts: [
    'EXPLICIT_UNKNOWN_DEFINITION_FAILS_CLOSED',
    'CANONICAL_MIGRATION_DOES_NOT_WRITE_LEGACY_ALIASES'
  ]
}, null, 2));
assert.deepEqual(defects, [], `${defects.length} company-platform compatibility defects reproduced`);

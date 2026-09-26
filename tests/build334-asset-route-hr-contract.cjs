'use strict';

const assert = require('assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

process.env.GH_TEST_SOURCE_DIR = path.resolve(__dirname, '..');
const {harness, minimal} = require('./helpers/core-harness');
const appSource = fs.readFileSync(path.join(__dirname, '../WebApp/app.js'), 'utf8');
const defects = [];
const passes = [];
const check = (condition, id, evidence) => condition ? passes.push(id) : defects.push({id, evidence});

const route = {
  id: 'B334-AIR-ROUTE', type: 'air', company: 'air', name: 'Audit route',
  from: 'A', to: 'B', fromFacility: 'BASE-air', toFacility: 'PUBLIC-air',
  route: [[24.7, 46.6], [25.2, 47.1]], distanceKm: 90,
  effectiveSpeedKmh: 60, tripSeconds: 100, dwellHours: 1
};
const asset = id => ({
  id, name: id, type: 'air', baseFacility: 'BASE-air', phase: 'turnaround',
  progress: 0, fuel: 100, condition: 100, routeId: null, routeSlot: null,
  departureScheduled: false, staffing: {mode: 'automatic-fixed', ready: true, roles: [], total: 1, monthlyPayroll: 1}
});

const {s: fleetBox} = harness(['route-core', 'fleet-core', 'simulation-asset-core']);
const first = asset('B334-A1');
const second = asset('B334-A2');
const fleetState = {...minimal(), assets: [first, second], customRoutes: [route]};
let batchRejected = false;
try {
  fleetBox.GH_FLEET_CORE.assignRoutesBatch(fleetState, [
    {id: first.id, routeId: route.id, route, phase: 'turnaround'},
    {id: second.id, routeId: 'WRONG-ID', route, phase: 'turnaround'}
  ]);
} catch (_error) { batchRejected = true; }
check(batchRejected && first.routeId === null && second.routeId === null,
  'FLEET_BATCH_VALIDATES_BEFORE_MUTATION', {batchRejected, firstRoute: first.routeId, secondRoute: second.routeId});

let isolationRejected = false;
try { fleetBox.GH_ROUTE_CORE.canonicalRoute({...route, company: 'sea'}); }
catch (_error) { isolationRejected = true; }
check(isolationRejected, 'ROUTE_COMPANY_ISOLATION', {isolationRejected});

const moving = {...asset('B334-MOVING'), routeId: route.id, phase: 'moving', progress: 0.5, routeSlot: 0};
const simulationState = {...minimal(), simSeconds: 0, assets: [moving]};
Object.assign(fleetBox, {
  SIMULATION_ASSET_ENGINE: fleetBox.GH_SIMULATION_ASSET_CORE,
  state: simulationState,
  routeTemplates: {[route.id]: route},
  clone: structuredClone,
  clamp: (value, min, max) => Math.max(min, Math.min(max, value)),
  normalizeAsset: row => fleetBox.GH_FLEET_CORE.normalizeAsset(row, {route}),
  routeMatchingFacility: () => route,
  loadLabel: () => '',
  computeTripEconomics: () => ({margin: 0, revenue: 0, fuelCost: 0, maintReserve: 0, cashContribution: 0}),
  assetOwnerCompanyId: row => row.ownerCompanyId || row.companyId || row.type,
  assetModeOf: row => row.assetMode || row.type,
  formatDuration: String,
  fmtMoney: String,
  findFacility: () => null,
  diag: () => {}
});
vm.runInContext(appSource.slice(appSource.indexOf('  function makeSimulationEffects('), appSource.indexOf('  function simulationCalendarDate(')), fleetBox);
const movingDraft = structuredClone(moving);
const effects = fleetBox.makeSimulationEffects();
fleetBox.processAssetDraft(movingDraft, 60, effects, {from: 0, to: 60, speed: 60, infiniteMoney: false});
check(movingDraft.departureScheduledAt === 60 + movingDraft.dwellRemaining,
  'ASSET_DEPARTURE_TIMESTAMP_DRIFTS_AFTER_MID_SLICE_ARRIVAL', {
    progressAtStart: 0.5,
    sliceSeconds: 60,
    tripSeconds: 100,
    dwellRemainingAtSliceEnd: movingDraft.dwellRemaining,
    storedDepartureScheduledAt: movingDraft.departureScheduledAt,
    expectedDepartureScheduledAt: 60 + movingDraft.dwellRemaining
  });

const missingRouteDraft = {...asset('B334-MISSING-ROUTE'), routeId: 'MISSING', phase: 'moving', progress: 0.25};
fleetBox.processAssetDraft(missingRouteDraft, 60, fleetBox.makeSimulationEffects(), {from: 0, to: 60, speed: 60, infiniteMoney: false});
check(Boolean(missingRouteDraft.simulationFault) || missingRouteDraft.routeId === null,
  'ASSET_WITH_MISSING_ROUTE_FREEZES_SILENTLY', {
    routeId: missingRouteDraft.routeId,
    phase: missingRouteDraft.phase,
    progress: missingRouteDraft.progress,
    simulationFault: missingRouteDraft.simulationFault || null
  });

const {s: hrBox} = harness(['transaction-core', 'domain-command-core', 'hr-core']);
const hrState = {...minimal(), advanced: {}, hired: [], openedCompanies: ['air'], assets: [{type: 'air'}]};
let missingCatalogRejected = false;
let missingCatalogResult = null;
try {
  missingCatalogResult = hrBox.GH_DOMAIN_COMMANDS.dispatch(
    {state: hrState, candidates: []}, 'hr', 'hire',
    {company: 'air', scope: 'executive', source: 'Build334 audit'},
    {actor: 'qa'}
  ).result;
} catch (_error) { missingCatalogRejected = true; }
check(missingCatalogRejected,
  'HR_MISSING_CANDIDATE_CATALOG_REPORTS_FALSE_COMPLETE', {
    rejected: missingCatalogRejected,
    result: missingCatalogResult,
    snapshot: hrBox.GH_HR_CORE.snapshot(hrState, {candidates: []}, 'air')
  });

const salaryState = {...minimal(), advanced: {}, hired: [], openedCompanies: []};
hrBox.GH_HR_CORE.applySalaryRaise(salaryState, {company: 'group', percent: 5, reference: 'B334-SALARY'});
let salaryConflictRejected = false;
try { hrBox.GH_HR_CORE.applySalaryRaise(salaryState, {company: 'group', percent: 10, reference: 'B334-SALARY'}); }
catch (_error) { salaryConflictRejected = true; }
check(salaryConflictRejected,
  'HR_SALARY_REFERENCE_CONFLICT_SILENT', {
    retryAccepted: !salaryConflictRejected,
    history: hrBox.GH_HR_CORE.salaryHistory(salaryState, 'group')
  });

const result = {passed: defects.length === 0, passCount: passes.length, passes, defectCount: defects.length, defects};
console.log(JSON.stringify(result, null, 2));
assert.deepEqual(defects, [], `${defects.length} asset/route/HR contract defects reproduced`);

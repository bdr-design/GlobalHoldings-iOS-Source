'use strict';

const assert = require('assert/strict');
const path = require('path');

process.env.GH_TEST_SOURCE_DIR = path.resolve(__dirname, '..');
const {harness, minimal} = require('./helpers/core-harness');
const {s} = harness([
  'capability-registry-core', 'company-definitions', 'company-platform-core',
  'authorization-core', 'document-proof-core', 'transaction-core',
  'domain-command-core', 'finance-core', 'save-schema'
]);
const Platform = s.GH_COMPANY_PLATFORM;
const Finance = s.GH_FINANCE_CORE;
const Auth = s.GH_AUTHORIZATION;
const FOUNDER_PRINCIPAL_ID = 'PLAYER-FOUNDER';

function dynamicRecord(id, definitionId) {
  const definition = Platform.getDefinition(definitionId);
  return {...Platform.instanceMetadata(id, definition), legalName: `${id} Legal Company`, status: 'active'};
}

const state = minimal();
state.profile = {name: 'Dynamic Group', founder: 'Dynamic Founder'};
state.onboardingComplete = true;
state.companyRegistry = {
  group: dynamicRecord('group', 'group'),
  'air-east': dynamicRecord('air-east', 'air'),
  'sea-west': dynamicRecord('sea-west', 'sea')
};
Object.assign(state.companyRegistry.group, {taxId: 'TAX-GROUP-334', registrationNo: 'REG-GROUP-334', jurisdiction: 'Riyadh'});
state.openedCompanies = ['air-east', 'sea-west'];
Finance.ensure(state);

assert.equal(JSON.stringify(Finance.companyIds(state)), JSON.stringify(['group', 'air-east', 'sea-west']));
assert.equal(Finance.supportsCompany(state, 'group'), true);
assert.equal(Finance.supportsCompany(state, 'air-east'), true);
assert.equal(Finance.supportsCompany(state, 'air'), false, 'a definition alone must not create a finance book');
assert.equal(Finance.supportsCompany(state, 'unknown-company'), false);
assert.throws(() => Finance.book(state, 'unknown-company'), /company-definition-unavailable|company-not-found/);

const beforeUnknown = JSON.stringify(state);
assert.throws(() => s.GH_DOMAIN_COMMANDS.dispatch({state}, 'finance', 'transfer', {
  from: 'group', to: 'unknown-company', amount: 100, ref: 'UNKNOWN-TRANSFER'
}), /company-definition-unavailable|company-not-found/);
assert.equal(JSON.stringify(state), beforeUnknown, 'unknown company must not fall through to the group or mutate money');

Auth.ensurePrincipal(state, {id: FOUNDER_PRINCIPAL_ID, legalName: 'Dynamic Founder'});
Auth.createVisualSeal(state, {
  ownerPersonId: FOUNDER_PRINCIPAL_ID,
  strokes: [[{x: 0.1, y: 0.3}, {x: 0.5, y: 0.7}, {x: 0.9, y: 0.2}]]
});
Auth.createDefaultMandate(state, {principalId: FOUNDER_PRINCIPAL_ID, companyIds: ['*'], scopes: ['finance.*']});

// A second valid delegate is deliberately created first alphabetically.  No
// system document may borrow this person's seal when the founder is requested.
Auth.ensurePrincipal(state, {id: 'AAA-DELEGATE', legalName: 'Unrelated Delegate'});
Auth.createVisualSeal(state, {
  ownerPersonId: 'AAA-DELEGATE',
  strokes: [[{x: 0.08, y: 0.5}, {x: 0.45, y: 0.18}, {x: 0.91, y: 0.58}]]
});
Auth.createDefaultMandate(state, {principalId: 'AAA-DELEGATE', companyIds: ['*'], scopes: ['finance.*']});

Auth.ensurePrincipal(state, {id: 'group-only', legalName: 'Group Only Officer'});
const groupOnlySeal = Auth.createVisualSeal(state, {
  ownerPersonId: 'group-only',
  strokes: [[{x: 0.12, y: 0.25}, {x: 0.48, y: 0.72}, {x: 0.88, y: 0.28}]]
});
const groupOnlyMandate = Auth.createDefaultMandate(state, {principalId: 'group-only', companyIds: ['group'], scopes: ['*']});
assert.throws(() => Auth.buildActiveEnvelope(state, {
  domain: 'finance', name: 'issue-intercompany-loan',
  payload: {lender: 'air-east', borrower: 'sea-west', amount: 100},
  actor: {principalId: 'group-only'}
}), /active-mandate-required/);
const crossCompanyEnvelope = Auth.buildEnvelope(state, {
  domain: 'finance', name: 'issue-intercompany-loan',
  payload: {lender: 'air-east', borrower: 'sea-west', amount: 100},
  idempotencyKey: 'CROSS-COMPANY-DENIED-1', actor: {kind: 'player', principalId: 'group-only'},
  signatureAssetId: groupOnlySeal.id, mandateId: groupOnlyMandate.id
});
const beforeCrossCompany = JSON.stringify(state);
assert.throws(() => s.GH_DOMAIN_COMMANDS.dispatchEnvelope({state}, crossCompanyEnvelope), /approval-company-not-authorized/);
assert.equal(JSON.stringify(state), beforeCrossCompany, 'multi-company authorization rejection must not mutate state');

state.finance.cheques.unshift({id: 'CHK-AIR-EAST', company: 'air-east', status: 'صادر'});
state.globalBases = [{id: 'BASE-AIR-EAST', ownerCompanyId: 'air-east', owned: true}];
state.constructionContracts = [{id: 'BUILD-SEA-WEST', company: 'sea-west', status: 'قيد التنفيذ'}];
state.contractRegistry = {'CONTRACT-AIR-EAST': {company: 'air-east', status: 'بانتظار التوقيع'}};
for (const [domain, name, payload] of [
  ['finance', 'settle-cheque', {id: 'CHK-AIR-EAST'}],
  ['corporate', 'rename-company', {type: 'air-east', legalName: 'Denied Rename'}],
  ['corporate', 'set-logo', {type: 'air-east', logo: null}],
  ['facilities', 'budget', {id: 'BASE-AIR-EAST', amount: 1}],
  ['procurement', 'configure-construction', {id: 'BUILD-SEA-WEST', commissioned: true}],
  ['contracts', 'sign', {id: 'CONTRACT-AIR-EAST'}]
]) assert.throws(() => Auth.buildActiveEnvelope(state, {
  domain, name, payload, actor: {principalId: 'group-only'}
}), /active-mandate-required/, `${domain}.${name} must resolve its record owner instead of falling back to group`);

const originalActiveSeal = state.authorization.activeVisualSealByPerson[FOUNDER_PRINCIPAL_ID];
state.authorization.activeVisualSealByPerson[FOUNDER_PRINCIPAL_ID] = 'missing-seal';
assert.equal(Auth.findDelegatedAuthorization(state, {domain: 'finance', name: 'transfer', companyId: 'group', principalId: FOUNDER_PRINCIPAL_ID}), null, 'delegation must fail closed for a broken active-seal binding');
state.authorization.activeVisualSealByPerson[FOUNDER_PRINCIPAL_ID] = originalActiveSeal;

const system = s.GH_DOMAIN_COMMANDS.dispatchSystem({state}, 'finance', 'transfer', {
  from: 'group', to: 'air-east', amount: 1000, ref: 'SYSTEM-DELEGATED-1'
}, {actor: 'simulation-finance', authority: {principalId: FOUNDER_PRINCIPAL_ID}, idempotencyKey: 'SYSTEM-DELEGATED-1'});
assert.equal(system.ok, true);
const systemDocument = state.finance.transfers.find(row => row.id === 'SYSTEM-DELEGATED-1');
assert.equal(systemDocument.authorizationKind, 'delegated-system');
assert.equal(systemDocument.signatureSnapshot.kind, 'visual-authorization-seal');
assert.equal(systemDocument.issuerSnapshot.taxId, 'TAX-GROUP-334');
assert.equal(systemDocument.issuerSnapshot.registrationNo, 'REG-GROUP-334');
assert.equal(systemDocument.issuerSnapshot.jurisdiction, 'Riyadh');
assert.match(systemDocument.issuerSnapshot.logoDigest, /^[a-f0-9]{64}$/);
const delegatedProof = Auth.verifyProof(state, systemDocument.authorizationProofId);
assert.equal(delegatedProof.ok, true);
assert.equal(JSON.stringify(delegatedProof.proof.documentIds), JSON.stringify([systemDocument.id]));
assert.equal(JSON.stringify(delegatedProof.proof.documentDigests), JSON.stringify([systemDocument.contentDigest]));
assert.equal(delegatedProof.proof.mandateDigest, systemDocument.signatureSnapshot.mandateDigest);
assert.equal(delegatedProof.proof.mandateSnapshot.principalId, FOUNDER_PRINCIPAL_ID);
assert.equal(delegatedProof.proof.signerPersonId, FOUNDER_PRINCIPAL_ID, 'system document must use the explicitly delegated founder seal');
assert.ok(delegatedProof.proof.mandateSnapshot.scopes.includes('finance.*'));
assert.ok(delegatedProof.proof.mandateSnapshot.companyIds.includes('*'));
assert.equal(s.GH_DOCUMENT_PROOF.verifyDocument(state, systemDocument).ok, true);

const manualEnvelope = Auth.buildActiveEnvelope(state, {
  domain: 'finance', name: 'transfer',
  payload: {from: 'group', to: 'air-east', amount: 500, ref: 'MANUAL-APPROVED-1'},
  idempotencyKey: 'MANUAL-APPROVED-1', actor: {principalId: FOUNDER_PRINCIPAL_ID}
});
const manual = s.GH_DOMAIN_COMMANDS.dispatchEnvelope({state}, manualEnvelope);
assert.equal(manual.ok, true);
const manualDocument = state.finance.transfers.find(row => row.id === 'MANUAL-APPROVED-1');
assert.equal(manualDocument.authorizationKind, 'stored-signature');
assert.equal(manualDocument.authorizationProofId, manual.authorizationProofId);
assert.equal(s.GH_DOCUMENT_PROOF.verifyDocument(state, manualDocument).ok, true);

Auth.registerCommandTargetResolver('nested-audit', () => ['group']);
Auth.createDefaultMandate(state, {principalId: FOUNDER_PRINCIPAL_ID, companyIds: ['*'], scopes: ['nested-audit.*']});
s.GH_DOMAIN_COMMANDS.register('nested-audit', {
  execute(ctx, name) {
    if (name !== 'issue') throw new Error('nested-audit-command-invalid');
    return s.GH_DOMAIN_COMMANDS.dispatchSystem({state: ctx.state}, 'finance', 'issue-invoice', {
      company: 'group', kind: 'مصروف', amount: 25, note: 'Nested approved invoice',
      counterparty: 'Nested Audit Supplier', taxable: false, status: 'مستحقة', number: 'NESTED-APPROVED-1'
    }, {actor: 'financial-close'}).result;
  }
});
const nestedEnvelope = Auth.buildActiveEnvelope(state, {
  domain: 'nested-audit', name: 'issue', payload: {}, idempotencyKey: 'NESTED-APPROVED-1', actor: {principalId: FOUNDER_PRINCIPAL_ID}
});
const nested = s.GH_DOMAIN_COMMANDS.dispatchEnvelope({state}, nestedEnvelope);
const nestedDocument = state.finance.invoices.find(row => row.number === 'NESTED-APPROVED-1');
assert.equal(nestedDocument.authorizationKind, 'stored-signature', 'documents created by a registered nested system command inherit the outer player approval');
assert.equal(nestedDocument.authorizationProofId, nested.authorizationProofId);
assert.equal(s.GH_DOCUMENT_PROOF.verifyDocument(state, nestedDocument).ok, true);
assert.equal(s.GH_SAVE_SCHEMA.validate(state).ok, true);

// A missing founder seal must never fall through to another valid delegate.
// The automatic operation may still post, but its document remains explicitly
// unsealed so the UI cannot represent it as founder-authorized.
state.authorization.activeVisualSealByPerson[FOUNDER_PRINCIPAL_ID] = 'missing-seal';
const missingFounder = s.GH_DOMAIN_COMMANDS.dispatchSystem({state}, 'finance', 'transfer', {
  from: 'group', to: 'air-east', amount: 10, ref: 'SYSTEM-FOUNDER-MISSING-1'
}, {actor: 'simulation-finance', authority: {principalId: FOUNDER_PRINCIPAL_ID}, idempotencyKey: 'SYSTEM-FOUNDER-MISSING-1'});
assert.equal(missingFounder.ok, true);
const unsealedDocument = state.finance.transfers.find(row => row.id === 'SYSTEM-FOUNDER-MISSING-1');
assert.equal(unsealedDocument.authorizationKind, 'system-unsealed');
assert.equal(unsealedDocument.authorizationProofId, undefined);
assert.notEqual(unsealedDocument.signatureSnapshot?.ownerPersonId, 'AAA-DELEGATE');
state.authorization.activeVisualSealByPerson[FOUNDER_PRINCIPAL_ID] = originalActiveSeal;

const beforeSealedPolicy = structuredClone(state);
s.GH_DOMAIN_COMMANDS.sealSecurityPolicy();
assert.equal(s.GH_DOMAIN_COMMANDS.isSecurityPolicySealed(), true);
assert.throws(() => s.GH_DOMAIN_COMMANDS.dispatch({state}, 'finance', 'transfer', {
  from: 'group', to: 'air-east', amount: 1, ref: 'FORGED-SYSTEM-ACTOR'
}, {actor: 'system-forged'}), /authorization-envelope-required/);
assert.throws(() => s.GH_DOMAIN_COMMANDS.dispatchSystem({state}, 'finance', 'transfer', {
  from: 'group', to: 'air-east', amount: 1, ref: 'UNREGISTERED-SYSTEM-ACTOR'
}, {actor: 'simulation-evil'}), /unregistered-system-actor/);
assert.equal(JSON.stringify(state), JSON.stringify(beforeSealedPolicy), 'forged and unregistered system actors must not mutate state');
const exactSystem = s.GH_DOMAIN_COMMANDS.dispatchSystem({state}, 'finance', 'transfer', {
  from: 'group', to: 'air-east', amount: 1, ref: 'EXACT-SYSTEM-ACTOR'
}, {actor: 'simulation-finance', authority: {principalId: FOUNDER_PRINCIPAL_ID}, idempotencyKey: 'EXACT-SYSTEM-ACTOR'});
assert.equal(exactSystem.ok, true);
assert.equal(state.domainRuntime.commands[0].systemAuthorized, true);

const knownBalance = Finance.operating(state, 'group');
assert.throws(() => Finance.execute({state}, 'founder-withdrawal', {
  company: 'unknown-company', amount: 1, ref: 'UNKNOWN-WITHDRAW'
}), /company-definition-unavailable|company-not-found/);
assert.equal(Finance.operating(state, 'group'), knownBalance);

console.log(JSON.stringify({
  suite: 'build334-finance-company-security',
  passed: 8,
  total: 8,
  companies: Finance.companyIds(state),
  systemAuthorization: systemDocument.authorizationKind,
  manualAuthorization: manualDocument.authorizationKind
}, null, 2));

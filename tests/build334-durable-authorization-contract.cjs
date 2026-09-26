'use strict';

const assert = require('assert/strict');
const path = require('path');

process.env.GH_TEST_SOURCE_DIR = path.resolve(__dirname, '..');
const {harness, minimal} = require('./helpers/core-harness');

function authorizationHarness() {
  const h = harness(['save-schema', 'authorization-core', 'document-proof-core', 'transaction-core', 'domain-command-core']);
  const {s} = h;
  const state = minimal();
  state.profile = {name: 'Audit Holdings', founder: 'Audit Founder'};
  const Auth = s.GH_AUTHORIZATION;
  Auth.ensurePrincipal(state, {id: 'founder', legalName: 'Audit Founder'});
  Auth.createVisualSeal(state, {
    ownerPersonId: 'founder',
    strokes: [[{x: 0.1, y: 0.2}, {x: 0.55, y: 0.65}, {x: 0.9, y: 0.3}]]
  });
  Auth.createDefaultMandate(state, {principalId: 'founder', companyIds: ['*'], scopes: ['audit.*']});
  Auth.registerCommandTargetResolver('audit', () => ['group']);
  s.GH_DOMAIN_COMMANDS.register('audit', {
    execute(ctx, name, payload) {
      if (name !== 'post') throw new Error('unknown-audit-command');
      ctx.state.auditCount = (ctx.state.auditCount || 0) + 1;
      const document = {
        id: `AUD-${ctx.state.auditCount}`,
        company: 'group',
        counterparty: payload.counterparty || 'Audit Counterparty',
        amount: payload.amount,
        subtotal: payload.amount,
        tax: 0,
        total: payload.amount,
        currency: 'USD',
        issuedAt: ctx.state.simSeconds,
        note: payload.note || 'Audit document'
      };
      s.GH_DOCUMENT_PROOF.sealDocument(ctx.state, document, {type: 'audit-invoice', companyId: 'group'});
      ctx.state.finance.invoices.unshift(document);
      return {document, auditCount: ctx.state.auditCount};
    }
  });
  return {h, s, state, Auth};
}

async function testAuthorizationAndIdempotency() {
  const {s, state, Auth} = authorizationHarness();
  assert.equal(s.GH_SAVE_SCHEMA.validate(minimal()).ok, true, 'legacy Schema 2.0.0 save must remain valid');

  for (const invalid of [
    {value: undefined},
    {value: Number.NaN},
    {value: Number.POSITIVE_INFINITY},
    {value: () => true},
    {value: 1n},
    {value: new Date(0)}
  ]) assert.throws(() => Auth.stable(invalid), /authorization-(unsupported|non-finite|non-json)/);
  const sparse = []; sparse.length = 1;
  assert.throws(() => Auth.stable(sparse), /authorization-unsupported-value/);
  assert.equal(Auth.stable({z: 'é', a: '😀'}), '{"a":"😀","z":"é"}');

  const envelope = Auth.buildActiveEnvelope(state, {
    domain: 'audit', name: 'post', payload: {amount: 125, counterparty: 'Alpha'},
    idempotencyKey: 'AUDIT-IDEMPOTENCY-1', actor: {principalId: 'founder'}
  });
  const beforeTamper = structuredClone(state);
  const tamperedEnvelope = structuredClone(envelope);
  tamperedEnvelope.command.payload.amount = 126;
  assert.throws(() => s.GH_DOMAIN_COMMANDS.dispatchEnvelope({state}, tamperedEnvelope), /approval-intent-digest-mismatch/);
  assert.equal(JSON.stringify(state), JSON.stringify(beforeTamper), 'tampered approval must not mutate serialized state');

  const first = s.GH_DOMAIN_COMMANDS.dispatchEnvelope({state}, envelope);
  assert.equal(first.ok, true);
  assert.equal(state.auditCount, 1);
  assert.ok(first.authorizationProofId);
  const document = state.finance.invoices[0];
  assert.equal(document.authorizationKind, 'stored-signature');
  assert.equal(document.signatureSnapshot.kind, 'visual-authorization-seal');
  assert.equal(document.signatureSnapshot.visualSealVersion, 1);
  assert.equal(s.GH_DOCUMENT_PROOF.verifyDocument(state, document).ok, true);
  assert.equal(Auth.verifyProof(state, first.authorizationProofId).ok, true);
  const sealedValidation = s.GH_SAVE_SCHEMA.validate(state);
  assert.equal(sealedValidation.ok, true, `sealed state must validate against Schema 2.0.0: ${sealedValidation.errors.join(',')}`);

  const retry = s.GH_DOMAIN_COMMANDS.dispatchEnvelope({state}, envelope);
  assert.equal(JSON.stringify(retry), JSON.stringify(first));
  assert.equal(state.auditCount, 1, 'same idempotency key/payload must not repost');
  const conflict = Auth.buildActiveEnvelope(state, {
    domain: 'audit', name: 'post', payload: {amount: 999, counterparty: 'Alpha'},
    idempotencyKey: 'AUDIT-IDEMPOTENCY-1', actor: {principalId: 'founder'}
  });
  assert.throws(() => s.GH_DOMAIN_COMMANDS.dispatchEnvelope({state}, conflict), /Idempotency payload conflict/);
  assert.equal(state.auditCount, 1);

  const firstProof = structuredClone(state.authorization.proofsById[first.authorizationProofId]);
  const seal = state.authorization.visualSealAssetsById[firstProof.visualSealAssetId];
  const originalStrokes = structuredClone(seal.strokes);
  seal.strokes[0][0].x = 0.2;
  assert.equal(Auth.verifyProof(state, first.authorizationProofId).reason, 'proof-visual-seal-mismatch');
  seal.strokes = originalStrokes;

  const mandate = state.authorization.mandatesById[firstProof.mandateId];
  const originalScopes = [...mandate.scopes];
  mandate.scopes = ['other.*'];
  assert.equal(Auth.verifyProof(state, first.authorizationProofId).reason, 'proof-mandate-content-mismatch');
  mandate.scopes = originalScopes;
  const originalCompanies = [...mandate.companyIds];
  mandate.companyIds = ['air'];
  assert.equal(Auth.verifyProof(state, first.authorizationProofId).reason, 'proof-mandate-content-mismatch');
  mandate.companyIds = originalCompanies;
  state.authorization.proofsById[first.authorizationProofId].payloadDigest = '0'.repeat(64);
  assert.equal(Auth.verifyProof(state, first.authorizationProofId).reason, 'proof-digest-mismatch');
  state.authorization.proofsById[first.authorizationProofId] = firstProof;
  assert.equal(Auth.verifyProof(state, first.authorizationProofId).ok, true);

  const originalAmount = document.amount;
  document.amount = originalAmount + 1;
  assert.equal(s.GH_DOCUMENT_PROOF.verifyDocument(state, document).reason, 'document-content-tampered');
  document.amount = originalAmount;
  const originalCounterparty = document.counterparty;
  document.counterparty = 'Attacker LLC';
  assert.equal(s.GH_DOCUMENT_PROOF.verifyDocument(state, document).reason, 'document-counterparty-mismatch');
  document.counterparty = originalCounterparty;
  document.company = 'air';
  assert.equal(s.GH_DOCUMENT_PROOF.verifyDocument(state, document).reason, 'document-issuer-company-mismatch');
  document.company = 'group';
  const originalDocumentId = document.documentId;
  document.documentId = 'ATTACKER-DOCUMENT';
  assert.equal(s.GH_DOCUMENT_PROOF.verifyDocument(state, document).reason, 'document-id-mismatch');
  document.documentId = originalDocumentId;
  const originalDocumentType = document.documentType;
  document.documentType = 'attacker-type';
  assert.equal(s.GH_DOCUMENT_PROOF.verifyDocument(state, document).reason, 'document-type-mismatch');
  document.documentType = originalDocumentType;
  const originalIssuerSnapshot = structuredClone(document.issuerSnapshot);
  document.issuerSnapshot.legalName = 'Attacker Issuer';
  assert.equal(s.GH_DOCUMENT_PROOF.verifyDocument(state, document).reason, 'document-issuer-snapshot-mismatch');
  document.issuerSnapshot = originalIssuerSnapshot;
  assert.equal(s.GH_DOCUMENT_PROOF.verifyDocument(state, document).ok, true);

  const orphanProof = {...structuredClone(firstProof), id: 'APR-ORPHAN'};
  state.authorization.proofsById[orphanProof.id] = orphanProof;
  const authorizationCompaction = Auth.compact(state, {proofs: 1});
  assert.equal(authorizationCompaction.proofsRemoved, 1);
  assert.ok(state.authorization.proofsById[first.authorizationProofId], 'referenced authorization proof must survive compaction');
  const documentRecord = state.documentProofs.recordsById[document.documentProofId];
  state.documentProofs.recordsById['DOCP-ORPHAN'] = {...structuredClone(documentRecord), id: 'DOCP-ORPHAN', documentId: 'ORPHAN'};
  const documentCompaction = s.GH_DOCUMENT_PROOF.compact(state, 1);
  assert.equal(documentCompaction.removed, 1);
  assert.ok(state.documentProofs.recordsById[document.documentProofId], 'referenced document proof must survive compaction');

  state.profile.name = 'Renamed Holdings';
  Auth.createVisualSeal(state, {
    ownerPersonId: 'founder',
    strokes: [[{x: 0.15, y: 0.25}, {x: 0.5, y: 0.75}, {x: 0.95, y: 0.35}]]
  });
  const secondEnvelope = Auth.buildActiveEnvelope(state, {
    domain: 'audit', name: 'post', payload: {amount: 225, counterparty: 'Beta'},
    idempotencyKey: 'AUDIT-IDEMPOTENCY-2', actor: {principalId: 'founder'}
  });
  const second = s.GH_DOMAIN_COMMANDS.dispatchEnvelope({state}, secondEnvelope);
  assert.equal(state.finance.invoices[0].signatureSnapshot.visualSealVersion, 2);
  assert.equal(document.signatureSnapshot.visualSealVersion, 1, 'historical seal snapshot must remain immutable');
  assert.equal(document.issuerSnapshot.legalName, 'Audit Holdings', 'historical issuer snapshot must survive rename');
  assert.equal(Auth.verifyProof(state, first.authorizationProofId).ok, true);
  assert.equal(Auth.verifyProof(state, second.authorizationProofId).ok, true);
  const supersededEnvelope = Auth.buildEnvelope(state, {
    domain: 'audit', name: 'post', payload: {amount: 226, counterparty: 'Gamma'},
    idempotencyKey: 'AUDIT-SUPERSEDED-DENIED', actor: {kind: 'player', principalId: 'founder'},
    signatureAssetId: firstProof.visualSealAssetId, mandateId: firstProof.mandateId
  });
  assert.throws(() => s.GH_DOMAIN_COMMANDS.dispatchEnvelope({state}, supersededEnvelope), /approval-signature-invalid/);

  const malformedSealState = structuredClone(state);
  malformedSealState.authorization.visualSealAssetsById[firstProof.visualSealAssetId].digest = 'bad';
  assert.ok(s.GH_SAVE_SCHEMA.validate(malformedSealState).errors.includes('authorization-seal'));
  const brokenDocumentRef = structuredClone(state);
  brokenDocumentRef.finance.invoices[0].contentDigest = 'f'.repeat(64);
  assert.ok(s.GH_SAVE_SCHEMA.validate(brokenDocumentRef).errors.includes('document-proof-reference'));
  const tamperedImportedDocument = structuredClone(state);
  tamperedImportedDocument.finance.invoices[0].amount += 1;
  assert.ok(s.GH_SAVE_SCHEMA.validate(tamperedImportedDocument).errors.includes('document-proof-integrity'), 'a self-consistent reference must not hide tampered imported document content');
  const tamperedImportedProof = structuredClone(state);
  tamperedImportedProof.authorization.proofsById[first.authorizationProofId].payloadDigest = '1'.repeat(64);
  assert.ok(s.GH_SAVE_SCHEMA.validate(tamperedImportedProof).errors.includes('authorization-proof-integrity'), 'import validation must recompute authorization proof integrity');
}

async function testDraftValidateAckPublish() {
  const {s, state, Auth} = authorizationHarness();
  const envelope = Auth.buildActiveEnvelope(state, {
    domain: 'audit', name: 'post', payload: {amount: 300},
    idempotencyKey: 'DURABLE-ACK-1', actor: {principalId: 'founder'}
  });
  const before = structuredClone(state);
  let persistedDraft = null;
  const committed = await s.GH_DOMAIN_COMMANDS.dispatchDurable({state}, envelope, {
    validate(draft) {
      assert.equal(state.auditCount, undefined, 'live state must remain untouched during validation');
      assert.equal(draft.auditCount, 1);
      return true;
    },
    async persist(draft, meta) {
      assert.equal(state.auditCount, undefined, 'live state must remain untouched before durable ACK');
      assert.equal(meta.expectedPreviousRevision, before.saveRevision);
      persistedDraft = structuredClone(draft);
      return {ok: true, ack: true};
    }
  });
  assert.equal(committed.committed, true);
  assert.equal(state.auditCount, 1);
  assert.equal(state.saveRevision, before.saveRevision + 1);
  assert.equal(JSON.stringify(state), JSON.stringify(persistedDraft));

  const nackState = structuredClone(before);
  const nackEnvelope = Auth.buildActiveEnvelope(nackState, {
    domain: 'audit', name: 'post', payload: {amount: 301},
    idempotencyKey: 'DURABLE-NACK-1', actor: {principalId: 'founder'}
  });
  await assert.rejects(() => s.GH_DOMAIN_COMMANDS.dispatchDurable({state: nackState}, nackEnvelope, {
    persist: async () => ({ok: false, reason: 'durable-nack'})
  }), /durable-nack/);
  assert.equal(JSON.stringify(nackState), JSON.stringify(before), 'durable NACK must leave the live world unchanged');
}

async function nativeOutcome(mode) {
  const {s} = harness(['save-schema', 'control-plane-core', 'transaction-core', 'persistence-core']);
  const state = minimal(), before = structuredClone(state);
  s.webkit = {messageHandlers: {saveBridge: {postMessage(message) {
    if (mode === 'timeout') return;
    setTimeout(() => s.GH_PERSISTENCE.receiveAck({
      action: message.action,
      requestId: message.requestId,
      saveRevision: message.saveRevision,
      resetEpoch: message.resetEpoch,
      saveHash: message.saveHash,
      saveSchemaVersion: message.saveSchemaVersion,
      success: mode === 'ack',
      generation: mode === 'ack' ? 1 : undefined,
      message: mode === 'nack' ? 'native-nack-test' : undefined
    }), 0);
  }}}};
  const operation = s.GH_TRANSACTION_CORE.executeDurable(state, {
    label: `native-${mode}`,
    expectedRevision: state.saveRevision,
    persistence: {timeoutMs: 10},
    apply(draft) { draft.auditNative = mode; return mode; }
  });
  if (mode === 'ack') {
    const result = await operation;
    assert.equal(result.committed, true);
    assert.equal(state.auditNative, 'ack');
    assert.equal(state.saveRevision, before.saveRevision + 1);
    assert.equal(s.GH_PERSISTENCE.isLocked(), false);
  } else {
    await assert.rejects(() => operation, mode === 'nack' ? /native-nack-test/ : /native-save-ack-timeout/);
    assert.equal(JSON.stringify(state), JSON.stringify(before), `${mode} must not publish draft state`);
    assert.equal(s.GH_PERSISTENCE.isLocked(), mode === 'timeout', 'only uncertain timeout requires reconciliation lock');
  }
}

(async () => {
  await testAuthorizationAndIdempotency();
  await testDraftValidateAckPublish();
  await nativeOutcome('ack');
  await nativeOutcome('nack');
  await nativeOutcome('timeout');
  console.log(JSON.stringify({suite: 'build334-durable-authorization', passed: 5, total: 5}, null, 2));
})().catch(error => {
  console.error(error.stack || error);
  process.exitCode = 1;
});

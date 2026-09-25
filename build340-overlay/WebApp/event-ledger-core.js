(() => {
  'use strict';

  const VERSION = '3.0.0';
  const LIMIT = 240;

  function ensure(state) {
    state.businessLedger = state.businessLedger && typeof state.businessLedger === 'object'
      ? state.businessLedger
      : {};
    const ledger = state.businessLedger;
    ledger.events = Array.isArray(ledger.events) ? ledger.events : [];
    ledger.sequence = Math.max(0, Number(ledger.sequence) || 0);
    return ledger;
  }

  function append(state, input = {}) {
    const ledger = ensure(state);
    ledger.sequence += 1;
    const event = {
      id: `EVT-${String(ledger.sequence).padStart(8, '0')}`,
      type: String(input.type || 'EVENT'),
      domain: String(input.domain || 'system'),
      entityType: String(input.entityType || 'system'),
      entityId: input.entityId == null ? null : String(input.entityId),
      correlationId: input.correlationId == null ? null : String(input.correlationId),
      actor: String(input.actor || 'system'),
      simSeconds: Number(state?.simSeconds) || 0,
      detail: input.detail && typeof input.detail === 'object'
        ? input.detail
        : { value: input.detail ?? null }
    };
    ledger.events.unshift(event);
    if (ledger.events.length > LIMIT) ledger.events.length = LIMIT;
    return event;
  }

  function forEntity(state, entityType, entityId, limit = 80) {
    return ensure(state).events
      .filter(event => event.entityType === entityType && event.entityId === String(entityId))
      .slice(0, limit);
  }

  function forCorrelation(state, id, limit = 120) {
    return ensure(state).events
      .filter(event => event.correlationId === String(id))
      .slice(0, limit);
  }

  function summary(state) {
    const ledger = ensure(state);
    const byDomain = {};
    for (const event of ledger.events) byDomain[event.domain] = (byDomain[event.domain] || 0) + 1;
    return { count: ledger.events.length, sequence: ledger.sequence, byDomain };
  }

  const API = Object.freeze({ VERSION, LIMIT, ensure, append, forEntity, forCorrelation, summary });
  globalThis.GH_EVENT_LEDGER = API;
  if (globalThis.window && globalThis.window !== globalThis) globalThis.window.GH_EVENT_LEDGER = API;
  if (typeof module !== 'undefined' && module.exports) module.exports = API;
})();

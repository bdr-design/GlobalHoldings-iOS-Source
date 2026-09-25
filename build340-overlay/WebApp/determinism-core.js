(() => {
  'use strict';

  // Build 340 rewrite: every pseudo-random stream and generated identifier is
  // anchored in saved state so replay and rollback remain deterministic.
  const VERSION = '3.0.0';

  function hashString(text) {
    let hash = 2166136261 >>> 0;
    for (const character of String(text)) {
      hash ^= character.charCodeAt(0);
      hash = Math.imul(hash, 16777619) >>> 0;
    }
    return hash >>> 0;
  }

  function ensure(state) {
    if (!state || typeof state !== 'object') throw new TypeError('Determinism state required');

    if (!state.determinism || typeof state.determinism !== 'object') {
      state.determinism = {};
    }
    if (!Number.isInteger(state.determinism.seed) || state.determinism.seed === 0) {
      const profileName = state.profile?.name || 'Global Holdings';
      state.determinism.seed = (hashString(profileName) ^ 0x9e3779b9) >>> 0 || 1;
    }
    if (!state.determinism.streams || typeof state.determinism.streams !== 'object') {
      state.determinism.streams = {};
    }
    if (!state.sequences || typeof state.sequences !== 'object') state.sequences = {};
    return state.determinism;
  }

  function nextUint(state, stream = 'default') {
    const determinism = ensure(state);
    const key = String(stream || 'default');
    let value = Number(determinism.streams[key]);
    if (!Number.isInteger(value) || value === 0) {
      value = (determinism.seed ^ hashString(key)) >>> 0 || 1;
    }
    value ^= value << 13;
    value ^= value >>> 17;
    value ^= value << 5;
    value >>>= 0;
    determinism.streams[key] = value || 1;
    return value >>> 0;
  }

  function nextFloat(state, stream = 'default') {
    return nextUint(state, stream) / 4294967296;
  }

  function nextId(state, prefix = 'ID') {
    ensure(state);
    const normalizedPrefix = String(prefix || 'ID')
      .replace(/[^A-Z0-9_-]/gi, '')
      .toUpperCase() || 'ID';
    const nextSequence = (Number(state.sequences[normalizedPrefix]) || 0) + 1;
    state.sequences[normalizedPrefix] = nextSequence;
    return `${normalizedPrefix}-${String(nextSequence).padStart(8, '0')}`;
  }

  const API = Object.freeze({ VERSION, ensure, nextUint, nextFloat, nextId, hashString });
  globalThis.GH_DETERMINISM = API;
  if (globalThis.window && globalThis.window !== globalThis) {
    globalThis.window.GH_DETERMINISM = API;
  }
  if (typeof module !== 'undefined' && module.exports) module.exports = API;
})();

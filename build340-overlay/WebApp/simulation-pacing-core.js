(() => {
  'use strict';

  // Build 340 rewrite: real-time pacing is a policy separate from the
  // simulation clock and the application's persistent data model.
  const VERSION = '3.0.0';
  const DEFAULTS = Object.freeze({
    maxRealDelta: 3,
    maxBacklogNormal: 12,
    maxBacklogFast: 96,
    frameBudgetMs: 5.5,
    manualFrameBudgetMs: 10,
    renderEveryNormalMs: 180,
    renderEveryFastMs: 450,
    persistEveryNormalMs: 12000,
    persistEveryFastMs: 30000
  });

  const systemNowMs = () => globalThis.performance?.now?.() ?? Date.now();
  const positiveOr = (value, fallback) => {
    const number = Number(value);
    return Number.isFinite(number) && number > 0 ? number : fallback;
  };

  function normalizeConfig(options = {}) {
    return {
      maxRealDelta: positiveOr(options.maxRealDelta, DEFAULTS.maxRealDelta),
      maxBacklogNormal: positiveOr(options.maxBacklogNormal, DEFAULTS.maxBacklogNormal),
      maxBacklogFast: positiveOr(options.maxBacklogFast, DEFAULTS.maxBacklogFast),
      frameBudgetMs: positiveOr(options.frameBudgetMs, DEFAULTS.frameBudgetMs),
      manualFrameBudgetMs: positiveOr(options.manualFrameBudgetMs, DEFAULTS.manualFrameBudgetMs),
      renderEveryNormalMs: positiveOr(options.renderEveryNormalMs, DEFAULTS.renderEveryNormalMs),
      renderEveryFastMs: positiveOr(options.renderEveryFastMs, DEFAULTS.renderEveryFastMs),
      persistEveryNormalMs: positiveOr(options.persistEveryNormalMs, DEFAULTS.persistEveryNormalMs),
      persistEveryFastMs: positiveOr(options.persistEveryFastMs, DEFAULTS.persistEveryFastMs)
    };
  }

  function create(options = {}) {
    const config = normalizeConfig(options);
    const clock = typeof options.nowMs === 'function' ? options.nowMs : systemNowMs;
    let lastReal = clock();
    let backlog = 0;
    let lastRender = 0;
    let lastPersist = 0;
    let hidden = false;
    let droppedRealSeconds = 0;
    let backlogClamps = 0;
    let stallGaps = 0;

    function isFast(speed) {
      return !!options.isFast?.(speed);
    }

    function backlogLimit(speed) {
      const speedBacklog = Math.max(0, Number(speed) || 0) * config.maxRealDelta * 2;
      return Math.max(isFast(speed) ? config.maxBacklogFast : config.maxBacklogNormal, speedBacklog);
    }

    function snapshot() {
      return {
        version: VERSION,
        lastReal,
        backlog,
        hidden,
        lastRender,
        lastPersist,
        droppedRealSeconds,
        backlogClamps,
        stallGaps,
        config: { ...config }
      };
    }

    function reset(now = clock()) {
      const numericNow = Number(now);
      lastReal = Number.isFinite(numericNow) ? numericNow : clock();
      backlog = 0;
      return snapshot();
    }

    function setHidden(value, now = clock()) {
      hidden = !!value;
      reset(now);
      return hidden;
    }

    function observeLiveFrame(now, speed, { suspended = false, paused = false } = {}) {
      const numericNow = Number(now);
      const frameNow = Number.isFinite(numericNow) ? numericNow : clock();
      let realDelta = (frameNow - lastReal) / 1000;
      lastReal = frameNow;
      if (!Number.isFinite(realDelta) || realDelta < 0) realDelta = 0;

      let dropped = 0;
      let clamped = false;
      let stalled = false;
      if (realDelta > config.maxRealDelta) {
        dropped = realDelta;
        droppedRealSeconds += realDelta;
        stallGaps += 1;
        realDelta = 0;
        stalled = true;
      }

      if (hidden || suspended || paused) {
        backlog = 0;
        return { realDelta, droppedRealSeconds: dropped, clamped, stalled, backlog };
      }

      backlog += realDelta * Math.max(0, Number(speed) || 0);
      const limit = backlogLimit(speed);
      if (backlog > limit) {
        backlog = limit;
        backlogClamps += 1;
        clamped = true;
      }
      return { realDelta, droppedRealSeconds: dropped, clamped, stalled, backlog };
    }

    function setManualBacklog(seconds, now = clock()) {
      const numericNow = Number(now);
      lastReal = Number.isFinite(numericNow) ? numericNow : clock();
      const requested = Number(seconds);
      backlog = Number.isFinite(requested) ? Math.max(0, requested) : 0;
      return backlog;
    }

    function limitBacklog(maximum) {
      const limit = Number(maximum);
      if (Number.isFinite(limit) && limit >= 0) backlog = Math.min(backlog, limit);
      return backlog;
    }

    function consume(seconds) {
      const consumed = Number(seconds);
      if (Number.isFinite(consumed) && consumed > 0) backlog = Math.max(0, backlog - consumed);
      return backlog;
    }

    function clearBacklog() {
      backlog = 0;
      return 0;
    }

    function executionDeadline(manual = false) {
      return clock() + (manual ? config.manualFrameBudgetMs : config.frameBudgetMs);
    }

    function shouldRender(now, speed) {
      const interval = isFast(speed) ? config.renderEveryFastMs : config.renderEveryNormalMs;
      if (Number(now) - lastRender < interval) return false;
      lastRender = Number(now);
      return true;
    }

    function shouldPersist(now, speed) {
      const interval = isFast(speed) ? config.persistEveryFastMs : config.persistEveryNormalMs;
      if (Number(now) - lastPersist < interval) return false;
      lastPersist = Number(now);
      return true;
    }

    return {
      version: VERSION,
      reset,
      setHidden,
      observeLiveFrame,
      setManualBacklog,
      limitBacklog,
      consume,
      clearBacklog,
      backlog: () => backlog,
      executionDeadline,
      shouldRender,
      shouldPersist,
      snapshot,
      config: () => ({ ...config })
    };
  }

  const API = Object.freeze({ VERSION, DEFAULTS, normalizeConfig, create });
  globalThis.GH_SIMULATION_PACING_CORE = API;
  if (globalThis.window && globalThis.window !== globalThis) {
    globalThis.window.GH_SIMULATION_PACING_CORE = API;
  }
  if (typeof module !== 'undefined' && module.exports) module.exports = API;
})();

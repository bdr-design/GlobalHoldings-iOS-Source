(() => {
  'use strict';

  // Build 340 rewrite: keep this module pure so every simulation owner shares
  // one definition of clock boundaries and slice planning.
  const VERSION = '3.0.0';
  const HOUR_SECONDS = 60 * 60;
  const DAY_SECONDS = 24 * HOUR_SECONDS;
  const BOUNDARY_EPSILON = 1e-8;
  const MIN_SLICE_SECONDS = 1e-6;

  function finiteNonNegative(value) {
    const number = Number(value);
    return Number.isFinite(number) ? Math.max(0, number) : 0;
  }

  function boundaryAt(simSeconds) {
    const seconds = finiteNonNegative(simSeconds);
    const hour = seconds / HOUR_SECONDS;
    const day = seconds / DAY_SECONDS;
    const nearestHour = Math.round(hour);
    const nearestDay = Math.round(day);

    return {
      hour: Math.abs(hour - nearestHour) < BOUNDARY_EPSILON ? nearestHour : null,
      day: Math.abs(day - nearestDay) < BOUNDARY_EPSILON ? nearestDay : null
    };
  }

  function nextBoundaryAfter(simSeconds) {
    const seconds = finiteNonNegative(simSeconds);
    const hour = (Math.floor(seconds / HOUR_SECONDS) + 1) * HOUR_SECONDS;
    const day = (Math.floor(seconds / DAY_SECONDS) + 1) * DAY_SECONDS;

    return { hour, day, next: Math.min(hour, day) };
  }

  function clampSliceToBoundary(simSeconds, maxSliceSeconds) {
    const from = finiteNonNegative(simSeconds);
    const requested = Number(maxSliceSeconds);
    if (!Number.isFinite(requested) || requested <= 0) return MIN_SLICE_SECONDS;

    const boundary = nextBoundaryAfter(from);
    const untilHour = boundary.hour - from;
    const untilDay = boundary.day - from;
    return Math.max(MIN_SLICE_SECONDS, Math.min(requested, untilHour, untilDay));
  }

  function planSlice(simSeconds, maxSliceSeconds) {
    const from = finiteNonNegative(simSeconds);
    const sliceSeconds = clampSliceToBoundary(from, maxSliceSeconds);
    const to = from + sliceSeconds;
    return { from, to, sliceSeconds, boundary: boundaryAt(to) };
  }

  function boundaryOrder(boundary = {}) {
    const order = [];
    if (boundary.day !== null && boundary.day !== undefined) order.push('day');
    if (boundary.hour !== null && boundary.hour !== undefined) order.push('hour');
    return order;
  }

  const API = Object.freeze({
    VERSION,
    HOUR_SECONDS,
    DAY_SECONDS,
    BOUNDARY_EPSILON,
    MIN_SLICE_SECONDS,
    boundaryAt,
    nextBoundaryAfter,
    clampSliceToBoundary,
    planSlice,
    boundaryOrder
  });

  globalThis.GH_SIMULATION_TIME_CORE = API;
  if (globalThis.window && globalThis.window !== globalThis) {
    globalThis.window.GH_SIMULATION_TIME_CORE = API;
  }
  if (typeof module !== 'undefined' && module.exports) module.exports = API;
})();

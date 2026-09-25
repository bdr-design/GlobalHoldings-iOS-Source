(() => {
  'use strict';

  // Build 340 rewrite: the scheduler is the only owner of real-time pacing,
  // job lifecycle, and calendar advancement. The host remains the clock owner.
  const VERSION = '3.0.0';
  const TIME = globalThis.GH_SIMULATION_TIME_CORE
    || (typeof module !== 'undefined' && module.exports ? require('./simulation-time-core.js') : null);
  const PACING = globalThis.GH_SIMULATION_PACING_CORE
    || (typeof module !== 'undefined' && module.exports ? require('./simulation-pacing-core.js') : null);
  if (!TIME) throw new Error('Simulation Time Core must load before Simulation Core');
  if (!PACING) throw new Error('Simulation Pacing Core must load before Simulation Core');

  const DEFAULTS = Object.freeze({
    allowedSpeeds: Object.freeze([0, 30, 120, 300, 600]),
    fallbackSpeed: 30,
    quantumRealSeconds: 1,
    maxRealDelta: 3,
    maxBacklogNormal: 12,
    maxBacklogFast: 96,
    frameBudgetMs: 5.5,
    manualFrameBudgetMs: 10,
    chunkItems: 64,
    manualChunkItems: 64,
    renderEveryNormalMs: 180,
    renderEveryFastMs: 450,
    persistEveryNormalMs: 12000,
    persistEveryFastMs: 30000,
    minRealSliceSeconds: 0,
    maintenanceEveryHours: 6,
    manualBatchSeconds: 3600,
    manualMinBatchSeconds: 300,
    manualRetryLimit: 3,
    longTaskWarnMs: 28,
    hardTaskMs: 120,
    hardTaskLimit: 3,
    conflictLimit: 3
  });

  const systemNowMs = () => globalThis.performance?.now?.() ?? Date.now();

  function normalizeConfig(options = {}) {
    const config = { ...DEFAULTS, ...options };
    config.allowedSpeeds = Array.from(options.allowedSpeeds || DEFAULTS.allowedSpeeds)
      .map(Number)
      .filter(Number.isFinite);
    if (!config.allowedSpeeds.length) config.allowedSpeeds = Array.from(DEFAULTS.allowedSpeeds);

    const positiveKeys = [
      'quantumRealSeconds', 'maxRealDelta', 'maxBacklogNormal', 'maxBacklogFast',
      'frameBudgetMs', 'manualFrameBudgetMs', 'chunkItems', 'manualChunkItems',
      'renderEveryNormalMs', 'renderEveryFastMs', 'persistEveryNormalMs',
      'persistEveryFastMs', 'maintenanceEveryHours', 'manualBatchSeconds',
      'manualMinBatchSeconds', 'manualRetryLimit', 'longTaskWarnMs', 'hardTaskMs',
      'hardTaskLimit', 'conflictLimit'
    ];
    for (const key of positiveKeys) {
      const value = Number(config[key]);
      config[key] = Number.isFinite(value) && value > 0 ? value : DEFAULTS[key];
    }

    const requestedMinimum = Number(config.minRealSliceSeconds);
    config.minRealSliceSeconds = Number.isFinite(requestedMinimum)
      ? Math.max(0, Math.min(1, requestedMinimum))
      : 0;
    config.chunkItems = Math.max(1, Math.floor(config.chunkItems));
    config.manualChunkItems = Math.max(1, Math.floor(config.manualChunkItems));
    config.hardTaskLimit = Math.max(1, Math.floor(config.hardTaskLimit));
    config.conflictLimit = Math.max(1, Math.floor(config.conflictLimit));
    config.manualBatchSeconds = Math.max(1, Math.min(3600, Number(config.manualBatchSeconds) || DEFAULTS.manualBatchSeconds));
    config.manualMinBatchSeconds = Math.max(
      1,
      Math.min(config.manualBatchSeconds, Number(config.manualMinBatchSeconds) || DEFAULTS.manualMinBatchSeconds)
    );
    config.manualRetryLimit = Math.max(1, Math.floor(Number(config.manualRetryLimit) || DEFAULTS.manualRetryLimit));
    config.fallbackSpeed = config.allowedSpeeds.includes(Number(config.fallbackSpeed))
      ? Number(config.fallbackSpeed)
      : (config.allowedSpeeds.find(value => value > 0) ?? 1);
    return config;
  }

  function create(adapter, options = {}) {
    if (!adapter || typeof adapter !== 'object') throw new TypeError('Simulation adapter is required');
    if (typeof adapter.getSimTime !== 'function'
      || typeof adapter.setSimTime !== 'function'
      || typeof adapter.createSliceJob !== 'function') {
      throw new TypeError('Simulation adapter is incomplete');
    }

    const config = normalizeConfig(options);
    const clock = typeof options.nowMs === 'function' ? options.nowMs : systemNowMs;
    const initialTime = Math.max(0, Number(adapter.getSimTime()) || 0);
    const health = {
      version: VERSION,
      frames: 0,
      slices: 0,
      chunks: 0,
      hours: 0,
      days: 0,
      conflicts: 0,
      cancels: 0,
      maxChunkMs: 0,
      lastChunkMs: 0,
      longTasks: 0,
      hardTasks: 0,
      droppedRealSeconds: 0,
      backlogClamps: 0,
      maxCreateMs: 0,
      lastCreateMs: 0,
      maxFinishMs: 0,
      lastFinishMs: 0,
      maxCycleMs: 0,
      lastCycleMs: 0,
      lastError: '',
      lastBoundary: '',
      lastSliceSeconds: 0,
      lastMaintenanceHour: -1,
      lastCancelReason: '',
      lastCommitReason: '',
      lastWorkStage: '',
      governor: 'GREEN',
      avgChunkMs: 0,
      avgWorkMs: 0,
      manualFailures: 0,
      manualThrottleYields: 0,
      lastAdvanceFailure: null,
      lastProgressSim: initialTime,
      lastProgressAt: clock()
    };

    let job = null;
    let jobSlice = 0;
    let jobStart = 0;
    let jobSpeed = 0;
    let jobBoundary = null;
    let jobWorkMs = 0;
    let jobReadyToFinish = false;
    let manualAdvance = null;
    let hardTaskStreak = 0;
    let conflictStreak = 0;
    let lastObservedSpeed = null;
    let throttlePending = null;
    const durationSamples = [];
    const workSamples = [];
    let lastGovernor = 'GREEN';
    let lastHourCommitted = Math.floor((initialTime + 1e-6) / 3600);
    let lastDayCommitted = Math.floor((initialTime + 1e-6) / 86400);

    function report(stage, error, fatal = false) {
      health.lastError = `${stage}:${error?.stack || error}`;
      if (fatal) adapter.onFatal?.(error instanceof Error ? error : new Error(String(error)));
      else adapter.onWarning?.({ stage, error });
    }

    function getSpeed() {
      let speed = Number(adapter.getSpeed?.() ?? config.fallbackSpeed);
      if (!config.allowedSpeeds.includes(speed)) {
        speed = config.fallbackSpeed;
        adapter.setSpeed?.(speed, { reason: 'sanitize' });
      }
      return speed;
    }

    function simNow() {
      return Math.max(0, Number(adapter.getSimTime()) || 0);
    }

    function setSimTime(value) {
      adapter.setSimTime(Math.max(0, Number(value) || 0));
    }

    // Rates are host-configured. Repeatedly selecting the same fallback must
    // never cancel slow work before an atomic slice can commit.
    function isFast(speed) {
      return speed >= 8 && speed > config.fallbackSpeed;
    }

    // Runtime pacing never owns or writes authoritative economic time.
    const pacing = PACING.create({ ...config, nowMs: clock, isFast });

    function manualSnapshot() {
      if (!manualAdvance) return null;
      return {
        target: manualAdvance.target,
        remaining: Math.max(0, manualAdvance.target - simNow()),
        speed: manualAdvance.speed,
        requestedSpeed: manualAdvance.requestedSpeed,
        batchSeconds: manualAdvance.batchSeconds,
        reason: manualAdvance.reason,
        requestedAt: manualAdvance.requestedAt,
        retries: manualAdvance.retries || 0,
        yields: manualAdvance.yields || 0
      };
    }

    function failManualAdvance(reason, meta = {}) {
      if (!manualAdvance) return false;
      const failedAdvance = { ...manualAdvance };
      const currentTime = simNow();
      cancelJob(`manual-advance-failed:${reason}`);
      manualAdvance = null;
      pacing.reset(clock());

      const detail = {
        reason: String(reason || 'manual-advance-failed'),
        stage: String(meta.stage || ''),
        from: Number(meta.from ?? currentTime),
        to: Number(meta.to ?? currentTime),
        at: currentTime,
        retries: Number(failedAdvance.retries) || 0,
        error: meta.error ? String(meta.error?.message || meta.error) : ''
      };
      health.manualFailures += 1;
      health.lastAdvanceFailure = detail;
      try {
        adapter.onAdvance?.({
          active: false,
          failed: true,
          target: failedAdvance.target,
          remaining: Math.max(0, failedAdvance.target - currentTime),
          reason: detail.reason,
          stage: detail.stage,
          from: detail.from,
          to: detail.to,
          retries: detail.retries,
          error: detail.error
        });
      } catch (error) {
        report('advance-failed', error, false);
      }
      return true;
    }

    function completeManualAdvance() {
      if (!manualAdvance || simNow() + 1e-6 < manualAdvance.target) return false;
      const completedAdvance = { ...manualAdvance };
      manualAdvance = null;
      pacing.clearBacklog();
      try {
        adapter.onAdvance?.({ active: false, completed: true, target: completedAdvance.target, reason: completedAdvance.reason });
      } catch (error) {
        report('advance-complete', error, false);
      }
      return true;
    }

    // Keep transaction frequency roughly constant across user multipliers.
    function quantum(speed) {
      return Math.max(1e-6, Math.min(3600, Math.max(1, speed) * config.quantumRealSeconds));
    }

    function observeWork(stage, duration, speed) {
      const elapsed = Math.max(0, Number(duration) || 0);
      health.lastWorkStage = stage;
      workSamples.push(elapsed);
      if (workSamples.length > 40) workSamples.shift();
      health.avgWorkMs = workSamples.reduce((total, value) => total + value, 0) / Math.max(1, workSamples.length);

      if (stage === 'create') {
        health.lastCreateMs = elapsed;
        health.maxCreateMs = Math.max(health.maxCreateMs, elapsed);
      } else if (stage === 'finish') {
        health.lastFinishMs = elapsed;
        health.maxFinishMs = Math.max(health.maxFinishMs, elapsed);
      }

      if (elapsed >= config.longTaskWarnMs) {
        health.longTasks += 1;
        hardTaskStreak += 1;
      } else {
        hardTaskStreak = 0;
      }
      if (elapsed >= config.hardTaskMs) health.hardTasks += 1;

      const pressure = Math.max(health.avgWorkMs, elapsed);
      const governor = pressure >= config.hardTaskMs
        ? 'RED'
        : pressure >= config.longTaskWarnMs
          ? 'ORANGE'
          : pressure >= config.frameBudgetMs
            ? 'YELLOW'
            : 'GREEN';
      health.governor = governor;
      if (governor !== lastGovernor) {
        lastGovernor = governor;
        try {
          adapter.onGovernor?.({ level: governor, avgChunkMs: health.avgChunkMs, avgWorkMs: health.avgWorkMs, stage, took: elapsed, speed });
        } catch (error) {
          report('governor', error, false);
        }
      }

      // Work-pressure throttling is cooperative. Calendar work yields without
      // restarting its atomic slice, and live speed remains the player's choice.
      if (manualAdvance && (governor === 'RED' || hardTaskStreak >= config.hardTaskLimit)) {
        throttlePending = { stage, took: elapsed, reason: governor === 'RED' ? 'governor-red' : 'watchdog' };
      }
      return governor;
    }

    function boundaryFor(targetTime) {
      return TIME.boundaryAt(targetTime);
    }

    function alignBoundaryTarget(maximumSlice) {
      return TIME.clampSliceToBoundary(simNow(), maximumSlice);
    }

    function startJob(speed) {
      const availableBacklog = pacing.backlog();
      if (job || availableBacklog <= 1e-9) return false;

      if (!manualAdvance && config.minRealSliceSeconds > 0) {
        const minimumSlice = alignBoundaryTarget(
          Math.min(quantum(speed), Math.max(1e-6, speed * config.minRealSliceSeconds))
        );
        if (availableBacklog + 1e-9 < minimumSlice) return false;
      }

      let batch = manualAdvance ? manualAdvance.batchSeconds : quantum(speed);
      if (manualAdvance && typeof adapter.getManualSliceLimit === 'function') {
        try {
          const ownerLimit = Number(adapter.getManualSliceLimit({
            from: simNow(),
            target: manualAdvance.target,
            speed,
            batchSeconds: batch
          }));
          if (Number.isFinite(ownerLimit) && ownerLimit > 0) batch = Math.min(batch, ownerLimit);
        } catch (error) {
          report('manual-slice-limit', error, false);
        }
      }

      const slice = alignBoundaryTarget(Math.min(availableBacklog, batch));
      if (!Number.isFinite(slice) || slice <= 0) return false;
      jobSlice = slice;
      jobStart = simNow();
      jobSpeed = speed;
      jobBoundary = boundaryFor(jobStart + slice);
      jobWorkMs = 0;
      jobReadyToFinish = false;

      const createStartedAt = clock();
      try {
        job = adapter.createSliceJob(slice, {
          from: jobStart,
          to: jobStart + slice,
          speed,
          fast: isFast(speed),
          boundary: { ...jobBoundary }
        }) || null;
        if (!job || typeof job.runChunk !== 'function' || typeof job.finish !== 'function') {
          health.lastError = 'adapter:createSliceJob-invalid';
          if (manualAdvance) failManualAdvance('create-job-invalid', { stage: 'create', from: jobStart, to: jobStart + jobSlice });
          job = null;
          jobSlice = 0;
          jobBoundary = null;
          return false;
        }
      } catch (error) {
        if (manualAdvance) failManualAdvance('create-error', { stage: 'create', from: jobStart, to: jobStart + jobSlice, error });
        report('createSliceJob', error, true);
        job = null;
        jobSlice = 0;
        jobBoundary = null;
        return false;
      } finally {
        const elapsed = clock() - createStartedAt;
        jobWorkMs += Math.max(0, elapsed);
        observeWork('create', elapsed, speed);
      }
      return true;
    }

    function cancelJob(reason = 'cancelled') {
      if (!job) return;
      try {
        job.cancel?.({ reason, from: jobStart, to: jobStart + jobSlice, speed: jobSpeed, boundary: jobBoundary });
      } catch (error) {
        report('sliceCancel', error, false);
      }
      health.cancels += 1;
      health.lastCancelReason = reason;
      job = null;
      jobSlice = 0;
      jobStart = simNow();
      jobSpeed = 0;
      jobBoundary = null;
      jobWorkMs = 0;
      jobReadyToFinish = false;
    }

    function applyFallbackSpeed(meta) {
      // Calendar work is target-driven; pressure only reduces the next batch.
      if (manualAdvance) return;
      adapter.setSpeed?.(config.fallbackSpeed, meta);
    }

    function consumeThrottlePending() {
      if (!throttlePending) return false;
      const pending = throttlePending;
      throttlePending = null;
      applyFallbackSpeed({
        reason: pending.reason,
        took: pending.took,
        stage: pending.stage,
        avgWorkMs: health.avgWorkMs
      });
      hardTaskStreak = 0;

      if (manualAdvance) {
        health.manualThrottleYields += 1;
        manualAdvance.yields = (manualAdvance.yields || 0) + 1;
        if (manualAdvance.yields === 1 || manualAdvance.yields % 60 === 0) {
          try {
            adapter.onThrottle?.({
              took: pending.took,
              reason: `calendar-yield:${pending.reason}:${pending.stage}`,
              stage: pending.stage,
              yields: manualAdvance.yields
            });
          } catch (error) {
            report('throttle-notify', error, false);
          }
        }
        return true;
      }

      pacing.clearBacklog();
      cancelJob(`${pending.reason}:${pending.stage}`);
      try {
        adapter.onThrottle?.({ took: pending.took, reason: `${pending.reason}:${pending.stage}`, stage: pending.stage });
      } catch (error) {
        report('throttle-notify', error, false);
      }
      return true;
    }

    function finishJob(speed) {
      const activeJob = job;
      const from = jobStart;
      const to = jobStart + jobSlice;
      const slice = jobSlice;
      const boundary = { ...jobBoundary };
      let result;
      let finishDuration = 0;
      let finishError = null;
      const finishStartedAt = clock();

      try {
        result = activeJob.finish({ from, to, speed, boundary });
      } catch (error) {
        finishError = error;
        if (manualAdvance) failManualAdvance('finish-error', { stage: 'finish', from, to, error });
        report('sliceFinish', error, true);
      } finally {
        finishDuration = Math.max(0, clock() - finishStartedAt);
        jobWorkMs += finishDuration;
        observeWork('finish', finishDuration, speed);
      }

      if (finishError) {
        cancelJob('finish-error');
        pacing.clearBacklog();
        return { done: false, breakFrame: true };
      }

      const committed = result === true || result?.committed === true;
      if (!committed) {
        const reason = result?.reason || 'commit-rejected';
        const retryable = reason === 'asset-conflict' || result?.retry;
        health.lastCommitReason = reason;
        if (retryable) {
          health.conflicts += 1;
          conflictStreak += 1;
        }
        cancelJob(reason);

        if (manualAdvance) {
          const key = `${from}->${to}:${reason}`;
          if (manualAdvance.retryKey === key) manualAdvance.retries = (manualAdvance.retries || 0) + 1;
          else {
            manualAdvance.retryKey = key;
            manualAdvance.retries = 1;
          }
          if (!retryable || manualAdvance.retries >= config.manualRetryLimit) {
            failManualAdvance(reason, { stage: 'commit', from, to });
            return { done: false, breakFrame: true };
          }
        }

        if (conflictStreak >= config.conflictLimit && isFast(speed)) {
          applyFallbackSpeed({ reason: 'conflict-watchdog' });
          pacing.limitBacklog(config.maxBacklogNormal);
          conflictStreak = 0;
        }
        return { done: false, breakFrame: true };
      }

      conflictStreak = 0;
      if (manualAdvance) {
        manualAdvance.retries = 0;
        manualAdvance.retryKey = '';
      }

      // The adapter's transaction commits state and time together before this
      // synchronization check; time is never advanced before finish succeeds.
      setSimTime(to);
      pacing.consume(slice);
      health.slices += 1;
      health.lastSliceSeconds = slice;
      health.lastCommitReason = 'committed';
      health.lastProgressSim = to;
      health.lastProgressAt = clock();
      health.lastCycleMs = jobWorkMs;
      health.maxCycleMs = Math.max(health.maxCycleMs, jobWorkMs);
      job = null;
      jobSlice = 0;
      jobStart = to;
      jobSpeed = 0;
      jobBoundary = null;
      jobWorkMs = 0;
      jobReadyToFinish = false;

      if (boundary.day !== null && boundary.day > lastDayCommitted) {
        lastDayCommitted = boundary.day;
        health.days += 1;
        health.lastBoundary = `day:${boundary.day}`;
      }
      if (boundary.hour !== null && boundary.hour > lastHourCommitted) {
        lastHourCommitted = boundary.hour;
        health.hours += 1;
        health.lastBoundary = `hour:${boundary.hour}`;
      }
      if (boundary.hour !== null && boundary.hour - health.lastMaintenanceHour >= config.maintenanceEveryHours) {
        health.lastMaintenanceHour = boundary.hour;
        try {
          adapter.onMaintenance?.(boundary.hour, { time: to, speed });
        } catch (error) {
          report('maintenance', error, false);
        }
      }
      return { done: true, breakFrame: false };
    }

    function work(now, speed) {
      const deadline = pacing.executionDeadline(!!manualAdvance);
      while (clock() < deadline) {
        if (!job && !startJob(speed)) break;
        if (throttlePending) {
          consumeThrottlePending();
          break;
        }
        if (jobReadyToFinish) {
          const outcome = finishJob(speed);
          if (outcome.breakFrame) break;
          if (throttlePending) {
            consumeThrottlePending();
            break;
          }
          continue;
        }
        if (clock() >= deadline) break;

        const chunkStartedAt = clock();
        let done = false;
        const chunkItems = manualAdvance ? config.manualChunkItems : config.chunkItems;
        try {
          done = !!job.runChunk(chunkItems, { deadline, speed, fast: isFast(speed) });
        } catch (error) {
          if (manualAdvance) failManualAdvance('chunk-error', { stage: 'chunk', from: jobStart, to: jobStart + jobSlice, error });
          report('sliceChunk', error, true);
          cancelJob('chunk-error');
          pacing.clearBacklog();
          return;
        }

        const elapsed = clock() - chunkStartedAt;
        jobWorkMs += Math.max(0, elapsed);
        health.chunks += 1;
        health.lastChunkMs = elapsed;
        health.maxChunkMs = Math.max(health.maxChunkMs, elapsed);
        durationSamples.push(elapsed);
        if (durationSamples.length > 30) durationSamples.shift();
        health.avgChunkMs = durationSamples.reduce((total, value) => total + value, 0) / Math.max(1, durationSamples.length);
        if (done) jobReadyToFinish = true;
        observeWork('chunk', elapsed, speed);

        if (throttlePending) {
          consumeThrottlePending();
          break;
        }
        if (jobReadyToFinish && clock() < deadline) {
          const outcome = finishJob(speed);
          if (outcome.breakFrame) break;
        }
        if (throttlePending) {
          consumeThrottlePending();
          break;
        }
        if (clock() >= deadline) break;
      }
    }

    function maybeRender(now, speed) {
      if (!pacing.shouldRender(now, speed)) return;
      try {
        adapter.onRender?.({ now, speed, backlog: pacing.backlog(), jobActive: !!job });
      } catch (error) {
        report('render', error, false);
      }
    }

    function maybePersist(now, speed) {
      if (!pacing.shouldPersist(now, speed)) return;
      try {
        adapter.onPersist?.({ now, speed });
      } catch (error) {
        report('persist', error, false);
      }
    }

    function advanceTo(target, options = {}) {
      const current = simNow();
      const requested = Number(target);
      const maximumSeconds = Math.max(86400, Math.min(366 * 86400, Number(options.maxSeconds) || 366 * 86400));
      if (!Number.isFinite(requested) || requested <= current + 1e-6) {
        return { accepted: false, reason: 'advance-target-not-forward', target: current };
      }
      if (requested - current > maximumSeconds) {
        return { accepted: false, reason: 'advance-target-too-far', target: current };
      }

      const preferred = Number(options.speed);
      const positiveSpeeds = config.allowedSpeeds.filter(speed => speed > 0);
      const fastest = positiveSpeeds.length ? Math.max(...positiveSpeeds) : 0;
      const speed = config.allowedSpeeds.includes(preferred) && preferred > 0 ? preferred : fastest;
      if (speed <= 0) return { accepted: false, reason: 'advance-speed-unavailable', target: current };

      const requestedBatch = Number(options.batchSeconds);
      const batchSeconds = Math.max(
        config.manualMinBatchSeconds,
        Math.min(3600, Number.isFinite(requestedBatch) && requestedBatch > 0 ? requestedBatch : config.manualBatchSeconds)
      );
      cancelJob('manual-advance-request');
      health.lastAdvanceFailure = null;
      health.lastProgressSim = current;
      health.lastProgressAt = clock();
      manualAdvance = {
        target: requested,
        speed,
        requestedSpeed: speed,
        batchSeconds,
        reason: String(options.reason || 'manual-advance'),
        requestedAt: clock(),
        retries: 0,
        retryKey: '',
        yields: 0
      };
      pacing.reset(clock());
      lastObservedSpeed = speed;
      try {
        adapter.onAdvance?.({
          active: true,
          target: requested,
          remaining: requested - current,
          speed,
          reason: manualAdvance.reason
        });
      } catch (error) {
        report('advance-start', error, false);
      }
      return { accepted: true, ...manualSnapshot() };
    }

    function cancelAdvance(reason = 'manual-advance-cancelled') {
      if (!manualAdvance) return false;
      const cancelledAdvance = { ...manualAdvance };
      cancelJob(reason);
      manualAdvance = null;
      pacing.reset(clock());
      try {
        adapter.onAdvance?.({ active: false, cancelled: true, target: cancelledAdvance.target, reason });
      } catch (error) {
        report('advance-cancel', error, false);
      }
      return true;
    }

    function frame(now = clock()) {
      health.frames += 1;
      completeManualAdvance();
      const advancing = manualAdvance;
      const speed = advancing ? advancing.speed : getSpeed();
      if (lastObservedSpeed === null) lastObservedSpeed = speed;
      if (speed !== lastObservedSpeed) {
        cancelJob('speed-change');
        pacing.reset(now);
        lastObservedSpeed = speed;
        maybeRender(now, speed);
        maybePersist(now, speed);
        return;
      }

      const suspended = !!adapter.isSuspended?.();
      if (advancing) {
        const remaining = Math.max(0, advancing.target - simNow());
        if (remaining <= 1e-6) {
          completeManualAdvance();
          pacing.reset(now);
          maybeRender(now, speed);
          maybePersist(now, speed);
          return;
        }
        // Calendar navigation is target-driven and cannot replay wall time.
        pacing.setManualBacklog(remaining, now);
      } else {
        const observed = pacing.observeLiveFrame(now, speed, { suspended, paused: speed <= 0 });
        if (observed.droppedRealSeconds > 0) health.droppedRealSeconds += observed.droppedRealSeconds;
        if (observed.stalled) health.stallGaps = (health.stallGaps || 0) + 1;
        if (observed.clamped) health.backlogClamps += 1;
      }

      const hidden = pacing.snapshot().hidden;
      if (hidden || suspended || (speed <= 0 && !advancing)) {
        pacing.clearBacklog();
        cancelJob(hidden ? 'hidden' : speed <= 0 ? 'paused' : 'suspended');
        maybeRender(now, speed);
        return;
      }

      work(now, speed);
      completeManualAdvance();
      maybeRender(now, speed);
      maybePersist(now, speed);
    }

    function reset(now = clock(), reason = 'reset') {
      const cancelledAdvance = manualAdvance;
      manualAdvance = null;
      cancelJob(reason);
      pacing.reset(now);
      jobSlice = 0;
      jobStart = simNow();
      jobSpeed = 0;
      jobBoundary = null;
      jobWorkMs = 0;
      jobReadyToFinish = false;
      hardTaskStreak = 0;
      conflictStreak = 0;
      throttlePending = null;
      if (cancelledAdvance) {
        try {
          adapter.onAdvance?.({ active: false, cancelled: true, target: cancelledAdvance.target, reason });
        } catch (error) {
          report('advance-reset', error, false);
        }
      }
      lastHourCommitted = Math.floor((simNow() + 1e-6) / 3600);
      lastDayCommitted = Math.floor((simNow() + 1e-6) / 86400);
      lastObservedSpeed = getSpeed();
    }

    function setHidden(value) {
      const hidden = !!value;
      reset(clock(), hidden ? 'hidden' : 'visible');
      pacing.setHidden(hidden, clock());
      if (hidden) {
        try {
          adapter.onPersist?.({ reason: 'hidden', speed: getSpeed() });
        } catch (error) {
          report('persist-hidden', error, false);
        }
      }
    }

    function snapshot() {
      const pace = pacing.snapshot();
      return {
        ...health,
        simSeconds: simNow(),
        speed: getSpeed(),
        backlog: pace.backlog,
        jobActive: !!job,
        jobReadyToFinish,
        jobSlice,
        jobSpeed,
        hidden: pace.hidden,
        manualAdvance: manualSnapshot(),
        pacing: pace,
        config: { ...config, allowedSpeeds: [...config.allowedSpeeds], nowMs: undefined }
      };
    }

    function configSnapshot() {
      return { ...config, allowedSpeeds: [...config.allowedSpeeds], nowMs: undefined };
    }

    return {
      version: VERSION,
      frame,
      reset,
      setHidden,
      advanceTo,
      cancelAdvance,
      snapshot,
      health: () => ({ ...health }),
      config: configSnapshot
    };
  }

  const API = Object.freeze({ VERSION, DEFAULTS, normalizeConfig, create });
  globalThis.GH_SIMULATION_CORE = API;
  if (globalThis.window && globalThis.window !== globalThis) {
    globalThis.window.GH_SIMULATION_CORE = API;
  }
  if (typeof module !== 'undefined' && module.exports) module.exports = API;
})();

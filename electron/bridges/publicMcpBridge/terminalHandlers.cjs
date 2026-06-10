"use strict";

const DEFAULT_BACKGROUND_JOB_POLL_INTERVAL_MS = 30 * 1000;
const BACKGROUND_JOB_RETENTION_MS = 10 * 60 * 1000;

function createBackgroundJobId(crypto, DateImpl = Date) {
  return `job_${DateImpl.now().toString(36)}_${crypto.randomBytes(6).toString("hex")}`;
}

function createPublicTerminalHandlers(ctx) {
  const {
    registry,
    execViaPty,
    startPtyJob,
    getFreshIdlePrompt,
    electronModule,
    safeSend,
    reserveSessionExecution,
    releaseSessionExecution,
    getSessionBusyError,
    checkCommandSafety,
    commandTimeoutMs,
    getCommandTimeoutMs,
    crypto,
    Date: DateImpl = Date,
    setTimeout: setTimeoutFn = setTimeout,
    clearTimeout: clearTimeoutFn = clearTimeout,
  } = ctx;

  const activeExecs = new Map();
  const jobs = new Map();
  const jobRetentionTimers = new Map();

  function isRetainedTerminalState(job) {
    return job?.status !== "running" && job?.status !== "stopping";
  }

  function clearJobRetentionTimer(jobId) {
    const timer = jobRetentionTimers.get(jobId);
    if (!timer) return;
    clearTimeoutFn(timer);
    jobRetentionTimers.delete(jobId);
  }

  function pruneExpiredJobs(now = DateImpl.now()) {
    for (const [jobId, job] of jobs) {
      if (!isRetainedTerminalState(job)) continue;
      const updatedAt = Number(job.updatedAt) || 0;
      if (updatedAt > 0 && now - updatedAt > BACKGROUND_JOB_RETENTION_MS) {
        clearJobRetentionTimer(jobId);
        jobs.delete(jobId);
      }
    }
  }

  function scheduleJobRetentionPrune(job) {
    if (!isRetainedTerminalState(job)) return;
    clearJobRetentionTimer(job.id);
    const updatedAt = Number(job.updatedAt) || DateImpl.now();
    const delayMs = Math.max(1, BACKGROUND_JOB_RETENTION_MS - (DateImpl.now() - updatedAt) + 1);
    const timer = setTimeoutFn(() => {
      jobRetentionTimers.delete(job.id);
      pruneExpiredJobs();
    }, delayMs);
    timer?.unref?.();
    jobRetentionTimers.set(job.id, timer);
  }

  function echoCommandToSession(session, sessionId, command) {
    if (!electronModule || !session?.webContentsId || !command) return;
    const contents = electronModule.webContents?.fromId?.(session.webContentsId);
    safeSend(contents, "netcatty:data", {
      sessionId,
      data: `${command}\r\n`,
      syntheticEcho: true,
    });
  }

  function serializeJob(job, offset = 0) {
    const snapshot = job.handle?.getSnapshot?.() || {
      stdout: job.stdout || "",
      outputBaseOffset: job.outputBaseOffset || 0,
      totalOutputChars: job.totalOutputChars || 0,
      outputTruncated: Boolean(job.outputTruncated),
    };
    const stdout = String(snapshot.stdout || "");
    const outputBaseOffset = Math.max(0, Number(snapshot.outputBaseOffset) || 0);
    const totalOutputChars = Math.max(outputBaseOffset + stdout.length, Number(snapshot.totalOutputChars) || 0);
    const numericOffset = Math.max(0, Number(offset) || 0);
    const relativeOffset = numericOffset <= outputBaseOffset
      ? 0
      : Math.min(numericOffset - outputBaseOffset, stdout.length);
    return {
      ok: true,
      jobId: job.id,
      sessionId: job.sessionId,
      command: job.command,
      status: job.status,
      completed: job.status !== "running" && job.status !== "stopping",
      exitCode: job.exitCode,
      error: job.error,
      startedAt: job.startedAt,
      updatedAt: job.updatedAt,
      output: stdout.slice(relativeOffset),
      nextOffset: totalOutputChars,
      totalOutputChars,
      outputBaseOffset,
      outputTruncated: Boolean(snapshot.outputTruncated),
      recommendedPollIntervalMs: DEFAULT_BACKGROUND_JOB_POLL_INTERVAL_MS,
    };
  }

  function resolveCommandTimeoutMs() {
    return Math.max(1, Number(getCommandTimeoutMs?.()) || Number(commandTimeoutMs) || 60000);
  }

  function checkPublicCommandSafety(command) {
    const safety = checkCommandSafety?.(command);
    if (safety?.blocked) {
      return {
        ok: false,
        error: `Command blocked by safety policy. Pattern: ${safety.matchedPattern}`,
      };
    }
    return { ok: true };
  }

  async function handleTerminalExecute({ sessionId, command }) {
    const validated = registry.validatePublicSession(sessionId);
    if (!validated.ok) return validated;

    const safety = checkPublicCommandSafety(command);
    if (!safety.ok) return safety;

    const busy = getSessionBusyError(sessionId);
    if (busy) return busy;

    const reservation = reserveSessionExecution(sessionId, "exec");
    if (!reservation.ok) return reservation;

    const trackForCancellation = new Map();
    activeExecs.set(sessionId, { token: reservation.token, trackForCancellation });

    try {
      return await execViaPty(validated.ptyStream, command, {
        trackForCancellation,
        timeoutMs: resolveCommandTimeoutMs(),
        shellKind: validated.session.shellKind,
        expectedPrompt: getFreshIdlePrompt(validated.session),
        typedInput: true,
        echoCommand: (rawCommand) => echoCommandToSession(validated.session, sessionId, rawCommand),
        enforceWallTimeout: true,
      });
    } finally {
      activeExecs.delete(sessionId);
      releaseSessionExecution(sessionId, reservation.token);
    }
  }

  async function handleTerminalStart({ sessionId, command }) {
    const validated = registry.validatePublicSession(sessionId);
    if (!validated.ok) return validated;

    const safety = checkPublicCommandSafety(command);
    if (!safety.ok) return safety;

    const busy = getSessionBusyError(sessionId);
    if (busy) return busy;

    const reservation = reserveSessionExecution(sessionId, "job");
    if (!reservation.ok) return reservation;

    const timeoutMs = resolveCommandTimeoutMs();
    const handle = startPtyJob(validated.ptyStream, command, {
      timeoutMs: Math.max(timeoutMs, 60 * 60 * 1000),
      shellKind: validated.session.shellKind,
      expectedPrompt: getFreshIdlePrompt(validated.session),
      typedInput: true,
      echoCommand: (rawCommand) => echoCommandToSession(validated.session, sessionId, rawCommand),
      maxBufferedChars: 256 * 1024,
      normalizeFinalOutput: false,
    });

    const startedAt = DateImpl.now();
    const jobId = createBackgroundJobId(crypto, DateImpl);
    const job = {
      id: jobId,
      sessionId,
      command,
      status: "running",
      startedAt,
      updatedAt: startedAt,
      exitCode: null,
      error: null,
      stdout: "",
      outputBaseOffset: 0,
      totalOutputChars: 0,
      outputTruncated: false,
      handle,
      sessionToken: reservation.token,
    };
    jobs.set(jobId, job);

    Promise.resolve(handle.resultPromise)
      .then((result) => {
        if (!jobs.has(jobId)) return;
        job.updatedAt = DateImpl.now();
        job.stdout = String(result?.stdout || "");
        job.outputBaseOffset = Math.max(0, Number(result?.outputBaseOffset) || 0);
        job.totalOutputChars = Math.max(job.outputBaseOffset + job.stdout.length, Number(result?.totalOutputChars) || 0);
        job.outputTruncated = Boolean(result?.outputTruncated);
        job.exitCode = result?.exitCode ?? null;
        job.error = result?.error || null;
        job.status = result?.error ? "failed" : "completed";
        job.handle = null;
        releaseSessionExecution(sessionId, reservation.token);
        scheduleJobRetentionPrune(job);
      })
      .catch((error) => {
        if (!jobs.has(jobId)) return;
        job.updatedAt = DateImpl.now();
        job.status = "failed";
        job.error = error?.message || String(error);
        job.handle = null;
        releaseSessionExecution(sessionId, reservation.token);
        scheduleJobRetentionPrune(job);
      });

    return {
      ok: true,
      jobId,
      sessionId,
      command,
      status: "running",
      startedAt,
      recommendedPollIntervalMs: DEFAULT_BACKGROUND_JOB_POLL_INTERVAL_MS,
    };
  }

  function handleTerminalPoll({ jobId, offset = 0 }) {
    pruneExpiredJobs();
    const job = jobs.get(jobId);
    if (!job) {
      return { ok: false, error: "Background job not found" };
    }
    return serializeJob(job, offset);
  }

  function handleTerminalStop({ jobId }) {
    pruneExpiredJobs();
    const job = jobs.get(jobId);
    if (!job) {
      return { ok: false, error: "Background job not found" };
    }
    if (job.status === "running") {
      try {
        job.handle?.cancel?.();
      } catch (error) {
        return { ok: false, error: error?.message || String(error) };
      }
      job.status = "stopping";
      job.error = "Cancellation requested";
      job.updatedAt = DateImpl.now();
    }
    return serializeJob(job, 0);
  }

  async function cleanup() {
    for (const [sessionId, entry] of activeExecs) {
      for (const markerEntry of entry.trackForCancellation.values()) {
        try {
          markerEntry.cancel?.();
        } catch {
          // Ignore cancellation failures during cleanup.
        }
      }
      releaseSessionExecution(sessionId, entry.token);
    }
    activeExecs.clear();

    for (const jobId of jobRetentionTimers.keys()) {
      clearJobRetentionTimer(jobId);
    }

    for (const [jobId, job] of jobs) {
      try {
        job.handle?.cancel?.();
      } catch {
        // Ignore cancellation failures during cleanup.
      }
      releaseSessionExecution(job.sessionId, job.sessionToken);
      jobs.delete(jobId);
    }
  }

  return {
    handleTerminalExecute,
    handleTerminalStart,
    handleTerminalPoll,
    handleTerminalStop,
    cleanup,
  };
}

module.exports = {
  createPublicTerminalHandlers,
};

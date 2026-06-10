const test = require("node:test");
const assert = require("node:assert/strict");

const { createPublicSessionRegistry } = require("./sessionRegistry.cjs");
const { createPublicTerminalHandlers } = require("./terminalHandlers.cjs");

function makeWritableStream() {
  return {
    writes: [],
    write(data) {
      this.writes.push(data);
      return true;
    },
  };
}

function makeSession(overrides = {}) {
  return {
    hostname: "example.com",
    username: "root",
    label: "prod",
    shellKind: "bash",
    conn: { exec() {} },
    stream: makeWritableStream(),
    webContentsId: 42,
    ...overrides,
  };
}

function makeContext(overrides = {}) {
  const sessions = new Map([["ssh-1", makeSession()]]);
  const registry = createPublicSessionRegistry({ sessions });
  const sent = [];
  const execCalls = [];
  const jobCalls = [];
  const activeLocks = new Map();
  let reservationSeq = 0;
  let resolveJobResult = null;
  const electronModule = {
    webContents: {
      fromId(id) {
        return { id };
      },
    },
  };

  const ctx = {
    sessions,
    registry,
    electronModule,
    safeSend(contents, channel, payload) {
      sent.push({ contents, channel, payload });
    },
    execViaPty: async (ptyStream, command, options) => {
      execCalls.push({ ptyStream, command, options });
      if (options?.typedInput && typeof options?.echoCommand === "function") {
        options.echoCommand(command);
      }
      return { ok: true, stdout: "/tmp/demo\n", stderr: "", exitCode: 0 };
    },
    startPtyJob: (ptyStream, command, options) => {
      jobCalls.push({ ptyStream, command, options });
      if (options?.typedInput && typeof options?.echoCommand === "function") {
        options.echoCommand(command);
      }
      const result = { ok: true, stdout: "build ok\n", stderr: "", exitCode: 0, outputBaseOffset: 0, totalOutputChars: 9, outputTruncated: false };
      return {
        cancelCalled: false,
        cancel() {
          this.cancelCalled = true;
        },
        getSnapshot() {
          return { stdout: "build ok\n", outputBaseOffset: 0, totalOutputChars: 9, outputTruncated: false };
        },
        resultPromise: new Promise((resolve) => {
          resolveJobResult = () => resolve(result);
        }),
      };
    },
    getFreshIdlePrompt() {
      return "root@example:$";
    },
    reserveSessionExecution(sessionId, kind) {
      if (activeLocks.has(sessionId)) {
        return {
          ok: false,
          error: `Session already has ${activeLocks.get(sessionId).kind} in progress.`,
        };
      }
      const token = `${kind}-${++reservationSeq}`;
      activeLocks.set(sessionId, { kind, token });
      return { ok: true, token };
    },
    releaseSessionExecution(sessionId, token) {
      const active = activeLocks.get(sessionId);
      if (!active || active.token !== token) return;
      activeLocks.delete(sessionId);
    },
    getSessionBusyError(sessionId) {
      if (!activeLocks.has(sessionId)) return null;
      return { ok: false, error: "Session already busy" };
    },
    commandTimeoutMs: 60000,
    crypto: { randomBytes: () => Buffer.from("abcdef", "hex") },
    Date,
    ...overrides,
  };

  return {
    ctx,
    sent,
    execCalls,
    jobCalls,
    activeLocks,
    resolveJobResult: () => resolveJobResult?.(),
  };
}

test("terminalExecute uses execViaPty, never exec fallback, and echoes command", async () => {
  const { ctx, sent, execCalls } = makeContext();
  const handlers = createPublicTerminalHandlers(ctx);

  const result = await handlers.handleTerminalExecute({ sessionId: "ssh-1", command: "pwd" });

  assert.equal(result.ok, true);
  assert.equal(execCalls.length, 1);
  assert.equal(execCalls[0].command, "pwd");
  assert.equal(execCalls[0].options.typedInput, true);
  assert.equal(execCalls[0].options.enforceWallTimeout, true);
  assert.equal(typeof execCalls[0].options.echoCommand, "function");
  assert.equal(sent.length, 1);
  assert.equal(sent[0].channel, "netcatty:data");
  assert.equal(sent[0].payload.sessionId, "ssh-1");
  assert.equal(sent[0].payload.syntheticEcho, true);
  assert.equal(sent[0].payload.data, "pwd\r\n");
});

test("terminalExecute rejects sessions without public writable pty", async () => {
  const { ctx } = makeContext();
  ctx.sessions.set("ssh-2", makeSession({ stream: null, pty: null, proc: null }));
  const handlers = createPublicTerminalHandlers(ctx);

  const result = await handlers.handleTerminalExecute({ sessionId: "ssh-2", command: "pwd" });

  assert.equal(result.ok, false);
  assert.equal(result.code, "SESSION_NOT_PUBLIC");
});

test("terminalExecute returns busy error when shared lock is already held", async () => {
  const { ctx, activeLocks } = makeContext();
  activeLocks.set("ssh-1", { kind: "job", token: "job-1" });
  const handlers = createPublicTerminalHandlers(ctx);

  const result = await handlers.handleTerminalExecute({ sessionId: "ssh-1", command: "pwd" });

  assert.equal(result.ok, false);
  assert.match(result.error, /busy/i);
});

test("terminalStart reserves lock, terminalPoll returns serialized state, and terminalStop cancels job", async () => {
  const { ctx, jobCalls, activeLocks, resolveJobResult } = makeContext();
  const handlers = createPublicTerminalHandlers(ctx);

  const started = await handlers.handleTerminalStart({ sessionId: "ssh-1", command: "npm run build" });
  assert.equal(started.ok, true);
  assert.equal(jobCalls.length, 1);
  assert.equal(jobCalls[0].command, "npm run build");
  assert.equal(typeof jobCalls[0].options.echoCommand, "function");
  assert.equal(activeLocks.has("ssh-1"), true);

  const polled = handlers.handleTerminalPoll({ jobId: started.jobId, offset: 0 });
  assert.equal(polled.ok, true);
  assert.equal(polled.jobId, started.jobId);
  assert.equal(polled.output, "build ok\n");
  assert.equal(polled.completed, false);

  const stopped = handlers.handleTerminalStop({ jobId: started.jobId });
  assert.equal(stopped.ok, true);
  assert.equal(stopped.status, "stopping");
  assert.equal(activeLocks.has("ssh-1"), true);

  resolveJobResult();
});

test("terminal handlers read command timeout dynamically for each call", async () => {
  let timeoutMs = 60000;
  const { ctx, execCalls, jobCalls } = makeContext({
    getCommandTimeoutMs() {
      return timeoutMs;
    },
  });
  const handlers = createPublicTerminalHandlers(ctx);

  timeoutMs = 15000;
  await handlers.handleTerminalExecute({ sessionId: "ssh-1", command: "pwd" });

  timeoutMs = 45000;
  await handlers.handleTerminalStart({ sessionId: "ssh-1", command: "npm run build" });

  assert.equal(execCalls[0].options.timeoutMs, 15000);
  assert.equal(jobCalls[0].options.timeoutMs, 60 * 60 * 1000);
});

test("terminal handler cleanup cancels running execs and jobs and releases locks", async () => {
  let execCancelled = false;
  const { ctx, activeLocks } = makeContext({
    execViaPty: async (_ptyStream, _command, options) => {
      options.trackForCancellation.set("exec-marker", {
        cancel() { execCancelled = true; },
      });
      return new Promise(() => {});
    },
    startPtyJob: () => ({
      cancelCalled: false,
      cancel() {
        this.cancelCalled = true;
      },
      getSnapshot() {
        return { stdout: "", outputBaseOffset: 0, totalOutputChars: 0, outputTruncated: false };
      },
      resultPromise: new Promise(() => {}),
    }),
  });
  const handlers = createPublicTerminalHandlers(ctx);

  void handlers.handleTerminalExecute({ sessionId: "ssh-1", command: "pwd" });
  ctx.sessions.set("ssh-2", makeSession());
  const started = await handlers.handleTerminalStart({ sessionId: "ssh-2", command: "tail -f /var/log/app.log" });

  await handlers.cleanup();

  assert.equal(execCancelled, true);
  assert.equal(activeLocks.has("ssh-1"), false);
  assert.equal(activeLocks.has("ssh-2"), false);
  const stopped = handlers.handleTerminalPoll({ jobId: started.jobId, offset: 0 });
  assert.equal(stopped.ok, false);
  assert.match(stopped.error, /not found/i);
});

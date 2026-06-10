const test = require("node:test");
const assert = require("node:assert/strict");

const { createPublicSessionRegistry } = require("./sessionRegistry.cjs");
const { createPublicSftpHandlers } = require("./sftpHandlers.cjs");

function makeWritableStream() {
  return {
    write() {
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
    conn: { sftp() {} },
    stream: makeWritableStream(),
    ...overrides,
  };
}

function createDeferredPromise() {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function makeContext(overrides = {}) {
  const {
    sftpBridge: sftpBridgeOverrides = null,
    deferOpen = false,
    ...ctxOverrides
  } = overrides;
  const sessions = new Map([["ssh-1", makeSession()]]);
  const registry = createPublicSessionRegistry({ sessions });
  const calls = [];
  const closes = [];
  const activeOps = new Map();
  let activeSeq = 0;
  const openDeferred = createDeferredPromise();

  const baseSftpBridge = {
    openSftpForSession: async (_event, payload) => {
      calls.push({ method: "openSftpForSession", payload });
      if (deferOpen) {
        const abortSignal = payload?.abortSignal || null;
        if (abortSignal?.aborted) {
          throw abortSignal.reason || new Error("Cancelled");
        }
        return await new Promise((resolve, reject) => {
          const onAbort = () => {
            abortSignal?.removeEventListener?.("abort", onAbort);
            reject(abortSignal.reason || new Error("Cancelled"));
          };
          abortSignal?.addEventListener?.("abort", onAbort, { once: true });
          openDeferred.promise.then(
            (value) => {
              abortSignal?.removeEventListener?.("abort", onAbort);
              resolve(value);
            },
            (error) => {
              abortSignal?.removeEventListener?.("abort", onAbort);
              reject(error);
            },
          );
        });
      }
      return { sftpId: "sftp-1" };
    },
    closeSftp: async (_event, payload) => {
      closes.push(payload);
      return { ok: true };
    },
    listSftp: async (_event, payload) => {
      calls.push({ method: "listSftp", payload });
      return [{ filename: "hosts" }];
    },
    readSftp: async (_event, payload) => {
      calls.push({ method: "readSftp", payload });
      return "hello";
    },
    writeSftp: async (_event, payload) => {
      calls.push({ method: "writeSftp", payload });
      return { ok: true };
    },
    statSftp: async (_event, payload) => {
      calls.push({ method: "statSftp", payload });
      return { size: 5 };
    },
    getSftpHomeDir: async (_event, payload) => {
      calls.push({ method: "getSftpHomeDir", payload });
      return { success: true, homeDir: "/root" };
    },
    mkdirSftp: async (_event, payload) => {
      calls.push({ method: "mkdirSftp", payload });
      return { ok: true };
    },
    deleteSftp: async (_event, payload) => {
      calls.push({ method: "deleteSftp", payload });
      return { ok: true };
    },
    renameSftp: async (_event, payload) => {
      calls.push({ method: "renameSftp", payload });
      return { ok: true };
    },
    chmodSftp: async (_event, payload) => {
      calls.push({ method: "chmodSftp", payload });
      return { ok: true };
    },
  };
  const sftpBridge = {
    ...baseSftpBridge,
    ...(sftpBridgeOverrides || {}),
  };

  const ctx = {
    registry,
    sftpBridge,
    commandTimeoutMs: 60000,
    AbortController,
    setTimeout,
    clearTimeout,
    registerPublicSftpOp(cancel) {
      const opId = `op-${++activeSeq}`;
      activeOps.set(opId, { cancel });
      return () => activeOps.delete(opId);
    },
    ...ctxOverrides,
  };

  return {
    ctx,
    sessions,
    calls,
    closes,
    activeOps,
    openDeferred,
  };
}

test("sftp handlers validate public sessions and close one-off handles on success", async () => {
  const { ctx, calls, closes } = makeContext();
  const handlers = createPublicSftpHandlers(ctx);

  const listResult = await handlers.handleSftpList({ sessionId: "ssh-1", path: "/etc" });
  const readResult = await handlers.handleSftpReadFile({ sessionId: "ssh-1", path: "/etc/hosts" });
  const writeResult = await handlers.handleSftpWriteFile({ sessionId: "ssh-1", path: "/tmp/demo.txt", content: "hello" });
  const statResult = await handlers.handleSftpStat({ sessionId: "ssh-1", path: "/etc/hosts" });
  const homeResult = await handlers.handleSftpHome({ sessionId: "ssh-1" });
  const mkdirResult = await handlers.handleSftpMkdir({ sessionId: "ssh-1", path: "/tmp/demo" });
  const deleteResult = await handlers.handleSftpDelete({ sessionId: "ssh-1", path: "/tmp/demo.txt" });
  const renameResult = await handlers.handleSftpRename({ sessionId: "ssh-1", oldPath: "/tmp/a", newPath: "/tmp/b" });
  const chmodResult = await handlers.handleSftpChmod({ sessionId: "ssh-1", path: "/tmp/demo.txt", mode: "0644" });

  assert.deepEqual(listResult, { ok: true, entries: [{ filename: "hosts" }] });
  assert.deepEqual(readResult, { ok: true, path: "/etc/hosts", content: "hello" });
  assert.deepEqual(writeResult, { ok: true, path: "/tmp/demo.txt" });
  assert.deepEqual(statResult, { ok: true, stat: { size: 5 } });
  assert.deepEqual(homeResult, { ok: true, homeDir: "/root" });
  assert.deepEqual(mkdirResult, { ok: true, path: "/tmp/demo" });
  assert.deepEqual(deleteResult, { ok: true, path: "/tmp/demo.txt" });
  assert.deepEqual(renameResult, { ok: true, oldPath: "/tmp/a", newPath: "/tmp/b" });
  assert.deepEqual(chmodResult, { ok: true, path: "/tmp/demo.txt", mode: "0644" });

  const opened = calls.filter((entry) => entry.method === "openSftpForSession");
  assert.equal(opened.length, 9);
  assert.equal(closes.length, 9);
  assert.deepEqual(
    opened.map((entry) => entry.payload.encodingStateKey),
    Array.from({ length: 9 }, () => "public:ssh-1"),
  );
  assert.deepEqual(
    closes.map((entry) => entry.encodingStateKey),
    Array.from({ length: 9 }, () => "public:ssh-1"),
  );
});

test("sftp handlers reject non-public sessions before opening handles", async () => {
  const { ctx, sessions, calls } = makeContext();
  sessions.set("local-1", makeSession({ protocol: "local" }));
  const handlers = createPublicSftpHandlers(ctx);

  const result = await handlers.handleSftpList({ sessionId: "local-1", path: "/etc" });

  assert.equal(result.ok, false);
  assert.equal(result.code, "SESSION_NOT_PUBLIC");
  assert.equal(calls.length, 0);
});

test("sftp handlers close handles on failure and expose cleanup for active operations", async () => {
  const { ctx, closes, activeOps } = makeContext({
    sftpBridge: {
      readSftp: async () => {
        throw new Error("read failed");
      },
    },
  });
  const handlers = createPublicSftpHandlers(ctx);

  await assert.rejects(
    handlers.handleSftpReadFile({ sessionId: "ssh-1", path: "/etc/hosts" }),
    /read failed/,
  );
  assert.equal(closes.length, 1);

  const { ctx: deferredCtx, activeOps: deferredActiveOps, openDeferred } = makeContext({ deferOpen: true });
  const deferredHandlers = createPublicSftpHandlers(deferredCtx);
  const pending = deferredHandlers.handleSftpList({ sessionId: "ssh-1", path: "/etc" });
  assert.equal(deferredActiveOps.size, 1);

  await deferredHandlers.cleanup();
  assert.equal(deferredActiveOps.size, 0);

  openDeferred.resolve({ sftpId: "sftp-2" });
  await assert.rejects(pending, /cancelled|aborted/i);
});

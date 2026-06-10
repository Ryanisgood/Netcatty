const test = require("node:test");
const assert = require("node:assert/strict");

const publicMcpBridge = require("./publicMcpBridge.cjs");

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
    conn: { exec() {} },
    stream: makeWritableStream(),
    ...overrides,
  };
}

function createIpcMainStub() {
  return {
    handlers: new Map(),
    handle(channel, handler) {
      this.handlers.set(channel, handler);
    },
  };
}

function makeEvent(senderId) {
  return { sender: { id: senderId } };
}

function createBridgeHarness(overrides = {}) {
  const sessions = new Map([["ssh-1", makeSession()]]);
  const discoveryWrites = [];
  const discoveryRemoves = [];
  const tcpServers = [];
  const terminalCleanupCalls = [];
  const sftpCleanupCalls = [];
  const codexSetupCalls = [];
  const claudeSetupCalls = [];
  let statusMode = "success";
  let tcpStartSeq = 0;
  let tokenSeq = 0;

  const bridge = publicMcpBridge.createPublicMcpBridge({
    createSessionRegistry: ({ sessions: liveSessions }) => ({
      listPublicSessions() {
        const hosts = [];
        for (const [sessionId, session] of liveSessions.entries()) {
          if (session?.protocol === "local") continue;
          hosts.push({
            sessionId,
            hostname: session.hostname || "",
            label: session.label || "",
            username: session.username || "",
            protocol: "ssh",
            shellType: session.shellKind || "unknown",
            connected: true,
          });
        }
        return hosts;
      },
      validatePublicSession(sessionId) {
        const session = liveSessions.get(sessionId);
        if (!session) return { ok: false, code: "SESSION_NOT_FOUND", error: "Session not found" };
        return {
          ok: true,
          session,
          summary: {
            sessionId,
            hostname: session.hostname || "",
            label: session.label || "",
            username: session.username || "",
            protocol: "ssh",
            shellType: session.shellKind || "unknown",
            connected: true,
          },
          ptyStream: session.stream,
          sshClient: session.conn,
        };
      },
    }),
    createPublicTerminalHandlers() {
      return {
        async handleTerminalExecute() {
          return { ok: true };
        },
        async handleTerminalStart() {
          return { ok: true, jobId: "job-1" };
        },
        handleTerminalPoll() {
          return { ok: true, jobId: "job-1" };
        },
        handleTerminalStop() {
          return { ok: true, jobId: "job-1" };
        },
        async cleanup() {
          terminalCleanupCalls.push("cleanup");
        },
      };
    },
    createPublicSftpHandlers() {
      return {
        async handleSftpList() {
          return { ok: true, entries: [] };
        },
        async handleSftpReadFile() {
          return { ok: true, path: "/tmp/a", content: "" };
        },
        async handleSftpWriteFile() {
          return { ok: true, path: "/tmp/a" };
        },
        async handleSftpStat() {
          return { ok: true, stat: {} };
        },
        async handleSftpHome() {
          return { ok: true, homeDir: "/root" };
        },
        async handleSftpMkdir() {
          return { ok: true, path: "/tmp" };
        },
        async handleSftpDelete() {
          return { ok: true, path: "/tmp" };
        },
        async handleSftpRename() {
          return { ok: true, oldPath: "/tmp/a", newPath: "/tmp/b" };
        },
        async handleSftpChmod() {
          return { ok: true, path: "/tmp/a", mode: "0644" };
        },
        async cleanup() {
          sftpCleanupCalls.push("cleanup");
        },
      };
    },
    createPublicRpcHandlers(ctx) {
      return {
        async dispatch(method, params) {
          if (method === "public/getStatus") {
            return {
              ok: true,
              enabled: ctx.getEnabled(),
              available: ctx.getEnabled(),
              commandTimeoutMs: ctx.commandTimeoutMs,
              sessionCount: ctx.registry.listPublicSessions().length,
            };
          }
          return { ok: true, method, params };
        },
      };
    },
    createPublicTcpServer(options) {
      const serverState = {
        options,
        starts: 0,
        stops: 0,
        address: null,
        startDeferred: null,
      };
      const api = {
        async start() {
          serverState.starts += 1;
          tcpStartSeq += 1;
          if (statusMode === "deferred") {
            const deferred = {};
            deferred.promise = new Promise((resolve, reject) => {
              deferred.resolve = resolve;
              deferred.reject = reject;
            });
            serverState.startDeferred = deferred;
            return await deferred.promise;
          }
          if (statusMode === "error") {
            throw new Error("listen failed");
          }
          serverState.address = { host: "127.0.0.1", port: 47000 + tcpStartSeq };
          return serverState.address;
        },
        async stop() {
          serverState.stops += 1;
          serverState.address = null;
        },
        getAddress() {
          return serverState.address;
        },
      };
      tcpServers.push(serverState);
      return api;
    },
    writePublicDiscovery(filePath, payload) {
      discoveryWrites.push({ filePath, payload });
    },
    removePublicDiscovery(filePath) {
      discoveryRemoves.push(filePath);
    },
    randomBytes(size) {
      tokenSeq += 1;
      return Buffer.from(String(tokenSeq).padStart(size * 2, "0").slice(0, size * 2), "hex");
    },
    getPublicMcpLauncherPath() {
      return "/launcher/netcatty-public-mcp";
    },
    createPublicMcpCodexSetup() {
      return {
        async getStatus() {
          codexSetupCalls.push("getStatus");
          return {
            ok: true,
            state: "not_configured",
            codexPath: "/usr/local/bin/codex",
            launcherPath: "/launcher/netcatty-public-mcp",
            command: "codex mcp add netcatty-public -- /launcher/netcatty-public-mcp",
            existingCommand: null,
            error: null,
          };
        },
        async addToCodex() {
          codexSetupCalls.push("addToCodex");
          return {
            ok: true,
            state: "configured",
            codexPath: "/usr/local/bin/codex",
            launcherPath: "/launcher/netcatty-public-mcp",
            command: "codex mcp add netcatty-public -- /launcher/netcatty-public-mcp",
            existingCommand: "/launcher/netcatty-public-mcp",
            error: null,
          };
        },
      };
    },
    createPublicMcpClaudeSetup() {
      return {
        async getStatus() {
          claudeSetupCalls.push("getStatus");
          return {
            ok: true,
            state: "not_configured",
            claudePath: "/usr/local/bin/claude",
            launcherPath: "/launcher/netcatty-public-mcp",
            command: "claude mcp add netcatty-public -- /launcher/netcatty-public-mcp",
            existingCommand: null,
            error: null,
          };
        },
        async addToClaude() {
          claudeSetupCalls.push("addToClaude");
          return {
            ok: true,
            state: "configured",
            claudePath: "/usr/local/bin/claude",
            launcherPath: "/launcher/netcatty-public-mcp",
            command: "claude mcp add netcatty-public -- /launcher/netcatty-public-mcp",
            existingCommand: "/launcher/netcatty-public-mcp",
            error: null,
          };
        },
      };
    },
    validateSenderOrSettings(event) {
      return event?.sender?.id === 1 || event?.sender?.id === 2;
    },
    ...overrides,
  });
  const mcpServerBridge = overrides.mcpServerBridge || {
    reserveSessionExecution() {
      return { ok: true, token: "token" };
    },
    releaseSessionExecution() {},
    getSessionBusyError() {
      return null;
    },
    getCommandTimeoutMs() {
      return 60000;
    },
    checkCommandSafety() {
      return { blocked: false };
    },
  };

  bridge.init({
    sessions,
    electronModule: {},
    sftpBridge: {},
    mcpServerBridge,
    discoveryFilePath: "/tmp/netcatty-public/discovery.json",
  });

  return {
    bridge,
    sessions,
    discoveryWrites,
    discoveryRemoves,
    tcpServers,
    terminalCleanupCalls,
    sftpCleanupCalls,
    codexSetupCalls,
    claudeSetupCalls,
    setStatusMode(value) {
      statusMode = value;
    },
  };
}

test("public bridge starts disabled and reports renderer-facing status", async () => {
  const { bridge, discoveryRemoves } = createBridgeHarness();

  const status = bridge.getStatus();

  assert.deepEqual(status, {
    ok: true,
    enabled: false,
    state: "disabled",
    host: "127.0.0.1",
    port: null,
    discoveryPath: "/tmp/netcatty-public/discovery.json",
    launcherPath: "/launcher/netcatty-public-mcp",
    exposedSessionCount: 1,
    error: null,
  });
  assert.deepEqual(discoveryRemoves, ["/tmp/netcatty-public/discovery.json"]);
});

test("public bridge setEnabled(true) starts server, writes discovery, and is idempotent", async () => {
  const { bridge, discoveryWrites, discoveryRemoves, tcpServers } = createBridgeHarness();

  const first = await bridge.setEnabled(true);
  const second = await bridge.setEnabled(true);

  assert.equal(first.state, "running");
  assert.equal(first.enabled, true);
  assert.equal(first.port, 47001);
  assert.equal(discoveryWrites.length, 1);
  assert.equal(discoveryWrites[0].filePath, "/tmp/netcatty-public/discovery.json");
  assert.equal(discoveryWrites[0].payload.port, 47001);
  assert.equal(typeof discoveryWrites[0].payload.token, "string");
  assert.deepEqual(discoveryRemoves, ["/tmp/netcatty-public/discovery.json"]);
  assert.equal(tcpServers.length, 1);
  assert.equal(tcpServers[0].starts, 1);
  assert.equal(second.port, 47001);
  assert.equal(second.state, "running");
});

test("public bridge setEnabled(false) stops server, removes discovery, and is idempotent", async () => {
  const { bridge, discoveryRemoves, tcpServers, terminalCleanupCalls, sftpCleanupCalls } = createBridgeHarness();

  await bridge.setEnabled(true);
  const first = await bridge.setEnabled(false);
  const second = await bridge.setEnabled(false);

  assert.equal(first.state, "disabled");
  assert.equal(first.enabled, false);
  assert.equal(first.port, null);
  assert.equal(tcpServers[0].stops, 1);
  assert.deepEqual(discoveryRemoves, [
    "/tmp/netcatty-public/discovery.json",
    "/tmp/netcatty-public/discovery.json",
    "/tmp/netcatty-public/discovery.json",
  ]);
  assert.equal(terminalCleanupCalls.length, 1);
  assert.equal(sftpCleanupCalls.length, 1);
  assert.equal(second.state, "disabled");
});

test("public bridge passes shared command safety policy to terminal handlers", async () => {
  let capturedCheckCommandSafety = null;
  const { bridge } = createBridgeHarness({
    createPublicTerminalHandlers(ctx) {
      capturedCheckCommandSafety = ctx.checkCommandSafety;
      return {
        async handleTerminalExecute() {
          return { ok: true };
        },
        async handleTerminalStart() {
          return { ok: true, jobId: "job-1" };
        },
        handleTerminalPoll() {
          return { ok: true, jobId: "job-1" };
        },
        handleTerminalStop() {
          return { ok: true, jobId: "job-1" };
        },
        async cleanup() {},
      };
    },
    mcpServerBridge: {
      reserveSessionExecution() {
        return { ok: true, token: "token" };
      },
      releaseSessionExecution() {},
      getSessionBusyError() {
        return null;
      },
      getCommandTimeoutMs() {
        return 60000;
      },
      checkCommandSafety(command) {
        return command === "eval echo test"
          ? { blocked: true, matchedPattern: "\\beval\\b" }
          : { blocked: false };
      },
    },
  });

  await bridge.setEnabled(true);

  assert.equal(typeof capturedCheckCommandSafety, "function");
  assert.deepEqual(capturedCheckCommandSafety("eval echo test"), {
    blocked: true,
    matchedPattern: "\\beval\\b",
  });
});

test("public bridge recovers from startup errors and rotates token on re-enable", async () => {
  const { bridge, discoveryWrites, setStatusMode } = createBridgeHarness();

  setStatusMode("error");
  const failed = await bridge.setEnabled(true);
  assert.equal(failed.state, "error");
  assert.equal(failed.enabled, true);
  assert.match(failed.error, /listen failed/);
  assert.equal(discoveryWrites.length, 0);

  setStatusMode("success");
  const recovered = await bridge.setEnabled(true);

  assert.equal(recovered.state, "running");
  assert.equal(discoveryWrites.length, 1);
  assert.equal(typeof discoveryWrites[0].payload.token, "string");

  const firstToken = discoveryWrites[0].payload.token;
  await bridge.setEnabled(false);
  const restarted = await bridge.setEnabled(true);
  const secondToken = discoveryWrites[1].payload.token;

  assert.equal(restarted.state, "running");
  assert.notEqual(firstToken, secondToken);
});

test("public bridge removes stale discovery on init and rotates token after app restart", async () => {
  let tokenSeq = 0;
  const randomBytes = (size) => {
    tokenSeq += 1;
    return Buffer.from(String(tokenSeq).padStart(size * 2, "0").slice(0, size * 2), "hex");
  };

  const firstHarness = createBridgeHarness({ randomBytes });
  await firstHarness.bridge.setEnabled(true);
  const firstToken = firstHarness.discoveryWrites[0].payload.token;

  const secondHarness = createBridgeHarness({ randomBytes });
  await secondHarness.bridge.setEnabled(true);
  const secondToken = secondHarness.discoveryWrites[0].payload.token;

  assert.deepEqual(secondHarness.discoveryRemoves, ["/tmp/netcatty-public/discovery.json"]);
  assert.notEqual(firstToken, secondToken);
});

test("public bridge cleanup stops active runtime and leaves disabled status", async () => {
  const { bridge, tcpServers, terminalCleanupCalls, sftpCleanupCalls, discoveryRemoves } = createBridgeHarness();

  await bridge.setEnabled(true);
  await bridge.cleanup();

  assert.equal(tcpServers[0].stops, 1);
  assert.equal(terminalCleanupCalls.length, 1);
  assert.equal(sftpCleanupCalls.length, 1);
  assert.equal(discoveryRemoves.length, 2);
  assert.equal(bridge.getStatus().state, "disabled");
});

test("public bridge ipc handlers allow main/settings senders and reject others", async () => {
  const { bridge, codexSetupCalls, claudeSetupCalls } = createBridgeHarness();
  const ipcMain = createIpcMainStub();
  bridge.registerHandlers(ipcMain);

  const getStatusHandler = ipcMain.handlers.get("netcatty:public-mcp:get-status");
  const setEnabledHandler = ipcMain.handlers.get("netcatty:public-mcp:set-enabled");
  const getCodexStatusHandler = ipcMain.handlers.get("netcatty:public-mcp:codex:get-status");
  const addCodexHandler = ipcMain.handlers.get("netcatty:public-mcp:codex:add");
  const getClaudeStatusHandler = ipcMain.handlers.get("netcatty:public-mcp:claude:get-status");
  const addClaudeHandler = ipcMain.handlers.get("netcatty:public-mcp:claude:add");

  assert.equal(typeof getStatusHandler, "function");
  assert.equal(typeof setEnabledHandler, "function");
  assert.equal(typeof getCodexStatusHandler, "function");
  assert.equal(typeof addCodexHandler, "function");
  assert.equal(typeof getClaudeStatusHandler, "function");
  assert.equal(typeof addClaudeHandler, "function");

  const unauthorized = await getStatusHandler(makeEvent(99));
  assert.deepEqual(unauthorized, { ok: false, error: "Unauthorized IPC sender" });

  const authorizedStatus = await getStatusHandler(makeEvent(2));
  assert.equal(authorizedStatus.ok, true);
  assert.equal(authorizedStatus.state, "disabled");

  const enabledStatus = await setEnabledHandler(makeEvent(1), { enabled: true });
  assert.equal(enabledStatus.state, "running");

  const codexStatus = await getCodexStatusHandler(makeEvent(2));
  assert.equal(codexStatus.state, "not_configured");

  const codexAddStatus = await addCodexHandler(makeEvent(1));
  assert.equal(codexAddStatus.state, "configured");
  assert.deepEqual(codexSetupCalls, ["getStatus", "addToCodex"]);

  const claudeUnauthorized = await getClaudeStatusHandler(makeEvent(99));
  assert.deepEqual(claudeUnauthorized, { ok: false, error: "Unauthorized IPC sender" });

  const claudeStatus = await getClaudeStatusHandler(makeEvent(2));
  assert.equal(claudeStatus.state, "not_configured");

  const claudeAddStatus = await addClaudeHandler(makeEvent(1));
  assert.equal(claudeAddStatus.state, "configured");
  assert.deepEqual(claudeSetupCalls, ["getStatus", "addToClaude"]);
});

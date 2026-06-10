const test = require("node:test");
const assert = require("node:assert/strict");

const {
  createPublicMcpClaudeSetup,
  classifyClaudePublicMcpStatus,
} = require("./claudeSetup.cjs");

function createSetupHarness(overrides = {}) {
  const calls = [];
  const setup = createPublicMcpClaudeSetup({
    launcherPath: "/launcher/netcatty-public-mcp",
    async getShellEnv() {
      return { PATH: "/usr/bin" };
    },
    resolveCliFromPath(command) {
      return command === "claude" ? "/usr/local/bin/claude" : null;
    },
    prepareCommandForSpawn(command, args) {
      return { command, args, shell: false };
    },
    spawn(command, args, options) {
      calls.push({ command, args, options });
      const behavior = overrides.spawnBehavior || (() => ({
        exitCode: 1,
        stdout: "",
        stderr: 'No MCP server found with name: "netcatty-public"',
      }));
      const result = behavior(command, args, options);
      const listeners = new Map();
      const stdout = {
        on(event, cb) {
          listeners.set(`stdout:${event}`, cb);
        },
      };
      const stderr = {
        on(event, cb) {
          listeners.set(`stderr:${event}`, cb);
        },
      };
      queueMicrotask(() => {
        if (result.stdout) listeners.get("stdout:data")?.(Buffer.from(result.stdout, "utf8"));
        if (result.stderr) listeners.get("stderr:data")?.(Buffer.from(result.stderr, "utf8"));
        if (result.error) {
          listeners.get("error")?.(result.error);
          return;
        }
        listeners.get("close")?.(result.exitCode);
      });
      return {
        stdout,
        stderr,
        once(event, cb) {
          listeners.set(event, cb);
        },
      };
    },
    stripAnsi(value) {
      return value;
    },
    ...overrides,
  });

  return { setup, calls };
}

test("classifyClaudePublicMcpStatus returns not_configured when get reports missing server", () => {
  assert.deepEqual(
    classifyClaudePublicMcpStatus({
      getResult: {
        exitCode: 1,
        stdout: "",
        stderr: 'No MCP server found with name: "netcatty-public"',
      },
      launcherPath: "/Applications/Netcatty Beta/netcatty-public-mcp",
      claudePath: "/usr/local/bin/claude",
    }),
    {
      ok: true,
      state: "not_configured",
      claudePath: "/usr/local/bin/claude",
      launcherPath: "/Applications/Netcatty Beta/netcatty-public-mcp",
      command: 'claude mcp add netcatty-public -- "/Applications/Netcatty Beta/netcatty-public-mcp"',
      existingCommand: null,
      error: null,
    },
  );
});

test("classifyClaudePublicMcpStatus returns configured when get output matches launcher", () => {
  const result = classifyClaudePublicMcpStatus({
    getResult: {
      exitCode: 0,
      stdout: "netcatty-public: /launcher/netcatty-public-mcp - ✓ Connected",
      stderr: "",
    },
    launcherPath: "/launcher/netcatty-public-mcp",
    claudePath: "/usr/local/bin/claude",
  });

  assert.equal(result.state, "configured");
  assert.equal(result.existingCommand, "/launcher/netcatty-public-mcp");
});

test("classifyClaudePublicMcpStatus returns conflict when get output points elsewhere", () => {
  const result = classifyClaudePublicMcpStatus({
    getResult: {
      exitCode: 0,
      stdout: "netcatty-public: node /tmp/other.js - ✓ Connected",
      stderr: "",
    },
    launcherPath: "/launcher/netcatty-public-mcp",
    claudePath: "/usr/local/bin/claude",
  });

  assert.equal(result.state, "conflict");
  assert.equal(result.existingCommand, "node /tmp/other.js");
});

test("getStatus returns claude_not_found when claude is unavailable", async () => {
  const { setup, calls } = createSetupHarness({
    resolveCliFromPath() {
      return null;
    },
  });

  const status = await setup.getStatus();

  assert.equal(status.state, "claude_not_found");
  assert.equal(status.claudePath, null);
  assert.equal(calls.length, 0);
});

test("getStatus runs claude mcp get for configured status", async () => {
  const { setup, calls } = createSetupHarness({
    spawnBehavior() {
      return {
        exitCode: 0,
        stdout: "netcatty-public: /launcher/netcatty-public-mcp - ✓ Connected",
        stderr: "",
      };
    },
  });

  const status = await setup.getStatus();

  assert.equal(status.state, "configured");
  assert.deepEqual(calls[0].args, ["mcp", "get", "netcatty-public"]);
});

test("addToClaude spawns argv-safe claude mcp add command and returns configured status", async () => {
  const phases = [];
  const { setup, calls } = createSetupHarness({
    spawnBehavior(_command, args) {
      phases.push(args);
      if (args[1] === "get") {
        if (phases.filter((phase) => phase[1] === "get").length === 1) {
          return {
            exitCode: 1,
            stdout: "",
            stderr: 'No MCP server found with name: "netcatty-public"',
          };
        }
        return {
          exitCode: 0,
          stdout: "netcatty-public: /launcher/netcatty-public-mcp - ✓ Connected",
          stderr: "",
        };
      }
      if (args[1] === "add") {
        return { exitCode: 0, stdout: "", stderr: "" };
      }
      throw new Error(`Unexpected args: ${args.join(" ")}`);
    },
  });

  const status = await setup.addToClaude();

  assert.equal(status.state, "configured");
  assert.deepEqual(calls[0].args, ["mcp", "get", "netcatty-public"]);
  assert.deepEqual(calls[1].args, ["mcp", "add", "netcatty-public", "--", "/launcher/netcatty-public-mcp"]);
  assert.deepEqual(calls[2].args, ["mcp", "get", "netcatty-public"]);
  assert.equal(calls[1].options.shell, false);
});

test("addToClaude returns conflict without overwriting an existing different entry", async () => {
  const { setup, calls } = createSetupHarness({
    spawnBehavior() {
      return {
        exitCode: 0,
        stdout: "netcatty-public: /different/launcher - ✓ Connected",
        stderr: "",
      };
    },
  });

  const status = await setup.addToClaude();

  assert.equal(status.state, "conflict");
  assert.equal(calls.length, 1);
});

test("addToClaude returns error with stderr summary when add fails", async () => {
  const { setup } = createSetupHarness({
    spawnBehavior(_command, args) {
      if (args[1] === "add") {
        return {
          exitCode: 1,
          stdout: "failed",
          stderr: "permission denied",
        };
      }
      return {
        exitCode: 1,
        stdout: "",
        stderr: 'No MCP server found with name: "netcatty-public"',
      };
    },
  });

  const status = await setup.addToClaude();

  assert.equal(status.state, "error");
  assert.match(status.error, /permission denied/);
});

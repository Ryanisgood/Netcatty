const test = require("node:test");
const assert = require("node:assert/strict");

const {
  createPublicMcpCodexSetup,
  parseCodexMcpList,
  classifyCodexPublicMcpStatus,
} = require("./codexSetup.cjs");

function createSetupHarness(overrides = {}) {
  const calls = [];
  const setup = createPublicMcpCodexSetup({
    launcherPath: "/launcher/netcatty-public-mcp",
    async getShellEnv() {
      return { PATH: "/usr/bin" };
    },
    resolveCliFromPath(command) {
      return command === "codex" ? "/usr/local/bin/codex" : null;
    },
    prepareCommandForSpawn(command, args) {
      return { command, args, shell: false };
    },
    spawn(command, args, options) {
      calls.push({ command, args, options });
      const behavior = overrides.spawnBehavior || (() => ({
        exitCode: 0,
        stdout: "[]",
        stderr: "",
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

test("parseCodexMcpList keeps relevant stdio entries", () => {
  const parsed = parseCodexMcpList(JSON.stringify([
    {
      name: "netcatty-public",
      enabled: true,
      transport: {
        type: "stdio",
        command: "/launcher/netcatty-public-mcp",
        args: [],
      },
    },
    {
      name: "disabled-entry",
      enabled: false,
      transport: {
        type: "stdio",
        command: "/tmp/disabled",
        args: [],
      },
    },
    {
      name: "http-entry",
      enabled: true,
      transport: {
        type: "streamable_http",
        url: "http://127.0.0.1:1234/mcp",
      },
    },
  ]));

  assert.deepEqual(parsed, [
    {
      name: "netcatty-public",
      enabled: true,
      transport: {
        type: "stdio",
        command: "/launcher/netcatty-public-mcp",
        args: [],
      },
    },
    {
      name: "http-entry",
      enabled: true,
      transport: {
        type: "streamable_http",
        url: "http://127.0.0.1:1234/mcp",
      },
    },
  ]);
});

test("classifyCodexPublicMcpStatus returns not_configured when entry is missing", () => {
  assert.deepEqual(
    classifyCodexPublicMcpStatus({
      entries: [],
      launcherPath: "/Applications/Netcatty Beta/netcatty-public-mcp",
      codexPath: "/usr/local/bin/codex",
    }),
    {
      ok: true,
      state: "not_configured",
      codexPath: "/usr/local/bin/codex",
      launcherPath: "/Applications/Netcatty Beta/netcatty-public-mcp",
      command: 'codex mcp add netcatty-public -- "/Applications/Netcatty Beta/netcatty-public-mcp"',
      existingCommand: null,
      error: null,
    },
  );
});

test("classifyCodexPublicMcpStatus returns configured for matching stdio launcher", () => {
  const result = classifyCodexPublicMcpStatus({
    entries: [{
      name: "netcatty-public",
      enabled: true,
      transport: {
        type: "stdio",
        command: "/launcher/netcatty-public-mcp",
        args: [],
      },
    }],
    launcherPath: "/launcher/netcatty-public-mcp",
    codexPath: "/usr/local/bin/codex",
  });

  assert.equal(result.state, "configured");
  assert.equal(result.existingCommand, "/launcher/netcatty-public-mcp");
});

test("classifyCodexPublicMcpStatus returns conflict for mismatched launcher or args", () => {
  const diffCommand = classifyCodexPublicMcpStatus({
    entries: [{
      name: "netcatty-public",
      enabled: true,
      transport: {
        type: "stdio",
        command: "/somewhere/else",
        args: [],
      },
    }],
    launcherPath: "/launcher/netcatty-public-mcp",
    codexPath: "/usr/local/bin/codex",
  });
  assert.equal(diffCommand.state, "conflict");
  assert.equal(diffCommand.existingCommand, "/somewhere/else");

  const diffArgs = classifyCodexPublicMcpStatus({
    entries: [{
      name: "netcatty-public",
      enabled: true,
      transport: {
        type: "stdio",
        command: "/launcher/netcatty-public-mcp",
        args: ["--debug"],
      },
    }],
    launcherPath: "/launcher/netcatty-public-mcp",
    codexPath: "/usr/local/bin/codex",
  });
  assert.equal(diffArgs.state, "conflict");
  assert.equal(diffArgs.existingCommand, "/launcher/netcatty-public-mcp --debug");
});

test("getStatus returns codex_not_found when codex is unavailable", async () => {
  const { setup } = createSetupHarness({
    resolveCliFromPath() {
      return null;
    },
  });

  const status = await setup.getStatus();

  assert.deepEqual(status, {
    ok: true,
    state: "codex_not_found",
    codexPath: null,
    launcherPath: "/launcher/netcatty-public-mcp",
    command: "codex mcp add netcatty-public -- /launcher/netcatty-public-mcp",
    existingCommand: null,
    error: null,
  });
});

test("getStatus returns configured when codex mcp list matches launcher", async () => {
  const { setup, calls } = createSetupHarness({
    spawnBehavior() {
      return {
        exitCode: 0,
        stdout: JSON.stringify([{
          name: "netcatty-public",
          enabled: true,
          transport: {
            type: "stdio",
            command: "/launcher/netcatty-public-mcp",
            args: [],
            env: null,
            env_vars: [],
            cwd: null,
          },
        }]),
        stderr: "",
      };
    },
  });

  const status = await setup.getStatus();

  assert.equal(status.state, "configured");
  assert.deepEqual(calls[0].args, ["mcp", "list", "--json"]);
});

test("getStatus returns error when codex mcp list fails", async () => {
  const { setup } = createSetupHarness({
    spawnBehavior() {
      return {
        exitCode: 1,
        stdout: "",
        stderr: "permission denied",
      };
    },
  });

  const status = await setup.getStatus();

  assert.equal(status.state, "error");
  assert.match(status.error, /permission denied/);
});

test("addToCodex spawns argv-safe codex mcp add command and returns configured status", async () => {
  const phases = [];
  const { setup, calls } = createSetupHarness({
    spawnBehavior(_command, args) {
      phases.push(args);
      if (args[1] === "list") {
        if (phases.filter((phase) => phase[1] === "list").length === 1) {
          return { exitCode: 0, stdout: "[]", stderr: "" };
        }
        return {
          exitCode: 0,
          stdout: JSON.stringify([{
            name: "netcatty-public",
            enabled: true,
            transport: {
              type: "stdio",
              command: "/launcher/netcatty-public-mcp",
              args: [],
              env: null,
              env_vars: [],
              cwd: null,
            },
          }]),
          stderr: "",
        };
      }
      if (args[1] === "add") {
        return { exitCode: 0, stdout: "", stderr: "" };
      }
      throw new Error(`Unexpected args: ${args.join(" ")}`);
    },
  });

  const status = await setup.addToCodex();

  assert.equal(status.state, "configured");
  assert.deepEqual(calls[0].args, ["mcp", "list", "--json"]);
  assert.deepEqual(calls[1].args, ["mcp", "add", "netcatty-public", "--", "/launcher/netcatty-public-mcp"]);
  assert.deepEqual(calls[2].args, ["mcp", "list", "--json"]);
  assert.equal(calls[1].options.shell, false);
  assert.equal(phases.length, 3);
});

test("addToCodex returns conflict without overwriting an existing different entry", async () => {
  const { setup, calls } = createSetupHarness({
    spawnBehavior() {
      return {
        exitCode: 0,
        stdout: JSON.stringify([{
          name: "netcatty-public",
          enabled: true,
          transport: {
            type: "stdio",
            command: "/different/launcher",
            args: [],
            env: null,
            env_vars: [],
            cwd: null,
          },
        }]),
        stderr: "",
      };
    },
  });

  const status = await setup.addToCodex();

  assert.equal(status.state, "conflict");
  assert.equal(calls.length, 1);
});

test("addToCodex returns codex_not_found when codex is missing", async () => {
  const { setup, calls } = createSetupHarness({
    resolveCliFromPath() {
      return null;
    },
  });

  const status = await setup.addToCodex();

  assert.equal(status.state, "codex_not_found");
  assert.equal(calls.length, 0);
});

test("addToCodex returns error with stderr summary when add fails", async () => {
  const { setup } = createSetupHarness({
    spawnBehavior(_command, args) {
      if (args[1] === "add") {
        return {
          exitCode: 1,
          stdout: "failed",
          stderr: "already exists",
        };
      }
      return {
        exitCode: 0,
        stdout: "[]",
        stderr: "",
      };
    },
  });

  const status = await setup.addToCodex();

  assert.equal(status.state, "error");
  assert.match(status.error, /already exists/);
});

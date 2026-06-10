const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

function withEnv(name, value, fn) {
  const previous = process.env[name];
  if (value == null) {
    delete process.env[name];
  } else {
    process.env[name] = value;
  }
  try {
    return fn();
  } finally {
    if (previous == null) delete process.env[name];
    else process.env[name] = previous;
  }
}

function loadPublicDiscoveryPathModule(envValue) {
  const modulePath = require.resolve("../../cli/publicMcpDiscoveryPath.cjs");
  return withEnv("NETCATTY_PUBLIC_MCP_DISCOVERY_FILE", envValue, () => {
    delete require.cache[modulePath];
    return require(modulePath);
  });
}

test("public discovery uses env override when present", () => {
  withEnv("NETCATTY_PUBLIC_MCP_DISCOVERY_FILE", "/tmp/netcatty-public.json", () => {
    const helper = loadPublicDiscoveryPathModule("/tmp/netcatty-public.json");
    assert.equal(helper.PUBLIC_MCP_DISCOVERY_ENV_VAR, "NETCATTY_PUBLIC_MCP_DISCOVERY_FILE");
    assert.equal(helper.getPublicMcpDiscoveryFilePath(), "/tmp/netcatty-public.json");
    assert.equal(helper.getPublicMcpStateDir(), "/tmp");
  });
});

test("public discovery defaults under userData/public-mcp/discovery.json", () => {
  const helper = loadPublicDiscoveryPathModule(null);
  assert.equal(
    helper.getPublicMcpDiscoveryFilePath({ userDataDir: "/tmp/netcatty-user-data" }),
    path.join("/tmp/netcatty-user-data", "public-mcp", "discovery.json"),
  );
  assert.equal(
    helper.getPublicMcpStateDir({ userDataDir: "/tmp/netcatty-user-data" }),
    path.join("/tmp/netcatty-user-data", "public-mcp"),
  );
});

test("main process and launcher helper resolve the same explicit userData path", () => {
  const helper = loadPublicDiscoveryPathModule(null);
  const userDataDir = path.join(os.tmpdir(), "Netcatty");
  assert.equal(
    helper.getPublicMcpDiscoveryFilePath({ userDataDir }),
    path.join(helper.getPublicMcpStateDir({ userDataDir }), "discovery.json"),
  );
});

test("public discovery default app data dir prefers productName when present", () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "netcatty-public-mcp-package-json-"));
  const packageJsonPath = path.join(tempDir, "package.json");

  try {
    fs.writeFileSync(packageJsonPath, JSON.stringify({
      name: "netcatty",
      productName: "Netcatty",
    }), "utf8");

    const helper = loadPublicDiscoveryPathModule(null);
    assert.equal(
      helper.getDefaultAppDataDirName({ packageJsonPaths: [packageJsonPath] }),
      "Netcatty",
    );
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test("public launcher path resolves to unpacked launcher", () => {
  const helper = loadPublicDiscoveryPathModule(null);
  const launcherPath = helper.getPublicMcpLauncherPath();
  if (process.platform === "win32") {
    assert.match(launcherPath, /netcatty-public-mcp\.cmd$/);
  } else {
    assert.match(launcherPath, /netcatty-public-mcp$/);
  }
  assert.doesNotMatch(launcherPath, /app\.asar[\\/]/);
});

test("writePublicDiscovery writes versioned token payload and removePublicDiscovery cleans it up", () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "netcatty-public-mcp-discovery-"));
  const filePath = path.join(tempDir, "discovery.json");
  const discoveryModulePath = require.resolve("./discovery.cjs");
  delete require.cache[discoveryModulePath];
  const {
    buildPublicDiscoveryPayload,
    writePublicDiscovery,
    removePublicDiscovery,
  } = require("./discovery.cjs");

  try {
    const payload = buildPublicDiscoveryPayload({
      host: "127.0.0.1",
      port: 49152,
      token: "tok",
      pid: 123,
    });
    assert.equal(payload.version, 1);
    assert.equal(payload.port, 49152);
    assert.equal(payload.token, "tok");
    assert.equal(payload.pid, 123);
    assert.equal(payload.host, "127.0.0.1");
    assert.match(payload.updatedAt, /^\d{4}-\d{2}-\d{2}T/);

    writePublicDiscovery(filePath, {
      host: "127.0.0.1",
      port: 49152,
      token: "tok",
      pid: 123,
    });

    const written = JSON.parse(fs.readFileSync(filePath, "utf8"));
    assert.equal(written.version, 1);
    assert.equal(written.port, 49152);
    assert.equal(written.token, "tok");
    assert.equal(written.pid, 123);
    assert.equal(written.host, "127.0.0.1");
    assert.match(written.updatedAt, /^\d{4}-\d{2}-\d{2}T/);

    removePublicDiscovery(filePath);
    assert.equal(fs.existsSync(filePath), false);
  } finally {
    delete require.cache[discoveryModulePath];
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

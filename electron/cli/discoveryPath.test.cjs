const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

function loadDiscoveryPathModule() {
  const modulePath = require.resolve("./discoveryPath.cjs");
  delete require.cache[modulePath];
  return require(modulePath);
}

test("tool-cli discovery default app data dir prefers productName when present", () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "netcatty-tool-cli-package-json-"));
  const packageJsonPath = path.join(tempDir, "package.json");

  try {
    fs.writeFileSync(packageJsonPath, JSON.stringify({
      name: "netcatty",
      productName: "Netcatty",
    }), "utf8");

    const helper = loadDiscoveryPathModule();
    assert.equal(
      helper.getDefaultAppDataDirName({ packageJsonPaths: [packageJsonPath] }),
      "Netcatty",
    );
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

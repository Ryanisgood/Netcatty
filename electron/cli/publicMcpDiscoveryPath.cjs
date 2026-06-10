"use strict";

const os = require("node:os");
const path = require("node:path");

const PUBLIC_MCP_STATE_DIR_NAME = "public-mcp";
const PUBLIC_MCP_DISCOVERY_ENV_VAR = "NETCATTY_PUBLIC_MCP_DISCOVERY_FILE";
const FALLBACK_APP_DATA_DIR_NAME = "netcatty";

function toUnpackedAsarPath(filePath) {
  return filePath.replace(/app\.asar([\\/])/, "app.asar.unpacked$1");
}

function getDefaultAppDataDirName(options = {}) {
  const packageJsonPaths = Array.isArray(options.packageJsonPaths) && options.packageJsonPaths.length > 0
    ? options.packageJsonPaths
    : [
    process.resourcesPath ? path.join(process.resourcesPath, "app.asar", "package.json") : null,
    path.resolve(__dirname, "../../package.json"),
    path.join(process.cwd(), "package.json"),
    ].filter(Boolean);

  for (const packageJsonPath of packageJsonPaths) {
    try {
      const packageJson = require(packageJsonPath);
      if (typeof packageJson?.productName === "string" && packageJson.productName) {
        return packageJson.productName;
      }
      if (typeof packageJson?.name === "string" && packageJson.name) {
        return packageJson.name;
      }
    } catch {
      // Try next candidate.
    }
  }

  return FALLBACK_APP_DATA_DIR_NAME;
}

function getDefaultUserDataDir() {
  const appDataDirName = getDefaultAppDataDirName();
  if (process.platform === "darwin") {
    return path.join(os.homedir(), "Library", "Application Support", appDataDirName);
  }
  if (process.platform === "win32") {
    const appData = process.env.APPDATA || path.join(os.homedir(), "AppData", "Roaming");
    return path.join(appData, appDataDirName);
  }
  const xdgConfigHome = process.env.XDG_CONFIG_HOME || path.join(os.homedir(), ".config");
  return path.join(xdgConfigHome, appDataDirName);
}

function getConfiguredDiscoveryFilePath() {
  return process.env[PUBLIC_MCP_DISCOVERY_ENV_VAR] || null;
}

function getPublicMcpStateDir(options = {}) {
  const discoveryFilePath = getConfiguredDiscoveryFilePath();
  if (discoveryFilePath) {
    return path.dirname(discoveryFilePath);
  }
  const userDataDir = typeof options.userDataDir === "string" && options.userDataDir
    ? options.userDataDir
    : getDefaultUserDataDir();
  return path.join(userDataDir, PUBLIC_MCP_STATE_DIR_NAME);
}

function getPublicMcpDiscoveryFilePath(options = {}) {
  const discoveryFilePath = getConfiguredDiscoveryFilePath();
  if (discoveryFilePath) {
    return discoveryFilePath;
  }
  return path.join(getPublicMcpStateDir(options), "discovery.json");
}

function getPublicMcpLauncherPath() {
  const fileName = process.platform === "win32"
    ? "netcatty-public-mcp.cmd"
    : "netcatty-public-mcp";
  return toUnpackedAsarPath(path.join(__dirname, fileName));
}

module.exports = {
  getDefaultAppDataDirName,
  getPublicMcpStateDir,
  getPublicMcpDiscoveryFilePath,
  getPublicMcpLauncherPath,
  PUBLIC_MCP_DISCOVERY_ENV_VAR,
};

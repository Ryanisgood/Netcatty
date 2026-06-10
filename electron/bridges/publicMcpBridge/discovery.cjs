"use strict";

const fs = require("node:fs");
const path = require("node:path");

function buildPublicDiscoveryPayload({ host = "127.0.0.1", port, token, pid }) {
  return {
    version: 1,
    port,
    token,
    pid,
    host,
    updatedAt: new Date().toISOString(),
  };
}

function writePublicDiscovery(filePath, options) {
  const payload = buildPublicDiscoveryPayload(options);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(payload, null, 2)}\n`, { mode: 0o600 });
  return payload;
}

function removePublicDiscovery(filePath) {
  fs.rmSync(filePath, { force: true });
}

module.exports = {
  buildPublicDiscoveryPayload,
  writePublicDiscovery,
  removePublicDiscovery,
};

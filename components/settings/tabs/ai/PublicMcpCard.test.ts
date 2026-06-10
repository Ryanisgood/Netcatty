import test from "node:test";
import assert from "node:assert/strict";

import {
  buildClaudeSnippet,
  buildCodexTomlSnippet,
  formatClaudeAddCommand,
  formatCodexAddCommand,
  getVisiblePublicMcpSessionCount,
  PUBLIC_MCP_I18N_KEYS,
  shouldPollPublicMcpStatus,
} from "./PublicMcpCard.tsx";
import type { PublicMcpStatus } from "./types.ts";
import en from "../../../../application/i18n/locales/en.ts";
import ru from "../../../../application/i18n/locales/ru.ts";
import zhCN from "../../../../application/i18n/locales/zh-CN.ts";

test("formatCodexAddCommand quotes launcher paths with spaces", () => {
  assert.equal(
    formatCodexAddCommand("/Applications/Netcatty Beta/netcatty-public-mcp"),
    'codex mcp add netcatty-public -- "/Applications/Netcatty Beta/netcatty-public-mcp"',
  );
});

test("formatClaudeAddCommand quotes launcher paths with spaces", () => {
  assert.equal(
    formatClaudeAddCommand("/Applications/Netcatty Beta/netcatty-public-mcp"),
    'claude mcp add netcatty-public -- "/Applications/Netcatty Beta/netcatty-public-mcp"',
  );
});

test("buildCodexTomlSnippet escapes backslashes and quotes in launcher path", () => {
  assert.equal(
    buildCodexTomlSnippet('C:\\Program Files\\Netcatty\\"Beta"\\netcatty-public-mcp.cmd'),
    '[mcp_servers.netcatty-public]\n'
      + 'command = "C:\\\\Program Files\\\\Netcatty\\\\\\"Beta\\"\\\\netcatty-public-mcp.cmd"\n'
      + "args = []",
  );
});

test("buildClaudeSnippet preserves launcher path via JSON escaping", () => {
  assert.equal(
    buildClaudeSnippet('C:\\Program Files\\Netcatty\\netcatty-public-mcp.cmd'),
    JSON.stringify({
      mcpServers: {
        "netcatty-public": {
          command: 'C:\\Program Files\\Netcatty\\netcatty-public-mcp.cmd',
          args: [],
        },
      },
    }, null, 2),
  );
});

test("Public MCP settings strings are localized in every supported language", () => {
  const keys = [
    ...PUBLIC_MCP_I18N_KEYS,
    "topTabs.publicMcp.enable",
    "topTabs.publicMcp.disable",
  ];
  for (const [locale, messages] of Object.entries({ en, "zh-CN": zhCN, ru })) {
    for (const key of keys) {
      assert.equal(
        typeof messages[key],
        "string",
        `${locale} is missing ${key}`,
      );
      assert.notEqual(messages[key], "", `${locale} has empty ${key}`);
    }
  }
});

test("Public MCP status polling stays active while enabled", () => {
  assert.equal(shouldPollPublicMcpStatus(false), false);
  assert.equal(shouldPollPublicMcpStatus(true), true);
});

test("Public MCP visible session count resets when disabled", () => {
  const runningStatus: PublicMcpStatus = {
    ok: true,
    enabled: true,
    state: "running",
    host: "127.0.0.1",
    port: 62801,
    discoveryPath: "/tmp/netcatty/discovery.json",
    launcherPath: "/Applications/Netcatty.app/Contents/Resources/netcatty-public-mcp",
    exposedSessionCount: 1,
    error: null,
  };

  assert.equal(getVisiblePublicMcpSessionCount(runningStatus, true), 1);
  assert.equal(getVisiblePublicMcpSessionCount(runningStatus, false), 0);
});

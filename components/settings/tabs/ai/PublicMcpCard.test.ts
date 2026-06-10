import test from "node:test";
import assert from "node:assert/strict";

import {
  buildClaudeSnippet,
  buildCodexTomlSnippet,
  formatClaudeAddCommand,
  formatCodexAddCommand,
  PUBLIC_MCP_I18N_KEYS,
} from "./PublicMcpCard.tsx";
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
  for (const [locale, messages] of Object.entries({ en, "zh-CN": zhCN, ru })) {
    for (const key of PUBLIC_MCP_I18N_KEYS) {
      assert.equal(
        typeof messages[key],
        "string",
        `${locale} is missing ${key}`,
      );
      assert.notEqual(messages[key], "", `${locale} has empty ${key}`);
    }
  }
});

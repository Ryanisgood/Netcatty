import test from "node:test";
import assert from "node:assert/strict";

import {
  buildClaudeSnippet,
  buildCodexTomlSnippet,
  formatCodexAddCommand,
} from "./PublicMcpCard.tsx";

test("formatCodexAddCommand quotes launcher paths with spaces", () => {
  assert.equal(
    formatCodexAddCommand("/Applications/Netcatty Beta/netcatty-public-mcp"),
    'codex mcp add netcatty-public -- "/Applications/Netcatty Beta/netcatty-public-mcp"',
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

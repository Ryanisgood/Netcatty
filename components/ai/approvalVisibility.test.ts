import assert from "node:assert/strict";
import test from "node:test";

import {
  isPublicMcpApproval,
  shouldShowStandaloneApproval,
  shouldShowPublicMcpApproval,
} from "./approvalVisibility";

test("identifies Public MCP approvals by public tool namespace", () => {
  assert.equal(isPublicMcpApproval({ toolName: "public/terminalExecute" }), true);
  assert.equal(isPublicMcpApproval({ toolName: "public/sftp/writeFile" }), true);
  assert.equal(isPublicMcpApproval({ toolName: "netcatty/exec" }), false);
  assert.equal(isPublicMcpApproval({ toolName: "command_execution" }), false);
});

test("shows Public MCP approvals in the top-level approval UI", () => {
  assert.equal(
    shouldShowPublicMcpApproval("mcp_approval_1", { toolName: "public/sftp/writeFile" }),
    true,
  );
  assert.equal(
    shouldShowPublicMcpApproval("mcp_approval_1", { toolName: "netcatty/exec" }),
    false,
  );
  assert.equal(
    shouldShowPublicMcpApproval("sdk_tool_1", { toolName: "public/sftp/writeFile" }),
    false,
  );
});

test("shows global MCP approvals even when a chat session is active", () => {
  assert.equal(shouldShowStandaloneApproval("mcp_approval_1", undefined, "chat-1"), true);
  assert.equal(shouldShowStandaloneApproval("mcp_approval_1", null, "chat-1"), true);
});

test("filters chat-scoped MCP approvals by active chat session", () => {
  assert.equal(shouldShowStandaloneApproval("mcp_approval_1", "chat-1", "chat-1"), true);
  assert.equal(shouldShowStandaloneApproval("mcp_approval_1", "chat-2", "chat-1"), false);
});

test("hides Public MCP approvals from the chat-scoped approval list", () => {
  assert.equal(
    shouldShowStandaloneApproval("mcp_approval_1", undefined, "chat-1", {
      toolName: "public/terminalExecute",
    }),
    false,
  );
});

test("hides non-MCP standalone approvals", () => {
  assert.equal(shouldShowStandaloneApproval("sdk_tool_1", undefined, "chat-1"), false);
});

import assert from "node:assert/strict";
import test from "node:test";

import { shouldShowStandaloneApproval } from "./approvalVisibility";

test("shows global MCP approvals even when a chat session is active", () => {
  assert.equal(shouldShowStandaloneApproval("mcp_approval_1", undefined, "chat-1"), true);
  assert.equal(shouldShowStandaloneApproval("mcp_approval_1", null, "chat-1"), true);
});

test("filters chat-scoped MCP approvals by active chat session", () => {
  assert.equal(shouldShowStandaloneApproval("mcp_approval_1", "chat-1", "chat-1"), true);
  assert.equal(shouldShowStandaloneApproval("mcp_approval_1", "chat-2", "chat-1"), false);
});

test("hides non-MCP standalone approvals", () => {
  assert.equal(shouldShowStandaloneApproval("sdk_tool_1", undefined, "chat-1"), false);
});

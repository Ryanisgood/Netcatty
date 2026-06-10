import test from "node:test";
import assert from "node:assert/strict";

import {
  normalizePublicMcpMode,
  shouldStartPublicMcpOnStartup,
} from "./usePublicMcpToggleState.ts";

test("normalizePublicMcpMode treats only persistent as persistent", () => {
  assert.equal(normalizePublicMcpMode("persistent"), "persistent");
  assert.equal(normalizePublicMcpMode("temporary"), "temporary");
  assert.equal(normalizePublicMcpMode("unknown"), "temporary");
  assert.equal(normalizePublicMcpMode(null), "temporary");
});

test("shouldStartPublicMcpOnStartup only starts persistent enabled mode", () => {
  assert.equal(shouldStartPublicMcpOnStartup({ enabled: true, mode: "persistent" }), true);
  assert.equal(shouldStartPublicMcpOnStartup({ enabled: false, mode: "persistent" }), false);
  assert.equal(shouldStartPublicMcpOnStartup({ enabled: true, mode: "temporary" }), false);
  assert.equal(shouldStartPublicMcpOnStartup({ enabled: false, mode: "temporary" }), false);
});

import test from "node:test";
import assert from "node:assert/strict";

import {
  createPublicMcpStartupSyncPlan,
  normalizePublicMcpMode,
  shouldStartPublicMcpOnStartup,
  syncPublicMcpConfig,
  syncPublicMcpStartupState,
} from "./usePublicMcpToggleState.ts";
import {
  STORAGE_KEY_AI_PUBLIC_MCP_ENABLED,
  STORAGE_KEY_AI_PUBLIC_MCP_IDLE_TIMEOUT_MINUTES,
  STORAGE_KEY_AI_PUBLIC_MCP_MODE,
} from "../../infrastructure/config/storageKeys.ts";

function withLocalStorage(
  entries: Record<string, string>,
  run: (values: Map<string, string>) => void,
) {
  const originalLocalStorage = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
  const values = new Map(Object.entries(entries));
  const fakeLocalStorage = {
    get length() {
      return values.size;
    },
    clear: () => values.clear(),
    getItem: (key: string) => values.get(key) ?? null,
    key: (index: number) => Array.from(values.keys())[index] ?? null,
    removeItem: (key: string) => {
      values.delete(key);
    },
    setItem: (key: string, value: string) => {
      values.set(key, value);
    },
  } as Storage;

  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: fakeLocalStorage,
  });

  try {
    run(values);
  } finally {
    if (originalLocalStorage) {
      Object.defineProperty(globalThis, "localStorage", originalLocalStorage);
    } else {
      delete (globalThis as typeof globalThis & { localStorage?: Storage }).localStorage;
    }
  }
}

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

test("createPublicMcpStartupSyncPlan clears temporary enabled state only during startup", () => {
  assert.deepEqual(
    createPublicMcpStartupSyncPlan({
      enabled: true,
      mode: "temporary",
      idleTimeoutMinutes: 5,
    }),
    {
      config: { mode: "temporary", idleTimeoutMinutes: 5 },
      runtimeEnabled: false,
      storedEnabled: false,
      shouldPersistStoredEnabled: true,
    },
  );
});

test("createPublicMcpStartupSyncPlan starts persistent enabled state without rewriting storage", () => {
  assert.deepEqual(
    createPublicMcpStartupSyncPlan({
      enabled: true,
      mode: "persistent",
      idleTimeoutMinutes: 15,
    }),
    {
      config: { mode: "persistent", idleTimeoutMinutes: 15 },
      runtimeEnabled: true,
      storedEnabled: true,
      shouldPersistStoredEnabled: false,
    },
  );
});

test("syncPublicMcpStartupState clears stale temporary enabled storage and runtime", () => {
  withLocalStorage({
    [STORAGE_KEY_AI_PUBLIC_MCP_ENABLED]: "true",
    [STORAGE_KEY_AI_PUBLIC_MCP_MODE]: "temporary",
    [STORAGE_KEY_AI_PUBLIC_MCP_IDLE_TIMEOUT_MINUTES]: "5",
  }, (values) => {
    const calls: Array<{ type: "config" | "enabled"; value: unknown }> = [];

    syncPublicMcpStartupState({
      publicMcpSetConfig: (config) => calls.push({ type: "config", value: config }),
      publicMcpSetEnabled: (enabled) => calls.push({ type: "enabled", value: enabled }),
    });

    assert.deepEqual(calls, [
      { type: "config", value: { mode: "temporary", idleTimeoutMinutes: 5 } },
      { type: "enabled", value: false },
    ]);
    assert.equal(values.get(STORAGE_KEY_AI_PUBLIC_MCP_ENABLED), "false");
  });
});

test("syncPublicMcpConfig does not change temporary enabled runtime during normal mount", () => {
  withLocalStorage({
    [STORAGE_KEY_AI_PUBLIC_MCP_ENABLED]: "true",
    [STORAGE_KEY_AI_PUBLIC_MCP_MODE]: "temporary",
    [STORAGE_KEY_AI_PUBLIC_MCP_IDLE_TIMEOUT_MINUTES]: "5",
  }, (values) => {
    const calls: Array<{ type: "config" | "enabled"; value: unknown }> = [];

    syncPublicMcpConfig({
      publicMcpSetConfig: (config) => calls.push({ type: "config", value: config }),
      publicMcpSetEnabled: (enabled) => calls.push({ type: "enabled", value: enabled }),
    });

    assert.deepEqual(calls, [
      { type: "config", value: { mode: "temporary", idleTimeoutMinutes: 5 } },
    ]);
    assert.equal(values.get(STORAGE_KEY_AI_PUBLIC_MCP_ENABLED), "true");
  });
});

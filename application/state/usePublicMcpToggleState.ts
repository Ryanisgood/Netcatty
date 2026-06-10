import { useCallback, useEffect, useState } from 'react';
import {
  STORAGE_KEY_AI_PUBLIC_MCP_ENABLED,
  STORAGE_KEY_AI_PUBLIC_MCP_IDLE_TIMEOUT_MINUTES,
  STORAGE_KEY_AI_PUBLIC_MCP_MODE,
} from '../../infrastructure/config/storageKeys';
import { localStorageAdapter } from '../../infrastructure/persistence/localStorageAdapter';
import { netcattyBridge } from '../../infrastructure/services/netcattyBridge';
import { AI_STATE_CHANGED_EVENT, emitAIStateChanged } from './aiStateEvents';

export type PublicMcpMode = 'temporary' | 'persistent';

const DEFAULT_PUBLIC_MCP_IDLE_TIMEOUT_MINUTES = 10;
const MIN_PUBLIC_MCP_IDLE_TIMEOUT_MINUTES = 1;
const MAX_PUBLIC_MCP_IDLE_TIMEOUT_MINUTES = 24 * 60;

type PublicMcpConfig = {
  mode: PublicMcpMode;
  idleTimeoutMinutes: number;
};

type PublicMcpBridge = {
  publicMcpSetConfig?: (config: PublicMcpConfig) => Promise<unknown> | unknown;
  publicMcpSetEnabled?: (enabled: boolean) => Promise<unknown> | unknown;
};

export type PublicMcpStartupSyncPlan = {
  config: PublicMcpConfig;
  runtimeEnabled: boolean;
  storedEnabled: boolean;
  shouldPersistStoredEnabled: boolean;
};

export function normalizePublicMcpMode(value: string | null): PublicMcpMode {
  return value === 'persistent' ? 'persistent' : 'temporary';
}

export function normalizePublicMcpIdleTimeoutMinutes(value: number | null): number {
  if (!Number.isFinite(value)) return DEFAULT_PUBLIC_MCP_IDLE_TIMEOUT_MINUTES;
  return Math.min(
    MAX_PUBLIC_MCP_IDLE_TIMEOUT_MINUTES,
    Math.max(MIN_PUBLIC_MCP_IDLE_TIMEOUT_MINUTES, Math.round(value ?? DEFAULT_PUBLIC_MCP_IDLE_TIMEOUT_MINUTES)),
  );
}

export function readPublicMcpStoredEnabled(): boolean {
  return localStorageAdapter.readBoolean(STORAGE_KEY_AI_PUBLIC_MCP_ENABLED) ?? false;
}

export function readPublicMcpMode(): PublicMcpMode {
  return normalizePublicMcpMode(localStorageAdapter.readString(STORAGE_KEY_AI_PUBLIC_MCP_MODE));
}

export function readPublicMcpIdleTimeoutMinutes(): number {
  return normalizePublicMcpIdleTimeoutMinutes(
    localStorageAdapter.readNumber(STORAGE_KEY_AI_PUBLIC_MCP_IDLE_TIMEOUT_MINUTES),
  );
}

export function shouldStartPublicMcpOnStartup({
  enabled,
  mode,
}: {
  enabled: boolean;
  mode: PublicMcpMode;
}): boolean {
  return mode === 'persistent' && enabled;
}

export function readPublicMcpStartupEnabled(): boolean {
  return shouldStartPublicMcpOnStartup({
    enabled: readPublicMcpStoredEnabled(),
    mode: readPublicMcpMode(),
  });
}

export function createPublicMcpStartupSyncPlan({
  enabled,
  mode,
  idleTimeoutMinutes,
}: {
  enabled: boolean;
  mode: PublicMcpMode;
  idleTimeoutMinutes: number;
}): PublicMcpStartupSyncPlan {
  const runtimeEnabled = shouldStartPublicMcpOnStartup({ enabled, mode });
  const storedEnabled = runtimeEnabled;
  return {
    config: {
      mode,
      idleTimeoutMinutes,
    },
    runtimeEnabled,
    storedEnabled,
    shouldPersistStoredEnabled: storedEnabled !== enabled,
  };
}

export function readPublicMcpStartupSyncPlan(): PublicMcpStartupSyncPlan {
  return createPublicMcpStartupSyncPlan({
    enabled: readPublicMcpStoredEnabled(),
    mode: readPublicMcpMode(),
    idleTimeoutMinutes: readPublicMcpIdleTimeoutMinutes(),
  });
}

export function syncPublicMcpConfig(bridge: PublicMcpBridge | undefined = netcattyBridge.get()): void {
  void bridge?.publicMcpSetConfig?.({
    mode: readPublicMcpMode(),
    idleTimeoutMinutes: readPublicMcpIdleTimeoutMinutes(),
  });
}

export function syncPublicMcpStartupState(
  bridge: PublicMcpBridge | undefined = netcattyBridge.get(),
): PublicMcpStartupSyncPlan {
  const plan = readPublicMcpStartupSyncPlan();
  void bridge?.publicMcpSetConfig?.(plan.config);
  if (plan.shouldPersistStoredEnabled) {
    localStorageAdapter.writeBoolean(STORAGE_KEY_AI_PUBLIC_MCP_ENABLED, plan.storedEnabled);
    emitAIStateChanged(STORAGE_KEY_AI_PUBLIC_MCP_ENABLED);
  }
  void bridge?.publicMcpSetEnabled?.(plan.runtimeEnabled);
  return plan;
}

export function usePublicMcpToggleState() {
  const [enabled, setEnabledRaw] = useState<boolean>(() => readPublicMcpStartupEnabled());

  const persistEnabled = useCallback((nextEnabled: boolean) => {
    setEnabledRaw(nextEnabled);
    localStorageAdapter.writeBoolean(STORAGE_KEY_AI_PUBLIC_MCP_ENABLED, nextEnabled);
    emitAIStateChanged(STORAGE_KEY_AI_PUBLIC_MCP_ENABLED);
  }, []);

  const setEnabled = useCallback((nextEnabled: boolean) => {
    persistEnabled(nextEnabled);
    void netcattyBridge.get()?.publicMcpSetEnabled?.(nextEnabled);
  }, [persistEnabled]);

  useEffect(() => {
    const syncFromStorage = () => {
      const nextEnabled = readPublicMcpStoredEnabled();
      setEnabledRaw(nextEnabled);
    };

    const handleStorage = (event: StorageEvent) => {
      if (event.key !== STORAGE_KEY_AI_PUBLIC_MCP_ENABLED) return;
      syncFromStorage();
    };
    const handleLocalStateChanged = (event: Event) => {
      const key = (event as CustomEvent<{ key?: string }>).detail?.key;
      if (key !== STORAGE_KEY_AI_PUBLIC_MCP_ENABLED) return;
      syncFromStorage();
    };

    window.addEventListener('storage', handleStorage);
    window.addEventListener(AI_STATE_CHANGED_EVENT, handleLocalStateChanged);
    return () => {
      window.removeEventListener('storage', handleStorage);
      window.removeEventListener(AI_STATE_CHANGED_EVENT, handleLocalStateChanged);
    };
  }, [persistEnabled]);

  useEffect(() => {
    if (!enabled) return;
    const syncRuntimeStatus = async () => {
      try {
        const status = await netcattyBridge.get()?.publicMcpGetStatus?.();
        if (status?.ok && !status.enabled) {
          persistEnabled(false);
        }
      } catch {
        // Keep the user's stored switch state during transient bridge errors.
      }
    };

    const intervalId = window.setInterval(() => {
      void syncRuntimeStatus();
    }, 30000);
    void syncRuntimeStatus();
    return () => window.clearInterval(intervalId);
  }, [enabled, persistEnabled]);

  return { enabled, setEnabled };
}

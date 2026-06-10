import { useCallback, useEffect, useState } from 'react';
import { STORAGE_KEY_AI_PUBLIC_MCP_ENABLED } from '../../infrastructure/config/storageKeys';
import { localStorageAdapter } from '../../infrastructure/persistence/localStorageAdapter';
import { netcattyBridge } from '../../infrastructure/services/netcattyBridge';
import { AI_STATE_CHANGED_EVENT, emitAIStateChanged } from './aiStateEvents';

function readPublicMcpEnabled(): boolean {
  return localStorageAdapter.readBoolean(STORAGE_KEY_AI_PUBLIC_MCP_ENABLED) ?? false;
}

export function usePublicMcpToggleState() {
  const [enabled, setEnabledRaw] = useState<boolean>(() => readPublicMcpEnabled());

  const setEnabled = useCallback((nextEnabled: boolean) => {
    setEnabledRaw(nextEnabled);
    localStorageAdapter.writeBoolean(STORAGE_KEY_AI_PUBLIC_MCP_ENABLED, nextEnabled);
    emitAIStateChanged(STORAGE_KEY_AI_PUBLIC_MCP_ENABLED);
    void netcattyBridge.get()?.publicMcpSetEnabled?.(nextEnabled);
  }, []);

  useEffect(() => {
    const syncFromStorage = () => {
      const nextEnabled = readPublicMcpEnabled();
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
  }, []);

  return { enabled, setEnabled };
}

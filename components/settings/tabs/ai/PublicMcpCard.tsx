import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Copy, RefreshCw } from "lucide-react";
import { useI18n } from "../../../../application/i18n/I18nProvider";
import { cn } from "../../../../lib/utils";
import { Button } from "../../../ui/button";
import { Toggle } from "../../../settings/settings-ui";
import type { PublicMcpCodexStatus, PublicMcpStatus } from "./types";
import { getBridge } from "./types";

function getBridgeStatusView(status: PublicMcpStatus | null, enabled: boolean) {
  if (!status || !status.ok) {
    return {
      label: enabled ? "Unavailable" : "Disabled",
      className: enabled ? "text-amber-500" : "text-muted-foreground",
    };
  }

  if (status.state === "running") {
    return {
      label: "Running",
      className: "text-emerald-500",
    };
  }
  if (status.state === "starting") {
    return {
      label: "Starting",
      className: "text-amber-500",
    };
  }
  if (status.state === "error") {
    return {
      label: "Error",
      className: "text-destructive",
    };
  }
  if (status.state === "unavailable") {
    return {
      label: "Unavailable",
      className: "text-amber-500",
    };
  }
  return {
    label: "Disabled",
    className: "text-muted-foreground",
  };
}

function getCodexStatusView(status: PublicMcpCodexStatus | null) {
  switch (status?.state) {
    case "configured":
      return { label: "Configured", className: "text-emerald-500" };
    case "not_configured":
      return { label: "Not configured", className: "text-muted-foreground" };
    case "codex_not_found":
      return { label: "Codex not found", className: "text-amber-500" };
    case "conflict":
      return { label: "Conflict", className: "text-destructive" };
    case "error":
      return { label: "Error", className: "text-destructive" };
    default:
      return { label: "Checking", className: "text-muted-foreground" };
  }
}

function escapeTomlBasicString(value: string) {
  return value
    .replaceAll("\\", "\\\\")
    .replaceAll("\"", "\\\"");
}

function quoteShellArg(value: string) {
  if (!value) return '""';
  if (!/[\s"'\\]/.test(value)) return value;
  return `"${value.replaceAll("\\", "\\\\").replaceAll("\"", "\\\"")}"`;
}

export function formatCodexAddCommand(launcherPath: string) {
  return `codex mcp add netcatty-public -- ${quoteShellArg(launcherPath)}`;
}

export function buildCodexTomlSnippet(launcherPath: string) {
  return `[mcp_servers.netcatty-public]
command = "${escapeTomlBasicString(launcherPath)}"
args = []`;
}

export function buildClaudeSnippet(launcherPath: string) {
  return JSON.stringify({
    mcpServers: {
      "netcatty-public": {
        command: launcherPath,
        args: [],
      },
    },
  }, null, 2);
}

export const PublicMcpCard: React.FC<{
  enabled: boolean;
  setEnabled: (enabled: boolean) => void;
}> = ({ enabled, setEnabled }) => {
  const { t } = useI18n();
  const [status, setStatus] = useState<PublicMcpStatus | null>(null);
  const [codexStatus, setCodexStatus] = useState<PublicMcpCodexStatus | null>(null);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [isAddingCodex, setIsAddingCodex] = useState(false);
  const [copied, setCopied] = useState<string | null>(null);
  const [actionMessage, setActionMessage] = useState<{ tone: "error" | "warning" | "success"; text: string } | null>(null);

  const refreshStatus = useCallback(async (options?: { quiet?: boolean }) => {
    const bridge = getBridge();
    if (!bridge?.publicMcpGetStatus || !bridge?.publicMcpCodexGetStatus) {
      setStatus({
        ok: false,
        enabled,
        state: "unavailable",
        host: "127.0.0.1",
        port: null,
        discoveryPath: null,
        launcherPath: null,
        exposedSessionCount: 0,
        error: "Public MCP bridge unavailable",
      });
      setCodexStatus({
        ok: true,
        state: "error",
        codexPath: null,
        launcherPath: null,
        command: "",
        existingCommand: null,
        error: "Public MCP bridge unavailable",
      });
      return;
    }

    if (!options?.quiet) {
      setIsRefreshing(true);
    }

    try {
      const [nextStatus, nextCodexStatus] = await Promise.all([
        bridge.publicMcpGetStatus(),
        bridge.publicMcpCodexGetStatus(),
      ]);
      setStatus(nextStatus);
      setCodexStatus(nextCodexStatus);
    } finally {
      if (!options?.quiet) {
        setIsRefreshing(false);
      }
    }
  }, [enabled]);

  useEffect(() => {
    void refreshStatus();
  }, [refreshStatus]);

  useEffect(() => {
    if (!enabled) return;
    if (status?.state !== "starting") return;
    const intervalId = window.setInterval(() => {
      void refreshStatus({ quiet: true });
    }, 3000);
    return () => window.clearInterval(intervalId);
  }, [enabled, refreshStatus, status?.state]);

  const bridgeStatusView = useMemo(
    () => getBridgeStatusView(status, enabled),
    [enabled, status],
  );
  const codexStatusView = useMemo(
    () => getCodexStatusView(codexStatus),
    [codexStatus],
  );

  const launcherPath = status?.launcherPath || codexStatus?.launcherPath || null;
  const codexCommand = launcherPath
    ? formatCodexAddCommand(launcherPath)
    : (codexStatus?.command || "");
  const codexTomlSnippet = launcherPath ? buildCodexTomlSnippet(launcherPath) : "";
  const claudeSnippet = launcherPath ? buildClaudeSnippet(launcherPath) : "";
  const canAddToCodex = codexStatus?.state === "not_configured";

  const handleToggle = useCallback(async (nextEnabled: boolean) => {
    setActionMessage(null);
    setEnabled(nextEnabled);
    window.setTimeout(() => {
      void refreshStatus();
    }, 0);
  }, [refreshStatus, setEnabled]);

  const copyText = useCallback(async (key: string, text: string) => {
    if (!text) return;
    try {
      await navigator.clipboard.writeText(text);
      setCopied(key);
      window.setTimeout(() => {
        setCopied((current) => (current === key ? null : current));
      }, 1200);
    } catch {
      setActionMessage({ tone: "error", text: "Copy failed. Try copying manually." });
    }
  }, []);

  const handleAddToCodex = useCallback(async () => {
    const bridge = getBridge();
    if (!bridge?.publicMcpCodexAdd) return;
    setActionMessage(null);
    setIsAddingCodex(true);
    try {
      const result = await bridge.publicMcpCodexAdd();
      setCodexStatus(result);
      if (result.state === "configured") {
        setActionMessage({
          tone: "success",
          text: "Codex MCP entry added. Restart Codex or open a new Codex session.",
        });
      } else if (result.state === "codex_not_found") {
        setActionMessage({
          tone: "warning",
          text: "Install Codex separately, then click Refresh.",
        });
      } else if (result.state === "conflict") {
        setActionMessage({
          tone: "error",
          text: "A netcatty-public entry already exists and points elsewhere. Remove or edit it manually.",
        });
      } else if (result.state === "error" && result.error) {
        setActionMessage({ tone: "error", text: result.error });
      }
      await refreshStatus({ quiet: true });
    } finally {
      setIsAddingCodex(false);
    }
  }, [refreshStatus]);

  return (
    <div className="rounded-lg border bg-card p-4 space-y-3">
      <div className="flex items-start justify-between gap-4">
        <p className="min-w-0 text-xs text-muted-foreground leading-5">
          Expose only currently open live SSH PTY sessions to standard MCP clients over localhost. Token auth rotates each Netcatty launch.
        </p>
        <div className={cn("text-xs font-medium shrink-0", bridgeStatusView.className)}>
          {bridgeStatusView.label}
        </div>
      </div>

      <div className="flex items-center justify-between gap-4 rounded-md border border-border/60 bg-background/70 px-3 py-2">
        <div className="min-w-0">
          <div className="text-sm font-medium">Public MCP</div>
          <div className="text-xs text-muted-foreground">
            Sessions exposed: {status?.exposedSessionCount ?? 0}
          </div>
        </div>
        <Toggle checked={enabled} onChange={(nextEnabled) => void handleToggle(nextEnabled)} />
      </div>

      <div className="space-y-2 text-xs">
        <div className="grid gap-1">
          <div className="text-muted-foreground">Security</div>
          <div>Listens on `127.0.0.1`, exposes only live SSH PTY sessions, and removes discovery when disabled.</div>
        </div>
        <div className="grid gap-1">
          <div className="text-muted-foreground">Discovery</div>
          <div className="font-mono break-all">{status?.discoveryPath || "Unavailable"}</div>
        </div>
        <div className="grid gap-1">
          <div className="text-muted-foreground">Launcher</div>
          <div className="font-mono break-all">{launcherPath || "Unavailable"}</div>
        </div>
        {status?.error ? (
          <div className="text-destructive">{status.error}</div>
        ) : null}
      </div>

      <div className="border-t border-border/40 pt-3 flex items-center gap-2 flex-wrap">
        <Button variant="outline" size="sm" onClick={() => void refreshStatus()} disabled={isRefreshing}>
          <RefreshCw size={14} className={cn("mr-1.5", isRefreshing && "animate-spin")} />
          {t("ai.codex.refreshStatus")}
        </Button>
        {canAddToCodex ? (
          <Button size="sm" onClick={() => void handleAddToCodex()} disabled={isAddingCodex || !launcherPath}>
            <RefreshCw size={14} className={cn("mr-1.5", isAddingCodex && "animate-spin")} />
            Add to Codex
          </Button>
        ) : null}
      </div>

      <div className="space-y-2">
        <div className="flex items-center justify-between gap-4">
          <div className="text-sm font-medium">Codex</div>
          <div className={cn("text-xs font-medium", codexStatusView.className)}>
            {codexStatusView.label}
          </div>
        </div>
        {codexStatus?.state === "codex_not_found" ? (
          <p className="text-xs text-amber-500">Install Codex separately, then click Refresh.</p>
        ) : null}
        {codexStatus?.state === "conflict" ? (
          <p className="text-xs text-destructive">
            A netcatty-public entry already exists and points elsewhere. Remove or edit it manually.
          </p>
        ) : null}
        {codexStatus?.error ? (
          <p className="text-xs text-destructive">{codexStatus.error}</p>
        ) : null}
        {codexCommand ? (
          <div className="rounded-md border border-border/60 bg-background px-3 py-2">
            <div className="flex items-start justify-between gap-2">
              <code className="min-w-0 break-all text-[11px]">{codexCommand}</code>
              <Button variant="ghost" size="sm" onClick={() => void copyText("codex-command", codexCommand)}>
                <Copy size={14} className="mr-1.5" />
                {copied === "codex-command" ? "Copied" : "Copy"}
              </Button>
            </div>
          </div>
        ) : null}
        {codexTomlSnippet ? (
          <div className="rounded-md border border-border/60 bg-background px-3 py-2">
            <div className="flex items-start justify-between gap-2">
              <pre className="min-w-0 whitespace-pre-wrap break-all text-[11px]">{codexTomlSnippet}</pre>
              <Button variant="ghost" size="sm" onClick={() => void copyText("codex-toml", codexTomlSnippet)}>
                <Copy size={14} className="mr-1.5" />
                {copied === "codex-toml" ? "Copied" : "Copy"}
              </Button>
            </div>
          </div>
        ) : null}
      </div>

      <div className="space-y-2">
        <div className="text-sm font-medium">Claude Code</div>
        {claudeSnippet ? (
          <div className="rounded-md border border-border/60 bg-background px-3 py-2">
            <div className="flex items-start justify-between gap-2">
              <pre className="min-w-0 whitespace-pre-wrap break-all text-[11px]">{claudeSnippet}</pre>
              <Button variant="ghost" size="sm" onClick={() => void copyText("claude", claudeSnippet)}>
                <Copy size={14} className="mr-1.5" />
                {copied === "claude" ? "Copied" : "Copy"}
              </Button>
            </div>
          </div>
        ) : (
          <p className="text-xs text-amber-500">Enable Public MCP to get a usable launcher path.</p>
        )}
      </div>

      {actionMessage ? (
        <p
          className={cn(
            "text-xs",
            actionMessage.tone === "success"
              ? "text-emerald-500"
              : actionMessage.tone === "warning"
                ? "text-amber-500"
                : "text-destructive",
          )}
        >
          {actionMessage.text}
        </p>
      ) : null}
    </div>
  );
};

import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Copy, RefreshCw } from "lucide-react";
import { useI18n } from "../../../../application/i18n/I18nProvider";
import { cn } from "../../../../lib/utils";
import { Button } from "../../../ui/button";
import { Select, Toggle } from "../../../settings/settings-ui";
import type { PublicMcpClaudeStatus, PublicMcpCodexStatus, PublicMcpStatus } from "./types";
import { getBridge } from "./types";

type PublicMcpClient = "codex" | "claude";

export const PUBLIC_MCP_I18N_KEYS = [
  "ai.publicMcp.status.unavailable",
  "ai.publicMcp.status.disabled",
  "ai.publicMcp.status.running",
  "ai.publicMcp.status.starting",
  "ai.publicMcp.status.error",
  "ai.publicMcp.status.configured",
  "ai.publicMcp.status.notConfigured",
  "ai.publicMcp.status.checking",
  "ai.publicMcp.status.codexNotFound",
  "ai.publicMcp.status.claudeNotFound",
  "ai.publicMcp.status.conflict",
  "ai.publicMcp.description",
  "ai.publicMcp.sessionsExposed",
  "ai.publicMcp.security",
  "ai.publicMcp.security.description",
  "ai.publicMcp.discovery",
  "ai.publicMcp.launcher",
  "ai.publicMcp.unavailable",
  "ai.publicMcp.bridgeUnavailable",
  "ai.publicMcp.copy",
  "ai.publicMcp.copied",
  "ai.publicMcp.copyFailed",
  "ai.publicMcp.clientConfiguration",
  "ai.publicMcp.clientConfiguration.description",
  "ai.publicMcp.addToCodex",
  "ai.publicMcp.addToClaude",
  "ai.publicMcp.codexAdded",
  "ai.publicMcp.claudeAdded",
  "ai.publicMcp.installCodex",
  "ai.publicMcp.installClaude",
  "ai.publicMcp.conflict.description",
  "ai.publicMcp.enableForLauncher",
] as const;

type PublicMcpI18nKey = typeof PUBLIC_MCP_I18N_KEYS[number];
type PublicMcpStatusView = {
  labelKey: PublicMcpI18nKey;
  className: string;
};

function getBridgeStatusView(status: PublicMcpStatus | null, enabled: boolean): PublicMcpStatusView {
  if (!status || !status.ok) {
    return {
      labelKey: enabled ? "ai.publicMcp.status.unavailable" : "ai.publicMcp.status.disabled",
      className: enabled ? "text-amber-500" : "text-muted-foreground",
    };
  }

  if (status.state === "running") {
    return {
      labelKey: "ai.publicMcp.status.running",
      className: "text-emerald-500",
    };
  }
  if (status.state === "starting") {
    return {
      labelKey: "ai.publicMcp.status.starting",
      className: "text-amber-500",
    };
  }
  if (status.state === "error") {
    return {
      labelKey: "ai.publicMcp.status.error",
      className: "text-destructive",
    };
  }
  if (status.state === "unavailable") {
    return {
      labelKey: "ai.publicMcp.status.unavailable",
      className: "text-amber-500",
    };
  }
  return {
    labelKey: "ai.publicMcp.status.disabled",
    className: "text-muted-foreground",
  };
}

function getCodexStatusView(status: PublicMcpCodexStatus | null): PublicMcpStatusView {
  switch (status?.state) {
    case "configured":
      return { labelKey: "ai.publicMcp.status.configured", className: "text-emerald-500" };
    case "not_configured":
      return { labelKey: "ai.publicMcp.status.notConfigured", className: "text-muted-foreground" };
    case "codex_not_found":
      return { labelKey: "ai.publicMcp.status.codexNotFound", className: "text-amber-500" };
    case "conflict":
      return { labelKey: "ai.publicMcp.status.conflict", className: "text-destructive" };
    case "error":
      return { labelKey: "ai.publicMcp.status.error", className: "text-destructive" };
    default:
      return { labelKey: "ai.publicMcp.status.checking", className: "text-muted-foreground" };
  }
}

function getClaudeStatusView(status: PublicMcpClaudeStatus | null): PublicMcpStatusView {
  switch (status?.state) {
    case "configured":
      return { labelKey: "ai.publicMcp.status.configured", className: "text-emerald-500" };
    case "not_configured":
      return { labelKey: "ai.publicMcp.status.notConfigured", className: "text-muted-foreground" };
    case "claude_not_found":
      return { labelKey: "ai.publicMcp.status.claudeNotFound", className: "text-amber-500" };
    case "conflict":
      return { labelKey: "ai.publicMcp.status.conflict", className: "text-destructive" };
    case "error":
      return { labelKey: "ai.publicMcp.status.error", className: "text-destructive" };
    default:
      return { labelKey: "ai.publicMcp.status.checking", className: "text-muted-foreground" };
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

export function formatClaudeAddCommand(launcherPath: string) {
  return `claude mcp add netcatty-public -- ${quoteShellArg(launcherPath)}`;
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
  const [selectedClient, setSelectedClient] = useState<PublicMcpClient>("codex");
  const [codexStatus, setCodexStatus] = useState<PublicMcpCodexStatus | null>(null);
  const [claudeStatus, setClaudeStatus] = useState<PublicMcpClaudeStatus | null>(null);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [isAddingCodex, setIsAddingCodex] = useState(false);
  const [isAddingClaude, setIsAddingClaude] = useState(false);
  const [copied, setCopied] = useState<string | null>(null);
  const [actionMessage, setActionMessage] = useState<{ tone: "error" | "warning" | "success"; text: string } | null>(null);
  const bridgeUnavailableMessage = t("ai.publicMcp.bridgeUnavailable");

  const refreshStatus = useCallback(async (options?: { quiet?: boolean }) => {
    const bridge = getBridge();
    if (!bridge?.publicMcpGetStatus || !bridge?.publicMcpCodexGetStatus || !bridge?.publicMcpClaudeGetStatus) {
      setStatus({
        ok: false,
        enabled,
        state: "unavailable",
        host: "127.0.0.1",
        port: null,
        discoveryPath: null,
        launcherPath: null,
        exposedSessionCount: 0,
        error: bridgeUnavailableMessage,
      });
      setCodexStatus({
        ok: true,
        state: "error",
        codexPath: null,
        launcherPath: null,
        command: "",
        existingCommand: null,
        error: bridgeUnavailableMessage,
      });
      setClaudeStatus({
        ok: true,
        state: "error",
        claudePath: null,
        launcherPath: null,
        command: "",
        existingCommand: null,
        error: bridgeUnavailableMessage,
      });
      return;
    }

    if (!options?.quiet) {
      setIsRefreshing(true);
    }

    try {
      const [nextStatus, nextCodexStatus, nextClaudeStatus] = await Promise.all([
        bridge.publicMcpGetStatus(),
        bridge.publicMcpCodexGetStatus(),
        bridge.publicMcpClaudeGetStatus(),
      ]);
      setStatus(nextStatus);
      setCodexStatus(nextCodexStatus);
      setClaudeStatus(nextClaudeStatus);
    } finally {
      if (!options?.quiet) {
        setIsRefreshing(false);
      }
    }
  }, [bridgeUnavailableMessage, enabled]);

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
  const claudeStatusView = useMemo(
    () => getClaudeStatusView(claudeStatus),
    [claudeStatus],
  );

  const launcherPath = status?.launcherPath || codexStatus?.launcherPath || claudeStatus?.launcherPath || null;
  const codexCommand = launcherPath
    ? formatCodexAddCommand(launcherPath)
    : (codexStatus?.command || "");
  const claudeCommand = launcherPath
    ? formatClaudeAddCommand(launcherPath)
    : (claudeStatus?.command || "");
  const codexTomlSnippet = launcherPath ? buildCodexTomlSnippet(launcherPath) : "";
  const claudeSnippet = launcherPath ? buildClaudeSnippet(launcherPath) : "";
  const canAddToCodex = codexStatus?.state === "not_configured";
  const canAddToClaude = claudeStatus?.state === "not_configured";

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
      setActionMessage({ tone: "error", text: t("ai.publicMcp.copyFailed") });
    }
  }, [t]);

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
          text: t("ai.publicMcp.codexAdded"),
        });
      } else if (result.state === "codex_not_found") {
        setActionMessage({
          tone: "warning",
          text: t("ai.publicMcp.installCodex"),
        });
      } else if (result.state === "conflict") {
        setActionMessage({
          tone: "error",
          text: t("ai.publicMcp.conflict.description"),
        });
      } else if (result.state === "error" && result.error) {
        setActionMessage({ tone: "error", text: result.error });
      }
      await refreshStatus({ quiet: true });
    } finally {
      setIsAddingCodex(false);
    }
  }, [refreshStatus, t]);

  const handleAddToClaude = useCallback(async () => {
    const bridge = getBridge();
    if (!bridge?.publicMcpClaudeAdd) return;
    setActionMessage(null);
    setIsAddingClaude(true);
    try {
      const result = await bridge.publicMcpClaudeAdd();
      setClaudeStatus(result);
      if (result.state === "configured") {
        setActionMessage({
          tone: "success",
          text: t("ai.publicMcp.claudeAdded"),
        });
      } else if (result.state === "claude_not_found") {
        setActionMessage({
          tone: "warning",
          text: t("ai.publicMcp.installClaude"),
        });
      } else if (result.state === "conflict") {
        setActionMessage({
          tone: "error",
          text: t("ai.publicMcp.conflict.description"),
        });
      } else if (result.state === "error" && result.error) {
        setActionMessage({ tone: "error", text: result.error });
      }
      await refreshStatus({ quiet: true });
    } finally {
      setIsAddingClaude(false);
    }
  }, [refreshStatus, t]);

  const selectedClientStatusView = selectedClient === "codex" ? codexStatusView : claudeStatusView;

  return (
    <div className="rounded-lg border bg-card p-4 space-y-3">
      <div className="flex items-start justify-between gap-4">
        <p className="min-w-0 text-xs text-muted-foreground leading-5">
          {t("ai.publicMcp.description")}
        </p>
        <div className={cn("text-xs font-medium shrink-0", bridgeStatusView.className)}>
          {t(bridgeStatusView.labelKey)}
        </div>
      </div>

      <div className="flex items-center justify-between gap-4 rounded-md border border-border/60 bg-background/70 px-3 py-2">
        <div className="min-w-0">
          <div className="text-sm font-medium">Public MCP</div>
          <div className="text-xs text-muted-foreground">
            {t("ai.publicMcp.sessionsExposed", { count: status?.exposedSessionCount ?? 0 })}
          </div>
        </div>
        <Toggle checked={enabled} onChange={(nextEnabled) => void handleToggle(nextEnabled)} />
      </div>

      <div className="space-y-2 text-xs">
        <div className="grid gap-1">
          <div className="text-muted-foreground">{t("ai.publicMcp.security")}</div>
          <div>{t("ai.publicMcp.security.description")}</div>
        </div>
        <div className="grid gap-1">
          <div className="text-muted-foreground">{t("ai.publicMcp.discovery")}</div>
          <div className="font-mono break-all">{status?.discoveryPath || t("ai.publicMcp.unavailable")}</div>
        </div>
        <div className="grid gap-1">
          <div className="text-muted-foreground">{t("ai.publicMcp.launcher")}</div>
          <div className="font-mono break-all">{launcherPath || t("ai.publicMcp.unavailable")}</div>
        </div>
        {status?.error ? (
          <div className="text-destructive">{status.error}</div>
        ) : null}
      </div>

      <div className="border-t border-border/40 pt-3 space-y-3">
        <div className="flex items-center justify-between gap-4">
          <div className="min-w-0">
            <div className="text-sm font-medium">{t("ai.publicMcp.clientConfiguration")}</div>
            <div className="text-xs text-muted-foreground">
              {t("ai.publicMcp.clientConfiguration.description")}
            </div>
          </div>
          <Select
            value={selectedClient}
            onChange={(value) => {
              setActionMessage(null);
              setSelectedClient(value as PublicMcpClient);
            }}
            options={[
              { value: "codex", label: "Codex" },
              { value: "claude", label: "Claude Code" },
            ]}
            className="w-40"
          />
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          <Button variant="outline" size="sm" onClick={() => void refreshStatus()} disabled={isRefreshing}>
            <RefreshCw size={14} className={cn("mr-1.5", isRefreshing && "animate-spin")} />
            {t("ai.codex.refreshStatus")}
          </Button>
          {selectedClient === "codex" && canAddToCodex ? (
            <Button size="sm" onClick={() => void handleAddToCodex()} disabled={isAddingCodex || !launcherPath}>
              <RefreshCw size={14} className={cn("mr-1.5", isAddingCodex && "animate-spin")} />
              {t("ai.publicMcp.addToCodex")}
            </Button>
          ) : null}
          {selectedClient === "claude" && canAddToClaude ? (
            <Button size="sm" onClick={() => void handleAddToClaude()} disabled={isAddingClaude || !launcherPath}>
              <RefreshCw size={14} className={cn("mr-1.5", isAddingClaude && "animate-spin")} />
              {t("ai.publicMcp.addToClaude")}
            </Button>
          ) : null}
        </div>
      </div>

      <div className="space-y-2">
        <div className="flex items-center justify-between gap-4">
          <div className="text-sm font-medium">
            {selectedClient === "codex" ? "Codex" : "Claude Code"}
          </div>
          <div className={cn("text-xs font-medium", selectedClientStatusView.className)}>
            {t(selectedClientStatusView.labelKey)}
          </div>
        </div>
        {selectedClient === "codex" && codexStatus?.state === "codex_not_found" ? (
          <p className="text-xs text-amber-500">{t("ai.publicMcp.installCodex")}</p>
        ) : null}
        {selectedClient === "claude" && claudeStatus?.state === "claude_not_found" ? (
          <p className="text-xs text-amber-500">{t("ai.publicMcp.installClaude")}</p>
        ) : null}
        {selectedClient === "codex" && codexStatus?.state === "conflict" ? (
          <p className="text-xs text-destructive">
            {t("ai.publicMcp.conflict.description")}
          </p>
        ) : null}
        {selectedClient === "claude" && claudeStatus?.state === "conflict" ? (
          <p className="text-xs text-destructive">
            {t("ai.publicMcp.conflict.description")}
          </p>
        ) : null}
        {selectedClient === "codex" && codexStatus?.error ? (
          <p className="text-xs text-destructive">{codexStatus.error}</p>
        ) : null}
        {selectedClient === "claude" && claudeStatus?.error ? (
          <p className="text-xs text-destructive">{claudeStatus.error}</p>
        ) : null}
        {selectedClient === "codex" && codexCommand ? (
          <div className="rounded-md border border-border/60 bg-background px-3 py-2">
            <div className="flex items-start justify-between gap-2">
              <code className="min-w-0 break-all text-[11px]">{codexCommand}</code>
              <Button variant="ghost" size="sm" onClick={() => void copyText("codex-command", codexCommand)}>
                <Copy size={14} className="mr-1.5" />
                {copied === "codex-command" ? t("ai.publicMcp.copied") : t("ai.publicMcp.copy")}
              </Button>
            </div>
          </div>
        ) : null}
        {selectedClient === "claude" && claudeCommand ? (
          <div className="rounded-md border border-border/60 bg-background px-3 py-2">
            <div className="flex items-start justify-between gap-2">
              <code className="min-w-0 break-all text-[11px]">{claudeCommand}</code>
              <Button variant="ghost" size="sm" onClick={() => void copyText("claude-command", claudeCommand)}>
                <Copy size={14} className="mr-1.5" />
                {copied === "claude-command" ? t("ai.publicMcp.copied") : t("ai.publicMcp.copy")}
              </Button>
            </div>
          </div>
        ) : null}
        {selectedClient === "codex" && codexTomlSnippet ? (
          <div className="rounded-md border border-border/60 bg-background px-3 py-2">
            <div className="flex items-start justify-between gap-2">
              <pre className="min-w-0 whitespace-pre-wrap break-all text-[11px]">{codexTomlSnippet}</pre>
              <Button variant="ghost" size="sm" onClick={() => void copyText("codex-toml", codexTomlSnippet)}>
                <Copy size={14} className="mr-1.5" />
                {copied === "codex-toml" ? t("ai.publicMcp.copied") : t("ai.publicMcp.copy")}
              </Button>
            </div>
          </div>
        ) : null}
        {selectedClient === "claude" && claudeSnippet ? (
          <div className="rounded-md border border-border/60 bg-background px-3 py-2">
            <div className="flex items-start justify-between gap-2">
              <pre className="min-w-0 whitespace-pre-wrap break-all text-[11px]">{claudeSnippet}</pre>
              <Button variant="ghost" size="sm" onClick={() => void copyText("claude", claudeSnippet)}>
                <Copy size={14} className="mr-1.5" />
                {copied === "claude" ? t("ai.publicMcp.copied") : t("ai.publicMcp.copy")}
              </Button>
            </div>
          </div>
        ) : null}
        {!launcherPath ? (
          <p className="text-xs text-amber-500">{t("ai.publicMcp.enableForLauncher")}</p>
        ) : null}
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

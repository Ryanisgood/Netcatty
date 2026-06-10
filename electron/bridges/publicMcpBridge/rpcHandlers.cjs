"use strict";

function createEnvironmentPayload(registry) {
  const hosts = registry.listPublicSessions();
  return {
    ok: true,
    environment: "netcatty-public-mcp",
    description: hosts.length > 0
      ? "Currently open live SSH PTY sessions exposed by Netcatty Public MCP."
      : "No public SSH PTY sessions are currently available.",
    hosts,
    hostCount: hosts.length,
  };
}

function createStatusPayload(ctx) {
  const hosts = ctx.registry.listPublicSessions();
  return {
    ok: true,
    enabled: Boolean(ctx.getEnabled?.()),
    available: Boolean(ctx.getEnabled?.()),
    commandTimeoutMs: ctx.getCommandTimeoutMs?.() ?? ctx.commandTimeoutMs,
    sessionCount: hosts.length,
  };
}

function createPublicRpcHandlers(ctx) {
  const { terminalHandlers, sftpHandlers } = ctx;

  async function dispatch(method, params = {}) {
    switch (method) {
      case "public/getEnvironment":
        return createEnvironmentPayload(ctx.registry);
      case "public/getStatus":
        return createStatusPayload(ctx);
      case "public/terminalExecute":
        return await terminalHandlers.handleTerminalExecute(params);
      case "public/terminalStart":
        return await terminalHandlers.handleTerminalStart(params);
      case "public/terminalPoll":
        return terminalHandlers.handleTerminalPoll(params);
      case "public/terminalStop":
        return terminalHandlers.handleTerminalStop(params);
      case "public/sftp/list":
        return await sftpHandlers.handleSftpList(params);
      case "public/sftp/readFile":
        return await sftpHandlers.handleSftpReadFile(params);
      case "public/sftp/writeFile":
        return await sftpHandlers.handleSftpWriteFile(params);
      case "public/sftp/stat":
        return await sftpHandlers.handleSftpStat(params);
      case "public/sftp/home":
        return await sftpHandlers.handleSftpHome(params);
      case "public/sftp/mkdir":
        return await sftpHandlers.handleSftpMkdir(params);
      case "public/sftp/delete":
        return await sftpHandlers.handleSftpDelete(params);
      case "public/sftp/rename":
        return await sftpHandlers.handleSftpRename(params);
      case "public/sftp/chmod":
        return await sftpHandlers.handleSftpChmod(params);
      default:
        throw new Error(`Unknown method: ${method}`);
    }
  }

  return {
    dispatch,
  };
}

module.exports = {
  createPublicRpcHandlers,
};

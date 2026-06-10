"use strict";

function hasWritablePty(session) {
  const ptyStream = session?.stream || session?.pty || session?.proc || null;
  return ptyStream && typeof ptyStream.write === "function" ? ptyStream : null;
}

function getSshClient(session) {
  const sshClient = session?.conn || session?.sshClient || null;
  return sshClient ? sshClient : null;
}

function getSessionProtocol(session) {
  return String(session?.protocol || session?.type || "ssh").trim().toLowerCase();
}

function getShellType(session) {
  return String(session?.shellKind || session?.shellType || "unknown").trim() || "unknown";
}

function isPublicSshPtySession(session) {
  if (!session || typeof session !== "object") {
    return { ok: false, error: "Session not found" };
  }

  const protocol = getSessionProtocol(session);
  if (protocol !== "ssh") {
    return { ok: false, error: `Session protocol "${protocol}" is not public` };
  }

  const sshClient = getSshClient(session);
  if (!sshClient) {
    return { ok: false, error: "Session has no SSH client connection" };
  }

  const ptyStream = hasWritablePty(session);
  if (!ptyStream) {
    return { ok: false, error: "Session has no writable PTY stream" };
  }

  return {
    ok: true,
    protocol: "ssh",
    sshClient,
    ptyStream,
  };
}

function createSessionSummary(sessionId, session) {
  return {
    sessionId,
    hostname: session?.hostname || "",
    label: session?.label || "",
    username: session?.username || "",
    protocol: "ssh",
    shellType: getShellType(session),
    connected: true,
  };
}

function createPublicSessionRegistry({ sessions }) {
  function listPublicSessions() {
    const hosts = [];
    for (const [sessionId, session] of sessions || []) {
      const result = isPublicSshPtySession(session);
      if (!result.ok) continue;
      hosts.push(createSessionSummary(sessionId, session));
    }
    return hosts;
  }

  function validatePublicSession(sessionId) {
    const session = sessions?.get(sessionId);
    if (!session) {
      return {
        ok: false,
        code: "SESSION_NOT_FOUND",
        error: "Session not found",
      };
    }

    const result = isPublicSshPtySession(session);
    if (!result.ok) {
      return {
        ok: false,
        code: "SESSION_NOT_PUBLIC",
        error: result.error,
      };
    }

    return {
      ok: true,
      session,
      summary: createSessionSummary(sessionId, session),
      ptyStream: result.ptyStream,
      sshClient: result.sshClient,
    };
  }

  return {
    listPublicSessions,
    validatePublicSession,
  };
}

module.exports = {
  createPublicSessionRegistry,
  isPublicSshPtySession,
};

"use strict";

function createPublicSftpHandlers(ctx) {
  const {
    registry,
    sftpBridge,
    commandTimeoutMs,
    AbortController,
    setTimeout,
    clearTimeout,
    registerPublicSftpOp,
  } = ctx;

  const activeCleanup = new Set();

  function getEncodingStateKey(sessionId) {
    return `public:${sessionId}`;
  }

  async function withPublicSessionSftp(params, action) {
    const validated = registry.validatePublicSession(params.sessionId);
    if (!validated.ok) return validated;

    const abortController = new AbortController();
    let timeoutId = null;
    let sftpId = null;
    let closePromise = null;
    const encodingStateKey = getEncodingStateKey(params.sessionId);
    const closeSftpHandle = () => {
      if (!sftpId) return Promise.resolve();
      if (!closePromise) {
        closePromise = Promise.resolve().then(() => sftpBridge.closeSftp(null, { sftpId, encodingStateKey }));
      }
      return closePromise;
    };
    const cancelAndClose = () => {
      if (!abortController.signal.aborted) {
        abortController.abort(new Error("Cancelled"));
      }
      return closeSftpHandle();
    };
    const unregister = registerPublicSftpOp(() => {
      activeCleanup.delete(cancelAndClose);
      return cancelAndClose();
    });
    activeCleanup.add(cancelAndClose);

    try {
      timeoutId = setTimeout(() => {
        abortController.abort(new Error("SFTP operation timed out"));
        void closeSftpHandle().catch(() => {});
      }, commandTimeoutMs);

      const opened = await sftpBridge.openSftpForSession(null, {
        sessionId: params.sessionId,
        encodingStateKey,
        abortSignal: abortController.signal,
        timeoutMs: commandTimeoutMs,
      });
      if (abortController.signal.aborted) {
        throw abortController.signal.reason || new Error("Cancelled");
      }
      sftpId = opened?.sftpId;
      if (!sftpId) {
        throw new Error("Failed to open session-backed SFTP handle");
      }

      return await action({
        ...params,
        sftpId,
        abortSignal: abortController.signal,
        timeoutMs: commandTimeoutMs,
      });
    } finally {
      unregister();
      activeCleanup.delete(cancelAndClose);
      if (timeoutId) clearTimeout(timeoutId);
      await closeSftpHandle().catch(() => {});
    }
  }

  async function handleSftpList(params) {
    const entries = await withPublicSessionSftp(
      params,
      (payload) => sftpBridge.listSftp(null, payload),
    );
    if (!entries?.ok && entries?.code) return entries;
    return { ok: true, entries };
  }

  async function handleSftpReadFile(params) {
    if (!params?.path) throw new Error("path is required");
    const content = await withPublicSessionSftp(
      params,
      (payload) => sftpBridge.readSftp(null, payload),
    );
    if (!content?.ok && content?.code) return content;
    return { ok: true, path: params.path, content };
  }

  async function handleSftpWriteFile(params) {
    if (!params?.path) throw new Error("path is required");
    if (typeof params?.content !== "string") throw new Error("content is required");
    const result = await withPublicSessionSftp(
      params,
      (payload) => sftpBridge.writeSftp(null, payload),
    );
    if (!result?.ok && result?.code) return result;
    return { ok: true, path: params.path };
  }

  async function handleSftpStat(params) {
    if (!params?.path) throw new Error("path is required");
    const stat = await withPublicSessionSftp(
      params,
      (payload) => sftpBridge.statSftp(null, payload),
    );
    if (!stat?.ok && stat?.code) return stat;
    return { ok: true, stat };
  }

  async function handleSftpHome(params) {
    const result = await withPublicSessionSftp(
      params,
      (payload) => sftpBridge.getSftpHomeDir(null, payload),
    );
    if (!result?.ok && result?.code) return result;
    if (!result?.success) {
      throw new Error(result?.error || "Could not determine home directory");
    }
    return { ok: true, homeDir: result.homeDir };
  }

  async function handleSftpMkdir(params) {
    if (!params?.path) throw new Error("path is required");
    const result = await withPublicSessionSftp(
      params,
      (payload) => sftpBridge.mkdirSftp(null, payload),
    );
    if (!result?.ok && result?.code) return result;
    return { ok: true, path: params.path };
  }

  async function handleSftpDelete(params) {
    if (!params?.path) throw new Error("path is required");
    const result = await withPublicSessionSftp(
      params,
      (payload) => sftpBridge.deleteSftp(null, payload),
    );
    if (!result?.ok && result?.code) return result;
    return { ok: true, path: params.path };
  }

  async function handleSftpRename(params) {
    if (!params?.oldPath || !params?.newPath) throw new Error("oldPath and newPath are required");
    const result = await withPublicSessionSftp(
      params,
      (payload) => sftpBridge.renameSftp(null, payload),
    );
    if (!result?.ok && result?.code) return result;
    return { ok: true, oldPath: params.oldPath, newPath: params.newPath };
  }

  async function handleSftpChmod(params) {
    if (!params?.path || !params?.mode) throw new Error("path and mode are required");
    const result = await withPublicSessionSftp(
      params,
      (payload) => sftpBridge.chmodSftp(null, payload),
    );
    if (!result?.ok && result?.code) return result;
    return { ok: true, path: params.path, mode: params.mode };
  }

  async function cleanup() {
    const pending = [];
    for (const cleanupFn of activeCleanup) {
      activeCleanup.delete(cleanupFn);
      pending.push(Promise.resolve().then(() => cleanupFn()));
    }
    await Promise.allSettled(pending);
  }

  return {
    handleSftpList,
    handleSftpReadFile,
    handleSftpWriteFile,
    handleSftpStat,
    handleSftpHome,
    handleSftpMkdir,
    handleSftpDelete,
    handleSftpRename,
    handleSftpChmod,
    cleanup,
  };
}

module.exports = {
  createPublicSftpHandlers,
};

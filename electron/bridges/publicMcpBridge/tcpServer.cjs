"use strict";

const net = require("node:net");

const DEFAULT_MAX_BUFFER_BYTES = 10 * 1024 * 1024;

function createPublicTcpServer(options) {
  const {
    host = "127.0.0.1",
    port = 0,
    token,
    dispatch,
    onActivity,
    maxBufferBytes = DEFAULT_MAX_BUFFER_BYTES,
    netModule = net,
  } = options;

  if (!token) {
    throw new Error("token is required");
  }
  if (typeof dispatch !== "function") {
    throw new Error("dispatch is required");
  }

  let server = null;
  let startPromise = null;
  let listeningPort = null;
  const authenticatedSockets = new WeakSet();
  const sockets = new Set();

  function writeJson(socket, payload) {
    if (socket.destroyed) return;
    socket.write(`${JSON.stringify(payload)}\n`);
  }

  async function handleLine(socket, line) {
    let msg;
    try {
      msg = JSON.parse(line);
    } catch {
      return;
    }

    const { id, method, params } = msg || {};
    if (id == null || !method) return;

    if (!authenticatedSockets.has(socket)) {
      if (method === "auth/verify" && params?.token === token) {
        authenticatedSockets.add(socket);
        writeJson(socket, { jsonrpc: "2.0", id, result: { ok: true } });
        return;
      }

      writeJson(socket, {
        jsonrpc: "2.0",
        id,
        error: {
          code: -32001,
          message: "Authentication required. Send auth/verify with valid token first.",
        },
      });
      socket.destroy();
      return;
    }

    try {
      onActivity?.({ method });
      const result = await dispatch(method, params || {});
      writeJson(socket, { jsonrpc: "2.0", id, result });
    } catch (error) {
      writeJson(socket, {
        jsonrpc: "2.0",
        id,
        error: {
          code: -32000,
          message: error?.message || String(error),
        },
      });
    }
  }

  function handleConnection(socket) {
    let buffer = "";
    sockets.add(socket);
    socket.setEncoding("utf8");

    socket.on("data", (chunk) => {
      if (buffer.length + chunk.length > maxBufferBytes) {
        socket.destroy();
        return;
      }
      buffer += chunk;
      let newlineIndex;
      while ((newlineIndex = buffer.indexOf("\n")) !== -1) {
        const line = buffer.slice(0, newlineIndex);
        buffer = buffer.slice(newlineIndex + 1);
        if (!line.trim()) continue;
        void handleLine(socket, line);
      }
    });

    const cleanup = () => {
      sockets.delete(socket);
    };
    socket.on("close", cleanup);
    socket.on("error", cleanup);
  }

  async function start() {
    if (server && listeningPort) {
      return { host, port: listeningPort };
    }
    if (startPromise) {
      return await startPromise;
    }

    startPromise = new Promise((resolve, reject) => {
      const nextServer = netModule.createServer(handleConnection);

      const fail = (error) => {
        if (server === nextServer) {
          server = null;
          listeningPort = null;
        }
        startPromise = null;
        reject(error);
      };

      nextServer.once("error", fail);
      nextServer.listen(port, host, () => {
        nextServer.off("error", fail);
        server = nextServer;
        listeningPort = nextServer.address().port;
        startPromise = null;
        resolve({ host, port: listeningPort });
      });
    });

    return await startPromise;
  }

  async function stop() {
    const currentServer = server;
    server = null;
    listeningPort = null;
    startPromise = null;

    for (const socket of sockets) {
      socket.destroy();
      sockets.delete(socket);
    }

    if (!currentServer) return;
    await new Promise((resolve) => currentServer.close(resolve));
  }

  function getAddress() {
    return listeningPort == null ? null : { host, port: listeningPort };
  }

  return {
    start,
    stop,
    getAddress,
  };
}

module.exports = {
  createPublicTcpServer,
};

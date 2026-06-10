const test = require("node:test");
const assert = require("node:assert/strict");
const { EventEmitter } = require("node:events");

const { createPublicTcpServer } = require("./tcpServer.cjs");

class FakeSocket extends EventEmitter {
  constructor() {
    super();
    this.destroyed = false;
    this.writes = [];
    this.encoding = null;
  }

  setEncoding(value) {
    this.encoding = value;
  }

  write(chunk) {
    this.writes.push(chunk);
    return true;
  }

  destroy() {
    if (this.destroyed) return;
    this.destroyed = true;
    this.emit("close");
  }
}

class FakeServer extends EventEmitter {
  constructor(connectionHandler) {
    super();
    this.connectionHandler = connectionHandler;
    this.closed = false;
    this.addressInfo = { address: "127.0.0.1", port: 41001 };
  }

  listen(_port, _host, callback) {
    queueMicrotask(() => callback());
    return this;
  }

  address() {
    return this.addressInfo;
  }

  close(callback) {
    this.closed = true;
    queueMicrotask(() => callback?.());
  }

  connectSocket(socket = new FakeSocket()) {
    this.connectionHandler(socket);
    return socket;
  }
}

function makeNetModule() {
  const state = {
    server: null,
  };
  return {
    state,
    createServer(connectionHandler) {
      const server = new FakeServer(connectionHandler);
      state.server = server;
      return server;
    },
  };
}

function parseWrites(socket) {
  return socket.writes.map((chunk) => JSON.parse(String(chunk).trim()));
}

function emitLine(socket, payload) {
  socket.emit("data", `${JSON.stringify(payload)}\n`);
}

test("tcp server requires auth before dispatching requests", async () => {
  const calls = [];
  const fakeNet = makeNetModule();
  const server = createPublicTcpServer({
    host: "127.0.0.1",
    token: "secret-token",
    netModule: fakeNet,
    async dispatch(method, params) {
      calls.push({ method, params });
      return { ok: true };
    },
  });

  await server.start();
  const socket = fakeNet.state.server.connectSocket();

  emitLine(socket, {
    jsonrpc: "2.0",
    id: 1,
    method: "public/getEnvironment",
    params: {},
  });

  await new Promise((resolve) => setImmediate(resolve));

  const responses = parseWrites(socket);
  assert.equal(responses.length, 1);
  assert.equal(responses[0].error.code, -32001);
  assert.match(responses[0].error.message, /Authentication required/i);
  assert.equal(socket.destroyed, true);
  assert.equal(calls.length, 0);
});

test("tcp server authenticates once and dispatches JSON-RPC calls", async () => {
  const calls = [];
  const activities = [];
  const fakeNet = makeNetModule();
  const server = createPublicTcpServer({
    host: "127.0.0.1",
    token: "secret-token",
    netModule: fakeNet,
    onActivity(activity) {
      activities.push(activity);
    },
    async dispatch(method, params) {
      calls.push({ method, params });
      return { ok: true, method, params };
    },
  });

  await server.start();
  const socket = fakeNet.state.server.connectSocket();

  emitLine(socket, {
    jsonrpc: "2.0",
    id: 1,
    method: "auth/verify",
    params: { token: "secret-token" },
  });
  emitLine(socket, {
    jsonrpc: "2.0",
    id: 2,
    method: "public/getStatus",
    params: {},
  });

  await new Promise((resolve) => setImmediate(resolve));

  const responses = parseWrites(socket);
  assert.deepEqual(responses, [
    { jsonrpc: "2.0", id: 1, result: { ok: true } },
    { jsonrpc: "2.0", id: 2, result: { ok: true, method: "public/getStatus", params: {} } },
  ]);
  assert.deepEqual(calls, [{ method: "public/getStatus", params: {} }]);
  assert.deepEqual(activities, [{ method: "public/getStatus" }]);
  assert.equal(socket.destroyed, false);
});

test("tcp server does not report activity for failed auth", async () => {
  const activities = [];
  const fakeNet = makeNetModule();
  const server = createPublicTcpServer({
    host: "127.0.0.1",
    token: "secret-token",
    netModule: fakeNet,
    onActivity(activity) {
      activities.push(activity);
    },
    async dispatch() {
      return { ok: true };
    },
  });

  await server.start();
  const socket = fakeNet.state.server.connectSocket();

  emitLine(socket, {
    jsonrpc: "2.0",
    id: 1,
    method: "public/getStatus",
    params: {},
  });

  await new Promise((resolve) => setImmediate(resolve));

  assert.deepEqual(activities, []);
});

test("tcp server serializes dispatch errors as JSON-RPC errors", async () => {
  const fakeNet = makeNetModule();
  const server = createPublicTcpServer({
    host: "127.0.0.1",
    token: "secret-token",
    netModule: fakeNet,
    async dispatch() {
      throw new Error("boom");
    },
  });

  await server.start();
  const socket = fakeNet.state.server.connectSocket();

  emitLine(socket, {
    jsonrpc: "2.0",
    id: 1,
    method: "auth/verify",
    params: { token: "secret-token" },
  });
  emitLine(socket, {
    jsonrpc: "2.0",
    id: 2,
    method: "public/getStatus",
    params: {},
  });

  await new Promise((resolve) => setImmediate(resolve));

  const responses = parseWrites(socket);
  assert.deepEqual(responses[0], { jsonrpc: "2.0", id: 1, result: { ok: true } });
  assert.equal(responses[1].error.code, -32000);
  assert.equal(responses[1].error.message, "boom");
});

test("tcp server drops connections that exceed the max buffer size", async () => {
  const fakeNet = makeNetModule();
  const server = createPublicTcpServer({
    host: "127.0.0.1",
    token: "secret-token",
    netModule: fakeNet,
    maxBufferBytes: 32,
    async dispatch() {
      return { ok: true };
    },
  });

  await server.start();
  const socket = fakeNet.state.server.connectSocket();

  socket.emit("data", "x".repeat(64));

  assert.equal(socket.destroyed, true);
  assert.equal(socket.writes.length, 0);
});

test("tcp server stop closes tracked sockets and resets address", async () => {
  const fakeNet = makeNetModule();
  const server = createPublicTcpServer({
    host: "127.0.0.1",
    token: "secret-token",
    netModule: fakeNet,
    async dispatch() {
      return { ok: true };
    },
  });

  const listening = await server.start();
  assert.deepEqual(listening, { host: "127.0.0.1", port: 41001 });
  assert.deepEqual(server.getAddress(), { host: "127.0.0.1", port: 41001 });

  const socket = fakeNet.state.server.connectSocket();

  await server.stop();

  assert.equal(fakeNet.state.server.closed, true);
  assert.equal(socket.destroyed, true);
  assert.equal(server.getAddress(), null);
});

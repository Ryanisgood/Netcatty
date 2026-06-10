const test = require("node:test");
const assert = require("node:assert/strict");

const {
  createPublicSessionRegistry,
  isPublicSshPtySession,
} = require("./sessionRegistry.cjs");

function makeWritableStream() {
  return {
    writes: [],
    write(data) {
      this.writes.push(data);
      return true;
    },
  };
}

function makeSession(overrides = {}) {
  return {
    hostname: "example.com",
    username: "root",
    label: "prod",
    shellKind: "bash",
    conn: { exec() {} },
    stream: makeWritableStream(),
    ...overrides,
  };
}

test("isPublicSshPtySession accepts SSH sessions with writable stream", () => {
  const session = makeSession();
  const result = isPublicSshPtySession(session);
  assert.equal(result.ok, true);
  assert.equal(result.protocol, "ssh");
  assert.equal(result.ptyStream, session.stream);
  assert.equal(result.sshClient, session.conn);
});

test("isPublicSshPtySession accepts SSH sessions with writable pty or proc", () => {
  const ptySession = makeSession({ stream: null, pty: makeWritableStream() });
  const procSession = makeSession({ stream: null, pty: null, proc: makeWritableStream() });

  const ptyResult = isPublicSshPtySession(ptySession);
  const procResult = isPublicSshPtySession(procSession);

  assert.equal(ptyResult.ok, true);
  assert.equal(ptyResult.ptyStream, ptySession.pty);
  assert.equal(procResult.ok, true);
  assert.equal(procResult.ptyStream, procSession.proc);
});

test("isPublicSshPtySession rejects local and non-SSH transports", () => {
  for (const session of [
    makeSession({ protocol: "local" }),
    makeSession({ type: "local" }),
    makeSession({ protocol: "mosh" }),
    makeSession({ protocol: "et" }),
    makeSession({ protocol: "telnet" }),
    makeSession({ protocol: "serial" }),
    makeSession({ type: "raw" }),
  ]) {
    const result = isPublicSshPtySession(session);
    assert.equal(result.ok, false);
  }
});

test("isPublicSshPtySession rejects missing writable pty or ssh client", () => {
  const noPty = makeSession({ stream: null, pty: null, proc: null });
  const noClient = makeSession({ conn: null, sshClient: null });

  const noPtyResult = isPublicSshPtySession(noPty);
  const noClientResult = isPublicSshPtySession(noClient);

  assert.equal(noPtyResult.ok, false);
  assert.match(noPtyResult.error, /pty/i);
  assert.equal(noClientResult.ok, false);
  assert.match(noClientResult.error, /ssh/i);
});

test("registry lists only public ssh pty sessions", () => {
  const sessions = new Map([
    ["ssh-1", makeSession()],
    ["ssh-2", makeSession({ sshClient: { exec() {} }, conn: null, stream: null, pty: makeWritableStream() })],
    ["local-1", makeSession({ protocol: "local" })],
    ["mosh-1", makeSession({ protocol: "mosh" })],
  ]);
  const registry = createPublicSessionRegistry({ sessions });

  const hosts = registry.listPublicSessions();

  assert.deepEqual(hosts, [
    {
      sessionId: "ssh-1",
      hostname: "example.com",
      label: "prod",
      username: "root",
      protocol: "ssh",
      shellType: "bash",
      connected: true,
    },
    {
      sessionId: "ssh-2",
      hostname: "example.com",
      label: "prod",
      username: "root",
      protocol: "ssh",
      shellType: "bash",
      connected: true,
    },
  ]);
});

test("registry validates public sessions and rechecks live map membership", () => {
  const sessions = new Map([["ssh-1", makeSession()]]);
  const registry = createPublicSessionRegistry({ sessions });

  const live = registry.validatePublicSession("ssh-1");
  assert.equal(live.ok, true);
  assert.equal(live.summary.sessionId, "ssh-1");
  assert.equal(live.ptyStream, sessions.get("ssh-1").stream);
  assert.equal(live.sshClient, sessions.get("ssh-1").conn);

  sessions.delete("ssh-1");

  const gone = registry.validatePublicSession("ssh-1");
  assert.equal(gone.ok, false);
  assert.equal(gone.code, "SESSION_NOT_FOUND");
});

test("registry returns SESSION_NOT_PUBLIC for closed-out-of-scope sessions", () => {
  const sessions = new Map([["local-1", makeSession({ protocol: "local" })]]);
  const registry = createPublicSessionRegistry({ sessions });

  const result = registry.validatePublicSession("local-1");

  assert.equal(result.ok, false);
  assert.equal(result.code, "SESSION_NOT_PUBLIC");
});

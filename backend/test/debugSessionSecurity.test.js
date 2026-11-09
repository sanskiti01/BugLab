const assert = require("node:assert/strict");
const http = require("node:http");
const Module = require("node:module");
const { after, before, beforeEach, test } = require("node:test");
const express = require("express");
const jwt = require("jsonwebtoken");

process.env.JWT_SECRET = "test-jwt-secret";

const sessionIds = {
  alice: "64f000000000000000000001",
  bob: "64f000000000000000000002",
  created: "64f000000000000000000003",
};

const makeSession = (id, userId) => ({
  _id: id,
  userId,
  bugId: userId,
  language: "javascript",
  codeSubmitted: "const answer = 42;",
  status: "STARTED",
  timeSpent: 0,
  hintsUsed: 0,
  events: [],
  completedAt: null,
  createdAt: new Date("2026-01-01T00:00:00.000Z"),
});

const state = {
  sessions: [],
  calls: {},
};

const clone = (value) => structuredClone(value);
const recordCall = (name) => {
  state.calls[name] = (state.calls[name] || 0) + 1;
};

const DebugSession = {
  async create(data) {
    recordCall("create");
    const session = { _id: sessionIds.created, ...clone(data) };
    state.sessions.push(session);
    return clone(session);
  },
  find(filter) {
    recordCall("find");
    return {
      sort: async () =>
        clone(state.sessions.filter((session) => session.userId === filter.userId)),
      explain: async () => ({ filter }),
    };
  },
  async findOne(filter) {
    recordCall("findOne");
    const session = state.sessions.find(
      (item) => item._id === filter._id && item.userId === filter.userId
    );
    return session ? clone(session) : null;
  },
  async findOneAndUpdate(filter, update) {
    recordCall("update");
    const session = state.sessions.find(
      (item) => item._id === filter._id && item.userId === filter.userId
    );
    if (!session) return null;
    Object.assign(session, clone(update.$set));
    return clone(session);
  },
  async findOneAndDelete(filter) {
    recordCall("delete");
    const index = state.sessions.findIndex(
      (item) => item._id === filter._id && item.userId === filter.userId
    );
    if (index === -1) return null;
    return clone(state.sessions.splice(index, 1)[0]);
  },
  async aggregate() {
    recordCall("aggregate");
    return [];
  },
};

const modelPath = require.resolve("../src/models/debugSession");
const modelModule = new Module(modelPath);
modelModule.filename = modelPath;
modelModule.loaded = true;
modelModule.exports = DebugSession;
require.cache[modelPath] = modelModule;

const protect = require("../src/middleware/authMiddleware");
const adminOnly = require("../src/middleware/adminMiddleware");
const debugSessionRoutes = require("../src/routes/debugSessionRoutes");

const app = express();
app.use(express.json());
app.use("/api/debug-sessions", debugSessionRoutes);
app.get("/api/admin-check", protect, adminOnly, (req, res) =>
  res.status(200).json({ message: "Admin access granted" })
);

let server;
let baseUrl;

before(async () => {
  server = http.createServer(app);
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  await new Promise((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve()))
  );
  delete require.cache[modelPath];
});

beforeEach(() => {
  state.sessions = [makeSession(sessionIds.alice, 1), makeSession(sessionIds.bob, 2)];
  state.calls = {};
});

const tokenFor = (id, role = "USER") =>
  jwt.sign({ id, role, username: `user-${id}` }, process.env.JWT_SECRET, {
    expiresIn: "1h",
  });

const request = async (path, { token, method = "GET", body } = {}) => {
  const headers = {};
  if (token) headers.Authorization = `Bearer ${token}`;
  if (body !== undefined) headers["Content-Type"] = "application/json";

  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers,
    ...(body !== undefined && { body: JSON.stringify(body) }),
  });

  return {
    status: response.status,
    body: await response.json(),
  };
};

test("requires authentication on debug-session create, read, update, and delete", async () => {
  const writesBefore = { ...state.calls };
  const responses = await Promise.all([
    request("/api/debug-sessions"),
    request("/api/debug-sessions", {
      method: "POST",
      body: { bugId: 3, language: "js", codeSubmitted: "ok" },
    }),
    request(`/api/debug-sessions/${sessionIds.alice}`, {
      method: "PUT",
      body: { status: "COMPLETED" },
    }),
    request(`/api/debug-sessions/${sessionIds.alice}`, { method: "DELETE" }),
  ]);

  assert.deepEqual(responses.map((response) => response.status), [401, 401, 401, 401]);
  assert.deepEqual(state.calls, writesBefore);
});

test("valid users can list and read only their own sessions and perform CRUD", async () => {
  const token = tokenFor(1);
  const list = await request("/api/debug-sessions", { token });
  assert.equal(list.status, 200);
  assert.deepEqual(list.body.sessions.map((session) => session._id), [sessionIds.alice]);

  const ownSession = await request(`/api/debug-sessions/${sessionIds.alice}`, { token });
  assert.equal(ownSession.status, 200);
  assert.equal(ownSession.body.session.userId, 1);

  const create = await request("/api/debug-sessions", {
    token,
    method: "POST",
    body: {
      userId: 2,
      bugId: 4,
      language: "javascript",
      codeSubmitted: "const value = 1;",
    },
  });
  assert.equal(create.status, 201);
  assert.equal(create.body.session.userId, 1);

  const update = await request(`/api/debug-sessions/${sessionIds.alice}`, {
    token,
    method: "PUT",
    body: { codeSubmitted: "const value = 2;", timeSpent: 12 },
  });
  assert.equal(update.status, 200);
  assert.equal(update.body.session.codeSubmitted, "const value = 2;");

  const remove = await request(`/api/debug-sessions/${sessionIds.created}`, {
    token,
    method: "DELETE",
  });
  assert.equal(remove.status, 200);
  assert.equal(state.sessions.some((session) => session._id === sessionIds.created), false);
});

test("cross-user reads, updates, and deletes are denied without changing records", async () => {
  const token = tokenFor(2);
  const beforeRecords = clone(state.sessions);

  const read = await request(`/api/debug-sessions/${sessionIds.alice}`, { token });
  const update = await request(`/api/debug-sessions/${sessionIds.alice}`, {
    token,
    method: "PUT",
    body: { status: "COMPLETED" },
  });
  const remove = await request(`/api/debug-sessions/${sessionIds.alice}`, {
    token,
    method: "DELETE",
  });
  const list = await request("/api/debug-sessions", { token });

  assert.deepEqual([read.status, update.status, remove.status], [404, 404, 404]);
  assert.deepEqual(list.body.sessions.map((session) => session._id), [sessionIds.bob]);
  assert.deepEqual(state.sessions, beforeRecords);
});

test("rejects invalid create payloads without creating records", async () => {
  const token = tokenFor(1);
  const beforeRecords = clone(state.sessions);
  const invalidBodies = [
    { bugId: true, language: "js", codeSubmitted: "code" },
    { bugId: 3, language: "js", codeSubmitted: "code", events: "not-an-array" },
    { bugId: 3, language: "js", codeSubmitted: "code", events: [{ type: "BAD" }] },
  ];

  for (const body of invalidBodies) {
    const response = await request("/api/debug-sessions", {
      token,
      method: "POST",
      body,
    });
    assert.equal(response.status, 400);
  }

  assert.equal(state.calls.create || 0, 0);
  assert.deepEqual(state.sessions, beforeRecords);
});

test("rejects malformed IDs and invalid update fields without mutating records", async () => {
  const token = tokenFor(1);
  const beforeRecords = clone(state.sessions);
  const invalidUpdates = [
    { status: "ADMIN" },
    { userId: 2 },
    { $set: { status: "COMPLETED" } },
    { timeSpent: -1 },
    { events: [{ type: "UNSUPPORTED_EVENT" }] },
    { completedAt: "not-a-date" },
    {},
    [],
  ];

  const invalidIdResponses = await Promise.all(
    ["not-an-id"].flatMap((id) => [
      request(`/api/debug-sessions/${id}`, { token }),
      request(`/api/debug-sessions/${id}`, {
        token,
        method: "PUT",
        body: { status: "COMPLETED" },
      }),
      request(`/api/debug-sessions/${id}`, { token, method: "DELETE" }),
    ])
  );
  assert.deepEqual(invalidIdResponses.map((response) => response.status), [400, 400, 400]);

  for (const body of invalidUpdates) {
    const response = await request(`/api/debug-sessions/${sessionIds.alice}`, {
      token,
      method: "PUT",
      body,
    });
    assert.equal(response.status, 400);
  }

  const missingBody = await request(`/api/debug-sessions/${sessionIds.alice}`, {
    token,
    method: "PUT",
  });
  assert.equal(missingBody.status, 400);
  assert.equal(state.calls.update || 0, 0);
  assert.deepEqual(state.sessions, beforeRecords);
});

test("rejects invalid JWT claims and grants admin-only access only to admins", async () => {
  const invalidIdToken = jwt.sign(
    { id: "1", role: "USER", username: "user-1" },
    process.env.JWT_SECRET
  );
  assert.equal(
    (await request("/api/debug-sessions", { token: invalidIdToken })).status,
    401
  );
  assert.equal(
    (await request("/api/admin-check", { token: tokenFor(1) })).status,
    403
  );
  assert.equal(
    (await request("/api/admin-check", { token: tokenFor(2, "ADMIN") })).status,
    200
  );
});

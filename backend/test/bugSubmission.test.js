const assert = require("node:assert/strict");
const http = require("node:http");
const { after, before, beforeEach, test } = require("node:test");
const express = require("express");
const jwt = require("jsonwebtoken");
const protect = require("../src/middleware/authMiddleware");
const {
  createBugSubmissionHandler,
  createSubmissionStatusHandlers,
} = require("../src/controllers/bugSubmissionController");
const {
  CodeRunnerUnavailableError,
  executeTestCase,
} = require("../src/services/codeRunnerClient");
const {
  claimNextSubmission,
  processSubmission,
  recoverStaleSubmissions,
  runOneSubmission,
} = require("../src/services/codeSubmissionWorker");
const toPublicTestCase = require("../src/utils/publicTestCase");

process.env.JWT_SECRET = "bug-submission-test-secret";

const state = {};
let transactionQueue = Promise.resolve();

const matches = (item, where = {}) =>
  Object.entries(where).every(([key, value]) => {
    if (key === "userId_idempotencyKey") {
      return (
        item.userId === value.userId &&
        item.idempotencyKey === value.idempotencyKey
      );
    }
    if (key === "leaseUntil" && value?.lte) {
      return item.leaseUntil && item.leaseUntil <= value.lte;
    }
    if (key === "id" && value && typeof value === "object" && "in" in value) {
      return value.in.includes(item.id);
    }
    return item[key] === value;
  });

const applyData = (item, data) => {
  for (const [key, value] of Object.entries(data)) {
    if (value && typeof value === "object" && "increment" in value) {
      item[key] = (item[key] || 0) + value.increment;
    } else {
      item[key] = value;
    }
  }
  item.updatedAt = new Date();
  return item;
};

const prisma = {
  bug: {
    async findUnique({ where }) {
      return state.bugs.find((bug) => bug.id === where.id) || null;
    },
  },
  bugTestCase: {
    async findMany({ where, take }) {
      let cases = state.testCases.filter(
        (testCase) => testCase.bugId === where.bugId
      );
      if (where.id?.in) {
        cases = cases.filter((testCase) => where.id.in.includes(testCase.id));
      }
      if (take) cases = cases.slice(0, take);
      return cases;
    },
  },
  codeSubmission: {
    async findUnique({ where }) {
      return (
        state.submissions.find((submission) => matches(submission, where)) ||
        null
      );
    },
    async findFirst({ where }) {
      return (
        state.submissions.find((submission) => matches(submission, where)) ||
        null
      );
    },
    async findMany({ where, take }) {
      return state.submissions
        .filter((submission) => matches(submission, where))
        .slice(0, take);
    },
    async count({ where }) {
      return state.submissions.filter((submission) =>
        matches(submission, where)
      ).length;
    },
    async create({ data }) {
      const submission = {
        status: "QUEUED",
        results: [],
        solved: null,
        xpAwarded: 0,
        alreadySolved: false,
        attemptCount: 0,
        completedTestCases: 0,
        createdAt: new Date(),
        startedAt: null,
        finishedAt: null,
        ...data,
      };
      state.submissions.push(submission);
      return submission;
    },
    async update({ where, data, include }) {
      const submission = state.submissions.find((item) =>
        matches(item, where)
      );
      if (!submission) throw new Error("Submission not found");
      applyData(submission, data);
      if (data.startedAt) submission.startedAt = data.startedAt;
      if (include?.bug) {
        return {
          ...submission,
          bug: state.bugs.find((bug) => bug.id === submission.bugId),
        };
      }
      return submission;
    },
    async updateMany({ where, data }) {
      const selected = state.submissions.filter((submission) =>
        matches(submission, where)
      );
      for (const submission of selected) applyData(submission, data);
      return { count: selected.length };
    },
  },
  bugAttempt: {
    async findFirst({ where }) {
      return (
        state.attempts.find((attempt) => matches(attempt, where)) || null
      );
    },
    async create({ data }) {
      const attempt = { id: state.attempts.length + 1, ...data };
      state.attempts.push(attempt);
      return attempt;
    },
  },
  activity: {
    async upsert({ where, update, create }) {
      let activity = state.activities.find(
        (item) =>
          item.userId === where.userId_date.userId &&
          item.date.getTime() === where.userId_date.date.getTime()
      );
      if (!activity) {
        activity = { id: state.activities.length + 1, ...create };
        state.activities.push(activity);
      } else if (update.solved?.increment) {
        activity.solved += update.solved.increment;
      }
      return activity;
    },
  },
  user: {
    async update({ where, data }) {
      const user = state.users.find((item) => item.id === where.id);
      user.xp += data.xp.increment;
      return user;
    },
  },
  async $queryRaw(strings) {
    const query = strings.join(" ");
    if (query.includes('FROM "CodeSubmission"')) {
      return state.submissions
        .filter((submission) => submission.status === "QUEUED")
        .sort((left, right) => left.createdAt - right.createdAt)
        .slice(0, 1)
        .map(({ id }) => ({ id }));
    }
    return [];
  },
  async $transaction(callback) {
    let release;
    const previous = transactionQueue;
    transactionQueue = new Promise((resolve) => {
      release = resolve;
    });
    await previous;
    try {
      return await callback(prisma);
    } finally {
      release();
    }
  },
};

const app = express();
app.use(express.json());
app.post(
  "/api/bugs/:id/attempt",
  protect,
  createBugSubmissionHandler(prisma)
);
const submissionHandlers = createSubmissionStatusHandlers(prisma);
app.get("/api/submissions/by-key/:key", protect, submissionHandlers.getByKey);
app.get("/api/submissions/:id", protect, submissionHandlers.getById);

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
});

beforeEach(() => {
  state.bugs = [
    { id: 7, language: "JavaScript", difficulty: "EASY" },
  ];
  state.testCases = [
    {
      id: 71,
      bugId: 7,
      input: "visible input",
      expectedOutput: "visible output",
      isHidden: false,
    },
    {
      id: 72,
      bugId: 7,
      input: "hidden input",
      expectedOutput: "hidden output",
      isHidden: true,
    },
  ];
  state.submissions = [];
  state.attempts = [];
  state.users = [
    { id: 42, xp: 0 },
    { id: 84, xp: 0 },
  ];
  state.activities = [];
  transactionQueue = Promise.resolve();
  state.runnerCalls = [];
  state.runner = async (request) => {
    state.runnerCalls.push(request);
    if (request.code === "incorrect") {
      return { output: "wrong", timedOut: false, error: null };
    }
    return {
      output:
        request.input === "hidden input"
          ? "hidden output"
          : "visible output",
      timedOut: false,
      error: null,
    };
  };
});

const makeToken = (id = 42) =>
  jwt.sign(
    { id, username: `solver-${id}`, role: "USER" },
    process.env.JWT_SECRET,
    { expiresIn: "1h" }
  );
const token = makeToken();
const defaultKey = "f70c3c4c-59d1-4ad3-9c03-73b2cf41f73b";

const submit = async ({
  body = { submittedSolution: "correct" },
  authorization = `Bearer ${token}`,
  key = defaultKey,
  bugId = 7,
} = {}) => {
  const headers = {};
  if (authorization) headers.Authorization = authorization;
  if (key) headers["Idempotency-Key"] = key;
  if (body !== undefined) headers["Content-Type"] = "application/json";
  const response = await fetch(`${baseUrl}/api/bugs/${bugId}/attempt`, {
    method: "POST",
    headers,
    ...(body !== undefined && { body: JSON.stringify(body) }),
  });
  return { status: response.status, body: await response.json() };
};

const getSubmission = async (id, authToken = token) => {
  const response = await fetch(`${baseUrl}/api/submissions/${id}`, {
    headers: { Authorization: `Bearer ${authToken}` },
  });
  return { status: response.status, body: await response.json() };
};

const runWorker = (runner = state.runner) =>
  runOneSubmission({
    prisma,
    executeTestCase: async (request) => runner(request),
    workerId: "test-worker",
  });

test("accepts a submission asynchronously and exposes only safe completed results", async () => {
  const response = await submit();
  assert.equal(response.status, 202, JSON.stringify(response.body));
  assert.equal(response.body.status, "QUEUED");
  assert.equal(state.runnerCalls.length, 0);

  await runWorker();
  const result = await getSubmission(response.body.submissionId);

  assert.equal(result.status, 200);
  assert.equal(result.body.status, "COMPLETED");
  assert.equal(result.body.solved, true);
  assert.equal(result.body.xpAwarded, 10);
  assert.equal(state.users[0].xp, 10);
  assert.equal(state.activities[0].solved, 1);
  assert.equal(state.attempts[0].status, "PASSED");
  assert.equal(state.runnerCalls.length, 2);
  assert.equal(
    state.runnerCalls.every((call) => !Object.hasOwn(call, "expectedOutput")),
    true
  );
  const hidden = result.body.results.find((item) => item.hidden);
  assert.deepEqual(hidden, { index: 2, hidden: true, passed: true });
  assert.equal(JSON.stringify(result.body).includes("hidden input"), false);
  assert.equal(JSON.stringify(result.body).includes("hidden output"), false);
  assert.equal(Object.hasOwn(result.body, "submittedSolution"), false);
});

test("same idempotency key and payload returns the same job; changed payload conflicts", async () => {
  const [first, duplicate] = await Promise.all([submit(), submit()]);
  const conflict = await submit({
    body: { submittedSolution: "different code" },
  });

  assert.equal(first.status, 202);
  assert.equal(duplicate.status, 202);
  assert.equal(duplicate.body.submissionId, first.body.submissionId);
  assert.equal(conflict.status, 409);
  assert.equal(state.submissions.length, 1);
});

test("bounds the persistent queue", async () => {
  const keys = [
    defaultKey,
    "a1c85ba0-a130-4959-b9f2-4c8f86a3382a",
    "d3e1ff83-d9f9-4fac-bdb4-457b7064e13d",
    "37a6f2a0-953b-4215-8e51-a50406aa780b",
    "e09a5030-41bd-4c38-9ef0-f5e6ca55d6e5",
  ];
  for (const key of keys) {
    assert.equal((await submit({ key })).status, 202);
  }
  const full = await submit({
    key: "18c4cc02-2985-4698-b0c2-66c1335f9b36",
  });

  assert.equal(full.status, 503);
  assert.equal(state.submissions.length, 5);
});

test("concurrent unique submissions cannot exceed the queued-job limit", async () => {
  const keys = [
    defaultKey,
    "a1c85ba0-a130-4959-b9f2-4c8f86a3382a",
    "d3e1ff83-d9f9-4fac-bdb4-457b7064e13d",
    "37a6f2a0-953b-4215-8e51-a50406aa780b",
    "e09a5030-41bd-4c38-9ef0-f5e6ca55d6e5",
    "18c4cc02-2985-4698-b0c2-66c1335f9b36",
    "b30b7920-4b56-4cdf-9740-a911da60720a",
    "6c275baa-afc9-4303-a772-4e83000b86a6",
    "8a48facb-fb30-4374-89a8-19b5be1d697d",
    "550e8400-e29b-41d4-a716-446655440000",
  ];
  const responses = await Promise.all(keys.map((key) => submit({ key })));

  assert.equal(responses.filter((response) => response.status === 202).length, 5);
  assert.equal(responses.filter((response) => response.status === 503).length, 5);
  assert.equal(state.submissions.length, 5);
});

test("worker claims never exceed five active jobs", async () => {
  const keys = [
    defaultKey,
    "a1c85ba0-a130-4959-b9f2-4c8f86a3382a",
    "d3e1ff83-d9f9-4fac-bdb4-457b7064e13d",
    "37a6f2a0-953b-4215-8e51-a50406aa780b",
    "e09a5030-41bd-4c38-9ef0-f5e6ca55d6e5",
  ];
  for (const key of keys) await submit({ key });

  const claims = [];
  for (let index = 0; index < 6; index += 1) {
    claims.push(await claimNextSubmission(prisma, `worker-${index}`));
  }

  assert.equal(claims.filter(Boolean).length, 5);
  assert.equal(
    state.submissions.filter((submission) => submission.status === "RUNNING")
      .length,
    5
  );
});

test("by-key status lookup recovers a submission after the acceptance response is lost", async () => {
  const created = await submit();
  const response = await fetch(
    `${baseUrl}/api/submissions/by-key/${defaultKey}`,
    { headers: { Authorization: `Bearer ${token}` } }
  );
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.equal(body.submissionId, created.body.submissionId);
  assert.equal(Object.hasOwn(body, "submittedSolution"), false);
});

test("rejects unauthorized submissions and status requests", async () => {
  const unauthorized = await submit({ authorization: null });
  const accepted = await submit({ key: "a1c85ba0-a130-4959-b9f2-4c8f86a3382a" });
  const forbidden = await getSubmission(
    accepted.body.submissionId,
    makeToken(84)
  );

  assert.equal(unauthorized.status, 401);
  assert.equal(forbidden.status, 404);
  assert.equal(state.runnerCalls.length, 0);
});

test("client cannot forge success status or use invalid idempotency keys", async () => {
  const forged = await submit({
    body: { submittedSolution: "incorrect", status: "PASSED" },
  });
  const invalidKey = await submit({ key: "not-a-uuid" });

  assert.equal(forged.status, 400);
  assert.equal(invalidKey.status, 400);
  assert.equal(state.submissions.length, 0);
  assert.equal(state.users[0].xp, 0);
});

test("incorrect solutions complete with failed attempts and no XP", async () => {
  const accepted = await submit({ body: { submittedSolution: "incorrect" } });
  await runWorker();
  const result = await getSubmission(accepted.body.submissionId);

  assert.equal(result.body.status, "COMPLETED");
  assert.equal(result.body.solved, false);
  assert.equal(result.body.xpAwarded, 0);
  assert.equal(state.attempts[0].status, "FAILED");
  assert.equal(state.users[0].xp, 0);
});

test("runner infrastructure failures retry and later complete without duplicate XP", async () => {
  const accepted = await submit();
  let calls = 0;
  const intermittentRunner = async (request) => {
    calls += 1;
    if (calls === 1) {
      throw new CodeRunnerUnavailableError("runner unavailable");
    }
    return state.runner(request);
  };

  await runWorker(intermittentRunner);
  assert.equal(state.submissions[0].status, "QUEUED");
  assert.equal(state.attempts.length, 0);
  assert.equal(state.users[0].xp, 0);

  await runWorker(intermittentRunner);
  await runWorker();
  const result = await getSubmission(accepted.body.submissionId);

  assert.equal(result.body.status, "COMPLETED");
  assert.equal(result.body.xpAwarded, 10);
  assert.equal(state.attempts.length, 1);
  assert.equal(state.users[0].xp, 10);
  assert.equal(state.activities[0].solved, 1);
});

test("repeated runner failures exhaust retries without attempt or XP", async () => {
  const accepted = await submit();
  const unavailable = async () => {
    throw new CodeRunnerUnavailableError("runner unavailable");
  };

  await runWorker(unavailable);
  await runWorker(unavailable);
  await runWorker(unavailable);
  const result = await getSubmission(accepted.body.submissionId);

  assert.equal(result.body.status, "FAILED");
  assert.equal(state.attempts.length, 0);
  assert.equal(state.users[0].xp, 0);
});

test("expired worker leases are recovered and the job can complete", async () => {
  const accepted = await submit();
  const job = state.submissions[0];
  job.status = "RUNNING";
  job.workerId = "crashed-worker";
  job.leaseToken = "0f37a6a4-4a51-4629-9e83-a03171b2a065";
  job.leaseUntil = new Date(Date.now() - 1000);
  job.attemptCount = 1;
  job.completedTestCases = 1;
  job.results = [
    {
      index: 1,
      hidden: false,
      passed: true,
      input: "visible input",
      expectedOutput: "visible output",
      actualOutput: "visible output",
    },
  ];

  await recoverStaleSubmissions(prisma);
  assert.equal(job.status, "QUEUED");
  await runWorker();
  const result = await getSubmission(accepted.body.submissionId);

  assert.equal(result.body.status, "COMPLETED");
  assert.equal(state.users[0].xp, 10);
  assert.equal(state.runnerCalls.length, 1);
});

test("stale recovery never overfills an already-full queue", async () => {
  const keys = [
    defaultKey,
    "a1c85ba0-a130-4959-b9f2-4c8f86a3382a",
    "d3e1ff83-d9f9-4fac-bdb4-457b7064e13d",
    "37a6f2a0-953b-4215-8e51-a50406aa780b",
    "e09a5030-41bd-4c38-9ef0-f5e6ca55d6e5",
  ];
  for (const key of keys) await submit({ key });
  state.submissions.push({
    id: "stale-running-job",
    userId: 42,
    bugId: 7,
    status: "RUNNING",
    attemptCount: 1,
    leaseToken: "0f37a6a4-4a51-4629-9e83-a03171b2a065",
    leaseUntil: new Date(Date.now() - 1000),
    submittedSolution: "private-source",
  });

  await recoverStaleSubmissions(prisma);

  assert.equal(state.submissions.filter((job) => job.status === "QUEUED").length, 5);
  assert.equal(state.submissions.at(-1).status, "FAILED");
  assert.equal(state.submissions.at(-1).failureCode, "QUEUE_CAPACITY_EXCEEDED");
  assert.equal(state.submissions.at(-1).submittedSolution, null);
});

test("a worker with an expired lease cannot overwrite the replacement worker", async () => {
  await submit();
  const oldWorker = await claimNextSubmission(prisma, "old-worker");
  oldWorker.leaseUntil = new Date(Date.now() - 1000);
  state.submissions[0].leaseUntil = oldWorker.leaseUntil;

  await recoverStaleSubmissions(prisma);
  const replacement = await claimNextSubmission(prisma, "replacement-worker");
  assert.notEqual(replacement.leaseToken, oldWorker.leaseToken);

  await assert.rejects(
    processSubmission({
      prisma,
      executeTestCase: async () => {
        throw new Error("stale worker must not reach runner");
      },
      submission: oldWorker,
    }),
    { name: "LostSubmissionLeaseError" }
  );
  assert.equal(state.submissions[0].status, "RUNNING");
  assert.equal(state.submissions[0].leaseToken, replacement.leaseToken);

  await processSubmission({
    prisma,
    executeTestCase: async (request) => ({
      output:
        request.input === "hidden input" ? "hidden output" : "visible output",
      timedOut: false,
      error: null,
    }),
    submission: replacement,
  });
  assert.equal(state.submissions[0].status, "COMPLETED");
  assert.equal(state.users[0].xp, 10);
});

test("stale jobs beyond the retry limit fail without recording attempts or XP", async () => {
  await submit();
  const job = state.submissions[0];
  job.status = "RUNNING";
  job.leaseToken = "0f37a6a4-4a51-4629-9e83-a03171b2a065";
  job.leaseUntil = new Date(Date.now() - 1000);
  job.attemptCount = 3;

  await recoverStaleSubmissions(prisma);

  assert.equal(job.status, "FAILED");
  assert.equal(job.failureCode, "WORKER_RETRIES_EXHAUSTED");
  assert.equal(job.submittedSolution, null);
  assert.equal(state.attempts.length, 0);
  assert.equal(state.users[0].xp, 0);
});

test("duplicate successful jobs award XP only once", async () => {
  const first = await submit({
    key: "f70c3c4c-59d1-4ad3-9c03-73b2cf41f73b",
  });
  const second = await submit({
    key: "a1c85ba0-a130-4959-b9f2-4c8f86a3382a",
  });
  await runWorker();
  await runWorker();

  const firstStatus = await getSubmission(first.body.submissionId);
  const secondStatus = await getSubmission(second.body.submissionId);
  assert.deepEqual(
    [firstStatus.body.xpAwarded, secondStatus.body.xpAwarded].sort(),
    [0, 10]
  );
  assert.equal(state.attempts.length, 2);
  assert.equal(state.users[0].xp, 10);
  assert.equal(state.activities[0].solved, 1);
});

test("validates source size, JavaScript language and configured test cases before queueing", async () => {
  const tooLarge = await submit({
    body: { submittedSolution: "x".repeat(32 * 1024 + 1) },
  });
  assert.equal(tooLarge.status, 413);

  state.bugs[0].language = "Python";
  const unsupported = await submit({
    key: "a1c85ba0-a130-4959-b9f2-4c8f86a3382a",
    body: { submittedSolution: "print('no')" },
  });
  assert.equal(unsupported.status, 422);

  state.bugs[0].language = "JavaScript";
  state.testCases = [];
  const noCases = await submit({
    key: "d3e1ff83-d9f9-4fac-bdb4-457b7064e13d",
  });
  assert.equal(noCases.status, 422);
  assert.equal(state.submissions.length, 0);
});

test("public test-case responses omit hidden inputs and expected outputs", () => {
  const hiddenCase = toPublicTestCase(state.testCases[1]);
  const visibleCase = toPublicTestCase(state.testCases[0]);

  assert.deepEqual(hiddenCase, { id: 72, bugId: 7, isHidden: true });
  assert.equal(Object.hasOwn(visibleCase, "expectedOutput"), true);
  assert.equal(Object.hasOwn(visibleCase, "input"), true);
});

test("runner client refuses to execute without configured service credentials", async () => {
  const previousUrl = process.env.CODE_RUNNER_URL;
  const previousToken = process.env.CODE_RUNNER_TOKEN;
  delete process.env.CODE_RUNNER_URL;
  delete process.env.CODE_RUNNER_TOKEN;

  try {
    await assert.rejects(
      executeTestCase({ code: "solve", input: "input", timeoutMs: 1000 }),
      CodeRunnerUnavailableError
    );
  } finally {
    if (previousUrl === undefined) delete process.env.CODE_RUNNER_URL;
    else process.env.CODE_RUNNER_URL = previousUrl;
    if (previousToken === undefined) delete process.env.CODE_RUNNER_TOKEN;
    else process.env.CODE_RUNNER_TOKEN = previousToken;
  }
});

test("runner client preserves the authenticated one-test protocol", async () => {
  let received;
  const runnerServer = http.createServer(async (req, res) => {
    let body = "";
    for await (const chunk of req) body += chunk;
    received = {
      method: req.method,
      url: req.url,
      authorization: req.headers.authorization,
      body: JSON.parse(body),
    };
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ output: "out", timedOut: false, error: null }));
  });
  await new Promise((resolve, reject) => {
    runnerServer.once("error", reject);
    runnerServer.listen(0, "127.0.0.1", resolve);
  });

  const previousUrl = process.env.CODE_RUNNER_URL;
  const previousToken = process.env.CODE_RUNNER_TOKEN;
  process.env.CODE_RUNNER_URL = `http://127.0.0.1:${runnerServer.address().port}`;
  process.env.CODE_RUNNER_TOKEN = "test-runner-credential";

  try {
    const result = await executeTestCase({
      code: "function solve(input) { return input; }",
      input: "input",
      timeoutMs: 1000,
    });

    assert.deepEqual(result, { output: "out", timedOut: false, error: null });
    assert.equal(received.method, "POST");
    assert.equal(received.url, "/v1/execute");
    assert.equal(received.authorization, "Bearer test-runner-credential");
    assert.deepEqual(received.body, {
      language: "javascript",
      code: "function solve(input) { return input; }",
      input: "input",
      timeoutMs: 1000,
    });
  } finally {
    if (previousUrl === undefined) delete process.env.CODE_RUNNER_URL;
    else process.env.CODE_RUNNER_URL = previousUrl;
    if (previousToken === undefined) delete process.env.CODE_RUNNER_TOKEN;
    else process.env.CODE_RUNNER_TOKEN = previousToken;
    await new Promise((resolve, reject) =>
      runnerServer.close((error) => (error ? reject(error) : resolve()))
    );
  }
});

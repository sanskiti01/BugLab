# JavaScript submission and runner contracts

## Submission API

Submitting code does not execute it in Express. Authenticated requests use:

```http
POST /api/bugs/:bugId/attempt
Authorization: Bearer <user JWT>
Idempotency-Key: <UUID>
Content-Type: application/json
```

```json
{
  "submittedSolution": "function solve(input) { return input; }",
  "hintsUsed": 0,
  "timeSpent": 15
}
```

The API validates the challenge, payload, and test configuration, creates a
`QUEUED` PostgreSQL `CodeSubmission`, and responds with `202 Accepted`:

```json
{
  "submissionId": "f70c3c4c-59d1-4ad3-9c03-73b2cf41f73b",
  "status": "QUEUED",
  "statusUrl": "/api/submissions/f70c3c4c-59d1-4ad3-9c03-73b2cf41f73b"
}
```

The idempotency key is unique per user. Repeating the same key and payload
returns the same submission. Reusing the key with a different payload returns
`409 Conflict`.

The owner may poll:

```http
GET /api/submissions/:submissionId
Authorization: Bearer <user JWT>
```

`GET /api/submissions/by-key/:idempotencyKey` lets the authenticated owner
recover a submission if the original `202` response was lost. Missing and
other users' submissions both return `404`.

Submission states:

- `QUEUED`: persisted and waiting for a worker.
- `RUNNING`: leased by a worker; progress and safe test results are persisted.
- `COMPLETED`: all tests were evaluated, whether the solution passed or failed.
- `FAILED`: infrastructure or unrecoverable job failure; no solve XP is awarded.

A completed wrong answer has `status: "COMPLETED"` and `solved: false`. A
completed correct answer has `solved: true`; only the final PostgreSQL
transaction records the attempt and awards XP/activity once. A failed
individual test is a completed evaluation and records a `FAILED` `BugAttempt`.

The status response only returns visible test inputs/expected/actual outputs.
Hidden results contain only an ordinal and pass/fail (and safe timeout status).
Submitted source is never returned. The job's source field is cleared after a
terminal state; the existing `BugAttempt.submittedSolution` history field
continues to retain completed attempts. Hidden expected outputs remain in
PostgreSQL and are never sent to the runner.

## Worker operation

Start the API and one or more separate worker processes using the same backend
environment:

```powershell
npm start
npm run worker
```

Workers claim jobs atomically using PostgreSQL row locking (`SKIP LOCKED`) and
a database advisory lock. Leases expire after 30 seconds; crashed jobs are
re-queued and retried up to three worker claims. A global database-enforced
limit permits at most five active jobs and the API permits at most five queued
jobs. Scale by running additional worker processes, while retaining those
global limits. The API also runs a stale-lease recovery sweep every ten seconds.
If the queue is full when a lease expires, that recovered job fails safely
instead of exceeding the queue cap.

Workers execute submitted source only by calling the isolated runner over the
existing HTTP protocol. They never evaluate code locally. Progress is committed
after each case; after a crash, completed cases are reused and an interrupted
case may be rerun. Completion and XP are protected by a fenced lease token,
advisory transaction lock, and existing passed-attempt check.

## Isolated runner API

`POST {CODE_RUNNER_URL}/v1/execute`, authenticated with
`Authorization: Bearer {CODE_RUNNER_TOKEN}`:

```json
{
  "language": "javascript",
  "code": "function solve(input) { return input; }",
  "input": "test input",
  "timeoutMs": 1000
}
```

The runner executes each test in a fresh isolated job, calls `solve(input)`,
and serializes the result to match stored `expectedOutput`. The expected output
is never sent to the runner.

```json
{
  "output": "test output",
  "timedOut": false,
  "error": null
}
```

`output` is bounded to 8 KB and `error` to 1 KB. For a syntax/runtime failure,
return a short diagnostic in `error`; for a resource/time limit, return
`timedOut: true`. Do not include container/VM details, secrets, or expected
output.

## Required isolation controls

The runner is a hard deployment dependency; there is no local or in-process
fallback. It must enforce the timeout independently of the submitted program,
with CPU and memory quotas, a process limit, an unprivileged user, a read-only
filesystem with bounded scratch space, no network, no host mounts or secrets,
and per-job cleanup. It must authenticate API requests, cap concurrency and
queue depth, bound request/response sizes, and terminate timed-out jobs.
Treat JavaScript VM/context restrictions as defense-in-depth only, never as
the security boundary.

The backend sends one test input per runner request, sequentially, with a
1-second user-code limit and a 5-second HTTP timeout per test. A 20-case job
can therefore take close to 100 seconds if every runner call approaches its
timeout. The frontend polls submission status rather than holding one HTTP
request open for the full suite. Real deployment must still benchmark the
runner's complete fresh-VM lifecycle under five concurrent executions.

Runner configuration uses HTTPS (HTTP is accepted only for loopback
development addresses). If the runner URL/token is absent or the service is
unavailable, jobs are retried and ultimately marked `FAILED`; no `BugAttempt`
or XP is recorded for infrastructure failure.

## Current limitation

This repository contains the runner client and asynchronous submission
orchestration only. Firecracker and a compatible isolated runner have not been
deployed or verified. Automated tests use an injected runner function and
validate orchestration, not real JavaScript execution or sandbox security.
Do not claim code execution works until a real runner is deployed and passes
the security and latency tests.

Terminal job rows have no automated retention/purge job yet. Job source is
cleared on terminal state; the existing `BugAttempt.submittedSolution` history
still retains submitted code indefinitely, and attempt-history endpoints
currently return unpaginated results. Define a retention and pagination policy
before production use.

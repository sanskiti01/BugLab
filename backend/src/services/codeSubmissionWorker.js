const { randomUUID } = require("node:crypto");
const { CodeRunnerUnavailableError } = require("./codeRunnerClient");
const {
  evaluateTestCase,
  isJavaScript,
  LostSubmissionLeaseError,
  MAX_EXPECTED_OUTPUT_LENGTH,
  MAX_INPUT_LENGTH,
  MAX_TEST_CASES,
  recordVerifiedSubmission,
} = require("./bugSubmissionService");

const MAX_ACTIVE_SUBMISSIONS = 5;
const MAX_WORKER_ATTEMPTS = 3;
const SUBMISSION_QUEUE_LOCK = 8272026;
const LEASE_DURATION_MS = 30_000;
const MAX_QUEUED_SUBMISSIONS = 5;

const renewLease = async (prisma, submission) => {
  const leaseUntil = new Date(Date.now() + LEASE_DURATION_MS);
  const result = await prisma.codeSubmission.updateMany({
    where: {
      id: submission.id,
      status: "RUNNING",
      leaseToken: submission.leaseToken,
    },
    data: { leaseUntil },
  });
  if (result.count !== 1) throw new LostSubmissionLeaseError();
};

const recoverStaleSubmissions = async (prisma, now = new Date()) => {
  return prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT 1 FROM pg_advisory_xact_lock(${SUBMISSION_QUEUE_LOCK}, 1)`;
    const stale = await tx.codeSubmission.findMany({
      where: { status: "RUNNING", leaseUntil: { lte: now } },
      select: { id: true, attemptCount: true },
      orderBy: { leaseUntil: "asc" },
      take: 100,
    });
    let queuedCount = await tx.codeSubmission.count({
      where: { status: "QUEUED" },
    });

    for (const submission of stale) {
      const retriesExhausted =
        submission.attemptCount >= MAX_WORKER_ATTEMPTS;
      const queueFull = !retriesExhausted &&
        queuedCount >= MAX_QUEUED_SUBMISSIONS;
      const fail = retriesExhausted || queueFull;
      const recovered = await tx.codeSubmission.updateMany({
        where: {
          id: submission.id,
          status: "RUNNING",
          leaseUntil: { lte: now },
        },
        data: {
          status: fail ? "FAILED" : "QUEUED",
          workerId: null,
          leaseToken: null,
          leaseUntil: null,
          ...(fail && {
            submittedSolution: null,
            failureCode: retriesExhausted
              ? "WORKER_RETRIES_EXHAUSTED"
              : "QUEUE_CAPACITY_EXCEEDED",
            finishedAt: now,
          }),
        },
      });
      if (recovered.count === 1 && !fail) queuedCount += 1;
    }
  });
};

const claimNextSubmission = async (prisma, workerId) =>
  prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT 1 FROM pg_advisory_xact_lock(${SUBMISSION_QUEUE_LOCK}, 1)`;
    const activeCount = await tx.codeSubmission.count({
      where: { status: "RUNNING" },
    });
    if (activeCount >= MAX_ACTIVE_SUBMISSIONS) return null;

    const candidates = await tx.$queryRaw`
      SELECT "id"
      FROM "CodeSubmission"
      WHERE "status" = 'QUEUED'
      ORDER BY "createdAt" ASC
      LIMIT 1
      FOR UPDATE SKIP LOCKED
    `;
    if (candidates.length === 0) return null;

    return tx.codeSubmission.update({
      where: { id: candidates[0].id },
      data: {
        status: "RUNNING",
        workerId,
        leaseToken: randomUUID(),
        leaseUntil: new Date(Date.now() + LEASE_DURATION_MS),
        attemptCount: { increment: 1 },
        startedAt: new Date(),
        failureCode: null,
      },
      include: { bug: { select: { difficulty: true, language: true } } },
    });
  });

const markFailed = async (prisma, submission, failureCode) => {
  await prisma.codeSubmission.updateMany({
    where: {
      id: submission.id,
      status: "RUNNING",
      leaseToken: submission.leaseToken,
    },
    data: {
      status: "FAILED",
      submittedSolution: null,
      workerId: null,
      leaseToken: null,
      leaseUntil: null,
      failureCode,
      finishedAt: new Date(),
    },
  });
};

const retryOrFail = async (prisma, submission) => {
  const exhausted = submission.attemptCount >= MAX_WORKER_ATTEMPTS;
  await prisma.codeSubmission.updateMany({
    where: {
      id: submission.id,
      status: "RUNNING",
      leaseToken: submission.leaseToken,
    },
    data: {
      status: exhausted ? "FAILED" : "QUEUED",
      ...(exhausted && {
        submittedSolution: null,
        failureCode: "WORKER_RETRIES_EXHAUSTED",
        finishedAt: new Date(),
      }),
      workerId: null,
      leaseToken: null,
      leaseUntil: null,
    },
  });
};

const processSubmission = async ({
  prisma,
  executeTestCase,
  submission,
}) => {
  const testCases = await prisma.bugTestCase.findMany({
    where: {
      bugId: submission.bugId,
      id: { in: submission.testCaseIds },
    },
    select: {
      id: true,
      input: true,
      expectedOutput: true,
      isHidden: true,
    },
  });
  const testCasesById = new Map(testCases.map((testCase) => [testCase.id, testCase]));
  const orderedTestCases = submission.testCaseIds.map((id) =>
    testCasesById.get(id)
  );

  if (
    typeof submission.submittedSolution !== "string" ||
    !isJavaScript(submission.bug.language)
  ) {
    await markFailed(
      prisma,
      submission,
      typeof submission.submittedSolution === "string"
        ? "CHALLENGE_CHANGED"
        : "INVALID_SUBMISSION"
    );
    return;
  }

  if (
    orderedTestCases.length !== submission.totalTestCases ||
    orderedTestCases.some(
      (testCase) =>
        !testCase ||
        typeof testCase.input !== "string" ||
        testCase.input.length > MAX_INPUT_LENGTH ||
        typeof testCase.expectedOutput !== "string" ||
        testCase.expectedOutput.length > MAX_EXPECTED_OUTPUT_LENGTH
    )
  ) {
    await markFailed(prisma, submission, "TEST_CASES_CHANGED");
    return;
  }
  if (
    orderedTestCases.length === 0 ||
    orderedTestCases.length > MAX_TEST_CASES
  ) {
    await markFailed(prisma, submission, "INVALID_TEST_CASES");
    return;
  }

  const results = Array.isArray(submission.results)
    ? [...submission.results]
    : [];
  for (
    let index = submission.completedTestCases;
    index < orderedTestCases.length;
    index += 1
  ) {
    await renewLease(prisma, submission);
    const result = await evaluateTestCase({
      testCase: orderedTestCases[index],
      index,
      submittedSolution: submission.submittedSolution,
      executeTestCase,
    });
    results.push(result);
    const progress = await prisma.codeSubmission.updateMany({
      where: {
        id: submission.id,
        status: "RUNNING",
        leaseToken: submission.leaseToken,
      },
      data: {
        completedTestCases: index + 1,
        results,
        leaseUntil: new Date(Date.now() + LEASE_DURATION_MS),
      },
    });
    if (progress.count !== 1) throw new LostSubmissionLeaseError();
  }

  await renewLease(prisma, submission);
  await recordVerifiedSubmission({
    prisma,
    submission,
    results,
    solved: results.length === orderedTestCases.length &&
      results.every((result) => result.passed),
  });
};

const runOneSubmission = async ({ prisma, executeTestCase, workerId }) => {
  await recoverStaleSubmissions(prisma);
  const submission = await claimNextSubmission(prisma, workerId);
  if (!submission) return false;

  try {
    await processSubmission({ prisma, executeTestCase, submission });
  } catch (error) {
    if (error instanceof LostSubmissionLeaseError) return true;
    if (!(error instanceof CodeRunnerUnavailableError)) {
      console.error("Submission worker failed", {
        submissionId: submission.id,
        errorName: error?.name || "Error",
      });
    }

    try {
      await retryOrFail(prisma, submission);
    } catch (retryError) {
      console.error("Submission retry scheduling failed", {
        submissionId: submission.id,
        errorName: retryError?.name || "Error",
      });
    }
  }
  return true;
};

module.exports = {
  LEASE_DURATION_MS,
  MAX_ACTIVE_SUBMISSIONS,
  MAX_QUEUED_SUBMISSIONS,
  MAX_WORKER_ATTEMPTS,
  claimNextSubmission,
  processSubmission,
  recoverStaleSubmissions,
  runOneSubmission,
};

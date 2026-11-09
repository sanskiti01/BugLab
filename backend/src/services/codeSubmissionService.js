const { createHash, randomUUID } = require("node:crypto");
const {
  MAX_EXPECTED_OUTPUT_LENGTH,
  MAX_INPUT_LENGTH,
  MAX_TEST_CASES,
  isJavaScript,
} = require("./bugSubmissionService");

const MAX_QUEUED_SUBMISSIONS = 5;
const SUBMISSION_QUEUE_LOCK = 8272026;
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const IDEMPOTENCY_KEY_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SAFE_FAILURE_MESSAGES = {
  WORKER_RETRIES_EXHAUSTED: "The isolated runner failed repeatedly. Please try again.",
  QUEUE_CAPACITY_EXCEEDED: "The runner queue was full during recovery. Please submit again.",
  TEST_CASES_CHANGED: "Challenge tests changed before this submission ran. Please submit again.",
  INVALID_TEST_CASES: "Challenge test configuration is invalid.",
  INVALID_SUBMISSION: "The saved submission is invalid. Please submit again.",
  CHALLENGE_CHANGED: "This challenge is no longer available for JavaScript execution.",
};

class SubmissionError extends Error {
  constructor(status, message) {
    super(message);
    this.name = "SubmissionError";
    this.status = status;
  }
}

const hashRequest = ({ bugId, submittedSolution, hintsUsed, timeSpent }) =>
  createHash("sha256")
    .update(
      JSON.stringify({ bugId, submittedSolution, hintsUsed, timeSpent }),
      "utf8"
    )
    .digest("hex");

const publicResults = (results) =>
  Array.isArray(results)
    ? results.map((result) =>
        result?.hidden
          ? {
              index: result.index,
              hidden: true,
              passed: result.passed === true,
              ...(result.timedOut === true && { timedOut: true }),
            }
          : {
              index: result.index,
              hidden: false,
              passed: result.passed === true,
              ...(typeof result.input === "string" && { input: result.input }),
              ...(typeof result.expectedOutput === "string" && {
                expectedOutput: result.expectedOutput,
              }),
              ...(typeof result.actualOutput === "string" && {
                actualOutput: result.actualOutput,
              }),
              ...(result.timedOut === true && { timedOut: true }),
              ...(typeof result.error === "string" && { error: result.error }),
            }
      )
    : [];

const toPublicSubmission = (submission) => ({
  submissionId: submission.id,
  status: submission.status,
  progress: {
    completed: submission.completedTestCases,
    total: submission.totalTestCases,
  },
  results: publicResults(submission.results),
  ...(submission.solved !== null && { solved: submission.solved }),
  ...(submission.status === "COMPLETED" && {
    xpAwarded: submission.xpAwarded,
    alreadySolved: submission.alreadySolved,
  }),
  ...(submission.status === "FAILED" && {
    message:
      SAFE_FAILURE_MESSAGES[submission.failureCode] ||
      "The submission could not be completed. Please try again.",
  }),
  createdAt: submission.createdAt,
  startedAt: submission.startedAt,
  finishedAt: submission.finishedAt,
});

const findExistingByKey = (prisma, userId, idempotencyKey) =>
  prisma.codeSubmission.findUnique({
    where: { userId_idempotencyKey: { userId, idempotencyKey } },
  });

const createCodeSubmission = async ({
  prisma,
  userId,
  bugId,
  submittedSolution,
  hintsUsed,
  timeSpent,
  idempotencyKey,
}) => {
  if (
    typeof submittedSolution !== "string" ||
    submittedSolution.trim().length === 0
  ) {
    throw new SubmissionError(400, "Submitted solution is required");
  }
  if (Buffer.byteLength(submittedSolution, "utf8") > 32 * 1024) {
    throw new SubmissionError(413, "Submitted solution exceeds 32 KB");
  }
  if (!Number.isSafeInteger(hintsUsed) || hintsUsed < 0 || hintsUsed > 100) {
    throw new SubmissionError(400, "hintsUsed must be an integer from 0 to 100");
  }
  if (!Number.isSafeInteger(timeSpent) || timeSpent < 0 || timeSpent > 86400) {
    throw new SubmissionError(400, "timeSpent must be an integer from 0 to 86400");
  }
  if (
    typeof idempotencyKey !== "string" ||
    !IDEMPOTENCY_KEY_PATTERN.test(idempotencyKey)
  ) {
    throw new SubmissionError(400, "A valid Idempotency-Key UUID is required");
  }

  const requestHash = hashRequest({
    bugId,
    submittedSolution,
    hintsUsed,
    timeSpent,
  });
  const existing = await findExistingByKey(prisma, userId, idempotencyKey);
  if (existing) {
    if (existing.requestHash !== requestHash) {
      throw new SubmissionError(
        409,
        "Idempotency-Key was already used for a different submission"
      );
    }
    return existing;
  }

  const bug = await prisma.bug.findUnique({
    where: { id: bugId },
    select: { id: true, language: true },
  });
  if (!bug) throw new SubmissionError(404, "Bug not found");
  if (!isJavaScript(bug.language)) {
    throw new SubmissionError(422, "Only JavaScript challenges can be run");
  }

  const testCases = await prisma.bugTestCase.findMany({
    where: { bugId },
    orderBy: { id: "asc" },
    select: {
      id: true,
      input: true,
      expectedOutput: true,
      isHidden: true,
    },
    take: MAX_TEST_CASES + 1,
  });

  if (testCases.length === 0) {
    throw new SubmissionError(422, "This challenge has no configured test cases");
  }
  if (testCases.length > MAX_TEST_CASES) {
    throw new SubmissionError(422, "This challenge exceeds the test case limit");
  }
  if (
    testCases.some(
      (testCase) =>
        typeof testCase.input !== "string" ||
        testCase.input.length > MAX_INPUT_LENGTH ||
        typeof testCase.expectedOutput !== "string" ||
        testCase.expectedOutput.length > MAX_EXPECTED_OUTPUT_LENGTH
    )
  ) {
    throw new SubmissionError(422, "Challenge test case configuration is invalid");
  }

  try {
    return await prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT 1 FROM pg_advisory_xact_lock(${SUBMISSION_QUEUE_LOCK}, 1)`;
      const duplicate = await tx.codeSubmission.findUnique({
        where: { userId_idempotencyKey: { userId, idempotencyKey } },
      });
      if (duplicate) {
        if (duplicate.requestHash !== requestHash) {
          throw new SubmissionError(
            409,
            "Idempotency-Key was already used for a different submission"
          );
        }
        return duplicate;
      }

      const queuedCount = await tx.codeSubmission.count({
        where: { status: "QUEUED" },
      });
      if (queuedCount >= MAX_QUEUED_SUBMISSIONS) {
        throw new SubmissionError(503, "Submission queue is full. Please retry shortly.");
      }

      return tx.codeSubmission.create({
        data: {
          id: randomUUID(),
          userId,
          bugId,
          idempotencyKey,
          requestHash,
          submittedSolution,
          hintsUsed,
          timeSpent,
          testCaseIds: testCases.map((testCase) => testCase.id),
          totalTestCases: testCases.length,
        },
      });
    });
  } catch (error) {
    if (error instanceof SubmissionError) throw error;
    if (error.code === "P2002") {
      const duplicate = await findExistingByKey(prisma, userId, idempotencyKey);
      if (duplicate?.requestHash === requestHash) return duplicate;
      if (duplicate) {
        throw new SubmissionError(
          409,
          "Idempotency-Key was already used for a different submission"
        );
      }
    }
    throw error;
  }
};

const getPublicSubmission = async ({ prisma, userId, id }) => {
  if (typeof id !== "string" || !UUID_PATTERN.test(id)) {
    throw new SubmissionError(400, "Invalid submission ID");
  }
  const submission = await prisma.codeSubmission.findFirst({
    where: { id, userId },
  });
  if (!submission) throw new SubmissionError(404, "Submission not found");
  return toPublicSubmission(submission);
};

const getPublicSubmissionByKey = async ({ prisma, userId, idempotencyKey }) => {
  if (!IDEMPOTENCY_KEY_PATTERN.test(idempotencyKey || "")) {
    throw new SubmissionError(400, "Invalid idempotency key");
  }
  const submission = await findExistingByKey(prisma, userId, idempotencyKey);
  if (!submission) throw new SubmissionError(404, "Submission not found");
  return toPublicSubmission(submission);
};

module.exports = {
  IDEMPOTENCY_KEY_PATTERN,
  SubmissionError,
  createCodeSubmission,
  getPublicSubmission,
  getPublicSubmissionByKey,
  toPublicSubmission,
};

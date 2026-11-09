const MAX_TEST_CASES = 20;
const MAX_INPUT_LENGTH = 8 * 1024;
const MAX_EXPECTED_OUTPUT_LENGTH = 8 * 1024;
const EXECUTION_TIMEOUT_MS = 1000;
const XP_BY_DIFFICULTY = {
  EASY: 10,
  MEDIUM: 20,
  HARD: 30,
  BOSS: 50,
};

class LostSubmissionLeaseError extends Error {
  constructor() {
    super("Submission lease is no longer owned by this worker");
    this.name = "LostSubmissionLeaseError";
  }
}

const normalizedOutput = (output) => output.replace(/\r\n/g, "\n").trim();

const isJavaScript = (language) =>
  typeof language === "string" &&
  ["javascript", "js", "node.js", "node"].includes(
    language.trim().toLowerCase()
  );

const evaluateTestCase = async ({
  testCase,
  index,
  submittedSolution,
  executeTestCase,
}) => {
  const execution = await executeTestCase({
    code: submittedSolution,
    input: testCase.input,
    language: "javascript",
    timeoutMs: EXECUTION_TIMEOUT_MS,
  });
  const output = execution.output || "";
  const passed =
    !execution.timedOut &&
    !execution.error &&
    normalizedOutput(output) === normalizedOutput(testCase.expectedOutput);

  return {
    index: index + 1,
    hidden: testCase.isHidden,
    passed,
    ...(testCase.isHidden
      ? {}
      : {
          input: testCase.input,
          expectedOutput: testCase.expectedOutput,
          actualOutput: output,
          ...(execution.timedOut && { timedOut: true }),
          ...(execution.error && { error: "Code could not be executed" }),
        }),
  };
};

const recordVerifiedSubmission = async ({
  prisma,
  submission,
  results,
  solved,
}) => {
  const xpReward = solved ? XP_BY_DIFFICULTY[submission.bug.difficulty] || 10 : 0;
  const date = new Date();
  date.setUTCHours(0, 0, 0, 0);

  return prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT 1 FROM pg_advisory_xact_lock(${submission.userId}, ${submission.bugId})`;

    const claimed = await tx.codeSubmission.updateMany({
      where: {
        id: submission.id,
        status: "RUNNING",
        leaseToken: submission.leaseToken,
      },
      data: {
        status: "COMPLETED",
        completedTestCases: submission.totalTestCases,
        results,
        solved,
        xpAwarded: 0,
        alreadySolved: false,
        submittedSolution: null,
        workerId: null,
        leaseToken: null,
        leaseUntil: null,
        failureCode: null,
        finishedAt: new Date(),
      },
    });

    if (claimed.count !== 1) {
      throw new LostSubmissionLeaseError();
    }

    const existingSolve = solved
      ? await tx.bugAttempt.findFirst({
          where: {
            userId: submission.userId,
            bugId: submission.bugId,
            status: "PASSED",
          },
          select: { id: true },
        })
      : null;
    const firstSolve = solved && !existingSolve;

    const attempt = await tx.bugAttempt.create({
      data: {
        userId: submission.userId,
        bugId: submission.bugId,
        submittedSolution: submission.submittedSolution,
        status: solved ? "PASSED" : "FAILED",
        hintsUsed: submission.hintsUsed,
        timeSpent: submission.timeSpent,
      },
    });

    await tx.activity.upsert({
      where: {
        userId_date: { userId: submission.userId, date },
      },
      update: firstSolve ? { solved: { increment: 1 } } : {},
      create: {
        userId: submission.userId,
        date,
        solved: firstSolve ? 1 : 0,
      },
    });

    if (firstSolve) {
      await tx.user.update({
        where: { id: submission.userId },
        data: { xp: { increment: xpReward } },
      });
    }

    await tx.codeSubmission.update({
      where: { id: submission.id },
      data: {
        xpAwarded: firstSolve ? xpReward : 0,
        alreadySolved: solved && !firstSolve,
      },
    });

    return { attempt, solved, xpAwarded: firstSolve ? xpReward : 0 };
  });
};

module.exports = {
  EXECUTION_TIMEOUT_MS,
  MAX_EXPECTED_OUTPUT_LENGTH,
  MAX_INPUT_LENGTH,
  MAX_TEST_CASES,
  LostSubmissionLeaseError,
  isJavaScript,
  evaluateTestCase,
  recordVerifiedSubmission,
};

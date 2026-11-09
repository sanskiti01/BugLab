require("dotenv").config();

const os = require("node:os");
const { PrismaClient } = require("@prisma/client");
const { PrismaPg } = require("@prisma/adapter-pg");
const { executeTestCase } = require("../services/codeRunnerClient");
const { runOneSubmission } = require("../services/codeSubmissionWorker");

const adapter = new PrismaPg({
  connectionString: process.env.DATABASE_URL,
});
const prisma = new PrismaClient({ adapter });
const workerId = `${os.hostname()}-${process.pid}`;
const pollIntervalMs = 500;
const maxBackoffMs = 10_000;
let stopping = false;

process.on("SIGINT", () => {
  stopping = true;
});
process.on("SIGTERM", () => {
  stopping = true;
});

const delay = (milliseconds) =>
  new Promise((resolve) => setTimeout(resolve, milliseconds));

const main = async () => {
  console.log("Code submission worker started", { workerId });
  let backoffMs = pollIntervalMs;
  try {
    while (!stopping) {
      try {
        const claimed = await runOneSubmission({
          prisma,
          executeTestCase,
          workerId,
        });
        backoffMs = pollIntervalMs;
        if (!claimed && !stopping) await delay(pollIntervalMs);
      } catch (error) {
        console.error("Submission worker cycle failed; retrying", {
          errorName: error?.name || "Error",
          retryInMs: backoffMs,
        });
        if (!stopping) await delay(backoffMs);
        backoffMs = Math.min(backoffMs * 2, maxBackoffMs);
      }
    }
  } finally {
    await prisma.$disconnect();
    console.log("Code submission worker stopped", { workerId });
  }
};

main().catch((error) => {
  console.error("Code submission worker exited", {
    errorName: error?.name || "Error",
  });
  process.exitCode = 1;
});

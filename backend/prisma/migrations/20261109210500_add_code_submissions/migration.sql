CREATE TYPE "SubmissionStatus" AS ENUM ('QUEUED', 'RUNNING', 'COMPLETED', 'FAILED');

CREATE TABLE "CodeSubmission" (
    "id" UUID NOT NULL,
    "userId" INTEGER NOT NULL,
    "bugId" INTEGER NOT NULL,
    "status" "SubmissionStatus" NOT NULL DEFAULT 'QUEUED',
    "idempotencyKey" TEXT NOT NULL,
    "requestHash" TEXT NOT NULL,
    "submittedSolution" TEXT,
    "hintsUsed" INTEGER NOT NULL DEFAULT 0,
    "timeSpent" INTEGER NOT NULL DEFAULT 0,
    "testCaseIds" INTEGER[] NOT NULL,
    "totalTestCases" INTEGER NOT NULL DEFAULT 0,
    "completedTestCases" INTEGER NOT NULL DEFAULT 0,
    "results" JSONB NOT NULL DEFAULT '[]',
    "solved" BOOLEAN,
    "xpAwarded" INTEGER NOT NULL DEFAULT 0,
    "alreadySolved" BOOLEAN NOT NULL DEFAULT false,
    "attemptCount" INTEGER NOT NULL DEFAULT 0,
    "workerId" TEXT,
    "leaseToken" UUID,
    "leaseUntil" TIMESTAMP(3),
    "failureCode" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "startedAt" TIMESTAMP(3),
    "finishedAt" TIMESTAMP(3),

    CONSTRAINT "CodeSubmission_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "CodeSubmission_userId_idempotencyKey_key"
    ON "CodeSubmission"("userId", "idempotencyKey");
CREATE INDEX "CodeSubmission_status_createdAt_idx"
    ON "CodeSubmission"("status", "createdAt");
CREATE INDEX "CodeSubmission_status_leaseUntil_idx"
    ON "CodeSubmission"("status", "leaseUntil");
CREATE INDEX "CodeSubmission_userId_createdAt_idx"
    ON "CodeSubmission"("userId", "createdAt");

ALTER TABLE "CodeSubmission"
    ADD CONSTRAINT "CodeSubmission_bugId_fkey"
    FOREIGN KEY ("bugId") REFERENCES "Bug"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "CodeSubmission"
    ADD CONSTRAINT "CodeSubmission_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

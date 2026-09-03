-- CreateTable
CREATE TABLE "BugTestCase" (
    "id" SERIAL NOT NULL,
    "bugId" INTEGER NOT NULL,
    "input" TEXT NOT NULL,
    "expectedOutput" TEXT NOT NULL,
    "isHidden" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "BugTestCase_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "BugTestCase_bugId_idx" ON "BugTestCase"("bugId");

-- AddForeignKey
ALTER TABLE "BugTestCase" ADD CONSTRAINT "BugTestCase_bugId_fkey" FOREIGN KEY ("bugId") REFERENCES "Bug"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

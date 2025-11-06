-- CreateTable
CREATE TABLE "Session" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "passwordHash" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "endedAt" DATETIME
);

-- CreateTable
CREATE TABLE "PromptSubmission" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "sessionId" TEXT NOT NULL,
    "prompt" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "rootSubmissionId" TEXT,
    "parentSubmissionId" TEXT,
    "revisionIndex" INTEGER NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "imageData" TEXT,
    "imageMimeType" TEXT,
    "errorMessage" TEXT,
    CONSTRAINT "PromptSubmission_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "Session" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "PromptSubmission_rootSubmissionId_fkey" FOREIGN KEY ("rootSubmissionId") REFERENCES "PromptSubmission" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "PromptSubmission_parentSubmissionId_fkey" FOREIGN KEY ("parentSubmissionId") REFERENCES "PromptSubmission" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "PromptSubmission_sessionId_idx" ON "PromptSubmission"("sessionId");

-- CreateIndex
CREATE INDEX "PromptSubmission_rootSubmissionId_idx" ON "PromptSubmission"("rootSubmissionId");

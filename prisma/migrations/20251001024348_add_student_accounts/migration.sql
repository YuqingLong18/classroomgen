-- CreateTable
CREATE TABLE "Student" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "username" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "sessionId" TEXT NOT NULL,
    CONSTRAINT "Student_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "Session" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_PromptSubmission" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "sessionId" TEXT NOT NULL,
    "prompt" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "studentId" TEXT,
    "rootSubmissionId" TEXT,
    "parentSubmissionId" TEXT,
    "revisionIndex" INTEGER NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "imageData" TEXT,
    "imageMimeType" TEXT,
    "errorMessage" TEXT,
    "isShared" BOOLEAN NOT NULL DEFAULT false,
    CONSTRAINT "PromptSubmission_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "Session" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "PromptSubmission_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "Student" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "PromptSubmission_rootSubmissionId_fkey" FOREIGN KEY ("rootSubmissionId") REFERENCES "PromptSubmission" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "PromptSubmission_parentSubmissionId_fkey" FOREIGN KEY ("parentSubmissionId") REFERENCES "PromptSubmission" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_PromptSubmission" ("createdAt", "errorMessage", "id", "imageData", "imageMimeType", "parentSubmissionId", "prompt", "revisionIndex", "role", "rootSubmissionId", "sessionId", "status") SELECT "createdAt", "errorMessage", "id", "imageData", "imageMimeType", "parentSubmissionId", "prompt", "revisionIndex", "role", "rootSubmissionId", "sessionId", "status" FROM "PromptSubmission";
DROP TABLE "PromptSubmission";
ALTER TABLE "new_PromptSubmission" RENAME TO "PromptSubmission";
CREATE INDEX "PromptSubmission_sessionId_idx" ON "PromptSubmission"("sessionId");
CREATE INDEX "PromptSubmission_rootSubmissionId_idx" ON "PromptSubmission"("rootSubmissionId");
CREATE INDEX "PromptSubmission_studentId_idx" ON "PromptSubmission"("studentId");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- CreateIndex
CREATE UNIQUE INDEX "Student_sessionId_username_key" ON "Student"("sessionId", "username");

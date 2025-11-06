-- CreateTable
CREATE TABLE "SubmissionLike" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "submissionId" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "SubmissionLike_submissionId_fkey" FOREIGN KEY ("submissionId") REFERENCES "PromptSubmission" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "SubmissionLike_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "Student" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "SubmissionComment" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "submissionId" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "SubmissionComment_submissionId_fkey" FOREIGN KEY ("submissionId") REFERENCES "PromptSubmission" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "SubmissionComment_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "Student" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "SubmissionLike_studentId_idx" ON "SubmissionLike"("studentId");

-- CreateIndex
CREATE UNIQUE INDEX "SubmissionLike_submissionId_studentId_key" ON "SubmissionLike"("submissionId", "studentId");

-- CreateIndex
CREATE INDEX "SubmissionComment_submissionId_idx" ON "SubmissionComment"("submissionId");

-- CreateIndex
CREATE INDEX "SubmissionComment_studentId_idx" ON "SubmissionComment"("studentId");

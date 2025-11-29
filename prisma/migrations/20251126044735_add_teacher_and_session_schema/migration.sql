/*
  Warnings:

  - You are about to drop the column `passwordHash` on the `Session` table. All the data in the column will be lost.
  - Added the required column `classroomCode` to the `Session` table without a default value. This is not possible if the table is not empty.
  - Added the required column `teacherId` to the `Session` table without a default value. This is not possible if the table is not empty.

*/
-- CreateTable
CREATE TABLE "Teacher" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "username" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "displayName" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Seed a fallback teacher for any legacy sessions (external auth will create real teachers)
INSERT INTO "Teacher" ("id", "username", "passwordHash", "displayName")
VALUES ('legacy-teacher', 'legacy-teacher', '', 'Legacy Teacher');

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Session" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "classroomCode" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "chatEnabled" BOOLEAN NOT NULL DEFAULT true,
    "maxStudentEdits" INTEGER NOT NULL DEFAULT 3,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "endedAt" DATETIME,
    "teacherId" TEXT NOT NULL,
    CONSTRAINT "Session_teacherId_fkey" FOREIGN KEY ("teacherId") REFERENCES "Teacher" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
INSERT INTO "new_Session" (
    "chatEnabled",
    "createdAt",
    "endedAt",
    "id",
    "isActive",
    "maxStudentEdits",
    "classroomCode",
    "teacherId"
) SELECT
    "chatEnabled",
    "createdAt",
    "endedAt",
    "id",
    "isActive",
    "maxStudentEdits",
    printf('LEGACY-%s', substr("id", 1, 8)),
    'legacy-teacher'
FROM "Session";
DROP TABLE "Session";
ALTER TABLE "new_Session" RENAME TO "Session";
CREATE UNIQUE INDEX "Session_classroomCode_key" ON "Session"("classroomCode");
CREATE INDEX "Session_teacherId_idx" ON "Session"("teacherId");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- CreateIndex
CREATE UNIQUE INDEX "Teacher_username_key" ON "Teacher"("username");

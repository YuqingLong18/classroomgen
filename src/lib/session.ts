import { cookies } from 'next/headers';
import { SubmissionStatus } from '@prisma/client';
import { prisma } from './prisma';
import { roleCookieName, sessionCookieName, studentCookieName, UserRole } from './auth';

export async function generateUniqueClassroomCode() {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const raw = Math.floor(10000000 + Math.random() * 90000000);
    const classroomCode = raw.toString();
    const existing = await prisma.session.findFirst({
      where: { classroomCode },
      select: { id: true },
    });

    if (!existing) {
      return classroomCode;
    }
  }

  throw new Error('Unable to generate a unique classroom code');
}

export async function deactivateTeacherSessions(teacherId: string, excludeSessionId?: string) {
  await prisma.session.updateMany({
    where: {
      teacherId,
      isActive: true,
      ...(excludeSessionId ? { id: { not: excludeSessionId } } : {}),
    },
    data: {
      isActive: false,
      endedAt: new Date(),
    },
  });
}

export async function getSessionFromCookies() {
  const cookieStore = await cookies();
  const sessionId = cookieStore.get(sessionCookieName)?.value;
  const role = cookieStore.get(roleCookieName)?.value as UserRole | undefined;
  const studentId = cookieStore.get(studentCookieName)?.value;
  return { sessionId, role, studentId };
}

export async function getSubmissionWithRemainingEdits(submissionId: string) {
  const submission = await prisma.promptSubmission.findUnique({
    where: { id: submissionId },
  });

  if (!submission) {
    return null;
  }

  const rootId = submission.rootSubmissionId ?? submission.id;
  const chainCount = await prisma.promptSubmission.count({
    where: {
      OR: [
        { id: rootId },
        { rootSubmissionId: rootId },
      ],
      status: SubmissionStatus.SUCCESS,
    },
  });

  const session = await prisma.session.findUnique({
    where: { id: submission.sessionId },
    select: { maxStudentEdits: true },
  });

  const maxEdits = session?.maxStudentEdits ?? 3;
  const remaining = Math.max(0, maxEdits - chainCount);

  return { submission, remaining };
}

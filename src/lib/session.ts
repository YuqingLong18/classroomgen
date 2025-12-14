import { cookies } from 'next/headers';
import { StudentStatus, SubmissionStatus } from '@prisma/client';
import { prisma } from './prisma';
import { roleCookieName, sessionCookieName, studentCookieName, teacherSessionCookieName, UserRole } from './auth';

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
  const teacherSessionId = cookieStore.get(teacherSessionCookieName)?.value;
  return { sessionId, role, studentId, teacherSessionId };
}

export async function getTeacherSessionId() {
  const cookieStore = await cookies();
  const teacherSessionId = cookieStore.get(teacherSessionCookieName)?.value;
  const currentRole = cookieStore.get(roleCookieName)?.value as UserRole | undefined;
  const currentSessionId = cookieStore.get(sessionCookieName)?.value;
  
  // If currently a teacher, return current session ID
  if (currentRole === 'teacher' && currentSessionId) {
    return currentSessionId;
  }
  
  // Otherwise, return teacher session ID from cookie (if viewing as student)
  return teacherSessionId;
}

/**
 * Verifies that the user has teacher access (either as current role or via teacher session cookie)
 * Returns the teacher session ID if access is granted, null otherwise
 */
export async function verifyTeacherAccess(): Promise<{ sessionId: string; isViewingAsStudent: boolean } | null> {
  const cookieStore = await cookies();
  const currentRole = cookieStore.get(roleCookieName)?.value as UserRole | undefined;
  const currentSessionId = cookieStore.get(sessionCookieName)?.value;
  const teacherSessionId = cookieStore.get(teacherSessionCookieName)?.value;
  
  // If currently a teacher, return current session ID
  if (currentRole === 'teacher' && currentSessionId) {
    // Verify session exists and is active
    const session = await prisma.session.findUnique({
      where: { id: currentSessionId },
      select: { id: true, isActive: true },
    });
    if (session && session.isActive) {
      return { sessionId: currentSessionId, isViewingAsStudent: false };
    }
  }
  
  // Check teacher session cookie (when viewing as student)
  if (teacherSessionId) {
    const session = await prisma.session.findUnique({
      where: { id: teacherSessionId },
      select: { id: true, isActive: true },
    });
    if (session && session.isActive) {
      return { sessionId: teacherSessionId, isViewingAsStudent: true };
    }
  }
  
  return null;
}

export async function requireActiveStudent(sessionId: string, studentId: string) {
  const student = await prisma.student.findUnique({
    where: { id: studentId },
    select: { id: true, sessionId: true, status: true, username: true },
  });

  if (!student || student.sessionId !== sessionId) {
    return { active: false as const, reason: 'not-found' as const, student: null };
  }

  if (student.status !== StudentStatus.ACTIVE) {
    return { active: false as const, reason: 'removed' as const, student };
  }

  return { active: true as const, student };
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

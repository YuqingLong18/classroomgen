import { Prisma, Teacher } from '@prisma/client';
import { NextResponse } from 'next/server';

import { roleCookieName, sessionCookieName, studentCookieName, teacherSessionCookieName } from './auth';
import { AuthSession, normalizeEmail } from './auth-session';
import { prisma } from './prisma';
import { deactivateTeacherSessions, generateUniqueClassroomCode } from './session';

const SESSION_COOKIE_MAX_AGE = 60 * 60 * 6;

const teacherSessionSelect = {
  id: true,
  username: true,
  email: true,
  displayName: true,
} satisfies Prisma.TeacherSelect;

function teacherCookieOptions() {
  return {
    httpOnly: true,
    sameSite: 'lax' as const,
    path: '/',
    maxAge: SESSION_COOKIE_MAX_AGE,
  };
}

function normalizeTeacherUsername(value?: string | null) {
  const normalized = String(value ?? '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '-')
    .replace(/[^a-z0-9._-]/g, '');

  return normalized;
}

function deriveTeacherUsernameCandidates(authSession: AuthSession) {
  const email = normalizeEmail(authSession.email);
  const emailLocalPart = email.includes('@') ? email.split('@')[0] : email;
  const candidates = [authSession.username, emailLocalPart]
    .map((value) => normalizeTeacherUsername(value))
    .filter(Boolean);

  return [...new Set(candidates)];
}

function resolveTeacherDisplayName(authSession: AuthSession) {
  const displayName = String(authSession.name ?? '').trim();
  return displayName || null;
}

async function buildUniqueTeacherUsername(baseValue: string) {
  const base = normalizeTeacherUsername(baseValue) || 'teacher';

  for (let suffix = 0; suffix < 100; suffix += 1) {
    const candidate = suffix === 0 ? base : `${base}-${suffix + 1}`;
    const existing = await prisma.teacher.findUnique({
      where: { username: candidate },
      select: { id: true },
    });

    if (!existing) {
      return candidate;
    }
  }

  return `${base}-${Date.now().toString(36)}`;
}

async function updateTeacherIdentity(teacher: Pick<Teacher, 'id' | 'email' | 'displayName'>, email: string, displayName: string | null) {
  const data: { email?: string; displayName?: string | null } = {};

  if (!teacher.email) {
    data.email = email;
  }

  if (!teacher.displayName && displayName) {
    data.displayName = displayName;
  }

  if (Object.keys(data).length === 0) {
    return prisma.teacher.findUnique({
      where: { id: teacher.id },
      select: teacherSessionSelect,
    });
  }

  return prisma.teacher.update({
    where: { id: teacher.id },
    data,
    select: teacherSessionSelect,
  });
}

export async function findOrCreateTeacherFromMicrosoft(authSession: AuthSession) {
  const email = normalizeEmail(authSession.email);

  if (!email) {
    throw new Error('Microsoft teacher login requires an email address.');
  }

  const displayName = resolveTeacherDisplayName(authSession);
  const existingByEmail = await prisma.teacher.findUnique({
    where: { email },
    select: teacherSessionSelect,
  });

  if (existingByEmail) {
    return (
      (await updateTeacherIdentity(existingByEmail, email, displayName)) ??
      existingByEmail
    );
  }

  const usernameCandidates = deriveTeacherUsernameCandidates(authSession);

  for (const username of usernameCandidates) {
    const existingByUsername = await prisma.teacher.findUnique({
      where: { username },
      select: teacherSessionSelect,
    });

    if (!existingByUsername) {
      continue;
    }

    if (existingByUsername.email && existingByUsername.email !== email) {
      continue;
    }

    return (
      (await updateTeacherIdentity(existingByUsername, email, displayName)) ??
      existingByUsername
    );
  }

  const username = await buildUniqueTeacherUsername(usernameCandidates[0] || email.split('@')[0]);

  return prisma.teacher.create({
    data: {
      username,
      email,
      displayName,
      passwordHash: '',
    },
    select: teacherSessionSelect,
  });
}

export async function createOrResumeTeacherClassroom(teacherId: string) {
  const sessionDurationMinutes = parseInt(process.env.CLASSROOM_SESSION_DURATION_MINUTES || '1440', 10);
  const validSessionThreshold = new Date(Date.now() - sessionDurationMinutes * 60 * 1000);

  const existingSession = await prisma.session.findFirst({
    where: {
      teacherId,
      isActive: true,
      createdAt: {
        gte: validSessionThreshold,
      },
    },
    select: {
      id: true,
      classroomCode: true,
      createdAt: true,
      chatEnabled: true,
      maxStudentEdits: true,
    },
    orderBy: {
      createdAt: 'desc',
    },
  });

  if (existingSession) {
    return existingSession;
  }

  await deactivateTeacherSessions(teacherId);

  for (let attempt = 0; attempt < 5; attempt += 1) {
    const classroomCode = await generateUniqueClassroomCode();
    try {
      const session = await prisma.session.create({
        data: {
          teacherId,
          classroomCode,
        },
        select: {
          id: true,
          classroomCode: true,
          createdAt: true,
          chatEnabled: true,
          maxStudentEdits: true,
        },
      });

      return session;
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002' &&
        attempt < 4
      ) {
        continue;
      }

      throw error;
    }
  }

  throw new Error('Unable to create or resume a classroom session.');
}

export function applyTeacherSessionCookies(response: NextResponse, sessionId: string) {
  response.cookies.delete(studentCookieName);
  response.cookies.delete(teacherSessionCookieName);
  response.cookies.set(sessionCookieName, sessionId, teacherCookieOptions());
  response.cookies.set(roleCookieName, 'teacher', teacherCookieOptions());
}

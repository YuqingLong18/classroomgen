import { NextResponse } from 'next/server';
import { Prisma } from '@prisma/client';
import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { roleCookieName, sessionCookieName, studentCookieName } from '@/lib/auth';
import { deactivateTeacherSessions, generateUniqueClassroomCode } from '@/lib/session';

const bodySchema = z.object({
  username: z.string().trim().min(1, 'Username is required'),
  password: z.string().min(1, 'Password is required'),
});

// External authentication service URL
const AUTH_SERVICE_URL = process.env.AUTH_SERVICE_URL || 'http://localhost:3000';

export async function POST(request: Request) {
  try {
    const json = await request.json();
    const { username, password } = bodySchema.parse(json);

    // Verify credentials
    let externalUsername: string | null = null;
    // let authServiceAvailable = true;

    // 1. Try External Authentication
    try {
      const authResponse = await fetch(`${AUTH_SERVICE_URL}/verify`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password }),
      });

      if (authResponse.ok) {
        const authResult = await authResponse.json();
        if (authResult.success && authResult.user) {
          externalUsername = authResult.user.username;
        }
      } else {
        // External auth failed (401 etc) or service error (500)
        // We will try local auth next
      }
    } catch (maxError) {
      console.warn('Authentication service unavailable, trying local auth.', maxError);
      // authServiceAvailable = false;
    }

    // 2. Local fallback if external failed
    if (!externalUsername) {
      const { compare } = await import('bcryptjs');
      const teacher = await prisma.teacher.findUnique({
        where: { username },
        select: { id: true, username: true, passwordHash: true }
      });

      if (teacher && teacher.passwordHash) {
        const match = await compare(password, teacher.passwordHash);
        if (match) {
          externalUsername = teacher.username;
        }
      }
    }

    if (!externalUsername) {
      return NextResponse.json({ message: 'Invalid credentials.' }, { status: 401 });
    }

    console.log(`Teacher login successful: ${externalUsername}`);

    // Find or create teacher record in local database (for session management)
    let teacher = await prisma.teacher.findUnique({
      where: { username: externalUsername },
      select: {
        id: true,
        username: true,
        displayName: true,
      },
    });

    // Create teacher record if it doesn't exist (first time login from external)
    if (!teacher) {
      teacher = await prisma.teacher.create({
        data: {
          username: externalUsername,
          passwordHash: '', // Not used - authentication is external or already verified
        },
        select: {
          id: true,
          username: true,
          displayName: true,
        },
      });
    }

    // Check for existing active session to resume
    const sessionDurationMinutes = parseInt(process.env.CLASSROOM_SESSION_DURATION_MINUTES || '1440', 10);
    const validSessionThreshold = new Date(Date.now() - sessionDurationMinutes * 60 * 1000);

    const existingSession = await prisma.session.findFirst({
      where: {
        teacherId: teacher.id,
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

    let session;

    if (existingSession) {
      // Resume existing session
      session = existingSession;
      console.log(`Resuming existing session ${session.classroomCode} for teacher ${teacher.username}`);
    } else {
      // Deactivate old sessions and create a new one
      await deactivateTeacherSessions(teacher.id);

      for (let attempt = 0; attempt < 5; attempt += 1) {
        const classroomCode = await generateUniqueClassroomCode();
        try {
          session = await prisma.session.create({
            data: {
              teacherId: teacher.id,
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
          break;
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
    }

    if (!session) {
      return NextResponse.json({ message: 'Unable to create or resume a classroom. Please try again.' }, { status: 500 });
    }

    const response = NextResponse.json({
      session: {
        id: session.id,
        classroomCode: session.classroomCode,
        createdAt: session.createdAt,
        chatEnabled: session.chatEnabled,
        maxStudentEdits: session.maxStudentEdits,
      },
      teacher: {
        id: teacher.id,
        username: teacher.username,
        displayName: teacher.displayName,
      },
    });

    // IMPORTANT: Clear student cookies FIRST to prevent conflicts
    response.cookies.delete(studentCookieName);

    response.cookies.set(sessionCookieName, session.id, {
      httpOnly: true,
      sameSite: 'lax',
      path: '/',
      maxAge: 60 * 60 * 6,
    });
    response.cookies.set(roleCookieName, 'teacher', {
      httpOnly: true,
      sameSite: 'lax',
      path: '/',
      maxAge: 60 * 60 * 6,
    });

    console.log(`Teacher ${teacher.username} logged in, session: ${session.classroomCode}`);

    return response;
  } catch (error) {
    console.error('Teacher login failed', error);
    if (error instanceof z.ZodError) {
      return NextResponse.json({ message: error.issues[0]?.message ?? 'Invalid input' }, { status: 400 });
    }
    return NextResponse.json({ message: 'Unable to log in as teacher.' }, { status: 500 });
  }
}

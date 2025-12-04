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

    // Verify credentials with external authentication service
    let authResponse;
    try {
      authResponse = await fetch(`${AUTH_SERVICE_URL}/verify`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password }),
      });
    } catch (fetchError) {
      console.error('Failed to connect to authentication service:', fetchError);
      return NextResponse.json(
        { message: 'Authentication service unavailable. Please try again later.' },
        { status: 503 }
      );
    }

    if (!authResponse.ok) {
      const errorData = await authResponse.json().catch(() => ({ error: 'Authentication failed' }));
      return NextResponse.json(
        { message: errorData.error || 'Invalid credentials.' },
        { status: authResponse.status === 401 ? 401 : 500 }
      );
    }

    const authResult = await authResponse.json();
    if (!authResult.success || !authResult.user) {
      return NextResponse.json({ message: 'Invalid credentials.' }, { status: 401 });
    }

    const externalUsername = authResult.user.username;

    console.log(`Teacher login attempt: ${externalUsername}`);

    // Find or create teacher record in local database (for session management)
    let teacher = await prisma.teacher.findUnique({
      where: { username: externalUsername },
      select: {
        id: true,
        username: true,
        displayName: true,
      },
    });

    // Create teacher record if it doesn't exist (first time login)
    if (!teacher) {
      teacher = await prisma.teacher.create({
        data: {
          username: externalUsername,
          passwordHash: '', // Not used - authentication is external
        },
        select: {
          id: true,
          username: true,
          displayName: true,
        },
      });
    }

    await deactivateTeacherSessions(teacher.id);

    let session: {
      id: string;
      classroomCode: string;
      createdAt: Date;
      chatEnabled: boolean;
      maxStudentEdits: number;
    } | null = null;

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

    if (!session) {
      return NextResponse.json({ message: 'Unable to create a classroom. Please try again.' }, { status: 500 });
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

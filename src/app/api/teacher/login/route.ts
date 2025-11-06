import { NextResponse } from 'next/server';
import { Prisma } from '@prisma/client';
import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { roleCookieName, sessionCookieName, studentCookieName, verifyPassword } from '@/lib/auth';
import { deactivateTeacherSessions, generateUniqueClassroomCode } from '@/lib/session';

const bodySchema = z.object({
  username: z.string().trim().min(1, 'Username is required'),
  password: z.string().min(1, 'Password is required'),
});

export async function POST(request: Request) {
  try {
    const json = await request.json();
    const { username, password } = bodySchema.parse(json);

    const teacher = await prisma.teacher.findUnique({
      where: { username },
      select: {
        id: true,
        username: true,
        displayName: true,
        passwordHash: true,
      },
    });

    if (!teacher) {
      return NextResponse.json({ message: 'Teacher credentials not found.' }, { status: 404 });
    }

    const isValid = await verifyPassword(password, teacher.passwordHash);
    if (!isValid) {
      return NextResponse.json({ message: 'Incorrect password.' }, { status: 401 });
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
    response.cookies.delete(studentCookieName);

    return response;
  } catch (error) {
    console.error('Teacher login failed', error);
    if (error instanceof z.ZodError) {
      return NextResponse.json({ message: error.issues[0]?.message ?? 'Invalid input' }, { status: 400 });
    }
    return NextResponse.json({ message: 'Unable to log in as teacher.' }, { status: 500 });
  }
}

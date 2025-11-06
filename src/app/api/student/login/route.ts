import { NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { roleCookieName, sessionCookieName, studentCookieName, verifyPassword } from '@/lib/auth';

const bodySchema = z.object({
  classroomCode: z
    .string()
    .trim()
    .regex(/^\d{8}$/, 'Classroom code must be eight digits'),
  username: z.string().trim().min(3, 'Username is required'),
  password: z.string().min(1, 'Password is required'),
});

export async function POST(request: Request) {
  try {
    const json = await request.json();
    const { classroomCode, username, password } = bodySchema.parse(json);

    const session = await prisma.session.findFirst({
      where: {
        classroomCode,
        isActive: true,
      },
      select: {
        id: true,
        classroomCode: true,
      },
    });

    if (!session) {
      return NextResponse.json(
        { message: 'That classroom is not active. Double-check the code with your teacher.' },
        { status: 404 },
      );
    }

    const student = await prisma.student.findFirst({
      where: {
        username,
        sessionId: session.id,
      },
      select: {
        id: true,
        passwordHash: true,
        username: true,
      },
    });

    if (!student) {
      return NextResponse.json({ message: 'Account not found for this classroom.' }, { status: 404 });
    }

    const isValid = await verifyPassword(password, student.passwordHash);
    if (!isValid) {
      return NextResponse.json({ message: 'Incorrect password. Please try again.' }, { status: 401 });
    }

    const response = NextResponse.json({
      sessionId: session.id,
      classroomCode: session.classroomCode,
      role: 'student',
      student: {
        id: student.id,
        username: student.username,
      },
    });

    response.cookies.set(sessionCookieName, session.id, {
      httpOnly: true,
      sameSite: 'lax',
      path: '/',
      maxAge: 60 * 60 * 6,
    });
    response.cookies.set(roleCookieName, 'student', {
      httpOnly: true,
      sameSite: 'lax',
      path: '/',
      maxAge: 60 * 60 * 6,
    });
    response.cookies.set(studentCookieName, student.id, {
      httpOnly: true,
      sameSite: 'lax',
      path: '/',
      maxAge: 60 * 60 * 6,
    });

    return response;
  } catch (error) {
    console.error('Student login failed', error);
    if (error instanceof z.ZodError) {
      return NextResponse.json({ message: error.issues[0]?.message ?? 'Invalid input' }, { status: 400 });
    }
    return NextResponse.json({ message: 'Unable to log in' }, { status: 500 });
  }
}

export async function DELETE() {
  const response = NextResponse.json({ success: true });
  response.cookies.delete(sessionCookieName);
  response.cookies.delete(roleCookieName);
  response.cookies.delete(studentCookieName);
  return response;
}

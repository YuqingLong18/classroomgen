import { NextResponse } from 'next/server';
import { z } from 'zod';
import { StudentStatus } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { roleCookieName, sessionCookieName, studentCookieName } from '@/lib/auth';

const bodySchema = z.object({
  classroomCode: z
    .string()
    .trim()
    .regex(/^\d{8}$/, 'Classroom code must be eight digits'),
  name: z.string().trim().min(2, 'Please enter your name.').max(40, 'Name must be under 40 characters.'),
});

export async function POST(request: Request) {
  try {
    const json = await request.json();
    const { classroomCode, name } = bodySchema.parse(json);
    const studentName = name.replace(/\s+/g, ' ').trim();

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

    const existing = await prisma.student.findFirst({
      where: {
        sessionId: session.id,
        username: studentName,
      },
      select: {
        id: true,
        username: true,
        status: true,
      },
    });

    if (existing?.status === StudentStatus.REMOVED) {
      return NextResponse.json(
        { message: 'That name was removed by your teacher. Choose another to rejoin.' },
        { status: 403 },
      );
    }

    // Enforce strict nickname uniqueness - reject if nickname is already taken
    if (existing?.status === StudentStatus.ACTIVE) {
      return NextResponse.json(
        { message: 'That nickname is already taken. Please choose a different name.' },
        { status: 409 }, // 409 Conflict
      );
    }

    // Always create a new student record (never reuse existing ones)
    const student = await prisma.student.create({
      data: {
        username: studentName,
        passwordHash: null,
        status: StudentStatus.ACTIVE,
        sessionId: session.id,
      },
      select: {
        id: true,
        username: true,
      },
    });

    console.log(`Student login: ${studentName} (ID: ${student.id}) joined session ${session.classroomCode}`);

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

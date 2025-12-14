import { NextResponse } from 'next/server';
import { StudentStatus } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { getSessionFromCookies } from '@/lib/session';
import { roleCookieName, sessionCookieName, studentCookieName, teacherSessionCookieName } from '@/lib/auth';

export async function POST() {
  try {
    const cookies = await getSessionFromCookies();
    const sessionId = cookies.sessionId;
    const role = cookies.role;

    // Verify user is a teacher
    if (role !== 'teacher' || !sessionId) {
      return NextResponse.json(
        { message: 'Only teachers can join as a student.' },
        { status: 403 }
      );
    }

    // Verify the session exists and is active
    const session = await prisma.session.findUnique({
      where: { id: sessionId },
      select: {
        id: true,
        classroomCode: true,
        isActive: true,
        teacherId: true,
      },
    });

    if (!session || !session.isActive) {
      return NextResponse.json(
        { message: 'Session not found or inactive.' },
        { status: 404 }
      );
    }

    // Check if teacher already has a student record in this session
    const teacherStudentName = `Teacher (Preview)`;
    const existingStudent = await prisma.student.findFirst({
      where: {
        sessionId: session.id,
        username: teacherStudentName,
        status: StudentStatus.ACTIVE,
      },
      select: { id: true },
    });

    let studentId: string;
    if (existingStudent) {
      // Use existing student record
      studentId = existingStudent.id;
    } else {
      // Create new student record for teacher
      const student = await prisma.student.create({
        data: {
          username: teacherStudentName,
          passwordHash: null,
          status: StudentStatus.ACTIVE,
          sessionId: session.id,
        },
        select: { id: true },
      });
      studentId = student.id;
    }

    // Create response with student cookies
    const response = NextResponse.json({
      success: true,
      sessionId: session.id,
      classroomCode: session.classroomCode,
      studentId,
    });

    // Save teacher session ID in a separate cookie before switching to student mode
    response.cookies.set(teacherSessionCookieName, sessionId, {
      httpOnly: true,
      sameSite: 'lax',
      path: '/',
      maxAge: 60 * 60 * 6, // 6 hours
    });

    // Set student cookies
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
    response.cookies.set(studentCookieName, studentId, {
      httpOnly: true,
      sameSite: 'lax',
      path: '/',
      maxAge: 60 * 60 * 6,
    });

    console.log(`Teacher joined as student in session ${session.classroomCode}`);

    return response;
  } catch (error) {
    console.error('Failed to join as student', error);
    return NextResponse.json(
      { message: 'Unable to join as student.' },
      { status: 500 }
    );
  }
}

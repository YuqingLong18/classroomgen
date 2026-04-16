import { NextResponse } from 'next/server';
import { StudentStatus } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { getSessionFromCookies } from '@/lib/session';
import { studentCookieName, teacherSessionCookieName } from '@/lib/auth';

function normalizePreviewStudentName(displayName?: string | null, username?: string | null) {
  const baseName = String(displayName ?? username ?? 'Teacher')
    .replace(/\s+/g, ' ')
    .trim();

  if (baseName.length === 0) {
    return 'Teacher';
  }

  return baseName.slice(0, 40);
}

async function resolvePreviewStudentRecord(sessionId: string, preferredName: string) {
  const teacherLabel = 'Teacher';
  const candidateNames = [
    preferredName,
    `${preferredName} (${teacherLabel})`,
    `${preferredName} (${teacherLabel} 2)`,
    `${preferredName} (${teacherLabel} 3)`,
  ].map((value) => value.slice(0, 40));

  for (const candidateName of candidateNames) {
    const existingStudent = await prisma.student.findFirst({
      where: {
        sessionId,
        username: candidateName,
      },
      select: {
        id: true,
        status: true,
      },
    });

    if (!existingStudent) {
      const student = await prisma.student.create({
        data: {
          username: candidateName,
          passwordHash: null,
          status: StudentStatus.ACTIVE,
          sessionId,
        },
        select: {
          id: true,
          username: true,
        },
      });

      return student;
    }

    if (existingStudent.status === StudentStatus.ACTIVE) {
      return {
        id: existingStudent.id,
        username: candidateName,
      };
    }
  }

  const fallbackName = `${preferredName.slice(0, 29)} (Teacher ${Date.now().toString(36)})`.slice(0, 40);
  const student = await prisma.student.create({
    data: {
      username: fallbackName,
      passwordHash: null,
      status: StudentStatus.ACTIVE,
      sessionId,
    },
    select: {
      id: true,
      username: true,
    },
  });

  return student;
}

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
        teacher: {
          select: {
            username: true,
            displayName: true,
          },
        },
      },
    });

    if (!session || !session.isActive) {
      return NextResponse.json(
        { message: 'Session not found or inactive.' },
        { status: 404 }
      );
    }

    const preferredName = normalizePreviewStudentName(
      session.teacher.displayName,
      session.teacher.username,
    );
    const previewStudent = await resolvePreviewStudentRecord(session.id, preferredName);

    // Keep the teacher as a teacher. Only attach a preview student identity.
    const response = NextResponse.json({
      success: true,
      sessionId: session.id,
      classroomCode: session.classroomCode,
      studentId: previewStudent.id,
      student: {
        id: previewStudent.id,
        username: previewStudent.username,
      },
    });

    // Save teacher session ID in a separate cookie before switching to student mode
    response.cookies.set(teacherSessionCookieName, sessionId, {
      httpOnly: true,
      sameSite: 'lax',
      path: '/',
      maxAge: 60 * 60 * 6, // 6 hours
    });

    response.cookies.set(studentCookieName, previewStudent.id, {
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

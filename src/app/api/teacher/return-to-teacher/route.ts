import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { getSessionFromCookies } from '@/lib/session';
import { roleCookieName, sessionCookieName, studentCookieName, teacherSessionCookieName } from '@/lib/auth';

export async function POST() {
  try {
    const { sessionId, role, teacherSessionId: savedTeacherSessionId } = await getSessionFromCookies();
    const teacherSessionId = role === 'teacher' && sessionId ? sessionId : savedTeacherSessionId;

    if (!teacherSessionId) {
      return NextResponse.json(
        { message: 'No teacher session found.' },
        { status: 403 }
      );
    }

    // Verify the teacher session exists and is active
    const session = await prisma.session.findUnique({
      where: { id: teacherSessionId },
      select: {
        id: true,
        classroomCode: true,
        isActive: true,
        teacher: {
          select: {
            id: true,
            username: true,
            displayName: true,
          },
        },
      },
    });

    if (!session || !session.isActive) {
      return NextResponse.json(
        { message: 'Teacher session not found or inactive.' },
        { status: 404 }
      );
    }

    // Create response with teacher cookies
    const response = NextResponse.json({
      success: true,
      session: {
        id: session.id,
        classroomCode: session.classroomCode,
      },
      teacher: session.teacher,
    });

    // Clear preview student cookies, keep teacher session active
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

    response.cookies.delete(teacherSessionCookieName);

    console.log(`Teacher returned to teacher view for session ${session.classroomCode}`);

    return response;
  } catch (error) {
    console.error('Failed to return to teacher view', error);
    return NextResponse.json(
      { message: 'Unable to return to teacher view.' },
      { status: 500 }
    );
  }
}

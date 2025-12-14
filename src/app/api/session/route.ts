import { NextResponse } from 'next/server';
import { StudentStatus } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { getSessionFromCookies, getTeacherSessionId } from '@/lib/session';
import { roleCookieName, sessionCookieName, studentCookieName, teacherSessionCookieName } from '@/lib/auth';

export async function GET() {
  try {
    let sessionId: string | undefined;
    let role: string | undefined;
    let studentId: string | undefined;

    try {
      const cookies = await getSessionFromCookies();
      sessionId = cookies.sessionId;
      role = cookies.role;
      studentId = cookies.studentId;
    } catch (cookieError) {
      console.error('Error reading cookies:', cookieError);
      // Return null session if cookies can't be read
      return NextResponse.json({ session: null });
    }

    if (!sessionId) {
      return NextResponse.json({ session: null });
    }

    let session;
    try {
      session = await prisma.session.findUnique({
        where: { id: sessionId },
        select: {
          id: true,
          createdAt: true,
          isActive: true,
          chatEnabled: true,
          maxStudentEdits: true,
          classroomCode: true,
          teacher: {
            select: {
              id: true,
              username: true,
              displayName: true,
            },
          },
        },
      });
    } catch (dbError) {
      console.error('Database error in GET /api/session:', dbError);
      return NextResponse.json({ session: null });
    }

    if (!session || !session.isActive) {
      const response = NextResponse.json({ session: null });
      response.cookies.delete(sessionCookieName);
      response.cookies.delete(roleCookieName);
      response.cookies.delete(studentCookieName);
      response.cookies.delete(teacherSessionCookieName);
      return response;
    }

    let student: { id: string; username: string } | null = null;
    if (studentId) {
      const record = await prisma.student.findUnique({
        where: { id: studentId },
        select: { id: true, username: true, sessionId: true, status: true },
      });

      if (record && record.sessionId === session.id) {
        if (record.status !== StudentStatus.ACTIVE) {
          console.log(`Student ${record.username} (${studentId}) was removed from session`);
          const response = NextResponse.json({ session: null, studentRemoved: true });
          response.cookies.delete(sessionCookieName);
          response.cookies.delete(roleCookieName);
          response.cookies.delete(studentCookieName);
          response.cookies.delete(teacherSessionCookieName);
          return response;
        }
        student = { id: record.id, username: record.username };
      } else {
        console.log(`Session mismatch: studentId ${studentId} not found or belongs to different session`);
        const response = NextResponse.json({ session: null });
        response.cookies.delete(sessionCookieName);
        response.cookies.delete(roleCookieName);
        response.cookies.delete(studentCookieName);
        response.cookies.delete(teacherSessionCookieName);
        return response;
      }
    }

    // Check if user has teacher access (either current role or teacher session cookie)
    let hasTeacherAccess = false;
    let teacherSessionForAccess = null;
    if (role === 'teacher') {
      hasTeacherAccess = true;
    } else {
      // Check teacher session cookie
      const teacherSessionId = await getTeacherSessionId();
      if (teacherSessionId) {
        // Verify teacher session is valid and matches current session's teacher
        const teacherSession = await prisma.session.findUnique({
          where: { id: teacherSessionId },
          select: {
            id: true,
            teacherId: true,
            isActive: true,
          },
        });
        if (teacherSession && teacherSession.isActive && teacherSession.teacherId === session.teacher.id) {
          hasTeacherAccess = true;
          teacherSessionForAccess = teacherSessionId;
        }
      }
    }

    return NextResponse.json({
      session: {
        id: session.id,
        createdAt: session.createdAt,
        role,
        chatEnabled: session.chatEnabled,
        maxStudentEdits: session.maxStudentEdits,
        classroomCode: session.classroomCode,
        teacher: session.teacher,
        student,
        hasTeacherAccess, // Indicates if user can access teacher dashboard
        teacherSessionId: teacherSessionForAccess, // Teacher session ID if viewing as student
      },
    });
  } catch (error) {
    console.error('Error in GET /api/session:', error);
    // Return 200 with null session instead of 500 - no session is a valid state
    return NextResponse.json({ session: null });
  }
}

export async function DELETE() {
  const response = NextResponse.json({ success: true });
  response.cookies.delete(sessionCookieName);
  response.cookies.delete(roleCookieName);
  response.cookies.delete(studentCookieName);
  response.cookies.delete(teacherSessionCookieName);
  return response;
}

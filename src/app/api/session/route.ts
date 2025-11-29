import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { getSessionFromCookies } from '@/lib/session';
import { roleCookieName, sessionCookieName, studentCookieName } from '@/lib/auth';

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
    return response;
  }

  let student: { id: string; username: string } | null = null;
  if (studentId) {
    const record = await prisma.student.findUnique({
      where: { id: studentId },
      select: { id: true, username: true, sessionId: true },
    });

    if (record && record.sessionId === session.id) {
      student = { id: record.id, username: record.username };
    } else {
      const response = NextResponse.json({ session: null });
      response.cookies.delete(sessionCookieName);
      response.cookies.delete(roleCookieName);
      response.cookies.delete(studentCookieName);
      return response;
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
  return response;
}

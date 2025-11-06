import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { getSessionFromCookies } from '@/lib/session';
import { roleCookieName, sessionCookieName, studentCookieName } from '@/lib/auth';

export async function GET() {
  const { sessionId, role, studentId } = await getSessionFromCookies();

  if (!sessionId) {
    return NextResponse.json({ session: null });
  }

  const session = await prisma.session.findUnique({
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
}

export async function DELETE() {
  const response = NextResponse.json({ success: true });
  response.cookies.delete(sessionCookieName);
  response.cookies.delete(roleCookieName);
  response.cookies.delete(studentCookieName);
  return response;
}

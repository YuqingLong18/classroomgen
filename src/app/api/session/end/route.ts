import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { getSessionFromCookies } from '@/lib/session';
import { roleCookieName, sessionCookieName, studentCookieName } from '@/lib/auth';

export async function POST() {
  const { sessionId, role } = await getSessionFromCookies();

  if (!sessionId || role !== 'teacher') {
    return NextResponse.json({ message: 'Teacher access only.' }, { status: 403 });
  }

  await prisma.session.updateMany({
    where: { id: sessionId },
    data: { isActive: false, endedAt: new Date() },
  });

  const response = NextResponse.json({ success: true });
  response.cookies.delete(sessionCookieName);
  response.cookies.delete(roleCookieName);
  response.cookies.delete(studentCookieName);
  return response;
}

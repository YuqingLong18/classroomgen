import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { getSessionFromCookies } from '@/lib/session';

export async function GET() {
  const { sessionId, role } = await getSessionFromCookies();

  if (!sessionId || role !== 'teacher') {
    return NextResponse.json({ message: 'Teacher access only.' }, { status: 403 });
  }

  const session = await prisma.session.findUnique({
    where: { id: sessionId },
    include: {
      promptEntries: {
        orderBy: { createdAt: 'desc' },
        include: {
          student: {
            select: {
              username: true,
            },
          },
        },
      },
    },
  });

  if (!session) {
    return NextResponse.json({ message: 'Session not found.' }, { status: 404 });
  }

  return NextResponse.json({
    session: {
      id: session.id,
      createdAt: session.createdAt,
      isActive: session.isActive,
      chatEnabled: session.chatEnabled,
      maxStudentEdits: session.maxStudentEdits,
    },
    submissions: session.promptEntries,
  });
}

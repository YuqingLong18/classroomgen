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
        orderBy: { createdAt: 'asc' },
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

  const payload = {
    session: {
      id: session.id,
      createdAt: session.createdAt,
      endedAt: session.endedAt,
      isActive: session.isActive,
    },
    entries: session.promptEntries.map((submission) => ({
      id: submission.id,
      prompt: submission.prompt,
      role: submission.role,
      createdAt: submission.createdAt,
      status: submission.status,
      revisionIndex: submission.revisionIndex,
      parentSubmissionId: submission.parentSubmissionId,
      rootSubmissionId: submission.rootSubmissionId,
      hasImage: Boolean(submission.imageData),
      errorMessage: submission.errorMessage,
      isShared: submission.isShared,
      studentUsername: submission.student?.username ?? null,
    })),
  };

  const body = JSON.stringify(payload, null, 2);
  const response = new NextResponse(body);
  response.headers.set('Content-Type', 'application/json');
  response.headers.set('Content-Disposition', `attachment; filename="session-${session.id}.json"`);
  return response;
}

import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { verifyTeacherAccess } from '@/lib/session';

export async function GET() {
  const teacherAccess = await verifyTeacherAccess();
  if (!teacherAccess) {
    return NextResponse.json({ message: 'Teacher access only.' }, { status: 403 });
  }

  const sessionId = teacherAccess.sessionId;

  const session = await prisma.session.findUnique({
    where: { id: sessionId },
    select: {
      id: true,
      createdAt: true,
      isActive: true,
      chatEnabled: true,
      maxStudentEdits: true,
      promptEntries: {
        orderBy: { createdAt: 'desc' },
        select: {
          id: true,
          createdAt: true,
          // updatedAt: true, // removed
          prompt: true,
          status: true,
          role: true,
          revisionIndex: true,
          parentSubmissionId: true,
          rootSubmissionId: true,
          imageData: true,
          imageMimeType: true,
          errorMessage: true,
          referenceImages: true,
          isShared: true,
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

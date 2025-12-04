import { NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { getSessionFromCookies, requireActiveStudent } from '@/lib/session';
import { SubmissionStatus } from '@prisma/client';

const bodySchema = z.object({
  submissionId: z.string().cuid(),
  share: z.boolean(),
});

export async function POST(request: Request) {
  try {
    const { sessionId, role, studentId } = await getSessionFromCookies();

    if (!sessionId || role !== 'student' || !studentId) {
      return NextResponse.json({ message: 'Student access required.' }, { status: 403 });
    }

    const json = await request.json();
    const { submissionId, share } = bodySchema.parse(json);

    const status = await requireActiveStudent(sessionId, studentId);
    if (!status.active) {
      return NextResponse.json(
        { message: 'You were removed from the classroom. Please rejoin with a new name.' },
        { status: 403 },
      );
    }

    const submission = await prisma.promptSubmission.findUnique({
      where: { id: submissionId },
      select: {
        id: true,
        studentId: true,
        sessionId: true,
        status: true,
      },
    });

    if (!submission || submission.sessionId !== sessionId || submission.studentId !== studentId) {
      return NextResponse.json({ message: 'You can only manage sharing for your own images.' }, { status: 403 });
    }

    if (submission.status !== SubmissionStatus.SUCCESS) {
      return NextResponse.json({ message: 'Only completed images can be shared.' }, { status: 400 });
    }

    const updated = await prisma.promptSubmission.update({
      where: { id: submission.id },
      data: { isShared: share },
      select: { id: true, isShared: true },
    });

    return NextResponse.json({ submissionId: updated.id, isShared: updated.isShared });
  } catch (error) {
    console.error('Failed to update share state', error);
    if (error instanceof z.ZodError) {
      return NextResponse.json({ message: error.issues[0]?.message ?? 'Invalid input' }, { status: 400 });
    }
    return NextResponse.json({ message: 'Unable to update sharing state' }, { status: 500 });
  }
}

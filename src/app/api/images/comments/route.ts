import { NextResponse } from 'next/server';
import { z } from 'zod';
import { SubmissionStatus } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { getSessionFromCookies } from '@/lib/session';

const bodySchema = z.object({
  submissionId: z.string().cuid(),
  content: z
    .string()
    .trim()
    .min(1, 'Please enter a comment before submitting.')
    .max(500, 'Comments can be at most 500 characters.'),
});

export async function POST(request: Request) {
  try {
    const { sessionId, role, studentId } = await getSessionFromCookies();

    if (!sessionId || role !== 'student' || !studentId) {
      return NextResponse.json({ message: 'Student access required.' }, { status: 403 });
    }

    const payload = await request.json();
    const { submissionId, content } = bodySchema.parse(payload);

    const submission = await prisma.promptSubmission.findUnique({
      where: { id: submissionId },
      select: {
        sessionId: true,
        studentId: true,
        isShared: true,
        status: true,
      },
    });

    if (!submission || submission.sessionId !== sessionId) {
      return NextResponse.json({ message: 'Image not found in this classroom.' }, { status: 404 });
    }

    if (submission.status !== SubmissionStatus.SUCCESS) {
      return NextResponse.json({ message: 'Only completed images can be commented on.' }, { status: 400 });
    }

    if (!submission.isShared && submission.studentId !== studentId) {
      return NextResponse.json({ message: 'This image is private.' }, { status: 403 });
    }

    const comment = await prisma.submissionComment.create({
      data: {
        submissionId,
        studentId,
        content: content.trim(),
      },
      select: {
        id: true,
        content: true,
        createdAt: true,
        studentId: true,
        student: {
          select: {
            username: true,
          },
        },
      },
    });

    return NextResponse.json({
      submissionId,
      comment: {
        id: comment.id,
        content: comment.content,
        createdAt: comment.createdAt.toISOString(),
        studentUsername: comment.student?.username ?? null,
        ownedByCurrentUser: true,
      },
    });
  } catch (error) {
    console.error('Failed to add comment', error);
    if (error instanceof z.ZodError) {
      return NextResponse.json({ message: error.issues[0]?.message ?? 'Invalid input' }, { status: 400 });
    }
    return NextResponse.json({ message: 'Unable to add comment.' }, { status: 500 });
  }
}

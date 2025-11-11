import { NextResponse } from 'next/server';
import { z } from 'zod';
import { SubmissionStatus } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { getSessionFromCookies } from '@/lib/session';
import { invalidateImagesCache } from '../route';

const bodySchema = z.object({
  submissionId: z.string().cuid(),
  like: z.boolean(),
});

export async function POST(request: Request) {
  try {
    const { sessionId, role, studentId } = await getSessionFromCookies();

    if (!sessionId || role !== 'student' || !studentId) {
      return NextResponse.json({ message: 'Student access required.' }, { status: 403 });
    }

    const payload = await request.json();
    const { submissionId, like } = bodySchema.parse(payload);

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
      return NextResponse.json({ message: 'Only completed images can be liked.' }, { status: 400 });
    }

    if (!submission.isShared && submission.studentId !== studentId) {
      return NextResponse.json({ message: 'This image is private.' }, { status: 403 });
    }

    if (like) {
      await prisma.submissionLike.upsert({
        where: {
          submissionId_studentId: {
            submissionId,
            studentId,
          },
        },
        update: {},
        create: {
          submissionId,
          studentId,
        },
      });
    } else {
      try {
        await prisma.submissionLike.delete({
          where: {
            submissionId_studentId: {
              submissionId,
              studentId,
            },
          },
        });
      } catch (error) {
        console.warn('Like removal attempted for non-existent record', error);
      }
    }

    const likeCount = await prisma.submissionLike.count({ where: { submissionId } });

    // Invalidate cache
    invalidateImagesCache(sessionId);

    return NextResponse.json({ submissionId, likeCount, liked: like });
  } catch (error) {
    console.error('Failed to toggle like', error);
    if (error instanceof z.ZodError) {
      return NextResponse.json({ message: error.issues[0]?.message ?? 'Invalid input' }, { status: 400 });
    }
    return NextResponse.json({ message: 'Unable to update like.' }, { status: 500 });
  }
}

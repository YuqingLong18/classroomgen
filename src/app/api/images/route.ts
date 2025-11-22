import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { getSessionFromCookies } from '@/lib/session';
import { Prisma } from '@prisma/client';

export async function GET() {
  const { sessionId, role, studentId } = await getSessionFromCookies();

  if (!sessionId) {
    return NextResponse.json({ submissions: [] });
  }

  const session = await prisma.session.findUnique({
    where: { id: sessionId },
    select: {
      id: true,
      isActive: true,
      maxStudentEdits: true,
    },
  });

  if (!session || !session.isActive) {
    return NextResponse.json({ submissions: [] });
  }

  const maxEdits = session.maxStudentEdits ?? 3;

  const where: Prisma.PromptSubmissionWhereInput = { sessionId };
  if (role !== 'teacher') {
    // Students can see:
    // 1. Their own submissions (including PENDING ones)
    // 2. Shared submissions that are SUCCESS
    where.OR = [
      // Own submissions - include PENDING, SUCCESS, and ERROR
      studentId ? { studentId } : undefined,
      // Shared submissions - only SUCCESS
      { isShared: true, status: 'SUCCESS' },
    ].filter(Boolean) as Prisma.PromptSubmissionWhereInput[];
  }

  const submissions = await prisma.promptSubmission.findMany({
    where,
    orderBy: { createdAt: 'desc' },
    select: {
      id: true,
      prompt: true,
      createdAt: true,
      status: true,
      imageData: true,
      imageMimeType: true,
      revisionIndex: true,
      rootSubmissionId: true,
      parentSubmissionId: true,
      errorMessage: true,
      studentId: true,
      isShared: true,
      student: {
        select: {
          username: true,
        },
      },
      comments: {
        orderBy: { createdAt: 'asc' },
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
      },
      _count: {
        select: {
          likes: true,
        },
      },
    },
  });

  const likedSubmissionIds = new Set<string>();
  if (studentId && submissions.length > 0) {
    const likedEntries = await prisma.submissionLike.findMany({
      where: {
        studentId,
        submissionId: { in: submissions.map((submission) => submission.id) },
      },
      select: { submissionId: true },
    });
    for (const entry of likedEntries) {
      likedSubmissionIds.add(entry.submissionId);
    }
  }

  const successCounts = new Map<string, number>();
  for (const submission of submissions) {
    if (submission.status !== 'SUCCESS') continue;
    const rootId = submission.rootSubmissionId ?? submission.id;
    successCounts.set(rootId, (successCounts.get(rootId) ?? 0) + 1);
  }

  const enriched = submissions.map((submission) => {
    const rootId = submission.rootSubmissionId ?? submission.id;
    const successCount = successCounts.get(rootId) ?? (submission.status === 'SUCCESS' ? 1 : 0);
    const remainingEdits = Math.max(0, maxEdits - successCount);
    return {
      ...submission,
      rootId,
      remainingEdits,
      isShared: submission.isShared,
      ownedByCurrentUser: studentId ? submission.studentId === studentId : false,
      studentUsername: submission.student?.username ?? null,
      likeCount: submission._count.likes,
      likedByCurrentUser: likedSubmissionIds.has(submission.id),
      comments: submission.comments.map((comment) => ({
        id: comment.id,
        content: comment.content,
        createdAt: comment.createdAt.toISOString(),
        studentUsername: comment.student?.username ?? null,
        ownedByCurrentUser: studentId ? comment.studentId === studentId : false,
      })),
    };
  });

  return NextResponse.json({ submissions: enriched, role });
}

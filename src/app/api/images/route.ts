import { NextRequest, NextResponse } from 'next/server';
import { Prisma } from '@prisma/client';
import { getSessionFromCookies } from '@/lib/session';
import { prisma } from '@/lib/prisma';
import { getCache, setCache, getImagesCacheKey, clearCache } from '@/lib/cache';
import { rateLimitMiddleware } from '@/lib/rate-limit';

async function handler(request: NextRequest) {
  const { sessionId, role, studentId } = await getSessionFromCookies();

  if (!sessionId) {
    return NextResponse.json({ submissions: [] });
  }

  // Check cache first
  const url = new URL(request.url);
  const page = Math.max(1, parseInt(url.searchParams.get('page') || '1', 10));
  const cacheKey = getImagesCacheKey(sessionId, role || 'unknown', studentId || undefined, page);
  const cached = getCache<{ submissions: unknown[]; role: string; pagination: unknown }>(cacheKey);
  
  if (cached) {
    return NextResponse.json(cached, {
      headers: {
        'Cache-Control': 'private, max-age=5, stale-while-revalidate=10',
        'X-Cache': 'HIT',
      },
    });
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
    where.status = 'SUCCESS';
    where.OR = [
      { isShared: true },
      studentId ? { studentId } : undefined,
    ].filter(Boolean) as Array<{ isShared: boolean } | { studentId: string }>;
  }

  const limit = Math.min(100, Math.max(10, parseInt(url.searchParams.get('limit') || '50', 10)));
  const skip = (page - 1) * limit;

  const totalCount = await prisma.promptSubmission.count({ where });

  const submissions = await prisma.promptSubmission.findMany({
    where,
    orderBy: { createdAt: 'desc' },
    take: limit,
    skip,
    select: {
      id: true,
      prompt: true,
      createdAt: true,
      status: true,
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

  const result = {
    submissions: enriched,
    role,
    pagination: {
      page,
      limit,
      total: totalCount,
      totalPages: Math.ceil(totalCount / limit),
      hasMore: skip + limit < totalCount,
    },
  };

  // Cache for 5 seconds
  setCache(cacheKey, result, 5000);

  return NextResponse.json(result, {
    headers: {
      'Cache-Control': 'private, max-age=5, stale-while-revalidate=10',
      'X-Cache': 'MISS',
    },
  });
}

// Invalidate cache when images are updated
export function invalidateImagesCache(sessionId: string) {
  clearCache(`images:${sessionId}`);
}

export const GET = rateLimitMiddleware(handler);

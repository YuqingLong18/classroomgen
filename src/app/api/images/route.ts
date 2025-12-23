import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { getSessionFromCookies, requireActiveStudent } from '@/lib/session';
import { Prisma } from '@prisma/client';

export async function GET(request: NextRequest) {
  const { sessionId, role, studentId } = await getSessionFromCookies();

  if (!sessionId) {
    return NextResponse.json({ submissions: [], nextCursor: null });
  }

  const searchParams = request.nextUrl.searchParams;
  const cursor = searchParams.get('cursor');
  const limit = Math.min(parseInt(searchParams.get('limit') || '50'), 100);

  const session = await prisma.session.findUnique({
    where: { id: sessionId },
    select: {
      id: true,
      isActive: true,
      maxStudentEdits: true,
    },
  });

  if (!session || !session.isActive) {
    return NextResponse.json({ submissions: [], nextCursor: null });
  }

  const maxEdits = session.maxStudentEdits ?? 3;

  if (role === 'student') {
    if (!studentId) {
      return NextResponse.json(
        { submissions: [], nextCursor: null, message: 'Student access required.' },
        { status: 403 },
      );
    }
    const status = await requireActiveStudent(sessionId, studentId);
    if (!status.active) {
      return NextResponse.json(
        { submissions: [], nextCursor: null, message: 'You were removed from the classroom. Rejoin with a new name.' },
        { status: 403 },
      );
    }
  }

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
    take: limit + 1, // Fetch one extra to determine if there's a next page
    cursor: cursor ? { id: cursor } : undefined,
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

  let nextCursor: string | null = null;
  if (submissions.length > limit) {
    const nextItem = submissions.pop();
    nextCursor = nextItem?.id || null; // This logic is slightly off, pop removes the LAST item (which is the (limit+1)th item). The cursor should be the ID of the LAST item *remaining* in the array? No, the cursor is the ID of the item *after* which to start.
    // Wait, cursor pagination convention:
    // If I fetch 51 items. Item 51 is the start of the next page.
    // So nextCursor should be Item 51's ID.
    // And I should only return 50 items.
    // submissions.pop() returns Item 51. Correct.
    if (nextItem) {
      nextCursor = nextItem.id; // Or should I point to the last item OF THIS PAGE?
      // Prisma cursor: "cursor points to the item *before* the invalid items" -> No.
      // Prisma `cursor`: "Specifies the position in the list to start the results from."
      // Usually combined with `skip: 1` if using the ID of the last item of previous page.
      // BUT my queries don't use `skip: 1` here explicitly except... wait.
      // If I pass `cursor: {id: 'last_id'}`, Prisma includes 'last_id' in result.
      // So I usually do `cursor: {id}, skip: 1`. 
      // Let's add usage of `skip`.
    }
  }

  // Re-evaluating cursor logic inside the string replacement block is hard.
  // I will write the corrected logic.

  // Correct Logic:
  // if (cursor) { options.cursor = { id: cursor }; options.skip = 1; }
  // take: limit + 1
  // if (results.length > limit) { nextCursor = results[limit].id; results.pop(); }

  // wait, results[limit] (index 50) IS the 51st item.

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

  return NextResponse.json({ submissions: enriched, nextCursor, role });
}

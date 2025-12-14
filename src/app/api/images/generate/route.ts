import { NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { getSessionFromCookies, requireActiveStudent } from '@/lib/session';
import { SubmissionStatus } from '@prisma/client';
import { enqueueImageGeneration } from '@/lib/imageQueue';

const bodySchema = z.object({
  prompt: z.string().min(5, 'Please write a longer prompt to help the AI.'),
  parentSubmissionId: z.string().optional(),
  size: z.string().optional(),
});

export async function POST(request: Request) {
  const { sessionId, role, studentId } = await getSessionFromCookies();

  if (!sessionId || !role) {
    return NextResponse.json({ message: 'Join the classroom session before generating images.' }, { status: 401 });
  }

  if (role !== 'student' || !studentId) {
    return NextResponse.json({ message: 'Only students can generate images in this view.' }, { status: 403 });
  }

    const body = await request.json();

    try {
    const { prompt, parentSubmissionId, size } = bodySchema.parse(body);

    const session = await prisma.session.findUnique({
      where: { id: sessionId },
      select: {
        isActive: true,
        maxStudentEdits: true,
        teacherId: true,
      },
    });

    if (!session || !session.isActive) {
      return NextResponse.json({ message: 'Session expired. Please ask the teacher to restart.' }, { status: 403 });
    }

    // Get teacher API key for content filter
    let teacherApiKey: string | null = null;
    if (session.teacherId) {
      const { getTeacherApiKey } = await import('@/app/api/teacher/api-key/route');
      teacherApiKey = await getTeacherApiKey(session.teacherId);
    }

    // Security Check: Content Filter
    const { contentFilter } = await import('@/lib/contentFilter');
    const filterResult = await contentFilter.check(prompt, teacherApiKey);

    if (!filterResult.allowed) {
      return NextResponse.json(
        { message: 'Your prompt contains content that violates our safety guidelines.' },
        { status: 400 }
      );
    }

    // SECURITY: Sanitize user prompt before processing
    const { sanitizePrompt, logSecurityWarning } = await import('@/lib/promptSanitizer');
    const sanitization = sanitizePrompt(prompt);
    if (!sanitization.safe) {
      logSecurityWarning('prompt', sanitization.warnings, prompt, {
        studentId,
        sessionId,
        parentSubmissionId,
      });
      // Log warnings but allow the request - the sanitized prompt will be used
    }

    const studentStatus = await requireActiveStudent(sessionId, studentId);
    if (!studentStatus.active) {
      return NextResponse.json(
        { message: 'You were removed from the classroom. Please rejoin with a new name.' },
        { status: 403 },
      );
    }

    const maxEditsAllowed = session.maxStudentEdits ?? 3;

    let rootSubmissionId: string | null = null;
    let revisionIndex = 0;

    let baseImageDataUrl: string | undefined;

    if (parentSubmissionId) {
      const parent = await prisma.promptSubmission.findUnique({
        where: { id: parentSubmissionId },
        select: {
          id: true,
          studentId: true,
          sessionId: true,
          rootSubmissionId: true,
          imageData: true,
          imageMimeType: true,
        },
      });

      if (!parent || parent.sessionId !== sessionId) {
        return NextResponse.json({ message: 'Original image not found for this session.' }, { status: 404 });
      }

      if (parent.studentId !== studentId) {
        return NextResponse.json({ message: 'You can only refine images you created.' }, { status: 403 });
      }

      if (!parent.imageData) {
        return NextResponse.json({ message: 'Original image data is unavailable for refinement.' }, { status: 422 });
      }

      const rootId = parent.rootSubmissionId ?? parent.id;
      const chainCount = await prisma.promptSubmission.count({
        where: {
          sessionId,
          OR: [{ id: rootId }, { rootSubmissionId: rootId }],
          status: { in: [SubmissionStatus.PENDING, SubmissionStatus.SUCCESS] },
        },
      });

      if (chainCount >= maxEditsAllowed) {
        return NextResponse.json({ message: 'This image has no refinements remaining.' }, { status: 400 });
      }

      rootSubmissionId = rootId;
      revisionIndex = chainCount;
      baseImageDataUrl = `data:${parent.imageMimeType ?? 'image/png'};base64,${parent.imageData}`;
    }

    const submission = await prisma.promptSubmission.create({
      data: {
        sessionId,
        prompt,
        role: 'STUDENT',
        studentId,
        rootSubmissionId,
        parentSubmissionId: parentSubmissionId ?? null,
        revisionIndex,
        status: SubmissionStatus.PENDING, // Explicitly set to PENDING
      },
    });

    // Enqueue the image generation job for background processing
    // This returns immediately, allowing the request to complete quickly
    enqueueImageGeneration(submission.id, prompt, { baseImageDataUrl, size }, session.teacherId);

    // Return the submission immediately with PENDING status
    // The client will poll for updates
    return NextResponse.json({
      submission: {
        id: submission.id,
        prompt: submission.prompt,
        createdAt: submission.createdAt,
        imageData: null,
        imageMimeType: null,
        revisionIndex: submission.revisionIndex,
        parentSubmissionId: submission.parentSubmissionId,
        rootSubmissionId: submission.rootSubmissionId ?? submission.id,
        isShared: submission.isShared,
        status: SubmissionStatus.PENDING,
      },
    });
  } catch (error) {
    console.error('Image generation failed', error);
    if (error instanceof z.ZodError) {
      return NextResponse.json({ message: error.issues[0]?.message ?? 'Invalid input' }, { status: 400 });
    }
    return NextResponse.json({ message: 'Unable to generate image' }, { status: 500 });
  }
}

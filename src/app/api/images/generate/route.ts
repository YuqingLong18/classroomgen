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
  referenceImage: z.string().optional(),
  referenceImages: z.array(z.string()).optional(),
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
    const { prompt, parentSubmissionId, size, referenceImage, referenceImages } = bodySchema.parse(body);

    const session = await prisma.session.findUnique({
      where: { id: sessionId },
      select: {
        isActive: true,
        maxStudentEdits: true,
        teacherId: true,
        classroomCode: true,
        teacher: {
          select: {
            username: true,
          },
        },
      },
    });

    if (!session || !session.isActive) {
      return NextResponse.json({ message: 'Session expired. Please ask the teacher to restart.' }, { status: 403 });
    }

    // Get teacher API key for content filter
    let teacherApiKey: string | null = null;
    if (session.teacherId) {
      const { getTeacherApiKey } = await import('@/lib/teacherApiKey');
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

    // Validate and Optimize Reference Images
    let optimizedReferenceImages: string[] | undefined;

    const isValidSize = (img: string) => img.length <= 5 * 1024 * 1024;

    const subDir = session.teacher
      ? `${session.teacher.username}/${session.classroomCode}`
      : `${session.teacherId || 'unknown'}/${session.classroomCode}`;

    if (referenceImages && referenceImages.length > 0) {
      optimizedReferenceImages = [];
      const { saveImage } = await import('@/lib/storage');

      for (const img of referenceImages) {
        if (!img.startsWith('data:image/') || !isValidSize(img)) {
          return NextResponse.json({ message: 'One or more reference images are invalid or too large.' }, { status: 400 });
        }

        try {
          const matches = img.match(/^data:([A-Za-z-+\/]+);base64,(.+)$/);
          if (matches && matches.length === 3) {
            const mimeType = matches[1];
            const buffer = Buffer.from(matches[2], 'base64');
            const path = await saveImage(buffer, mimeType, subDir);
            optimizedReferenceImages.push(path);
          } else {
            optimizedReferenceImages.push(img);
          }
        } catch (e) {
          console.error('Failed to process reference image', e);
          return NextResponse.json({ message: 'Failed to process reference images.' }, { status: 500 });
        }
      }
    } else if (referenceImage) {
      // Legacy single image
      if (!referenceImage.startsWith('data:image/') || !isValidSize(referenceImage)) {
        return NextResponse.json({ message: 'Reference image is invalid or too large.' }, { status: 400 });
      }

      const { saveImage } = await import('@/lib/storage');
      try {
        const matches = referenceImage.match(/^data:([A-Za-z-+\/]+);base64,(.+)$/);
        if (matches && matches.length === 3) {
          const mimeType = matches[1];
          const buffer = Buffer.from(matches[2], 'base64');
          const path = await saveImage(buffer, mimeType, subDir);
          optimizedReferenceImages.push(path);
        } else {
          optimizedReferenceImages = [referenceImage];
        }
      } catch (e) {
        console.error('Failed to process reference image', e);
        return NextResponse.json({ message: 'Failed to process reference image.' }, { status: 500 });
      }
    } else if (parentSubmissionId) {
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
      if (parent.imageData && parent.imageData.startsWith('/api/uploads/')) {
        try {
          const fs = await import('fs/promises');
          const path = await import('path');
          const relativePath = parent.imageData.split('/api/uploads/')[1];
          if (relativePath) {
            const filepath = path.join(process.cwd(), 'uploads', ...relativePath.split('/'));
            const buffer = await fs.readFile(filepath);
            baseImageDataUrl = `data:${parent.imageMimeType ?? 'image/png'};base64,${buffer.toString('base64')}`;
          }
        } catch (e) {
          console.error('Failed to read parent image file', e);
          return NextResponse.json({ message: 'Original image file is missing.' }, { status: 422 });
        }
      } else {
        baseImageDataUrl = `data:${parent.imageMimeType ?? 'image/png'};base64,${parent.imageData}`;
      }
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
        status: SubmissionStatus.PENDING,
        referenceImages: optimizedReferenceImages ? JSON.stringify(optimizedReferenceImages) : null,
      },
    });

    enqueueImageGeneration(submission.id, prompt, {
      baseImageDataUrl,
      referenceImages: optimizedReferenceImages,
      size
    }, session.teacherId);

    return NextResponse.json({
      submission: {
        id: submission.id,
        prompt: submission.prompt,
        createdAt: submission.createdAt,
        imageData: null, // Client waits for update
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

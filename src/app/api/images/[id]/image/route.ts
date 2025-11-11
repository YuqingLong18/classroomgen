import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { getSessionFromCookies } from '@/lib/session';

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const { sessionId, role, studentId } = await getSessionFromCookies();

  if (!sessionId) {
    return NextResponse.json({ message: 'Unauthorized' }, { status: 401 });
  }

  const submission = await prisma.promptSubmission.findUnique({
    where: { id },
    select: {
      id: true,
      imageData: true,
      imageMimeType: true,
      sessionId: true,
      status: true,
      isShared: true,
      studentId: true,
    },
  });

  if (!submission || submission.sessionId !== sessionId) {
    return NextResponse.json({ message: 'Image not found' }, { status: 404 });
  }

  // Check access permissions
  if (role !== 'teacher') {
    if (submission.status !== 'SUCCESS') {
      return NextResponse.json({ message: 'Image not available' }, { status: 404 });
    }
    if (!submission.isShared && submission.studentId !== studentId) {
      return NextResponse.json({ message: 'Access denied' }, { status: 403 });
    }
  }

  if (!submission.imageData) {
    return NextResponse.json({ message: 'Image data not available' }, { status: 404 });
  }

  const mimeType = submission.imageMimeType || 'image/png';
  const imageBuffer = Buffer.from(submission.imageData, 'base64');

  return new NextResponse(imageBuffer, {
    headers: {
      'Content-Type': mimeType,
      'Cache-Control': 'public, max-age=31536000, immutable',
      'Content-Length': imageBuffer.length.toString(),
    },
  });
}


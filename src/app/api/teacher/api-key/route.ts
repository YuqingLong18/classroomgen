import { NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { verifyTeacherAccess } from '@/lib/session';
import { encryptApiKey } from '@/lib/apiKeyEncryption';
import { getTeacherApiKeyDetails } from '@/lib/teacherApiKey';

const bodySchema = z.object({
  apiKey: z.string().trim().min(1, 'API key is required'),
});

export async function GET() {
  try {
    const teacherAccess = await verifyTeacherAccess();
    if (!teacherAccess) {
      return NextResponse.json({ message: 'Teacher access only.' }, { status: 403 });
    }

    // Get teacher from session
    const session = await prisma.session.findUnique({
      where: { id: teacherAccess.sessionId },
      select: {
        teacherId: true,
      },
    });

    if (!session) {
      return NextResponse.json({ message: 'Session not found.' }, { status: 404 });
    }

    const details = await getTeacherApiKeyDetails(session.teacherId);
    if (!details) {
      return NextResponse.json({ message: 'Teacher not found.' }, { status: 404 });
    }

    return NextResponse.json({
      hasApiKey: details.hasApiKey,
      managedByEnv: details.managedByEnv,
    });
  } catch (error) {
    console.error('Failed to get API key status', error);
    return NextResponse.json(
      { message: 'Unable to get API key status.' },
      { status: 500 }
    );
  }
}

export async function POST(request: Request) {
  try {
    const teacherAccess = await verifyTeacherAccess();
    if (!teacherAccess) {
      return NextResponse.json({ message: 'Teacher access only.' }, { status: 403 });
    }

    const json = await request.json();
    const { apiKey } = bodySchema.parse(json);

    // Get teacher from session
    const session = await prisma.session.findUnique({
      where: { id: teacherAccess.sessionId },
      select: {
        teacherId: true,
      },
    });

    if (!session) {
      return NextResponse.json({ message: 'Session not found.' }, { status: 404 });
    }

    const details = await getTeacherApiKeyDetails(session.teacherId);
    if (details.managedByEnv) {
      return NextResponse.json(
        { message: 'Microsoft SSO teachers use the school-managed API key from the server configuration.' },
        { status: 403 }
      );
    }

    // Encrypt the API key before storing
    const encryptedApiKey = encryptApiKey(apiKey.trim());

    // Update teacher with encrypted API key
    await prisma.teacher.update({
      where: { id: session.teacherId },
      data: {
        apiKeyEncrypted: encryptedApiKey,
      },
    });

    console.log(`Teacher ${session.teacherId} updated API key`);

    return NextResponse.json({
      success: true,
      message: 'API key saved successfully.',
    });
  } catch (error) {
    console.error('Failed to save API key', error);
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { message: error.issues[0]?.message ?? 'Invalid input' },
        { status: 400 }
      );
    }
    return NextResponse.json(
      { message: 'Unable to save API key.' },
      { status: 500 }
    );
  }
}

import { NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { verifyTeacherAccess } from '@/lib/session';
import { encryptApiKey } from '@/lib/apiKeyEncryption';
import { getTeacherApiKeyDetails } from '@/lib/teacherApiKey';
import type { AiProvider, TeacherApiKeyDetails } from '@/lib/teacherApiKey';

const bodySchema = z.object({
  provider: z.enum(['VOLCENGINE', 'OPENROUTER']).optional(),
  apiKey: z.string().trim().min(1, 'API key is required').max(4096, 'API key is too long').optional(),
});

function serializeApiKeyStatus(details: TeacherApiKeyDetails) {
  return {
    provider: details.provider,
    hasApiKey: details.hasApiKey,
    managedByEnv: details.managedByEnv,
    hasVolcengineApiKey: details.hasVolcengineApiKey,
    hasOpenRouterApiKey: details.hasOpenRouterApiKey,
    volcengineManagedByEnv: details.volcengineManagedByEnv,
    openRouterManagedByEnv: details.openRouterManagedByEnv,
  };
}

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

    return NextResponse.json(serializeApiKeyStatus(details));
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
    const { provider = 'VOLCENGINE', apiKey } = bodySchema.parse(json);

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
    const data: {
      aiProvider: AiProvider;
      apiKeyEncrypted?: string;
      openRouterApiKeyEncrypted?: string;
    } = {
      aiProvider: provider,
    };

    if (provider === 'VOLCENGINE' && details.volcengineManagedByEnv && apiKey) {
      return NextResponse.json(
        { message: 'Microsoft SSO teachers use the school-managed API key from the server configuration.' },
        { status: 403 }
      );
    }

    if (apiKey) {
      const encryptedApiKey = encryptApiKey(apiKey.trim());
      if (provider === 'OPENROUTER') {
        data.openRouterApiKeyEncrypted = encryptedApiKey;
      } else {
        data.apiKeyEncrypted = encryptedApiKey;
      }
    } else if (provider === 'OPENROUTER' && !details.hasOpenRouterApiKey) {
      return NextResponse.json(
        { message: 'OpenRouter API key is required before enabling OpenRouter.' },
        { status: 400 }
      );
    } else if (provider === 'VOLCENGINE' && !details.hasVolcengineApiKey) {
      return NextResponse.json(
        { message: 'Volcengine API key is required before enabling Volcengine.' },
        { status: 400 }
      );
    }

    await prisma.teacher.update({
      where: { id: session.teacherId },
      data,
    });

    console.log(`Teacher ${session.teacherId} updated AI provider settings (${provider})`);
    const updatedDetails = await getTeacherApiKeyDetails(session.teacherId);

    return NextResponse.json({
      success: true,
      message: 'API key saved successfully.',
      ...serializeApiKeyStatus(updatedDetails),
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

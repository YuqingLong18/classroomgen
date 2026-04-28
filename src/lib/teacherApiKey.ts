import { prisma } from '@/lib/prisma';
import { decryptApiKey } from '@/lib/apiKeyEncryption';

export type AiProvider = 'VOLCENGINE' | 'OPENROUTER';

export type TeacherApiKeyDetails = {
  apiKey: string | null;
  hasApiKey: boolean;
  managedByEnv: boolean;
  provider: AiProvider;
  configuredProvider: AiProvider | null;
  hasVolcengineApiKey: boolean;
  hasOpenRouterApiKey: boolean;
  volcengineManagedByEnv: boolean;
  openRouterManagedByEnv: boolean;
};

const AI_PROVIDERS = new Set<AiProvider>(['VOLCENGINE', 'OPENROUTER']);

function normalizeProvider(provider?: string | null): AiProvider | null {
  if (!provider || !AI_PROVIDERS.has(provider as AiProvider)) {
    return null;
  }

  return provider as AiProvider;
}

function defaultProvider(): AiProvider {
  return process.env.OPENROUTER_API_KEY?.trim() ? 'OPENROUTER' : 'VOLCENGINE';
}

/**
 * Helper function to get decrypted active API key for a teacher.
 * This should only be called server-side and never exposed to client
 */
export async function getTeacherApiKeyDetails(teacherId: string): Promise<TeacherApiKeyDetails> {
  try {
    const teacher = await prisma.teacher.findUnique({
      where: { id: teacherId },
      select: {
        email: true,
        aiProvider: true,
        apiKeyEncrypted: true,
        openRouterApiKeyEncrypted: true,
      },
    });

    const sharedVolcengineApiKey = process.env.VOLCENGINE_API_KEY?.trim() || null;
    const sharedOpenRouterApiKey = process.env.OPENROUTER_API_KEY?.trim() || null;
    const configuredProvider = normalizeProvider(teacher?.aiProvider);
    const provider = configuredProvider ?? defaultProvider();
    const volcengineManagedByEnv = Boolean(sharedVolcengineApiKey) && Boolean(teacher?.email);
    const openRouterManagedByEnv = Boolean(sharedOpenRouterApiKey);
    const hasVolcengineApiKey = volcengineManagedByEnv || Boolean(teacher?.apiKeyEncrypted);
    const hasOpenRouterApiKey = openRouterManagedByEnv || Boolean(teacher?.openRouterApiKeyEncrypted);

    if (provider === 'OPENROUTER') {
      const apiKey = teacher?.openRouterApiKeyEncrypted
        ? decryptApiKey(teacher.openRouterApiKeyEncrypted)
        : sharedOpenRouterApiKey;

      return {
        apiKey: apiKey ?? null,
        hasApiKey: hasOpenRouterApiKey,
        managedByEnv: openRouterManagedByEnv && !teacher?.openRouterApiKeyEncrypted,
        provider,
        configuredProvider,
        hasVolcengineApiKey,
        hasOpenRouterApiKey,
        volcengineManagedByEnv,
        openRouterManagedByEnv,
      };
    }

    if (volcengineManagedByEnv) {
      return {
        apiKey: sharedVolcengineApiKey,
        hasApiKey: true,
        managedByEnv: true,
        provider,
        configuredProvider,
        hasVolcengineApiKey,
        hasOpenRouterApiKey,
        volcengineManagedByEnv,
        openRouterManagedByEnv,
      };
    }

    const apiKey = teacher?.apiKeyEncrypted ? decryptApiKey(teacher.apiKeyEncrypted) : null;

    return {
      apiKey,
      hasApiKey: hasVolcengineApiKey,
      managedByEnv: false,
      provider,
      configuredProvider,
      hasVolcengineApiKey,
      hasOpenRouterApiKey,
      volcengineManagedByEnv,
      openRouterManagedByEnv,
    };
  } catch (error) {
    console.error('Failed to decrypt teacher API key', error);
    return {
      apiKey: null,
      hasApiKey: false,
      managedByEnv: false,
      provider: defaultProvider(),
      configuredProvider: null,
      hasVolcengineApiKey: false,
      hasOpenRouterApiKey: false,
      volcengineManagedByEnv: false,
      openRouterManagedByEnv: Boolean(process.env.OPENROUTER_API_KEY?.trim()),
    };
  }
}

export async function getTeacherApiKey(teacherId: string): Promise<string | null> {
  const details = await getTeacherApiKeyDetails(teacherId);
  return details.apiKey;
}

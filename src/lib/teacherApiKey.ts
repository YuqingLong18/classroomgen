import { prisma } from '@/lib/prisma';
import { decryptApiKey } from '@/lib/apiKeyEncryption';

type TeacherApiKeyDetails = {
  apiKey: string | null;
  hasApiKey: boolean;
  managedByEnv: boolean;
};

/**
 * Helper function to get decrypted API key for a teacher
 * This should only be called server-side and never exposed to client
 */
export async function getTeacherApiKeyDetails(teacherId: string): Promise<TeacherApiKeyDetails> {
  try {
    const teacher = await prisma.teacher.findUnique({
      where: { id: teacherId },
      select: {
        email: true,
        apiKeyEncrypted: true,
      },
    });

    const sharedApiKey = process.env.VOLCENGINE_API_KEY?.trim() || null;
    const managedByEnv = Boolean(sharedApiKey) && Boolean(teacher?.email);

    if (managedByEnv) {
      return {
        apiKey: sharedApiKey,
        hasApiKey: true,
        managedByEnv: true,
      };
    }

    if (!teacher || !teacher.apiKeyEncrypted) {
      return {
        apiKey: null,
        hasApiKey: false,
        managedByEnv: false,
      };
    }

    return {
      apiKey: decryptApiKey(teacher.apiKeyEncrypted),
      hasApiKey: true,
      managedByEnv: false,
    };
  } catch (error) {
    console.error('Failed to decrypt teacher API key', error);
    return {
      apiKey: null,
      hasApiKey: false,
      managedByEnv: false,
    };
  }
}

export async function getTeacherApiKey(teacherId: string): Promise<string | null> {
  const details = await getTeacherApiKeyDetails(teacherId);
  return details.apiKey;
}

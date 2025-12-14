import { prisma } from '@/lib/prisma';
import { decryptApiKey } from '@/lib/apiKeyEncryption';

/**
 * Helper function to get decrypted API key for a teacher
 * This should only be called server-side and never exposed to client
 */
export async function getTeacherApiKey(teacherId: string): Promise<string | null> {
  try {
    const teacher = await prisma.teacher.findUnique({
      where: { id: teacherId },
      select: {
        apiKeyEncrypted: true,
      },
    });

    if (!teacher || !teacher.apiKeyEncrypted) {
      return null;
    }

    return decryptApiKey(teacher.apiKeyEncrypted);
  } catch (error) {
    console.error('Failed to decrypt teacher API key', error);
    return null;
  }
}

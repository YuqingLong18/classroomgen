import crypto from 'crypto';
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { getSessionFromCookies } from '@/lib/session';
import { hashPassword } from '@/lib/auth';

const bodySchema = z.object({
  count: z.number().int().min(1).max(50),
});

function randomCode(length = 6) {
  const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
  const bytes = crypto.randomBytes(length);
  let result = '';
  for (let i = 0; i < length; i += 1) {
    result += chars[bytes[i] % chars.length];
  }
  return result;
}

export async function POST(request: Request) {
  try {
    const { sessionId, role } = await getSessionFromCookies();

    if (!sessionId || role !== 'teacher') {
      return NextResponse.json({ message: 'Teacher access only.' }, { status: 403 });
    }

    const json = await request.json();
    const { count } = bodySchema.parse(json);

    const existing = await prisma.student.findMany({
      where: { sessionId },
      select: { username: true },
    });
    const usedUsernames = new Set(existing.map((entry) => entry.username.toLowerCase()));

    const credentials: Array<{ username: string; password: string }> = [];

    await prisma.$transaction(async (tx) => {
      for (let i = 0; i < count; i += 1) {
        let username = randomCode();
        while (usedUsernames.has(username.toLowerCase())) {
          username = randomCode();
        }
        usedUsernames.add(username.toLowerCase());
        const password = randomCode();
        const passwordHash = await hashPassword(password);
        await tx.student.create({
          data: {
            username,
            passwordHash,
            sessionId,
          },
        });
        credentials.push({ username, password });
      }
    });

    return NextResponse.json({ credentials });
  } catch (error) {
    console.error('Failed to generate student credentials', error);
    if (error instanceof z.ZodError) {
      return NextResponse.json({ message: error.issues[0]?.message ?? 'Invalid input' }, { status: 400 });
    }
    return NextResponse.json({ message: 'Unable to generate student credentials' }, { status: 500 });
  }
}

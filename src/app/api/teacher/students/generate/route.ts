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
    let sessionId: string | undefined;
    let role: string | undefined;
    
    try {
      const cookies = await getSessionFromCookies();
      sessionId = cookies.sessionId;
      role = cookies.role;
    } catch (cookieError) {
      console.error('Error reading cookies:', cookieError);
      return NextResponse.json({ message: 'Session error. Please refresh and try again.' }, { status: 401 });
    }

    if (!sessionId || role !== 'teacher') {
      return NextResponse.json({ message: 'Teacher access only.' }, { status: 403 });
    }

    // Verify session exists and is active
    const session = await prisma.session.findUnique({
      where: { id: sessionId },
      select: { id: true, isActive: true },
    });

    if (!session || !session.isActive) {
      return NextResponse.json({ message: 'Session not found or inactive.' }, { status: 403 });
    }

    const json = await request.json();
    const { count } = bodySchema.parse(json);

    const existing = await prisma.student.findMany({
      where: { sessionId },
      select: { username: true },
    });
    const usedUsernames = new Set(existing.map((entry) => entry.username.toLowerCase()));

    const credentials: Array<{ username: string; password: string }> = [];

    try {
      await prisma.$transaction(async (tx) => {
        for (let i = 0; i < count; i += 1) {
          let username = randomCode();
          let attempts = 0;
          while (usedUsernames.has(username.toLowerCase()) && attempts < 100) {
            username = randomCode();
            attempts++;
          }
          if (attempts >= 100) {
            throw new Error('Unable to generate unique username after 100 attempts');
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
    } catch (transactionError) {
      console.error('Transaction error:', transactionError);
      throw transactionError;
    }

    return NextResponse.json({ credentials });
  } catch (error) {
    console.error('Failed to generate student credentials', error);
    if (error instanceof z.ZodError) {
      return NextResponse.json({ message: error.issues[0]?.message ?? 'Invalid input' }, { status: 400 });
    }
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    const errorStack = error instanceof Error ? error.stack : undefined;
    console.error('Error details:', { errorMessage, errorStack });
    return NextResponse.json(
      { 
        message: 'Unable to generate student credentials',
        error: process.env.NODE_ENV === 'development' ? errorMessage : undefined
      },
      { status: 500 }
    );
  }
}

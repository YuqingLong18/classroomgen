import { NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { getSessionFromCookies } from '@/lib/session';

const MAX_THREADS_PER_STUDENT = 5;
const CHAT_DISABLED_MESSAGE = 'Chat assistant is currently disabled.';

const createSchema = z.object({
  title: z.string().trim().max(80).optional(),
});

export async function GET() {
  const { sessionId, role, studentId } = await getSessionFromCookies();

  if (!sessionId || role !== 'student' || !studentId) {
    return NextResponse.json({ message: 'Student access required.' }, { status: 403 });
  }

  const session = await prisma.session.findUnique({
    where: { id: sessionId },
    select: {
      isActive: true,
      chatEnabled: true,
    },
  });

  if (!session || !session.isActive || !session.chatEnabled) {
    return NextResponse.json({ message: CHAT_DISABLED_MESSAGE }, { status: 403 });
  }

  const threads = await prisma.chatThread.findMany({
    where: { sessionId, studentId },
    orderBy: { updatedAt: 'desc' },
    include: {
      messages: {
        orderBy: { createdAt: 'desc' },
        take: 1,
      },
      _count: {
        select: { messages: true },
      },
    },
  });

  return NextResponse.json({
    threads: threads.map((thread) => ({
      id: thread.id,
      title: thread.title,
      createdAt: thread.createdAt,
      updatedAt: thread.updatedAt,
      latestMessage: thread.messages[0]?.content ?? null,
      messageCount: thread._count.messages,
    })),
    limit: MAX_THREADS_PER_STUDENT,
  });
}

export async function POST(request: Request) {
  try {
    const { sessionId, role, studentId } = await getSessionFromCookies();

    if (!sessionId || role !== 'student' || !studentId) {
      return NextResponse.json({ message: 'Student access required.' }, { status: 403 });
    }

    const session = await prisma.session.findUnique({
      where: { id: sessionId },
      select: {
        isActive: true,
        chatEnabled: true,
      },
    });

    if (!session || !session.isActive || !session.chatEnabled) {
      return NextResponse.json({ message: CHAT_DISABLED_MESSAGE }, { status: 403 });
    }

    const json = await request.json().catch(() => ({}));
    const { title } = createSchema.parse(json);

    const threadCount = await prisma.chatThread.count({
      where: { sessionId, studentId },
    });

    if (threadCount >= MAX_THREADS_PER_STUDENT) {
      return NextResponse.json({ message: 'You have reached the chat limit for this session.' }, { status: 400 });
    }

    const threadTitle = title && title.length > 0 ? title : `Conversation ${threadCount + 1}`;

    const thread = await prisma.chatThread.create({
      data: {
        title: threadTitle,
        sessionId,
        studentId,
      },
      include: {
        _count: { select: { messages: true } },
      },
    });

    return NextResponse.json({
      thread: {
        id: thread.id,
        title: thread.title,
        createdAt: thread.createdAt,
        updatedAt: thread.updatedAt,
        latestMessage: null,
        messageCount: thread._count.messages,
      },
      limit: MAX_THREADS_PER_STUDENT,
    });
  } catch (error) {
    console.error('Failed to create chat thread', error);
    if (error instanceof z.ZodError) {
      return NextResponse.json({ message: error.issues[0]?.message ?? 'Invalid input' }, { status: 400 });
    }
    return NextResponse.json({ message: 'Unable to create chat thread' }, { status: 500 });
  }
}

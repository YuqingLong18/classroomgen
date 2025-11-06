import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { getSessionFromCookies } from '@/lib/session';

export async function GET() {
  const { sessionId, role } = await getSessionFromCookies();

  if (!sessionId || role !== 'teacher') {
    return NextResponse.json({ message: 'Teacher access only.' }, { status: 403 });
  }

  const threads = await prisma.chatThread.findMany({
    where: { sessionId },
    orderBy: [{ student: { username: 'asc' } }, { createdAt: 'desc' }],
    include: {
      student: {
        select: {
          id: true,
          username: true,
        },
      },
      messages: {
        orderBy: { createdAt: 'asc' },
        select: {
          id: true,
          content: true,
          sender: true,
          createdAt: true,
        },
      },
    },
  });

  return NextResponse.json({
    threads: threads.map((thread) => ({
      id: thread.id,
      title: thread.title,
      student: thread.student ? { id: thread.student.id, username: thread.student.username } : null,
      createdAt: thread.createdAt,
      updatedAt: thread.updatedAt,
      messages: thread.messages.map((message) => ({
        id: message.id,
        content: message.content,
        sender: message.sender,
        createdAt: message.createdAt,
      })),
    })),
  });
}

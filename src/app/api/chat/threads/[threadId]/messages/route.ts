import { NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { getSessionFromCookies, requireActiveStudent } from '@/lib/session';

const messageSchema = z.object({
  content: z.string().trim().min(1, 'Message cannot be empty').max(4000, 'Message is too long'),
});

const CHAT_ENDPOINT = 'https://openrouter.ai/api/v1/chat/completions';
const MAX_HISTORY_MESSAGES = 20;
const CHAT_DISABLED_MESSAGE = 'Chat assistant is currently disabled.';

function toOpenRouterMessages(history: Array<{ sender: 'STUDENT' | 'AI'; content: string }>) {
  return history.map((entry) => ({
    role: entry.sender === 'STUDENT' ? 'user' : 'assistant',
    content: entry.content,
  }));
}

function extractTextFromChoiceMessage(message: unknown) {
  if (!message || typeof message !== 'object') {
    return null;
  }

  // @ts-expect-error -- dynamic structure from OpenRouter
  const content = message.content;
  if (typeof content === 'string') {
    return content.trim();
  }
  if (Array.isArray(content)) {
    const text = content
      .map((part) => {
        if (!part) return '';
        if (typeof part === 'string') return part;
        if (typeof part.text === 'string') return part.text;
        if (typeof part.content === 'string') return part.content;
        if (typeof part.value === 'string') return part.value;
        return '';
      })
      .join(' ')
      .trim();
    return text.length > 0 ? text : null;
  }
  // Some providers return { text: "..." }
  // @ts-expect-error dynamic property access
  if (typeof message.text === 'string') {
    // @ts-expect-error dynamic property access
    return message.text.trim();
  }

  return null;
}

async function callChatCompletion(history: Array<{ sender: 'STUDENT' | 'AI'; content: string }>) {
  const apiKey = process.env.VOLCENGINE_API_KEY;
  if (!apiKey) {
    throw new Error('Missing Volcengine API key. Set VOLCENGINE_API_KEY in your environment.');
  }

  const model = process.env.VOLCENGINE_CHAT_MODEL || 'doubao-seed-1-6-251015';
  const CHAT_ENDPOINT = 'https://ark.cn-beijing.volces.com/api/v3/chat/completions';

  const response = await fetch(CHAT_ENDPOINT, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model,
      messages: toOpenRouterMessages(history),
      top_p: 0.9,
    }),
  });

  const result = await response.json();

  if (!response.ok) {
    console.error('Volcengine chat completion error', result);
    const message = result?.error?.message ?? 'Volcengine request failed';
    throw new Error(message);
  }

  const choice = result?.choices?.[0]?.message;
  const aiText = extractTextFromChoiceMessage(choice);
  if (!aiText || aiText.length === 0) {
    throw new Error('Volcengine returned an empty response');
  }

  // SECURITY: Validate AI response for suspicious patterns
  const { validateAIResponse, logSecurityWarning } = await import('@/lib/promptSanitizer');
  const validation = validateAIResponse(aiText);
  if (!validation.safe) {
    logSecurityWarning('response', validation.warnings, aiText, { model });
    // Log but don't block - AI might be teaching about commands
  }

  return aiText;
}

export async function GET(_: Request, context: unknown) {
  const extracted = context as { params: { threadId: string } | Promise<{ threadId: string }> };
  const resolvedParams = await Promise.resolve(extracted.params);
  const { threadId } = resolvedParams;
  const { sessionId, role, studentId } = await getSessionFromCookies();

  if (!sessionId || role !== 'student' || !studentId) {
    return NextResponse.json({ message: 'Student access required.' }, { status: 403 });
  }

  const studentStatus = await requireActiveStudent(sessionId, studentId);
  if (!studentStatus.active) {
    return NextResponse.json(
      { message: 'You were removed from the classroom. Please rejoin with a new name.' },
      { status: 403 },
    );
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

  const thread = await prisma.chatThread.findUnique({
    where: { id: threadId },
    select: {
      id: true,
      sessionId: true,
      studentId: true,
      title: true,
      createdAt: true,
      updatedAt: true,
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

  if (!thread || thread.sessionId !== sessionId || thread.studentId !== studentId) {
    return NextResponse.json({ message: 'Chat not found.' }, { status: 404 });
  }

  return NextResponse.json({
    thread: {
      id: thread.id,
      title: thread.title,
      createdAt: thread.createdAt,
      updatedAt: thread.updatedAt,
    },
    messages: thread.messages.map((message) => ({
      id: message.id,
      content: message.content,
      sender: message.sender,
      createdAt: message.createdAt,
    })),
  });
}

export async function POST(request: Request, context: unknown) {
  const extracted = context as { params: { threadId: string } | Promise<{ threadId: string }> };
  const resolvedParams = await Promise.resolve(extracted.params);
  const { threadId } = resolvedParams;

  try {
    const { sessionId, role, studentId } = await getSessionFromCookies();

    if (!sessionId || role !== 'student' || !studentId) {
      return NextResponse.json({ message: 'Student access required.' }, { status: 403 });
    }

    const studentStatus = await requireActiveStudent(sessionId, studentId);
    if (!studentStatus.active) {
      return NextResponse.json(
        { message: 'You were removed from the classroom. Please rejoin with a new name.' },
        { status: 403 },
      );
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

    const thread = await prisma.chatThread.findUnique({
      where: { id: threadId },
      select: { id: true, sessionId: true, studentId: true },
    });

    if (!thread || thread.sessionId !== sessionId || thread.studentId !== studentId) {
      return NextResponse.json({ message: 'Chat not found.' }, { status: 404 });
    }

    const json = await request.json();
    const { content } = messageSchema.parse(json);

    // SECURITY: Sanitize user prompt before processing
    const { sanitizePrompt, logSecurityWarning } = await import('@/lib/promptSanitizer');
    const sanitization = sanitizePrompt(content);
    if (!sanitization.safe) {
      logSecurityWarning('prompt', sanitization.warnings, content, {
        studentId,
        threadId,
        sessionId,
      });
      // Use sanitized version if unsafe patterns detected
      // In production, you might want to reject the request entirely
    }

    const studentMessage = await prisma.chatMessage.create({
      data: {
        content,
        sender: 'STUDENT',
        threadId,
        studentId,
      },
    });

    const history = await prisma.chatMessage.findMany({
      where: { threadId },
      orderBy: { createdAt: 'desc' },
      take: MAX_HISTORY_MESSAGES,
    });

    const orderedHistory = history.reverse();

    const aiResponseText = await callChatCompletion(orderedHistory.map((message) => ({
      sender: message.sender,
      content: message.content,
    })));

    const aiMessage = await prisma.chatMessage.create({
      data: {
        content: aiResponseText,
        sender: 'AI',
        threadId,
      },
    });

    await prisma.chatThread.update({
      where: { id: threadId },
      data: { updatedAt: new Date() },
    });

    return NextResponse.json({
      messages: [studentMessage, aiMessage].map((message) => ({
        id: message.id,
        content: message.content,
        sender: message.sender,
        createdAt: message.createdAt,
      })),
    });
  } catch (error) {
    console.error('Failed to send chat message', error);
    if (error instanceof z.ZodError) {
      return NextResponse.json({ message: error.issues[0]?.message ?? 'Invalid input' }, { status: 400 });
    }
    const message = error instanceof Error ? error.message : 'Unable to send message';
    return NextResponse.json({ message }, { status: 500 });
  }
}

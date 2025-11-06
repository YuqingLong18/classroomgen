import { NextResponse } from 'next/server';
import { Buffer } from 'node:buffer';
import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { getSessionFromCookies } from '@/lib/session';
import { SubmissionStatus } from '@prisma/client';

const bodySchema = z.object({
  prompt: z.string().min(5, 'Please write a longer prompt to help the AI.'),
  parentSubmissionId: z.string().optional(),
});

const CHAT_ENDPOINT = 'https://openrouter.ai/api/v1/chat/completions';
const IMAGE_ENDPOINT = 'https://openrouter.ai/api/v1/images';

type CallOptions = {
  baseImageDataUrl?: string;
};

function isChatModel(model: string) {
  const normalized = model.toLowerCase();
  return normalized.includes('gemini') || normalized.includes('chat') || normalized.startsWith('google/');
}

type OpenRouterImage = string | { url?: string; data_url?: string };

type OpenRouterContentItem =
  | { type?: 'image_url'; image_url?: OpenRouterImage }
  | { type?: 'output_image'; image_url?: string; data?: string }
  | { type?: string; url?: string; data?: string };

type OpenRouterMessage = {
  images?: Array<{ image_url?: OpenRouterImage }>;
  content?: OpenRouterContentItem[];
};

function extractDataUrlFromMessage(message: unknown) {
  const msg = (message ?? {}) as OpenRouterMessage;
  const directImage = msg.images?.[0]?.image_url;

  if (typeof directImage === 'string') {
    return directImage;
  }

  if (directImage && typeof directImage === 'object') {
    const nested = directImage.url ?? directImage.data_url;
    if (typeof nested === 'string') {
      return nested;
    }
  }

  const content = Array.isArray(msg.content) ? msg.content : [];
  for (const item of content) {
    if (item?.type === 'image_url' && 'image_url' in item) {
      const imageUrl = item.image_url;
      if (typeof imageUrl === 'string') {
        return imageUrl;
      }
      if (imageUrl && typeof imageUrl === 'object') {
        const url = imageUrl.url ?? (imageUrl as { data_url?: string }).data_url;
        if (typeof url === 'string') {
          return url;
        }
      }
    }

    if (item?.type === 'output_image') {
      if ('image_url' in item && typeof item.image_url === 'string') {
        return item.image_url;
      }
      if ('data' in item && typeof item.data === 'string') {
        return item.data.startsWith('data:') ? item.data : `data:image/png;base64,${item.data}`;
      }
    }

    if ('url' in item && typeof item.url === 'string') {
      return item.url;
    }

    if ('data' in item && typeof item.data === 'string') {
      if (item.data.startsWith('data:')) {
        return item.data;
      }
      if (/^[A-Za-z0-9+/=]+$/.test(item.data)) {
        return `data:image/png;base64,${item.data}`;
      }
    }

    if (item && typeof item === 'object' && 'image_url' in item) {
      const urlValue = (item as { image_url?: string }).image_url;
      if (typeof urlValue === 'string') {
        return urlValue;
      }
    }
  }
  return null;
}

async function fetchImageAsBase64(urlOrDataUrl: string) {
  if (urlOrDataUrl.startsWith('data:')) {
    const [, meta, data] = urlOrDataUrl.match(/^data:([^;,]+)?(?:;base64)?,(.+)$/) ?? [];
    if (!data) {
      throw new Error('Invalid data URL in OpenRouter response');
    }
    const mimeType = meta || 'image/png';
    const imageData = urlOrDataUrl.includes(';base64,') ? data : Buffer.from(decodeURIComponent(data)).toString('base64');
    return { imageData, mimeType };
  }

  const response = await fetch(urlOrDataUrl);
  if (!response.ok) {
    throw new Error('Failed to download image from OpenRouter response');
  }
  const buffer = Buffer.from(await response.arrayBuffer()).toString('base64');
  const mimeType = response.headers.get('content-type') ?? 'image/png';
  return { imageData: buffer, mimeType };
}

async function callOpenRouter(prompt: string, options: CallOptions = {}) {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) {
    throw new Error('Missing OpenRouter API key. Set OPENROUTER_API_KEY in your environment.');
  }

  const model = process.env.OPENROUTER_IMAGE_MODEL || process.env.OPENROUTER_MODEL || 'openai/gpt-image-1';
  const headers = {
    Authorization: `Bearer ${apiKey}`,
    'Content-Type': 'application/json',
    'HTTP-Referer': process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000',
    'X-Title': 'Classroom Image Generator',
  };

  if (isChatModel(model)) {
    const messages = options.baseImageDataUrl
      ? [{
          role: 'user',
          content: [
            { type: 'text', text: prompt },
            { type: 'image_url', image_url: { url: options.baseImageDataUrl } },
          ],
        }]
      : [{ role: 'user', content: prompt }];

    const response = await fetch(CHAT_ENDPOINT, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        model,
        messages,
        modalities: ['image', 'text'],
      }),
    });

    const result = await response.json();

    if (!response.ok) {
      console.error('OpenRouter chat error', result);
      const message = result?.error?.message ?? 'OpenRouter chat request failed';
      throw new Error(message);
    }

    const dataUrl = extractDataUrlFromMessage(result?.choices?.[0]?.message);
    if (!dataUrl) {
      throw new Error('OpenRouter did not return an image link');
    }

    return fetchImageAsBase64(dataUrl);
  }

  const response = await fetch(IMAGE_ENDPOINT, {
    method: 'POST',
    headers,
    body: JSON.stringify({ model, prompt }),
  });

  const result = await response.json();

  if (!response.ok) {
    console.error('OpenRouter image error', result);
    const message = result?.error?.message ?? 'OpenRouter request failed';
    throw new Error(message);
  }

  const imagePayload = result?.data?.[0];
  if (!imagePayload) {
    throw new Error('OpenRouter did not return image data');
  }

  const base64 = imagePayload?.b64_json ?? imagePayload?.b64 ?? imagePayload?.image_base64;
  const url = imagePayload?.url;

  if (base64) {
    const mimeType = imagePayload?.mime_type ?? 'image/png';
    return { imageData: base64 as string, mimeType };
  }

  if (url) {
    return fetchImageAsBase64(url as string);
  }

  throw new Error('OpenRouter response missing base64 or URL data');
}

export async function POST(request: Request) {
  const { sessionId, role, studentId } = await getSessionFromCookies();

  if (!sessionId || !role) {
    return NextResponse.json({ message: 'Join the classroom session before generating images.' }, { status: 401 });
  }

  if (role !== 'student' || !studentId) {
    return NextResponse.json({ message: 'Only students can generate images in this view.' }, { status: 403 });
  }

  const body = await request.json();

  try {
    const { prompt, parentSubmissionId } = bodySchema.parse(body);

    const session = await prisma.session.findUnique({
      where: { id: sessionId },
      select: {
        isActive: true,
        maxStudentEdits: true,
      },
    });

    if (!session || !session.isActive) {
      return NextResponse.json({ message: 'Session expired. Please ask the teacher to restart.' }, { status: 403 });
    }

    const maxEditsAllowed = session.maxStudentEdits ?? 3;

    let rootSubmissionId: string | null = null;
    let revisionIndex = 0;

    let baseImageDataUrl: string | undefined;

    if (parentSubmissionId) {
      const parent = await prisma.promptSubmission.findUnique({
        where: { id: parentSubmissionId },
        select: {
          id: true,
          studentId: true,
          sessionId: true,
          rootSubmissionId: true,
          imageData: true,
          imageMimeType: true,
        },
      });

      if (!parent || parent.sessionId !== sessionId) {
        return NextResponse.json({ message: 'Original image not found for this session.' }, { status: 404 });
      }

      if (parent.studentId !== studentId) {
        return NextResponse.json({ message: 'You can only refine images you created.' }, { status: 403 });
      }

      if (!parent.imageData) {
        return NextResponse.json({ message: 'Original image data is unavailable for refinement.' }, { status: 422 });
      }

      const rootId = parent.rootSubmissionId ?? parent.id;
      const chainCount = await prisma.promptSubmission.count({
        where: {
          sessionId,
          OR: [{ id: rootId }, { rootSubmissionId: rootId }],
          status: { in: [SubmissionStatus.PENDING, SubmissionStatus.SUCCESS] },
        },
      });

      if (chainCount >= maxEditsAllowed) {
        return NextResponse.json({ message: 'This image has no refinements remaining.' }, { status: 400 });
      }

      rootSubmissionId = rootId;
      revisionIndex = chainCount;
      baseImageDataUrl = `data:${parent.imageMimeType ?? 'image/png'};base64,${parent.imageData}`;
    }

    const submission = await prisma.promptSubmission.create({
      data: {
        sessionId,
        prompt,
        role: 'STUDENT',
        studentId,
        rootSubmissionId,
        parentSubmissionId: parentSubmissionId ?? null,
        revisionIndex,
      },
    });

    try {
      const { imageData, mimeType } = await callOpenRouter(prompt, { baseImageDataUrl });
      const updated = await prisma.promptSubmission.update({
        where: { id: submission.id },
        data: {
          status: SubmissionStatus.SUCCESS,
          imageData,
          imageMimeType: mimeType,
        },
      });

      return NextResponse.json({
        submission: {
          id: updated.id,
          prompt: updated.prompt,
          createdAt: updated.createdAt,
          imageData: updated.imageData,
          imageMimeType: updated.imageMimeType,
          revisionIndex: updated.revisionIndex,
          parentSubmissionId: updated.parentSubmissionId,
          rootSubmissionId: updated.rootSubmissionId ?? updated.id,
          isShared: updated.isShared,
        },
      });
    } catch (generationError) {
      const message = generationError instanceof Error ? generationError.message : 'Image generation failed';
      await prisma.promptSubmission.update({
        where: { id: submission.id },
        data: {
          status: SubmissionStatus.ERROR,
          errorMessage: message,
        },
      });
      return NextResponse.json({ message }, { status: 502 });
    }
  } catch (error) {
    console.error('Image generation failed', error);
    if (error instanceof z.ZodError) {
      return NextResponse.json({ message: error.issues[0]?.message ?? 'Invalid input' }, { status: 400 });
    }
    return NextResponse.json({ message: 'Unable to generate image' }, { status: 500 });
  }
}

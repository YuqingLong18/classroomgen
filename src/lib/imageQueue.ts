/**
 * Background job queue for processing image generation requests concurrently.
 * This allows multiple image generation requests to be processed in parallel
 * instead of blocking sequentially.
 */

import { Buffer } from 'node:buffer';
import { prisma } from '@/lib/prisma';
import { SubmissionStatus } from '@prisma/client';

type CallOptions = {
  baseImageDataUrl?: string;
};

type ImageGenerationJob = {
  submissionId: string;
  prompt: string;
  options: CallOptions;
};

// Configuration for concurrent processing
// Memory considerations:
// - Each concurrent job processes ~1-4MB base64 image data temporarily
// - HTTP request/response buffers add ~1-2MB per job
// - With 20 concurrent jobs: ~40-120MB peak memory usage
// - Memory is freed immediately after each job completes
const MAX_CONCURRENT_JOBS = 20; // Process up to 20 images simultaneously
const POLL_INTERVAL_MS = 1000; // Check for new jobs every second

class ImageGenerationQueue {
  private queue: ImageGenerationJob[] = [];
  private processing = new Set<string>(); // Track submission IDs being processed
  private activeJobs = 0;
  private isRunning = false;

  /**
   * Add a job to the queue
   */
  enqueue(job: ImageGenerationJob) {
    this.queue.push(job);
    if (!this.isRunning) {
      this.start();
    }
  }

  /**
   * Start processing the queue
   */
  private start() {
    if (this.isRunning) return;
    this.isRunning = true;
    this.processQueue();
  }

  /**
   * Process the queue with concurrency control
   */
  private async processQueue() {
    while (this.queue.length > 0 || this.activeJobs > 0) {
      // Start as many jobs as we can up to the concurrency limit
      while (this.queue.length > 0 && this.activeJobs < MAX_CONCURRENT_JOBS) {
        const job = this.queue.shift();
        if (job && !this.processing.has(job.submissionId)) {
          this.activeJobs++;
          this.processing.add(job.submissionId);
          // Process job asynchronously without blocking
          this.processJob(job).catch((error) => {
            console.error(`Error processing job ${job.submissionId}:`, error);
          });
        }
      }

      // Wait a bit before checking again
      await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
    }

    this.isRunning = false;
  }

  /**
   * Process a single image generation job
   */
  private async processJob(job: ImageGenerationJob) {
    try {
      const { imageData, mimeType } = await callOpenRouter(job.prompt, job.options);

      await prisma.promptSubmission.update({
        where: { id: job.submissionId },
        data: {
          status: SubmissionStatus.SUCCESS,
          imageData,
          imageMimeType: mimeType,
        },
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Image generation failed';
      console.error(`Image generation failed for submission ${job.submissionId}:`, error);

      await prisma.promptSubmission.update({
        where: { id: job.submissionId },
        data: {
          status: SubmissionStatus.ERROR,
          errorMessage: message,
        },
      });
    } finally {
      this.processing.delete(job.submissionId);
      this.activeJobs--;
    }
  }
}

// Import the callOpenRouter function from the generate route
// We'll need to extract it to a shared module
async function callOpenRouter(prompt: string, options: CallOptions = {}) {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) {
    throw new Error('Missing OpenRouter API key. Set OPENROUTER_API_KEY in your environment.');
  }

  const CHAT_ENDPOINT = 'https://openrouter.ai/api/v1/chat/completions';
  const IMAGE_ENDPOINT = 'https://openrouter.ai/api/v1/images';

  const model = process.env.OPENROUTER_IMAGE_MODEL || process.env.OPENROUTER_MODEL || 'openai/gpt-image-1';
  const headers = {
    Authorization: `Bearer ${apiKey}`,
    'Content-Type': 'application/json',
    'HTTP-Referer': process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000',
    'X-Title': 'Classroom Image Generator',
  };

  function isChatModel(model: string) {
    const normalized = model.toLowerCase();
    return normalized.includes('gemini') || normalized.includes('chat') || normalized.startsWith('google/');
  }

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

// Singleton instance
const imageQueue = new ImageGenerationQueue();

export function enqueueImageGeneration(submissionId: string, prompt: string, options: CallOptions = {}) {
  imageQueue.enqueue({ submissionId, prompt, options });
}


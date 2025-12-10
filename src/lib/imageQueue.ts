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
  size?: string;
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
      const { imageData, mimeType } = await callImageGeneration(job.prompt, job.options);

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

// Import the callVolcengine function from the generate route
// We'll need to extract it to a shared module
// Shared function for image generation
async function callImageGeneration(prompt: string, options: CallOptions = {}) {
  const openRouterKey = process.env.OPENROUTER_API_KEY;

  if (openRouterKey) {
    // OpenRouter Implementation
    const model = process.env.OPENROUTER_IMAGE_MODEL || 'google/gemini-2.0-flash-exp:free';
    const CHAT_ENDPOINT = 'https://openrouter.ai/api/v1/chat/completions';

    // Map size to aspect ratio for Gemini models
    // Default to 1:1 if not specified or unknown
    let aspectRatio = '1:1';
    if (options.size) {
      if (options.size === '1920x1080') aspectRatio = '16:9';
      else if (options.size === '1080x1920') aspectRatio = '9:16';
      else if (options.size === '1280x720') aspectRatio = '16:9'; // Approximate
      else if (options.size === '720x1280') aspectRatio = '9:16'; // Approximate
      else if (options.size === '1024x1024') aspectRatio = '1:1';
      else if (options.size === '2048x2048') aspectRatio = '1:1';
    }

    // Construct body specifically for Gemini image generation on OpenRouter
    const body: any = {
      model,
      messages: [
        {
          role: 'user',
          content: options.baseImageDataUrl
            ? [
              { type: 'text', text: prompt },
              { type: 'image_url', image_url: { url: options.baseImageDataUrl } },
            ]
            : prompt,
        },
      ],
    };

    // Add Gemini-specific parameters if it's a Gemini model
    if (model.includes('gemini')) {
      body.modalities = ['image', 'text'];
      body.image_config = { aspect_ratio: aspectRatio };
    }

    const response = await fetch(CHAT_ENDPOINT, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${openRouterKey}`,
        'Content-Type': 'application/json',
        'HTTP-Referer': 'https://classroomgen.vercel.app',
        'X-Title': 'ClassroomGen',
      },
      body: JSON.stringify(body),
    });

    const result = await response.json();

    if (!response.ok) {
      console.error('OpenRouter image generation error', result);
      const message = result?.error?.message ?? 'OpenRouter request failed';
      throw new Error(message);
    }

    // Attempt to extract image URL from content or specific fields
    const choice = result?.choices?.[0]?.message;
    let imageUrl = null;

    // Check for images array (Gemini/OpenRouter specific structure)
    if (choice?.images && Array.isArray(choice.images) && choice.images.length > 0) {
      const firstImage = choice.images[0];
      if (firstImage?.image_url?.url) {
        imageUrl = firstImage.image_url.url;
      }
    }

    if (!imageUrl && choice?.content) {
      const content = choice.content.trim();
      // Check for markdown image syntax: ![alt](url)
      const match = content.match(/\!\[.*?\]\((.*?)\)/);
      if (match && match[1]) {
        imageUrl = match[1];
      } else {
        // Check if content itself is a URL or data URL
        if (content.startsWith('http') || content.startsWith('data:')) {
          imageUrl = content;
        } else if (content.length > 100) {
          // Assume raw base64 if it's a long string
          // Strip all whitespace (newlines, spaces) just in case
          const base64Data = content.replace(/\s/g, '');
          imageUrl = `data:image/png;base64,${base64Data}`;
        }
      }
    }

    if (!imageUrl) {
      // Fallback: Check if there's an 'image' field in the response (non-standard but possible)
      if (result.image) imageUrl = result.image;
      if (result.data?.[0]?.url) imageUrl = result.data[0].url;
    }

    if (!imageUrl) {
      console.error('OpenRouter response structure:', JSON.stringify(result, null, 2));
      throw new Error('Could not extract image URL from OpenRouter response');
    }

    return fetchImageAsBase64(imageUrl);
  }

  // Volcengine Implementation (Fallback)
  const apiKey = process.env.VOLCENGINE_API_KEY;
  if (!apiKey) {
    throw new Error('Missing API key. Set OPENROUTER_API_KEY or VOLCENGINE_API_KEY in your environment.');
  }

  const IMAGE_ENDPOINT = 'https://ark.cn-beijing.volces.com/api/v3/images/generations';
  const model = process.env.VOLCENGINE_IMAGE_MODEL || 'doubao-seedream-4-5-251128';

  const headers = {
    Authorization: `Bearer ${apiKey}`,
    'Content-Type': 'application/json',
  };

  const body: any = {
    model,
    prompt,
    size: options.size || '2048x2048', // Use provided size or default
  };

  if (options.baseImageDataUrl) {
    // Volcengine uses 'image' parameter for reference image (single image)
    // See: https://www.volcengine.com/docs/82379/1824121
    body.image = options.baseImageDataUrl;
  }

  const response = await fetch(IMAGE_ENDPOINT, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  });

  const result = await response.json();

  if (!response.ok) {
    console.error('Volcengine image error', result);
    const message = result?.error?.message ?? 'Volcengine request failed';
    throw new Error(message);
  }

  const imageUrl = result?.data?.[0]?.url;
  if (!imageUrl) {
    throw new Error('Volcengine did not return an image URL');
  }

  return fetchImageAsBase64(imageUrl);
}

async function fetchImageAsBase64(urlOrDataUrl: string) {
  if (urlOrDataUrl.startsWith('data:')) {
    const [, meta, data] = urlOrDataUrl.match(/^data:([^;,]+)?(?:;base64)?,(.+)$/) ?? [];
    if (!data) {
      throw new Error('Invalid data URL in Volcengine response');
    }
    const mimeType = meta || 'image/png';
    const imageData = urlOrDataUrl.includes(';base64,') ? data : Buffer.from(decodeURIComponent(data)).toString('base64');
    return { imageData, mimeType };
  }

  const response = await fetch(urlOrDataUrl);
  if (!response.ok) {
    throw new Error('Failed to download image from Volcengine response');
  }
  const buffer = Buffer.from(await response.arrayBuffer()).toString('base64');
  const mimeType = response.headers.get('content-type') ?? 'image/png';
  return { imageData: buffer, mimeType };
}



// Singleton instance
const imageQueue = new ImageGenerationQueue();

export function enqueueImageGeneration(submissionId: string, prompt: string, options: CallOptions = {}) {
  imageQueue.enqueue({ submissionId, prompt, options });
}


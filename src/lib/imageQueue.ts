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
      const { imageData, mimeType } = await callVolcengineImageGeneration(job.prompt, job.options);

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
async function callVolcengineImageGeneration(prompt: string, options: CallOptions = {}) {
  const apiKey = process.env.VOLCENGINE_API_KEY;
  if (!apiKey) {
    throw new Error('Missing Volcengine API key. Set VOLCENGINE_API_KEY in your environment.');
  }

  const IMAGE_ENDPOINT = 'https://ark.cn-beijing.volces.com/api/v3/images/generations';
  const model = process.env.VOLCENGINE_IMAGE_MODEL || 'doubao-seedream-4-5-251128';

  const headers = {
    Authorization: `Bearer ${apiKey}`,
    'Content-Type': 'application/json',
  };

  const response = await fetch(IMAGE_ENDPOINT, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      model,
      prompt,
      size: options.size || '2048x2048', // Use provided size or default
    }),
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


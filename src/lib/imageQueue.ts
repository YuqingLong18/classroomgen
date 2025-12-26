/**
 * Background job queue for processing image generation requests concurrently.
 * This allows multiple image generation requests to be processed in parallel
 * instead of blocking sequentially.
 */

import { Buffer } from 'node:buffer';
import { prisma } from '@/lib/prisma';
import { SubmissionStatus, ImageJob } from '@prisma/client';

type CallOptions = {
  baseImageDataUrl?: string; // Legacy support or single image
  referenceImages?: string[]; // New multiple image support
  size?: string;
};



// Configuration for concurrent processing
const MAX_CONCURRENT_JOBS = 20;
const POLL_INTERVAL_MS = 1000;

class ImageGenerationQueue {
  private activeJobs = 0;
  private isRunning = false;
  private loopId = Math.random().toString(36).substring(7);

  constructor() {
    console.log(`[Queue] Initialized new ImageGenerationQueue instance ${this.loopId}`);
  }

  /**
   * Add a job to the queue (persisted in DB)
   */
  async enqueue(
    submissionId: string,
    prompt: string,
    options: CallOptions,
    teacherId?: string
  ) {
    console.log(`[Queue ${this.loopId}] Enqueuing submission ${submissionId}`);
    // Create job record in DB
    await prisma.imageJob.create({
      data: {
        submissionId,
        prompt,
        options: JSON.stringify(options),
        teacherId,
        status: 'PENDING'
      }
    });

    if (!this.isRunning) {
      console.log(`[Queue ${this.loopId}] Queue not running, starting...`);
      this.start();
    }
  }

  start() {
    if (this.isRunning) {
      console.log(`[Queue ${this.loopId}] Already running`);
      return;
    }
    this.isRunning = true;
    this.processQueue();
  }

  private async processQueue() {
    console.log(`[Queue ${this.loopId}] Worker loop started`);
    let noJobCount = 0;

    while (this.isRunning) {
      try {
        if (this.activeJobs < MAX_CONCURRENT_JOBS) {
          const job = await prisma.imageJob.findFirst({
            where: { status: 'PENDING' },
            orderBy: { createdAt: 'asc' },
          });

          if (job) {
            noJobCount = 0;
            // Lock the job
            const updated = await prisma.imageJob.update({
              where: { id: job.id, status: 'PENDING' },
              data: { status: 'PROCESSING', startedAt: new Date() }
            }).catch(() => null);

            if (updated) {
              this.activeJobs++;
              console.log(`[Queue ${this.loopId}] Processing job ${updated.id} for submission ${updated.submissionId}`);
              this.processJob(updated).catch(err => console.error(`[Queue ${this.loopId}] Uncaught error processing job ${updated.id}:`, err));
            }
          } else {
            // No jobs found, wait
            noJobCount++;
            if (noJobCount % 10 === 0) { // Log every 10 polls (~10s)
              // console.log(`[Queue ${this.loopId}] Waiting for jobs... (active: ${this.activeJobs})`);
            }
            await new Promise(resolve => setTimeout(resolve, POLL_INTERVAL_MS));
          }
        } else {
          // console.log(`[Queue ${this.loopId}] Max concurrency reached (${this.activeJobs})`);
          await new Promise(resolve => setTimeout(resolve, POLL_INTERVAL_MS));
        }
      } catch (error) {
        console.error(`[Queue ${this.loopId}] Error in worker loop:`, error);
        await new Promise(resolve => setTimeout(resolve, POLL_INTERVAL_MS));
      }
    }
    console.log(`[Queue ${this.loopId}] Worker loop stopped`);
  }

  private async processJob(jobRecord: ImageJob) {
    try {
      const { submissionId, prompt, options: optionsStr, teacherId } = jobRecord;
      const options = JSON.parse(optionsStr) as CallOptions;

      // Hydrate reference images if they are paths (for external AI APIs)
      if (options.referenceImages && options.referenceImages.length > 0) {
        const fs = await import('fs/promises');
        const path = await import('path');

        const hydratedImages = await Promise.all(options.referenceImages.map(async (img) => {
          if (img.startsWith('/api/uploads/')) {
            try {
              // Fix: Preserve subdirectory structure (e.g. user/session/image.png)
              const relativePath = img.replace('/api/uploads/', '');
              if (relativePath) {
                const filepath = path.join(process.cwd(), 'uploads', relativePath);
                const buffer = await fs.readFile(filepath);
                // Default to png if unknown, most uploads are likely png/jpeg
                return `data:image/png;base64,${buffer.toString('base64')}`;
              }
            } catch (e) {
              console.error(`[Queue ${this.loopId}] Failed to hydrate reference image ${img}`, e);
              return img; // Return original path which will likely fail API validation, but better than crashing
            }
          }
          return img;
        }));
        options.referenceImages = hydratedImages;
      }

      // Get teacher API key if teacherId is provided
      let teacherApiKey: string | null = null;
      if (teacherId) {
        const { getTeacherApiKey } = await import('@/lib/teacherApiKey');
        teacherApiKey = await getTeacherApiKey(teacherId);
      }

      console.log(`[Queue ${this.loopId}] Calling image generation API for job ${jobRecord.id}`);
      const { imageData, mimeType } = await callImageGeneration(prompt, options, teacherApiKey);
      console.log(`[Queue ${this.loopId}] API success for job ${jobRecord.id}`);

      // Fetch metadata for file organization
      const submissionInfo = await prisma.promptSubmission.findUnique({
        where: { id: submissionId },
        select: {
          student: {
            select: {
              session: {
                select: {
                  classroomCode: true,
                  teacher: { select: { username: true } }
                }
              }
            }
          }
        }
      });

      const teacherName = submissionInfo?.student?.session?.teacher?.username || 'unknown';
      const classroomCode = submissionInfo?.student?.session?.classroomCode || 'unknown';
      const subDir = `${teacherName}/${classroomCode}`;

      // Save to disk
      let finalImageData = imageData;
      const { saveImage } = await import('@/lib/storage');
      try {
        const buffer = Buffer.from(imageData, 'base64');
        finalImageData = await saveImage(buffer, mimeType, subDir);
      } catch (err) {
        console.error(`[Queue ${this.loopId}] Failed to save image to disk for ${submissionId}:`, err);
      }

      // Update Submission & Job
      await prisma.$transaction([
        prisma.promptSubmission.update({
          where: { id: submissionId },
          data: {
            status: SubmissionStatus.SUCCESS,
            imageData: finalImageData,
            imageMimeType: mimeType,
          },
        }),
        prisma.imageJob.update({
          where: { id: jobRecord.id },
          data: {
            status: 'COMPLETED',
            completedAt: new Date()
          }
        })
      ]);
      console.log(`[Queue ${this.loopId}] Job ${jobRecord.id} completed successfully`);

    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      console.error(`[Queue ${this.loopId}] Job failed for submission ${jobRecord.submissionId}:`, errorMessage);

      await prisma.$transaction([
        prisma.promptSubmission.update({
          where: { id: jobRecord.submissionId },
          data: {
            status: SubmissionStatus.ERROR,
            errorMessage: errorMessage,
          },
        }),
        prisma.imageJob.update({
          where: { id: jobRecord.id },
          data: {
            status: 'FAILED',
            error: errorMessage,
            completedAt: new Date()
          }
        })
      ]);
    } finally {
      this.activeJobs--;
    }
  }
}

// Global Singleton Pattern for Next.js HMR
const globalForQueue = globalThis as unknown as {
  imageQueue: ImageGenerationQueue | undefined;
};

export const imageQueue = globalForQueue.imageQueue ?? new ImageGenerationQueue();

if (process.env.NODE_ENV !== 'production') {
  globalForQueue.imageQueue = imageQueue;
}

// Ensure the queue is running if it was already instantiated
// This might trigger on HMR re-eval, ensuring the loop restarts if it was stopped (though we don't explicitly stop it)
// Ideally, the old instance stays alive in memory. Using the singleton ensures we use the SAME instance.
// So this line ensures that if we access it, we verify it's running.
imageQueue.start();

// Helper for external API to add jobs
export const enqueueImageGeneration = (
  submissionId: string,
  prompt: string,
  options: CallOptions,
  teacherId?: string
) => {
  return imageQueue.enqueue(submissionId, prompt, options, teacherId);
};

// Helper for creating fetch agent with proxy support
async function getFetchAgent() {
  const { HttpsProxyAgent } = await import('https-proxy-agent');
  const proxy = process.env.HTTPS_PROXY || process.env.HTTP_PROXY || process.env.https_proxy || process.env.http_proxy;
  if (proxy) {
    console.log(`[Queue] Using proxy: ${proxy}`);
    return new HttpsProxyAgent(proxy);
  }
  return undefined;
}

// Import the callVolcengine function from the generate route
// We'll need to extract it to a shared module
// Shared function for image generation
async function callImageGeneration(prompt: string, options: CallOptions = {}, teacherApiKey: string | null = null) {
  const openRouterKey = process.env.OPENROUTER_API_KEY;
  const agent = await getFetchAgent();

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
    const body: Record<string, unknown> = {
      model,
      messages: [
        {
          role: 'user',
          content: (options.referenceImages && options.referenceImages.length > 0)
            ? [
              { type: 'text', text: prompt },
              ...options.referenceImages.map(img => ({ type: 'image_url', image_url: { url: img } }))
            ]
            : (options.baseImageDataUrl
              ? [
                { type: 'text', text: prompt },
                { type: 'image_url', image_url: { url: options.baseImageDataUrl } },
              ]
              : prompt),
        },
      ],
    };

    // Add Gemini-specific parameters if it's a Gemini model
    if (model.includes('gemini')) {
      body.modalities = ['image', 'text'];
      body.image_config = { aspect_ratio: aspectRatio };
    }

    console.log(`[Queue] Sending request to OpenRouter (Model: ${model})...`);
    try {
      const response = await fetch(CHAT_ENDPOINT, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${openRouterKey}`,
          'Content-Type': 'application/json',
          'HTTP-Referer': 'https://classroomgen.vercel.app',
          'X-Title': 'ClassroomGen',
        },
        body: JSON.stringify(body),
        // @ts-expect-error - node-fetch agent support
        agent,
      });

      if (!response.ok) {
        const result = await response.json();
        console.error('OpenRouter image generation error', result);
        const message = result?.error?.message ?? `OpenRouter request failed: ${response.status} ${response.statusText}`;
        throw new Error(message);
      }

      const result = await response.json();

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

      return fetchImageAsBase64(imageUrl, agent);

    } catch (e) {
      console.error('[OpenRouter Fetch Error]', e);
      throw e;
    }
  }

  // Volcengine Implementation (Fallback)
  // Use teacher's API key if provided, otherwise fall back to environment variable
  const apiKey = teacherApiKey || process.env.VOLCENGINE_API_KEY;
  if (!apiKey) {
    throw new Error('Missing API key. Please configure your Volcengine API KEY in the teacher dashboard.');
  }

  const IMAGE_ENDPOINT = 'https://ark.cn-beijing.volces.com/api/v3/images/generations';
  const model = process.env.VOLCENGINE_IMAGE_MODEL || 'doubao-seedream-4-5-251128';

  const headers = {
    Authorization: `Bearer ${apiKey}`,
    'Content-Type': 'application/json',
  };

  const body: Record<string, unknown> = {
    model,
    prompt,
    size: options.size || '2048x2048', // Use provided size or default
  };

  if (options.referenceImages && options.referenceImages.length > 0) {
    // Volcengine uses 'image' parameter which can be a single image or list of images
    // See: https://www.volcengine.com/docs/82379/1541523?lang=zh
    // If multiple images, pass the array directly.
    body.image = options.referenceImages;
  } else if (options.baseImageDataUrl) {
    // Volcengine uses 'image' parameter for reference image (single image)
    body.image = options.baseImageDataUrl;
  }

  console.log(`[Queue] Sending request to Volcengine (Model: ${model})...`);
  try {
    const response = await fetch(IMAGE_ENDPOINT, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
      // @ts-expect-error - node-fetch agent support
      agent,
    });

    if (!response.ok) {
      const result = await response.json();
      console.error('Volcengine image error', result);
      const message = result?.error?.message ?? `Volcengine request failed: ${response.status}`;
      throw new Error(message);
    }

    const result = await response.json();
    const imageUrl = result?.data?.[0]?.url;
    if (!imageUrl) {
      throw new Error('Volcengine did not return an image URL');
    }

    return fetchImageAsBase64(imageUrl, agent);
  } catch (e) {
    console.error('[Volcengine Fetch Error]', e);
    throw e;
  }
}

async function fetchImageAsBase64(urlOrDataUrl: string, agent?: unknown) {
  if (urlOrDataUrl.startsWith('data:')) {
    const [, meta, data] = urlOrDataUrl.match(/^data:([^;,]+)?(?:;base64)?,(.+)$/) ?? [];
    if (!data) {
      throw new Error('Invalid data URL in Volcengine response');
    }
    const mimeType = meta || 'image/png';
    const imageData = urlOrDataUrl.includes(';base64,') ? data : Buffer.from(decodeURIComponent(data)).toString('base64');
    return { imageData, mimeType };
  }

  console.log(`[Queue] Downloading image from ${urlOrDataUrl.substring(0, 50)}...`);
  const response = await fetch(urlOrDataUrl, {
    // @ts-expect-error - node-fetch agent support
    agent
  });
  if (!response.ok) {
    throw new Error('Failed to download image from Volcengine response');
  }
  const buffer = Buffer.from(await response.arrayBuffer()).toString('base64');
  const mimeType = response.headers.get('content-type') ?? 'image/png';
  return { imageData: buffer, mimeType };
}

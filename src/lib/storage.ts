import { mkdir, writeFile } from 'fs/promises';
import path from 'path';
import { randomUUID } from 'crypto';

const UPLOADS_DIR = path.join(process.cwd(), 'uploads');

/**
 * Saves a buffer to the local uploads directory and returns the relative URL path.
 * The URL path corresponds to the API route /api/uploads/[filename].
 * 
 * @param buffer The image buffer to save
 * @param mimeType The mime type of the image (e.g., 'image/png')
 * @returns The relative URL path (e.g., '/api/uploads/uuid.png')
 */
export async function saveImage(buffer: Buffer, mimeType: string): Promise<string> {
    // Ensure uploads directory exists
    await mkdir(UPLOADS_DIR, { recursive: true });

    const ext = mimeType.split('/')[1] || 'png';
    const filename = `${randomUUID()}.${ext}`;
    const filepath = path.join(UPLOADS_DIR, filename);

    await writeFile(filepath, buffer);

    return `/api/uploads/${filename}`;
}

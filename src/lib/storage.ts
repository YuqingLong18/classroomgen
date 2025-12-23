import { mkdir, writeFile } from 'fs/promises';
import path from 'path';
import { randomUUID } from 'crypto';

const UPLOADS_DIR = path.join(process.cwd(), 'uploads');

/**
 * Saves a buffer to the local uploads directory and returns the relative URL path.
 * The URL path corresponds to the API route /api/uploads/[...path].
 * 
 * @param buffer The image buffer to save
 * @param mimeType The mime type of the image (e.g., 'image/png')
 * @param subDir Optional subdirectory path (e.g., 'teacherA/class123')
 * @returns The relative URL path (e.g., '/api/uploads/teacherA/class123/uuid.png')
 */
export async function saveImage(buffer: Buffer, mimeType: string, subDir: string = ''): Promise<string> {
    const targetDir = path.join(UPLOADS_DIR, subDir);

    // Ensure target directory exists
    await mkdir(targetDir, { recursive: true });

    const ext = mimeType.split('/')[1] || 'png';
    const filename = `${randomUUID()}.${ext}`;
    const filepath = path.join(targetDir, filename);

    await writeFile(filepath, buffer);

    // Ensure URL uses forward slashes regardless of OS
    const urlPath = subDir ? `${subDir}/${filename}` : filename;
    return `/api/uploads/${urlPath.split(path.sep).join('/')}`;
}

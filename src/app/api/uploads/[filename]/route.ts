import { NextRequest, NextResponse } from 'next/server';
import { readFile } from 'fs/promises';
import path from 'path';
import { existsSync } from 'fs';

export async function GET(
    request: NextRequest,
    { params }: { params: Promise<{ filename: string }> }
) {
    const { filename } = await params;

    if (!filename || filename.includes('..') || filename.includes('/') || filename.includes('\\')) {
        return new NextResponse('Invalid filename', { status: 400 });
    }

    const filepath = path.join(process.cwd(), 'uploads', filename);

    if (!existsSync(filepath)) {
        return new NextResponse('File not found', { status: 404 });
    }

    try {
        const fileBuffer = await readFile(filepath);
        const ext = path.extname(filename).toLowerCase();
        let contentType = 'application/octet-stream';
        if (ext === '.png') contentType = 'image/png';
        else if (ext === '.jpg' || ext === '.jpeg') contentType = 'image/jpeg';
        else if (ext === '.webp') contentType = 'image/webp';
        else if (ext === '.gif') contentType = 'image/gif';

        return new NextResponse(fileBuffer, {
            headers: {
                'Content-Type': contentType,
                // Cache for 1 year, immutable
                'Cache-Control': 'public, max-age=31536000, immutable',
            },
        });
    } catch (error) {
        console.error('Error serving file:', error);
        return new NextResponse('Internal Server Error', { status: 500 });
    }
}

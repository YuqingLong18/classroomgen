import { NextRequest, NextResponse } from 'next/server';
import { readFile } from 'fs/promises';
import path from 'path';
import { existsSync } from 'fs';

export async function GET(
    request: NextRequest,
    { params }: { params: Promise<{ path: string[] }> }
) {
    const { path: pathSegments } = await params;

    if (!pathSegments || pathSegments.length === 0) {
        return new NextResponse('Invalid path', { status: 400 });
    }

    // Security check for each segment
    if (pathSegments.some(segment => segment.includes('..') || segment.includes('\\'))) {
        return new NextResponse('Invalid path', { status: 400 });
    }

    const filepath = path.join(process.cwd(), 'uploads', ...pathSegments);

    if (!existsSync(filepath)) {
        return new NextResponse('File not found', { status: 404 });
    }

    try {
        const fileBuffer = await readFile(filepath);
        const filename = pathSegments[pathSegments.length - 1];
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

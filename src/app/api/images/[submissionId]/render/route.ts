import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { getSessionFromCookies } from '@/lib/session';

export async function GET(
    request: NextRequest,
    { params }: { params: Promise<{ submissionId: string }> }
) {
    const { submissionId } = await params;

    // Basic session check - images are generally visible to class, but let's be safe
    // We allow caching, so lightweight check or relying on obscure URLs is common, 
    // but here we can enforce session membership.
    const { sessionId } = await getSessionFromCookies();
    if (!sessionId) {
        return new NextResponse('Unauthorized', { status: 401 });
    }

    try {
        const submission = await prisma.promptSubmission.findUnique({
            where: { id: submissionId },
            select: {
                imageData: true,
                imageMimeType: true,
                sessionId: true, // Verify session match
            },
        });

        if (!submission || !submission.imageData) {
            return new NextResponse('Image not found', { status: 404 });
        }

        // Security: Only allow access if user is in same session (or it's the teacher/owner)
        // For simplicity, checking if user has a sessionId is "okay", but strict check is better.
        // If the user's sessionId doesn't match submission.sessionId, block?
        // Let's enforce it.
        if (submission.sessionId !== sessionId) {
            // Check if it's the teacher of that session? 
            // getSessionFromCookies returns keys based on active cookie.
            // If a student tries to access another class's image: block.
            return new NextResponse('Forbidden', { status: 403 });
        }

        // Checking if it is a file path or Base64
        if (submission.imageData.startsWith('/api/uploads/')) {
            // It's a file path. Use a redirect or serve it? 
            // Redirecting is better for caching consistency with direct access.
            return NextResponse.redirect(new URL(submission.imageData, request.url));
        }

        // It is Base64
        const base64Data = submission.imageData;
        const buffer = Buffer.from(base64Data, 'base64');
        const contentType = submission.imageMimeType || 'image/png';

        return new NextResponse(buffer, {
            headers: {
                'Content-Type': contentType,
                'Content-Length': buffer.length.toString(),
                // Cache for 1 year (immutable) - images don't change after generation success
                'Cache-Control': 'public, max-age=31536000, immutable',
            },
        });

    } catch (error) {
        console.error('Error serving legacy image:', error);
        return new NextResponse('Internal Server Error', { status: 500 });
    }
}

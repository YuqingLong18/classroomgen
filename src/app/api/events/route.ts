import { NextRequest } from 'next/server';
import { getSessionFromCookies } from '@/lib/session';

export async function GET(request: NextRequest) {
  const { sessionId } = await getSessionFromCookies();

  if (!sessionId) {
    return new Response('Unauthorized', { status: 401 });
  }

  // Set up SSE headers
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const send = (data: string) => {
        controller.enqueue(encoder.encode(`data: ${data}\n\n`));
      };

      // Send initial connection message
      send(JSON.stringify({ type: 'connected', sessionId }));

      // Poll for updates every 2 seconds
      const interval = setInterval(async () => {
        try {
          // Check for new submissions by querying the database
          // In production, you'd use a pub/sub system or database triggers
          const response = await fetch(`${request.url.split('/api/events')[0]}/api/images`, {
            headers: {
              cookie: request.headers.get('cookie') || '',
            },
          });

          if (response.ok) {
            const data = await response.json();
            send(JSON.stringify({ type: 'update', data }));
          }
        } catch (error) {
          console.error('SSE polling error:', error);
        }
      }, 2000);

      // Clean up on client disconnect
      request.signal.addEventListener('abort', () => {
        clearInterval(interval);
        controller.close();
      });
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no', // Disable nginx buffering
    },
  });
}


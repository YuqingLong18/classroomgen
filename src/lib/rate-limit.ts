import { NextRequest, NextResponse } from 'next/server';

// Simple in-memory rate limiter (for MVP - can be replaced with Redis/Upstash later)
interface RateLimitEntry {
  count: number;
  resetAt: number;
}

const rateLimitStore = new Map<string, RateLimitEntry>();

// Rate limits per endpoint
const RATE_LIMITS = {
  '/api/images/generate': { max: 5, window: 60 * 1000 }, // 5 requests per minute
  '/api/images': { max: 60, window: 60 * 1000 }, // 60 requests per minute
  '/api/session': { max: 30, window: 60 * 1000 }, // 30 requests per minute
  default: { max: 100, window: 60 * 1000 }, // 100 requests per minute
};

function getClientId(request: NextRequest): string {
  // Try to get student ID from cookies first
  const cookies = request.cookies;
  const sessionCookie = cookies.get('session');
  
  // Fallback to IP address
  const forwarded = request.headers.get('x-forwarded-for');
  const ip = forwarded ? forwarded.split(',')[0] : request.headers.get('x-real-ip') || 'unknown';
  
  return sessionCookie?.value || ip;
}

function checkRateLimit(pathname: string, clientId: string): { allowed: boolean; remaining: number; resetAt: number } {
  const limit = RATE_LIMITS[pathname as keyof typeof RATE_LIMITS] || RATE_LIMITS.default;
  const key = `${pathname}:${clientId}`;
  const now = Date.now();
  
  let entry = rateLimitStore.get(key);
  
  if (!entry || entry.resetAt < now) {
    entry = {
      count: 0,
      resetAt: now + limit.window,
    };
  }
  
  entry.count++;
  rateLimitStore.set(key, entry);
  
  // Clean up old entries periodically
  if (Math.random() < 0.01) {
    for (const [k, v] of rateLimitStore.entries()) {
      if (v.resetAt < now) {
        rateLimitStore.delete(k);
      }
    }
  }
  
  const allowed = entry.count <= limit.max;
  const remaining = Math.max(0, limit.max - entry.count);
  
  return {
    allowed,
    remaining,
    resetAt: entry.resetAt,
  };
}

export function rateLimitMiddleware(handler: (req: NextRequest) => Promise<NextResponse>) {
  return async (request: NextRequest): Promise<NextResponse> => {
    const pathname = new URL(request.url).pathname;
    const clientId = getClientId(request);
    
    const { allowed, remaining, resetAt } = checkRateLimit(pathname, clientId);
    
    if (!allowed) {
      return NextResponse.json(
        { message: 'Rate limit exceeded. Please try again later.' },
        {
          status: 429,
          headers: {
            'X-RateLimit-Limit': RATE_LIMITS[pathname as keyof typeof RATE_LIMITS]?.max.toString() || '100',
            'X-RateLimit-Remaining': '0',
            'X-RateLimit-Reset': new Date(resetAt).toISOString(),
            'Retry-After': Math.ceil((resetAt - Date.now()) / 1000).toString(),
          },
        }
      );
    }
    
    const response = await handler(request);
    
    // Add rate limit headers to successful responses
    response.headers.set('X-RateLimit-Limit', RATE_LIMITS[pathname as keyof typeof RATE_LIMITS]?.max.toString() || '100');
    response.headers.set('X-RateLimit-Remaining', remaining.toString());
    response.headers.set('X-RateLimit-Reset', new Date(resetAt).toISOString());
    
    return response;
  };
}


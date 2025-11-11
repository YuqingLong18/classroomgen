import { NextRequest } from 'next/server';

// Simple in-memory cache (for MVP - can be replaced with Redis later)
interface CacheEntry<T> {
  data: T;
  expiresAt: number;
}

const cache = new Map<string, CacheEntry<unknown>>();

export function getCache<T>(key: string): T | null {
  const entry = cache.get(key) as CacheEntry<T> | undefined;
  
  if (!entry) {
    return null;
  }
  
  if (entry.expiresAt < Date.now()) {
    cache.delete(key);
    return null;
  }
  
  return entry.data;
}

export function setCache<T>(key: string, data: T, ttlMs: number): void {
  cache.set(key, {
    data,
    expiresAt: Date.now() + ttlMs,
  });
}

export function deleteCache(key: string): void {
  cache.delete(key);
}

export function clearCache(pattern?: string): void {
  if (!pattern) {
    cache.clear();
    return;
  }
  
  for (const key of cache.keys()) {
    if (key.includes(pattern)) {
      cache.delete(key);
    }
  }
}

// Cache key generators
export function getSessionCacheKey(sessionId: string): string {
  return `session:${sessionId}`;
}

export function getImagesCacheKey(sessionId: string, role: string, studentId?: string, page?: number): string {
  return `images:${sessionId}:${role}:${studentId || 'all'}:${page || 1}`;
}

export function getImageCacheKey(imageId: string): string {
  return `image:${imageId}`;
}

// Clean up expired entries periodically
if (typeof setInterval !== 'undefined') {
  setInterval(() => {
    const now = Date.now();
    for (const [key, entry] of cache.entries()) {
      if (entry.expiresAt < now) {
        cache.delete(key);
      }
    }
  }, 60000); // Clean up every minute
}


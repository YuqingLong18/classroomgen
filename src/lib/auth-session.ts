import 'server-only';

import { createHmac, timingSafeEqual } from 'node:crypto';

export type AuthSession = {
  authMethod?: 'legacy' | 'microsoft' | string;
  role?: 'teacher' | 'student' | string;
  username?: string;
  name?: string;
  email?: string | null;
  exp?: number;
  iat?: number;
  [key: string]: unknown;
};

export const AUTH_COOKIE_NAME = process.env.AUTH_COOKIE_NAME || 'thisnexus_session';
export const AUTH_BASE_URL =
  process.env.AUTH_BASE_URL || process.env.NEXT_PUBLIC_AUTH_BASE_URL || 'https://thisnexus.cn';
export const AUTH_SERVICE_BASE_URL = process.env.AUTH_SERVICE_BASE_URL || AUTH_BASE_URL;
export const IMAGELAB_BASE_URL =
  process.env.IMAGELAB_BASE_URL ||
  process.env.NEXT_PUBLIC_IMAGELAB_BASE_URL ||
  'https://imagelab.thisnexus.cn';

const AUTH_SESSION_SECRET =
  process.env.AUTH_SESSION_SECRET ||
  (process.env.NODE_ENV === 'production' ? '' : 'local-dev-secret-change-me');

function normalizeBase64Url(value: string) {
  return value.replace(/-/g, '+').replace(/_/g, '/');
}

function base64UrlEncode(buffer: Buffer) {
  return buffer
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '');
}

function base64UrlDecode(value: string) {
  const normalized = normalizeBase64Url(value);
  const padding = normalized.length % 4;
  const padded = padding ? normalized + '='.repeat(4 - padding) : normalized;
  return Buffer.from(padded, 'base64').toString('utf8');
}

function signValue(value: string) {
  if (!AUTH_SESSION_SECRET) {
    throw new Error('AUTH_SESSION_SECRET is required');
  }

  return base64UrlEncode(createHmac('sha256', AUTH_SESSION_SECRET).update(value).digest());
}

export async function verifyAuthSession(token?: string | null) {
  if (!token || !token.includes('.')) {
    return null;
  }

  const [encodedPayload, signature] = token.split('.');
  const expectedSignature = signValue(encodedPayload);
  const left = Buffer.from(signature);
  const right = Buffer.from(expectedSignature);

  if (left.length !== right.length || !timingSafeEqual(left, right)) {
    return null;
  }

  try {
    const payload = JSON.parse(base64UrlDecode(encodedPayload)) as AuthSession;

    if (payload.exp && payload.exp * 1000 < Date.now()) {
      return null;
    }

    return payload;
  } catch {
    return null;
  }
}

export function normalizeRedirectPath(value?: string | null) {
  if (!value || typeof value !== 'string' || !value.startsWith('/') || value.startsWith('//')) {
    return '/teacher';
  }

  return value;
}

export function buildTeacherMicrosoftCallbackUrl(path = '/teacher') {
  const url = new URL('/api/teacher/microsoft', IMAGELAB_BASE_URL);
  url.searchParams.set('redirect', normalizeRedirectPath(path));
  return url.toString();
}

export function buildTeacherMicrosoftLoginUrl(path = '/teacher') {
  const url = new URL('/api/auth/microsoft', AUTH_SERVICE_BASE_URL);
  url.searchParams.set('returnTo', buildTeacherMicrosoftCallbackUrl(path));
  return url.toString();
}

export function isTeacherAuthSession(session?: AuthSession | null) {
  return Boolean(session) && session?.role !== 'student';
}

export function normalizeEmail(value?: string | null) {
  return String(value ?? '').trim().toLowerCase();
}

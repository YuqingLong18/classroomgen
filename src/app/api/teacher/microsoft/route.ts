import { cookies } from 'next/headers';
import { NextRequest, NextResponse } from 'next/server';

import {
  AUTH_COOKIE_NAME,
  IMAGELAB_BASE_URL,
  buildTeacherMicrosoftLoginUrl,
  isTeacherAuthSession,
  normalizeRedirectPath,
  verifyAuthSession,
} from '@/lib/auth-session';
import {
  applyTeacherSessionCookies,
  createOrResumeTeacherClassroom,
  findOrCreateTeacherFromMicrosoft,
} from '@/lib/teacher-session';

export async function GET(request: NextRequest) {
  const redirectPath = normalizeRedirectPath(request.nextUrl.searchParams.get('redirect') ?? '/teacher');
  const cookieStore = await cookies();
  const sessionToken = cookieStore.get(AUTH_COOKIE_NAME)?.value;
  const sharedSession = await verifyAuthSession(sessionToken);

  if (!sharedSession) {
    return NextResponse.redirect(new URL(buildTeacherMicrosoftLoginUrl(redirectPath)));
  }

  if (!isTeacherAuthSession(sharedSession)) {
    return NextResponse.redirect(new URL(`/teacher?error=teacher_only`, IMAGELAB_BASE_URL));
  }

  if (!sharedSession.email) {
    return NextResponse.redirect(new URL(`/teacher?error=missing_email`, IMAGELAB_BASE_URL));
  }

  try {
    const teacher = await findOrCreateTeacherFromMicrosoft(sharedSession);
    const session = await createOrResumeTeacherClassroom(teacher.id);
    const response = NextResponse.redirect(new URL(redirectPath, IMAGELAB_BASE_URL));

    applyTeacherSessionCookies(response, session.id);
    return response;
  } catch (error) {
    console.error('Microsoft teacher login failed', error);
    return NextResponse.redirect(new URL(`/teacher?error=login_failed`, IMAGELAB_BASE_URL));
  }
}

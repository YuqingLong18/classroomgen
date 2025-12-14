import bcrypt from 'bcryptjs';
import crypto from 'crypto';

const SESSION_COOKIE = 'classroom_session_id';
const ROLE_COOKIE = 'classroom_role';
const STUDENT_COOKIE = 'classroom_student_id';
const TEACHER_SESSION_COOKIE = 'classroom_teacher_session_id';

export type UserRole = 'student' | 'teacher';

export const sessionCookieName = SESSION_COOKIE;
export const roleCookieName = ROLE_COOKIE;
export const studentCookieName = STUDENT_COOKIE;
export const teacherSessionCookieName = TEACHER_SESSION_COOKIE;

export async function hashPassword(password: string) {
  const salt = await bcrypt.genSalt(10);
  return bcrypt.hash(password, salt);
}

export function verifyPassword(password: string, hash: string) {
  return bcrypt.compare(password, hash);
}

export function generateToken(prefix: string) {
  return `${prefix}_${crypto.randomBytes(24).toString('hex')}`;
}

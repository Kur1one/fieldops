import 'server-only';
import { createHash, randomBytes } from 'node:crypto';
import { and, eq, gt, lt } from 'drizzle-orm';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { cache } from 'react';
import { db, schema } from '@/lib/db';
import type { Role } from '@/lib/shared/constants';

export const SESSION_COOKIE = 'fo_session';
const SESSION_DAYS = 60;

export type CurrentUser = {
  id: number;
  email: string;
  fullName: string;
  role: Role;
  phone: string;
};

function hashToken(token: string) {
  return createHash('sha256').update(token).digest('hex');
}

export function isSecureCookie() {
  return (process.env.APP_URL ?? '').startsWith('https://');
}

export async function createSession(employeeId: number) {
  const token = randomBytes(32).toString('base64url');
  const expiresAt = new Date(Date.now() + SESSION_DAYS * 864e5);
  await db.insert(schema.sessions).values({ id: hashToken(token), employeeId, expiresAt });
  // заодно чистим протухшие сессии
  await db.delete(schema.sessions).where(lt(schema.sessions.expiresAt, new Date()));
  const jar = await cookies();
  jar.set(SESSION_COOKIE, token, {
    httpOnly: true, secure: isSecureCookie(), sameSite: 'lax', path: '/', expires: expiresAt,
  });
}

export async function destroySession() {
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value;
  if (token) await db.delete(schema.sessions).where(eq(schema.sessions.id, hashToken(token)));
  jar.delete(SESSION_COOKIE);
}

// Текущий пользователь по cookie. Неактивный сотрудник считается вышедшим.
export const getCurrentUser = cache(async (): Promise<CurrentUser | null> => {
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value;
  if (!token) return null;
  const rows = await db
    .select({
      id: schema.employees.id,
      email: schema.employees.email,
      fullName: schema.employees.fullName,
      role: schema.employees.role,
      phone: schema.employees.phone,
    })
    .from(schema.sessions)
    .innerJoin(schema.employees, eq(schema.employees.id, schema.sessions.employeeId))
    .where(and(
      eq(schema.sessions.id, hashToken(token)),
      gt(schema.sessions.expiresAt, new Date()),
      eq(schema.employees.active, true),
    ))
    .limit(1);
  return rows[0] ?? null;
});

// Для страниц: без входа — на /login, без нужной роли — на главную.
export async function requireUser(roles?: Role[]): Promise<CurrentUser> {
  const user = await getCurrentUser();
  if (!user) redirect('/login');
  if (roles && !roles.includes(user.role)) redirect('/');
  return user;
}

export const can = {
  createTicket: (u: CurrentUser) => u.role === 'dispatcher' || u.role === 'manager',
  manageTickets: (u: CurrentUser) => u.role === 'dispatcher' || u.role === 'manager',
  seeAllTickets: (u: CurrentUser) => u.role === 'dispatcher' || u.role === 'manager',
  export: (u: CurrentUser) => u.role === 'dispatcher' || u.role === 'manager',
  commentReport: (u: CurrentUser) => u.role === 'manager',
  editCitiesObjects: (u: CurrentUser) => u.role === 'dispatcher' || u.role === 'manager',
  editAllDicts: (u: CurrentUser) => u.role === 'manager',
};

export function allowedEmail(email: string): boolean {
  const domains = (process.env.ALLOWED_EMAIL_DOMAINS ?? '')
    .split(',').map(s => s.trim().toLowerCase()).filter(Boolean);
  if (!domains.length) return true;
  const d = email.split('@')[1]?.toLowerCase() ?? '';
  return domains.includes(d);
}

export async function findActiveEmployeeByEmail(email: string) {
  const rows = await db.select().from(schema.employees)
    .where(eq(schema.employees.email, email.trim().toLowerCase())).limit(1);
  return rows[0] ?? null;
}

export function devLoginEnabled() {
  return process.env.DEV_LOGIN === 'true' && process.env.NODE_ENV !== 'production';
}

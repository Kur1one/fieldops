import { NextResponse, type NextRequest } from 'next/server';
import { createSession, devLoginEnabled, findActiveEmployeeByEmail } from '@/lib/server/auth';

// Вход без OAuth — только для локальной разработки (DEV_LOGIN=true, не production).
export async function POST(req: NextRequest) {
  if (!devLoginEnabled()) return NextResponse.json({ error: 'Отключено' }, { status: 404 });
  const form = await req.formData();
  const email = String(form.get('email') ?? '');
  const emp = await findActiveEmployeeByEmail(email);
  const base = process.env.APP_URL || req.nextUrl.origin;
  if (!emp || !emp.active) return NextResponse.redirect(new URL(`/no-access?email=${encodeURIComponent(email)}`, base), 303);
  await createSession(emp.id);
  return NextResponse.redirect(new URL('/', base), 303);
}

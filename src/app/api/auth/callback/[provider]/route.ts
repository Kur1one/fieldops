import { cookies } from 'next/headers';
import { NextResponse, type NextRequest } from 'next/server';
import { allowedEmail, createSession, findActiveEmployeeByEmail } from '@/lib/server/auth';
import { emailFromCode, isProvider } from '@/lib/server/oauth';

function to(req: NextRequest, path: string) {
  const base = process.env.APP_URL || req.nextUrl.origin;
  return NextResponse.redirect(new URL(path, base));
}

export async function GET(req: NextRequest, ctx: { params: Promise<{ provider: string }> }) {
  const { provider } = await ctx.params;
  if (!isProvider(provider)) return to(req, '/login?error=provider');
  const jar = await cookies();
  const state = req.nextUrl.searchParams.get('state');
  const code = req.nextUrl.searchParams.get('code');
  const savedState = jar.get('oauth_state')?.value;
  const verifier = jar.get('oauth_verifier')?.value ?? '';
  jar.delete('oauth_state');
  jar.delete('oauth_verifier');
  if (!code || !state || state !== savedState) return to(req, '/login?error=state');

  let email: string;
  try {
    email = await emailFromCode(provider, code, verifier);
  } catch (e) {
    console.error('OAuth', e);
    return to(req, '/login?error=oauth');
  }
  const emp = allowedEmail(email) ? await findActiveEmployeeByEmail(email) : null;
  if (!emp || !emp.active) return to(req, `/no-access?email=${encodeURIComponent(email)}${emp ? '&inactive=1' : ''}`);
  await createSession(emp.id);
  return to(req, '/');
}

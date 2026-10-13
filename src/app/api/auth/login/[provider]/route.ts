import { cookies } from 'next/headers';
import { NextResponse, type NextRequest } from 'next/server';
import { isSecureCookie } from '@/lib/server/auth';
import { authorizationUrl, isProvider } from '@/lib/server/oauth';

export async function GET(_req: NextRequest, ctx: { params: Promise<{ provider: string }> }) {
  const { provider } = await ctx.params;
  if (!isProvider(provider)) return NextResponse.json({ error: 'Способ входа не настроен' }, { status: 404 });
  const { url, state, verifier } = authorizationUrl(provider);
  const jar = await cookies();
  const opts = { httpOnly: true, secure: isSecureCookie(), sameSite: 'lax' as const, path: '/', maxAge: 600 };
  jar.set('oauth_state', state, opts);
  jar.set('oauth_verifier', verifier, opts);
  return NextResponse.redirect(url);
}

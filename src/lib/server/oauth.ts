import 'server-only';
import { decodeIdToken, generateCodeVerifier, generateState, Google, Yandex } from 'arctic';

export type ProviderId = 'google' | 'yandex';

function appUrl() {
  return (process.env.APP_URL || 'http://localhost:3000').replace(/\/$/, '');
}

export function enabledProviders(): ProviderId[] {
  const out: ProviderId[] = [];
  if (process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET) out.push('google');
  if (process.env.YANDEX_CLIENT_ID && process.env.YANDEX_CLIENT_SECRET) out.push('yandex');
  return out;
}

export const PROVIDER_LABEL: Record<ProviderId, string> = {
  google: 'Войти через Google',
  yandex: 'Войти через Яндекс ID',
};

export function isProvider(p: string): p is ProviderId {
  return (enabledProviders() as string[]).includes(p);
}

const redirect = (p: ProviderId) => `${appUrl()}/api/auth/callback/${p}`;

export function authorizationUrl(p: ProviderId): { url: URL; state: string; verifier: string } {
  const state = generateState();
  const verifier = generateCodeVerifier();
  if (p === 'google') {
    const g = new Google(process.env.GOOGLE_CLIENT_ID!, process.env.GOOGLE_CLIENT_SECRET!, redirect(p));
    const url = g.createAuthorizationURL(state, verifier, ['openid', 'email', 'profile']);
    url.searchParams.set('prompt', 'select_account');
    const hd = (process.env.ALLOWED_EMAIL_DOMAINS ?? '').split(',').map(s => s.trim()).filter(Boolean);
    if (hd.length === 1) url.searchParams.set('hd', hd[0]);
    return { url, state, verifier };
  }
  const y = new Yandex(process.env.YANDEX_CLIENT_ID!, process.env.YANDEX_CLIENT_SECRET!, redirect(p));
  const url = y.createAuthorizationURL(state, ['login:email', 'login:info']);
  url.searchParams.set('force_confirm', 'yes');
  return { url, state, verifier };
}

// Подтверждённая почта пользователя у провайдера.
export async function emailFromCode(p: ProviderId, code: string, verifier: string): Promise<string> {
  if (p === 'google') {
    const g = new Google(process.env.GOOGLE_CLIENT_ID!, process.env.GOOGLE_CLIENT_SECRET!, redirect(p));
    const tokens = await g.validateAuthorizationCode(code, verifier);
    const claims = decodeIdToken(tokens.idToken()) as { email?: string; email_verified?: boolean };
    if (!claims.email || claims.email_verified === false) throw new Error('Google не подтвердил почту');
    return claims.email.toLowerCase();
  }
  const y = new Yandex(process.env.YANDEX_CLIENT_ID!, process.env.YANDEX_CLIENT_SECRET!, redirect(p));
  const tokens = await y.validateAuthorizationCode(code);
  const res = await fetch('https://login.yandex.ru/info?format=json', {
    headers: { Authorization: `OAuth ${tokens.accessToken()}` },
  });
  if (!res.ok) throw new Error('Яндекс не вернул данные пользователя');
  const info = (await res.json()) as { default_email?: string; emails?: string[] };
  const email = info.default_email || info.emails?.[0];
  if (!email) throw new Error('Яндекс не вернул почту');
  return email.toLowerCase();
}

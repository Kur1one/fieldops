import 'server-only';
import { NextResponse, type NextRequest } from 'next/server';
import { ZodError } from 'zod';
import type { Role } from '@/lib/shared/constants';
import { getCurrentUser, type CurrentUser } from './auth';

export class HttpError extends Error {
  constructor(public status: number, message: string, public extra?: Record<string, unknown>) {
    super(message);
  }
}

export const forbidden = (msg = 'Недостаточно прав') => new HttpError(403, msg);
export const notFound = (msg = 'Не найдено') => new HttpError(404, msg);
export const badRequest = (msg: string, extra?: Record<string, unknown>) => new HttpError(400, msg, extra);
export const conflict = (msg: string, extra?: Record<string, unknown>) => new HttpError(409, msg, extra);

// Защита от CSRF: изменяющие запросы принимаются только со своего origin.
function checkOrigin(req: NextRequest) {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return;
  const origin = req.headers.get('origin');
  if (!origin) return; // не браузер (curl/интеграции) — cookie туда не попадёт без явной передачи
  const allowed = new URL(process.env.APP_URL || req.nextUrl.origin).origin;
  if (origin !== allowed && origin !== req.nextUrl.origin) throw new HttpError(403, 'Запрос с чужого сайта');
}

type Ctx<P> = { params: Promise<P> };
type Handler<P> = (req: NextRequest, user: CurrentUser, params: P) => Promise<Response | unknown>;

// Обёртка для API: вход, роль, единый формат ошибок.
export function api<P = Record<string, string>>(roles: Role[] | null, handler: Handler<P>) {
  return async (req: NextRequest, ctx: Ctx<P>) => {
    try {
      checkOrigin(req);
      const user = await getCurrentUser();
      if (!user) throw new HttpError(401, 'Нужно войти в систему');
      if (roles && !roles.includes(user.role)) throw forbidden();
      const params = ctx?.params ? await ctx.params : ({} as P);
      const res = await handler(req, user, params);
      if (res instanceof Response) return res;
      return NextResponse.json(res ?? { ok: true });
    } catch (e) {
      return errorResponse(e);
    }
  };
}

export function errorResponse(e: unknown) {
  if (e instanceof HttpError) {
    return NextResponse.json({ error: e.message, ...e.extra }, { status: e.status });
  }
  if (e instanceof ZodError) {
    const first = e.issues[0];
    return NextResponse.json(
      { error: first ? `${first.path.join('.') || 'данные'}: ${first.message}` : 'Неверные данные', issues: e.issues },
      { status: 400 },
    );
  }
  console.error(e);
  return NextResponse.json({ error: 'Внутренняя ошибка сервера' }, { status: 500 });
}

export async function readJson(req: NextRequest): Promise<unknown> {
  try {
    return await req.json();
  } catch {
    throw badRequest('Ожидался JSON');
  }
}

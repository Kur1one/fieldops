import { asc, eq } from 'drizzle-orm';
import { redirect } from 'next/navigation';
import { db, schema } from '@/lib/db';
import { devLoginEnabled, getCurrentUser } from '@/lib/server/auth';
import { enabledProviders, PROVIDER_LABEL } from '@/lib/server/oauth';
import { ROLE_LABEL } from '@/lib/shared/constants';

export const metadata = { title: 'Вход' };

const ERRORS: Record<string, string> = {
  state: 'Сеанс входа устарел — попробуйте ещё раз.',
  oauth: 'Не удалось подтвердить вход у провайдера — попробуйте ещё раз.',
  provider: 'Этот способ входа не настроен.',
};

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  if (await getCurrentUser()) redirect('/');
  const { error } = await searchParams;
  const providers = enabledProviders();
  const dev = devLoginEnabled();
  const devUsers = dev
    ? await db.select().from(schema.employees).where(eq(schema.employees.active, true)).orderBy(asc(schema.employees.fullName))
    : [];

  return (
    <main className="mx-auto flex min-h-dvh max-w-sm flex-col justify-center p-4">
      <div className="card">
        <h1 className="mb-1 text-xl font-bold">Заявки и отчёты о выездах</h1>
        <p className="mb-5 text-sm text-slate-500">Вход по корпоративной почте</p>
        {error && <p className="mb-4 rounded-lg bg-red-50 p-3 text-sm text-red-700">{ERRORS[error] ?? 'Ошибка входа'}</p>}
        <div className="flex flex-col gap-2">
          {providers.map(p => (
            <a key={p} href={`/api/auth/login/${p}`} className="btn-primary btn-big">{PROVIDER_LABEL[p]}</a>
          ))}
          {!providers.length && !dev && (
            <p className="text-sm text-red-700">Вход не настроен: задайте GOOGLE_CLIENT_ID/SECRET или YANDEX_CLIENT_ID/SECRET.</p>
          )}
        </div>
        {dev && (
          <form action="/api/auth/dev" method="post" className="mt-6 border-t border-slate-200 pt-4">
            <p className="mb-2 text-xs font-semibold tracking-wide text-amber-700 uppercase">Режим разработки</p>
            <select name="email" className="input" defaultValue={devUsers[0]?.email}>
              {devUsers.map(u => <option key={u.id} value={u.email}>{u.fullName} — {ROLE_LABEL[u.role]}</option>)}
            </select>
            <button className="btn-secondary mt-2 w-full">Войти как сотрудник</button>
          </form>
        )}
      </div>
    </main>
  );
}

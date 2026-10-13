import Link from 'next/link';
import { requireUser, can } from '@/lib/server/auth';
import { ROLE_LABEL } from '@/lib/shared/constants';
import { NavLinks } from './NavLinks';

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUser();
  const links = [
    { href: '/tickets', label: 'Заявки' },
    ...(can.createTicket(user) ? [{ href: '/tickets/new', label: 'Новая заявка' }] : []),
    { href: '/report', label: 'Отчёт' },
    ...(can.editCitiesObjects(user) ? [{ href: '/admin', label: 'Справочники' }] : []),
  ];
  return (
    <>
      <header className="sticky top-0 z-30 border-b border-slate-200 bg-white/95 backdrop-blur">
        <div className="mx-auto flex max-w-7xl items-center gap-2 px-3 py-2">
          <Link href="/" className="mr-2 shrink-0 font-bold text-brand">Выезды</Link>
          <NavLinks links={links} />
          <div className="ml-auto flex items-center gap-2 text-sm">
            <span className="hidden text-right leading-tight text-slate-600 md:block">
              {user.fullName}<br /><span className="text-xs text-slate-400">{ROLE_LABEL[user.role]}</span>
            </span>
            <form action="/api/auth/logout" method="post">
              <button className="btn-ghost px-2 py-1.5 text-sm" title={user.email}>Выйти</button>
            </form>
          </div>
        </div>
      </header>
      {children}
    </>
  );
}

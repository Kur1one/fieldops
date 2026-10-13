import { asc, eq } from 'drizzle-orm';
import Link from 'next/link';
import { db, schema } from '@/lib/db';
import { can, requireUser } from '@/lib/server/auth';
import { listTickets, PAGE_SIZE, parseFilters, statusCounts } from '@/lib/server/queries';
import { getTz } from '@/lib/server/tz';
import { OPEN_STATUSES, STATUS_LABEL, TICKET_STATUSES } from '@/lib/shared/constants';
import { fmtDate, fmtDateTime, todayIso } from '@/lib/shared/format';
import { PriorityBadge, StatusBadge } from '@/components/badges';
import { FilterBar } from './FilterBar';

export const metadata = { title: 'Заявки' };

export default async function TicketsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const user = await requireUser();
  const tz = await getTz();
  const raw = await searchParams;
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(raw)) if (typeof v === 'string') sp.set(k, v);
  const f = parseFilters(sp);

  const [{ rows, total }, counts, cityRows, objectRows, empRows, prioRows] = await Promise.all([
    listTickets(user, f, tz),
    statusCounts(user, f, tz),
    db.select({ id: schema.cities.id, name: schema.cities.name }).from(schema.cities).orderBy(asc(schema.cities.name)),
    db.select({ id: schema.objects.id, name: schema.objects.name }).from(schema.objects).where(eq(schema.objects.active, true)).orderBy(asc(schema.objects.name)),
    can.seeAllTickets(user)
      ? db.select({ id: schema.employees.id, name: schema.employees.fullName }).from(schema.employees).orderBy(asc(schema.employees.fullName))
      : Promise.resolve([]),
    db.select({ id: schema.priorities.id, name: schema.priorities.name }).from(schema.priorities).orderBy(asc(schema.priorities.rank)),
  ]);
  const today = todayIso(tz);
  const overdue = (r: (typeof rows)[number]) => !!r.plannedDate && r.plannedDate < today && OPEN_STATUSES.includes(r.status);

  const withParam = (patch: Record<string, string | null>) => {
    const p = new URLSearchParams(sp);
    for (const [k, v] of Object.entries(patch)) { if (v == null || v === '') p.delete(k); else p.set(k, v); }
    p.delete('page');
    return '/tickets?' + p.toString();
  };
  const sortLink = (key: string) => {
    const cur = f.sort === key ? (f.dir ?? 'asc') : null;
    return withParam({ sort: key, dir: cur === 'asc' ? 'desc' : 'asc' });
  };
  const th = (k: string, label: string, className = '') => (
    <Th key={k} href={sortLink(k)} mark={f.sort === k ? (f.dir === 'desc' ? ' ↓' : ' ↑') : ''} className={className}>{label}</Th>
  );
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const exportHref = '/api/tickets/export?' + sp.toString();

  return (
    <main className="mx-auto max-w-7xl px-3 pt-3 pb-10">
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <h1 className="mx-1 text-[22px] font-bold">Заявки</h1>
        <div className="ml-auto flex gap-2">
          {can.export(user) && <a href={exportHref} className="btn-secondary py-2 text-sm">Выгрузить в Excel</a>}
          {can.createTicket(user) && <Link href="/tickets/new" className="btn-primary py-2 text-sm">+ Новая заявка</Link>}
          {user.role === 'field' && <Link href="/report" className="btn-primary py-2 text-sm">+ Отчёт</Link>}
        </div>
      </div>

      {/* счётчики по статусам с учётом остальных фильтров */}
      <div className="mb-3 flex flex-wrap gap-1.5">
        {TICKET_STATUSES.map(s => {
          const active = f.statuses.length === 1 && f.statuses[0] === s;
          return (
            <Link key={s} href={withParam({ status: active ? null : s })}
              className={`rounded-lg px-2.5 py-1.5 text-sm ring-1 ${active ? 'bg-brand text-white ring-brand' : f.statuses.includes(s) ? 'bg-white ring-slate-300' : 'bg-slate-50 text-slate-400 ring-slate-200'}`}>
              {STATUS_LABEL[s]} <b>{counts[s]}</b>
            </Link>
          );
        })}
      </div>

      <FilterBar
        cities={cityRows} objects={objectRows} employees={empRows} priorities={prioRows}
        showAssignee={can.seeAllTickets(user)}
      />

      <p className="mx-1 my-2 text-sm text-slate-500">Найдено: {total}</p>

      {/* компьютер — таблица */}
      <div className="hidden overflow-x-auto rounded-xl bg-white shadow-sm ring-1 ring-slate-200 md:block">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-slate-600">
            <tr>
              {th('number', '№')}{th('created', 'Создана')}{th('city', 'Город')}{th('object', 'Объект')}
              <th className="px-2 py-2 text-left font-medium">Задача</th>
              {th('priority', 'Приоритет')}{th('assignee', 'Исполнитель')}{th('planned', 'План')}
              {th('status', 'Статус')}{th('lastVisit', 'Посл. выезд')}{th('reports', 'Отч.', 'text-right')}
            </tr>
          </thead>
          <tbody>
            {rows.map(r => (
              <tr key={r.id} className={`border-t border-slate-100 hover:bg-brand-50/50 ${overdue(r) ? 'bg-red-50' : ''}`}>
                <td className="px-2 py-2 font-semibold whitespace-nowrap"><Link className="link" href={`/tickets/${r.number}`}>{r.number}</Link></td>
                <td className="px-2 py-2 whitespace-nowrap">{fmtDateTime(r.createdAt, tz)}</td>
                <td className="px-2 py-2">{r.cityName}</td>
                <td className="px-2 py-2">{r.objectName}{r.isUnplanned && <span className="chip ml-1 bg-violet-100 text-violet-800">внеплановый</span>}</td>
                <td className="max-w-xs truncate px-2 py-2 text-slate-600" title={r.description}>{r.description}</td>
                <td className="px-2 py-2"><PriorityBadge name={r.priorityName} rank={r.priorityRank} /></td>
                <td className="px-2 py-2">{r.assigneeName ?? <span className="text-slate-400">—</span>}</td>
                <td className={`px-2 py-2 whitespace-nowrap ${overdue(r) ? 'font-semibold text-red-700' : ''}`}>{fmtDate(r.plannedDate)}{overdue(r) && ' ⚠'}</td>
                <td className="px-2 py-2"><StatusBadge status={r.status} /></td>
                <td className="px-2 py-2 whitespace-nowrap">{fmtDateTime(r.lastVisitAt, tz)}</td>
                <td className="px-2 py-2 text-right">{r.reportCount}</td>
              </tr>
            ))}
            {!rows.length && <tr><td colSpan={11} className="p-6 text-center text-slate-500">Заявок не найдено</td></tr>}
          </tbody>
        </table>
      </div>

      {/* телефон — карточки */}
      <div className="space-y-2 md:hidden">
        {rows.map(r => (
          <Link key={r.id} href={`/tickets/${r.number}`} className={`card block p-3 ${overdue(r) ? 'ring-red-300' : ''}`}>
            <div className="flex items-center gap-2">
              <b>{r.number}</b>
              <StatusBadge status={r.status} />
              {r.priorityRank <= 2 && <PriorityBadge name={r.priorityName} rank={r.priorityRank} />}
            </div>
            <div className="mt-1 text-[15px]">{r.objectName}</div>
            <div className="text-sm text-slate-500">
              {r.plannedDate ? <span className={overdue(r) ? 'font-semibold text-red-700' : ''}>План: {fmtDate(r.plannedDate)}{overdue(r) && ' — просрочена'}</span> : 'Без плановой даты'}
              {r.assigneeName && ` · ${r.assigneeName}`}
            </div>
          </Link>
        ))}
        {!rows.length && <div className="card text-center text-slate-500">Заявок не найдено</div>}
      </div>

      {pages > 1 && (
        <div className="mt-4 flex items-center justify-center gap-2 text-sm">
          {(f.page ?? 1) > 1 && <Link className="btn-ghost" href={withParam({}) + `&page=${(f.page ?? 1) - 1}`}>← Назад</Link>}
          <span>Страница {f.page ?? 1} из {pages}</span>
          {(f.page ?? 1) < pages && <Link className="btn-ghost" href={withParam({}) + `&page=${(f.page ?? 1) + 1}`}>Вперёд →</Link>}
        </div>
      )}
    </main>
  );
}

function Th({ href, mark, className, children }: { href: string; mark: string; className: string; children: React.ReactNode }) {
  return (
    <th className={`px-2 py-2 text-left font-medium whitespace-nowrap ${className}`}>
      <Link href={href} className="hover:text-brand">{children}{mark}</Link>
    </th>
  );
}

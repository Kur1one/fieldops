import { and, desc, eq, inArray } from 'drizzle-orm';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { db, schema } from '@/lib/db';
import { can, requireUser } from '@/lib/server/auth';
import { getTz } from '@/lib/server/tz';
import { visibleTicketsWhere } from '@/lib/server/tickets';
import { OPEN_STATUSES } from '@/lib/shared/constants';
import { fmtDateTime } from '@/lib/shared/format';
import { StatusBadge } from '@/components/badges';
import { ObjectEdit } from './ObjectEdit';

export const metadata = { title: 'Объект' };

const KIND_TEXT: Record<string, string> = {
  install: 'установлено', configure: 'настроено', replace: 'замена', dismantle: 'демонтировано', check: 'проверено', other: 'упомянуто в отчёте',
};

export default async function ObjectPage({ params, searchParams }: {
  params: Promise<{ id: string }>; searchParams: Promise<{ ip?: string; removed?: string }>;
}) {
  const user = await requireUser();
  const tz = await getTz();
  const { id } = await params;
  const { ip: ipFilter, removed } = await searchParams;
  if (!/^\d+$/.test(id)) notFound();
  const objectId = Number(id);
  const [obj] = await db.select({ o: schema.objects, cityName: schema.cities.name }).from(schema.objects)
    .leftJoin(schema.cities, eq(schema.cities.id, schema.objects.cityId)).where(eq(schema.objects.id, objectId));
  if (!obj) notFound();

  const devices = await db.select().from(schema.objectDevices)
    .where(and(eq(schema.objectDevices.objectId, objectId), removed ? undefined : eq(schema.objectDevices.active, true)))
    .orderBy(desc(schema.objectDevices.active), schema.objectDevices.ip);

  const events = await db.select({
    e: schema.deviceEvents, employee: schema.employees.fullName, ticket: schema.tickets.number,
  }).from(schema.deviceEvents)
    .innerJoin(schema.employees, eq(schema.employees.id, schema.deviceEvents.employeeId))
    .innerJoin(schema.tickets, eq(schema.tickets.id, schema.deviceEvents.ticketId))
    .where(and(eq(schema.deviceEvents.objectId, objectId), ipFilter ? eq(schema.deviceEvents.ip, ipFilter) : undefined))
    .orderBy(desc(schema.deviceEvents.at), desc(schema.deviceEvents.id))
    .limit(300);

  const tickets = await db.select({ number: schema.tickets.number, status: schema.tickets.status, description: schema.tickets.description, createdAt: schema.tickets.createdAt })
    .from(schema.tickets)
    .where(and(eq(schema.tickets.objectId, objectId), visibleTicketsWhere(user)))
    .orderBy(desc(schema.tickets.createdAt)).limit(50);
  const openCount = tickets.filter(t => OPEN_STATUSES.includes(t.status)).length;
  const cities = can.editCitiesObjects(user)
    ? await db.select({ id: schema.cities.id, name: schema.cities.name }).from(schema.cities).where(inArray(schema.cities.active, [true])).orderBy(schema.cities.name)
    : [];

  return (
    <main className="mx-auto max-w-5xl space-y-3 px-3 pt-3 pb-12">
      <section className="card">
        <h1 className="text-xl font-bold">{obj.o.name}</h1>
        <p className="text-slate-600">{obj.cityName ?? 'Город не указан'} · {obj.o.address || 'адрес не заполнен'}</p>
        {obj.o.lat != null && <p className="text-sm text-slate-500">Координаты: {obj.o.lat}, {obj.o.lng}</p>}
        {!obj.o.active && <p className="mt-1 text-sm text-red-700">Объект неактивен</p>}
        {can.editCitiesObjects(user) && (
          <ObjectEdit object={{ id: obj.o.id, name: obj.o.name, cityId: obj.o.cityId, address: obj.o.address, lat: obj.o.lat, lng: obj.o.lng, active: obj.o.active }} cities={cities} />
        )}
      </section>

      <section className="card">
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <h2 className="text-[17px] font-semibold">Устройства на объекте ({devices.filter(d => d.active).length})</h2>
          <Link className="link ml-auto text-sm" href={removed ? `/objects/${id}` : `/objects/${id}?removed=1`}>
            {removed ? 'Только текущие' : 'Показать и снятые'}
          </Link>
        </div>
        {!devices.length && <p className="text-slate-500">Реестр пуст — он заполняется из отчётов о выездах.</p>}
        {devices.length > 0 && (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-left text-slate-600">
                <tr><th className="px-2 py-1.5">IP</th><th className="px-2 py-1.5">Тип</th><th className="px-2 py-1.5">Модель</th><th className="px-2 py-1.5">MAC</th><th className="px-2 py-1.5">Серийный №</th><th className="px-2 py-1.5">Место</th><th className="px-2 py-1.5">Обновлено</th></tr>
              </thead>
              <tbody>
                {devices.map(d => (
                  <tr key={d.id} className={`border-t border-slate-100 ${d.active ? '' : 'text-slate-400 line-through'}`}>
                    <td className="px-2 py-1.5 font-mono"><Link className="link" href={`/objects/${id}?ip=${encodeURIComponent(d.ip)}#history`}>{d.ip}</Link></td>
                    <td className="px-2 py-1.5">{d.typeName}</td>
                    <td className="px-2 py-1.5">{d.model}</td>
                    <td className="px-2 py-1.5 font-mono">{d.mac}</td>
                    <td className="px-2 py-1.5">{d.serial}</td>
                    <td className="px-2 py-1.5">{d.place}</td>
                    <td className="px-2 py-1.5 whitespace-nowrap">{fmtDateTime(d.active ? d.lastSeenAt : d.removedAt, tz)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="card" id="history">
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <h2 className="text-[17px] font-semibold">История устройств{ipFilter && <> по IP <span className="font-mono">{ipFilter}</span></>}</h2>
          {ipFilter && <Link className="link ml-auto text-sm" href={`/objects/${id}#history`}>все IP</Link>}
        </div>
        {!events.length && <p className="text-slate-500">Событий нет.</p>}
        <ol className="space-y-1.5 text-sm">
          {events.map(({ e, employee, ticket }) => (
            <li key={e.id}>
              <span className="text-slate-500 tabular-nums">{fmtDateTime(e.at, tz)}</span>{' '}
              <span className="font-mono font-medium">{e.ip}</span> — {e.actionName !== '—' ? e.actionName.toLowerCase() : KIND_TEXT[e.kind]}
              {e.details.role === 'old' && e.details.newIp && <> (снято, заменено на <span className="font-mono">{e.details.newIp}</span>)</>}
              {e.details.role === 'new' && e.details.oldIp && <> (поставлено вместо <span className="font-mono">{e.details.oldIp}</span>)</>}
              {[e.details.type, e.details.model, e.details.mac, e.details.place].filter(Boolean).length > 0 && (
                <span className="text-slate-500"> · {[e.details.type, e.details.model, e.details.mac, e.details.place].filter(Boolean).join(', ')}</span>
              )}
              {' · '}{employee} · <Link className="link" href={`/tickets/${ticket}`}>{ticket}</Link>
            </li>
          ))}
        </ol>
      </section>

      <section className="card">
        <h2 className="h2">Заявки по объекту {openCount > 0 && <span className="font-normal text-slate-500">(открытых: {openCount})</span>}</h2>
        {!tickets.length && <p className="text-slate-500">Нет заявок.</p>}
        <ul className="space-y-1.5 text-sm">
          {tickets.map(t => (
            <li key={t.number} className="flex flex-wrap items-center gap-2">
              <Link className="link font-semibold" href={`/tickets/${t.number}`}>{t.number}</Link>
              <StatusBadge status={t.status} />
              <span className="text-slate-500">{fmtDateTime(t.createdAt, tz)}</span>
              <span className="truncate">{t.description.slice(0, 100)}</span>
            </li>
          ))}
        </ul>
      </section>
    </main>
  );
}

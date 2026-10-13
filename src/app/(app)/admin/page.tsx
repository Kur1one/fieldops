import { asc, eq, sql } from 'drizzle-orm';
import Link from 'next/link';
import { db, schema } from '@/lib/db';
import { can, requireUser } from '@/lib/server/auth';
import { DEFAULT_DISTANCE_THRESHOLD_M } from '@/lib/shared/constants';
import { CitiesTab, DictsTab, EmployeesTab, ObjectsTab } from './tabs';

export const metadata = { title: 'Справочники' };

export default async function AdminPage({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
  const user = await requireUser(['dispatcher', 'manager']);
  const full = can.editAllDicts(user);
  const tabs = [
    { id: 'objects', label: 'Объекты' },
    { id: 'cities', label: 'Города' },
    ...(full ? [{ id: 'employees', label: 'Сотрудники' }, { id: 'dicts', label: 'Устройства и приоритеты' }] : []),
  ];
  const { tab: raw } = await searchParams;
  const tab = tabs.find(t => t.id === raw)?.id ?? 'objects';

  let body: React.ReactNode = null;
  if (tab === 'cities') {
    const rows = await db.select().from(schema.cities).orderBy(asc(schema.cities.name));
    body = <CitiesTab rows={rows.map(r => ({ id: r.id, name: r.name, code: r.code, lastNumber: r.lastNumber, active: r.active }))} />;
  } else if (tab === 'objects') {
    const [rows, cities] = await Promise.all([
      db.select({
        id: schema.objects.id, name: schema.objects.name, cityId: schema.objects.cityId, address: schema.objects.address, active: schema.objects.active,
        devices: sql<number>`(select count(*)::int from object_devices d where d.object_id = ${schema.objects.id} and d.active)`,
      }).from(schema.objects).orderBy(asc(schema.objects.name)),
      db.select({ id: schema.cities.id, name: schema.cities.name }).from(schema.cities).orderBy(asc(schema.cities.name)),
    ]);
    body = <ObjectsTab rows={rows} cities={cities} />;
  } else if (tab === 'employees') {
    const rows = await db.select({
      id: schema.employees.id, fullName: schema.employees.fullName, email: schema.employees.email, role: schema.employees.role,
      phone: schema.employees.phone, active: schema.employees.active,
    }).from(schema.employees).orderBy(asc(schema.employees.fullName));
    body = <EmployeesTab rows={rows} />;
  } else if (tab === 'dicts') {
    const [types, actions, priorities, [setting]] = await Promise.all([
      db.select().from(schema.deviceTypes).orderBy(asc(schema.deviceTypes.sort), asc(schema.deviceTypes.name)),
      db.select().from(schema.deviceActions).orderBy(asc(schema.deviceActions.sort), asc(schema.deviceActions.name)),
      db.select().from(schema.priorities).orderBy(asc(schema.priorities.rank)),
      db.select().from(schema.settings).where(eq(schema.settings.key, 'distance_threshold_m')),
    ]);
    body = <DictsTab types={types} actions={actions} priorities={priorities} threshold={Number(setting?.value) || DEFAULT_DISTANCE_THRESHOLD_M} />;
  }

  return (
    <main className="mx-auto max-w-6xl px-3 pt-3 pb-12">
      <h1 className="mx-1 mb-3 text-[22px] font-bold">Справочники</h1>
      <nav className="mb-4 flex gap-1 overflow-x-auto">
        {tabs.map(t => (
          <Link key={t.id} href={`/admin?tab=${t.id}`}
            className={`rounded-lg px-3 py-2 text-sm font-medium whitespace-nowrap ${t.id === tab ? 'bg-white text-brand shadow-sm ring-1 ring-slate-200' : 'text-slate-600 hover:bg-white/60'}`}>
            {t.label}
          </Link>
        ))}
      </nav>
      {body}
    </main>
  );
}

import 'server-only';
import { and, asc, desc, eq, exists, ilike, inArray, isNull, or, sql, type SQL } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import { db, schema } from '@/lib/db';
import { OPEN_STATUSES, TICKET_STATUSES, type TicketStatus } from '@/lib/shared/constants';
import type { CurrentUser } from './auth';
import { visibleTicketsWhere } from './tickets';

const { tickets, cities, objects, priorities, employees, reports, reportDevices, files, ticketEvents, reportComments } = schema;
const assignee = alias(employees, 'assignee');
const author = alias(employees, 'author');

/* ---------- фильтры списка ---------- */

export type TicketFilters = {
  statuses: TicketStatus[];
  cityId?: number;
  objectId?: number;
  assigneeId?: number | 'none';
  priorityId?: number;
  createdFrom?: string;
  createdTo?: string;
  visitFrom?: string;
  visitTo?: string;
  mine?: boolean;
  q?: string;
  sort?: string;
  dir?: 'asc' | 'desc';
  page?: number;
};

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const int = (v: string | null) => (v && /^\d+$/.test(v) ? Number(v) : undefined);
const dateOrU = (v: string | null) => (v && DATE_RE.test(v) ? v : undefined);

export function parseFilters(sp: URLSearchParams): TicketFilters {
  const st = sp.get('status');
  let statuses: TicketStatus[];
  if (st === 'all') statuses = [...TICKET_STATUSES];
  else if (st) statuses = st.split(',').filter((s): s is TicketStatus => (TICKET_STATUSES as string[]).includes(s));
  else statuses = [...OPEN_STATUSES];
  if (!statuses.length) statuses = [...OPEN_STATUSES];
  const a = sp.get('assignee');
  return {
    statuses,
    cityId: int(sp.get('city')),
    objectId: int(sp.get('object')),
    assigneeId: a === 'none' ? 'none' : int(a),
    priorityId: int(sp.get('priority')),
    createdFrom: dateOrU(sp.get('createdFrom')),
    createdTo: dateOrU(sp.get('createdTo')),
    visitFrom: dateOrU(sp.get('visitFrom')),
    visitTo: dateOrU(sp.get('visitTo')),
    mine: sp.get('mine') === '1',
    q: (sp.get('q') ?? '').trim().slice(0, 200) || undefined,
    sort: sp.get('sort') ?? undefined,
    dir: sp.get('dir') === 'asc' ? 'asc' : sp.get('dir') === 'desc' ? 'desc' : undefined,
    page: Math.max(1, int(sp.get('page')) ?? 1),
  };
}

// начало суток в поясе пользователя
const dayStart = (d: string, tz: string) => sql`(${d}::date)::timestamp at time zone ${tz}`;
const dayEnd = (d: string, tz: string) => sql`((${d}::date + 1))::timestamp at time zone ${tz}`;

function filterWhere(user: CurrentUser, f: TicketFilters, tz: string, withStatus: boolean): SQL | undefined {
  const w: (SQL | undefined)[] = [visibleTicketsWhere(user)];
  if (withStatus) w.push(inArray(tickets.status, f.statuses));
  if (f.cityId) w.push(eq(tickets.cityId, f.cityId));
  if (f.objectId) w.push(eq(tickets.objectId, f.objectId));
  if (f.assigneeId === 'none') w.push(isNull(tickets.assigneeId));
  else if (f.assigneeId) w.push(eq(tickets.assigneeId, f.assigneeId));
  if (f.priorityId) w.push(eq(tickets.priorityId, f.priorityId));
  if (f.mine) w.push(eq(tickets.assigneeId, user.id));
  if (f.createdFrom) w.push(sql`${tickets.createdAt} >= ${dayStart(f.createdFrom, tz)}`);
  if (f.createdTo) w.push(sql`${tickets.createdAt} < ${dayEnd(f.createdTo, tz)}`);
  if (f.visitFrom || f.visitTo) {
    const rw: SQL[] = [eq(reports.ticketId, tickets.id)];
    if (f.visitFrom) rw.push(sql`${reports.arrivalAt} >= ${dayStart(f.visitFrom, tz)}`);
    if (f.visitTo) rw.push(sql`${reports.arrivalAt} < ${dayEnd(f.visitTo, tz)}`);
    w.push(exists(db.select({ x: sql`1` }).from(reports).where(and(...rw))));
  }
  if (f.q) {
    const like = `%${f.q.replace(/[\\%_]/g, m => '\\' + m)}%`;
    w.push(or(
      ilike(tickets.number, like),
      ilike(objects.name, like),
      ilike(tickets.description, like),
      ilike(tickets.address, like),
      exists(db.select({ x: sql`1` }).from(reportDevices)
        .innerJoin(reports, eq(reports.id, reportDevices.reportId))
        .where(and(eq(reports.ticketId, tickets.id), or(ilike(reportDevices.ip, like), ilike(reportDevices.oldIp, like))))),
    ));
  }
  return and(...w.filter(Boolean) as SQL[]);
}

const SORTS: Record<string, SQL> = {
  number: sql`${cities.code}, ${tickets.number}`,
  created: sql`${tickets.createdAt}`,
  city: sql`${cities.name}`,
  object: sql`${objects.name}`,
  priority: sql`${priorities.rank}`,
  assignee: sql`${assignee.fullName}`,
  planned: sql`${tickets.plannedDate}`,
  status: sql`array_position(array['new','assigned','in_progress','revisit','done','cancelled']::ticket_status[], ${tickets.status})`,
  lastVisit: sql`${tickets.lastVisitAt}`,
  reports: sql`${tickets.reportCount}`,
};

export const PAGE_SIZE = 100;

export async function listTickets(user: CurrentUser, f: TicketFilters, tz: string, opts: { all?: boolean } = {}) {
  const where = filterWhere(user, f, tz, true);
  let order: SQL[];
  const s = f.sort ? SORTS[f.sort] : undefined;
  if (s) {
    const dir = f.dir ?? 'asc';
    order = [sql`${s} ${sql.raw(dir)} nulls last`, desc(tickets.id)];
  } else {
    // аварийные сверху, далее по плановой дате
    order = [asc(priorities.rank), sql`${tickets.plannedDate} asc nulls last`, desc(tickets.createdAt)];
  }
  const base = db.select({
    id: tickets.id,
    number: tickets.number,
    createdAt: tickets.createdAt,
    cityName: cities.name,
    objectName: objects.name,
    description: sql<string>`left(${tickets.description}, 160)`,
    priorityName: priorities.name,
    priorityRank: priorities.rank,
    assigneeName: assignee.fullName,
    plannedDate: tickets.plannedDate,
    status: tickets.status,
    lastVisitAt: tickets.lastVisitAt,
    reportCount: tickets.reportCount,
    isUnplanned: tickets.isUnplanned,
    address: tickets.address,
    closedAt: tickets.closedAt,
  })
    .from(tickets)
    .innerJoin(cities, eq(cities.id, tickets.cityId))
    .innerJoin(objects, eq(objects.id, tickets.objectId))
    .innerJoin(priorities, eq(priorities.id, tickets.priorityId))
    .leftJoin(assignee, eq(assignee.id, tickets.assigneeId))
    .where(where)
    .orderBy(...order);

  if (opts.all) return { rows: await base.limit(20000), total: -1 };
  const page = f.page ?? 1;
  const [rows, [{ n }]] = await Promise.all([
    base.limit(PAGE_SIZE).offset((page - 1) * PAGE_SIZE),
    db.select({ n: sql<number>`count(*)::int` }).from(tickets)
      .innerJoin(objects, eq(objects.id, tickets.objectId))
      .where(where),
  ]);
  return { rows, total: n };
}

export type TicketRow = Awaited<ReturnType<typeof listTickets>>['rows'][number];

// Счётчики по статусам с учётом всех фильтров, кроме самого статуса.
export async function statusCounts(user: CurrentUser, f: TicketFilters, tz: string) {
  const rows = await db.select({ status: tickets.status, n: sql<number>`count(*)::int` })
    .from(tickets)
    .innerJoin(objects, eq(objects.id, tickets.objectId))
    .where(filterWhere(user, f, tz, false))
    .groupBy(tickets.status);
  const out = Object.fromEntries(TICKET_STATUSES.map(s => [s, 0])) as Record<TicketStatus, number>;
  rows.forEach(r => { out[r.status] = r.n; });
  return out;
}

/* ---------- карточка заявки ---------- */

export async function ticketCard(ticketId: number) {
  const [row] = await db.select()
    .from(tickets)
    .innerJoin(cities, eq(cities.id, tickets.cityId))
    .innerJoin(objects, eq(objects.id, tickets.objectId))
    .innerJoin(priorities, eq(priorities.id, tickets.priorityId))
    .leftJoin(assignee, eq(assignee.id, tickets.assigneeId))
    .innerJoin(author, eq(author.id, tickets.authorId))
    .where(eq(tickets.id, ticketId));
  if (!row) return null;
  const t = {
    ticket: row.tickets,
    cityName: row.cities.name,
    cityCode: row.cities.code,
    objectId: row.objects.id,
    objectName: row.objects.name,
    objectLat: row.objects.lat,
    objectLng: row.objects.lng,
    priorityName: row.priorities.name,
    priorityRank: row.priorities.rank,
    assigneeName: row.assignee?.fullName ?? null,
    authorName: row.author.fullName,
  };
  const reps = await db.select().from(reports).where(eq(reports.ticketId, ticketId)).orderBy(desc(reports.submittedAt));
  const ids = reps.map(r => r.id);
  const [devs, fls, comments, attachments, events] = await Promise.all([
    ids.length ? db.select().from(reportDevices).where(inArray(reportDevices.reportId, ids)).orderBy(reportDevices.position) : [],
    ids.length ? db.select().from(files).where(and(inArray(files.reportId, ids), eq(files.status, 'done'))).orderBy(files.kind, files.seq) : [],
    ids.length ? db.select({ c: reportComments, authorName: employees.fullName }).from(reportComments)
      .innerJoin(employees, eq(employees.id, reportComments.authorId))
      .where(inArray(reportComments.reportId, ids)).orderBy(reportComments.createdAt) : [],
    db.select().from(files).where(and(eq(files.ticketId, ticketId), eq(files.status, 'done'))).orderBy(files.seq),
    db.select({ e: ticketEvents, authorName: employees.fullName }).from(ticketEvents)
      .leftJoin(employees, eq(employees.id, ticketEvents.authorId))
      .where(eq(ticketEvents.ticketId, ticketId)).orderBy(asc(ticketEvents.at), asc(ticketEvents.id)),
  ]);

  return {
    ...t,
    attachments,
    reports: reps.map(r => ({
      ...r,
      devices: devs.filter(d => d.reportId === r.id),
      files: fls.filter(f => f.reportId === r.id),
      comments: comments.filter(c => c.c.reportId === r.id),
    })),
    events,
  };
}

export type TicketCard = NonNullable<Awaited<ReturnType<typeof ticketCard>>>;

/* ---------- справочники для форм ---------- */

export async function formRefs(user: CurrentUser) {
  const visible = visibleTicketsWhere(user);
  const [cityRows, objectRows, prioRows, typeRows, actionRows, empRows, ticketRows] = await Promise.all([
    db.select({ id: cities.id, name: cities.name, code: cities.code }).from(cities).where(eq(cities.active, true)).orderBy(cities.name),
    db.select({ id: objects.id, name: objects.name, cityId: objects.cityId, address: objects.address, lat: objects.lat, lng: objects.lng })
      .from(objects).where(eq(objects.active, true)).orderBy(objects.name),
    db.select({ id: priorities.id, name: priorities.name, rank: priorities.rank, isDefault: priorities.isDefault })
      .from(priorities).where(eq(priorities.active, true)).orderBy(priorities.rank),
    db.select({ name: schema.deviceTypes.name }).from(schema.deviceTypes).where(eq(schema.deviceTypes.active, true)).orderBy(schema.deviceTypes.sort, schema.deviceTypes.name),
    db.select({ name: schema.deviceActions.name, kind: schema.deviceActions.kind }).from(schema.deviceActions)
      .where(eq(schema.deviceActions.active, true)).orderBy(schema.deviceActions.sort, schema.deviceActions.name),
    user.role === 'field' ? [] : db.select({ id: employees.id, fullName: employees.fullName, role: employees.role }).from(employees)
      .where(eq(employees.active, true)).orderBy(employees.fullName),
    db.select({
      number: tickets.number, cityId: tickets.cityId, cityName: cities.name, objectId: tickets.objectId, objectName: objects.name,
      address: tickets.address, description: tickets.description, priorityName: priorities.name, priorityRank: priorities.rank,
      assigneeId: tickets.assigneeId, assigneeName: assignee.fullName, plannedDate: tickets.plannedDate, status: tickets.status,
      note: tickets.note, contact: tickets.contact,
    }).from(tickets)
      .innerJoin(cities, eq(cities.id, tickets.cityId))
      .innerJoin(objects, eq(objects.id, tickets.objectId))
      .innerJoin(priorities, eq(priorities.id, tickets.priorityId))
      .leftJoin(assignee, eq(assignee.id, tickets.assigneeId))
      .where(and(inArray(tickets.status, OPEN_STATUSES), visible))
      .orderBy(asc(priorities.rank), sql`${tickets.plannedDate} asc nulls last`, desc(tickets.createdAt)),
  ]);
  return {
    me: { id: user.id, fullName: user.fullName, email: user.email, role: user.role },
    cities: cityRows,
    objects: objectRows,
    priorities: prioRows,
    deviceTypes: typeRows.map(t => t.name),
    deviceActions: actionRows,
    employees: empRows,
    tickets: ticketRows,
    loadedAt: new Date().toISOString(),
  };
}

export type FormRefs = Awaited<ReturnType<typeof formRefs>>;

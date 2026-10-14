import 'server-only';
import { and, eq, exists, inArray, isNull, or, sql, type SQL } from 'drizzle-orm';
import { z } from 'zod';
import { db, schema, type DbOrTx, type Tx } from '@/lib/db';
import {
  CLOSED_STATUSES, LIMITS, OPEN_STATUSES, STATUS_LABEL, type TicketStatus,
} from '@/lib/shared/constants';
import { todayIso } from '@/lib/shared/format';
import { cleanText, formatTicketNumber, norm } from '@/lib/shared/text';
import { badRequest, conflict, forbidden, notFound } from './api';
import { can, type CurrentUser } from './auth';

const { tickets, ticketEvents, cities, objects, employees, priorities, files, reports } = schema;

/* ---------- видимость ---------- */

// Выездной сотрудник видит свои (назначенные ему или с его отчётами) и неназначенные открытые.
export function visibleTicketsWhere(user: CurrentUser): SQL | undefined {
  if (can.seeAllTickets(user)) return undefined;
  return or(
    eq(tickets.assigneeId, user.id),
    and(isNull(tickets.assigneeId), inArray(tickets.status, OPEN_STATUSES)),
    exists(db.select({ x: sql`1` }).from(reports)
      .where(and(eq(reports.ticketId, tickets.id), eq(reports.employeeId, user.id)))),
  );
}

export async function getVisibleTicket(user: CurrentUser, number: string, q: DbOrTx = db) {
  const where = visibleTicketsWhere(user);
  const rows = await q.select().from(tickets)
    .where(and(eq(tickets.number, number.toUpperCase()), where))
    .limit(1);
  if (!rows[0]) throw notFound('Заявка не найдена или нет доступа');
  return rows[0];
}

/* ---------- история ---------- */

export async function addEvent(q: DbOrTx, e: typeof ticketEvents.$inferInsert) {
  await q.insert(ticketEvents).values(e);
}

/* ---------- справочники ---------- */

// Объект по id или по названию; новое название добавляется в справочник (с городом «справочно»).
export async function resolveObject(tx: Tx, input: { objectId?: number | null; objectName?: string | null; cityId: number }) {
  if (input.objectId) {
    const [o] = await tx.select().from(objects).where(eq(objects.id, input.objectId));
    if (!o) throw badRequest('Объект не найден в справочнике');
    return o;
  }
  const name = cleanText(input.objectName, 300);
  if (!name) throw badRequest('Не указан объект');
  const key = norm(name);
  const [found] = await tx.select().from(objects).where(eq(objects.nameKey, key));
  if (found) return found;
  const [created] = await tx.insert(objects)
    .values({ name, nameKey: key, cityId: input.cityId })
    .onConflictDoNothing()
    .returning();
  if (created) return created;
  const [again] = await tx.select().from(objects).where(eq(objects.nameKey, key));
  return again;
}

export async function getCity(q: DbOrTx, cityId: number) {
  const [c] = await q.select().from(cities).where(eq(cities.id, cityId));
  if (!c) throw badRequest('Город не найден');
  return c;
}

async function defaultPriorityId(q: DbOrTx) {
  const [p] = await q.select({ id: priorities.id }).from(priorities)
    .where(and(eq(priorities.isDefault, true), eq(priorities.active, true))).limit(1);
  if (p) return p.id;
  const [any] = await q.select({ id: priorities.id }).from(priorities).orderBy(priorities.rank).limit(1);
  if (!any) throw new Error('Справочник приоритетов пуст');
  return any.id;
}

async function activeEmployee(q: DbOrTx, id: number) {
  const [e] = await q.select().from(employees).where(and(eq(employees.id, id), eq(employees.active, true)));
  if (!e) throw badRequest('Исполнитель не найден или неактивен');
  return e;
}

/* ---------- нумерация ---------- */

// Атомарно: строка города блокируется на время транзакции, номер не повторяется и не теряется.
export async function nextTicketNumber(tx: Tx, cityId: number): Promise<string> {
  const r = await tx.update(cities)
    .set({ lastNumber: sql`${cities.lastNumber} + 1` })
    .where(eq(cities.id, cityId))
    .returning({ n: cities.lastNumber, code: cities.code });
  if (!r[0]) throw badRequest('Город не найден');
  return formatTicketNumber(r[0].code, r[0].n);
}

/* ---------- создание ---------- */

export const createTicketSchema = z.object({
  cityId: z.number().int().positive(),
  objectId: z.number().int().positive().nullish(),
  objectName: z.string().max(300).nullish(),
  address: z.string().trim().max(LIMITS.shortText).default(''),
  description: z.string().trim().min(1, 'заполните описание').max(LIMITS.ticketDescription),
  priorityId: z.number().int().positive().nullish(),
  assigneeId: z.number().int().positive().nullish(),
  plannedDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullish(),
  contact: z.string().max(LIMITS.shortText).nullish(),
  note: z.string().max(LIMITS.longText).nullish(),
  draftKey: z.string().regex(/^[A-Za-z0-9-]{8,64}$/).nullish(),
  attachmentIds: z.array(z.uuid()).max(LIMITS.maxTicketAttachments).default([]),
});
export type CreateTicketInput = z.infer<typeof createTicketSchema>;

export async function createTicket(user: CurrentUser, input: CreateTicketInput, tz: string) {
  if (!can.createTicket(user)) throw forbidden('Создавать заявки может только диспетчер или руководитель');
  if (input.plannedDate && input.plannedDate < todayIso(tz)) throw badRequest('Плановая дата не может быть раньше сегодняшней');

  return db.transaction(async tx => {
    const city = await getCity(tx, input.cityId);
    if (!city.active) throw badRequest('Город неактивен');
    const obj = await resolveObject(tx, input);
    const priorityId = input.priorityId ?? await defaultPriorityId(tx);
    if (input.assigneeId) await activeEmployee(tx, input.assigneeId);

    const number = await nextTicketNumber(tx, city.id);
    const status: TicketStatus = input.assigneeId ? 'assigned' : 'new';
    const [t] = await tx.insert(tickets).values({
      number,
      cityId: city.id,
      objectId: obj.id,
      address: cleanText(input.address, LIMITS.shortText),
      description: cleanText(input.description, LIMITS.ticketDescription),
      priorityId,
      assigneeId: input.assigneeId ?? null,
      plannedDate: input.plannedDate ?? null,
      contact: cleanText(input.contact, LIMITS.shortText),
      note: cleanText(input.note, LIMITS.longText),
      status,
      authorId: user.id,
    }).returning();

    await addEvent(tx, { ticketId: t.id, authorId: user.id, type: 'created', toValue: 'new' });
    if (input.assigneeId) {
      const a = await activeEmployee(tx, input.assigneeId);
      await addEvent(tx, { ticketId: t.id, authorId: user.id, type: 'assigned', toValue: a.fullName });
      await addEvent(tx, { ticketId: t.id, authorId: null, type: 'status', fromValue: 'new', toValue: 'assigned' });
    }

    if (input.attachmentIds.length) {
      await attachFilesToTicket(tx, user, t.id, input.draftKey ?? '', input.attachmentIds);
    }
    return t;
  });
}

async function attachFilesToTicket(tx: Tx, user: CurrentUser, ticketId: number, draftKey: string, ids: string[]) {
  const rows = await tx.select().from(files).where(inArray(files.id, ids));
  const bad = ids.filter(id => {
    const f = rows.find(r => r.id === id);
    return !f || f.status !== 'done' || f.ownerKey !== draftKey || f.uploadedBy !== user.id || f.kind !== 'attachment' || f.ticketId || f.reportId;
  });
  if (bad.length) throw badRequest('Не все вложения загружены — дождитесь окончания загрузки', { missingFiles: bad });
  await tx.update(files).set({ ticketId }).where(inArray(files.id, ids));
}

/* ---------- изменение: исполнитель, дата, приоритет ---------- */

export const updateTicketSchema = z.object({
  assigneeId: z.number().int().positive().nullable().optional(),
  plannedDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  priorityId: z.number().int().positive().optional(),
});

export async function updateTicket(user: CurrentUser, number: string, input: z.infer<typeof updateTicketSchema>, tz: string) {
  if (!can.manageTickets(user)) throw forbidden();
  return db.transaction(async tx => {
    const t = await lockTicket(tx, number);
    const set: Partial<typeof tickets.$inferInsert> = {};

    if (input.assigneeId !== undefined && input.assigneeId !== t.assigneeId) {
      let name = '—';
      if (input.assigneeId) name = (await activeEmployee(tx, input.assigneeId)).fullName;
      set.assigneeId = input.assigneeId;
      await addEvent(tx, { ticketId: t.id, authorId: user.id, type: 'assigned', fromValue: await employeeName(tx, t.assigneeId), toValue: name });
      // назначение переводит новую заявку в «Назначена», снятие исполнителя — обратно
      if (input.assigneeId && t.status === 'new') {
        set.status = 'assigned';
        await addEvent(tx, { ticketId: t.id, authorId: null, type: 'status', fromValue: 'new', toValue: 'assigned' });
      } else if (!input.assigneeId && t.status === 'assigned') {
        set.status = 'new';
        await addEvent(tx, { ticketId: t.id, authorId: null, type: 'status', fromValue: 'assigned', toValue: 'new' });
      }
    }
    if (input.plannedDate !== undefined && input.plannedDate !== t.plannedDate) {
      if (input.plannedDate && input.plannedDate < todayIso(tz)) throw badRequest('Плановая дата не может быть раньше сегодняшней');
      set.plannedDate = input.plannedDate;
      await addEvent(tx, { ticketId: t.id, authorId: user.id, type: 'edited', text: 'Плановая дата', fromValue: t.plannedDate, toValue: input.plannedDate });
    }
    if (input.priorityId !== undefined && input.priorityId !== t.priorityId) {
      const [from] = await tx.select().from(priorities).where(eq(priorities.id, t.priorityId));
      const [to] = await tx.select().from(priorities).where(eq(priorities.id, input.priorityId));
      if (!to) throw badRequest('Приоритет не найден');
      set.priorityId = input.priorityId;
      await addEvent(tx, { ticketId: t.id, authorId: user.id, type: 'edited', text: 'Приоритет', fromValue: from?.name, toValue: to.name });
    }
    if (Object.keys(set).length) await tx.update(tickets).set(set).where(eq(tickets.id, t.id));
    return { ok: true };
  });
}

async function employeeName(q: DbOrTx, id: number | null) {
  if (!id) return '—';
  const [e] = await q.select({ n: employees.fullName }).from(employees).where(eq(employees.id, id));
  return e?.n ?? '—';
}

export async function lockTicket(tx: Tx, number: string) {
  const [t] = await tx.select().from(tickets).where(eq(tickets.number, number.toUpperCase())).for('update');
  if (!t) throw notFound('Заявка не найдена');
  return t;
}

/* ---------- ручная смена статуса ---------- */

export const statusChangeSchema = z.object({
  status: z.enum(['new', 'assigned', 'in_progress', 'revisit', 'done', 'cancelled']),
  reason: z.string().max(LIMITS.shortText).optional(),
});

export async function changeStatus(user: CurrentUser, number: string, input: z.infer<typeof statusChangeSchema>) {
  if (!can.manageTickets(user)) throw forbidden();
  const reason = cleanText(input.reason, LIMITS.shortText);
  return db.transaction(async tx => {
    const t = await lockTicket(tx, number);
    if (t.status === input.status) return { ok: true };
    if (input.status === 'cancelled' && !reason) throw badRequest('Укажите причину отмены');
    if (input.status === 'assigned' && !t.assigneeId) throw badRequest('Сначала назначьте исполнителя');

    const set: Partial<typeof tickets.$inferInsert> = { status: input.status };
    if (input.status === 'done') set.closedAt = new Date();
    if (input.status === 'cancelled') { set.closedAt = new Date(); set.cancelReason = reason; }
    if (CLOSED_STATUSES.includes(t.status) && !CLOSED_STATUSES.includes(input.status)) {
      set.closedAt = null;
      set.cancelReason = null;
    }
    await tx.update(tickets).set(set).where(eq(tickets.id, t.id));
    await addEvent(tx, { ticketId: t.id, authorId: user.id, type: 'status', fromValue: t.status, toValue: input.status, text: reason || null });
    return { ok: true };
  });
}

/* ---------- «Я на объекте» ---------- */

// Заявка переходит «В работе», как только сотрудник отметил приезд (если есть связь).
export async function markArrival(user: CurrentUser, number: string) {
  return db.transaction(async tx => {
    const visible = await getVisibleTicket(user, number, tx);
    const t = await lockTicket(tx, visible.number);
    if (!OPEN_STATUSES.includes(t.status)) throw conflict(`Заявка ${STATUS_LABEL[t.status].toLowerCase()} — отчёт по ней подать нельзя`);
    const set: Partial<typeof tickets.$inferInsert> = {};
    if (!t.assigneeId) {
      set.assigneeId = user.id;
      await addEvent(tx, { ticketId: t.id, authorId: user.id, type: 'assigned', fromValue: '—', toValue: user.fullName });
    }
    if (t.status !== 'in_progress') {
      set.status = 'in_progress';
      await addEvent(tx, { ticketId: t.id, authorId: null, type: 'status', fromValue: t.status, toValue: 'in_progress', text: `${user.fullName}: «Я на объекте»` });
    }
    if (Object.keys(set).length) await tx.update(tickets).set(set).where(eq(tickets.id, t.id));
    return { ok: true, status: set.status ?? t.status };
  });
}

/* ---------- открытые заявки по объекту (предупреждение о дублях) ---------- */

export async function openTicketsForObject(objectId: number) {
  return db.select({ number: tickets.number, status: tickets.status, description: tickets.description })
    .from(tickets)
    .where(and(eq(tickets.objectId, objectId), inArray(tickets.status, OPEN_STATUSES)))
    .orderBy(tickets.createdAt);
}

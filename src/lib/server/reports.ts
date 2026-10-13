import 'server-only';
import { and, eq, inArray, sql } from 'drizzle-orm';
import { z } from 'zod';
import { db, schema, type Tx } from '@/lib/db';
import {
  DEFAULT_DISTANCE_THRESHOLD_M, LIMITS, OPEN_STATUSES, STATUS_LABEL, WORK_STATUS_LABEL, WORK_TO_TICKET,
  type ActionKind,
} from '@/lib/shared/constants';
import { distanceMeters, isValidIp, isValidMac, normalizeIpInput, normalizeMac } from '@/lib/shared/net';
import { cleanText } from '@/lib/shared/text';
import { badRequest, conflict } from './api';
import { can, type CurrentUser } from './auth';
import { addEvent, getCity, lockTicket, nextTicketNumber, resolveObject, visibleTicketsWhere } from './tickets';

const { reports, reportDevices, tickets, files, deviceTypes, deviceActions, objectDevices, deviceEvents, settings, priorities } = schema;

const geoSchema = z.object({
  time: z.iso.datetime({ offset: true }),
  lat: z.number().min(-90).max(90).nullish(),
  lng: z.number().min(-180).max(180).nullish(),
  acc: z.number().min(0).max(1e6).nullish(),
  error: z.string().max(300).nullish(),
});

const deviceSchema = z.object({
  type: z.string().trim().min(1, 'не выбран тип').max(100),
  action: z.string().max(100).default(''),
  ip: z.string().max(30),
  model: z.string().max(200).default(''),
  mac: z.string().max(30).default(''),
  serial: z.string().max(200).default(''),
  place: z.string().max(500).default(''),
  oldIp: z.string().max(30).default(''),
  oldModel: z.string().max(200).default(''),
  oldMac: z.string().max(30).default(''),
  oldSerial: z.string().max(200).default(''),
});

export const reportSchema = z.object({
  reportId: z.string().regex(/^[A-Za-z0-9-]{8,64}$/, 'неверный ID отчёта'),
  ticketNumber: z.string().max(20).nullish(),
  cityId: z.number().int().positive(),
  objectId: z.number().int().positive().nullish(),
  objectName: z.string().max(300).nullish(),
  address: z.string().trim().min(1, 'заполните адрес').max(LIMITS.shortText),
  arrival: geoSchema,
  finish: geoSchema,
  task: z.string().trim().min(1, 'заполните описание задачи').max(LIMITS.longText),
  workReport: z.string().trim().min(1, 'заполните отчёт о работе').max(LIMITS.workReport),
  materials: z.string().max(LIMITS.longText).default(''),
  workStatus: z.enum(['full', 'partial', 'revisit']),
  customerRep: z.string().max(LIMITS.shortText).default(''),
  comment: z.string().max(LIMITS.longText).default(''),
  devices: z.array(deviceSchema).max(LIMITS.maxDevices).default([]),
  fileIds: z.array(z.uuid()).max(LIMITS.maxPhotosPerBlock * 2 + 20).default([]),
  clientSentAt: z.iso.datetime({ offset: true }).nullish(),
});
export type ReportInput = z.infer<typeof reportSchema>;

type CleanDevice = {
  typeName: string; actionName: string; actionKind: ActionKind | null;
  ip: string; model: string; mac: string; serial: string; place: string;
  oldIp: string; oldModel: string; oldMac: string; oldSerial: string;
};

// Проверки устройств (раздел 8): IPv4, MAC, повтор IP, старый IP при замене.
export async function validateDevices(tx: Tx, list: ReportInput['devices']): Promise<CleanDevice[]> {
  if (!list.length) return [];
  const types = await tx.select().from(deviceTypes);
  const actions = await tx.select().from(deviceActions);
  const errs: string[] = [];
  const seen = new Map<string, number>();
  const out = list.map((d, i) => {
    const n = `Устройство ${i + 1}: `;
    const type = types.find(t => t.name === d.type.trim());
    if (!type) errs.push(n + 'тип не из справочника');
    const actionName = d.action.trim();
    const action = actionName ? actions.find(a => a.name === actionName) : null;
    if (actionName && !action) errs.push(n + 'действие не из справочника');
    const ip = normalizeIpInput(d.ip);
    if (!ip) errs.push(n + 'не указан IP');
    else if (!isValidIp(ip)) errs.push(n + 'неверный формат IP');
    else {
      const prev = seen.get(ip);
      if (prev) errs.push(n + `IP повторяется (устройство ${prev})`);
      else seen.set(ip, i + 1);
    }
    const mac = normalizeMac(d.mac);
    if (mac && !isValidMac(mac)) errs.push(n + 'неверный формат MAC');
    const repl = action?.kind === 'replace';
    const oldIp = repl ? normalizeIpInput(d.oldIp) : '';
    const oldMac = repl ? normalizeMac(d.oldMac) : '';
    if (repl) {
      if (!oldIp) errs.push(n + 'не указан IP снятого устройства');
      else if (!isValidIp(oldIp)) errs.push(n + 'неверный формат старого IP');
      if (oldMac && !isValidMac(oldMac)) errs.push(n + 'неверный формат старого MAC');
    }
    return {
      typeName: type?.name ?? d.type, actionName: action?.name ?? '', actionKind: action?.kind ?? null,
      ip, model: cleanText(d.model, 200), mac, serial: cleanText(d.serial, 200), place: cleanText(d.place, 500),
      oldIp, oldModel: repl ? cleanText(d.oldModel, 200) : '', oldMac, oldSerial: repl ? cleanText(d.oldSerial, 200) : '',
    };
  });
  if (errs.length) throw badRequest(errs[0], { errors: errs });
  return out;
}

async function distanceThreshold(tx: Tx): Promise<number> {
  const [s] = await tx.select().from(settings).where(eq(settings.key, 'distance_threshold_m'));
  const v = Number(s?.value);
  return Number.isFinite(v) && v > 0 ? v : DEFAULT_DISTANCE_THRESHOLD_M;
}

export type SubmitResult = {
  ok: true; duplicate: boolean; reportId: string; ticketNumber: string; objectName: string; ticketStatus: string;
};

export async function submitReport(user: CurrentUser, input: ReportInput): Promise<SubmitResult> {
  const now = new Date();
  try {
    return await db.transaction(async tx => {
      // идемпотентность: повторная отправка того же отчёта не создаёт дубль
      const dup = await existingReport(tx, input.reportId, user);
      if (dup) return dup;

      const arrival = new Date(input.arrival.time);
      const finish = new Date(input.finish.time);
      if (finish < arrival) throw badRequest('Время завершения раньше времени приезда');
      const devices = await validateDevices(tx, input.devices);

      const city = await getCity(tx, input.cityId);
      const obj = await resolveObject(tx, input);

      // заявка: выбранная или новая «Внеплановый выезд»
      let ticket;
      if (input.ticketNumber?.trim()) {
        const number = input.ticketNumber.trim().toUpperCase();
        const where = visibleTicketsWhere(user);
        const [vis] = await tx.select({ id: tickets.id }).from(tickets).where(and(eq(tickets.number, number), where));
        if (!vis) throw badRequest(`Заявка ${number} не найдена или недоступна`);
        ticket = await lockTicket(tx, number);
        if (!OPEN_STATUSES.includes(ticket.status)) {
          throw conflict(`Заявка ${number} ${STATUS_LABEL[ticket.status].toLowerCase()} — отчёт по ней подать нельзя. Очистите поле «Заявка», чтобы отправить как внеплановый выезд, или попросите диспетчера переоткрыть заявку.`, { code: 'ticket_closed' });
        }
        if (ticket.assigneeId && ticket.assigneeId !== user.id && !can.manageTickets(user)) {
          throw badRequest(`Заявка ${number} назначена другому сотруднику`);
        }
      } else {
        const [prio] = await tx.select({ id: priorities.id }).from(priorities)
          .orderBy(sql`${priorities.isDefault} desc`, priorities.rank).limit(1);
        const number = await nextTicketNumber(tx, city.id);
        [ticket] = await tx.insert(tickets).values({
          number, cityId: city.id, objectId: obj.id,
          address: cleanText(input.address, LIMITS.shortText),
          description: cleanText(input.task, LIMITS.ticketDescription),
          priorityId: prio.id, assigneeId: user.id, status: 'in_progress', isUnplanned: true, authorId: user.id,
        }).returning();
        await addEvent(tx, { ticketId: ticket.id, authorId: user.id, type: 'created', toValue: 'in_progress', text: 'Внеплановый выезд: заявка создана по отчёту' });
      }

      // файлы должны быть загружены этим сотрудником под этот отчёт
      if (input.fileIds.length) {
        const rows = await tx.select().from(files).where(inArray(files.id, input.fileIds));
        const missing = input.fileIds.filter(id => {
          const f = rows.find(r => r.id === id);
          return !f || f.status !== 'done' || f.ownerKey !== input.reportId || f.uploadedBy !== user.id || f.ticketId;
        });
        if (missing.length) throw badRequest('Не все файлы загружены на сервер', { code: 'files_missing', missingFiles: missing });
      }

      // контроль: расхождение часов, расстояние до объекта
      const reasons: string[] = [];
      const skewRef = input.clientSentAt ? new Date(input.clientSentAt) : null;
      if (skewRef && Math.abs(skewRef.getTime() - now.getTime()) > LIMITS.clockSkewMinutes * 60000) {
        reasons.push(`Время на телефоне отличается от серверного на ${Math.round(Math.abs(skewRef.getTime() - now.getTime()) / 60000)} мин`);
      }
      if (arrival.getTime() > now.getTime() + LIMITS.clockSkewMinutes * 60000) reasons.push('Время приезда в будущем');
      let arrivalDist: number | null = null;
      let finishDist: number | null = null;
      if (obj.lat != null && obj.lng != null) {
        const limit = await distanceThreshold(tx);
        if (input.arrival.lat != null && input.arrival.lng != null) arrivalDist = distanceMeters(obj.lat, obj.lng, input.arrival.lat, input.arrival.lng);
        if (input.finish.lat != null && input.finish.lng != null) finishDist = distanceMeters(obj.lat, obj.lng, input.finish.lat, input.finish.lng);
        if (arrivalDist != null && arrivalDist > limit) reasons.push(`Приезд отмечен в ${arrivalDist} м от объекта`);
        if (finishDist != null && finishDist > limit) reasons.push(`Завершение отмечено в ${finishDist} м от объекта`);
      }

      const duration = Math.max(0, Math.round((finish.getTime() - arrival.getTime()) / 60000));
      const geo = (g: ReportInput['arrival']) => ({
        lat: g.lat != null ? Math.round(g.lat * 1e6) / 1e6 : null,
        lng: g.lng != null ? Math.round(g.lng * 1e6) / 1e6 : null,
        acc: g.acc != null ? Math.round(g.acc) : null,
        error: g.lat == null ? cleanText(g.error || 'причина неизвестна', 300) : null,
      });
      const a = geo(input.arrival), f = geo(input.finish);

      await tx.insert(reports).values({
        id: input.reportId,
        ticketId: ticket.id,
        employeeId: user.id,
        employeeEmail: user.email,
        employeeName: user.fullName,
        cityId: city.id, cityName: city.name,
        objectId: obj.id, objectName: obj.name,
        address: cleanText(input.address, LIMITS.shortText),
        arrivalAt: arrival, arrivalLat: a.lat, arrivalLng: a.lng, arrivalAcc: a.acc, arrivalGeoError: a.error, arrivalDistanceM: arrivalDist,
        finishAt: finish, finishLat: f.lat, finishLng: f.lng, finishAcc: f.acc, finishGeoError: f.error, finishDistanceM: finishDist,
        durationMinutes: duration,
        task: cleanText(input.task, LIMITS.longText),
        workReport: cleanText(input.workReport, LIMITS.workReport),
        materials: cleanText(input.materials, LIMITS.longText),
        workStatus: input.workStatus,
        customerRep: cleanText(input.customerRep, LIMITS.shortText),
        comment: cleanText(input.comment, LIMITS.longText),
        submittedAt: now,
        clientSentAt: skewRef,
        needsReview: reasons.length > 0,
        reviewReasons: reasons,
      });

      if (devices.length) {
        await tx.insert(reportDevices).values(devices.map((d, i) => ({ reportId: input.reportId, position: i + 1, ...d })));
      }
      if (input.fileIds.length) {
        await tx.update(files).set({ reportId: input.reportId }).where(inArray(files.id, input.fileIds));
      }

      // заявка: исполнитель, статус по отчёту, итоги
      const newStatus = WORK_TO_TICKET[input.workStatus];
      const set: Partial<typeof tickets.$inferInsert> = {
        reportCount: sql`${tickets.reportCount} + 1` as unknown as number,
        totalMinutes: sql`${tickets.totalMinutes} + ${duration}` as unknown as number,
        lastVisitAt: sql`greatest(${tickets.lastVisitAt}, ${arrival.toISOString()}::timestamptz)` as unknown as Date,
      };
      if (!ticket.assigneeId) {
        set.assigneeId = user.id;
        await addEvent(tx, { ticketId: ticket.id, authorId: user.id, type: 'assigned', fromValue: '—', toValue: user.fullName });
      }
      await addEvent(tx, {
        ticketId: ticket.id, authorId: user.id, type: 'report', reportId: input.reportId,
        text: WORK_STATUS_LABEL[input.workStatus],
      });
      if (ticket.status !== newStatus) {
        set.status = newStatus;
        await addEvent(tx, {
          ticketId: ticket.id, authorId: null, type: 'status', fromValue: ticket.status, toValue: newStatus,
          text: `по отчёту ${input.reportId}`, reportId: input.reportId,
        });
      }
      if (newStatus === 'done') set.closedAt = now;
      await tx.update(tickets).set(set).where(eq(tickets.id, ticket.id));

      await applyRegistry(tx, {
        objectId: obj.id, reportId: input.reportId, ticketId: ticket.id, employeeId: user.id, at: finish,
      }, devices);

      return {
        ok: true, duplicate: false, reportId: input.reportId, ticketNumber: ticket.number, objectName: obj.name,
        ticketStatus: newStatus,
      } as SubmitResult;
    });
  } catch (e) {
    // гонка двух одинаковых отправок: вторая упирается в первичный ключ — отвечаем как на дубль
    if ((e as { code?: string })?.code === '23505' || (e as { cause?: { code?: string } })?.cause?.code === '23505') {
      const dup = await db.transaction(tx => existingReport(tx, input.reportId, user));
      if (dup) return dup;
    }
    throw e;
  }
}

async function existingReport(tx: Tx, reportId: string, user: CurrentUser): Promise<SubmitResult | null> {
  const [r] = await tx.select({
    id: reports.id, employeeId: reports.employeeId, objectName: reports.objectName,
    number: tickets.number, status: tickets.status,
  }).from(reports).innerJoin(tickets, eq(tickets.id, reports.ticketId)).where(eq(reports.id, reportId));
  if (!r) return null;
  if (r.employeeId !== user.id) throw conflict('Отчёт с таким ID уже отправлен другим сотрудником');
  return { ok: true, duplicate: true, reportId: r.id, ticketNumber: r.number, objectName: r.objectName, ticketStatus: r.status };
}

/* ---------- реестр устройств объекта (раздел 8.3) ---------- */

type RegCtx = { objectId: number; reportId: string; ticketId: number; employeeId: number; at: Date };

async function findActive(tx: Tx, objectId: number, ip: string) {
  const [d] = await tx.select().from(objectDevices)
    .where(and(eq(objectDevices.objectId, objectId), eq(objectDevices.ip, ip), eq(objectDevices.active, true)))
    .for('update');
  return d ?? null;
}

async function upsertActive(tx: Tx, ctx: RegCtx, d: CleanDevice) {
  const cur = await findActive(tx, ctx.objectId, d.ip);
  if (cur) {
    await tx.update(objectDevices).set({
      typeName: d.typeName,
      model: d.model || cur.model, mac: d.mac || cur.mac, serial: d.serial || cur.serial, place: d.place || cur.place,
      lastSeenAt: ctx.at, lastReportId: ctx.reportId,
    }).where(eq(objectDevices.id, cur.id));
    return cur.id;
  }
  const [row] = await tx.insert(objectDevices).values({
    objectId: ctx.objectId, ip: d.ip, typeName: d.typeName, model: d.model, mac: d.mac, serial: d.serial, place: d.place,
    firstSeenAt: ctx.at, lastSeenAt: ctx.at, lastReportId: ctx.reportId,
  }).returning({ id: objectDevices.id });
  return row.id;
}

async function deactivate(tx: Tx, ctx: RegCtx, ip: string) {
  const cur = await findActive(tx, ctx.objectId, ip);
  if (!cur) return null;
  await tx.update(objectDevices).set({ active: false, removedAt: ctx.at, lastReportId: ctx.reportId }).where(eq(objectDevices.id, cur.id));
  return cur.id;
}

export async function applyRegistry(tx: Tx, ctx: RegCtx, devices: CleanDevice[]) {
  if (!devices.length) return;
  // отчёты по одному объекту меняют реестр по очереди
  await tx.select({ id: schema.objects.id }).from(schema.objects).where(eq(schema.objects.id, ctx.objectId)).for('update');
  const ev =(objectDeviceId: number | null, ip: string, kind: ActionKind, actionName: string, details: Record<string, string>) =>
    tx.insert(deviceEvents).values({
      objectId: ctx.objectId, objectDeviceId, ip, kind, actionName,
      reportId: ctx.reportId, ticketId: ctx.ticketId, employeeId: ctx.employeeId, at: ctx.at,
      details: Object.fromEntries(Object.entries(details).filter(([, v]) => v)),
    });
  const info = (d: CleanDevice) => ({ type: d.typeName, model: d.model, mac: d.mac, serial: d.serial, place: d.place });

  for (const d of devices) {
    const kind: ActionKind = d.actionKind ?? 'other';
    if (kind === 'dismantle') {
      const id = await deactivate(tx, ctx, d.ip);
      await ev(id, d.ip, kind, d.actionName, info(d));
    } else if (kind === 'replace') {
      const oldId = await deactivate(tx, ctx, d.oldIp);
      await ev(oldId, d.oldIp, kind, d.actionName, {
        role: 'old', newIp: d.ip, model: d.oldModel, mac: d.oldMac, serial: d.oldSerial, type: d.typeName,
      });
      const newId = await upsertActive(tx, ctx, d);
      await ev(newId, d.ip, kind, d.actionName, { role: 'new', oldIp: d.oldIp, ...info(d) });
    } else {
      const id = await upsertActive(tx, ctx, d);
      await ev(id, d.ip, kind, d.actionName || '—', info(d));
    }
  }
}

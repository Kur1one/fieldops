import 'server-only';
import { and, eq, ne, sql } from 'drizzle-orm';
import ExcelJS from 'exceljs';
import { z } from 'zod';
import { db, schema } from '@/lib/db';
import { cleanText, norm } from '@/lib/shared/text';
import { badRequest, conflict, forbidden, notFound } from './api';
import { can, type CurrentUser } from './auth';

const { cities, objects, employees, priorities, deviceTypes, deviceActions, tickets, sessions, settings } = schema;

const name = z.string().trim().min(1, 'пустое название').max(300);
const coord = (min: number, max: number) => z.number().min(min).max(max).nullable().optional();

const S = {
  cities: {
    create: z.object({ name, code: z.string().trim().toUpperCase().regex(/^[A-Z]{3}$/, 'код — 3 латинские заглавные буквы') }),
    update: z.object({ name: name.optional(), code: z.string().trim().toUpperCase().regex(/^[A-Z]{3}$/, 'код — 3 латинские заглавные буквы').optional(), active: z.boolean().optional() }),
  },
  objects: {
    create: z.object({ name, cityId: z.number().int().positive().nullable().optional(), address: z.string().max(2000).default(''), lat: coord(-90, 90), lng: coord(-180, 180) }),
    update: z.object({ name: name.optional(), cityId: z.number().int().positive().nullable().optional(), address: z.string().max(2000).optional(), lat: coord(-90, 90), lng: coord(-180, 180), active: z.boolean().optional() }),
  },
  employees: {
    create: z.object({ email: z.email('неверная почта').trim().toLowerCase(), fullName: name, role: z.enum(['field', 'dispatcher', 'manager']), phone: z.string().max(50).default('') }),
    update: z.object({ email: z.email('неверная почта').trim().toLowerCase().optional(), fullName: name.optional(), role: z.enum(['field', 'dispatcher', 'manager']).optional(), phone: z.string().max(50).optional(), active: z.boolean().optional() }),
  },
  priorities: {
    create: z.object({ name, rank: z.number().int().min(1).max(100), isDefault: z.boolean().default(false) }),
    update: z.object({ name: name.optional(), rank: z.number().int().min(1).max(100).optional(), isDefault: z.boolean().optional(), active: z.boolean().optional() }),
  },
  'device-types': {
    create: z.object({ name, sort: z.number().int().default(100) }),
    update: z.object({ name: name.optional(), sort: z.number().int().optional(), active: z.boolean().optional() }),
  },
  'device-actions': {
    create: z.object({ name, kind: z.enum(['install', 'configure', 'replace', 'dismantle', 'check', 'other']).default('other'), sort: z.number().int().default(100) }),
    update: z.object({ name: name.optional(), kind: z.enum(['install', 'configure', 'replace', 'dismantle', 'check', 'other']).optional(), sort: z.number().int().optional(), active: z.boolean().optional() }),
  },
} as const;

export type Entity = keyof typeof S;
export const ENTITIES = Object.keys(S) as Entity[];

function checkRights(user: CurrentUser, entity: Entity) {
  const ok = entity === 'cities' || entity === 'objects' ? can.editCitiesObjects(user) : can.editAllDicts(user);
  if (!ok) throw forbidden();
}

function uniqueErr(e: unknown, msg: string): never {
  const code = (e as { code?: string })?.code ?? (e as { cause?: { code?: string } })?.cause?.code;
  if (code === '23505') throw conflict(msg);
  throw e;
}

export async function createEntity(user: CurrentUser, entity: Entity, raw: unknown) {
  checkRights(user, entity);
  try {
    switch (entity) {
      case 'cities': {
        const d = S.cities.create.parse(raw);
        const [r] = await db.insert(cities).values({ name: cleanText(d.name, 100), nameKey: norm(d.name), code: d.code }).returning();
        return r;
      }
      case 'objects': {
        const d = S.objects.create.parse(raw);
        const [r] = await db.insert(objects).values({
          name: cleanText(d.name, 300), nameKey: norm(d.name), cityId: d.cityId ?? null, address: cleanText(d.address, 2000),
          lat: d.lat ?? null, lng: d.lng ?? null,
        }).returning();
        return r;
      }
      case 'employees': {
        const d = S.employees.create.parse(raw);
        const [r] = await db.insert(employees).values({ ...d, fullName: cleanText(d.fullName, 200) }).returning();
        return r;
      }
      case 'priorities': {
        const d = S.priorities.create.parse(raw);
        return db.transaction(async tx => {
          if (d.isDefault) await tx.update(priorities).set({ isDefault: false });
          const [r] = await tx.insert(priorities).values(d).returning();
          return r;
        });
      }
      case 'device-types': {
        const d = S['device-types'].create.parse(raw);
        const [r] = await db.insert(deviceTypes).values(d).returning();
        return r;
      }
      case 'device-actions': {
        const d = S['device-actions'].create.parse(raw);
        const [r] = await db.insert(deviceActions).values(d).returning();
        return r;
      }
    }
  } catch (e) {
    uniqueErr(e, 'Такая запись уже есть (название, код или почта должны быть уникальны)');
  }
}

export async function updateEntity(user: CurrentUser, entity: Entity, id: number, raw: unknown) {
  checkRights(user, entity);
  try {
    switch (entity) {
      case 'cities': {
        const d = S.cities.update.parse(raw);
        const [c] = await db.select().from(cities).where(eq(cities.id, id));
        if (!c) throw notFound();
        if (d.code && d.code !== c.code) {
          const [{ n }] = await db.select({ n: sql<number>`count(*)::int` }).from(tickets).where(eq(tickets.cityId, id));
          if (n > 0 || c.lastNumber > 0) throw badRequest('Код города нельзя менять: по городу уже есть заявки');
        }
        await db.update(cities).set({
          ...(d.name ? { name: cleanText(d.name, 100), nameKey: norm(d.name) } : {}),
          ...(d.code ? { code: d.code } : {}),
          ...(d.active !== undefined ? { active: d.active } : {}),
        }).where(eq(cities.id, id));
        return { ok: true };
      }
      case 'objects': {
        const d = S.objects.update.parse(raw);
        await db.update(objects).set({
          ...(d.name ? { name: cleanText(d.name, 300), nameKey: norm(d.name) } : {}),
          ...(d.cityId !== undefined ? { cityId: d.cityId } : {}),
          ...(d.address !== undefined ? { address: cleanText(d.address, 2000) } : {}),
          ...(d.lat !== undefined ? { lat: d.lat } : {}),
          ...(d.lng !== undefined ? { lng: d.lng } : {}),
          ...(d.active !== undefined ? { active: d.active } : {}),
        }).where(eq(objects.id, id));
        return { ok: true };
      }
      case 'employees': {
        const d = S.employees.update.parse(raw);
        if (id === user.id && (d.active === false || (d.role && d.role !== 'manager'))) {
          throw badRequest('Нельзя отключить себя или снять с себя роль руководителя');
        }
        await db.transaction(async tx => {
          await tx.update(employees).set({ ...d, ...(d.fullName ? { fullName: cleanText(d.fullName, 200) } : {}) }).where(eq(employees.id, id));
          // уволенный сотрудник сразу теряет доступ
          if (d.active === false || d.email) await tx.delete(sessions).where(eq(sessions.employeeId, id));
        });
        return { ok: true };
      }
      case 'priorities': {
        const d = S.priorities.update.parse(raw);
        await db.transaction(async tx => {
          if (d.isDefault) await tx.update(priorities).set({ isDefault: false }).where(ne(priorities.id, id));
          await tx.update(priorities).set(d).where(eq(priorities.id, id));
        });
        return { ok: true };
      }
      case 'device-types': {
        await db.update(deviceTypes).set(S['device-types'].update.parse(raw)).where(eq(deviceTypes.id, id));
        return { ok: true };
      }
      case 'device-actions': {
        await db.update(deviceActions).set(S['device-actions'].update.parse(raw)).where(eq(deviceActions.id, id));
        return { ok: true };
      }
    }
  } catch (e) {
    uniqueErr(e, 'Такая запись уже есть (название, код или почта должны быть уникальны)');
  }
}

/* ---------- настройки ---------- */

export async function setDistanceThreshold(user: CurrentUser, meters: number) {
  if (!can.editAllDicts(user)) throw forbidden();
  if (!Number.isFinite(meters) || meters < 10 || meters > 100000) throw badRequest('Порог от 10 до 100000 м');
  await db.insert(settings).values({ key: 'distance_threshold_m', value: Math.round(meters) })
    .onConflictDoUpdate({ target: settings.key, set: { value: Math.round(meters) } });
  return { ok: true };
}

/* ---------- массовая загрузка из Excel ---------- */

function cellText(v: ExcelJS.CellValue): string {
  if (v == null) return '';
  if (typeof v === 'object') {
    if ('text' in v && typeof v.text === 'string') return v.text;
    if ('richText' in v) return v.richText.map(r => r.text).join('');
    if ('result' in v) return String(v.result ?? '');
    if (v instanceof Date) return v.toISOString();
  }
  return String(v);
}

async function readSheet(buf: Buffer) {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buf as unknown as ArrayBuffer);
  const ws = wb.worksheets[0];
  if (!ws) throw badRequest('В файле нет листов');
  const header: string[] = [];
  ws.getRow(1).eachCell((c, i) => { header[i] = norm(cellText(c.value)); });
  const rows: Record<string, string>[] = [];
  ws.eachRow((row, i) => {
    if (i === 1) return;
    const o: Record<string, string> = {};
    row.eachCell((c, j) => { if (header[j]) o[header[j]] = cellText(c.value).trim(); });
    if (Object.values(o).some(Boolean)) rows.push(o);
  });
  return rows;
}

const pick = (o: Record<string, string>, ...keys: string[]) => {
  for (const k of keys) if (o[norm(k)]) return o[norm(k)];
  return '';
};

// Объекты: столбцы «Объект» (или «Название»), «Город», «Адрес», «Широта», «Долгота».
// Существующие (по названию) обновляются: заполняются адрес и координаты, если в файле они есть.
export async function importObjects(user: CurrentUser, buf: Buffer) {
  if (!can.editCitiesObjects(user)) throw forbidden();
  const rows = await readSheet(buf);
  const cityRows = await db.select().from(cities);
  const cityByKey = new Map(cityRows.map(c => [c.nameKey, c.id]));
  let created = 0, updated = 0;
  const errors: string[] = [];
  await db.transaction(async tx => {
    for (const [i, r] of rows.entries()) {
      const n = pick(r, 'Объект', 'Название');
      if (!n) { errors.push(`Строка ${i + 2}: нет названия объекта`); continue; }
      const cityName = pick(r, 'Город');
      const cityId = cityName ? cityByKey.get(norm(cityName)) ?? null : null;
      if (cityName && !cityId) errors.push(`Строка ${i + 2}: город «${cityName}» не найден — объект загружен без города`);
      const address = cleanText(pick(r, 'Адрес'), 2000);
      const lat = Number(pick(r, 'Широта').replace(',', '.')) || null;
      const lng = Number(pick(r, 'Долгота').replace(',', '.')) || null;
      const [ex] = await tx.select().from(objects).where(eq(objects.nameKey, norm(n)));
      if (ex) {
        await tx.update(objects).set({
          ...(address ? { address } : {}), ...(cityId ? { cityId } : {}),
          ...(lat && lng ? { lat, lng } : {}),
        }).where(eq(objects.id, ex.id));
        updated++;
      } else {
        await tx.insert(objects).values({ name: cleanText(n, 300), nameKey: norm(n), cityId, address, lat: lat && lng ? lat : null, lng: lat && lng ? lng : null });
        created++;
      }
    }
  });
  return { created, updated, errors };
}

const ROLE_BY_NAME: Record<string, 'field' | 'dispatcher' | 'manager'> = {
  'выездной сотрудник': 'field', 'выездной': 'field', 'сотрудник': 'field', field: 'field',
  'диспетчер': 'dispatcher', dispatcher: 'dispatcher',
  'руководитель': 'manager', 'администратор': 'manager', 'руководитель администратор': 'manager', manager: 'manager',
};

// Сотрудники: «Почта», «ФИО», «Роль», «Телефон». Существующие (по почте) обновляются.
export async function importEmployees(user: CurrentUser, buf: Buffer) {
  if (!can.editAllDicts(user)) throw forbidden();
  const rows = await readSheet(buf);
  let created = 0, updated = 0;
  const errors: string[] = [];
  await db.transaction(async tx => {
    for (const [i, r] of rows.entries()) {
      const email = pick(r, 'Почта', 'Email', 'E-mail').toLowerCase();
      const fullName = cleanText(pick(r, 'ФИО', 'Сотрудник'), 200);
      if (!z.email().safeParse(email).success) { errors.push(`Строка ${i + 2}: неверная почта «${email}»`); continue; }
      if (!fullName) { errors.push(`Строка ${i + 2}: нет ФИО`); continue; }
      const roleName = norm(pick(r, 'Роль'));
      const role = roleName ? ROLE_BY_NAME[roleName] : 'field';
      if (!role) { errors.push(`Строка ${i + 2}: неизвестная роль «${pick(r, 'Роль')}»`); continue; }
      const phone = cleanText(pick(r, 'Телефон'), 50);
      const [ex] = await tx.select().from(employees).where(eq(employees.email, email));
      if (ex) {
        if (ex.id === user.id && role !== 'manager') { errors.push(`Строка ${i + 2}: свою роль понизить нельзя`); continue; }
        await tx.update(employees).set({ fullName, role, ...(phone ? { phone } : {}) }).where(eq(employees.id, ex.id));
        updated++;
      } else {
        await tx.insert(employees).values({ email, fullName, role, phone });
        created++;
      }
    }
  });
  return { created, updated, errors };
}

export async function cityHasTickets(cityId: number) {
  const [r] = await db.select({ id: tickets.id }).from(tickets).where(and(eq(tickets.cityId, cityId))).limit(1);
  return !!r;
}

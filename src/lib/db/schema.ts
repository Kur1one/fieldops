import { sql } from 'drizzle-orm';
import {
  bigint, bigserial, boolean, check, date, doublePrecision, index, integer, jsonb, pgEnum, pgTable,
  serial, text, timestamp, uniqueIndex, uuid,
} from 'drizzle-orm/pg-core';

const ts = (name: string) => timestamp(name, { withTimezone: true, mode: 'date' });

export const roleEnum = pgEnum('role', ['field', 'dispatcher', 'manager']);
export const ticketStatusEnum = pgEnum('ticket_status', ['new', 'assigned', 'in_progress', 'revisit', 'done', 'cancelled']);
export const workStatusEnum = pgEnum('work_status', ['full', 'partial', 'revisit']);
export const actionKindEnum = pgEnum('action_kind', ['install', 'configure', 'replace', 'dismantle', 'check', 'other']);
export const eventTypeEnum = pgEnum('event_type', ['created', 'assigned', 'status', 'report', 'comment', 'edited']);
export const fileKindEnum = pgEnum('file_kind', ['photo_before', 'photo_after', 'video', 'attachment']);
export const fileStatusEnum = pgEnum('file_status', ['uploading', 'done']);

/* ---------- справочники ---------- */

export const cities = pgTable('cities', {
  id: serial('id').primaryKey(),
  name: text('name').notNull(),
  nameKey: text('name_key').notNull(),
  code: text('code').notNull(),
  lastNumber: integer('last_number').notNull().default(0),
  active: boolean('active').notNull().default(true),
  createdAt: ts('created_at').notNull().defaultNow(),
}, t => [
  uniqueIndex('cities_name_key_uq').on(t.nameKey),
  uniqueIndex('cities_code_uq').on(t.code),
  check('cities_code_format', sql`${t.code} ~ '^[A-Z]{3}$'`),
]);

export const objects = pgTable('objects', {
  id: serial('id').primaryKey(),
  name: text('name').notNull(),
  nameKey: text('name_key').notNull(),
  cityId: integer('city_id').references(() => cities.id),
  address: text('address').notNull().default(''),
  lat: doublePrecision('lat'),
  lng: doublePrecision('lng'),
  active: boolean('active').notNull().default(true),
  createdAt: ts('created_at').notNull().defaultNow(),
}, t => [uniqueIndex('objects_name_key_uq').on(t.nameKey)]);

export const employees = pgTable('employees', {
  id: serial('id').primaryKey(),
  email: text('email').notNull(),
  fullName: text('full_name').notNull(),
  role: roleEnum('role').notNull().default('field'),
  phone: text('phone').notNull().default(''),
  active: boolean('active').notNull().default(true),
  createdAt: ts('created_at').notNull().defaultNow(),
}, t => [uniqueIndex('employees_email_uq').on(t.email)]);

export const sessions = pgTable('sessions', {
  id: text('id').primaryKey(), // sha256 от токена в cookie
  employeeId: integer('employee_id').notNull().references(() => employees.id),
  expiresAt: ts('expires_at').notNull(),
  createdAt: ts('created_at').notNull().defaultNow(),
}, t => [index('sessions_employee_idx').on(t.employeeId)]);

export const priorities = pgTable('priorities', {
  id: serial('id').primaryKey(),
  name: text('name').notNull(),
  rank: integer('rank').notNull(), // меньше — важнее; 1 = аварийный
  isDefault: boolean('is_default').notNull().default(false),
  active: boolean('active').notNull().default(true),
}, t => [uniqueIndex('priorities_name_uq').on(t.name)]);

export const deviceTypes = pgTable('device_types', {
  id: serial('id').primaryKey(),
  name: text('name').notNull(),
  sort: integer('sort').notNull().default(100),
  active: boolean('active').notNull().default(true),
}, t => [uniqueIndex('device_types_name_uq').on(t.name)]);

export const deviceActions = pgTable('device_actions', {
  id: serial('id').primaryKey(),
  name: text('name').notNull(),
  kind: actionKindEnum('kind').notNull().default('other'),
  sort: integer('sort').notNull().default(100),
  active: boolean('active').notNull().default(true),
}, t => [uniqueIndex('device_actions_name_uq').on(t.name)]);

export const settings = pgTable('settings', {
  key: text('key').primaryKey(),
  value: jsonb('value').notNull(),
});

/* ---------- заявки ---------- */

export const tickets = pgTable('tickets', {
  id: serial('id').primaryKey(),
  number: text('number').notNull(),
  cityId: integer('city_id').notNull().references(() => cities.id),
  objectId: integer('object_id').notNull().references(() => objects.id),
  address: text('address').notNull(),
  description: text('description').notNull(),
  priorityId: integer('priority_id').notNull().references(() => priorities.id),
  assigneeId: integer('assignee_id').references(() => employees.id),
  plannedDate: date('planned_date', { mode: 'string' }),
  contact: text('contact').notNull().default(''),
  note: text('note').notNull().default(''),
  status: ticketStatusEnum('status').notNull().default('new'),
  isUnplanned: boolean('is_unplanned').notNull().default(false),
  authorId: integer('author_id').notNull().references(() => employees.id),
  createdAt: ts('created_at').notNull().defaultNow(),
  lastVisitAt: ts('last_visit_at'),
  closedAt: ts('closed_at'),
  cancelReason: text('cancel_reason'),
  reportCount: integer('report_count').notNull().default(0),
  totalMinutes: integer('total_minutes').notNull().default(0),
}, t => [
  uniqueIndex('tickets_number_uq').on(t.number),
  index('tickets_status_idx').on(t.status),
  index('tickets_assignee_idx').on(t.assigneeId),
  index('tickets_object_idx').on(t.objectId),
]);

export const ticketEvents = pgTable('ticket_events', {
  id: bigserial('id', { mode: 'number' }).primaryKey(),
  ticketId: integer('ticket_id').notNull().references(() => tickets.id),
  at: ts('at').notNull().defaultNow(),
  authorId: integer('author_id').references(() => employees.id), // null = система
  type: eventTypeEnum('type').notNull(),
  fromValue: text('from_value'),
  toValue: text('to_value'),
  text: text('text'),
  reportId: text('report_id'),
}, t => [index('ticket_events_ticket_idx').on(t.ticketId, t.at)]);

/* ---------- отчёты ---------- */

export const reports = pgTable('reports', {
  id: text('id').primaryKey(), // генерируется на устройстве при открытии формы
  ticketId: integer('ticket_id').notNull().references(() => tickets.id),
  employeeId: integer('employee_id').notNull().references(() => employees.id),
  // снимки значений на момент отправки
  employeeEmail: text('employee_email').notNull(),
  employeeName: text('employee_name').notNull(),
  cityId: integer('city_id').notNull().references(() => cities.id),
  cityName: text('city_name').notNull(),
  objectId: integer('object_id').notNull().references(() => objects.id),
  objectName: text('object_name').notNull(),
  address: text('address').notNull(),

  arrivalAt: ts('arrival_at').notNull(),
  arrivalLat: doublePrecision('arrival_lat'),
  arrivalLng: doublePrecision('arrival_lng'),
  arrivalAcc: integer('arrival_acc'),
  arrivalGeoError: text('arrival_geo_error'),
  arrivalDistanceM: integer('arrival_distance_m'),
  finishAt: ts('finish_at').notNull(),
  finishLat: doublePrecision('finish_lat'),
  finishLng: doublePrecision('finish_lng'),
  finishAcc: integer('finish_acc'),
  finishGeoError: text('finish_geo_error'),
  finishDistanceM: integer('finish_distance_m'),
  durationMinutes: integer('duration_minutes').notNull(),

  task: text('task').notNull(),
  workReport: text('work_report').notNull(),
  materials: text('materials').notNull().default(''),
  workStatus: workStatusEnum('work_status').notNull(),
  customerRep: text('customer_rep').notNull().default(''),
  comment: text('comment').notNull().default(''),

  submittedAt: ts('submitted_at').notNull().defaultNow(),
  clientSentAt: ts('client_sent_at'),
  needsReview: boolean('needs_review').notNull().default(false),
  reviewReasons: text('review_reasons').array().notNull().default(sql`'{}'::text[]`),
}, t => [
  index('reports_ticket_idx').on(t.ticketId),
  index('reports_employee_idx').on(t.employeeId),
]);

export const reportComments = pgTable('report_comments', {
  id: serial('id').primaryKey(),
  reportId: text('report_id').notNull().references(() => reports.id),
  authorId: integer('author_id').notNull().references(() => employees.id),
  text: text('text').notNull(),
  createdAt: ts('created_at').notNull().defaultNow(),
}, t => [index('report_comments_report_idx').on(t.reportId)]);

export const reportDevices = pgTable('report_devices', {
  id: serial('id').primaryKey(),
  reportId: text('report_id').notNull().references(() => reports.id),
  position: integer('position').notNull(),
  typeName: text('type_name').notNull(),
  actionName: text('action_name').notNull().default(''),
  actionKind: actionKindEnum('action_kind'),
  ip: text('ip').notNull(),
  model: text('model').notNull().default(''),
  mac: text('mac').notNull().default(''),
  serial: text('serial').notNull().default(''),
  place: text('place').notNull().default(''),
  oldIp: text('old_ip').notNull().default(''),
  oldModel: text('old_model').notNull().default(''),
  oldMac: text('old_mac').notNull().default(''),
  oldSerial: text('old_serial').notNull().default(''),
}, t => [
  index('report_devices_report_idx').on(t.reportId),
  index('report_devices_ip_idx').on(t.ip),
  index('report_devices_old_ip_idx').on(t.oldIp),
]);

/* ---------- файлы ---------- */

export const files = pgTable('files', {
  id: uuid('id').primaryKey(), // генерируется на устройстве при выборе файла
  // ключ владельца до привязки: ID отчёта или ключ черновика заявки
  ownerKey: text('owner_key').notNull(),
  reportId: text('report_id').references(() => reports.id),
  ticketId: integer('ticket_id').references(() => tickets.id),
  kind: fileKindEnum('kind').notNull(),
  seq: integer('seq').notNull(),
  originalName: text('original_name').notNull(),
  storedName: text('stored_name').notNull(),
  mime: text('mime').notNull(),
  size: bigint('size', { mode: 'number' }).notNull(),
  storageKey: text('storage_key').notNull(),
  thumbKey: text('thumb_key'),
  takenAt: ts('taken_at'),
  status: fileStatusEnum('status').notNull().default('uploading'),
  uploadId: text('upload_id'),
  parts: jsonb('parts').$type<{ n: number; etag: string; size: number }[]>().notNull().default([]),
  uploadedBy: integer('uploaded_by').notNull().references(() => employees.id),
  createdAt: ts('created_at').notNull().defaultNow(),
  completedAt: ts('completed_at'),
}, t => [
  index('files_owner_idx').on(t.ownerKey),
  index('files_report_idx').on(t.reportId),
  index('files_ticket_idx').on(t.ticketId),
]);

/* ---------- реестр устройств объекта ---------- */

export const objectDevices = pgTable('object_devices', {
  id: serial('id').primaryKey(),
  objectId: integer('object_id').notNull().references(() => objects.id),
  ip: text('ip').notNull(),
  typeName: text('type_name').notNull(),
  model: text('model').notNull().default(''),
  mac: text('mac').notNull().default(''),
  serial: text('serial').notNull().default(''),
  place: text('place').notNull().default(''),
  active: boolean('active').notNull().default(true),
  firstSeenAt: ts('first_seen_at').notNull(),
  lastSeenAt: ts('last_seen_at').notNull(),
  removedAt: ts('removed_at'),
  lastReportId: text('last_report_id').references(() => reports.id),
}, t => [
  uniqueIndex('object_devices_active_ip_uq').on(t.objectId, t.ip).where(sql`${t.active}`),
  index('object_devices_ip_idx').on(t.ip),
]);

export const deviceEvents = pgTable('device_events', {
  id: bigserial('id', { mode: 'number' }).primaryKey(),
  objectId: integer('object_id').notNull().references(() => objects.id),
  objectDeviceId: integer('object_device_id').references(() => objectDevices.id),
  ip: text('ip').notNull(),
  kind: actionKindEnum('kind').notNull(),
  actionName: text('action_name').notNull(),
  reportId: text('report_id').notNull().references(() => reports.id),
  ticketId: integer('ticket_id').notNull().references(() => tickets.id),
  employeeId: integer('employee_id').notNull().references(() => employees.id),
  at: ts('at').notNull(),
  details: jsonb('details').$type<Record<string, string>>().notNull().default({}),
}, t => [
  index('device_events_object_idx').on(t.objectId, t.at),
  index('device_events_ip_idx').on(t.ip),
]);

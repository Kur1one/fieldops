// Общие для клиента и сервера константы и подписи.

export type Role = 'field' | 'dispatcher' | 'manager';
export type TicketStatus = 'new' | 'assigned' | 'in_progress' | 'revisit' | 'done' | 'cancelled';
export type WorkStatus = 'full' | 'partial' | 'revisit';
export type ActionKind = 'install' | 'configure' | 'replace' | 'dismantle' | 'check' | 'other';
export type FileKind = 'photo_before' | 'photo_after' | 'video' | 'attachment';

export const ROLE_LABEL: Record<Role, string> = {
  field: 'Выездной сотрудник',
  dispatcher: 'Диспетчер',
  manager: 'Руководитель / администратор',
};

export const TICKET_STATUSES: TicketStatus[] = ['new', 'assigned', 'in_progress', 'revisit', 'done', 'cancelled'];
export const OPEN_STATUSES: TicketStatus[] = ['new', 'assigned', 'in_progress', 'revisit'];
export const CLOSED_STATUSES: TicketStatus[] = ['done', 'cancelled'];

export const STATUS_LABEL: Record<TicketStatus, string> = {
  new: 'Новая',
  assigned: 'Назначена',
  in_progress: 'В работе',
  revisit: 'Повторный выезд',
  done: 'Выполнена',
  cancelled: 'Отменена',
};

export const WORK_STATUSES: WorkStatus[] = ['full', 'partial', 'revisit'];
export const WORK_STATUS_LABEL: Record<WorkStatus, string> = {
  full: 'Выполнено полностью',
  partial: 'Выполнено частично',
  revisit: 'Требуется повторный выезд',
};

// статус отчёта → статус заявки (раздел 3.1 ТЗ)
export const WORK_TO_TICKET: Record<WorkStatus, TicketStatus> = {
  full: 'done',
  partial: 'in_progress',
  revisit: 'revisit',
};

export const ACTION_KIND_LABEL: Record<ActionKind, string> = {
  install: 'Установка (добавляет в реестр)',
  configure: 'Настройка',
  replace: 'Замена (старое → новое)',
  dismantle: 'Демонтаж (убирает из реестра)',
  check: 'Проверка / диагностика',
  other: 'Другое',
};

export const FILE_KIND_PREFIX: Record<FileKind, string> = {
  photo_before: 'до',
  photo_after: 'после',
  video: 'видео',
  attachment: 'вложение',
};

export const LIMITS = {
  maxDevices: 50,
  maxPhotosPerBlock: 30,
  maxVideos: 5,
  maxVideoBytes: 50 * 1024 * 1024,
  maxTicketAttachments: 10,
  maxAttachmentBytes: 20 * 1024 * 1024,
  ticketDescription: 5000,
  workReport: 10000,
  shortText: 2000,
  longText: 10000,
  chunkBytes: 5 * 1024 * 1024, // минимальный размер части multipart в S3
  clockSkewMinutes: 10,
} as const;

export const DEFAULT_DISTANCE_THRESHOLD_M = 500;

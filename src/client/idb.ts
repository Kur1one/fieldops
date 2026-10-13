// IndexedDB телефона: черновик отчёта, файлы черновика, очередь отправки, копия справочников.
// Модуль без DOM — используется и страницей, и service worker.
import { openDB, type DBSchema, type IDBPDatabase } from 'idb';
import type { FileKind, WorkStatus } from '@/lib/shared/constants';

export type GeoStamp = { time: string; lat?: number | null; lng?: number | null; acc?: number | null; error?: string | null };

export type DraftDevice = {
  key: string; // для React
  type: string; action: string; ip: string; model: string; mac: string; serial: string; place: string;
  oldIp: string; oldModel: string; oldMac: string; oldSerial: string;
};

export type DraftFile = {
  fileId: string; kind: FileKind; seq: number; name: string; mime: string; size: number;
  takenAt: string | null; uploaded: boolean;
};

export type Draft = {
  reportId: string;
  userId: number;
  createdAt: string;
  updatedAt: string;
  ticketNumber: string; // выбранная заявка
  ticketText?: string; // текст в поле поиска заявки
  cityId: number | null;
  cityText: string;
  objectId: number | null;
  objectText: string;
  address: string;
  task: string;
  workReport: string;
  materials: string;
  workStatus: WorkStatus | '';
  customerRep: string;
  comment: string;
  arrival: GeoStamp | null;
  finish: GeoStamp | null;
  devices: DraftDevice[];
  files: DraftFile[];
  seq: Record<'photo_before' | 'photo_after' | 'video', number>;
};

export type OutboxStatus = 'queued' | 'sending' | 'error' | 'sent';
export type OutboxItem = {
  reportId: string;
  userId: number;
  draft: Draft;
  status: OutboxStatus;
  error?: string;
  fatal?: boolean; // ошибка, которую повтор не исправит (нужно поправить отчёт)
  attempts: number;
  queuedAt: string;
  updatedAt: string;
  result?: { ticketNumber: string; objectName: string; ticketStatus: string; duplicate: boolean };
  progress?: { fileIndex: number; fileCount: number; bytes: number; totalBytes: number };
};

type StoredBlob = { fileId: string; blob?: Blob; buf?: ArrayBuffer; type: string };

interface FieldOpsDB extends DBSchema {
  kv: { key: string; value: unknown };
  blobs: { key: string; value: StoredBlob };
  outbox: { key: string; value: OutboxItem };
}

let dbp: Promise<IDBPDatabase<FieldOpsDB>> | null = null;
export function idb() {
  if (!dbp) {
    dbp = openDB<FieldOpsDB>('fieldops', 1, {
      upgrade(db) {
        db.createObjectStore('kv');
        db.createObjectStore('blobs', { keyPath: 'fileId' });
        db.createObjectStore('outbox', { keyPath: 'reportId' });
      },
    });
  }
  return dbp;
}

export async function kvGet<T>(key: string): Promise<T | undefined> {
  return (await (await idb()).get('kv', key)) as T | undefined;
}
export async function kvSet(key: string, value: unknown) {
  await (await idb()).put('kv', value, key);
}
export async function kvDel(key: string) {
  await (await idb()).delete('kv', key);
}

export async function putBlob(fileId: string, blob: Blob) {
  const db = await idb();
  try {
    await db.put('blobs', { fileId, blob, type: blob.type });
  } catch {
    // старые Safari не умеют хранить Blob — храним байты
    await db.put('blobs', { fileId, buf: await blob.arrayBuffer(), type: blob.type });
  }
}
export async function getBlob(fileId: string): Promise<Blob | null> {
  const r = await (await idb()).get('blobs', fileId);
  if (!r) return null;
  return r.blob ?? new Blob([r.buf!], { type: r.type });
}
export async function delBlob(fileId: string) {
  await (await idb()).delete('blobs', fileId);
}

export async function outboxAll(): Promise<OutboxItem[]> {
  return (await idb()).getAll('outbox');
}
export async function outboxGet(reportId: string) {
  return (await idb()).get('outbox', reportId);
}
export async function outboxPut(item: OutboxItem) {
  await (await idb()).put('outbox', item);
}
export async function outboxDel(reportId: string) {
  await (await idb()).delete('outbox', reportId);
}

export const draftKey = (userId: number) => `draft:${userId}`;
export const refsKey = (userId: number) => `refs:${userId}`;
export const LAST_USER_KEY = 'lastUser';

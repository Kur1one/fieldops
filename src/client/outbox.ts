// Очередь отправки отчётов. Работает и на странице, и в service worker (Background Sync):
// отчёт, поставленный в очередь без связи, уходит сам, когда связь появится.
import { WORK_STATUSES } from '@/lib/shared/constants';
import { ApiError, NetworkError, postJson } from './http';
import { delBlob, getBlob, outboxAll, outboxDel, outboxGet, outboxPut, type Draft, type OutboxItem } from './idb';
import { uploadFile } from './uploader';

export const OUTBOX_CHANNEL = 'fieldops-outbox';

function notify() {
  try {
    const ch = new BroadcastChannel(OUTBOX_CHANNEL);
    ch.postMessage({ type: 'changed' });
    ch.close();
  } catch {}
}

export function buildPayload(d: Draft) {
  return {
    reportId: d.reportId,
    ticketNumber: d.ticketNumber.trim() || null,
    cityId: d.cityId,
    objectId: d.objectId,
    objectName: d.objectId ? null : d.objectText.trim(),
    address: d.address,
    arrival: d.arrival,
    finish: d.finish,
    task: d.task,
    workReport: d.workReport,
    materials: d.materials,
    workStatus: (WORK_STATUSES as string[]).includes(d.workStatus) ? d.workStatus : null,
    customerRep: d.customerRep,
    comment: d.comment,
    devices: d.devices.map(x => ({
      type: x.type, action: x.action, ip: x.ip, model: x.model, mac: x.mac, serial: x.serial, place: x.place,
      oldIp: x.oldIp, oldModel: x.oldModel, oldMac: x.oldMac, oldSerial: x.oldSerial,
    })),
    fileIds: d.files.map(f => f.fileId),
    clientSentAt: new Date().toISOString(),
  };
}

async function save(item: OutboxItem, patch: Partial<OutboxItem>) {
  Object.assign(item, patch, { updatedAt: new Date().toISOString() });
  await outboxPut(item);
  notify();
}

type SubmitResult = { reportId: string; ticketNumber: string; objectName: string; ticketStatus: string; duplicate: boolean };

// Отправка одного отчёта: сначала файлы (с докачкой), затем сам отчёт.
async function sendOne(item: OutboxItem): Promise<'sent' | 'stop' | 'next'> {
  await save(item, { status: 'sending', error: undefined, fatal: false });
  const files = item.draft.files;
  const pending = files.filter(f => !f.uploaded);
  const totalBytes = pending.reduce((s, f) => s + f.size, 0);
  let doneBytes = 0;
  let lastSave = 0;
  try {
    for (let i = 0; i < pending.length; i++) {
      const f = pending[i];
      const blob = await getBlob(f.fileId);
      if (!blob) {
        await save(item, { status: 'error', fatal: true, error: `Файл «${f.name}» пропал из памяти телефона — уберите его из отчёта и отправьте снова` });
        return 'next';
      }
      await uploadFile(
        { fileId: f.fileId, ownerKey: item.reportId, kind: f.kind, seq: f.seq, name: f.name, mime: f.mime, size: f.size, takenAt: f.takenAt },
        blob,
        sent => {
          item.progress = { fileIndex: i + 1, fileCount: pending.length, bytes: doneBytes + sent, totalBytes };
          const now = Date.now();
          if (now - lastSave > 400) { lastSave = now; notify(); void outboxPut(item); }
        },
      );
      doneBytes += f.size;
      f.uploaded = true;
      await save(item, {});
    }

    const res = await postJson<SubmitResult>('/api/reports', buildPayload(item.draft));
    await save(item, {
      status: 'sent', error: undefined, progress: undefined,
      result: { ticketNumber: res.ticketNumber, objectName: res.objectName, ticketStatus: res.ticketStatus, duplicate: res.duplicate },
    });
    for (const f of files) await delBlob(f.fileId).catch(() => {});
    return 'sent';
  } catch (e) {
    if (e instanceof NetworkError) {
      await save(item, { status: 'queued', error: 'Нет связи — отчёт уйдёт сам, когда связь появится', attempts: item.attempts + 1 });
      return 'stop';
    }
    if (e instanceof ApiError) {
      if (e.status === 401) {
        await save(item, { status: 'queued', error: 'Нужно заново войти в систему — после входа отчёт уйдёт сам' });
        return 'stop';
      }
      if (e.body.code === 'files_missing' && Array.isArray(e.body.missingFiles)) {
        const missing = new Set(e.body.missingFiles as string[]);
        item.draft.files.forEach(f => { if (missing.has(f.fileId)) f.uploaded = false; });
        await save(item, { status: 'queued', error: 'Догружаю файлы…', attempts: item.attempts + 1 });
        return item.attempts < 3 ? 'next' : 'stop';
      }
      await save(item, { status: 'error', fatal: true, error: e.message, progress: undefined });
      return 'next';
    }
    await save(item, { status: 'queued', error: String((e as Error)?.message ?? e), attempts: item.attempts + 1 });
    return 'stop';
  }
}

let running: Promise<void> | null = null;

async function runQueue() {
  const items = (await outboxAll())
    .filter(i => i.status === 'queued' || i.status === 'sending' || (i.status === 'error' && !i.fatal))
    .sort((a, b) => a.queuedAt.localeCompare(b.queuedAt));
  for (const item of items) {
    const r = await sendOne(item);
    if (r === 'stop') break;
  }
  // отправленные храним неделю для экрана «Отчёт отправлен»
  const weekAgo = new Date(Date.now() - 7 * 864e5).toISOString();
  for (const i of await outboxAll()) if (i.status === 'sent' && i.updatedAt < weekAgo) await outboxDel(i.reportId);
}

// Обработка очереди. Web Locks не дают странице и service worker отправлять одно и то же одновременно.
export function processOutbox(): Promise<void> {
  if (running) return running;
  const locks = (globalThis.navigator as Navigator | undefined)?.locks;
  const job = locks
    ? locks.request('fieldops-outbox', { ifAvailable: true }, async lock => { if (lock) await runQueue(); })
    : runQueue();
  running = Promise.resolve(job).finally(() => { running = null; });
  return running;
}

export async function hasPending(): Promise<boolean> {
  return (await outboxAll()).some(i => i.status === 'queued' || i.status === 'sending');
}

export async function enqueue(draft: Draft) {
  const now = new Date().toISOString();
  const existing = await outboxGet(draft.reportId);
  const item: OutboxItem = existing && existing.status !== 'sent'
    ? { ...existing, draft, status: 'queued', error: undefined, fatal: false, updatedAt: now }
    : { reportId: draft.reportId, userId: draft.userId, draft, status: 'queued', attempts: 0, queuedAt: now, updatedAt: now };
  await outboxPut(item);
  notify();
  // фоновая отправка средствами браузера (Android/Chrome); на iOS — при следующем открытии
  try {
    const sw = navigator.serviceWorker;
    if (!sw?.controller) return item; // ready не наступит без активного service worker
    const reg = await sw.ready;
    await (reg as ServiceWorkerRegistration & { sync?: { register(tag: string): Promise<void> } })?.sync?.register('outbox');
  } catch {}
  return item;
}

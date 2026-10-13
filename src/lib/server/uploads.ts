import 'server-only';
import { and, eq, ne } from 'drizzle-orm';
import sharp from 'sharp';
import { z } from 'zod';
import { db, schema } from '@/lib/db';
import { FILE_KIND_PREFIX, LIMITS, type FileKind } from '@/lib/shared/constants';
import { badRequest, conflict, forbidden, notFound } from './api';
import type { CurrentUser } from './auth';
import { storage, type Part } from './storage';

const { files } = schema;

export const initUploadSchema = z.object({
  fileId: z.uuid(),
  ownerKey: z.string().regex(/^[A-Za-z0-9-]{8,64}$/),
  kind: z.enum(['photo_before', 'photo_after', 'video', 'attachment']),
  seq: z.number().int().min(1).max(999),
  name: z.string().min(1).max(255),
  mime: z.string().max(100),
  size: z.number().int().positive(),
  takenAt: z.iso.datetime({ offset: true }).nullish(),
});

const MAX_SIZE: Record<FileKind, number> = {
  photo_before: 25 * 1024 * 1024,
  photo_after: 25 * 1024 * 1024,
  video: LIMITS.maxVideoBytes,
  attachment: LIMITS.maxAttachmentBytes,
};

function allowedMime(kind: FileKind, mime: string) {
  if (kind === 'video') return mime.startsWith('video/');
  if (kind === 'attachment') return mime.startsWith('image/') || mime === 'application/pdf';
  return mime.startsWith('image/');
}

const EXT: Record<string, string> = {
  'image/jpeg': '.jpg', 'image/png': '.png', 'image/webp': '.webp', 'image/heic': '.heic', 'image/heif': '.heif',
  'video/mp4': '.mp4', 'video/quicktime': '.mov', 'video/webm': '.webm', 'video/3gpp': '.3gp',
  'application/pdf': '.pdf',
};

function extFor(mime: string, name: string) {
  if (EXT[mime]) return EXT[mime];
  const m = /\.[A-Za-z0-9]{2,5}$/.exec(name);
  return m ? m[0].toLowerCase() : '';
}

export function partCount(size: number) {
  return Math.max(1, Math.ceil(size / LIMITS.chunkBytes));
}

function publicState(f: typeof files.$inferSelect) {
  return {
    fileId: f.id,
    status: f.status,
    size: f.size,
    chunkBytes: LIMITS.chunkBytes,
    receivedParts: f.parts.map(p => p.n).sort((a, b) => a - b),
  };
}

async function ownFile(user: CurrentUser, fileId: string) {
  const [f] = await db.select().from(files).where(eq(files.id, fileId));
  if (!f) throw notFound('Загрузка не найдена');
  if (f.uploadedBy !== user.id) throw forbidden();
  return f;
}

export async function initUpload(user: CurrentUser, input: z.infer<typeof initUploadSchema>) {
  const mime = input.mime || 'application/octet-stream';
  if (!allowedMime(input.kind, mime)) throw badRequest(`Недопустимый тип файла: ${mime}`);
  if (input.size > MAX_SIZE[input.kind]) {
    throw badRequest(`Файл «${input.name}» больше допустимого (${Math.round(MAX_SIZE[input.kind] / 1048576)} МБ)`);
  }

  const [existing] = await db.select().from(files).where(eq(files.id, input.fileId));
  if (existing) {
    if (existing.uploadedBy !== user.id) throw forbidden();
    return publicState(existing);
  }
  const [clash] = await db.select({ id: files.id }).from(files).where(and(
    eq(files.ownerKey, input.ownerKey), eq(files.kind, input.kind), eq(files.seq, input.seq), ne(files.id, input.fileId),
  ));
  if (clash) throw conflict('Файл с таким номером уже загружается для этого отчёта');

  const storedName = `${FILE_KIND_PREFIX[input.kind]}_${String(input.seq).padStart(2, '0')}${extFor(mime, input.name)}`;
  const folder = input.kind === 'attachment' ? 'tickets' : 'reports';
  const storageKey = `${folder}/${input.ownerKey}/${storedName}`;
  const uploadId = await storage().createMultipart(storageKey, mime);

  const [row] = await db.insert(files).values({
    id: input.fileId,
    ownerKey: input.ownerKey,
    kind: input.kind,
    seq: input.seq,
    originalName: input.name.slice(0, 255),
    storedName,
    mime,
    size: input.size,
    storageKey,
    takenAt: input.takenAt ? new Date(input.takenAt) : null,
    uploadId,
    uploadedBy: user.id,
  }).onConflictDoNothing().returning();
  if (!row) {
    // параллельная инициализация того же файла
    await storage().abortMultipart(storageKey, uploadId).catch(() => {});
    return publicState(await ownFile(user, input.fileId));
  }
  return publicState(row);
}

export async function getUploadState(user: CurrentUser, fileId: string) {
  return publicState(await ownFile(user, fileId));
}

export async function putPart(user: CurrentUser, fileId: string, n: number, body: Buffer) {
  const f = await ownFile(user, fileId);
  if (f.status === 'done') return publicState(f);
  const total = partCount(f.size);
  if (!Number.isInteger(n) || n < 1 || n > total) throw badRequest('Неверный номер части');
  const expected = n < total ? LIMITS.chunkBytes : f.size - LIMITS.chunkBytes * (total - 1);
  if (body.length !== expected) throw badRequest(`Неверный размер части: ${body.length}, ожидалось ${expected}`);

  const etag = await storage().uploadPart(f.storageKey, f.uploadId!, n, body);
  return db.transaction(async tx => {
    const [cur] = await tx.select().from(files).where(eq(files.id, fileId)).for('update');
    const parts: Part[] = cur.parts.filter(p => p.n !== n).concat({ n, etag, size: body.length });
    const [upd] = await tx.update(files).set({ parts }).where(eq(files.id, fileId)).returning();
    return publicState(upd);
  });
}

export async function completeUpload(user: CurrentUser, fileId: string) {
  const f = await ownFile(user, fileId);
  if (f.status === 'done') return publicState(f);
  const total = partCount(f.size);
  const have = new Set(f.parts.map(p => p.n));
  const missing = Array.from({ length: total }, (_, i) => i + 1).filter(n => !have.has(n));
  if (missing.length) throw conflict('Загружены не все части файла', { missingParts: missing });

  await storage().completeMultipart(f.storageKey, f.uploadId!, f.parts);

  let thumbKey: string | null = null;
  if (f.mime.startsWith('image/')) {
    try {
      const buf = await storage().getBuffer(f.storageKey);
      const thumb = await sharp(buf).rotate().resize(480, 480, { fit: 'inside', withoutEnlargement: true }).jpeg({ quality: 75 }).toBuffer();
      thumbKey = f.storageKey.replace(/(\.[^./]+)?$/, '.thumb.jpg');
      await storage().put(thumbKey, thumb, 'image/jpeg');
    } catch (e) {
      console.warn('Миниатюра не создана', f.id, e);
    }
  }
  const [upd] = await db.update(files)
    .set({ status: 'done', completedAt: new Date(), thumbKey, uploadId: null })
    .where(eq(files.id, fileId)).returning();
  return publicState(upd);
}

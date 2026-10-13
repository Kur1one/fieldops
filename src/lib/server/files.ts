import 'server-only';
import { and, eq } from 'drizzle-orm';
import { db, schema } from '@/lib/db';
import { forbidden, notFound } from './api';
import type { CurrentUser } from './auth';
import { contentDisposition, storage } from './storage';
import { visibleTicketsWhere } from './tickets';

const { files, reports, tickets } = schema;

// Файл доступен тому, кто видит заявку, к которой он относится (или загрузившему, пока файл не привязан).
export async function getAccessibleFile(user: CurrentUser, fileId: string) {
  const [f] = await db.select().from(files).where(eq(files.id, fileId));
  if (!f || f.status !== 'done') throw notFound('Файл не найден');
  let ticketId = f.ticketId;
  if (!ticketId && f.reportId) {
    const [r] = await db.select({ t: reports.ticketId }).from(reports).where(eq(reports.id, f.reportId));
    ticketId = r?.t ?? null;
  }
  if (!ticketId) {
    if (f.uploadedBy !== user.id) throw forbidden();
    return f;
  }
  const [vis] = await db.select({ id: tickets.id }).from(tickets)
    .where(and(eq(tickets.id, ticketId), visibleTicketsWhere(user)));
  if (!vis) throw forbidden();
  return f;
}

export async function fileResponse(f: typeof files.$inferSelect, opts: { thumb: boolean; download: boolean; range: string | null }) {
  const key = opts.thumb && f.thumbKey ? f.thumbKey : f.storageKey;
  const mime = opts.thumb && f.thumbKey ? 'image/jpeg' : f.mime;
  const s = storage();
  const signed = await s.signedUrl(key, { filename: f.storedName, mime, inline: !opts.download });
  if (signed) {
    return new Response(null, { status: 302, headers: { Location: signed, 'Cache-Control': 'private, no-store' } });
  }
  const r = await s.serve(key, opts.range);
  return new Response(r.body, {
    status: r.status,
    headers: {
      ...r.headers,
      'Content-Type': mime,
      'Content-Disposition': contentDisposition(f.storedName, !opts.download),
      'Cache-Control': 'private, max-age=3600',
    },
  });
}

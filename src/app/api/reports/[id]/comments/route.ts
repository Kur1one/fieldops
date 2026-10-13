import { and, eq } from 'drizzle-orm';
import { z } from 'zod';
import { db, schema } from '@/lib/db';
import { api, badRequest, notFound, readJson } from '@/lib/server/api';
import { addEvent } from '@/lib/server/tickets';
import { cleanText } from '@/lib/shared/text';

// Комментарий руководителя к отчёту. Сам отчёт не меняется.
export const POST = api<{ id: string }>(['manager'], async (req, user, { id }) => {
  const { text } = z.object({ text: z.string().max(5000) }).parse(await readJson(req));
  const clean = cleanText(text, 5000);
  if (!clean) throw badRequest('Пустой комментарий');
  const [r] = await db.select({ id: schema.reports.id, ticketId: schema.reports.ticketId }).from(schema.reports)
    .where(and(eq(schema.reports.id, id)));
  if (!r) throw notFound('Отчёт не найден');
  await db.transaction(async tx => {
    await tx.insert(schema.reportComments).values({ reportId: r.id, authorId: user.id, text: clean });
    await addEvent(tx, { ticketId: r.ticketId, authorId: user.id, type: 'comment', reportId: r.id, text: clean });
  });
  return { ok: true };
});

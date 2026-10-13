import { api, readJson } from '@/lib/server/api';
import { createTicket, createTicketSchema } from '@/lib/server/tickets';
import { getTz } from '@/lib/server/tz';

export const POST = api(['dispatcher', 'manager'], async (req, user) => {
  const input = createTicketSchema.parse(await readJson(req));
  const t = await createTicket(user, input, await getTz());
  return { ok: true, number: t.number };
});

import { api, readJson } from '@/lib/server/api';
import { updateTicket, updateTicketSchema } from '@/lib/server/tickets';
import { getTz } from '@/lib/server/tz';

// Назначить исполнителя, плановую дату, приоритет.
export const PATCH = api<{ number: string }>(['dispatcher', 'manager'], async (req, user, { number }) => {
  const input = updateTicketSchema.parse(await readJson(req));
  return updateTicket(user, number, input, await getTz());
});

import { api, readJson } from '@/lib/server/api';
import { changeStatus, statusChangeSchema } from '@/lib/server/tickets';

export const POST = api<{ number: string }>(['dispatcher', 'manager'], async (req, user, { number }) => {
  return changeStatus(user, number, statusChangeSchema.parse(await readJson(req)));
});

import { api, badRequest } from '@/lib/server/api';
import { openTicketsForObject } from '@/lib/server/tickets';

export const GET = api(['dispatcher', 'manager'], async req => {
  const id = Number(req.nextUrl.searchParams.get('objectId'));
  if (!Number.isInteger(id) || id <= 0) throw badRequest('Нет objectId');
  return { tickets: await openTicketsForObject(id) };
});

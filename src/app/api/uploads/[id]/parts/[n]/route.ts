import { api, badRequest } from '@/lib/server/api';
import { putPart } from '@/lib/server/uploads';
import { LIMITS } from '@/lib/shared/constants';

export const PUT = api<{ id: string; n: string }>(null, async (req, user, { id, n }) => {
  const len = Number(req.headers.get('content-length') || 0);
  if (len > LIMITS.chunkBytes + 1024) throw badRequest('Слишком большая часть');
  const body = Buffer.from(await req.arrayBuffer());
  return putPart(user, id, Number(n), body);
});

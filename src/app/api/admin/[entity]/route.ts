import { api, notFound, readJson } from '@/lib/server/api';
import { createEntity, ENTITIES, type Entity } from '@/lib/server/admin';

export const POST = api<{ entity: string }>(['dispatcher', 'manager'], async (req, user, { entity }) => {
  if (!ENTITIES.includes(entity as Entity)) throw notFound();
  return { ok: true, item: await createEntity(user, entity as Entity, await readJson(req)) };
});

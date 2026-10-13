import { api, notFound, readJson } from '@/lib/server/api';
import { ENTITIES, updateEntity, type Entity } from '@/lib/server/admin';

export const PATCH = api<{ entity: string; id: string }>(['dispatcher', 'manager'], async (req, user, { entity, id }) => {
  if (!ENTITIES.includes(entity as Entity) || !/^\d+$/.test(id)) throw notFound();
  return updateEntity(user, entity as Entity, Number(id), await readJson(req));
});

import { and, desc, eq } from 'drizzle-orm';
import { db, schema } from '@/lib/db';
import { api } from '@/lib/server/api';

// Текущий состав устройств объекта — для предупреждения о занятом IP в форме отчёта.
export const GET = api<{ id: string }>(null, async (_req, _user, { id }) => {
  const objectId = Number(id);
  const rows = await db.select({
    ip: schema.objectDevices.ip, typeName: schema.objectDevices.typeName, model: schema.objectDevices.model,
    place: schema.objectDevices.place,
  }).from(schema.objectDevices)
    .where(and(eq(schema.objectDevices.objectId, objectId), eq(schema.objectDevices.active, true)))
    .orderBy(desc(schema.objectDevices.lastSeenAt));
  return { objectId, devices: rows };
});

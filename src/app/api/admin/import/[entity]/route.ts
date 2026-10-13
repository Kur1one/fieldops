import { api, badRequest, notFound } from '@/lib/server/api';
import { importEmployees, importObjects } from '@/lib/server/admin';

export const POST = api<{ entity: string }>(['dispatcher', 'manager'], async (req, user, { entity }) => {
  const form = await req.formData();
  const file = form.get('file');
  if (!(file instanceof File)) throw badRequest('Выберите файл Excel (.xlsx)');
  if (file.size > 10 * 1024 * 1024) throw badRequest('Файл больше 10 МБ');
  const buf = Buffer.from(await file.arrayBuffer());
  if (entity === 'objects') return importObjects(user, buf);
  if (entity === 'employees') return importEmployees(user, buf);
  throw notFound();
});

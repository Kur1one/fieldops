import { api, notFound } from '@/lib/server/api';
import { fileResponse, getAccessibleFile } from '@/lib/server/files';

// Файлы отдаются только вошедшим пользователям с доступом к заявке.
export const GET = api<{ id: string }>(null, async (req, user, { id }) => {
  if (!/^[0-9a-f-]{36}$/i.test(id)) throw notFound();
  const f = await getAccessibleFile(user, id);
  const sp = req.nextUrl.searchParams;
  return fileResponse(f, { thumb: sp.get('thumb') === '1', download: sp.get('download') === '1', range: req.headers.get('range') });
});

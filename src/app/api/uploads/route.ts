import { api, readJson } from '@/lib/server/api';
import { initUpload, initUploadSchema } from '@/lib/server/uploads';

export const POST = api(null, async (req, user) => initUpload(user, initUploadSchema.parse(await readJson(req))));

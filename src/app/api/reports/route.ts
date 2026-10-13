import { api, readJson } from '@/lib/server/api';
import { reportSchema, submitReport } from '@/lib/server/reports';

export const POST = api(null, async (req, user) => submitReport(user, reportSchema.parse(await readJson(req))));

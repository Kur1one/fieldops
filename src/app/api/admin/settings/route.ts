import { z } from 'zod';
import { api, readJson } from '@/lib/server/api';
import { setDistanceThreshold } from '@/lib/server/admin';

export const PUT = api(['manager'], async (req, user) => {
  const { distanceThresholdM } = z.object({ distanceThresholdM: z.number() }).parse(await readJson(req));
  return setDistanceThreshold(user, distanceThresholdM);
});

import { api } from '@/lib/server/api';
import { getUploadState } from '@/lib/server/uploads';

export const GET = api<{ id: string }>(null, async (_req, user, { id }) => getUploadState(user, id));

import { api } from '@/lib/server/api';
import { completeUpload } from '@/lib/server/uploads';

export const POST = api<{ id: string }>(null, async (_req, user, { id }) => completeUpload(user, id));

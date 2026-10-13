import { api } from '@/lib/server/api';
import { formRefs } from '@/lib/server/queries';

// Справочники и открытые заявки для форм (кэшируются на телефоне для работы без связи).
export const GET = api(null, async (_req, user) => formRefs(user));

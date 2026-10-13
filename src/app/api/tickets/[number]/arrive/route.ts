import { api } from '@/lib/server/api';
import { markArrival } from '@/lib/server/tickets';

// «Я на объекте»: заявка переходит «В работе».
export const POST = api<{ number: string }>(null, async (_req, user, { number }) => markArrival(user, number));

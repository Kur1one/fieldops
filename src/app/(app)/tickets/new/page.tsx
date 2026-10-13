import { requireUser } from '@/lib/server/auth';
import { TicketForm } from './TicketForm';

export const metadata = { title: 'Новая заявка' };

export default async function NewTicketPage() {
  await requireUser(['dispatcher', 'manager']);
  return (
    <main className="mx-auto max-w-4xl px-3 pt-3 pb-10">
      <h1 className="mx-1 mb-3 text-[22px] font-bold">Новая заявка</h1>
      <TicketForm />
    </main>
  );
}

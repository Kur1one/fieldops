import { api, notFound } from '@/lib/server/api';
import { ticketPdf } from '@/lib/server/pdf';
import { ticketCard } from '@/lib/server/queries';
import { getVisibleTicket } from '@/lib/server/tickets';
import { getTz } from '@/lib/server/tz';

export const GET = api<{ number: string }>(null, async (req, user, { number }) => {
  const t = await getVisibleTicket(user, number);
  const card = await ticketCard(t.id);
  if (!card) throw notFound();
  const appUrl = (process.env.APP_URL || req.nextUrl.origin).replace(/\/$/, '');
  const pdf = await ticketPdf(card, await getTz(), appUrl);
  return new Response(new Uint8Array(pdf), {
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="${t.number}.pdf"`,
      'Cache-Control': 'no-store',
    },
  });
});

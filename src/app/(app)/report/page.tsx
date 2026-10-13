import { Suspense } from 'react';
import { requireUser } from '@/lib/server/auth';
import { ReportForm } from './ReportForm';

export const metadata = { title: 'Отчёт о выезде' };

export default async function ReportPage() {
  await requireUser();
  return (
    <main className="mx-auto max-w-xl px-3 pt-3 pb-10">
      <h1 className="mx-1 mb-3 text-[22px] font-bold">Отчёт о выезде</h1>
      <Suspense fallback={<div className="card text-slate-500">Загрузка…</div>}>
        <ReportForm />
      </Suspense>
    </main>
  );
}

import { STATUS_LABEL, WORK_STATUS_LABEL, type TicketStatus, type WorkStatus } from '@/lib/shared/constants';

const STATUS_CLS: Record<TicketStatus, string> = {
  new: 'bg-blue-100 text-blue-800',
  assigned: 'bg-amber-100 text-amber-800',
  in_progress: 'bg-orange-100 text-orange-800',
  revisit: 'bg-rose-100 text-rose-800',
  done: 'bg-green-100 text-green-800',
  cancelled: 'bg-slate-200 text-slate-600',
};

export function StatusBadge({ status }: { status: TicketStatus }) {
  return <span className={`chip ${STATUS_CLS[status]}`}>{STATUS_LABEL[status]}</span>;
}

const WORK_CLS: Record<WorkStatus, string> = {
  full: 'bg-green-100 text-green-800',
  partial: 'bg-orange-100 text-orange-800',
  revisit: 'bg-rose-100 text-rose-800',
};

export function WorkStatusBadge({ status }: { status: WorkStatus }) {
  return <span className={`chip ${WORK_CLS[status]}`}>{WORK_STATUS_LABEL[status]}</span>;
}

export function PriorityBadge({ name, rank }: { name: string; rank: number }) {
  const cls = rank <= 1 ? 'bg-red-600 text-white' : rank === 2 ? 'bg-red-100 text-red-800' : rank === 3 ? 'bg-slate-100 text-slate-700' : 'bg-slate-50 text-slate-500';
  return <span className={`chip ${cls}`}>{name}</span>;
}

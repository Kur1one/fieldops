'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { ApiError, postJson, request } from '@/client/http';
import type { FormRefs } from '@/client/refs';
import { Combo, comboKey } from '@/components/Combo';
import { CLOSED_STATUSES, STATUS_LABEL, TICKET_STATUSES, type TicketStatus } from '@/lib/shared/constants';
import { todayIso } from '@/lib/shared/format';
import { norm } from '@/lib/shared/text';

type Dialog = null | 'assign' | 'status' | 'cancel';

export function TicketActions({ number, status, assigneeId, plannedDate, priorityId }: {
  number: string; status: TicketStatus; assigneeId: number | null; plannedDate: string | null; priorityId: number;
}) {
  const router = useRouter();
  const [dialog, setDialog] = useState<Dialog>(null);
  const [refs, setRefs] = useState<FormRefs | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const [assignee, setAssignee] = useState<number | null>(assigneeId);
  const [assigneeText, setAssigneeText] = useState('');
  const [date, setDate] = useState(plannedDate ?? '');
  const [prio, setPrio] = useState(priorityId);
  const [newStatus, setNewStatus] = useState<TicketStatus>(status);
  const [reason, setReason] = useState('');

  const openDialog = async (d: Dialog) => {
    setError('');
    setDialog(d);
    if (d === 'assign' && !refs) {
      try {
        const r = await request<FormRefs>('/api/refs');
        setRefs(r);
        setAssigneeText(r.employees.find(e => e.id === assigneeId)?.fullName ?? '');
      } catch (e) { setError((e as Error).message); }
    }
    if (d === 'status') setNewStatus(CLOSED_STATUSES.includes(status) ? 'revisit' : status);
  };

  const run = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    setError('');
    try {
      await fn();
      setDialog(null);
      setReason('');
      router.refresh();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Нет связи с сервером');
    } finally {
      setBusy(false);
    }
  };

  const today = todayIso(Intl.DateTimeFormat().resolvedOptions().timeZone);

  return (
    <>
      <button className="btn-secondary" onClick={() => void openDialog('assign')}>Назначить</button>
      <button className="btn-secondary" onClick={() => void openDialog('status')}>
        {CLOSED_STATUSES.includes(status) ? 'Переоткрыть / статус' : 'Изменить статус'}
      </button>
      {status !== 'cancelled' && <button className="btn-danger" onClick={() => void openDialog('cancel')}>Отменить</button>}

      {dialog && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-0 sm:items-center sm:p-4" onClick={() => !busy && setDialog(null)}>
          <div className="w-full max-w-md rounded-t-2xl bg-white p-4 shadow-xl sm:rounded-2xl" onClick={e => e.stopPropagation()}>
            {dialog === 'assign' && (
              <>
                <h3 className="text-lg font-semibold">Исполнитель, дата, приоритет</h3>
                {!refs && !error && <p className="mt-3 text-slate-500">Загрузка…</p>}
                {refs && (
                  <>
                    <div className="label">Исполнитель</div>
                    <Combo
                      items={refs.employees.map(e => ({ id: String(e.id), label: e.fullName, key: comboKey(e.fullName), value: e }))}
                      text={assigneeText}
                      onText={s => { setAssigneeText(s); setAssignee(refs.employees.find(e => norm(e.fullName) === norm(s))?.id ?? null); }}
                      onPick={it => { setAssigneeText(it.value.fullName); setAssignee(it.value.id); }}
                      placeholder="Не назначен"
                    />
                    <label className="block">
                      <span className="label">Плановая дата</span>
                      <input type="date" className="input" min={today} value={date} onChange={e => setDate(e.target.value)} />
                    </label>
                    <label className="block">
                      <span className="label">Приоритет</span>
                      <select className="input" value={prio} onChange={e => setPrio(Number(e.target.value))}>
                        {refs.priorities.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                      </select>
                    </label>
                  </>
                )}
              </>
            )}
            {dialog === 'status' && (
              <>
                <h3 className="text-lg font-semibold">Статус заявки</h3>
                <select className="input mt-3" value={newStatus} onChange={e => setNewStatus(e.target.value as TicketStatus)}>
                  {TICKET_STATUSES.filter(s => s !== 'cancelled').map(s => <option key={s} value={s}>{STATUS_LABEL[s]}</option>)}
                </select>
                <label className="block">
                  <span className="label">Комментарий (необязательно)</span>
                  <textarea className="input" rows={2} value={reason} onChange={e => setReason(e.target.value)} />
                </label>
              </>
            )}
            {dialog === 'cancel' && (
              <>
                <h3 className="text-lg font-semibold">Отменить заявку {number}</h3>
                <label className="block">
                  <span className="label">Причина отмены *</span>
                  <textarea className="input" rows={3} value={reason} onChange={e => setReason(e.target.value)} autoFocus />
                </label>
              </>
            )}
            {error && <p className="err-text mt-3">{error}</p>}
            <div className="mt-4 flex gap-2">
              <button className="btn-ghost flex-1" disabled={busy} onClick={() => setDialog(null)}>Закрыть</button>
              {dialog === 'assign' && (
                <button className="btn-primary flex-1" disabled={busy || !refs || (!!assigneeText.trim() && !assignee)} onClick={() => void run(() =>
                  postJson(`/api/tickets/${number}`, { assigneeId: assigneeText.trim() ? assignee : null, plannedDate: date || null, priorityId: prio }, 'PATCH'))}>
                  Сохранить
                </button>
              )}
              {dialog === 'status' && (
                <button className="btn-primary flex-1" disabled={busy || newStatus === status} onClick={() => void run(() =>
                  postJson(`/api/tickets/${number}/status`, { status: newStatus, reason }))}>
                  Сохранить
                </button>
              )}
              {dialog === 'cancel' && (
                <button className="btn-primary flex-1 bg-red-600 hover:bg-red-700" disabled={busy || !reason.trim()} onClick={() => void run(() =>
                  postJson(`/api/tickets/${number}/status`, { status: 'cancelled', reason }))}>
                  Отменить заявку
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
}

export function CopyIp({ ip }: { ip: string }) {
  const [ok, setOk] = useState(false);
  return (
    <button
      type="button"
      title="Скопировать IP"
      className="ml-1 rounded px-1.5 py-0.5 font-sans text-xs text-brand hover:bg-brand-50"
      onClick={async () => {
        try { await navigator.clipboard.writeText(ip); } catch {
          const t = document.createElement('textarea'); t.value = ip; document.body.appendChild(t); t.select(); document.execCommand('copy'); t.remove();
        }
        setOk(true);
        setTimeout(() => setOk(false), 1500);
      }}
    >
      {ok ? '✓' : 'копировать'}
    </button>
  );
}

export function CommentForm({ reportId }: { reportId: string }) {
  const router = useRouter();
  const [text, setText] = useState('');
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  if (!open) return <button className="link text-sm" onClick={() => setOpen(true)}>+ Комментарий руководителя</button>;
  return (
    <div>
      <textarea className="input" rows={2} value={text} onChange={e => setText(e.target.value)} placeholder="Комментарий к отчёту" autoFocus />
      {err && <p className="err-text">{err}</p>}
      <div className="mt-2 flex gap-2">
        <button className="btn-primary py-1.5 text-sm" disabled={busy || !text.trim()} onClick={async () => {
          setBusy(true);
          try {
            await postJson(`/api/reports/${encodeURIComponent(reportId)}/comments`, { text });
            setText(''); setOpen(false); router.refresh();
          } catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
        }}>Сохранить</button>
        <button className="btn-ghost py-1.5 text-sm" onClick={() => setOpen(false)}>Отмена</button>
      </div>
    </div>
  );
}

'use client';

import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useMemo, useState, useTransition } from 'react';
import { Combo, comboKey } from '@/components/Combo';
import { OPEN_STATUSES, STATUS_LABEL, TICKET_STATUSES, type TicketStatus } from '@/lib/shared/constants';

type Opt = { id: number; name: string };

export function FilterBar({ cities, objects, employees, priorities, showAssignee }: {
  cities: Opt[]; objects: Opt[]; employees: Opt[]; priorities: Opt[]; showAssignee: boolean;
}) {
  const sp = useSearchParams();
  const router = useRouter();
  const path = usePathname();
  const [pending, start] = useTransition();
  const [q, setQ] = useState(sp.get('q') ?? '');
  const [open, setOpen] = useState(false);

  const statuses: TicketStatus[] = useMemo(() => {
    const s = sp.get('status');
    if (s === 'all') return [...TICKET_STATUSES];
    const list = (s ?? '').split(',').filter((x): x is TicketStatus => (TICKET_STATUSES as string[]).includes(x));
    return list.length ? list : [...OPEN_STATUSES];
  }, [sp]);

  const go = (patch: Record<string, string | null>) => {
    const p = new URLSearchParams(sp);
    for (const [k, v] of Object.entries(patch)) { if (v == null || v === '') p.delete(k); else p.set(k, v); }
    p.delete('page');
    start(() => router.push(`${path}?${p.toString()}`));
  };
  const toggleStatus = (s: TicketStatus) => {
    const next = statuses.includes(s) ? statuses.filter(x => x !== s) : [...statuses, s];
    const val = next.length === TICKET_STATUSES.length ? 'all' : next.join(',');
    go({ status: next.length ? val : null });
  };

  const objItems = useMemo(() => objects.map(o => ({ id: String(o.id), label: o.name, key: comboKey(o.name), value: o })), [objects]);
  const objId = sp.get('object');
  const [objText, setObjText] = useState(() => objects.find(o => String(o.id) === objId)?.name ?? '');
  const sel = (name: string, opts: Opt[], label: string, extra?: React.ReactNode) => (
    <label className="block">
      <span className="label mt-0">{label}</span>
      <select className="input py-2" value={sp.get(name) ?? ''} onChange={e => go({ [name]: e.target.value })}>
        <option value="">Все</option>
        {extra}
        {opts.map(o => <option key={o.id} value={o.id}>{o.name}</option>)}
      </select>
    </label>
  );
  const date = (name: string, label: string) => (
    <label className="block">
      <span className="label mt-0">{label}</span>
      <input type="date" className="input py-2" value={sp.get(name) ?? ''} onChange={e => go({ [name]: e.target.value })} />
    </label>
  );
  const activeCount = ['city', 'object', 'assignee', 'priority', 'createdFrom', 'createdTo', 'visitFrom', 'visitTo', 'mine'].filter(k => sp.get(k)).length;

  return (
    <div className={`card p-3 ${pending ? 'opacity-70' : ''}`}>
      <form className="flex gap-2" onSubmit={e => { e.preventDefault(); go({ q }); }}>
        <input className="input py-2" placeholder="Поиск: номер, объект, текст задачи, IP устройства" value={q} onChange={e => setQ(e.target.value)} />
        <button className="btn-primary py-2">Найти</button>
        <button type="button" className="btn-ghost py-2 whitespace-nowrap" onClick={() => setOpen(o => !o)}>
          Фильтры{activeCount ? ` (${activeCount})` : ''}
        </button>
      </form>
      {open && (
        <div className="mt-3 space-y-3">
          <div>
            <span className="label mt-0">Статус</span>
            <div className="flex flex-wrap gap-1.5">
              {TICKET_STATUSES.map(s => (
                <button key={s} type="button" onClick={() => toggleStatus(s)}
                  className={`rounded-lg px-2.5 py-1.5 text-sm ring-1 ${statuses.includes(s) ? 'bg-brand-50 text-brand ring-brand' : 'ring-slate-300'}`}>
                  {STATUS_LABEL[s]}
                </button>
              ))}
              <button type="button" className="link px-2 text-sm" onClick={() => go({ status: 'all' })}>все</button>
              <button type="button" className="link px-2 text-sm" onClick={() => go({ status: null })}>открытые</button>
            </div>
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {sel('city', cities, 'Город')}
            <div>
              <span className="label mt-0">Объект</span>
              <Combo items={objItems} text={objText}
                onText={s => { setObjText(s); if (!s) go({ object: null }); }}
                onPick={it => { setObjText(it.value.name); go({ object: String(it.value.id) }); }}
                placeholder="Все объекты" />
            </div>
            {showAssignee && sel('assignee', employees, 'Исполнитель', <option value="none">— не назначен —</option>)}
            {sel('priority', priorities, 'Приоритет')}
            {date('createdFrom', 'Создана с')}
            {date('createdTo', 'Создана по')}
            {date('visitFrom', 'Выезд с')}
            {date('visitTo', 'Выезд по')}
          </div>
          <div className="flex flex-wrap items-center gap-4">
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" className="h-5 w-5" checked={sp.get('mine') === '1'} onChange={e => go({ mine: e.target.checked ? '1' : null })} />
              Только мои
            </label>
            <button type="button" className="link text-sm" onClick={() => { setQ(''); setObjText(''); start(() => router.push(path)); }}>Сбросить всё</button>
          </div>
        </div>
      )}
    </div>
  );
}

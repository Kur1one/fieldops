'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useMemo, useState } from 'react';
import { ApiError, postJson } from '@/client/http';
import { matchesWords, norm } from '@/lib/shared/text';

export type Col = {
  key: string;
  label: string;
  type?: 'text' | 'number' | 'select' | 'checkbox' | 'readonly';
  options?: { value: string | number | null; label: string }[];
  placeholder?: string;
  editable?: (row: Row) => boolean;
  newDefault?: unknown;
  className?: string;
  hint?: string;
};
export type Row = Record<string, unknown> & { id: number };

// Таблица справочника: правка строки на месте, добавление новой, поиск. Записи не удаляются — деактивируются.
export function EditableTable({ entity, cols, rows, addLabel, search, linkTo, onNewNameChange }: {
  entity: string;
  cols: Col[];
  rows: Row[];
  addLabel?: string;
  search?: boolean;
  linkTo?: (row: Row) => string;
  onNewNameChange?: (name: string, set: (patch: Record<string, unknown>) => void) => void;
}) {
  const router = useRouter();
  const [editing, setEditing] = useState<number | null>(null);
  const [draft, setDraft] = useState<Record<string, unknown>>({});
  const [adding, setAdding] = useState(false);
  const [q, setQ] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);

  const shown = useMemo(() => {
    if (!q.trim()) return rows;
    return rows.filter(r => matchesWords(norm(cols.map(c => String(r[c.key] ?? '')).join(' ')), q));
  }, [rows, q, cols]);

  const startNew = () => {
    setAdding(true);
    setEditing(null);
    setErr('');
    setDraft(Object.fromEntries(cols.filter(c => c.type !== 'readonly').map(c => [c.key, c.newDefault ?? (c.type === 'checkbox' ? true : c.type === 'select' ? c.options?.[0]?.value ?? null : '')])));
  };
  const startEdit = (r: Row) => {
    setEditing(r.id);
    setAdding(false);
    setErr('');
    setDraft({ ...r });
  };
  const payload = (onlyEditable: Row | null) => Object.fromEntries(cols
    .filter(c => c.type !== 'readonly' && (!onlyEditable || !c.editable || c.editable(onlyEditable)))
    .map(c => {
      const v = draft[c.key];
      if (c.type === 'number') return [c.key, v === '' || v == null ? null : Number(v)];
      return [c.key, v];
    }));

  const save = async () => {
    setBusy(true);
    setErr('');
    try {
      if (adding) await postJson(`/api/admin/${entity}`, payload(null));
      else if (editing != null) await postJson(`/api/admin/${entity}/${editing}`, payload(rows.find(r => r.id === editing)!), 'PATCH');
      setAdding(false);
      setEditing(null);
      router.refresh();
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : 'Нет связи с сервером');
    } finally {
      setBusy(false);
    }
  };

  const setField = (k: string, v: unknown) => setDraft(d => ({ ...d, [k]: v }));
  const cell = (c: Col, r: Row | null) => {
    const can = c.type !== 'readonly' && (!r || !c.editable || c.editable(r));
    const v = draft[c.key];
    if (!can) return <span className="text-slate-500">{display(c, r ? r[c.key] : v)}</span>;
    if (c.type === 'checkbox') return <input type="checkbox" className="h-5 w-5" checked={!!v} onChange={e => setField(c.key, e.target.checked)} />;
    if (c.type === 'select') {
      return (
        <select className="input py-1.5" value={v == null ? '' : String(v)} onChange={e => {
          const opt = c.options?.find(o => String(o.value ?? '') === e.target.value);
          setField(c.key, opt ? opt.value : null);
        }}>
          {c.options?.map(o => <option key={String(o.value)} value={o.value == null ? '' : String(o.value)}>{o.label}</option>)}
        </select>
      );
    }
    return (
      <input className="input py-1.5" type={c.type === 'number' ? 'number' : 'text'} placeholder={c.placeholder} value={v == null ? '' : String(v)}
        onChange={e => {
          setField(c.key, e.target.value);
          if (!r && c.key === 'name' && onNewNameChange) onNewNameChange(e.target.value, p => setDraft(d => ({ ...d, ...p })));
        }} />
    );
  };

  return (
    <div>
      <div className="mb-3 flex flex-wrap gap-2">
        {search && <input className="input max-w-sm py-2" placeholder="Поиск" value={q} onChange={e => setQ(e.target.value)} />}
        <button className="btn-primary py-2" onClick={startNew}>+ {addLabel ?? 'Добавить'}</button>
        <span className="self-center text-sm text-slate-500">Записей: {shown.length}</span>
      </div>
      {err && <p className="mb-2 rounded-lg bg-red-50 p-2 text-sm text-red-700">{err}</p>}
      <div className="overflow-x-auto rounded-xl bg-white ring-1 ring-slate-200">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-left text-slate-600">
            <tr>
              {cols.map(c => <th key={c.key} className={`px-2 py-2 font-medium ${c.className ?? ''}`} title={c.hint}>{c.label}</th>)}
              <th className="w-40 px-2 py-2" />
            </tr>
          </thead>
          <tbody>
            {adding && (
              <tr className="bg-brand-50/50">
                {cols.map(c => <td key={c.key} className="px-2 py-1.5">{c.type === 'readonly' ? '' : cell(c, null)}</td>)}
                <td className="px-2 py-1.5 whitespace-nowrap">
                  <button className="btn-primary py-1.5 text-sm" disabled={busy} onClick={() => void save()}>Добавить</button>
                  <button className="btn-ghost py-1.5 text-sm" onClick={() => setAdding(false)}>Отмена</button>
                </td>
              </tr>
            )}
            {shown.slice(0, 1000).map(r => (
              <tr key={r.id} className={`border-t border-slate-100 ${r.active === false ? 'text-slate-400' : ''}`}>
                {cols.map(c => (
                  <td key={c.key} className={`px-2 py-1.5 ${c.className ?? ''}`}>
                    {editing === r.id ? cell(c, r) : c.key === 'name' && linkTo ? <Link className="link" href={linkTo(r)}>{display(c, r[c.key])}</Link> : display(c, r[c.key])}
                  </td>
                ))}
                <td className="px-2 py-1.5 whitespace-nowrap">
                  {editing === r.id ? (
                    <>
                      <button className="btn-primary py-1.5 text-sm" disabled={busy} onClick={() => void save()}>Сохранить</button>
                      <button className="btn-ghost py-1.5 text-sm" onClick={() => setEditing(null)}>Отмена</button>
                    </>
                  ) : (
                    <button className="btn-ghost py-1.5 text-sm" onClick={() => startEdit(r)}>Изменить</button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function display(c: Col, v: unknown) {
  if (c.type === 'checkbox') return v ? 'да' : 'нет';
  if (c.type === 'select') return c.options?.find(o => o.value === v)?.label ?? '—';
  if (v == null || v === '') return '—';
  return String(v);
}

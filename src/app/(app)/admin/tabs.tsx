'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { ApiError, postJson } from '@/client/http';
import { ACTION_KIND_LABEL, ROLE_LABEL, type ActionKind, type Role } from '@/lib/shared/constants';
import { suggestCityCode } from '@/lib/shared/text';
import { EditableTable, type Row } from './EditableTable';

const yes = { type: 'checkbox' as const, newDefault: true };

export function CitiesTab({ rows }: { rows: (Row & { code: string; lastNumber: number })[] }) {
  const used = rows.map(r => r.code);
  return (
    <>
      <p className="mb-3 text-sm text-slate-600">
        Код — 3 латинские заглавные буквы, префикс номера заявки (AST-0001). Код можно поменять, пока по городу нет заявок.
      </p>
      <EditableTable
        entity="cities"
        addLabel="Город"
        rows={rows}
        cols={[
          { key: 'name', label: 'Город', placeholder: 'Семей' },
          { key: 'code', label: 'Код', placeholder: 'SEM', className: 'w-28 font-mono', editable: r => !r.lastNumber },
          { key: 'lastNumber', label: 'Последний №', type: 'readonly', className: 'w-28' },
          { key: 'active', label: 'Активен', ...yes, className: 'w-20' },
        ]}
        onNewNameChange={(name, set) => set({ code: name.trim() ? suggestCityCode(name, used) : '' })}
      />
    </>
  );
}

export function ObjectsTab({ rows, cities }: { rows: Row[]; cities: { id: number; name: string }[] }) {
  return (
    <>
      <ImportBox entity="objects" columns="«Объект», «Город», «Адрес», «Широта», «Долгота»" note="Объекты с тем же названием обновляются (адрес и координаты), новые — добавляются." />
      <EditableTable
        entity="objects"
        addLabel="Объект"
        search
        rows={rows}
        linkTo={r => `/objects/${r.id}`}
        cols={[
          { key: 'name', label: 'Объект' },
          { key: 'cityId', label: 'Город (справочно)', type: 'select', options: [{ value: null, label: '—' }, ...cities.map(c => ({ value: c.id, label: c.name }))], newDefault: null },
          { key: 'address', label: 'Адрес' },
          { key: 'devices', label: 'Устройств', type: 'readonly', className: 'w-24' },
          { key: 'active', label: 'Активен', ...yes, className: 'w-20' },
        ]}
      />
    </>
  );
}

export function EmployeesTab({ rows }: { rows: (Row & { role: Role })[] }) {
  const roles = (Object.keys(ROLE_LABEL) as Role[]).map(r => ({ value: r, label: ROLE_LABEL[r] }));
  return (
    <>
      <p className="mb-3 text-sm text-slate-600">
        Вход — по корпоративной почте из этого списка. Уволенного сотрудника отключите («Активен» — нет): войти он не сможет, его отчёты сохранятся.
      </p>
      <ImportBox entity="employees" columns="«Почта», «ФИО», «Роль», «Телефон»" note="Роль: выездной сотрудник / диспетчер / руководитель. Сотрудники с той же почтой обновляются." />
      <EditableTable
        entity="employees"
        addLabel="Сотрудник"
        search
        rows={rows}
        cols={[
          { key: 'fullName', label: 'ФИО' },
          { key: 'email', label: 'Почта', placeholder: 'name@company.kz' },
          { key: 'role', label: 'Роль', type: 'select', options: roles, newDefault: 'field' },
          { key: 'phone', label: 'Телефон' },
          { key: 'active', label: 'Активен', ...yes, className: 'w-20' },
        ]}
      />
    </>
  );
}

export function DictsTab({ types, actions, priorities, threshold }: {
  types: Row[]; actions: (Row & { kind: ActionKind })[]; priorities: Row[]; threshold: number;
}) {
  const kinds = (Object.keys(ACTION_KIND_LABEL) as ActionKind[]).map(k => ({ value: k, label: ACTION_KIND_LABEL[k] }));
  return (
    <div className="space-y-8">
      <div>
        <h2 className="h2">Типы устройств</h2>
        <EditableTable entity="device-types" addLabel="Тип" rows={types} cols={[
          { key: 'name', label: 'Название' },
          { key: 'sort', label: 'Порядок', type: 'number', newDefault: 100, className: 'w-28' },
          { key: 'active', label: 'Активен', ...yes, className: 'w-20' },
        ]} />
      </div>
      <div>
        <h2 className="h2">Действия с устройством</h2>
        <p className="mb-2 text-sm text-slate-600">Смысл действия определяет, как меняется реестр устройств объекта и показываются ли поля снятого устройства.</p>
        <EditableTable entity="device-actions" addLabel="Действие" rows={actions} cols={[
          { key: 'name', label: 'Название' },
          { key: 'kind', label: 'Смысл', type: 'select', options: kinds, newDefault: 'other' },
          { key: 'sort', label: 'Порядок', type: 'number', newDefault: 100, className: 'w-28' },
          { key: 'active', label: 'Активен', ...yes, className: 'w-20' },
        ]} />
      </div>
      <div>
        <h2 className="h2">Приоритеты</h2>
        <p className="mb-2 text-sm text-slate-600">Ранг 1 — самый важный, такие заявки идут в списке первыми.</p>
        <EditableTable entity="priorities" addLabel="Приоритет" rows={priorities} cols={[
          { key: 'name', label: 'Название' },
          { key: 'rank', label: 'Ранг', type: 'number', newDefault: 5, className: 'w-24' },
          { key: 'isDefault', label: 'По умолчанию', type: 'checkbox', newDefault: false, className: 'w-28' },
          { key: 'active', label: 'Активен', ...yes, className: 'w-20' },
        ]} />
      </div>
      <ThresholdForm value={threshold} />
    </div>
  );
}

function ThresholdForm({ value }: { value: number }) {
  const router = useRouter();
  const [v, setV] = useState(String(value));
  const [msg, setMsg] = useState('');
  return (
    <div>
      <h2 className="h2">Контроль расстояния до объекта</h2>
      <p className="mb-2 text-sm text-slate-600">Если у объекта заданы координаты, а отметка в отчёте дальше порога, отчёт помечается «на проверку».</p>
      <div className="flex max-w-sm gap-2">
        <input className="input" type="number" min={10} value={v} onChange={e => setV(e.target.value)} />
        <span className="self-center">м</span>
        <button className="btn-primary" onClick={async () => {
          try { await postJson('/api/admin/settings', { distanceThresholdM: Number(v) }, 'PUT'); setMsg('Сохранено'); router.refresh(); }
          catch (e) { setMsg((e as Error).message); }
        }}>Сохранить</button>
      </div>
      {msg && <p className="hint">{msg}</p>}
    </div>
  );
}

function ImportBox({ entity, columns, note }: { entity: 'objects' | 'employees'; columns: string; note: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [res, setRes] = useState<{ created: number; updated: number; errors: string[] } | null>(null);
  const [err, setErr] = useState('');
  if (!open) return <button className="link mb-3 block text-sm" onClick={() => setOpen(true)}>Загрузить из Excel…</button>;
  return (
    <div className="mb-4 rounded-lg bg-slate-50 p-3 text-sm">
      <p>Файл .xlsx, первая строка — заголовки: {columns}. {note}</p>
      <input type="file" accept=".xlsx" className="mt-2" disabled={busy} onChange={async e => {
        const file = e.target.files?.[0];
        e.target.value = '';
        if (!file) return;
        setBusy(true); setErr(''); setRes(null);
        const fd = new FormData();
        fd.append('file', file);
        try {
          const r = await fetch(`/api/admin/import/${entity}`, { method: 'POST', body: fd, credentials: 'same-origin' });
          const j = await r.json();
          if (!r.ok) throw new ApiError(r.status, j.error ?? 'Ошибка', j);
          setRes(j);
          router.refresh();
        } catch (e2) { setErr((e2 as Error).message); } finally { setBusy(false); }
      }} />
      {busy && <p className="mt-2">Загружаю…</p>}
      {err && <p className="err-text">{err}</p>}
      {res && (
        <div className="mt-2">
          Добавлено: <b>{res.created}</b>, обновлено: <b>{res.updated}</b>.
          {res.errors.length > 0 && <ul className="mt-1 list-disc pl-5 text-red-700">{res.errors.slice(0, 50).map(x => <li key={x}>{x}</li>)}</ul>}
        </div>
      )}
    </div>
  );
}

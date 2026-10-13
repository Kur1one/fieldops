'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { ApiError, postJson, request } from '@/client/http';
import { newReportId, uuid } from '@/client/ids';
import { compressImage } from '@/client/media';
import { useRefs, type FormRefs } from '@/client/refs';
import { uploadFile } from '@/client/uploader';
import { Combo, comboKey, type ComboItem } from '@/components/Combo';
import { LIMITS, STATUS_LABEL, type TicketStatus } from '@/lib/shared/constants';
import { fmtBytes, todayIso } from '@/lib/shared/format';
import { norm } from '@/lib/shared/text';

type Att = { fileId: string; name: string; size: number; seq: number; state: 'uploading' | 'done' | 'error'; progress: number; error?: string };
type Dup = { number: string; status: TicketStatus; description: string };

const empty = () => ({
  cityId: null as number | null, cityText: '', objectId: null as number | null, objectText: '', address: '', description: '',
  priorityId: null as number | null, assigneeId: null as number | null, assigneeText: '', plannedDate: '', contact: '', note: '',
});

export function TicketForm() {
  const { refs, error: refsError, reload } = useRefs();
  const [f, setF] = useState(empty);
  const [draftKey, setDraftKey] = useState(() => newReportId());
  const [atts, setAtts] = useState<Att[]>([]);
  const [dupState, setDups] = useState<{ objectId: number; list: Dup[] } | null>(null);
  const dups = dupState && dupState.objectId === f.objectId ? dupState.list : [];
  const defaultPriority = refs ? (refs.priorities.find(p => p.isDefault) ?? refs.priorities[0])?.id ?? null : null;
  const priorityId = f.priorityId ?? defaultPriority;
  const [errors, setErrors] = useState<string[]>([]);
  const [strict, setStrict] = useState(false);
  const [saving, setSaving] = useState(false);
  const [created, setCreated] = useState<string | null>(null);
  const tz = typeof Intl !== 'undefined' ? Intl.DateTimeFormat().resolvedOptions().timeZone : 'Asia/Almaty';
  const today = todayIso(tz);

  const set = (patch: Partial<ReturnType<typeof empty>>) => setF(x => ({ ...x, ...patch }));

  // предупреждение о дублях: открытые заявки по тому же объекту
  useEffect(() => {
    const objectId = f.objectId;
    if (!objectId) return;
    let cancel = false;
    request<{ tickets: Dup[] }>(`/api/tickets/open-by-object?objectId=${objectId}`)
      .then(r => { if (!cancel) setDups({ objectId, list: r.tickets }); })
      .catch(() => {});
    return () => { cancel = true; };
  }, [f.objectId]);

  const cityItems = useMemo<ComboItem<{ id: number; name: string }>[]>(
    () => (refs?.cities ?? []).map(c => ({ id: String(c.id), label: c.name, sub: c.code, key: comboKey(c.name, c.code), value: c })), [refs]);
  const objectItems = useMemo<ComboItem<FormRefs['objects'][number]>[]>(
    () => (refs?.objects ?? []).map(o => ({ id: String(o.id), label: o.name, sub: o.address || undefined, key: comboKey(o.name, o.address), value: o })), [refs]);
  const objectByKey = useMemo(() => new Map((refs?.objects ?? []).map(o => [norm(o.name), o])), [refs]);
  const empItems = useMemo<ComboItem<FormRefs['employees'][number]>[]>(
    () => (refs?.employees ?? []).map(e => ({ id: String(e.id), label: e.fullName, key: comboKey(e.fullName), value: e })), [refs]);

  const addFiles = async (list: File[]) => {
    const room = LIMITS.maxTicketAttachments - atts.length;
    if (list.length > room) alert(`Не больше ${LIMITS.maxTicketAttachments} вложений.`);
    let seq = atts.reduce((m, a) => Math.max(m, a.seq), 0);
    for (const file of list.slice(0, Math.max(0, room))) {
      if (file.size > LIMITS.maxAttachmentBytes && !file.type.startsWith('image/')) {
        alert(`«${file.name}» больше 20 МБ.`);
        continue;
      }
      const blob = file.type.startsWith('image/') ? await compressImage(file) : file;
      if (blob.size > LIMITS.maxAttachmentBytes) { alert(`«${file.name}» больше 20 МБ.`); continue; }
      const att: Att = { fileId: uuid(), name: file.name, size: blob.size, seq: ++seq, state: 'uploading', progress: 0 };
      setAtts(a => [...a, att]);
      const mime = blob.type || file.type || 'application/octet-stream';
      uploadFile({ fileId: att.fileId, ownerKey: draftKey, kind: 'attachment', seq: att.seq, name: file.name, mime, size: blob.size, takenAt: null }, blob,
        sent => setAtts(a => a.map(x => (x.fileId === att.fileId ? { ...x, progress: sent } : x))))
        .then(() => setAtts(a => a.map(x => (x.fileId === att.fileId ? { ...x, state: 'done', progress: x.size } : x))))
        .catch(e => setAtts(a => a.map(x => (x.fileId === att.fileId ? { ...x, state: 'error', error: (e as Error).message } : x))));
    }
  };

  const validate = () => {
    const e: string[] = [];
    if (!f.cityId) e.push(f.cityText ? 'Город: выберите из списка' : 'Заполните «Город»');
    if (!f.objectId && !f.objectText.trim()) e.push('Заполните «Объект»');
    if (!f.address.trim()) e.push('Заполните «Адрес»');
    if (!f.description.trim()) e.push('Заполните «Описание задачи»');
    if (f.assigneeText.trim() && !f.assigneeId) e.push('Исполнитель: выберите из списка');
    if (f.plannedDate && f.plannedDate < today) e.push('Плановая дата не может быть раньше сегодняшней');
    if (atts.some(a => a.state === 'uploading')) e.push('Дождитесь загрузки вложений');
    if (atts.some(a => a.state === 'error')) e.push('Не все вложения загрузились — уберите их или добавьте заново');
    return e;
  };

  const submit = async () => {
    setStrict(true);
    const e = validate();
    setErrors(e);
    if (e.length) return;
    if (dups.length && !confirm(`По этому объекту уже есть открытая заявка ${dups.map(d => d.number).join(', ')}. Всё равно создать новую?`)) return;
    setSaving(true);
    try {
      const r = await postJson<{ number: string }>('/api/tickets', {
        cityId: f.cityId,
        objectId: f.objectId,
        objectName: f.objectId ? null : f.objectText.trim(),
        address: f.address,
        description: f.description,
        priorityId,
        assigneeId: f.assigneeId,
        plannedDate: f.plannedDate || null,
        contact: f.contact,
        note: f.note,
        draftKey,
        attachmentIds: atts.filter(a => a.state === 'done').map(a => a.fileId),
      });
      setCreated(r.number);
      window.scrollTo(0, 0);
    } catch (err) {
      setErrors([err instanceof ApiError ? err.message : 'Нет связи с сервером — попробуйте ещё раз']);
    } finally {
      setSaving(false);
    }
  };

  const again = () => {
    setF(empty());
    setAtts([]);
    setDups(null);
    setErrors([]);
    setStrict(false);
    setCreated(null);
    setDraftKey(newReportId());
    void reload();
  };

  if (created) {
    return (
      <div className="card py-8 text-center">
        <div className="mb-2 text-4xl">✓</div>
        <h2 className="text-xl font-bold">Заявка {created} создана</h2>
        <div className="mx-auto mt-5 flex max-w-xs flex-col gap-2">
          <Link href={`/tickets/${created}`} className="btn-secondary btn-big">Открыть карточку</Link>
          <button className="btn-primary btn-big" onClick={again}>Создать ещё</button>
        </div>
      </div>
    );
  }
  if (refsError && !refs) return <div className="card text-red-700">Не удалось загрузить справочники: {refsError}</div>;
  if (!refs) return <div className="card text-slate-500">Загрузка…</div>;

  const bad = (c: boolean) => (strict && c ? 'bad' : '');
  const objKnown = f.objectId || !f.objectText.trim() || objectByKey.has(norm(f.objectText));

  return (
    <div className="card space-y-1">
      <div className="grid gap-x-4 md:grid-cols-2">
        <div>
          <div className="label">Город *</div>
          <Combo items={cityItems} text={f.cityText} invalid={strict && !f.cityId}
            onText={s => { const c = refs.cities.find(x => norm(x.name) === norm(s)); set({ cityText: s, cityId: c?.id ?? null }); }}
            onPick={it => set({ cityText: it.value.name, cityId: it.value.id })}
            placeholder="Начните вводить город" emptyText="Нет в справочнике — добавьте город в «Справочниках»" />
          <p className="hint">Определяет префикс номера заявки.</p>
        </div>
        <div>
          <div className="label">Объект *</div>
          <Combo items={objectItems} text={f.objectText} invalid={strict && !f.objectId && !f.objectText.trim()}
            onText={s => set({ objectText: s, objectId: objectByKey.get(norm(s))?.id ?? null })}
            onPick={it => setF(x => ({ ...x, objectText: it.value.name, objectId: it.value.id, address: it.value.address || x.address }))}
            placeholder="Начните вводить название" emptyText="Нет в справочнике — будет добавлен" />
          {!objKnown && <p className="hint text-amber-700">Новый объект — будет добавлен в справочник.</p>}
        </div>
      </div>

      {dups.length > 0 && (
        <div className="mt-2 rounded-lg bg-amber-50 p-3 text-sm text-amber-900">
          По этому объекту уже есть открытые заявки:{' '}
          {dups.map((d, i) => (
            <span key={d.number}>{i > 0 && ', '}<Link className="link" href={`/tickets/${d.number}`} target="_blank">{d.number}</Link> ({STATUS_LABEL[d.status]})</span>
          ))}. Создать новую всё равно можно.
        </div>
      )}

      <label className="label" htmlFor="addr">Адрес *</label>
      <textarea id="addr" rows={2} className={`input ${bad(!f.address.trim())}`} value={f.address} onChange={e => set({ address: e.target.value })} maxLength={LIMITS.shortText} />

      <label className="label" htmlFor="desc">Описание задачи / проблемы *</label>
      <textarea id="desc" rows={5} className={`input ${bad(!f.description.trim())}`} value={f.description}
        onChange={e => set({ description: e.target.value })} maxLength={LIMITS.ticketDescription} />
      <p className="hint text-right">{f.description.length} / {LIMITS.ticketDescription}</p>

      <div className="grid gap-x-4 md:grid-cols-3">
        <label>
          <span className="label">Приоритет</span>
          <select className="input" value={priorityId ?? ''} onChange={e => set({ priorityId: Number(e.target.value) })}>
            {refs.priorities.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        </label>
        <div>
          <div className="label">Исполнитель</div>
          <Combo items={empItems} text={f.assigneeText} invalid={strict && !!f.assigneeText.trim() && !f.assigneeId}
            onText={s => set({ assigneeText: s, assigneeId: refs.employees.find(e => norm(e.fullName) === norm(s))?.id ?? null })}
            onPick={it => set({ assigneeText: it.value.fullName, assigneeId: it.value.id })}
            placeholder="Не назначен" />
          {f.assigneeId && <p className="hint">Статус сразу будет «Назначена».</p>}
        </div>
        <label>
          <span className="label">Плановая дата выезда</span>
          <input type="date" className={`input ${bad(!!f.plannedDate && f.plannedDate < today)}`} min={today} value={f.plannedDate} onChange={e => set({ plannedDate: e.target.value })} />
        </label>
      </div>

      <label className="label" htmlFor="contact">Контакт на объекте (ФИО, телефон)</label>
      <input id="contact" className="input" value={f.contact} onChange={e => set({ contact: e.target.value })} maxLength={LIMITS.shortText} />

      <div className="label">Вложения (фото, PDF — до {LIMITS.maxTicketAttachments} файлов по 20 МБ)</div>
      <label className="btn-secondary cursor-pointer">
        + Добавить файлы
        <input type="file" multiple accept="image/*,application/pdf" className="hidden"
          onChange={e => { const l = Array.from(e.target.files ?? []); e.target.value = ''; void addFiles(l); }} />
      </label>
      {atts.length > 0 && (
        <ul className="mt-2 space-y-1 text-sm">
          {atts.map(a => (
            <li key={a.fileId} className="flex items-center gap-2">
              <span className="truncate">{a.name}</span>
              <span className="shrink-0 text-slate-500">
                {a.state === 'done' ? `✓ ${fmtBytes(a.size)}` : a.state === 'error' ? <span className="text-red-600">{a.error}</span> : `${Math.round((a.progress / a.size) * 100)}%`}
              </span>
              <button className="ml-auto shrink-0 text-red-600" onClick={() => setAtts(x => x.filter(y => y.fileId !== a.fileId))}>Убрать</button>
            </li>
          ))}
        </ul>
      )}

      <label className="label" htmlFor="note">Примечание (видно исполнителю)</label>
      <textarea id="note" rows={2} className="input" value={f.note} onChange={e => set({ note: e.target.value })} maxLength={LIMITS.longText} />

      {errors.length > 0 && (
        <div className="mt-3 rounded-lg bg-red-50 p-3 text-sm text-red-700">
          <b>Нужно исправить:</b>
          <ul className="mt-1 list-disc pl-5">{errors.map(e => <li key={e}>{e}</li>)}</ul>
        </div>
      )}
      <div className="pt-3">
        <button className="btn-primary btn-big md:w-auto md:px-10" disabled={saving} onClick={() => void submit()}>
          {saving ? 'Создаю…' : 'Создать заявку'}
        </button>
      </div>
    </div>
  );
}

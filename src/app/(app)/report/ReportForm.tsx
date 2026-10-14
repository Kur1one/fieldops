'use client';

import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { getGeo } from '@/client/geo';
import { postJson } from '@/client/http';
import { newReportId, uuid } from '@/client/ids';
import {
  delBlob, draftKey, getBlob, kvGet, kvSet, outboxAll, outboxDel, putBlob,
  type Draft, type DraftFile, type GeoStamp, type OutboxItem,
} from '@/client/idb';
import { compressImage, readTakenAt } from '@/client/media';
import { enqueue, OUTBOX_CHANNEL, processOutbox } from '@/client/outbox';
import { useRefs, type FormRefs } from '@/client/refs';
import { Combo, comboKey, type ComboItem } from '@/components/Combo';
import { LIMITS, STATUS_LABEL, WORK_STATUS_LABEL, WORK_STATUSES, type ActionKind, type TicketStatus } from '@/lib/shared/constants';
import { fmtBytes, fmtDate, fmtDateTime, mapLink } from '@/lib/shared/format';
import { norm } from '@/lib/shared/text';
import { deviceErrors, DevicesBlock, type RegistryDevice } from './DevicesBlock';
import { MediaBlock } from './MediaBlock';

type Ticket = FormRefs['tickets'][number];
type View = { kind: 'form' } | { kind: 'sending'; reportId: string };

function newDraft(userId: number): Draft {
  const now = new Date().toISOString();
  return {
    reportId: newReportId(), userId, createdAt: now, updatedAt: now,
    ticketNumber: '', cityId: null, cityText: '', objectId: null, objectText: '', address: '',
    task: '', workReport: '', materials: '', workStatus: '', customerRep: '', comment: '',
    arrival: null, finish: null, devices: [], files: [], seq: { photo_before: 0, photo_after: 0, video: 0 },
  };
}

function isEmpty(d: Draft) {
  return !d.ticketNumber && !d.ticketText?.trim() && !d.cityId && !d.objectText && !d.address && !d.task && !d.workReport && !d.arrival
    && !d.devices.length && !d.files.length && !d.comment && !d.materials;
}

const tz = () => Intl.DateTimeFormat().resolvedOptions().timeZone;

function subscribeOnline(cb: () => void) {
  window.addEventListener('online', cb);
  window.addEventListener('offline', cb);
  return () => { window.removeEventListener('online', cb); window.removeEventListener('offline', cb); };
}
function useOnline() {
  return useSyncExternalStore(subscribeOnline, () => navigator.onLine, () => true);
}

function useOutbox() {
  const [items, setItems] = useState<OutboxItem[]>([]);
  const refresh = useCallback(async () => setItems(await outboxAll()), []);
  useEffect(() => {
    const load = () => { outboxAll().then(setItems, () => {}); };
    load();
    let ch: BroadcastChannel | null = null;
    try { ch = new BroadcastChannel(OUTBOX_CHANNEL); ch.onmessage = load; } catch {}
    const t = setInterval(load, 3000);
    return () => { ch?.close(); clearInterval(t); };
  }, []);
  return { items, refresh };
}

export function ReportForm() {
  const sp = useSearchParams();
  const wantTicket = (sp.get('ticket') ?? '').toUpperCase();
  const { refs, fromCache, error: refsError, reload } = useRefs();
  const online = useOnline();
  const { items: outbox, refresh: refreshOutbox } = useOutbox();

  const [draft, setDraftState] = useState<Draft | null>(null);
  const [restored, setRestored] = useState(false);
  const [conflictTicket, setConflictTicket] = useState<string | null>(null);
  const [thumbs, setThumbs] = useState<Record<string, string>>({});
  const [errors, setErrors] = useState<string[]>([]);
  const [strict, setStrict] = useState(false);
  const [stamping, setStamping] = useState<'arrival' | 'finish' | null>(null);
  const [mediaBusy, setMediaBusy] = useState<Record<string, string>>({});
  const [arriveNote, setArriveNote] = useState('');
  const [registryState, setRegistry] = useState<{ objectId: number; devices: RegistryDevice[] } | null>(null);
  const [view, setView] = useState<View>({ kind: 'form' });
  const errorsRef = useRef<HTMLDivElement>(null);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const draftRef = useRef<Draft | null>(null);

  const me = refs?.me;

  /* ---------- черновик ---------- */

  const persist = useCallback(async (d: Draft) => {
    try { await kvSet(draftKey(d.userId), d); } catch (e) { console.warn('draft', e); }
  }, []);

  const setDraft = useCallback((fn: (d: Draft) => Draft) => {
    setDraftState(prev => {
      if (!prev) return prev;
      const next = { ...fn(prev), updatedAt: new Date().toISOString() };
      draftRef.current = next;
      if (saveTimer.current) clearTimeout(saveTimer.current);
      saveTimer.current = setTimeout(() => void persist(next), 250);
      return next;
    });
  }, [persist]);

  const loadThumbs = useCallback(async (files: DraftFile[]) => {
    const out: Record<string, string> = {};
    for (const f of files) {
      if (!f.mime.startsWith('image/')) continue;
      const b = await getBlob(f.fileId);
      if (b) out[f.fileId] = URL.createObjectURL(b);
    }
    setThumbs(t => ({ ...t, ...out }));
  }, []);

  // восстановление черновика после закрытия вкладки или перезагрузки телефона
  useEffect(() => {
    if (!me || draft) return;
    (async () => {
      const saved = await kvGet<Draft>(draftKey(me.id)).catch(() => undefined);
      let d = saved && saved.userId === me.id ? saved : newDraft(me.id);
      if (saved && !isEmpty(saved)) setRestored(true);
      if (wantTicket && d.ticketNumber !== wantTicket) {
        if (isEmpty(d)) d = { ...d, ticketNumber: wantTicket, ticketText: wantTicket };
        else setConflictTicket(wantTicket);
      }
      draftRef.current = d;
      setDraftState(d);
      void persist(d);
      void loadThumbs(d.files);
    })();
  }, [me, draft, wantTicket, persist, loadThumbs]);

  useEffect(() => {
    const flush = () => { if (draftRef.current) void persist(draftRef.current); };
    const vis = () => { if (document.visibilityState === 'hidden') flush(); };
    window.addEventListener('pagehide', flush);
    document.addEventListener('visibilitychange', vis);
    return () => { window.removeEventListener('pagehide', flush); document.removeEventListener('visibilitychange', vis); };
  }, [persist]);

  // попросить браузер не вычищать хранилище с черновиками
  useEffect(() => { void navigator.storage?.persist?.().catch(() => {}); }, []);

  /* ---------- очередь отправки ---------- */

  useEffect(() => {
    void processOutbox().then(refreshOutbox);
  }, [refreshOutbox]);
  useEffect(() => {
    if (online) void processOutbox().then(refreshOutbox);
  }, [online, refreshOutbox]);
  useEffect(() => {
    const t = setInterval(() => { if (navigator.onLine) void processOutbox(); }, 30000);
    return () => clearInterval(t);
  }, []);

  const sendingNow = outbox.some(i => i.status === 'sending');
  useEffect(() => {
    const h = (e: BeforeUnloadEvent) => { if (sendingNow) { e.preventDefault(); e.returnValue = ''; } };
    window.addEventListener('beforeunload', h);
    return () => window.removeEventListener('beforeunload', h);
  }, [sendingNow]);

  /* ---------- справочники для полей ---------- */

  const ticketMap = useMemo(() => new Map((refs?.tickets ?? []).map(t => [t.number, t])), [refs]);
  const ticketItems = useMemo<ComboItem<Ticket>[]>(() => {
    if (!refs) return [];
    const mine = (t: Ticket) => t.assigneeId === refs.me.id;
    return [...refs.tickets].sort((a, b) => Number(mine(b)) - Number(mine(a))).map(t => ({
      id: t.number,
      label: `${mine(t) ? '★ ' : ''}${t.number} · ${t.objectName}`,
      sub: [mine(t) ? 'назначена вам' : '', t.cityName, t.priorityRank <= 2 ? t.priorityName : '', STATUS_LABEL[t.status as TicketStatus],
        t.plannedDate ? 'план: ' + fmtDate(t.plannedDate) : '', t.description.slice(0, 90)].filter(Boolean).join(' · '),
      key: comboKey(t.number, t.objectName, t.cityName, t.description, t.address),
      value: t,
      accent: mine(t),
    }));
  }, [refs]);
  const cityItems = useMemo<ComboItem<{ id: number; name: string }>[]>(
    () => (refs?.cities ?? []).map(c => ({ id: String(c.id), label: c.name, key: comboKey(c.name, c.code), value: c })), [refs]);
  const objectItems = useMemo<ComboItem<FormRefs['objects'][number]>[]>(
    () => (refs?.objects ?? []).map(o => ({ id: String(o.id), label: o.name, sub: o.address || undefined, key: comboKey(o.name, o.address), value: o })), [refs]);
  const objectByKey = useMemo(() => new Map((refs?.objects ?? []).map(o => [norm(o.name), o])), [refs]);
  const kinds = useMemo(() => Object.fromEntries((refs?.deviceActions ?? []).map(a => [a.name, a.kind])) as Record<string, ActionKind>, [refs]);

  // реестр устройств объекта — для предупреждения о занятом IP
  const objectId = draft?.objectId ?? null;
  const registry = registryState && registryState.objectId === objectId ? registryState.devices : null;
  useEffect(() => {
    if (!objectId) return;
    let cancelled = false;
    (async () => {
      const key = `objdev:${objectId}`;
      try {
        const r = await fetch(`/api/objects/${objectId}/devices`, { credentials: 'same-origin' });
        if (!r.ok) throw new Error();
        const j = (await r.json()) as { devices: RegistryDevice[] };
        if (!cancelled) setRegistry({ objectId, devices: j.devices });
        await kvSet(key, j.devices);
      } catch {
        const cached = await kvGet<RegistryDevice[]>(key).catch(() => undefined);
        if (!cancelled && cached) setRegistry({ objectId, devices: cached });
      }
    })();
    return () => { cancelled = true; };
  }, [objectId]);

  /* ---------- действия ---------- */

  const pickTicket = (t: Ticket) => setDraft(d => ({
    ...d,
    ticketNumber: t.number,
    ticketText: t.number,
    cityId: t.cityId, cityText: t.cityName,
    objectId: t.objectId, objectText: t.objectName,
    address: t.address || d.address,
    task: !d.task.trim() || (ticketMap.get(d.ticketNumber)?.description === d.task) ? t.description : d.task,
  }));

  const stamp = async (which: 'arrival' | 'finish') => {
    const d = draftRef.current;
    if (!d) return;
    if (which === 'finish' && !d.arrival) return;
    if (d[which] && !confirm(`Время уже отмечено (${fmtDateTime(d[which]!.time, tz())}). Отметить заново?`)) return;
    const time = new Date().toISOString();
    setStamping(which);
    setDraft(x => ({ ...x, [which]: { time, error: 'определяю местоположение…' } }));
    const geo = await getGeo();
    setDraft(x => ({ ...x, [which]: { time, ...geo } }));
    setStamping(null);
    if (which === 'arrival' && d.ticketNumber && navigator.onLine) {
      postJson<{ status: string }>(`/api/tickets/${encodeURIComponent(d.ticketNumber)}/arrive`, {})
        .then(() => setArriveNote('Заявка переведена «В работе»'))
        .catch(e => setArriveNote(String((e as Error).message)));
    }
  };

  const retryGeo = async (which: 'arrival' | 'finish') => {
    setStamping(which);
    const geo = await getGeo();
    setDraft(x => (x[which] ? { ...x, [which]: { time: x[which]!.time, ...geo } } : x));
    setStamping(null);
  };

  const addFiles = async (kind: 'photo_before' | 'photo_after' | 'video', list: File[]) => {
    const d = draftRef.current;
    if (!d) return;
    const have = d.files.filter(f => f.kind === kind).length;
    const max = kind === 'video' ? LIMITS.maxVideos : LIMITS.maxPhotosPerBlock;
    const take = list.slice(0, Math.max(0, max - have));
    if (take.length < list.length) alert(kind === 'video' ? `Не больше ${LIMITS.maxVideos} видео в отчёте.` : `Не больше ${max} фото в одном блоке.`);
    for (let i = 0; i < take.length; i++) {
      const f = take[i];
      if (!f.size) continue;
      if (kind === 'video' && f.size > LIMITS.maxVideoBytes) {
        alert(`Видео «${f.name}» весит ${fmtBytes(f.size)}, а можно до 50 МБ. Снимите короче или сожмите.`);
        continue;
      }
      setMediaBusy(m => ({ ...m, [kind]: `Обрабатываю ${i + 1} из ${take.length}…` }));
      const takenAt = kind === 'video' ? null : await readTakenAt(f);
      const blob = kind === 'video' ? f : await compressImage(f);
      const fileId = uuid();
      try {
        await putBlob(fileId, blob);
      } catch {
        alert('В памяти телефона не хватает места для файла. Освободите место и попробуйте снова.');
        break;
      }
      const mime = blob.type || f.type || (kind === 'video' ? 'video/mp4' : 'image/jpeg');
      setDraft(x => {
        const seq = x.seq[kind] + 1;
        const df: DraftFile = { fileId, kind, seq, name: f.name, mime, size: blob.size, takenAt, uploaded: false };
        return { ...x, seq: { ...x.seq, [kind]: seq }, files: [...x.files, df] };
      });
      if (kind !== 'video') setThumbs(t => ({ ...t, [fileId]: URL.createObjectURL(blob) }));
    }
    setMediaBusy(m => ({ ...m, [kind]: '' }));
  };

  const removeFile = (fileId: string) => {
    setDraft(x => ({ ...x, files: x.files.filter(f => f.fileId !== fileId) }));
    if (thumbs[fileId]) URL.revokeObjectURL(thumbs[fileId]);
    void delBlob(fileId);
  };

  /* ---------- проверка и отправка ---------- */

  const fieldBad = (cond: boolean) => (strict && cond ? 'bad' : '');

  function validate(d: Draft): string[] {
    const e: string[] = [];
    if (!d.ticketNumber && d.ticketText?.trim()) e.push('Заявка: выберите из списка или очистите поле');
    if (!d.cityId) e.push(d.cityText.trim() ? 'Город: выберите из списка' : 'Заполните «Город»');
    if (!d.objectId && !d.objectText.trim()) e.push('Заполните «Объект»');
    if (!d.task.trim()) e.push('Заполните «Описание проблемы / задачи»');
    if (!d.workReport.trim()) e.push('Заполните «Отчёт о проделанной работе»');
    if (d.workReport.length > LIMITS.workReport) e.push(`Отчёт о работе длиннее ${LIMITS.workReport} символов`);
    if (!d.arrival) e.push('Нажмите «Я на объекте»');
    if (!d.finish) e.push('Нажмите «Работы завершены»');
    if (d.arrival && d.finish && new Date(d.finish.time) < new Date(d.arrival.time)) e.push('Время завершения раньше времени приезда');
    if (!d.workStatus) e.push('Выберите статус работ');
    d.devices.forEach((x, i) => {
      const errs = Object.values(deviceErrors(x, d.devices, kinds, true)).filter(Boolean);
      if (errs.length) e.push(`Устройство ${i + 1}: ${errs.join(', ')}`);
    });
    return e;
  }

  const send = async () => {
    const d = draftRef.current;
    if (!d) return;
    setStrict(true);
    const errs = validate(d);
    setErrors(errs);
    if (errs.length) {
      setTimeout(() => errorsRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' }), 50);
      return;
    }
    if (saveTimer.current) clearTimeout(saveTimer.current);
    await enqueue(d);
    // форма сразу освобождается под новый отчёт; этот уходит из очереди
    const fresh = newDraft(d.userId);
    draftRef.current = fresh;
    setDraftState(fresh);
    await persist(fresh);
    setStrict(false);
    setErrors([]);
    setRestored(false);
    setArriveNote('');
    setView({ kind: 'sending', reportId: d.reportId });
    window.scrollTo(0, 0);
    void processOutbox().then(refreshOutbox);
  };

  // вернуть отчёт из очереди (ошибка сервера) в форму для исправления
  const backToEdit = async (item: OutboxItem) => {
    const cur = draftRef.current;
    if (cur && !isEmpty(cur) && cur.reportId !== item.reportId &&
      !confirm('В форме уже есть незаконченный отчёт. Заменить его отчётом из очереди? Текущий будет удалён.')) return;
    if (cur && cur.reportId !== item.reportId) for (const f of cur.files) await delBlob(f.fileId).catch(() => {});
    const d = { ...item.draft };
    await outboxDel(item.reportId);
    draftRef.current = d;
    setDraftState(d);
    await persist(d);
    void loadThumbs(d.files);
    setView({ kind: 'form' });
    setStrict(true);
    setErrors(item.error ? [item.error] : []);
    void refreshOutbox();
  };

  const discardQueued = async (item: OutboxItem) => {
    if (!confirm('Удалить этот отчёт из очереди? Он не будет отправлен.')) return;
    for (const f of item.draft.files) await delBlob(f.fileId).catch(() => {});
    await outboxDel(item.reportId);
    void refreshOutbox();
  };

  const startNew = async () => {
    const cur = draftRef.current;
    if (!me) return;
    if (cur && !isEmpty(cur) && !confirm('Удалить черновик и начать новый отчёт?')) return;
    if (cur) for (const f of cur.files) await delBlob(f.fileId).catch(() => {});
    const d = newDraft(me.id);
    if (conflictTicket) { d.ticketNumber = conflictTicket; d.ticketText = conflictTicket; }
    draftRef.current = d;
    setDraftState(d);
    await persist(d);
    setThumbs({});
    setRestored(false);
    setConflictTicket(null);
    setStrict(false);
    setErrors([]);
    setView({ kind: 'form' });
  };

  // подставить данные заявки, если её номер пришёл из ссылки «Подать отчёт»
  useEffect(() => {
    if (!draft || !refs) return;
    const t = ticketMap.get(draft.ticketNumber);
    if (t && !draft.cityId && !draft.objectText) pickTicket(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draft?.ticketNumber, refs]);

  /* ---------- отрисовка ---------- */

  if (refsError && !refs) {
    return (
      <div className="card">
        <p className="text-red-700">Не удалось загрузить справочники: {refsError}</p>
        <p className="hint">Нужна связь при первом открытии формы. Потом форма будет работать и без интернета.</p>
        <button className="btn-secondary mt-3" onClick={() => void reload()}>Повторить</button>
      </div>
    );
  }
  if (!refs || !draft) return <div className="card text-slate-500">Загрузка…</div>;

  const queued = outbox.filter(i => i.status !== 'sent');
  const ticket = draft.ticketNumber ? ticketMap.get(draft.ticketNumber) : undefined;
  const filesOf = (k: DraftFile['kind']) => draft.files.filter(f => f.kind === k);
  const objKnown = draft.objectId || !draft.objectText.trim() || objectByKey.has(norm(draft.objectText));

  if (view.kind === 'sending') {
    const item = outbox.find(i => i.reportId === view.reportId);
    return (
      <SendingView
        item={item}
        online={online}
        onNew={() => setView({ kind: 'form' })}
        onEdit={() => item && void backToEdit(item)}
        onRetry={() => void processOutbox().then(refreshOutbox)}
      />
    );
  }

  return (
    <div className="space-y-3">
      {!online && <div className="rounded-xl bg-red-600 p-3 text-sm font-medium text-white">Нет связи, всё сохраняется. Отправить можно — отчёт уйдёт сам, когда связь появится.</div>}
      {fromCache && online && <div className="rounded-xl bg-amber-50 p-3 text-sm text-amber-800">Справочники не обновились — используется сохранённая копия.</div>}
      {queued.length > 0 && <OutboxPanel items={queued} onEdit={i => void backToEdit(i)} onDiscard={i => void discardQueued(i)} onRetry={() => void processOutbox().then(refreshOutbox)} />}
      {conflictTicket && (
        <div className="rounded-xl bg-amber-50 p-3 text-sm text-amber-900">
          У вас есть незаконченный отчёт{draft.ticketNumber ? ` по заявке ${draft.ticketNumber}` : ''}.
          <div className="mt-2 flex flex-wrap gap-2">
            <button className="btn-secondary py-1.5" onClick={() => setConflictTicket(null)}>Продолжить его</button>
            <button className="btn-ghost py-1.5 text-red-700" onClick={() => void startNew()}>Удалить и начать отчёт по {conflictTicket}</button>
          </div>
        </div>
      )}
      {restored && !conflictTicket && (
        <div className="rounded-xl bg-amber-50 p-3 text-sm text-amber-900">
          Восстановлен незаконченный отчёт.{' '}
          <button className="link" onClick={() => void startNew()}>Начать новый отчёт</button>
        </div>
      )}

      <section className="card">
        <h2 className="h2">Сотрудник</h2>
        <input className="input" readOnly value={me!.fullName} aria-label="ФИО" />
        <p className="hint">Определено по почте {me!.email}</p>
      </section>

      <section className="card">
        <h2 className="h2">Объект</h2>
        <div className="label">Заявка</div>
        <Combo
          items={ticketItems}
          text={draft.ticketText ?? draft.ticketNumber}
          onText={s => setDraft(d => {
            const exact = ticketMap.get(s.trim().toUpperCase());
            return { ...d, ticketText: s, ticketNumber: exact ? exact.number : '' };
          })}
          onPick={it => pickTicket(it.value)}
          placeholder="Поиск: номер, объект или задача"
          emptyText="Открытых заявок не найдено"
        />
        {!draft.ticketNumber && !draft.ticketText?.trim() && <p className="hint">Если выезд по заявке — выберите её, остальное подставится. Пусто — внеплановый выезд.</p>}
        {!draft.ticketNumber && !!draft.ticketText?.trim() && <p className={`hint ${strict ? 'text-red-600' : 'text-amber-700'}`}>Выберите заявку из списка или очистите поле (тогда выезд будет внеплановым).</p>}
        {draft.ticketNumber && !ticket && <p className="hint text-amber-700">Заявки {draft.ticketNumber} нет среди ваших открытых — сервер проверит её при отправке.</p>}
        {ticket && (
          <div className="mt-2 rounded-lg bg-brand-50 p-3 text-sm">
            <b>{ticket.number}</b> · {STATUS_LABEL[ticket.status as TicketStatus]} · {ticket.priorityName}
            {ticket.plannedDate && <><br />План: {fmtDate(ticket.plannedDate)}</>}
            {ticket.assigneeName && <><br />Исполнитель: {ticket.assigneeName}</>}
            {ticket.contact && <><br />Контакт: {ticket.contact}</>}
            <br /><span className="whitespace-pre-wrap">{ticket.description}</span>
            {ticket.note && <><br /><i>Примечание: {ticket.note}</i></>}
          </div>
        )}

        <div className="label">Город *</div>
        <Combo
          items={cityItems}
          text={draft.cityText}
          onText={s => setDraft(d => {
            const c = refs.cities.find(x => norm(x.name) === norm(s));
            return { ...d, cityText: s, cityId: c?.id ?? null };
          })}
          onPick={it => setDraft(d => ({ ...d, cityText: it.value.name, cityId: it.value.id }))}
          placeholder="Начните вводить город"
          invalid={strict && !draft.cityId}
          emptyText="Нет в справочнике — новый город добавляет диспетчер"
        />

        <div className="label">Объект *</div>
        <Combo
          items={objectItems}
          text={draft.objectText}
          onText={s => setDraft(d => ({ ...d, objectText: s, objectId: objectByKey.get(norm(s))?.id ?? null }))}
          onPick={it => setDraft(d => ({ ...d, objectText: it.value.name, objectId: it.value.id, address: d.address.trim() ? d.address : it.value.address }))}
          placeholder="Начните вводить название"
          invalid={strict && !draft.objectId && !draft.objectText.trim()}
          emptyText="Нет в справочнике — будет добавлен как введён"
        />
        {!objKnown && <p className="hint text-amber-700">Объекта нет в справочнике — он будет добавлен.</p>}

        <label className="label" htmlFor="address">Адрес</label>
        <textarea id="address" rows={2} className="input" value={draft.address}
          onChange={e => setDraft(d => ({ ...d, address: e.target.value }))} maxLength={LIMITS.shortText} />
      </section>

      <section className="card">
        <h2 className="h2">Прибытие</h2>
        <button type="button" className={`btn-primary btn-big ${fieldBad(!draft.arrival)}`} disabled={stamping === 'arrival'} onClick={() => void stamp('arrival')}>
          {stamping === 'arrival' ? 'Определяю местоположение…' : 'Я на объекте'}
        </button>
        <p className="hint">Отметит время и геолокацию. Разрешите доступ к местоположению, если телефон спросит.</p>
        <StampInfo s={draft.arrival} busy={stamping === 'arrival'} onRetry={() => void retryGeo('arrival')} />
        {strict && !draft.arrival && <p className="err-text">Нажмите «Я на объекте»</p>}
        {arriveNote && <p className="hint">{arriveNote}</p>}
      </section>

      <section className="card">
        <h2 className="h2">Задача</h2>
        <label className="label" htmlFor="task">Описание проблемы / задачи *</label>
        <textarea id="task" rows={3} className={`input ${fieldBad(!draft.task.trim())}`} value={draft.task}
          onChange={e => setDraft(d => ({ ...d, task: e.target.value }))} maxLength={LIMITS.longText} />
        <MediaBlock title="Фото до начала работ" files={filesOf('photo_before')} thumbs={thumbs} accept="image/*"
          onAdd={l => void addFiles('photo_before', l)} onRemove={removeFile} busy={mediaBusy.photo_before}
          limitText={`${filesOf('photo_before').length} из ${LIMITS.maxPhotosPerBlock}`} />
      </section>

      <section className="card">
        <h2 className="h2">Устройства {draft.devices.length > 0 && <span className="font-normal text-slate-500">({draft.devices.length} из {LIMITS.maxDevices})</span>}</h2>
        <DevicesBlock
          devices={draft.devices}
          onChange={list => setDraft(d => ({ ...d, devices: list }))}
          types={refs.deviceTypes}
          actions={refs.deviceActions}
          registry={registry}
          showAllErrors={strict}
        />
      </section>

      <section className="card">
        <h2 className="h2">Результат</h2>
        <label className="label" htmlFor="workReport">Отчёт о проделанной работе *</label>
        <textarea id="workReport" rows={5} className={`input ${fieldBad(!draft.workReport.trim())}`} value={draft.workReport}
          onChange={e => setDraft(d => ({ ...d, workReport: e.target.value }))} maxLength={LIMITS.workReport} />
        <p className="hint text-right">{draft.workReport.length} / {LIMITS.workReport}</p>
        <label className="label" htmlFor="materials">Использованные материалы и оборудование</label>
        <textarea id="materials" rows={2} className="input" value={draft.materials}
          onChange={e => setDraft(d => ({ ...d, materials: e.target.value }))} maxLength={LIMITS.longText} />

        <div className="label">Статус работ *</div>
        <div className={`space-y-1.5 rounded-lg ${strict && !draft.workStatus ? 'ring-2 ring-red-400' : ''}`}>
          {WORK_STATUSES.map(s => (
            <label key={s} className={`flex items-center gap-3 rounded-lg border p-3 ${draft.workStatus === s ? 'border-brand bg-brand-50' : 'border-slate-300'}`}>
              <input type="radio" name="workStatus" className="h-5 w-5" checked={draft.workStatus === s} onChange={() => setDraft(d => ({ ...d, workStatus: s }))} />
              {WORK_STATUS_LABEL[s]}
            </label>
          ))}
        </div>

        <label className="label" htmlFor="customerRep">Представитель заказчика (ФИО, должность)</label>
        <input id="customerRep" className="input" value={draft.customerRep}
          onChange={e => setDraft(d => ({ ...d, customerRep: e.target.value }))} maxLength={LIMITS.shortText} />

        <MediaBlock title="Фото после работ" files={filesOf('photo_after')} thumbs={thumbs} accept="image/*"
          onAdd={l => void addFiles('photo_after', l)} onRemove={removeFile} busy={mediaBusy.photo_after}
          limitText={`${filesOf('photo_after').length} из ${LIMITS.maxPhotosPerBlock}`} />
        <MediaBlock title="Видео (каждое до 50 МБ)" files={filesOf('video')} thumbs={thumbs} accept="video/*"
          onAdd={l => void addFiles('video', l)} onRemove={removeFile} busy={mediaBusy.video}
          limitText={`${filesOf('video').length} из ${LIMITS.maxVideos}`} />
      </section>

      <section className="card">
        <h2 className="h2">Завершение</h2>
        <button type="button" className="btn-primary btn-big" disabled={!draft.arrival || stamping === 'finish'} onClick={() => void stamp('finish')}>
          {stamping === 'finish' ? 'Определяю местоположение…' : 'Работы завершены'}
        </button>
        {!draft.arrival && <p className="hint">Станет доступна после «Я на объекте».</p>}
        <StampInfo s={draft.finish} busy={stamping === 'finish'} onRetry={() => void retryGeo('finish')} />
        {strict && !draft.finish && <p className="err-text">Нажмите «Работы завершены»</p>}
        <label className="label" htmlFor="comment">Комментарий (проблемы, конфликт с проектом)</label>
        <textarea id="comment" rows={3} className="input" value={draft.comment}
          onChange={e => setDraft(d => ({ ...d, comment: e.target.value }))} maxLength={LIMITS.longText} />
      </section>

      {errors.length > 0 && (
        <div ref={errorsRef} className="rounded-xl bg-red-50 p-4 text-sm text-red-700">
          <b>Нужно исправить:</b>
          <ul className="mt-1 list-disc pl-5">{errors.map(e => <li key={e}>{e}</li>)}</ul>
        </div>
      )}
      <button type="button" className="btn-primary btn-big" onClick={() => void send()}>Отправить отчёт</button>
      <p className="hint pb-8 text-center">ID отчёта: {draft.reportId}</p>
    </div>
  );
}

function StampInfo({ s, busy, onRetry }: { s: GeoStamp | null; busy: boolean; onRetry: () => void }) {
  if (!s) return null;
  const t = fmtDateTime(s.time, tz());
  return (
    <div className="mt-2 text-sm">
      {s.lat != null && s.lng != null ? (
        <span className="font-semibold text-green-700">
          Отмечено: {t}, ±{s.acc} м · <a className="link" href={mapLink(s.lat, s.lng)} target="_blank" rel="noreferrer">на карте</a>
        </span>
      ) : (
        <>
          <span className="font-semibold text-green-700">Отмечено: {t}</span><br />
          {busy ? <span className="text-slate-500">Определяю местоположение…</span> : (
            <span className="text-red-700">Геометка не получена: {s.error}. <button type="button" className="link" onClick={onRetry}>Повторить</button></span>
          )}
        </>
      )}
    </div>
  );
}

function progressText(i: OutboxItem) {
  if (i.status === 'sending' && i.progress && i.progress.fileCount) {
    return `Загружаю файл ${i.progress.fileIndex} из ${i.progress.fileCount} — ${fmtBytes(i.progress.bytes)} из ${fmtBytes(i.progress.totalBytes)}`;
  }
  if (i.status === 'sending') return 'Сохраняю отчёт…';
  if (i.status === 'queued') return i.error || 'В очереди';
  if (i.status === 'error') return 'Ошибка: ' + (i.error ?? '');
  return 'Отправлен';
}

function OutboxPanel({ items, onEdit, onDiscard, onRetry }: {
  items: OutboxItem[]; onEdit: (i: OutboxItem) => void; onDiscard: (i: OutboxItem) => void; onRetry: () => void;
}) {
  return (
    <section className="card border-l-4 border-amber-400">
      <h2 className="h2">Неотправленные отчёты ({items.length})</h2>
      <ul className="space-y-3">
        {items.map(i => (
          <li key={i.reportId} className="text-sm">
            <b>{i.draft.ticketNumber || 'Внеплановый'}</b> · {i.draft.objectText} · <span className="text-slate-500">{i.reportId}</span>
            <div className={i.status === 'error' ? 'text-red-700' : 'text-slate-600'}>{progressText(i)}</div>
            {i.status === 'sending' && i.progress && <Bar frac={i.progress.totalBytes ? i.progress.bytes / i.progress.totalBytes : 0} />}
            <div className="mt-1 flex gap-3">
              {i.status !== 'sending' && <button className="link" onClick={onRetry}>Отправить сейчас</button>}
              {i.status === 'error' && <button className="link" onClick={() => onEdit(i)}>Исправить</button>}
              {i.status !== 'sending' && <button className="text-red-600" onClick={() => onDiscard(i)}>Удалить</button>}
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}

function Bar({ frac }: { frac: number }) {
  return (
    <div className="mt-1 h-2.5 overflow-hidden rounded bg-slate-200">
      <div className="h-full bg-brand transition-all" style={{ width: `${Math.round(Math.min(1, frac) * 100)}%` }} />
    </div>
  );
}

function SendingView({ item, online, onNew, onEdit, onRetry }: {
  item: OutboxItem | undefined; online: boolean; onNew: () => void; onEdit: () => void; onRetry: () => void;
}) {
  if (!item) return <div className="card">Загрузка…</div>;
  if (item.status === 'sent' && item.result) {
    return (
      <div className="card py-8 text-center">
        <div className="mb-2 text-4xl">✓</div>
        <h2 className="text-xl font-bold">Отчёт отправлен</h2>
        <p className="mt-2 text-slate-600">
          ID отчёта: <b>{item.reportId}</b><br />
          Заявка: <b>{item.result.ticketNumber}</b> · {STATUS_LABEL[item.result.ticketStatus as TicketStatus] ?? item.result.ticketStatus}<br />
          Объект: {item.result.objectName}
        </p>
        <div className="mt-5 flex flex-col gap-2">
          <Link href={`/tickets/${item.result.ticketNumber}`} className="btn-secondary btn-big">Открыть заявку</Link>
          <button className="btn-primary btn-big" onClick={onNew}>Новый отчёт</button>
        </div>
      </div>
    );
  }
  const p = item.progress;
  return (
    <div className="card py-6">
      <h2 className="text-lg font-bold">
        {item.status === 'error' ? 'Отчёт не принят' : item.status === 'queued' ? 'Отчёт в очереди' : 'Отправляю отчёт…'}
      </h2>
      <p className="mt-1 text-sm text-slate-500">ID: {item.reportId}</p>
      <p className={`mt-3 ${item.status === 'error' ? 'text-red-700' : 'text-slate-700'}`}>{progressText(item)}</p>
      {item.status === 'sending' && p && <Bar frac={p.totalBytes ? p.bytes / p.totalBytes : 1} />}
      {item.status === 'queued' && (
        <p className="mt-3 text-sm text-slate-600">
          {online ? 'Пробую отправить…' : 'Нет связи. Отчёт сохранён на телефоне и уйдёт сам, когда связь появится. Можно закрыть страницу.'}
        </p>
      )}
      <div className="mt-5 flex flex-col gap-2">
        {item.status === 'error' && <button className="btn-primary btn-big" onClick={onEdit}>Исправить отчёт</button>}
        {item.status === 'queued' && <button className="btn-secondary btn-big" onClick={onRetry}>Отправить сейчас</button>}
        <button className="btn-ghost btn-big" onClick={onNew}>Новый отчёт</button>
      </div>
    </div>
  );
}

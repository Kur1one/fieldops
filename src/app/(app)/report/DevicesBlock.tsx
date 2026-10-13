'use client';

import { useEffect, useRef, useState } from 'react';
import type { DraftDevice } from '@/client/idb';
import { LIMITS, type ActionKind } from '@/lib/shared/constants';
import { isValidIp, isValidMac, normalizeIpInput } from '@/lib/shared/net';

export type RegistryDevice = { ip: string; typeName: string; model: string; place: string };

export function emptyDevice(prev?: DraftDevice): DraftDevice {
  return {
    key: Math.random().toString(36).slice(2),
    type: prev?.type ?? '', action: prev?.action ?? '',
    ip: '', model: '', mac: '', serial: '', place: '', oldIp: '', oldModel: '', oldMac: '', oldSerial: '',
  };
}

// Ошибки устройства (раздел 8.1). strict — при отправке (пустые обязательные тоже ошибки).
export function deviceErrors(d: DraftDevice, all: DraftDevice[], kinds: Record<string, ActionKind>, strict: boolean) {
  const e: Partial<Record<keyof DraftDevice, string>> = {};
  if (strict && !d.type) e.type = 'не выбран тип';
  const ip = d.ip.trim();
  if (!ip) { if (strict) e.ip = 'не указан IP'; }
  else if (!isValidIp(ip)) e.ip = 'неверный формат IP (четыре числа 0–255 через точку)';
  else if (all.filter(x => x.ip.trim() === ip).length > 1) e.ip = 'IP повторяется в этом отчёте';
  if (d.mac.trim() && !isValidMac(d.mac)) e.mac = 'формат AA:BB:CC:DD:EE:FF';
  if (kinds[d.action] === 'replace') {
    const old = d.oldIp.trim();
    if (!old) { if (strict) e.oldIp = 'не указан IP снятого устройства'; }
    else if (!isValidIp(old)) e.oldIp = 'неверный формат IP';
    if (d.oldMac.trim() && !isValidMac(d.oldMac)) e.oldMac = 'формат AA:BB:CC:DD:EE:FF';
  }
  return e;
}

export function DevicesBlock({
  devices, onChange, types, actions, registry, showAllErrors,
}: {
  devices: DraftDevice[];
  onChange: (list: DraftDevice[]) => void;
  types: string[];
  actions: { name: string; kind: ActionKind }[];
  registry: RegistryDevice[] | null;
  showAllErrors: boolean;
}) {
  const kinds = Object.fromEntries(actions.map(a => [a.name, a.kind])) as Record<string, ActionKind>;
  const [touched, setTouched] = useState<Record<string, boolean>>({});
  const focusKey = useRef<string | null>(null);

  useEffect(() => {
    if (!focusKey.current) return;
    const el = document.querySelector<HTMLInputElement>(`[data-dev="${focusKey.current}"] input[data-f="ip"]`);
    focusKey.current = null;
    if (el) { el.scrollIntoView({ behavior: 'smooth', block: 'center' }); el.focus(); }
  }, [devices.length]);

  const update = (i: number, patch: Partial<DraftDevice>) => onChange(devices.map((d, j) => (j === i ? { ...d, ...patch } : d)));
  const add = () => {
    if (devices.length >= LIMITS.maxDevices) return;
    const d = emptyDevice(devices[devices.length - 1]);
    focusKey.current = d.key;
    onChange([...devices, d]);
  };
  const remove = (i: number) => {
    if (!confirm(`Удалить устройство ${i + 1}?`)) return;
    onChange(devices.filter((_, j) => j !== i));
  };

  return (
    <div>
      {devices.map((d, i) => {
        const errs = deviceErrors(d, devices, kinds, showAllErrors);
        const show = (f: keyof DraftDevice) => (showAllErrors || touched[d.key + f]) && errs[f];
        const repl = kinds[d.action] === 'replace';
        const kind = kinds[d.action];
        const reg = registry && d.ip.trim() && (kind === 'install' || (repl && d.ip.trim() !== d.oldIp.trim()))
          ? registry.find(r => r.ip === d.ip.trim()) : null;
        const blur = (f: keyof DraftDevice) => () => setTouched(t => ({ ...t, [d.key + f]: true }));
        const field = (f: keyof DraftDevice, label: string, extra: React.InputHTMLAttributes<HTMLInputElement> = {}, wide = false) => (
          <label className={wide ? 'col-span-2' : ''}>
            <span className="label mt-2">{label}</span>
            <input
              className={`input ${show(f) ? 'bad' : ''}`}
              data-f={f}
              value={d[f]}
              onChange={e => {
                let v = e.target.value;
                if (f === 'ip' || f === 'oldIp') v = normalizeIpInput(v);
                update(i, { [f]: v });
              }}
              onBlur={blur(f)}
              {...extra}
            />
          </label>
        );
        const visibleErrs = showAllErrors ? Object.values(errs).filter(Boolean) : (Object.keys(errs) as (keyof DraftDevice)[]).filter(f => touched[d.key + f]).map(f => errs[f]);
        return (
          <div key={d.key} data-dev={d.key} className="mb-3 rounded-xl border border-slate-200 p-3">
            <div className="flex items-center justify-between">
              <b>Устройство {i + 1}</b>
              <button type="button" className="text-sm text-red-600" onClick={() => remove(i)}>Удалить</button>
            </div>
            <div className="grid grid-cols-2 gap-x-3">
              <label>
                <span className="label mt-2">Тип *</span>
                <select className={`input ${show('type') ? 'bad' : ''}`} value={d.type} onChange={e => update(i, { type: e.target.value })} onBlur={blur('type')}>
                  <option value="">— выберите —</option>
                  {types.map(t => <option key={t}>{t}</option>)}
                  {d.type && !types.includes(d.type) && <option>{d.type}</option>}
                </select>
              </label>
              <label>
                <span className="label mt-2">Действие</span>
                <select className="input" value={d.action} onChange={e => update(i, { action: e.target.value })}>
                  <option value="">— выберите —</option>
                  {actions.map(a => <option key={a.name}>{a.name}</option>)}
                </select>
              </label>
              {repl && <div className="col-span-2 mt-3 text-[13px] font-semibold">Новое (установленное) устройство</div>}
              {field('ip', 'IP-адрес *', { inputMode: 'decimal', placeholder: '192.168.1.10', autoComplete: 'off' })}
              {field('model', 'Модель')}
              {field('mac', 'MAC', { placeholder: 'AA:BB:CC:DD:EE:FF', autoCapitalize: 'characters', autoComplete: 'off' })}
              {field('serial', 'Серийный №', { autoComplete: 'off' })}
              {field('place', 'Место установки', { placeholder: '3 этаж, коридор' }, true)}
            </div>
            {repl && (
              <div className="mt-3 rounded-lg bg-amber-50 p-3 pt-1">
                <div className="mt-2 text-[13px] font-semibold">Снятое (старое) устройство</div>
                <div className="grid grid-cols-2 gap-x-3">
                  {field('oldIp', 'Старый IP *', { inputMode: 'decimal', placeholder: '192.168.1.5', autoComplete: 'off' })}
                  {field('oldModel', 'Старая модель')}
                  {field('oldMac', 'Старый MAC', { placeholder: 'AA:BB:CC:DD:EE:FF', autoCapitalize: 'characters' })}
                  {field('oldSerial', 'Старый серийный №')}
                </div>
              </div>
            )}
            {reg && (
              <p className="mt-2 rounded-lg bg-amber-50 p-2 text-[13px] text-amber-800">
                Этот IP уже числится на объекте: {reg.typeName}{reg.model ? `, ${reg.model}` : ''}{reg.place ? `, ${reg.place}` : ''}. Проверьте, не ошибка ли.
              </p>
            )}
            {visibleErrs.length > 0 && <p className="err-text">{visibleErrs.join('; ')}</p>}
          </div>
        );
      })}
      <button type="button" className="btn-secondary w-full" onClick={add} disabled={devices.length >= LIMITS.maxDevices}>
        + Добавить устройство
      </button>
      {devices.length > 0 && <p className="hint text-center">{devices.length} из {LIMITS.maxDevices}</p>}
    </div>
  );
}

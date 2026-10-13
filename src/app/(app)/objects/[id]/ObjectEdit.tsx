'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { postJson } from '@/client/http';

type Obj = { id: number; name: string; cityId: number | null; address: string; lat: number | null; lng: number | null; active: boolean };

export function ObjectEdit({ object, cities }: { object: Obj; cities: { id: number; name: string }[] }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [f, setF] = useState({ ...object, coords: object.lat != null ? `${object.lat}, ${object.lng}` : '' });
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);

  if (!open) return <button className="link mt-2 text-sm" onClick={() => setOpen(true)}>Редактировать объект</button>;

  const save = async () => {
    setErr('');
    let lat: number | null = null, lng: number | null = null;
    if (f.coords.trim()) {
      const m = f.coords.replace(/\s+/g, ' ').match(/^(-?\d+(?:[.,]\d+)?)[ ,;]+(-?\d+(?:[.,]\d+)?)$/);
      if (!m) { setErr('Координаты в формате «51.128207, 71.430411»'); return; }
      lat = Number(m[1].replace(',', '.')); lng = Number(m[2].replace(',', '.'));
    }
    setBusy(true);
    try {
      await postJson(`/api/admin/objects/${object.id}`, { name: f.name, cityId: f.cityId, address: f.address, lat, lng, active: f.active }, 'PATCH');
      setOpen(false);
      router.refresh();
    } catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
  };

  return (
    <div className="mt-3 grid gap-2 rounded-lg bg-slate-50 p-3 sm:grid-cols-2">
      <label><span className="label mt-0">Название</span><input className="input" value={f.name} onChange={e => setF({ ...f, name: e.target.value })} /></label>
      <label><span className="label mt-0">Город (справочно)</span>
        <select className="input" value={f.cityId ?? ''} onChange={e => setF({ ...f, cityId: e.target.value ? Number(e.target.value) : null })}>
          <option value="">—</option>{cities.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
      </label>
      <label className="sm:col-span-2"><span className="label mt-0">Адрес</span><input className="input" value={f.address} onChange={e => setF({ ...f, address: e.target.value })} /></label>
      <label><span className="label mt-0">Координаты (широта, долгота)</span><input className="input" value={f.coords} placeholder="51.128207, 71.430411" onChange={e => setF({ ...f, coords: e.target.value })} /></label>
      <label className="flex items-center gap-2 self-end pb-3 text-sm"><input type="checkbox" className="h-5 w-5" checked={f.active} onChange={e => setF({ ...f, active: e.target.checked })} /> Активен</label>
      {err && <p className="err-text sm:col-span-2">{err}</p>}
      <div className="flex gap-2 sm:col-span-2">
        <button className="btn-primary" disabled={busy} onClick={() => void save()}>Сохранить</button>
        <button className="btn-ghost" onClick={() => setOpen(false)}>Отмена</button>
      </div>
    </div>
  );
}

'use client';

import 'leaflet/dist/leaflet.css';
import { useEffect, useRef } from 'react';

type P = { lat: number; lng: number; acc?: number | null };

// Мини-карта с точками приезда (синяя) и завершения (зелёная), объект — красный.
export function MiniMap({ arrival, finish, object }: { arrival: P | null; finish: P | null; object: P | null }) {
  const el = useRef<HTMLDivElement>(null);
  const has = arrival || finish;

  useEffect(() => {
    if (!el.current || !has) return;
    let map: import('leaflet').Map | null = null;
    let cancelled = false;
    (async () => {
      const L = await import('leaflet');
      if (cancelled || !el.current) return;
      map = L.map(el.current, { scrollWheelZoom: false, attributionControl: true });
      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        maxZoom: 19, attribution: '© OpenStreetMap',
      }).addTo(map);
      const pts: [number, number][] = [];
      const add = (p: P | null, color: string, label: string) => {
        if (!p) return;
        pts.push([p.lat, p.lng]);
        L.circleMarker([p.lat, p.lng], { radius: 8, color: '#fff', weight: 2, fillColor: color, fillOpacity: 1 })
          .bindTooltip(label + (p.acc ? ` (±${p.acc} м)` : '')).addTo(map!);
        if (p.acc && p.acc < 2000) L.circle([p.lat, p.lng], { radius: p.acc, color, weight: 1, fillOpacity: 0.08 }).addTo(map!);
      };
      add(object, '#dc2626', 'Объект');
      add(arrival, '#1a56db', 'Приезд');
      add(finish, '#16a34a', 'Завершение');
      if (pts.length === 1) map.setView(pts[0], 16);
      else map.fitBounds(L.latLngBounds(pts), { padding: [30, 30], maxZoom: 17 });
    })();
    return () => { cancelled = true; map?.remove(); };
  }, [arrival, finish, object, has]);

  if (!has) return <div className="rounded-lg bg-slate-50 p-3 text-sm text-slate-500">Геометки не получены — карты нет.</div>;
  return (
    <div>
      <div ref={el} className="z-0 h-56 w-full overflow-hidden rounded-lg bg-slate-100" />
      <p className="mt-1 text-xs text-slate-500">
        <span className="text-[#1a56db]">●</span> приезд <span className="ml-2 text-green-600">●</span> завершение
        {object && <><span className="ml-2 text-red-600">●</span> объект</>}
      </p>
    </div>
  );
}

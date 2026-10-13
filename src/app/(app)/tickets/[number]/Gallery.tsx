'use client';

import { useCallback, useEffect, useState } from 'react';

type Photo = { id: string; name: string; takenAt: string | null };

// Галерея миниатюр; по нажатию — просмотр на весь экран с листанием и скачиванием.
export function Gallery({ title, photos }: { title: string; photos: Photo[] }) {
  const [open, setOpen] = useState<number | null>(null);
  const prev = useCallback(() => setOpen(i => (i == null ? i : (i - 1 + photos.length) % photos.length)), [photos.length]);
  const next = useCallback(() => setOpen(i => (i == null ? i : (i + 1) % photos.length)), [photos.length]);

  useEffect(() => {
    if (open == null) return;
    const h = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(null);
      if (e.key === 'ArrowLeft') prev();
      if (e.key === 'ArrowRight') next();
    };
    window.addEventListener('keydown', h);
    document.body.style.overflow = 'hidden';
    return () => { window.removeEventListener('keydown', h); document.body.style.overflow = ''; };
  }, [open, prev, next]);

  const [touchX, setTouchX] = useState<number | null>(null);

  return (
    <div>
      <div className="label">{title} ({photos.length})</div>
      {!photos.length && <p className="text-sm text-slate-400">Нет</p>}
      <div className="flex flex-wrap gap-2">
        {photos.map((p, i) => (
          <button key={p.id} type="button" onClick={() => setOpen(i)} className="h-24 w-24 overflow-hidden rounded-lg bg-slate-200">
            <img src={`/api/files/${p.id}?thumb=1`} alt={p.name} loading="lazy" className="h-full w-full object-cover" />
          </button>
        ))}
      </div>
      {open != null && photos[open] && (
        <div
          className="fixed inset-0 z-50 flex flex-col bg-black/95 text-white"
          onTouchStart={e => setTouchX(e.touches[0].clientX)}
          onTouchEnd={e => {
            if (touchX == null) return;
            const dx = e.changedTouches[0].clientX - touchX;
            if (dx > 50) prev();
            if (dx < -50) next();
            setTouchX(null);
          }}
        >
          <div className="flex items-center gap-3 p-3 text-sm">
            <span>{title}: {open + 1} из {photos.length}{photos[open].takenAt && ` · снято ${photos[open].takenAt}`}</span>
            <a className="ml-auto rounded bg-white/15 px-3 py-1.5" href={`/api/files/${photos[open].id}?download=1`}>Скачать</a>
            <button className="rounded bg-white/15 px-3 py-1.5 text-lg leading-none" onClick={() => setOpen(null)} aria-label="Закрыть">×</button>
          </div>
          <div className="relative flex min-h-0 flex-1 items-center justify-center">
            <img src={`/api/files/${photos[open].id}`} alt={photos[open].name} className="max-h-full max-w-full object-contain" />
            {photos.length > 1 && (
              <>
                <button className="absolute top-1/2 left-2 -translate-y-1/2 rounded-full bg-white/15 px-4 py-3 text-2xl" onClick={prev} aria-label="Назад">‹</button>
                <button className="absolute top-1/2 right-2 -translate-y-1/2 rounded-full bg-white/15 px-4 py-3 text-2xl" onClick={next} aria-label="Вперёд">›</button>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

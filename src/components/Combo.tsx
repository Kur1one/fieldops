'use client';

import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { norm } from '@/lib/shared/text';

export type ComboItem<T> = {
  id: string;
  label: string;
  sub?: string;
  key: string; // norm(label + доп. поля) — считается один раз
  value: T;
  accent?: boolean;
};

export function comboKey(...parts: (string | null | undefined)[]) {
  return norm(parts.filter(Boolean).join(' '));
}

const SHOW = 60;

// Поле с быстрым поиском: несколько слов в любом порядке, без учёта регистра, ё/е, точек и дефисов.
export function Combo<T>({
  items, text, onText, onPick, placeholder, emptyText, invalid, disabled, inputMode, id,
}: {
  items: ComboItem<T>[];
  text: string;
  onText: (s: string) => void;
  onPick: (item: ComboItem<T>) => void;
  placeholder?: string;
  emptyText?: string;
  invalid?: boolean;
  disabled?: boolean;
  inputMode?: 'text' | 'search';
  id?: string;
}) {
  const [open, setOpen] = useState(false);
  const [typed, setTyped] = useState(false);
  const wrap = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const listId = useId();

  const filtered = useMemo(() => {
    if (!typed) return items;
    const words = norm(text).split(' ').filter(Boolean);
    if (!words.length) return items;
    return items.filter(it => words.every(w => it.key.includes(w)));
  }, [items, text, typed]);

  useEffect(() => {
    if (!open) return;
    const close = (e: Event) => { if (wrap.current && !wrap.current.contains(e.target as Node)) { setOpen(false); setTyped(false); } };
    document.addEventListener('mousedown', close);
    document.addEventListener('touchstart', close, { passive: true });
    return () => { document.removeEventListener('mousedown', close); document.removeEventListener('touchstart', close); };
  }, [open]);

  const pick = (it: ComboItem<T>) => { onPick(it); setOpen(false); setTyped(false); };
  const shown = filtered.slice(0, SHOW);

  return (
    <div ref={wrap} className="relative">
      <input
        ref={input}
        id={id}
        className={`input pr-10 ${invalid ? 'bad' : ''}`}
        value={text}
        placeholder={placeholder}
        disabled={disabled}
        autoComplete="off"
        inputMode={inputMode}
        role="combobox"
        aria-expanded={open}
        aria-controls={listId}
        onFocus={e => { setOpen(true); setTyped(false); const el = e.currentTarget; setTimeout(() => el.select(), 0); }}
        onChange={e => { onText(e.target.value); setTyped(true); setOpen(true); }}
        onKeyDown={e => {
          if (e.key === 'Escape') { setOpen(false); setTyped(false); }
          if (e.key === 'Enter') { e.preventDefault(); if (open && shown[0]) pick(shown[0]); }
        }}
      />
      {text && !disabled && (
        <button
          type="button"
          aria-label="Очистить"
          className="absolute top-1/2 right-1 flex h-9 w-9 -translate-y-1/2 items-center justify-center rounded-full text-xl text-slate-400 hover:bg-slate-100"
          onClick={() => { onText(''); setTyped(false); setOpen(true); input.current?.focus(); }}
        >
          ×
        </button>
      )}
      {open && (
        <div id={listId} role="listbox" className="absolute inset-x-0 top-[calc(100%+2px)] z-40 max-h-80 overflow-y-auto rounded-lg border border-slate-200 bg-white shadow-lg">
          {shown.map(it => (
            <div
              key={it.id}
              role="option"
              aria-selected={false}
              className={`cursor-pointer border-b border-slate-100 px-3 py-2.5 text-[15px] active:bg-brand-50 hover:bg-brand-50 ${it.accent ? 'bg-amber-50' : ''}`}
              onMouseDown={e => e.preventDefault()}
              onClick={() => pick(it)}
            >
              {it.label}
              {it.sub && <small className="mt-0.5 block text-xs text-slate-500">{it.sub}</small>}
            </div>
          ))}
          {filtered.length > shown.length && (
            <div className="px-3 py-2.5 text-[13px] text-slate-500">… ещё {filtered.length - shown.length}, уточните поиск</div>
          )}
          {!filtered.length && <div className="px-3 py-2.5 text-[13px] text-slate-500">{emptyText ?? 'Ничего не найдено'}</div>}
        </div>
      )}
    </div>
  );
}

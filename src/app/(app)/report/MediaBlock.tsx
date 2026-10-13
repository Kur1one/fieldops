'use client';

import type { DraftFile } from '@/client/idb';
import { fmtBytes } from '@/lib/shared/format';

export function MediaBlock({
  title, files, thumbs, accept, onAdd, onRemove, busy, limitText,
}: {
  title: string;
  files: DraftFile[];
  thumbs: Record<string, string>;
  accept: 'image/*' | 'video/*';
  onAdd: (list: File[]) => void;
  onRemove: (fileId: string) => void;
  busy?: string;
  limitText: string;
}) {
  const video = accept === 'video/*';
  return (
    <div className="mt-3">
      <div className="label">{title}</div>
      <label className="btn-secondary cursor-pointer">
        {video ? '+ Добавить видео' : '+ Добавить фото'}
        <input
          type="file"
          accept={accept}
          multiple
          className="hidden"
          onChange={e => { const l = Array.from(e.target.files ?? []); e.target.value = ''; if (l.length) onAdd(l); }}
        />
      </label>
      <span className="hint ml-2">{limitText}</span>
      {busy && <p className="hint">{busy}</p>}
      {files.length > 0 && (
        <div className={video ? 'mt-2 space-y-2' : 'mt-2 flex flex-wrap gap-2'}>
          {files.map(f => video ? (
            <div key={f.fileId} className="relative rounded-lg border border-slate-200 bg-slate-50 py-2.5 pr-10 pl-3 text-sm">
              {f.name} — {fmtBytes(f.size)} {f.uploaded && <span className="text-green-700">✓ загружено</span>}
              <RemoveBtn onClick={() => onRemove(f.fileId)} />
            </div>
          ) : (
            <div key={f.fileId} className="relative h-21 w-21 overflow-hidden rounded-lg bg-slate-200">
              {thumbs[f.fileId] && <img src={thumbs[f.fileId]} alt="" className="h-full w-full object-cover" />}
              {f.uploaded && <span className="absolute bottom-0.5 left-0.5 rounded bg-green-600 px-1 text-[11px] text-white">✓</span>}
              <RemoveBtn onClick={() => onRemove(f.fileId)} />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function RemoveBtn({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      aria-label="Убрать"
      onClick={onClick}
      className="absolute top-1 right-1 flex h-7 w-7 items-center justify-center rounded-full bg-black/60 text-base text-white"
    >
      ×
    </button>
  );
}

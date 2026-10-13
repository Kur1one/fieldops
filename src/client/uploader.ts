// Загрузка файла частями с докачкой: обрыв связи не обнуляет прогресс, уже принятые части не грузятся заново.
import type { FileKind } from '@/lib/shared/constants';
import { ApiError, NetworkError, postJson, request } from './http';

type UploadState = { fileId: string; status: 'uploading' | 'done'; size: number; chunkBytes: number; receivedParts: number[] };

export type UploadMeta = {
  fileId: string; ownerKey: string; kind: FileKind; seq: number; name: string; mime: string; size: number; takenAt: string | null;
};

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

export async function uploadFile(meta: UploadMeta, blob: Blob, onProgress: (sent: number) => void): Promise<void> {
  let state = await withRetry(() => postJson<UploadState>('/api/uploads', meta));
  if (state.status === 'done') { onProgress(meta.size); return; }
  const chunk = state.chunkBytes;
  const total = Math.max(1, Math.ceil(meta.size / chunk));
  const have = new Set(state.receivedParts);
  const sentBytes = () => [...have].reduce((s, n) => s + Math.min(chunk, meta.size - (n - 1) * chunk), 0);
  onProgress(sentBytes());

  for (let n = 1; n <= total; n++) {
    if (have.has(n)) continue;
    const part = blob.slice((n - 1) * chunk, Math.min(n * chunk, meta.size));
    state = await withRetry(() => request<UploadState>(`/api/uploads/${meta.fileId}/parts/${n}`, {
      method: 'PUT', headers: { 'Content-Type': 'application/octet-stream' }, body: part,
    }));
    state.receivedParts.forEach(p => have.add(p));
    have.add(n);
    onProgress(sentBytes());
  }
  await withRetry(() => postJson<UploadState>(`/api/uploads/${meta.fileId}/complete`, {}));
  onProgress(meta.size);
}

// Автоповтор до 5 раз с растущей паузой; ошибки сервера (4xx) не повторяем.
export async function withRetry<T>(fn: () => Promise<T>, tries = 5): Promise<T> {
  for (let i = 0; ; i++) {
    try {
      return await fn();
    } catch (e) {
      if (e instanceof ApiError || i >= tries - 1) throw e;
      if (!(e instanceof NetworkError)) throw e;
      await sleep(2000 * (i + 1));
    }
  }
}

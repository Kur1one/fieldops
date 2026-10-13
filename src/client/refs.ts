'use client';

import { useCallback, useEffect, useState } from 'react';
import type { FormRefs } from '@/lib/server/queries';
import { request } from './http';
import { kvGet, kvSet, LAST_USER_KEY, refsKey } from './idb';

export type { FormRefs };

// Справочники и заявки: с сервера, а без связи — из последней сохранённой копии.
export function useRefs() {
  const [refs, setRefs] = useState<FormRefs | null>(null);
  const [fromCache, setFromCache] = useState(false);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    try {
      const r = await request<FormRefs>('/api/refs', { cache: 'no-store' });
      setRefs(r);
      setFromCache(false);
      setError('');
      await kvSet(refsKey(r.me.id), r);
      await kvSet(LAST_USER_KEY, r.me.id);
    } catch (e) {
      const uid = await kvGet<number>(LAST_USER_KEY);
      const cached = uid ? await kvGet<FormRefs>(refsKey(uid)) : undefined;
      if (cached) {
        setRefs(prev => prev ?? cached);
        setFromCache(true);
      } else {
        setError((e as Error).message || 'Не удалось загрузить справочники');
      }
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    // сначала мгновенно показываем копию, потом обновляем с сервера
    (async () => {
      const uid = await kvGet<number>(LAST_USER_KEY).catch(() => undefined);
      const cached = uid ? await kvGet<FormRefs>(refsKey(uid)).catch(() => undefined) : undefined;
      if (cached && !cancelled) { setRefs(prev => prev ?? cached); setFromCache(true); }
      await load();
    })();
    return () => { cancelled = true; };
  }, [load]);

  return { refs, fromCache, error, reload: load };
}

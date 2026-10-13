'use client';

import { useEffect } from 'react';

// Сообщает серверу часовой пояс браузера и регистрирует service worker (работа без связи).
export function ClientBoot() {
  useEffect(() => {
    try {
      const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
      if (tz) document.cookie = `tz=${encodeURIComponent(tz)}; path=/; max-age=31536000; samesite=lax`;
    } catch {}
    if ('serviceWorker' in navigator && process.env.NODE_ENV === 'production') {
      navigator.serviceWorker.register('/sw.js', { scope: '/' }).catch(e => console.warn('SW', e));
    }
  }, []);
  return null;
}

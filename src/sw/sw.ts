/// <reference lib="webworker" />
// Service worker: страница отчёта открывается без сети (если её хоть раз открывали),
// очередь отчётов отправляется в фоне, когда появляется связь (Background Sync).
import { processOutbox } from '../client/outbox';

declare const self: ServiceWorkerGlobalScope;
declare const __BUILD_ID__: string;

const PAGES = `pages-${__BUILD_ID__}`;
const STATIC = 'static-v1';
const ASSETS = `assets-${__BUILD_ID__}`;

self.addEventListener('install', () => {
  void self.skipWaiting();
});

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const keep = new Set([PAGES, STATIC, ASSETS]);
    for (const k of await caches.keys()) if (!keep.has(k)) await caches.delete(k);
    await self.clients.claim();
  })());
});

const OFFLINE_HTML = `<!doctype html><html lang="ru"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Нет связи</title><body style="font-family:system-ui;padding:24px;max-width:480px;margin:auto">
<h1 style="font-size:20px">Нет связи</h1><p>Эта страница ещё не сохранена на телефоне. Форма отчёта работает без связи, если её хотя бы раз открыли с интернетом.</p>
<p><a href="/report">Открыть форму отчёта</a></p></body></html>`;

async function networkFirstPage(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const key = url.origin + url.pathname; // без параметров: /report?ticket=… берётся из той же копии
  const cache = await caches.open(PAGES);
  try {
    const res = await fetch(req);
    if (res.ok && !res.redirected && res.type === 'basic') await cache.put(key, res.clone());
    return res;
  } catch {
    const hit = (await cache.match(key)) ?? (url.pathname.startsWith('/report') ? await cache.match(url.origin + '/report') : undefined);
    return hit ?? new Response(OFFLINE_HTML, { headers: { 'Content-Type': 'text/html; charset=utf-8' } });
  }
}

async function cacheFirst(req: Request, name: string): Promise<Response> {
  const cache = await caches.open(name);
  const hit = await cache.match(req);
  if (hit) return hit;
  const res = await fetch(req);
  if (res.ok) await cache.put(req, res.clone());
  return res;
}

async function staleWhileRevalidate(req: Request, name: string): Promise<Response> {
  const cache = await caches.open(name);
  const hit = await cache.match(req);
  const fresh = fetch(req).then(async res => { if (res.ok) await cache.put(req, res.clone()); return res; }).catch(() => undefined);
  return hit ?? (await fresh) ?? Response.error();
}

self.addEventListener('fetch', event => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith('/api/')) return; // данные — только с сервера
  if (req.headers.get('RSC') || url.searchParams.has('_rsc')) return;

  if (req.mode === 'navigate') {
    event.respondWith(networkFirstPage(req));
  } else if (url.pathname.startsWith('/_next/static/')) {
    event.respondWith(cacheFirst(req, STATIC));
  } else if (url.pathname.startsWith('/icons/') || url.pathname === '/manifest.webmanifest') {
    event.respondWith(staleWhileRevalidate(req, ASSETS));
  }
});

type SyncEvent = ExtendableEvent & { tag: string };
self.addEventListener('sync', (event: Event) => {
  const e = event as SyncEvent;
  if (e.tag === 'outbox') e.waitUntil(processOutbox());
});

self.addEventListener('message', event => {
  if (event.data?.type === 'process-outbox') event.waitUntil(processOutbox());
});

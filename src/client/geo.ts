import type { GeoStamp } from './idb';

// Координаты от браузера: высокая точность, таймаут 20 с. Ошибка не мешает отметить время.
export function getGeo(): Promise<Omit<GeoStamp, 'time'>> {
  return new Promise(resolve => {
    if (!('geolocation' in navigator)) return resolve({ error: 'телефон не поддерживает геолокацию' });
    navigator.geolocation.getCurrentPosition(
      p => resolve({
        lat: Math.round(p.coords.latitude * 1e6) / 1e6,
        lng: Math.round(p.coords.longitude * 1e6) / 1e6,
        acc: Math.round(p.coords.accuracy),
      }),
      e => resolve({
        error: ({ 1: 'доступ к геолокации запрещён', 2: 'местоположение недоступно', 3: 'не успели определить за 20 секунд' } as Record<number, string>)[e.code] || e.message,
      }),
      { enableHighAccuracy: true, timeout: 20000, maximumAge: 0 },
    );
  });
}

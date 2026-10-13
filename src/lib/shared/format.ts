// Форматирование дат: хранение в UTC, показ в поясе пользователя, формат дд.мм.гггг чч:мм.

export function isValidTz(tz: string | undefined | null): tz is string {
  if (!tz) return false;
  try {
    new Intl.DateTimeFormat('ru-RU', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

function parts(d: Date, tz: string) {
  const f = new Intl.DateTimeFormat('ru-RU', {
    timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  });
  const o: Record<string, string> = {};
  for (const p of f.formatToParts(d)) o[p.type] = p.value;
  return o;
}

export function fmtDateTime(v: Date | string | null | undefined, tz: string): string {
  if (!v) return '';
  const d = typeof v === 'string' ? new Date(v) : v;
  if (isNaN(d.getTime())) return '';
  const p = parts(d, tz);
  return `${p.day}.${p.month}.${p.year} ${p.hour}:${p.minute}`;
}

export function fmtDate(v: Date | string | null | undefined, tz?: string): string {
  if (!v) return '';
  // дата без времени (YYYY-MM-DD) — показываем как есть
  if (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v)) {
    const [y, m, d] = v.split('-');
    return `${d}.${m}.${y}`;
  }
  const d = typeof v === 'string' ? new Date(v) : v;
  const p = parts(d, tz || 'UTC');
  return `${p.day}.${p.month}.${p.year}`;
}

// Сегодняшняя дата в поясе пользователя в виде YYYY-MM-DD.
export function todayIso(tz: string, now = new Date()): string {
  const p = parts(now, tz);
  return `${p.year}-${p.month}-${p.day}`;
}

export function fmtDuration(minutes: number | null | undefined): string {
  const m = Math.max(0, Math.round(minutes ?? 0));
  return `${Math.floor(m / 60)}:${String(m % 60).padStart(2, '0')}`;
}

export function fmtBytes(n: number): string {
  if (n < 1024 * 1024) return (n / 1024).toFixed(0) + ' КБ';
  return (n / 1024 / 1024).toFixed(1).replace('.', ',') + ' МБ';
}

export function mapLink(lat: number, lng: number): string {
  return `https://yandex.kz/maps/?pt=${lng},${lat}&z=17&l=map`;
}

export function addressMapLink(address: string): string {
  return `https://yandex.kz/maps/?text=${encodeURIComponent(address)}`;
}

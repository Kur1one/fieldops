// Проверки IP и MAC — общие для формы и сервера (раздел 8.1 ТЗ).

const OCTET = '(25[0-5]|2[0-4]\\d|1\\d\\d|[1-9]?\\d)';
export const IP_RE = new RegExp(`^${OCTET}(\\.${OCTET}){3}$`);
export const MAC_RE = /^([0-9A-F]{2}[:-]){5}[0-9A-F]{2}$/i;

// «192,168,1,10 » → «192.168.1.10»
export function normalizeIpInput(s: string): string {
  return String(s ?? '').replace(/,/g, '.').replace(/\s+/g, '');
}

export function isValidIp(s: string): boolean {
  return IP_RE.test(normalizeIpInput(s));
}

export function normalizeMac(s: string): string {
  return String(s ?? '').trim().toUpperCase();
}

export function isValidMac(s: string): boolean {
  const v = normalizeMac(s);
  if (!MAC_RE.test(v)) return false;
  // разделитель один и тот же по всей строке
  return !(v.includes(':') && v.includes('-'));
}

// Расстояние между точками, метры (гаверсинус).
export function distanceMeters(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return Math.round(2 * R * Math.asin(Math.sqrt(a)));
}

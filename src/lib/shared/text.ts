// Нормализация для поиска и сравнения: регистр, ё/е, точки, дефисы, лишние пробелы.
export function norm(s: unknown): string {
  return String(s ?? '')
    .toLowerCase()
    .replace(/ё/g, 'е')
    .replace(/[.,\-_/\\()«»"'’`:;!?#№]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// Поиск по нескольким словам в любом порядке: «arena park» → «Arena City Park C».
export function matchesWords(haystackKey: string, query: string): boolean {
  const words = norm(query).split(' ').filter(Boolean);
  return words.every(w => haystackKey.includes(w));
}

const TRANSLIT: Record<string, string> = {
  а: 'a', б: 'b', в: 'v', г: 'g', д: 'd', е: 'e', ё: 'e', ж: 'zh', з: 'z', и: 'i', й: 'y', к: 'k', л: 'l',
  м: 'm', н: 'n', о: 'o', п: 'p', р: 'r', с: 's', т: 't', у: 'u', ф: 'f', х: 'h', ц: 'ts', ч: 'ch', ш: 'sh',
  щ: 'sch', ъ: '', ы: 'y', ь: '', э: 'e', ю: 'yu', я: 'ya', ә: 'a', ғ: 'g', қ: 'k', ң: 'n', ө: 'o', ұ: 'u',
  ү: 'u', һ: 'h', і: 'i',
};

// Предлагаемый код города транслитерацией: Семей → SEM. Занятые коды обходятся.
export function suggestCityCode(city: string, used: string[] = []): string {
  const base = String(city).toLowerCase().split('').map(ch => TRANSLIT[ch] ?? ch).join('')
    .replace(/[^a-z]/g, '').toUpperCase();
  const padded = (base + 'XXX').slice(0, Math.max(3, base.length));
  const taken = new Set(used.map(u => u.toUpperCase()));
  const first = padded.slice(0, 3);
  if (!taken.has(first)) return first;
  // перебор: первая буква + любые две следующие из названия, затем + любые латинские
  for (let i = 1; i < padded.length; i++) {
    for (let j = i + 1; j < padded.length; j++) {
      const c = padded[0] + padded[i] + padded[j];
      if (!taken.has(c)) return c;
    }
  }
  const AZ = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
  for (const a of AZ) for (const b of AZ) {
    const c = padded[0] + a + b;
    if (!taken.has(c)) return c;
  }
  return first;
}

export function formatTicketNumber(code: string, n: number): string {
  return code + '-' + String(n).padStart(4, '0');
}

// Защита от формул при выгрузке в таблицы и от случайного мусора.
export function cleanText(s: unknown, max: number): string {
  return String(s ?? '').replace(/\u0000/g, '').replace(/\r\n/g, '\n').trim().slice(0, max);
}

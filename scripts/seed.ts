/**
 * Начальные данные: 23 города, 399 объектов, справочники устройств и приоритетов,
 * первый руководитель (SEED_ADMIN_EMAIL / SEED_ADMIN_NAME).
 * Повторный запуск безопасен — существующие записи не трогает.
 */
import { readFileSync } from 'node:fs';
import { getDb, schema } from '../src/lib/db';
import { norm } from '../src/lib/shared/text';
import { loadEnv } from './env';

loadEnv();

const seed = JSON.parse(readFileSync('data/seed.json', 'utf8')) as {
  cities: { name: string; code: string }[];
  objects: { city: string; name: string }[];
};

const DEVICE_TYPES = ['Камера', 'Терминал', 'Коммутатор', 'Регистратор', 'Точка доступа', 'Другое'];
const ACTIONS = [
  { name: 'Установлено', kind: 'install' },
  { name: 'Настроено', kind: 'configure' },
  { name: 'Заменено', kind: 'replace' },
  { name: 'Демонтировано', kind: 'dismantle' },
  { name: 'Проверено / диагностика', kind: 'check' },
] as const;
const PRIORITIES = [
  { name: 'Аварийный', rank: 1, isDefault: false },
  { name: 'Высокий', rank: 2, isDefault: false },
  { name: 'Обычный', rank: 3, isDefault: true },
  { name: 'Низкий', rank: 4, isDefault: false },
];

async function main() {
  const db = getDb();
  await db.transaction(async tx => {
    await tx.insert(schema.cities)
      .values(seed.cities.map(c => ({ name: c.name, nameKey: norm(c.name), code: c.code })))
      .onConflictDoNothing();
    const cityRows = await tx.select().from(schema.cities);
    const cityId = new Map(cityRows.map(c => [c.nameKey, c.id]));

    await tx.insert(schema.objects)
      .values(seed.objects.map(o => ({ name: o.name, nameKey: norm(o.name), cityId: cityId.get(norm(o.city)) ?? null })))
      .onConflictDoNothing();

    await tx.insert(schema.deviceTypes)
      .values(DEVICE_TYPES.map((name, i) => ({ name, sort: (i + 1) * 10 })))
      .onConflictDoNothing();
    await tx.insert(schema.deviceActions)
      .values(ACTIONS.map((a, i) => ({ ...a, sort: (i + 1) * 10 })))
      .onConflictDoNothing();
    await tx.insert(schema.priorities).values(PRIORITIES).onConflictDoNothing();

    const email = process.env.SEED_ADMIN_EMAIL?.trim().toLowerCase();
    if (email) {
      await tx.insert(schema.employees)
        .values({ email, fullName: process.env.SEED_ADMIN_NAME?.trim() || email, role: 'manager' })
        .onConflictDoNothing();
      console.log('Руководитель:', email);
    } else {
      console.log('SEED_ADMIN_EMAIL не задан — первого руководителя не создаю');
    }
  });

  const [{ n: nc }] = await db.$count(schema.cities).then(n => [{ n }]);
  const no = await db.$count(schema.objects);
  console.log(`Городов: ${nc}, объектов: ${no}`);
  process.exit(0);
}

main().catch(e => { console.error(e); process.exit(1); });

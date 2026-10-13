// Проверка PWA в production-сборке: после первого открытия форма отчёта открывается без сети.
// Запуск: node tests/e2e-offline.mjs http://localhost:3001  (сессия создаётся напрямую в БД)
import { chromium, devices } from '@playwright/test';
import { createHash, randomBytes } from 'node:crypto';
import pg from 'pg';

const B = process.argv[2] || 'http://localhost:3001';
const db = new pg.Client({ connectionString: process.env.DATABASE_URL || 'postgres://fieldops:fieldops@localhost:54329/fieldops' });
await db.connect();
const token = randomBytes(32).toString('base64url');
const { rows } = await db.query("select id from employees where email = 'field1@example.com'");
await db.query("insert into sessions (id, employee_id, expires_at) values ($1, $2, now() + interval '1 day')",
  [createHash('sha256').update(token).digest('hex'), rows[0].id]);
await db.end();

const browser = await chromium.launch({ channel: process.env.PW_CHANNEL || 'chrome', headless: true });
const ctx = await browser.newContext({ ...devices['Pixel 7'], locale: 'ru-RU' });
await ctx.addCookies([{ name: 'fo_session', value: token, url: B }]);
const page = await ctx.newPage();
await page.goto(B + '/report');
await page.waitForSelector('text=Определено по почте');
await page.evaluate(() => navigator.serviceWorker.ready);
await page.reload(); // теперь страница идёт через service worker и попадает в кэш
await page.waitForSelector('text=Определено по почте');
await page.waitForTimeout(1000);

await ctx.setOffline(true);
await page.reload();
await page.waitForSelector('text=Определено по почте', { timeout: 15000 });
await page.waitForSelector('text=Нет связи, всё сохраняется');
await page.getByPlaceholder('Начните вводить название').fill('arena park');
const n = await page.locator('[role=option]').count();
if (n < 3) throw new Error('справочник объектов без сети не работает');
console.log('  ✓ форма открывается без сети, справочники из сохранённой копии');
await browser.close();

// Браузерная проверка страницы 3 (телефон): заявка → подстановка полей, геометки, устройства, фото,
// восстановление черновика, отправка без связи и автоматическая досылка.
// Запуск: node tests/e2e-report.mjs [http://localhost:3000]   (нужен DEV_LOGIN=true)
import { chromium, devices } from '@playwright/test';
import assert from 'node:assert/strict';
import sharp from 'sharp';
import { mkdirSync, writeFileSync } from 'node:fs';

const B = process.argv[2] || 'http://localhost:3000';
const SHOTS = 'tests/screens';
mkdirSync(SHOTS, { recursive: true });

async function apiLogin(email) {
  const r = await fetch(B + '/api/auth/dev', { method: 'POST', body: new URLSearchParams({ email }), redirect: 'manual' });
  return r.headers.getSetCookie().map(s => s.split(';')[0]).join('; ');
}
const disp = await apiLogin('disp@example.com');
const api = async (cookie, method, path, body) => {
  const r = await fetch(B + path, { method, headers: { cookie, 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
  return { status: r.status, data: await r.json().catch(() => null) };
};
const refs = (await api(disp, 'GET', '/api/refs')).data;
const field1 = refs.employees.find(e => e.fullName === 'Иванов Иван');
const city = refs.cities.find(c => c.name === 'Шымкент');
const object = refs.objects.find(o => /arena city sport e/i.test(o.name));
const created = await api(disp, 'POST', '/api/tickets', {
  cityId: city.id, objectId: object.id, address: 'пр. Тауке хана, 5', description: 'Камеры 2 этажа не пишут архив',
  assigneeId: field1.id, contact: 'Серик, +7 701 000 00 00', note: 'Ключ у охраны',
});
assert.equal(created.status, 200, JSON.stringify(created.data));
const number = created.data.number;
console.log('Заявка', number);

const photo = await sharp({ create: { width: 3000, height: 2000, channels: 3, background: '#2a7' } }).jpeg({ quality: 95 }).toBuffer();
writeFileSync('tests/.photo.jpg', photo);

const browser = await chromium.launch({ channel: process.env.PW_CHANNEL || 'msedge', headless: true });
const ctx = await browser.newContext({
  ...devices['Pixel 7'],
  locale: 'ru-RU',
  timezoneId: 'Asia/Almaty',
  geolocation: { latitude: 42.3417, longitude: 69.5901, accuracy: 15 },
  permissions: ['geolocation'],
});
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', e => errors.push(e.message));
page.on('console', m => { if (m.type() === 'error' && !m.text().includes('ERR_INTERNET_DISCONNECTED')) errors.push(m.text()); });

// вход
await page.goto(B + '/login');
await page.selectOption('select[name=email]', 'field1@example.com');
await page.click('text=Войти как сотрудник');
await page.waitForURL(/\/report/);
await page.waitForSelector('text=Определено по почте');
await page.screenshot({ path: `${SHOTS}/01-report-empty.png`, fullPage: false });

// заявка: «назначена вам» первой, выбор подставляет поля
const ticketInput = page.getByPlaceholder('Поиск: номер, объект или задача');
await ticketInput.click();
const first = page.locator('[role=option]').first();
await first.waitFor();
assert.ok((await first.textContent()).includes('назначена вам'), 'первая заявка не «назначена вам»');
await ticketInput.fill(number.toLowerCase());
await page.locator('[role=option]', { hasText: number }).first().click();
assert.equal(await page.getByPlaceholder('Начните вводить город').inputValue(), 'Шымкент');
assert.match(await page.getByPlaceholder('Начните вводить название').inputValue(), /Arena City Sport E/i);
assert.equal(await page.locator('#address').inputValue(), 'пр. Тауке хана, 5');
assert.equal(await page.locator('#task').inputValue(), 'Камеры 2 этажа не пишут архив');
console.log('  ✓ выбор заявки подставляет город, объект, адрес, задачу');

// поиск объекта по нескольким словам
const objInput = page.getByPlaceholder('Начните вводить название');
await objInput.click();
await objInput.fill('park arena');
const opts = await page.locator('[role=option]').allTextContents();
assert.ok(opts.length >= 3 && opts.every(o => /arena/i.test(o) && /park/i.test(o)), 'поиск «park arena»: ' + opts.join(' | '));
await page.keyboard.press('Escape');
await objInput.fill('');
await page.locator('[role=option]', { hasText: 'Arena City Sport E' }).first().click();
console.log('  ✓ поиск «park arena» находит Arena City Park');

// «Я на объекте»
await page.click('button:has-text("Я на объекте")');
await page.waitForSelector('text=±15 м');
console.log('  ✓ «Я на объекте» записал время и координаты');

// фото до (сжимается до 1920)
await page.locator('input[type=file][accept="image/*"]').first().setInputFiles('tests/.photo.jpg');
await page.waitForSelector('img[src^="blob:"]');

// устройства: запятая → точка, неверный MAC, замена
await page.click('text=+ Добавить устройство');
const dev1 = page.locator('[data-dev]').nth(0);
await dev1.locator('select').nth(0).selectOption('Камера');
await dev1.locator('select').nth(1).selectOption('Заменено');
await dev1.locator('input[data-f=ip]').fill('192,168,1,10');
assert.equal(await dev1.locator('input[data-f=ip]').inputValue(), '192.168.1.10');
await dev1.locator('input[data-f=mac]').fill('ZZ:00:11');
await dev1.locator('input[data-f=oldIp]').click();
await page.waitForSelector('text=формат AA:BB:CC:DD:EE:FF');
await dev1.locator('input[data-f=mac]').fill('aa:bb:cc:00:11:22');
await dev1.locator('input[data-f=oldIp]').fill('192.168.1.5');
await page.click('text=+ Добавить устройство');
const dev2 = page.locator('[data-dev]').nth(1);
assert.equal(await dev2.locator('select').nth(0).inputValue(), 'Камера', 'тип не унаследован');
await dev2.locator('select').nth(1).selectOption('Установлено');
await dev2.locator('input[data-f=ip]').fill('192.168.1.10');
await dev2.locator('input[data-f=model]').click();
await page.waitForSelector('text=IP повторяется');
await dev2.locator('input[data-f=ip]').fill('256.1.1.1');
console.log('  ✓ проверки IP/MAC и автозамена запятой');

await page.locator('#workReport').fill('Заменил камеру, настроил архив.');
await page.getByText('Выполнено полностью').click();

// попытка отправить с ошибкой IP → «Нужно исправить»
await page.click('text=Работы завершены');
await page.waitForSelector('text=Отмечено', { state: 'attached' });
await page.click('text=Отправить отчёт');
await page.waitForSelector('text=Нужно исправить');
assert.ok(await page.locator('text=Устройство 2: неверный формат IP').count());
await dev2.locator('input[data-f=ip]').fill('192.168.1.11');
console.log('  ✓ ошибки показываются списком «Нужно исправить»');
await page.screenshot({ path: `${SHOTS}/02-report-filled.png`, fullPage: true });

// черновик переживает перезагрузку (включая фото)
await page.waitForTimeout(600);
await page.reload();
await page.waitForSelector('text=Восстановлен незаконченный отчёт');
assert.equal(await page.locator('#workReport').inputValue(), 'Заменил камеру, настроил архив.');
await page.waitForSelector('img[src^="blob:"]');
assert.equal(await page.locator('[data-dev]').count(), 2);
console.log('  ✓ черновик с фото восстановлен после перезагрузки');

// отправка без связи → очередь
await ctx.setOffline(true);
await page.click('text=Отправить отчёт');
await page.waitForSelector('text=Отчёт в очереди');
await page.screenshot({ path: `${SHOTS}/03-report-queued.png` });
console.log('  ✓ без связи отчёт встал в очередь');
await page.close();

// «браузер закрыли», связь появилась, форму открыли снова — отчёт уходит сам
await ctx.setOffline(false);
const page2 = await ctx.newPage();
page2.on('pageerror', e => errors.push(e.message));
await page2.goto(B + '/report');
let status;
for (let i = 0; i < 40; i++) {
  const t = await api(disp, 'GET', '/api/refs');
  status = t.data.tickets.find(x => x.number === number)?.status ?? 'closed';
  if (status === 'closed') break;
  await page2.waitForTimeout(500);
}
assert.equal(status, 'closed', 'заявка не закрылась после досылки');
console.log('  ✓ отчёт досылается сам при появлении связи, заявка закрыта');

// карточка заявки глазами диспетчера
const dctx = await browser.newContext({ viewport: { width: 1366, height: 900 }, locale: 'ru-RU', timezoneId: 'Asia/Almaty' });
await dctx.addCookies([{ name: 'fo_session', value: disp.split('fo_session=')[1].split(';')[0], url: B }]);
const dp = await dctx.newPage();
dp.on('pageerror', e => errors.push(e.message));
await dp.goto(`${B}/tickets/${number}`);
await dp.waitForSelector('text=Завершение работ');
assert.ok(await dp.locator('text=192.168.1.5 → 192.168.1.10').count(), 'нет строки замены IP');
await dp.waitForSelector('.leaflet-container', { timeout: 20000 });
await dp.waitForTimeout(1500);
await dp.screenshot({ path: `${SHOTS}/04-ticket-card.png`, fullPage: true });
await dp.goto(`${B}/tickets?status=all`);
await dp.screenshot({ path: `${SHOTS}/05-tickets-list.png` });
await dp.goto(`${B}/tickets/new`);
await dp.screenshot({ path: `${SHOTS}/06-ticket-new.png` });
console.log('  ✓ карточка: замена IP, карта, отчёт');

await browser.close();
if (errors.length) { console.log('Ошибки в консоли браузера:\n ', [...new Set(errors)].join('\n  ')); process.exit(1); }
console.log('Браузерная проверка пройдена');

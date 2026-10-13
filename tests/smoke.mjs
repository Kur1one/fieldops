// Сквозная проверка по критериям приёмки (раздел 12) против запущенного сервера в режиме DEV_LOGIN.
// Запуск: node tests/smoke.mjs [http://localhost:3000]
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';

const B = process.argv[2] || 'http://localhost:3000';
let failures = 0;
const ok = (name) => console.log('  ✓', name);
async function step(name, fn) {
  try { await fn(); ok(name); } catch (e) { failures++; console.log('  ✗', name, '\n    ', e.message); }
}

async function login(email) {
  const r = await fetch(B + '/api/auth/dev', { method: 'POST', body: new URLSearchParams({ email }), redirect: 'manual' });
  const c = r.headers.getSetCookie().map(s => s.split(';')[0]).join('; ');
  assert.ok(c.includes('fo_session'), 'нет cookie сессии для ' + email);
  return c;
}

function client(cookie) {
  const call = async (method, path, body, raw) => {
    const r = await fetch(B + path, {
      method, headers: { cookie, ...(body && !raw ? { 'content-type': 'application/json' } : {}) },
      body: raw ? body : body ? JSON.stringify(body) : undefined, redirect: 'manual',
    });
    const ct = r.headers.get('content-type') || '';
    const data = ct.includes('json') ? await r.json() : await r.arrayBuffer();
    return { status: r.status, data, headers: r.headers };
  };
  return {
    get: p => call('GET', p), post: (p, b) => call('POST', p, b), patch: (p, b) => call('PATCH', p, b),
    put: (p, b, raw) => call('PUT', p, b, raw),
  };
}

const admin = client(await login('admin@example.com'));
const ensure = async (email, fullName, role) => {
  const r = await admin.post('/api/admin/employees', { email, fullName, role });
  if (r.status === 409) return;
  assert.equal(r.status, 200, JSON.stringify(r.data));
};
await ensure('disp@example.com', 'Диспетчер Тестовый', 'dispatcher');
await ensure('field1@example.com', 'Иванов Иван', 'field');
await ensure('field2@example.com', 'Петров Пётр', 'field');
const disp = client(await login('disp@example.com'));
const f1 = client(await login('field1@example.com'));
const f2 = client(await login('field2@example.com'));
const refs = (await disp.get('/api/refs')).data;
const city = name => refs.cities.find(c => c.name === name);
const emp = name => refs.employees.find(e => e.fullName === name);
const obj = name => refs.objects.find(o => o.name === name);
// уникальные номера в каждом прогоне: используем город, по которому номера ещё не выдавались, если он есть
const ast = city('Астана'), ala = city('Алматы');

console.log('Заявки и нумерация');
let n1, n2, n3;
await step('Диспетчер создаёт заявки: AST-xxxx подряд, ALA отдельно', async () => {
  const mk = async (c, o, extra = {}) => {
    const r = await disp.post('/api/tickets', { cityId: c.id, objectId: obj(o).id, address: 'ул. Тестовая, 1', description: 'Не работает камера на 3 этаже', ...extra });
    assert.equal(r.status, 200, JSON.stringify(r.data));
    return r.data.number;
  };
  n1 = await mk(ast, 'Arena City Park C', { assigneeId: emp('Иванов Иван').id });
  n2 = await mk(ast, 'Abyroi');
  n3 = await mk(ala, obj('Abyroi') ? 'Abyroi' : 'Abyroi');
  assert.match(n1, /^AST-\d{4,}$/);
  assert.equal(Number(n2.split('-')[1]), Number(n1.split('-')[1]) + 1);
  assert.match(n3, /^ALA-\d{4,}$/);
});

await step('20 одновременных заявок по одному городу — 20 разных номеров без пропусков', async () => {
  const c = city('Тараз');
  const res = await Promise.all(Array.from({ length: 20 }, () =>
    disp.post('/api/tickets', { cityId: c.id, objectName: 'Тест параллельный объект', address: 'адрес', description: 'параллель' })));
  res.forEach(r => assert.equal(r.status, 200, JSON.stringify(r.data)));
  const nums = res.map(r => Number(r.data.number.split('-')[1])).sort((a, b) => a - b);
  assert.equal(new Set(nums).size, 20);
  assert.equal(nums[19] - nums[0], 19, 'есть пропуски: ' + nums.join(','));
});

await step('Выездной сотрудник не может создать заявку (403)', async () => {
  const r = await f1.post('/api/tickets', { cityId: ast.id, objectName: 'x', address: 'x', description: 'x' });
  assert.equal(r.status, 403);
});

await step('Плановая дата в прошлом отклоняется', async () => {
  const r = await disp.post('/api/tickets', { cityId: ast.id, objectName: 'x', address: 'x', description: 'x', plannedDate: '2020-01-01' });
  assert.equal(r.status, 400);
});

console.log('Видимость');
await step('Назначенная заявка видна исполнителю, чужая назначенная — нет', async () => {
  const r1 = (await f1.get('/api/refs')).data.tickets.map(t => t.number);
  const r2 = (await f2.get('/api/refs')).data.tickets.map(t => t.number);
  assert.ok(r1.includes(n1), 'f1 не видит свою');
  assert.ok(!r2.includes(n1), 'f2 видит чужую назначенную');
  assert.ok(r2.includes(n2), 'f2 не видит неназначенную открытую');
  const card = await f2.get(`/api/tickets/${n1}/pdf`);
  assert.equal(card.status, 404);
});

console.log('Отчёты');
const geo = (min, lat = 51.09, lng = 71.41) => ({ time: new Date(Date.now() - min * 60000).toISOString(), lat, lng, acc: 12 });
const baseReport = (extra) => ({
  reportId: '20261013-0930-' + randomUUID().slice(0, 6).toUpperCase(),
  cityId: ast.id, objectId: obj('Arena City Park C').id, address: 'ул. Тестовая, 1',
  arrival: geo(90), finish: geo(5), task: 'камера', workReport: 'заменил камеру', workStatus: 'partial',
  devices: [], fileIds: [], clientSentAt: new Date().toISOString(), ...extra,
});

await step('Неверный IP/MAC и повтор IP не принимаются сервером', async () => {
  for (const devices of [
    [{ type: 'Камера', ip: '256.1.1.1' }],
    [{ type: 'Камера', ip: '192.168.1' }],
    [{ type: 'Камера', ip: '10.0.0.1' }, { type: 'Камера', ip: '10.0.0.1' }],
    [{ type: 'Камера', ip: '10.0.0.2', mac: 'ZZ:11:22:33:44:55' }],
    [{ type: 'Камера', action: 'Заменено', ip: '10.0.0.3' }],
  ]) {
    const r = await f1.post('/api/reports', baseReport({ ticketNumber: n1, devices }));
    assert.equal(r.status, 400, JSON.stringify(devices) + ' → ' + r.status);
  }
});

// загрузка файла частями
async function upload(c, ownerKey, kind, seq, bytes, mime) {
  const fileId = randomUUID();
  let r = await c.post('/api/uploads', { fileId, ownerKey, kind, seq, name: `f${seq}`, mime, size: bytes.length });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  const chunk = r.data.chunkBytes;
  const parts = Math.ceil(bytes.length / chunk);
  for (let n = 1; n <= parts; n++) {
    r = await c.put(`/api/uploads/${fileId}/parts/${n}`, bytes.subarray((n - 1) * chunk, n * chunk), true);
    assert.equal(r.status, 200, JSON.stringify(r.data));
  }
  r = await c.post(`/api/uploads/${fileId}/complete`, {});
  assert.equal(r.status, 200, JSON.stringify(r.data));
  return fileId;
}
const sharp = (await import('sharp')).default;
const jpeg = await sharp({ create: { width: 800, height: 600, channels: 3, background: '#3366aa' } }).jpeg().toBuffer();

let rep1;
await step('Отчёт «частично» с фото, видео (12 МБ частями) и заменой устройства; заявка → «В работе»', async () => {
  rep1 = baseReport({
    ticketNumber: n1,
    devices: [
      { type: 'Камера', action: 'Установлено', ip: '192.168.1.20', mac: 'aa:bb:cc:dd:ee:ff' },
      { type: 'Камера', action: 'Заменено', ip: '192.168.1.10', oldIp: '192.168.1.5', model: 'DS-2CD', oldModel: 'old' },
    ],
  });
  const p1 = await upload(f1, rep1.reportId, 'photo_before', 1, jpeg, 'image/jpeg');
  const p2 = await upload(f1, rep1.reportId, 'photo_after', 1, jpeg, 'image/jpeg');
  const video = Buffer.alloc(12 * 1024 * 1024 + 123, 7);
  const v1 = await upload(f1, rep1.reportId, 'video', 1, video, 'video/mp4');
  rep1.fileIds = [p1, p2, v1];
  const r = await f1.post('/api/reports', rep1);
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.equal(r.data.ticketStatus, 'in_progress');
  assert.equal(r.data.ticketNumber, n1);
});

await step('Повторная отправка того же отчёта не создаёт дубль', async () => {
  const r = await f1.post('/api/reports', rep1);
  assert.equal(r.status, 200);
  assert.equal(r.data.duplicate, true);
});

await step('Чужой сотрудник не может скачать файл отчёта', async () => {
  const r = await f2.get(`/api/files/${rep1.fileIds[0]}`);
  assert.equal(r.status, 403);
  const r2 = await disp.get(`/api/files/${rep1.fileIds[0]}?thumb=1`);
  assert.equal(r2.status, 200);
});

await step('Отчёт «полностью» закрывает заявку, суммарное время считается', async () => {
  const r = await f1.post('/api/reports', baseReport({ ticketNumber: n1, workStatus: 'full', devices: [{ type: 'Коммутатор', ip: '192.168.1.20', action: 'Демонтировано' }] }));
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.equal(r.data.ticketStatus, 'done');
});

await step('Отчёт по закрытой заявке подать нельзя (409)', async () => {
  const r = await f1.post('/api/reports', baseReport({ ticketNumber: n1, workStatus: 'full' }));
  assert.equal(r.status, 409);
});

await step('Внеплановый выезд создаёт заявку автоматически', async () => {
  const r = await f2.post('/api/reports', baseReport({ workStatus: 'revisit', objectId: null, objectName: 'Новый объект из отчёта ' + Date.now() }));
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.match(r.data.ticketNumber, /^AST-/);
  assert.equal(r.data.ticketStatus, 'revisit');
});

await step('Выездной не может менять статус / отменять заявку (403)', async () => {
  assert.equal((await f1.post(`/api/tickets/${n2}/status`, { status: 'cancelled', reason: 'x' })).status, 403);
  assert.equal((await f1.patch(`/api/tickets/${n2}`, { assigneeId: null })).status, 403);
});

await step('Отмена без причины не проходит, с причиной — проходит; переоткрытие → «Повторный выезд»', async () => {
  assert.equal((await disp.post(`/api/tickets/${n2}/status`, { status: 'cancelled' })).status, 400);
  assert.equal((await disp.post(`/api/tickets/${n2}/status`, { status: 'cancelled', reason: 'дубль' })).status, 200);
  assert.equal((await disp.post(`/api/tickets/${n2}/status`, { status: 'revisit' })).status, 200);
});

console.log('Список, выгрузка, PDF');
await step('Поиск по IP устройства находит заявку', async () => {
  const r = await disp.get('/tickets?status=all&q=192.168.1.5');
  const html = Buffer.from(r.data).toString();
  assert.ok(html.includes(n1), 'заявка не найдена по старому IP');
});

await step('Выгрузка Excel и PDF формируются', async () => {
  const x = await disp.get('/api/tickets/export?status=all');
  assert.equal(x.status, 200);
  assert.ok(x.headers.get('content-type').includes('spreadsheet'));
  const p = await disp.get(`/api/tickets/${n1}/pdf`);
  assert.equal(p.status, 200);
  assert.equal(Buffer.from(p.data).subarray(0, 4).toString(), '%PDF');
  assert.equal((await f1.get('/api/tickets/export')).status, 403);
});

await step('Реестр: 192.168.1.5 снят, 192.168.1.10 стоит, 192.168.1.20 демонтирован', async () => {
  const r = await f1.get(`/api/objects/${obj('Arena City Park C').id}/devices`);
  const ips = r.data.devices.map(d => d.ip);
  assert.ok(ips.includes('192.168.1.10'));
  assert.ok(!ips.includes('192.168.1.5'));
  assert.ok(!ips.includes('192.168.1.20'));
});

await step('Комментарий к отчёту — только руководитель', async () => {
  assert.equal((await disp.post(`/api/reports/${rep1.reportId}/comments`, { text: 'ok' })).status, 403);
  assert.equal((await admin.post(`/api/reports/${rep1.reportId}/comments`, { text: 'Проверено' })).status, 200);
});

await step('Город: код меняется только без заявок', async () => {
  assert.equal((await admin.patch(`/api/admin/cities/${ast.id}`, { code: 'ASX' })).status, 400);
});

console.log(failures ? `\nПровалено: ${failures}` : '\nВсе проверки пройдены');
process.exit(failures ? 1 : 0);

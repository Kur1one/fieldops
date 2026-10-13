/**
 * Отчёты о выездах + Заявки — веб-приложение Google Apps Script. Версия 2.
 * Файлы проекта: Code.gs (этот), Objects.gs (справочники), Index.html (форма).
 *
 * Две таблицы:
 *  • «Отчёты о выездах»  — листы «Отчёты» и «Устройства» (заполняет форма);
 *  • «Заявки на выезды»  — листы «Заявки», «Объекты», «Города» (ведёт диспетчер).
 * Номера заявок присваиваются автоматически по городу: AST-0001, ALA-0001 …
 */

const CONFIG = {
  timeZone: 'Asia/Almaty',
  reportsName: 'Отчёты о выездах',
  ticketsName: 'Заявки на выезды',
  rootFolderName: 'Отчёты о выездах — фото и видео',
  maxDevices: 50,
  reportStatuses: ['Выполнено полностью', 'Выполнено частично', 'Требуется повторный выезд'],
  ticketStatuses: ['Новая', 'Назначена', 'В работе', 'Повторный выезд', 'Выполнена', 'Отменена'],
  openTicketStatuses: ['Новая', 'Назначена', 'В работе', 'Повторный выезд'],
  priorities: ['Аварийный', 'Высокий', 'Обычный', 'Низкий'],
  validationRows: 2000,
};

// статус отчёта → статус заявки
const STATUS_TO_TICKET = {
  'Выполнено полностью': 'Выполнена',
  'Выполнено частично': 'В работе',
  'Требуется повторный выезд': 'Повторный выезд',
};

const REPORT_HEADERS = [
  'ID отчёта', 'Отправлен', 'ФИО', 'Почта', '№ заявки', 'Город', 'Объект', 'Адрес',
  'Время приезда', 'Геометка приезда', 'Точность приезда, м',
  'Задача / проблема', 'Отчёт о работе', 'Материалы и оборудование', 'Статус',
  'Представитель заказчика',
  'Время завершения', 'Геометка завершения', 'Точность завершения, м', 'Длительность (ч:мм)',
  'Комментарий', 'Устройств', 'Устройства и IP', 'Фото до', 'Фото после', 'Видео', 'Папка с файлами',
];

const DEVICE_HEADERS = [
  'ID отчёта', '№ заявки', 'Дата приезда', 'Город', 'Объект', 'Адрес',
  'Тип устройства', 'Действие', 'IP-адрес', 'Модель', 'MAC', 'Серийный №', 'Место установки',
  'Старый IP', 'Старая модель', 'Старый MAC', 'Старый серийный №', 'ФИО',
];

const TICKET_HEADERS = [
  '№ заявки', 'Создана', 'Город', 'Объект', 'Адрес', 'Описание задачи', 'Приоритет',
  'Исполнитель', 'Плановая дата', 'Статус', 'Отчёты', 'Последний выезд', 'Закрыта', 'Примечание',
];
const OBJECT_HEADERS = ['Город', 'Объект', 'Адрес'];
const EMPLOYEE_HEADERS = ['Почта', 'ФИО', 'Примечание'];
const CITY_HEADERS = ['Город', 'Код', 'Последний №'];

const DT = 'dd.mm.yyyy hh:mm';
const IP_RE = /^(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)(\.(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)){3}$/;

/* =====================================================================
 * НАСТРОЙКА. Запускать вручную: в первый раз и после обновления кода.
 * Повторный запуск безопасен — существующие данные не трогает.
 * ===================================================================== */

function setup() {
  const props = PropertiesService.getScriptProperties();

  // 1. Таблица отчётов
  let rs = openOrNull_(props.getProperty('ssId'));
  if (!rs) {
    rs = SpreadsheetApp.create(CONFIG.reportsName);
    rs.setSpreadsheetTimeZone(CONFIG.timeZone);
    rs.getSheets()[0].setName('Отчёты');
    props.setProperty('ssId', rs.getId());
  }
  ensureSheet_(rs, 'Отчёты', REPORT_HEADERS);
  ensureSheet_(rs, 'Устройства', DEVICE_HEADERS);

  // 2. Папка для фото и видео
  let folder = null;
  try { folder = DriveApp.getFolderById(props.getProperty('folderId')); } catch (e) {}
  if (!folder) {
    folder = DriveApp.createFolder(CONFIG.rootFolderName);
    props.setProperty('folderId', folder.getId());
  }

  // 3. Таблица заявок со справочниками
  let ts = openOrNull_(props.getProperty('ticketsId'));
  if (!ts) {
    ts = SpreadsheetApp.create(CONFIG.ticketsName);
    ts.setSpreadsheetTimeZone(CONFIG.timeZone);
    ts.getSheets()[0].setName('Заявки');
    props.setProperty('ticketsId', ts.getId());
  }
  ensureSheet_(ts, 'Заявки', TICKET_HEADERS);
  const objSh = ensureSheet_(ts, 'Объекты', OBJECT_HEADERS);
  const empSh = ensureSheet_(ts, 'Сотрудники', EMPLOYEE_HEADERS);
  empSh.setColumnWidth(1, 260);
  empSh.setColumnWidth(2, 260);
  const citySh = ensureSheet_(ts, 'Города', CITY_HEADERS);
  if (citySh.getLastRow() < 2) {
    citySh.getRange(2, 1, CITY_CODES.length, 3).setValues(CITY_CODES.map(c => [c[0], c[1], 0]));
  }
  if (objSh.getLastRow() < 2) {
    objSh.getRange(2, 1, OBJECTS_SEED.length, 3).setValues(OBJECTS_SEED.map(o => [o[0], o[1], '']));
  }
  objSh.setColumnWidth(2, 380);
  objSh.setColumnWidth(3, 300);
  setupTicketSheet_(ts);

  // 4. Автонумерация заявок при редактировании таблицы
  const hasTrigger = ScriptApp.getProjectTriggers().some(t =>
    t.getHandlerFunction() === 'onTicketsEdit' && t.getTriggerSourceId() === ts.getId());
  if (!hasTrigger) ScriptApp.newTrigger('onTicketsEdit').forSpreadsheet(ts).onEdit().create();

  Logger.log('Таблица ОТЧЁТОВ: ' + rs.getUrl());
  Logger.log('Таблица ЗАЯВОК:  ' + ts.getUrl());
  Logger.log('Папка с фото и видео: ' + folder.getUrl());
}

function setupTicketSheet_(ts) {
  const sh = ts.getSheetByName('Заявки');
  const H = headerIndex_(sh);
  const n = CONFIG.validationRows;
  if (sh.getMaxRows() < n + 1) sh.insertRowsAfter(sh.getMaxRows(), n + 1 - sh.getMaxRows());
  const col = h => sh.getRange(2, H[h] + 1, n, 1);
  const dv = () => SpreadsheetApp.newDataValidation();

  col('Город').setDataValidation(dv()
    .requireValueInRange(ts.getSheetByName('Города').getRange('A2:A'), true)
    .setAllowInvalid(false).setHelpText('Выберите город. Новый город сначала добавьте на лист «Города».').build());
  col('Исполнитель').setDataValidation(dv()
    .requireValueInRange(ts.getSheetByName('Сотрудники').getRange('B2:B'), true)
    .setAllowInvalid(true).setHelpText('Выберите сотрудника из листа «Сотрудники».').build());
  col('Объект').setDataValidation(dv()
    .requireValueInRange(ts.getSheetByName('Объекты').getRange('B2:B'), true)
    .setAllowInvalid(true).setHelpText('Выберите из списка или впишите новый объект.').build());
  col('Приоритет').setDataValidation(dv().requireValueInList(CONFIG.priorities, true).build());
  col('Статус').setDataValidation(dv().requireValueInList(CONFIG.ticketStatuses, true).build());
  col('Плановая дата').setDataValidation(dv().requireDate().setAllowInvalid(false).build()).setNumberFormat('dd.mm.yyyy');
  ['Создана', 'Последний выезд', 'Закрыта'].forEach(h => col(h).setNumberFormat(DT));
  col('№ заявки').setNumberFormat('@').setFontWeight('bold');
  ['Описание задачи', 'Отчёты', 'Примечание'].forEach(h => col(h).setWrap(true));
  sh.setColumnWidth(H['№ заявки'] + 1, 110);
  sh.setColumnWidth(H['Объект'] + 1, 260);
  sh.setColumnWidth(H['Описание задачи'] + 1, 320);

  const hasProt = sh.getProtections(SpreadsheetApp.ProtectionType.RANGE)
    .some(p => p.getDescription() === 'Номер заявки');
  if (!hasProt) {
    sh.getRange(2, H['№ заявки'] + 1, n, 1).protect()
      .setDescription('Номер заявки').setWarningOnly(true);
  }

  const st = sh.getRange(2, H['Статус'] + 1, n, 1);
  const pr = sh.getRange(2, H['Приоритет'] + 1, n, 1);
  const rule = (range, text, bg, fg) => SpreadsheetApp.newConditionalFormatRule()
    .whenTextEqualTo(text).setBackground(bg).setFontColor(fg || '#000000').setRanges([range]).build();
  sh.setConditionalFormatRules([
    rule(st, 'Новая', '#e8f0fe'),
    rule(st, 'Назначена', '#fef7e0'),
    rule(st, 'В работе', '#fce8b2'),
    rule(st, 'Повторный выезд', '#f9cb9c'),
    rule(st, 'Выполнена', '#ceead6'),
    rule(st, 'Отменена', '#e8eaed', '#5f6368'),
    rule(pr, 'Аварийный', '#f4c7c3', '#a50e0e'),
    rule(pr, 'Высокий', '#fce8e6'),
  ]);
}

/* =====================================================================
 * ЗАЯВКИ: автонумерация по городам
 * ===================================================================== */

// Срабатывает при любом редактировании таблицы заявок (триггер создаёт setup).
function onTicketsEdit(e) {
  if (!e || !e.range) return;
  const sh = e.range.getSheet();
  if (sh.getName() !== 'Заявки') return;
  const first = Math.max(2, e.range.getRow());
  const last = e.range.getLastRow();
  if (last >= first) processTicketRows_(sh, first, last);
}

// Ручной запуск: проставить номера всем строкам без номера (например, после вставки из Excel).
function assignTicketIds() {
  const sh = SpreadsheetApp.openById(prop_('ticketsId')).getSheetByName('Заявки');
  if (sh.getLastRow() >= 2) processTicketRows_(sh, 2, sh.getLastRow());
}

function processTicketRows_(sh, first, last) {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(20000)) return;
  try {
    const ss = sh.getParent();
    const H = headerIndex_(sh);
    const vals = sh.getRange(first, 1, last - first + 1, sh.getLastColumn()).getValues();
    const existing = new Set(columnValues_(sh, H['№ заявки']));
    let objIdx = null;
    const updates = [];

    vals.forEach((row, i) => {
      const r = first + i;
      const get = h => String(row[H[h]] == null ? '' : row[H[h]]).trim();
      const city = get('Город');
      const obj = get('Объект');
      if (!city && !obj && !get('Описание задачи')) return; // пустая строка

      // адрес подставляется из справочника, если он там заполнен; город выбирают сами
      if (obj && !get('Адрес')) {
        objIdx = objIdx || objectIndex_(ss);
        const o = objIdx[normKey_(obj)];
        if (o && o.addr) updates.push([r, H['Адрес'], o.addr]);
      }
      if (!row[H['Создана']]) updates.push([r, H['Создана'], new Date()]);
      if (!get('Статус')) updates.push([r, H['Статус'], 'Новая']);
      if (!get('Приоритет')) updates.push([r, H['Приоритет'], 'Обычный']);
      if (!get('№ заявки') && city) updates.push([r, H['№ заявки'], nextTicketId_(ss, city, existing)]);
    });
    updates.forEach(u => sh.getRange(u[0], u[1] + 1).setValue(u[2]));
  } finally {
    lock.releaseLock();
  }
}

function nextTicketId_(ss, city, existing) {
  const sh = ss.getSheetByName('Города');
  const last = sh.getLastRow();
  const vals = last >= 2 ? sh.getRange(2, 1, last - 1, 3).getValues() : [];
  const idx = vals.findIndex(v => normKey_(v[0]) === normKey_(city));
  let row, code, n;
  if (idx < 0) {
    code = autoCode_(city, vals.map(v => String(v[1]).trim().toUpperCase()));
    sh.appendRow([city, code, 0]);
    row = sh.getLastRow();
    n = 0;
  } else {
    row = idx + 2;
    code = String(vals[idx][1]).trim().toUpperCase();
    if (!code) {
      code = autoCode_(city, vals.map(v => String(v[1]).trim().toUpperCase()));
      sh.getRange(row, 2).setValue(code);
    }
    n = Number(vals[idx][2]) || 0;
  }
  let id;
  do { n++; id = code + '-' + String(n).padStart(4, '0'); } while (existing.has(id));
  existing.add(id);
  sh.getRange(row, 3).setValue(n);
  return id;
}

function autoCode_(city, used) {
  const map = { а: 'a', б: 'b', в: 'v', г: 'g', д: 'd', е: 'e', ё: 'e', ж: 'zh', з: 'z', и: 'i', й: 'y', к: 'k', л: 'l',
    м: 'm', н: 'n', о: 'o', п: 'p', р: 'r', с: 's', т: 't', у: 'u', ф: 'f', х: 'h', ц: 'ts', ч: 'ch', ш: 'sh',
    щ: 'sch', ъ: '', ы: 'y', ь: '', э: 'e', ю: 'yu', я: 'ya', ә: 'a', ғ: 'g', қ: 'k', ң: 'n', ө: 'o', ұ: 'u', ү: 'u', һ: 'h', і: 'i' };
  let base = String(city).toLowerCase().split('').map(ch => map[ch] !== undefined ? map[ch] : ch).join('')
    .replace(/[^a-z]/g, '').toUpperCase();
  base = (base + 'XXX').slice(0, Math.max(3, base.length));
  let code = base.slice(0, 3), k = 1;
  while (used.indexOf(code) >= 0) code = base.slice(0, 2) + (k++);
  return code;
}

function objectIndex_(ss) {
  const idx = {};
  rowsOf_(ss.getSheetByName('Объекты')).forEach(o => {
    if (o['Объект']) idx[normKey_(o['Объект'])] = { city: o['Город'], addr: o['Адрес'] };
  });
  return idx;
}

/* =====================================================================
 * ВЕБ-ПРИЛОЖЕНИЕ
 * ===================================================================== */

function doGet() {
  return HtmlService.createHtmlOutputFromFile('Index')
    .setTitle('Отчёт о выезде')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1');
}

// Справочники для формы: города, объекты, открытые заявки.
function getRefs() {
  const ts = SpreadsheetApp.openById(prop_('ticketsId'));
  const objects = rowsOf_(ts.getSheetByName('Объекты'))
    .filter(r => r['Объект'])
    .map(r => ({ c: r['Город'], n: r['Объект'], a: r['Адрес'] || '' }));
  const cities = [];
  rowsOf_(ts.getSheetByName('Города')).forEach(r => { if (r['Город'] && cities.indexOf(r['Город']) < 0) cities.push(r['Город']); });
  objects.forEach(o => { if (o.c && cities.indexOf(o.c) < 0) cities.push(o.c); });
  const tickets = rowsOf_(ts.getSheetByName('Заявки'))
    .filter(r => r['№ заявки'] && (!r['Статус'] || CONFIG.openTicketStatuses.indexOf(r['Статус']) >= 0))
    .map(r => ({
      id: r['№ заявки'], c: r['Город'], o: r['Объект'], a: r['Адрес'], t: r['Описание задачи'],
      p: r['Приоритет'], ex: r['Исполнитель'], d: r['Плановая дата'], s: r['Статус'] || 'Новая',
    }));
  return { cities: cities, objects: objects, tickets: tickets, me: currentEmployee_(ts) };
}

// Кто открыл форму: почта корпоративного аккаунта и ФИО с листа «Сотрудники».
// Почта видна, только если приложение развернуто с корпоративного аккаунта
// и доступ открыт пользователям домена.
function currentEmployee_(ts) {
  let email = '';
  try { email = String(Session.getActiveUser().getEmail() || '').trim(); } catch (e) {}
  if (!email) return { email: '', fio: '' };
  const k = email.toLowerCase();
  const row = rowsOf_(ts.getSheetByName('Сотрудники')).find(r => String(r['Почта'] || '').trim().toLowerCase() === k);
  return { email: email, fio: row ? row['ФИО'] : '' };
}

/* ---------- Загрузка файлов на Диск (по частям, с докачкой) ---------- */

function startUpload(reportId, folderName, fileName, mimeType, size) {
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  let folder;
  try {
    folder = getReportFolder_(reportId, folderName);
  } finally {
    lock.releaseLock();
  }
  const res = UrlFetchApp.fetch(
    'https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable&supportsAllDrives=true', {
      method: 'post',
      contentType: 'application/json; charset=UTF-8',
      headers: {
        Authorization: 'Bearer ' + ScriptApp.getOAuthToken(),
        'X-Upload-Content-Type': mimeType || 'application/octet-stream',
        'X-Upload-Content-Length': String(size),
      },
      payload: JSON.stringify({ name: fileName, parents: [folder.getId()] }),
      muteHttpExceptions: true,
    });
  if (res.getResponseCode() !== 200) {
    throw new Error('Диск не принял файл (' + res.getResponseCode() + '): ' + res.getContentText().slice(0, 200));
  }
  const h = res.getAllHeaders();
  return { sessionUrl: h['Location'] || h['location'], folderUrl: folder.getUrl() };
}

function uploadChunk(sessionUrl, b64, start, total) {
  const bytes = Utilities.base64Decode(b64);
  const end = start + bytes.length - 1;
  const res = UrlFetchApp.fetch(sessionUrl, {
    method: 'put',
    contentType: 'application/octet-stream',
    headers: {
      Authorization: 'Bearer ' + ScriptApp.getOAuthToken(),
      'Content-Range': 'bytes ' + start + '-' + end + '/' + total,
    },
    payload: bytes,
    muteHttpExceptions: true,
    followRedirects: false,
  });
  return parseUploadResponse_(res);
}

function getUploadStatus(sessionUrl, total) {
  const res = UrlFetchApp.fetch(sessionUrl, {
    method: 'put',
    headers: {
      Authorization: 'Bearer ' + ScriptApp.getOAuthToken(),
      'Content-Range': 'bytes */' + total,
    },
    payload: '',
    muteHttpExceptions: true,
    followRedirects: false,
  });
  return parseUploadResponse_(res);
}

function parseUploadResponse_(res) {
  const code = res.getResponseCode();
  if (code === 200 || code === 201) {
    const id = JSON.parse(res.getContentText()).id;
    return { done: true, url: 'https://drive.google.com/file/d/' + id + '/view' };
  }
  if (code === 308) {
    const h = res.getAllHeaders();
    const range = h['Range'] || h['range'];
    const next = range ? Number(String(range).split('-')[1]) + 1 : 0;
    return { done: false, next: next };
  }
  throw new Error('Ошибка загрузки (' + code + '): ' + res.getContentText().slice(0, 200));
}

function getReportFolder_(reportId, folderName) {
  const root = DriveApp.getFolderById(prop_('folderId'));
  const safeId = String(reportId).replace(/[^\w-]/g, '');
  const it = root.searchFolders("title contains '" + safeId + "'");
  if (it.hasNext()) return it.next();
  const name = String(folderName || safeId).replace(/[\\/:*?"<>|']/g, ' ').slice(0, 150);
  return root.createFolder(name.indexOf(safeId) >= 0 ? name : name + ' (' + safeId + ')');
}

/* ---------- Сохранение отчёта ---------- */

function submitReport(d) {
  // ФИО берём из списка сотрудников по корпоративной почте — подменить нельзя
  const me = currentEmployee_(SpreadsheetApp.openById(prop_('ticketsId')));
  if (me.fio) d.fio = me.fio;
  validate_(d);
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    const rs = SpreadsheetApp.openById(prop_('ssId'));
    const rep = rs.getSheetByName('Отчёты');
    const dev = rs.getSheetByName('Устройства');

    // защита от двойной отправки
    if (columnValues_(rep, headerIndex_(rep)['ID отчёта']).indexOf(d.reportId) >= 0) {
      return { ok: true, duplicate: true };
    }

    const arr = new Date(d.arrival.time);
    const fin = new Date(d.finish.time);
    const mins = Math.max(0, Math.round((fin - arr) / 60000));
    const files = d.files || {};
    const devices = d.devices || [];

    appendRows_(rep, [{
      'ID отчёта': d.reportId,
      'Отправлен': new Date(),
      'ФИО': t_(d.fio),
      'Почта': me.email,
      '№ заявки': t_(d.ticket),
      'Город': t_(d.city),
      'Объект': t_(d.object),
      'Адрес': t_(d.address),
      'Время приезда': arr,
      'Геометка приезда': geoLink_(d.arrival.geo),
      'Точность приезда, м': geoAcc_(d.arrival.geo),
      'Задача / проблема': t_(d.task),
      'Отчёт о работе': t_(d.report),
      'Материалы и оборудование': t_(d.materials),
      'Статус': d.status,
      'Представитель заказчика': t_(d.customerRep),
      'Время завершения': fin,
      'Геометка завершения': geoLink_(d.finish.geo),
      'Точность завершения, м': geoAcc_(d.finish.geo),
      'Длительность (ч:мм)': Math.floor(mins / 60) + ':' + String(mins % 60).padStart(2, '0'),
      'Комментарий': t_(d.comment),
      'Устройств': devices.length,
      'Устройства и IP': devices.map((x, i) => {
        let s = (i + 1) + '. ' + (x.type || 'Устройство') + ' — ' + x.ip;
        if (x.action === 'Заменено') s += ' (заменено, снятое: ' + (x.oldIp || '—') + ')';
        else if (x.action) s += ' (' + x.action.toLowerCase() + ')';
        if (x.place) s += ', ' + x.place;
        return s;
      }).join('\n'),
      'Фото до': links_(files.before),
      'Фото после': links_(files.after),
      'Видео': links_(files.video),
      'Папка с файлами': d.folderUrl || '',
    }], ['Отправлен', 'Время приезда', 'Время завершения'], ['Длительность (ч:мм)', '№ заявки']);

    if (devices.length) {
      appendRows_(dev, devices.map(x => {
        const repl = x.action === 'Заменено';
        return {
          'ID отчёта': d.reportId,
          '№ заявки': t_(d.ticket),
          'Дата приезда': arr,
          'Город': t_(d.city),
          'Объект': t_(d.object),
          'Адрес': t_(d.address),
          'Тип устройства': t_(x.type),
          'Действие': t_(x.action),
          'IP-адрес': t_(x.ip),
          'Модель': t_(x.model),
          'MAC': t_(x.mac),
          'Серийный №': t_(x.sn),
          'Место установки': t_(x.place),
          'Старый IP': repl ? t_(x.oldIp) : '',
          'Старая модель': repl ? t_(x.oldModel) : '',
          'Старый MAC': repl ? t_(x.oldMac) : '',
          'Старый серийный №': repl ? t_(x.oldSn) : '',
          'ФИО': t_(d.fio),
        };
      }), ['Дата приезда'], ['IP-адрес', 'Старый IP', '№ заявки']);
    }

    let warning = '';
    if (d.ticket) {
      try {
        updateTicket_(d, arr);
      } catch (e) {
        warning = 'Отчёт сохранён, но заявку обновить не удалось: ' + e.message;
      }
    }
    return { ok: true, warning: warning };
  } finally {
    lock.releaseLock();
  }
}

function updateTicket_(d, arrival) {
  const sh = SpreadsheetApp.openById(prop_('ticketsId')).getSheetByName('Заявки');
  const H = headerIndex_(sh);
  const last = sh.getLastRow();
  const cell = last >= 2 ? sh.getRange(2, H['№ заявки'] + 1, last - 1, 1)
    .createTextFinder(d.ticket).matchEntireCell(true).findNext() : null;
  if (!cell) throw new Error('заявка ' + d.ticket + ' не найдена');
  const r = cell.getRow();
  const row = sh.getRange(r, 1, 1, sh.getLastColumn()).getValues()[0];
  const set = (h, v) => sh.getRange(r, H[h] + 1).setValue(v);

  if (String(row[H['Статус']]) !== 'Отменена') {
    const ns = STATUS_TO_TICKET[d.status];
    set('Статус', ns);
    if (ns === 'Выполнена') set('Закрыта', new Date());
  }
  const reps = String(row[H['Отчёты']] || '').trim();
  set('Отчёты', reps ? reps + '\n' + d.reportId : d.reportId);
  set('Последний выезд', arrival);
  if (!String(row[H['Исполнитель']] || '').trim()) set('Исполнитель', t_(d.fio));
}

function validate_(d) {
  const req = { fio: 'ФИО', city: 'Город', object: 'Объект', address: 'Адрес', task: 'Описание задачи', report: 'Отчёт о работе' };
  Object.keys(req).forEach(k => {
    if (!String(d[k] || '').trim()) throw new Error('Не заполнено поле «' + req[k] + '»');
  });
  if (!d.reportId) throw new Error('Нет ID отчёта');
  if (!d.arrival || !d.arrival.time) throw new Error('Не отмечено время приезда');
  if (!d.finish || !d.finish.time) throw new Error('Не отмечено время завершения');
  if (CONFIG.reportStatuses.indexOf(d.status) < 0) throw new Error('Не выбран статус работ');
  const devices = d.devices || [];
  if (devices.length > CONFIG.maxDevices) throw new Error('Больше ' + CONFIG.maxDevices + ' устройств');
  devices.forEach((x, i) => {
    const n = 'Устройство ' + (i + 1) + ': ';
    if (!x.type) throw new Error(n + 'не выбран тип');
    if (!IP_RE.test(String(x.ip || '').trim())) throw new Error(n + 'неверный IP');
    if (x.action === 'Заменено' && !IP_RE.test(String(x.oldIp || '').trim())) throw new Error(n + 'неверный IP снятого устройства');
  });
}

/* ---------- Вспомогательное ---------- */

function prop_(key) {
  const v = PropertiesService.getScriptProperties().getProperty(key);
  if (!v) throw new Error('Приложение не настроено: владелец должен запустить функцию setup');
  return v;
}

function openOrNull_(id) {
  if (!id) return null;
  try { return SpreadsheetApp.openById(id); } catch (e) { return null; }
}

// Создаёт лист при необходимости и приводит заголовки в порядок.
// Пустой лист — заголовки пишутся заново; лист с данными — недостающие столбцы добавляются в конец.
function ensureSheet_(ss, name, headers) {
  const sh = ss.getSheetByName(name) || ss.insertSheet(name);
  const lastCol = sh.getLastColumn();
  if (sh.getLastRow() <= 1) {
    if (lastCol) sh.getRange(1, 1, 1, lastCol).clearContent();
    writeHeaders_(sh, headers, 1);
  } else {
    const cur = sh.getRange(1, 1, 1, lastCol).getValues()[0].map(v => String(v).trim());
    const missing = headers.filter(h => cur.indexOf(h) < 0);
    if (missing.length) writeHeaders_(sh, missing, lastCol + 1);
  }
  return sh;
}

function writeHeaders_(sh, headers, startCol) {
  const need = startCol + headers.length - 1;
  if (sh.getMaxColumns() < need) sh.insertColumnsAfter(sh.getMaxColumns(), need - sh.getMaxColumns());
  sh.getRange(1, startCol, 1, headers.length).setValues([headers])
    .setFontWeight('bold').setBackground('#e8eaed').setWrap(true).setVerticalAlignment('middle');
  sh.setColumnWidths(startCol, headers.length, 150);
  sh.setFrozenRows(1);
}

function headerIndex_(sh) {
  const H = {};
  sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0].forEach((h, i) => {
    h = String(h).trim();
    if (h && !(h in H)) H[h] = i;
  });
  return H;
}

function columnValues_(sh, colIdx) {
  const last = sh.getLastRow();
  if (last < 2 || colIdx == null) return [];
  return sh.getRange(2, colIdx + 1, last - 1, 1).getDisplayValues().map(r => String(r[0]).trim()).filter(Boolean);
}

// Пишет строки по названиям столбцов — порядок столбцов в таблице не важен.
function appendRows_(sh, objs, dateCols, textCols) {
  const headers = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0].map(h => String(h).trim());
  const rows = objs.map(o => headers.map(h => (h in o ? o[h] : '')));
  const r = sh.getLastRow() + 1;
  if (sh.getMaxRows() < r + rows.length - 1) sh.insertRowsAfter(sh.getMaxRows(), r + rows.length - 1 - sh.getMaxRows());
  (textCols || []).forEach(h => {
    const c = headers.indexOf(h);
    if (c >= 0) sh.getRange(r, c + 1, rows.length, 1).setNumberFormat('@');
  });
  sh.getRange(r, 1, rows.length, headers.length).setValues(rows);
  (dateCols || []).forEach(h => {
    const c = headers.indexOf(h);
    if (c >= 0) sh.getRange(r, c + 1, rows.length, 1).setNumberFormat(DT);
  });
}

function rowsOf_(sh) {
  if (!sh || sh.getLastRow() < 2) return [];
  const v = sh.getDataRange().getDisplayValues();
  const h = v.shift().map(x => String(x).trim());
  return v.map(r => {
    const o = {};
    h.forEach((k, i) => { if (k) o[k] = String(r[i]).trim(); });
    return o;
  });
}

function normKey_(s) {
  return String(s || '').toLowerCase().replace(/ё/g, 'е').replace(/\s+/g, ' ').trim();
}

// текст в ячейку; защита от случайных формул
function t_(s) {
  s = String(s == null ? '' : s).trim();
  if (/^[=+\-@]/.test(s)) s = "'" + s;
  return s.slice(0, 45000);
}

function geoLink_(g) {
  if (g && g.lat != null) return 'https://maps.google.com/?q=' + g.lat + ',' + g.lng;
  return 'не получена' + (g && g.error ? ': ' + g.error : '');
}

function geoAcc_(g) {
  return g && g.acc != null ? g.acc : '';
}

function links_(arr) {
  return (arr || []).filter(Boolean).join('\n');
}

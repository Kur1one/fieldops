import ExcelJS from 'exceljs';
import { api } from '@/lib/server/api';
import { listTickets, parseFilters } from '@/lib/server/queries';
import { getTz } from '@/lib/server/tz';
import { STATUS_LABEL } from '@/lib/shared/constants';
import { fmtDate, fmtDateTime } from '@/lib/shared/format';

// Защита от формул: всё пишется как строковые ячейки (t="s"), а не формулы — «=CMD()…» останется текстом.
// Апостроф не добавляем: в xlsx он был бы виден и портил бы описания вида «- не работает камера».
function safe(v: string | null | undefined) {
  return String(v ?? '');
}

// Выгрузка текущей выборки списка — те же фильтры и сортировка, что на экране, без постраничности.
export const GET = api(['dispatcher', 'manager'], async (req, user) => {
  const tz = await getTz();
  const f = parseFilters(req.nextUrl.searchParams);
  const { rows } = await listTickets(user, f, tz, { all: true });

  const wb = new ExcelJS.Workbook();
  wb.creator = 'FieldOps';
  const ws = wb.addWorksheet('Заявки', { views: [{ state: 'frozen', ySplit: 1 }] });
  ws.columns = [
    { header: '№ заявки', key: 'number', width: 13 },
    { header: 'Создана', key: 'created', width: 17 },
    { header: 'Город', key: 'city', width: 16 },
    { header: 'Объект', key: 'object', width: 32 },
    { header: 'Адрес', key: 'address', width: 30 },
    { header: 'Задача', key: 'task', width: 50 },
    { header: 'Приоритет', key: 'priority', width: 12 },
    { header: 'Исполнитель', key: 'assignee', width: 26 },
    { header: 'Плановая дата', key: 'planned', width: 13 },
    { header: 'Статус', key: 'status', width: 16 },
    { header: 'Последний выезд', key: 'lastVisit', width: 17 },
    { header: 'Отчётов', key: 'reports', width: 9 },
    { header: 'Закрыта', key: 'closed', width: 17 },
    { header: 'Внеплановая', key: 'unplanned', width: 12 },
  ];
  ws.getRow(1).font = { bold: true };
  for (const r of rows) {
    ws.addRow({
      number: r.number,
      created: fmtDateTime(r.createdAt, tz),
      city: safe(r.cityName),
      object: safe(r.objectName),
      address: safe(r.address),
      task: safe(r.description),
      priority: r.priorityName,
      assignee: safe(r.assigneeName),
      planned: fmtDate(r.plannedDate),
      status: STATUS_LABEL[r.status],
      lastVisit: fmtDateTime(r.lastVisitAt, tz),
      reports: r.reportCount,
      closed: fmtDateTime(r.closedAt, tz),
      unplanned: r.isUnplanned ? 'да' : '',
    });
  }
  ws.autoFilter = { from: 'A1', to: 'N1' };
  const buf = await wb.xlsx.writeBuffer();
  const name = `Заявки ${fmtDate(new Date(), tz)}.xlsx`;
  return new Response(buf, {
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename="tickets.xlsx"; filename*=UTF-8''${encodeURIComponent(name)}`,
      'Cache-Control': 'no-store',
    },
  });
});

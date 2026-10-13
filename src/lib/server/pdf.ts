import 'server-only';
import path from 'node:path';
import PDFDocument from 'pdfkit';
import { STATUS_LABEL, WORK_STATUS_LABEL } from '@/lib/shared/constants';
import { fmtDate, fmtDateTime, fmtDuration, mapLink } from '@/lib/shared/format';
import type { TicketCard } from './queries';
import { storage } from './storage';

const FONT = path.join(process.cwd(), 'assets/fonts/DejaVuSans.ttf');
const FONT_BOLD = path.join(process.cwd(), 'assets/fonts/DejaVuSans-Bold.ttf');

// PDF по заявке: данные заявки, все отчёты, миниатюры фото, устройства, ссылки на видео и карту.
export async function ticketPdf(card: TicketCard, tz: string, appUrl: string): Promise<Buffer> {
  const doc = new PDFDocument({ size: 'A4', margin: 40, info: { Title: `Заявка ${card.ticket.number}` } });
  doc.registerFont('R', FONT);
  doc.registerFont('B', FONT_BOLD);
  const chunks: Buffer[] = [];
  doc.on('data', c => chunks.push(c));
  const done = new Promise<Buffer>(res => doc.on('end', () => res(Buffer.concat(chunks))));

  const W = doc.page.width - 80;
  const t = card.ticket;
  const h = (text: string, size = 13) => { doc.moveDown(0.6).font('B').fontSize(size).fillColor('#000').text(text); doc.moveDown(0.2); };
  const kv = (k: string, v: string | null | undefined, link?: string) => {
    if (!v) return;
    doc.font('B').fontSize(9.5).fillColor('#555').text(k + ': ', { continued: true })
      .font('R').fillColor(link ? '#1a56db' : '#000').text(v, link ? { link, underline: true } : {});
  };
  const ensure = (need: number) => { if (doc.y + need > doc.page.height - 50) doc.addPage(); };

  doc.font('B').fontSize(18).text(`Заявка ${t.number}`);
  doc.font('R').fontSize(10).fillColor('#555')
    .text(`${STATUS_LABEL[t.status]} · ${card.priorityName}${t.isUnplanned ? ' · Внеплановый выезд' : ''}`);
  doc.fillColor('#000');

  h('Заявка');
  kv('Город', card.cityName);
  kv('Объект', card.objectName);
  kv('Адрес', t.address);
  kv('Задача', t.description);
  kv('Контакт на объекте', t.contact);
  kv('Примечание', t.note);
  kv('Исполнитель', card.assigneeName ?? '—');
  kv('Плановая дата', fmtDate(t.plannedDate));
  kv('Автор', card.authorName);
  kv('Создана', fmtDateTime(t.createdAt, tz));
  if (t.cancelReason) kv('Причина отмены', t.cancelReason);

  h('Итог');
  kv('Выездов', String(t.reportCount));
  kv('Время на объекте всего', fmtDuration(t.totalMinutes));
  kv('Закрыта', fmtDateTime(t.closedAt, tz) || '—');

  h(`Завершение работ (${card.reports.length})`, 14);
  if (!card.reports.length) doc.font('R').fontSize(10).text('Работы ещё не начаты.');

  for (const r of card.reports) {
    ensure(120);
    doc.moveDown(0.5);
    doc.moveTo(40, doc.y).lineTo(40 + W, doc.y).strokeColor('#ccc').stroke();
    doc.moveDown(0.3);
    doc.font('B').fontSize(12).fillColor('#000').text(`Отчёт ${r.id} — ${WORK_STATUS_LABEL[r.workStatus]}`);
    doc.font('R').fontSize(9.5).fillColor('#555').text(`${r.employeeName} · отправлен ${fmtDateTime(r.submittedAt, tz)}`);
    doc.fillColor('#000');
    if (r.needsReview) doc.fillColor('#b91c1c').text('На проверку: ' + r.reviewReasons.join('; ')).fillColor('#000');
    kv('Приезд', fmtDateTime(r.arrivalAt, tz));
    kv('Завершение', fmtDateTime(r.finishAt, tz));
    kv('Длительность', fmtDuration(r.durationMinutes));
    const geo = (lat: number | null, lng: number | null, acc: number | null, err: string | null, dist: number | null) =>
      lat != null && lng != null
        ? { text: `${lat}, ${lng} (±${acc ?? '?'} м)${dist != null ? `, ${dist} м до объекта` : ''}`, link: mapLink(lat, lng) }
        : { text: `не получена: ${err ?? 'причина неизвестна'}`, link: undefined };
    const ga = geo(r.arrivalLat, r.arrivalLng, r.arrivalAcc, r.arrivalGeoError, r.arrivalDistanceM);
    const gf = geo(r.finishLat, r.finishLng, r.finishAcc, r.finishGeoError, r.finishDistanceM);
    kv('Геометка приезда', ga.text, ga.link);
    kv('Геометка завершения', gf.text, gf.link);
    kv('Объект (в отчёте)', `${r.objectName}, ${r.cityName}`);
    kv('Адрес', r.address);
    kv('Задача', r.task);
    kv('Отчёт о работе', r.workReport);
    kv('Материалы', r.materials);
    kv('Представитель заказчика', r.customerRep);
    kv('Комментарий', r.comment);
    for (const c of r.comments) kv(`Комментарий руководителя (${c.authorName}, ${fmtDateTime(c.c.createdAt, tz)})`, c.c.text);

    for (const [kind, title] of [['photo_before', 'Фото до'], ['photo_after', 'Фото после']] as const) {
      const photos = r.files.filter(f => f.kind === kind);
      if (!photos.length) continue;
      ensure(110);
      doc.font('B').fontSize(10).text(`${title} (${photos.length})`);
      const size = 86, gap = 6, perRow = Math.floor((W + gap) / (size + gap));
      let col = 0;
      let y = doc.y + 4;
      for (const p of photos) {
        if (col === perRow) { col = 0; y += size + gap; }
        if (y + size > doc.page.height - 50) { doc.addPage(); y = doc.y; col = 0; }
        const x = 40 + col * (size + gap);
        try {
          const buf = await storage().getBuffer(p.thumbKey ?? p.storageKey);
          doc.image(buf, x, y, { fit: [size, size], align: 'center', valign: 'center', link: `${appUrl}/api/files/${p.id}` } as PDFKit.Mixins.ImageOption);
        } catch {
          doc.rect(x, y, size, size).strokeColor('#ccc').stroke();
        }
        col++;
      }
      doc.x = 40;
      doc.y = y + size + gap;
    }

    const videos = r.files.filter(f => f.kind === 'video');
    if (videos.length) {
      ensure(30);
      doc.font('B').fontSize(10).text('Видео');
      for (const v of videos) doc.font('R').fillColor('#1a56db').text(v.storedName, { link: `${appUrl}/api/files/${v.id}`, underline: true });
      doc.fillColor('#000');
    }

    if (r.devices.length) {
      ensure(40);
      doc.font('B').fontSize(10).text(`Устройства (${r.devices.length})`);
      const cols = [
        { t: '№', w: 18 }, { t: 'Тип', w: 62 }, { t: 'Действие', w: 66 }, { t: 'IP', w: 120 },
        { t: 'Модель', w: 70 }, { t: 'MAC / S/N', w: 96 }, { t: 'Место', w: W - 432 },
      ];
      const row = (vals: string[], bold = false) => {
        doc.font(bold ? 'B' : 'R').fontSize(8);
        const hgt = Math.max(...vals.map((v, i) => doc.heightOfString(v || ' ', { width: cols[i].w - 4 }))) + 4;
        if (doc.y + hgt > doc.page.height - 50) doc.addPage();
        const y = doc.y;
        let x = 40;
        vals.forEach((v, i) => { doc.text(v, x + 2, y + 2, { width: cols[i].w - 4 }); x += cols[i].w; });
        doc.moveTo(40, y + hgt).lineTo(40 + W, y + hgt).strokeColor('#e5e7eb').stroke();
        doc.x = 40;
        doc.y = y + hgt;
      };
      row(cols.map(c => c.t), true);
      for (const d of r.devices) {
        const repl = d.actionKind === 'replace';
        row([
          String(d.position), d.typeName, d.actionName,
          repl ? `${d.oldIp} → ${d.ip}` : d.ip,
          repl && d.oldModel ? `${d.oldModel} → ${d.model}` : d.model,
          [repl && d.oldMac ? `${d.oldMac} → ${d.mac}` : d.mac, repl && d.oldSerial ? `${d.oldSerial} → ${d.serial}` : d.serial].filter(Boolean).join('\n'),
          d.place,
        ]);
      }
    }
  }

  h('История', 12);
  for (const e of card.events) {
    ensure(14);
    doc.font('R').fontSize(8.5).fillColor('#000').text(`${fmtDateTime(e.e.at, tz)} · ${e.authorName ?? 'Система'} · ${eventText(e.e)}`);
  }

  doc.end();
  return done;
}

export function eventText(e: { type: string; fromValue: string | null; toValue: string | null; text: string | null; reportId: string | null }) {
  const st = (s: string | null) => (s && s in STATUS_LABEL ? STATUS_LABEL[s as keyof typeof STATUS_LABEL] : s ?? '—');
  switch (e.type) {
    case 'created': return 'Заявка создана' + (e.text ? ` (${e.text})` : '');
    case 'assigned': return `Исполнитель: ${e.fromValue ?? '—'} → ${e.toValue ?? '—'}`;
    case 'status': return `Статус: ${st(e.fromValue)} → ${st(e.toValue)}` + (e.text ? ` (${e.text})` : '');
    case 'report': return `Отчёт ${e.reportId}: ${e.text ?? ''}`;
    case 'comment': return `Комментарий к отчёту ${e.reportId}: ${e.text ?? ''}`;
    case 'edited': return `${e.text ?? 'Изменено'}: ${e.fromValue ?? '—'} → ${e.toValue ?? '—'}`;
    default: return e.text ?? e.type;
  }
}

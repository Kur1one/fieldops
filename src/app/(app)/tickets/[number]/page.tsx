import Link from 'next/link';
import { notFound } from 'next/navigation';
import { can, requireUser } from '@/lib/server/auth';
import { HttpError } from '@/lib/server/api';
import { eventText } from '@/lib/server/pdf';
import { ticketCard } from '@/lib/server/queries';
import { getVisibleTicket } from '@/lib/server/tickets';
import { getTz } from '@/lib/server/tz';
import { OPEN_STATUSES } from '@/lib/shared/constants';
import { addressMapLink, fmtBytes, fmtDate, fmtDateTime, fmtDuration } from '@/lib/shared/format';
import { PriorityBadge, StatusBadge, WorkStatusBadge } from '@/components/badges';
import { Gallery } from './Gallery';
import { MiniMap } from './MiniMap';
import { CommentForm, CopyIp, TicketActions } from './TicketActions';

export async function generateMetadata({ params }: { params: Promise<{ number: string }> }) {
  return { title: (await params).number.toUpperCase() };
}

export default async function TicketPage({ params }: { params: Promise<{ number: string }> }) {
  const user = await requireUser();
  const tz = await getTz();
  const { number } = await params;
  let t;
  try {
    t = await getVisibleTicket(user, decodeURIComponent(number));
  } catch (e) {
    if (e instanceof HttpError && e.status === 404) notFound();
    throw e;
  }
  const card = (await ticketCard(t.id))!;
  const tk = card.ticket;
  const open = OPEN_STATUSES.includes(tk.status);
  const mayReport = open && (!tk.assigneeId || tk.assigneeId === user.id || can.manageTickets(user));

  return (
    <main className="mx-auto max-w-5xl space-y-3 px-3 pt-3 pb-12">
      {/* 1. Шапка */}
      <section className="card">
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="text-2xl font-bold">{tk.number}</h1>
          <StatusBadge status={tk.status} />
          <PriorityBadge name={card.priorityName} rank={card.priorityRank} />
          {tk.isUnplanned && <span className="chip bg-violet-100 text-violet-800">Внеплановый выезд</span>}
        </div>
        <div className="mt-3 flex flex-wrap gap-2">
          {mayReport && <Link href={`/report?ticket=${tk.number}`} className="btn-primary">Подать отчёт</Link>}
          {can.manageTickets(user) && (
            <TicketActions
              number={tk.number}
              status={tk.status}
              assigneeId={tk.assigneeId}
              plannedDate={tk.plannedDate}
              priorityId={tk.priorityId}
            />
          )}
          <a href={`/api/tickets/${tk.number}/pdf`} className="btn-ghost">Скачать отчёт (PDF)</a>
        </div>
      </section>

      {/* 2. Заявка */}
      <section className="card">
        <h2 className="h2">Заявка</h2>
        <dl className="grid gap-x-6 gap-y-2 text-[15px] sm:grid-cols-[180px_1fr]">
          <Row k="Город">{card.cityName}</Row>
          <Row k="Объект"><Link className="link" href={`/objects/${card.objectId}`}>{card.objectName}</Link></Row>
          <Row k="Адрес">{tk.address} · <a className="link text-sm" href={addressMapLink(tk.address)} target="_blank" rel="noreferrer">Открыть на карте</a></Row>
          <Row k="Задача"><span className="whitespace-pre-wrap">{tk.description}</span></Row>
          {tk.contact && <Row k="Контакт на объекте">{tk.contact}</Row>}
          {tk.note && <Row k="Примечание"><span className="whitespace-pre-wrap">{tk.note}</span></Row>}
          <Row k="Исполнитель">{card.assigneeName ?? <span className="text-slate-400">не назначен</span>}</Row>
          <Row k="Плановая дата">{fmtDate(tk.plannedDate) || '—'}</Row>
          <Row k="Автор">{card.authorName}</Row>
          <Row k="Создана">{fmtDateTime(tk.createdAt, tz)}</Row>
          {tk.cancelReason && <Row k="Причина отмены">{tk.cancelReason}</Row>}
          {card.attachments.length > 0 && (
            <Row k="Вложения">
              <ul>
                {card.attachments.map(a => (
                  <li key={a.id}><a className="link" href={`/api/files/${a.id}`} target="_blank" rel="noreferrer">{a.originalName}</a> <span className="text-sm text-slate-400">{fmtBytes(a.size)}</span></li>
                ))}
              </ul>
            </Row>
          )}
        </dl>
      </section>

      {/* 3. Завершение работ */}
      <section className="card">
        <h2 className="h2">Завершение работ</h2>
        <p className="mb-3 rounded-lg bg-slate-50 p-3 text-sm">
          Выездов: <b>{tk.reportCount}</b> · Время на объекте всего: <b>{fmtDuration(tk.totalMinutes)}</b> · Закрыта: <b>{fmtDateTime(tk.closedAt, tz) || '—'}</b>
        </p>
        {!card.reports.length && <p className="text-slate-500">Работы ещё не начаты.</p>}
        <div className="space-y-6">
          {card.reports.map(r => {
            const before = r.files.filter(f => f.kind === 'photo_before');
            const after = r.files.filter(f => f.kind === 'photo_after');
            const videos = r.files.filter(f => f.kind === 'video');
            return (
              <article key={r.id} className="rounded-xl border border-slate-200 p-3 sm:p-4">
                <header className="flex flex-wrap items-center gap-2">
                  <WorkStatusBadge status={r.workStatus} />
                  <b>{r.employeeName}</b>
                  <span className="text-sm text-slate-500">отправлен {fmtDateTime(r.submittedAt, tz)} · ID {r.id}</span>
                </header>
                {r.needsReview && (
                  <p className="mt-2 rounded-lg bg-red-50 p-2 text-sm text-red-700">На проверку: {r.reviewReasons.join('; ')}</p>
                )}
                <p className="mt-2 text-[15px]">
                  Приезд: <b>{fmtDateTime(r.arrivalAt, tz)}</b> · Завершение: <b>{fmtDateTime(r.finishAt, tz)}</b> · Длительность: <b>{fmtDuration(r.durationMinutes)}</b>
                </p>

                <div className="mt-3">
                  <MiniMap
                    arrival={r.arrivalLat != null && r.arrivalLng != null ? { lat: r.arrivalLat, lng: r.arrivalLng, acc: r.arrivalAcc } : null}
                    finish={r.finishLat != null && r.finishLng != null ? { lat: r.finishLat, lng: r.finishLng, acc: r.finishAcc } : null}
                    object={card.objectLat != null && card.objectLng != null ? { lat: card.objectLat, lng: card.objectLng } : null}
                  />
                  <ul className="mt-2 text-sm text-slate-700">
                    <li>{geoLine('Приезд', r.arrivalLat, r.arrivalLng, r.arrivalAcc, r.arrivalGeoError, r.arrivalDistanceM)}</li>
                    <li>{geoLine('Завершение', r.finishLat, r.finishLng, r.finishAcc, r.finishGeoError, r.finishDistanceM)}</li>
                  </ul>
                </div>

                <dl className="mt-3 grid gap-x-6 gap-y-2 text-[15px] sm:grid-cols-[180px_1fr]">
                  {(r.objectName !== card.objectName || r.address !== tk.address) && <Row k="Объект в отчёте">{r.objectName}, {r.address}</Row>}
                  <Row k="Задача"><span className="whitespace-pre-wrap">{r.task}</span></Row>
                  <Row k="Отчёт о работе"><span className="whitespace-pre-wrap">{r.workReport}</span></Row>
                  {r.materials && <Row k="Материалы"><span className="whitespace-pre-wrap">{r.materials}</span></Row>}
                  {r.customerRep && <Row k="Представитель заказчика">{r.customerRep}</Row>}
                  {r.comment && <Row k="Комментарий"><span className="whitespace-pre-wrap">{r.comment}</span></Row>}
                </dl>

                {(before.length > 0 || after.length > 0) && (
                  <div className="mt-3 grid gap-3 md:grid-cols-2">
                    <Gallery title="Фото до" photos={before.map(p => ({ id: p.id, name: p.storedName, takenAt: p.takenAt ? fmtDateTime(p.takenAt, tz) : null }))} />
                    <Gallery title="Фото после" photos={after.map(p => ({ id: p.id, name: p.storedName, takenAt: p.takenAt ? fmtDateTime(p.takenAt, tz) : null }))} />
                  </div>
                )}

                {videos.length > 0 && (
                  <div className="mt-3">
                    <div className="label">Видео</div>
                    <div className="grid gap-3 md:grid-cols-2">
                      {videos.map(v => (
                        <div key={v.id}>
                          <video controls preload="metadata" playsInline className="w-full rounded-lg bg-black" src={`/api/files/${v.id}`} />
                          <a className="link text-sm" href={`/api/files/${v.id}?download=1`}>Скачать {v.storedName}</a> <span className="text-sm text-slate-400">{fmtBytes(v.size)}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {r.devices.length > 0 && (
                  <div className="mt-3">
                    <div className="label">Устройства ({r.devices.length})</div>
                    <div className="overflow-x-auto">
                      <table className="w-full text-sm">
                        <thead className="bg-slate-50 text-left text-slate-600">
                          <tr>
                            <th className="px-2 py-1.5">№</th><th className="px-2 py-1.5">Тип</th><th className="px-2 py-1.5">Действие</th>
                            <th className="px-2 py-1.5">IP</th><th className="px-2 py-1.5">Модель</th><th className="px-2 py-1.5">MAC</th>
                            <th className="px-2 py-1.5">Серийный №</th><th className="px-2 py-1.5">Место</th>
                          </tr>
                        </thead>
                        <tbody>
                          {r.devices.map(d => {
                            const repl = d.actionKind === 'replace';
                            const pair = (o: string, n: string) => (repl && o && o !== n ? <>{o} → {n}</> : n);
                            return (
                              <tr key={d.id} className={`border-t border-slate-100 ${repl ? 'bg-amber-50' : ''}`}>
                                <td className="px-2 py-1.5">{d.position}</td>
                                <td className="px-2 py-1.5">{d.typeName}</td>
                                <td className="px-2 py-1.5">{d.actionName}</td>
                                <td className="px-2 py-1.5 font-mono whitespace-nowrap">
                                  {repl ? <>{d.oldIp} → {d.ip}</> : d.ip} <CopyIp ip={d.ip} />
                                </td>
                                <td className="px-2 py-1.5">{pair(d.oldModel, d.model)}</td>
                                <td className="px-2 py-1.5 font-mono">{pair(d.oldMac, d.mac)}</td>
                                <td className="px-2 py-1.5">{pair(d.oldSerial, d.serial)}</td>
                                <td className="px-2 py-1.5">{d.place}</td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}

                {(r.comments.length > 0 || can.commentReport(user)) && (
                  <div className="mt-3 border-t border-slate-100 pt-3">
                    {r.comments.map(c => (
                      <p key={c.c.id} className="mb-2 rounded-lg bg-brand-50 p-2 text-sm">
                        <b>{c.authorName}</b> <span className="text-slate-500">{fmtDateTime(c.c.createdAt, tz)}</span><br />
                        <span className="whitespace-pre-wrap">{c.c.text}</span>
                      </p>
                    ))}
                    {can.commentReport(user) && <CommentForm reportId={r.id} />}
                  </div>
                )}
              </article>
            );
          })}
        </div>
      </section>

      {/* 4. История */}
      <section className="card">
        <h2 className="h2">История</h2>
        <ol className="space-y-1.5 text-sm">
          {card.events.map(e => (
            <li key={e.e.id} className="flex flex-wrap gap-x-2">
              <span className="text-slate-500 tabular-nums">{fmtDateTime(e.e.at, tz)}</span>
              <span className="font-medium">{e.authorName ?? 'Система'}</span>
              <span>{eventText(e.e)}</span>
            </li>
          ))}
        </ol>
      </section>
    </main>
  );
}

function Row({ k, children }: { k: string; children: React.ReactNode }) {
  return (
    <>
      <dt className="text-sm text-slate-500 sm:text-[15px]">{k}</dt>
      <dd className="mb-1 sm:mb-0">{children}</dd>
    </>
  );
}

function geoLine(label: string, lat: number | null, lng: number | null, acc: number | null, err: string | null, dist: number | null) {
  if (lat == null || lng == null) return <><b>{label}:</b> <span className="text-red-700">геометка не получена: {err ?? 'причина неизвестна'}</span></>;
  return (
    <>
      <b>{label}:</b> <a className="link" href={`https://yandex.kz/maps/?pt=${lng},${lat}&z=17&l=map`} target="_blank" rel="noreferrer">{lat}, {lng}</a> (±{acc ?? '?'} м)
      {dist != null && <> · {dist} м до объекта</>}
    </>
  );
}

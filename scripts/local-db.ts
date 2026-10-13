/**
 * Локальный PostgreSQL для разработки без Docker (embedded-postgres).
 * Запуск: npm run db:local — держите окно открытым, пока работаете.
 * Данные лежат в .data/pg. Строка подключения:
 *   postgres://fieldops:fieldops@localhost:54329/fieldops
 */
import EmbeddedPostgres from 'embedded-postgres';
import { existsSync } from 'node:fs';
import path from 'node:path';

const dataDir = path.resolve('.data/pg');
const fresh = !existsSync(path.join(dataDir, 'PG_VERSION'));

const pg = new EmbeddedPostgres({
  databaseDir: dataDir,
  user: 'fieldops',
  password: 'fieldops',
  port: 54329,
  persistent: true,
  initdbFlags: ['--encoding=UTF8', '--locale=C'],
});

async function main() {
  if (fresh) await pg.initialise();
  await pg.start();
  if (fresh) await pg.createDatabase('fieldops');
  console.log('PostgreSQL запущен: postgres://fieldops:fieldops@localhost:54329/fieldops');
  console.log('Ctrl+C — остановить.');
  const stop = async () => { await pg.stop(); process.exit(0); };
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);
}

main().catch(e => { console.error(e); process.exit(1); });

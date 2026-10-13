import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { getDb } from '../src/lib/db';
import { loadEnv } from './env';

loadEnv();

async function main() {
  const db = getDb();
  await migrate(db, { migrationsFolder: 'drizzle' });
  console.log('Миграции применены');
  process.exit(0);
}

main().catch(e => { console.error(e); process.exit(1); });

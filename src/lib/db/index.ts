import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import * as schema from './schema';

export type DB = NodePgDatabase<typeof schema>;
export type Tx = Parameters<Parameters<DB['transaction']>[0]>[0];
export type DbOrTx = DB | Tx;

const g = globalThis as unknown as { __fieldopsPool?: Pool; __fieldopsDb?: DB };

function makePool() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL не задан');
  const ssl = process.env.DATABASE_SSL === 'true'
    ? { rejectUnauthorized: true, ca: process.env.DATABASE_CA_CERT || undefined }
    : undefined;
  return new Pool({ connectionString: url, ssl, max: Number(process.env.DATABASE_POOL_SIZE || 10) });
}

export function getDb(): DB {
  if (!g.__fieldopsDb) {
    g.__fieldopsPool = makePool();
    g.__fieldopsDb = drizzle(g.__fieldopsPool, { schema });
  }
  return g.__fieldopsDb;
}

export const db = new Proxy({} as DB, {
  get(_t, prop) {
    const real = getDb() as unknown as Record<string | symbol, unknown>;
    const v = real[prop];
    return typeof v === 'function' ? (v as (...a: unknown[]) => unknown).bind(real) : v;
  },
});

export { schema };

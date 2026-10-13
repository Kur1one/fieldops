import { existsSync } from 'node:fs';

// Подхватывает .env / .env.local для скриптов вне Next.js.
export function loadEnv() {
  for (const f of ['.env.local', '.env']) {
    if (existsSync(f)) process.loadEnvFile(f);
  }
}

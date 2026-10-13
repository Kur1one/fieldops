// Сборка служебных скриптов (миграции, начальные данные) в самостоятельные .mjs для production-образа.
import { build } from 'esbuild';

await build({
  entryPoints: { migrate: 'scripts/migrate.ts', seed: 'scripts/seed.ts' },
  outdir: 'dist-scripts',
  outExtension: { '.js': '.mjs' },
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node22',
  external: ['pg-native'],
  tsconfig: 'tsconfig.json',
  banner: { js: "import { createRequire } from 'module'; const require = createRequire(import.meta.url);" },
  logLevel: 'info',
});

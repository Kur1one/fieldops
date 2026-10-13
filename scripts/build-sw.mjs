// Сборка service worker (src/sw/sw.ts → public/sw.js) вместе с кодом очереди отправки.
import { build } from 'esbuild';

const buildId = process.env.SW_BUILD_ID || new Date().toISOString().replace(/\D/g, '').slice(0, 14);

await build({
  entryPoints: ['src/sw/sw.ts'],
  outfile: 'public/sw.js',
  bundle: true,
  format: 'iife',
  target: ['safari15', 'chrome90'],
  minify: true,
  sourcemap: false,
  tsconfig: 'tsconfig.json',
  define: { __BUILD_ID__: JSON.stringify(buildId), 'process.env.NODE_ENV': '"production"' },
  logLevel: 'info',
});

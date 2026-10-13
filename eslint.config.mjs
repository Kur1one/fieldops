import nextVitals from 'eslint-config-next/core-web-vitals';
import nextTs from 'eslint-config-next/typescript';

const config = [
  ...nextVitals,
  ...nextTs,
  {
    rules: {
      // миниатюры из IndexedDB и защищённые /api/files — обычный <img>, next/image тут не подходит
      '@next/next/no-img-element': 'off',
    },
  },
  { ignores: ['.next/**', 'node_modules/**', 'public/sw.js', 'dist-scripts/**', 'Прототип/**', 'drizzle/**'] },
];

export default config;

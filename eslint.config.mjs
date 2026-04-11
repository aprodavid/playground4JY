import { FlatCompat } from '@eslint/eslintrc';
import nextVitals from 'eslint-config-next/core-web-vitals.js';
import nextTs from 'eslint-config-next/typescript.js';

const compat = new FlatCompat({ baseDirectory: import.meta.dirname });
const config = [
  {
    ignores: ['.next/**', 'node_modules/**', 'functions/**', 'coverage/**'],
  },
  ...compat.config(nextVitals),
  ...compat.config(nextTs),
];

export default config;

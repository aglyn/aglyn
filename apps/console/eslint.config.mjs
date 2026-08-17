import globals from 'globals'
import baseConfig from '../../eslint.config.mjs'
import nextPlugin from '@next/eslint-plugin-next'

export default [
  ...baseConfig,
  {
    files: ['**/*.ts', '**/*.tsx', '**/*.js', '**/*.jsx'],
    rules: {
      ...nextPlugin.configs['core-web-vitals'].rules,
    },
  },
  { languageOptions: { globals: { ...globals.jest } } },
  {
    files: ['**/*.ts', '**/*.tsx', '**/*.js', '**/*.jsx'],
    rules: {
      '@next/next/no-html-link-for-pages': ['error', 'apps/console/pages'],
    },
  },
  {
    files: ['**/*.ts', '**/*.tsx'],
    // Override or add rules here
    rules: {},
  },
  {
    files: ['**/*.js', '**/*.jsx'],
    // Override or add rules here
    rules: {},
  },
  {
    // `public/monaco` is vendored Monaco, copied out of node_modules by
    // next.config.js (AGL-1779). ESLint 9 does not read .gitignore, so
    // without this the 121 minified files it writes are linted as project
    // source and turn `nx lint console` red with ~120 no-useless-escape
    // errors from someone else's bundle.
    // The `**/` prefix is load-bearing: flat-config ignore patterns resolve
    // against the CWD eslint was invoked from (the workspace root, under
    // `nx lint console`), not against this file — which is why the two
    // entries beside it never matched anything either.
    ignores: ['next-env.d.ts', '.next', '**/public/monaco/**'],
  },
]

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
      '@next/next/no-html-link-for-pages': ['error', 'apps/tenant/pages'],
    },
  },
  {
    files: ['**/*.ts', '**/*.tsx'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: ['@mui/*/*/*', '!@mui/material/test-utils/*'],
          paths: [
            {
              name: '@aglyn/shared-ui-jsx',
              message:
                'The shared-ui-jsx barrel duplicates the module graph in the tenant app and blanks the site (AGL-52). Use @aglyn/aglyn exports instead.',
            },
          ],
        },
      ],
    },
  },
  {
    files: ['**/*.js', '**/*.jsx'],
    // Override or add rules here
    rules: {},
  },
  {
    ignores: ['next-env.d.ts', '.next'],
  },
]

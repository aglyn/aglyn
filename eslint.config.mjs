import nextPlugin from '@next/eslint-plugin-next'
import tsPlugin from '@typescript-eslint/eslint-plugin'
import nx from '@nx/eslint-plugin'
import importPlugin from 'eslint-plugin-import'
import jsxA11yPlugin from 'eslint-plugin-jsx-a11y'
import eslintPluginMobx from 'eslint-plugin-mobx'
import reactPlugin from 'eslint-plugin-react'
import reactHooksPlugin from 'eslint-plugin-react-hooks'
import eslintPluginTsdoc from 'eslint-plugin-tsdoc'

// Mirrors the legacy eslintrc "overrides" semantics: each nx preset only
// applies to the extension block that extended it, so a later block cannot
// stomp an earlier block's rule severities.
const scopeTo = (configs, files) => configs.map((config) => ({ ...config, files }))

const tsRuleOverrides = {
  '@typescript-eslint/ban-ts-comment': 'off',
  '@typescript-eslint/no-empty-function': 'off',
  '@typescript-eslint/no-empty-interface': 'off',
  '@typescript-eslint/no-empty-object-type': 'off',
  '@typescript-eslint/no-explicit-any': 'off',
  '@typescript-eslint/no-namespace': 'warn',
  '@typescript-eslint/no-non-null-assertion': 'off',
  '@typescript-eslint/no-unused-vars': 'warn',
  '@typescript-eslint/no-unused-expressions': [
    'error',
    { allowShortCircuit: true, allowTernary: true },
  ],
  '@typescript-eslint/no-var-requires': 'off',
  'no-fallthrough': 'off',
  'no-restricted-imports': [
    'error',
    {
      patterns: ['@mui/*/*/*', '!@mui/material/test-utils/*'],
    },
  ],
  'react/no-children-prop': 'off',
  'react-hooks/rules-of-hooks': 'warn',
  'react-hooks/exhaustive-deps': 'warn',
}

const jsRuleOverrides = {
  'no-fallthrough': 'off',
  'no-unused-expressions': [
    'error',
    { allowShortCircuit: true, allowTernary: true },
  ],
  'no-restricted-imports': [
    'error',
    {
      patterns: ['@mui/*/*/*', '!@mui/material/test-utils/*'],
    },
  ],
  'react/no-children-prop': 'off',
  'react-hooks/rules-of-hooks': 'warn',
  'react-hooks/exhaustive-deps': 'warn',
}

export default [
  ...nx.configs['flat/base'],
  {
    plugins: {
      '@typescript-eslint': tsPlugin,
      tsdoc: eslintPluginTsdoc,
      mobx: eslintPluginMobx,
      '@next/next': nextPlugin,
      react: reactPlugin,
      'react-hooks': reactHooksPlugin,
      'jsx-a11y': jsxA11yPlugin,
      import: importPlugin,
    },
  },
  {
    files: ['**/*.ts', '**/*.tsx', '**/*.js', '**/*.jsx'],
    rules: {
      'mobx/exhaustive-make-observable': 'off',
      'mobx/unconditional-make-observable': 'off',
      'mobx/missing-make-observable': 'off',
      'mobx/missing-observer': 'off',
      'node/no-extraneous-import': 'off',
      '@nx/enforce-module-boundaries': [
        'error',
        {
          allow: [],
          enforceBuildableLibDependency: true,
          checkDynamicDependenciesExceptions: ['@aglyn/besigner-ui'],
          depConstraints: [
            {
              sourceTag: 'scope:lib',
              onlyDependOnLibsWithTags: ['scope:lib'],
            },
            {
              sourceTag: 'scope:data',
              onlyDependOnLibsWithTags: ['scope:data', 'scope:util'],
            },
            {
              sourceTag: 'scope:feature',
              onlyDependOnLibsWithTags: [
                'scope:data',
                'scope:feature',
                'scope:ui',
                'scope:util',
              ],
            },
            {
              sourceTag: 'scope:ui',
              onlyDependOnLibsWithTags: [
                'scope:data',
                'scope:ui',
                'scope:util',
              ],
            },
            {
              sourceTag: 'scope:util',
              onlyDependOnLibsWithTags: ['scope:util', 'scope:data'],
            },
            {
              sourceTag: 'scope:addons',
              onlyDependOnLibsWithTags: [
                'scope:addons',
                'scope:aglyn',
                'scope:shared',
                'scope:ui',
                'scope:framework',
                'scope:util',
                'scope:data',
                'scope:renderer',
                'scope:feature',
                'scope:lib',
              ],
            },
            {
              sourceTag: 'scope:aglyn',
              onlyDependOnLibsWithTags: ['scope:aglyn', 'scope:shared'],
            },
            {
              sourceTag: 'scope:shared',
              onlyDependOnLibsWithTags: ['scope:shared'],
            },
            {
              sourceTag: 'aglyn:framework',
              onlyDependOnLibsWithTags: ['aglyn:framework', 'scope:shared'],
            },
            {
              sourceTag: 'aglyn:renderer',
              onlyDependOnLibsWithTags: ['aglyn:framework', 'scope:shared'],
            },
            {
              sourceTag: '*',
              onlyDependOnLibsWithTags: ['*'],
            },
          ],
        },
      ],
    },
  },
  ...scopeTo(nx.configs['flat/typescript'], ['**/*.ts']),
  {
    files: ['**/*.ts'],
    rules: {
      ...nextPlugin.configs['core-web-vitals'].rules,
      ...tsRuleOverrides,
      'react-hooks/exhaustive-deps': 'warn',
      'react-hooks/rules-of-hooks': 'warn',
      'tsdoc/syntax': 'warn',
    },
  },
  ...scopeTo(
    [...nx.configs['flat/typescript'], ...nx.configs['flat/react-typescript']],
    ['**/*.tsx'],
  ),
  {
    files: ['**/*.tsx'],
    rules: {
      ...nextPlugin.configs['core-web-vitals'].rules,
      ...tsRuleOverrides,
    },
  },
  ...scopeTo(nx.configs['flat/javascript'], ['**/*.js']),
  {
    files: ['**/*.js'],
    rules: {
      ...reactHooksPlugin.configs.recommended.rules,
      ...jsRuleOverrides,
    },
  },
  ...scopeTo(nx.configs['flat/javascript'], ['**/*.jsx']),
  {
    files: ['**/*.jsx'],
    rules: {
      ...reactHooksPlugin.configs.recommended.rules,
      ...jsRuleOverrides,
    },
  },
  {
    ignores: [
      '.github',
      '/workspace.json',
      '**/next-env.d.ts',
      '**/.next/**',
      '**/dist/**',
      '**/coverage/**',
      '**/.docusaurus/**',
    ],
  },
]

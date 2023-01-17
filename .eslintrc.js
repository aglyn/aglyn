/**
 * @license
 * Copyright 2023 Aglyn LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *   http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

module.exports = {
  root: true,
  ignorePatterns: ['**/*'],
  plugins: ['@nrwl/nx', 'eslint-plugin-tsdoc', 'mobx'],
  overrides: [
    {
      files: ['*.ts', '*.tsx', '*.js', '*.jsx'],
      rules: {
        'mobx/exhaustive-make-observable': 'off',
        'mobx/unconditional-make-observable': 'off',
        'mobx/missing-make-observable': 'off',
        'mobx/missing-observer': 'off',

        'node/no-extraneous-import': 'off',
        '@nrwl/nx/enforce-module-boundaries': [
          'error',
          {
            allow: [],
            enforceBuildableLibDependency: true,
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
                onlyDependOnLibsWithTags: ['scope:util'],
              },
              {
                sourceTag: 'scope:addons',
                onlyDependOnLibsWithTags: [
                  'scope:addons',
                  'scope:aglyn',
                  'scope:shared',
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
    {
      files: ['*.ts'],
      extends: [
        'plugin:@nrwl/nx/typescript',
        'plugin:@next/next/core-web-vitals',
      ],
      rules: {
        '@typescript-eslint/ban-ts-comment': 'off',
        '@typescript-eslint/no-empty-function': 'off',
        '@typescript-eslint/no-empty-interface': 'off',
        '@typescript-eslint/no-explicit-any': 'off',
        '@typescript-eslint/no-namespace': 'warn',
        '@typescript-eslint/no-non-null-assertion': 'off',
        '@typescript-eslint/no-unused-vars': 'warn',
        '@typescript-eslint/no-var-requires': 'off',
        'no-fallthrough': 'off',
        'no-restricted-imports': [
          'error',
          {
            patterns: ['@mui/*/*/*', '!@mui/material/test-utils/*'],
          },
        ],
        'react-hooks/exhaustive-deps': 'error',
        'react-hooks/rules-of-hooks': 'warn',
        'tsdoc/syntax': ['warn', {}],
        'react/no-children-prop': 'off',
      },
    },
    {
      files: ['*.tsx'],
      extends: [
        'plugin:@nrwl/nx/typescript',
        'plugin:@nrwl/nx/react-typescript',
        'plugin:@next/next/core-web-vitals',
      ],
      rules: {
        '@typescript-eslint/ban-ts-comment': 'off',
        '@typescript-eslint/no-empty-function': 'off',
        '@typescript-eslint/no-empty-interface': 'off',
        '@typescript-eslint/no-explicit-any': 'off',
        '@typescript-eslint/no-namespace': 'warn',
        '@typescript-eslint/no-non-null-assertion': 'off',
        '@typescript-eslint/no-unused-vars': 'warn',
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
        'react-hooks/exhaustive-deps': 'error',
      },
    },
    {
      files: ['*.js'],
      extends: ['plugin:@nrwl/nx/javascript', 'plugin:react-hooks/recommended'],
      rules: {
        'no-fallthrough': 'off',
        'no-restricted-imports': [
          'error',
          {
            patterns: ['@mui/*/*/*', '!@mui/material/test-utils/*'],
          },
        ],
        'react/no-children-prop': 'off',
        'react-hooks/rules-of-hooks': 'warn',
        'react-hooks/exhaustive-deps': 'error',
      },
    },
    {
      files: ['*.jsx'],
      extends: ['plugin:@nrwl/nx/javascript', 'plugin:react-hooks/recommended'],
      rules: {
        'no-fallthrough': 'off',
        'no-restricted-imports': [
          'error',
          {
            patterns: ['@mui/*/*/*', '!@mui/material/test-utils/*'],
          },
        ],
        'react/no-children-prop': 'off',
        'react-hooks/rules-of-hooks': 'warn',
        'react-hooks/exhaustive-deps': 'error',
      },
    },
  ],
}

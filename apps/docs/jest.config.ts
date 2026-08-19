/* eslint-disable */
/**
 * @license
 * Copyright 2026 Aglyn LLC
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

/* eslint-disable */
export default {
  displayName: 'docs',
  preset: '../../jest.preset.js',
  testEnvironment: 'jsdom',
  // BABEL, not ts-jest — deliberately, and not merely for speed.
  //
  // Every other project in this workspace type-checks its specs through
  // ts-jest and a `tsconfig.spec.json`. This app cannot: it resolves
  // TypeScript 5.6.3 (pinned by `@docusaurus/tsconfig`) while the root is on
  // 6.0.2, and the last time those two met in one config `docs:typecheck` was
  // silently red for four weeks with zero type coverage (AGL-2363). Babel
  // STRIPS types and checks none, so this transform cannot care which
  // TypeScript wins — and it does not have to, because `docs:typecheck`
  // already type-checks this app with its OWN compiler. Types there,
  // behaviour here.
  transform: {
    '^.+\\.[tj]sx?$': [
      'babel-jest',
      {
        presets: [
          ['@babel/preset-env', { targets: { node: 'current' } }],
          '@babel/preset-typescript',
        ],
      },
    ],
  },
  moduleNameMapper: {
    // Docusaurus synthesises this module during a build; nothing supplies it
    // to a unit test. The stub reads a per-test global so a spec can decide
    // what the site config says — which is the whole point, since the
    // beacon's arming gate is a `customFields` value (AGL-2124).
    '^@generated/docusaurus\\.config$':
      '<rootDir>/specs/docusaurus-config.stub.ts',
  },
  moduleFileExtensions: ['ts', 'tsx', 'js', 'jsx'],
  // The Docusaurus build output and its generated cache are full of .js and
  // their own package.json files; leaving them visible makes jest's haste map
  // warn about duplicate modules and slows every run.
  modulePathIgnorePatterns: ['<rootDir>/build/', '<rootDir>/.docusaurus/'],
  testPathIgnorePatterns: [
    '/node_modules/',
    '<rootDir>/build/',
    '<rootDir>/.docusaurus/',
  ],
  coverageDirectory: '../../coverage/apps/docs',
}

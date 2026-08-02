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

/**
 * Integration tests against a live Firestore emulator (AGL-958).
 *
 * Separate from `jest.config.ts` so `nx test` never runs them — they need an
 * emulator on 8082 and would fail the sweep on any machine without one.
 *
 *   npx firebase emulators:start --only firestore --project aglyn-main
 *   npx jest --config libs/tenant/data/admin/jest.integration.config.ts
 */
export default {
  displayName: 'tenant-data-admin-integration',
  preset: '../../../../jest.preset.js',
  testEnvironment: 'node',
  testMatch: ['**/*.integration.spec.ts'],
  setupFiles: ['<rootDir>/jest.integration.setup.ts'],
  transform: {
    '^.+\\.[tj]sx?$': [
      'ts-jest',
      { tsconfig: '<rootDir>/tsconfig.spec.json' },
    ],
  },
  moduleFileExtensions: ['ts', 'tsx', 'js', 'jsx'],
}

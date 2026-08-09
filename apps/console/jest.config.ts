/* eslint-disable */
/**
 * @license
 * Copyright 2022 Aglyn LLC
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
module.exports = {
  displayName: 'console',
  preset: '../../jest.preset.js',
  transform: {
    '^(?!.*\\.(js|jsx|ts|tsx|css|json)$)': '@nx/react/plugins/jest',
    '^.+\\.[tj]sx?$': ['babel-jest', { presets: ['@nx/next/babel'] }],
  },
  moduleFileExtensions: ['ts', 'tsx', 'js', 'jsx'],
  coverageDirectory: '../../coverage/apps/console',
  // The suite's heavy RTL specs (full MUI trees under emotion) cost 1-2 s of
  // CPU per test even on an idle machine. Under parallel workers a starved
  // worker blows jest's default 5 s testTimeout on whichever of them loses
  // the CPU lottery that run — captured as "Exceeded timeout of 5000 ms" on
  // reusable-components-provider (AGL-1257) and publish-plugin-form. The
  // timeout exists to catch hangs, not to race the scheduler: 30 s still
  // fails a genuine hang, and assertion failures are unaffected.
  testTimeout: 30000,
}

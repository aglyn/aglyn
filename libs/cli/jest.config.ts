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
  displayName: 'cli',
  preset: '../../jest.preset.js',
  testEnvironment: 'node',
  transform: {
    '^.+\\.[tj]sx?$': ['babel-jest', { presets: ['@nx/react/babel'] }],
  },
  moduleFileExtensions: ['ts', 'tsx', 'js', 'jsx'],
  /*
    The package ships ESM, so its relative imports carry the `.js` extension
    Node requires at runtime — `./lib/cli.js`, resolved against the emitted
    file. Jest resolves against the TypeScript SOURCE, where that file does not
    exist, so the extension is stripped back off here.

    Without it the specifiers have to be extensionless, and then the built
    binary throws ERR_MODULE_NOT_FOUND on its first line while every unit test
    passes — which is exactly what happened before this line existed.
  */
  moduleNameMapper: { '^(\\.{1,2}/.*)\\.js$': '$1' },
  coverageDirectory: '../../coverage/libs/cli',
}

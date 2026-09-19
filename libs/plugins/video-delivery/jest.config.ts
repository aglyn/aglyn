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

export default {
  displayName: 'plugins-video-delivery',
  preset: '../../../jest.preset.js',
  // Node, not jsdom: everything here runs on a server or in a Worker, both
  // of which have Web Crypto, `fetch`, `Request` and `Response` as globals.
  testEnvironment: 'node',
  transform: {
    '^.+\\.[tj]sx?$': [
      '@swc/jest',
      // swcrc: false keeps the build-oriented .swcrc (which excludes spec
      // files) from being applied to the jest transform.
      { swcrc: false },
    ],
  },
  moduleFileExtensions: ['ts', 'js'],
  coverageDirectory: '../../../coverage/libs/plugins/video-delivery',
}

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

import { existsSync, readFileSync, statSync } from 'fs'
import { join } from 'path'
import {
  ROBOTO_FLEX_BASE_PATH,
  ROBOTO_FLEX_FACES,
} from '@aglyn/shared-ui-theme/util/roboto-flex'

const PUBLIC = join(__dirname, '..', 'public')

/**
 * Every Roboto Flex file the console's `@font-face` rules name is a file
 * this app actually serves, with the licence beside it (AGL-3655). A rule
 * pointing at a missing file fails silently in a browser: the page just
 * renders the stand-in forever.
 */
describe('the console serves Roboto Flex', () => {
  it.each(ROBOTO_FLEX_FACES.map((face) => [face.subset, face.file]))(
    'serves the %s file',
    (_subset, file) => {
      const path = join(PUBLIC, ROBOTO_FLEX_BASE_PATH, file)
      expect(existsSync(path)).toBe(true)
      expect(readFileSync(path).subarray(0, 4).toString('latin1')).toBe('wOF2')
      // The preloaded file is on every page's critical path; a recut that
      // keeps more axes or ranges should be a decision, not an accident.
      expect(statSync(path).size).toBeLessThan(60 * 1024)
    },
  )

  it('ships the OFL beside the files', () => {
    const licence = readFileSync(
      join(PUBLIC, ROBOTO_FLEX_BASE_PATH, 'OFL.txt'),
      'utf8',
    )
    expect(licence).toContain('SIL OPEN FONT LICENSE Version 1.1')
  })
})

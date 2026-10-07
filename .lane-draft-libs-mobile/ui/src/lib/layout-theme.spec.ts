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

import { layoutFor, TABLET_MIN_SHORT_SIDE } from './layout'
import { darkTheme, lightTheme } from './theme'

describe('layoutFor', () => {
  it.each([
    [390, 844, 'phone', 'portrait', false],
    [844, 390, 'phone', 'landscape', false],
    [1024, 1366, 'tablet', 'portrait', true],
    [1366, 1024, 'tablet', 'landscape', true],
    [TABLET_MIN_SHORT_SIDE, 1024, 'tablet', 'portrait', true],
  ] as const)('%i×%i is a %s in %s (split %s)', (width, height, formFactor, orientation, split) => {
    expect(layoutFor(width, height)).toEqual({ width, height, formFactor, orientation, split })
  })
})

describe('theme', () => {
  it('reads its colors from the mirrored console palette', () => {
    expect(lightTheme.palette.primary.main).toBe('#00b0ff')
    expect(darkTheme.palette.background.default).not.toBe(lightTheme.palette.background.default)
    expect(lightTheme.spacing(2)).toBe(16)
  })
})

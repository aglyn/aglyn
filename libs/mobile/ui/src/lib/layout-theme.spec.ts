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

jest.mock('@react-native-async-storage/async-storage', () => ({ getItem: jest.fn(), setItem: jest.fn() }))

import { layoutFor, TABLET_MIN_SHORT_SIDE } from './layout'
import { createMobileTheme } from './theme'
import { MOBILE_THEME_TOKENS } from './tokens'

describe('layoutFor', () => {
  it.each([
    [390, 844, 'phone', 'portrait', false],
    [932, 430, 'phone', 'landscape', false],
    [744, 1133, 'tablet', 'portrait', false],
    [1133, 744, 'tablet', 'landscape', true],
    [1024, 1366, 'tablet', 'portrait', true],
    [1366, 1024, 'tablet', 'landscape', true],
    [320, 1024, 'phone', 'portrait', false],
    [TABLET_MIN_SHORT_SIDE, 1024, 'tablet', 'portrait', false],
  ] as const)('%i×%i is a %s in %s (split %s)', (width, height, formFactor, orientation, split) => {
    expect(layoutFor(width, height)).toMatchObject({ width, height, formFactor, kind: formFactor, orientation, split })
  })
})

describe('theme', () => {
  it('reads its colors from the console palette the generator wrote', () => {
    const light = createMobileTheme('light')
    const dark = createMobileTheme('dark')
    expect(light.colors.primary.main).toBe(MOBILE_THEME_TOKENS.light.primary.main)
    expect(dark.colors.background.default).not.toBe(light.colors.background.default)
    expect(light.space(2)).toBe(16)
  })
})

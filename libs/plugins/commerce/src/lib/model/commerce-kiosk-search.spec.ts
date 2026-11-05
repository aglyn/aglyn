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

import { posKioskNameMatches } from './commerce-kiosk-search'

describe('posKioskNameMatches (AGL-4060)', () => {
  it.each([
    ['nothing typed', '   ', true],
    ['the start of the first word', 'zeb', true],
    ['the start of a later word', 'lat', true],
    ['any case, with stray spaces', '  ZEBRA   latte ', true],
    ['every word', 'latte zeb', true],
    ['the middle of a word', 'ebra', false],
    ['one word that misses', 'zebra mocha', false],
    ['a word longer than the stored tokens, as the query caps it', 'zebralattezebralatte', false],
  ])('%s', (_label, typed, expected) => {
    expect(posKioskNameMatches('Zebra Latte', typed)).toBe(expected)
  })

  it('caps a long word where the query does', () => {
    expect(posKioskNameMatches('Internationalization', 'internationalization')).toBe(true)
  })
})

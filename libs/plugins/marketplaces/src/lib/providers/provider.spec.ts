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

import { currencyDecimals, fromMinor, timeMs, toMinor } from './provider'

describe('marketplace money (AGL-3638)', () => {
  it('reads decimal amounts as integer minor units without float math', () => {
    expect(toMinor('12.30')).toBe(1230)
    expect(toMinor('12.3')).toBe(1230)
    expect(toMinor(12.3)).toBe(1230)
    expect(toMinor('0.10')).toBe(10)
    expect(toMinor('19.995')).toBe(2000)
    expect(toMinor('7')).toBe(700)
    expect(toMinor('-1.25')).toBe(-125)
    expect(toMinor('1500', 0)).toBe(1500)
    expect(toMinor('abc')).toBeNull()
    expect(toMinor(undefined)).toBeNull()
    expect(toMinor(Number.NaN)).toBeNull()
  })

  it('writes minor units back as the decimal string a marketplace takes', () => {
    expect(fromMinor(1230)).toBe('12.30')
    expect(fromMinor(5)).toBe('0.05')
    expect(fromMinor(0)).toBe('0.00')
    expect(fromMinor(1500, 0)).toBe('1500')
    expect(fromMinor(-125)).toBe('-1.25')
  })

  it('knows the currencies whose minor unit is not a cent', () => {
    expect(currencyDecimals('usd')).toBe(2)
    expect(currencyDecimals('JPY')).toBe(0)
    expect(currencyDecimals('KWD')).toBe(3)
  })

  it('reads ISO dates and epoch seconds', () => {
    expect(timeMs('2026-10-07T12:00:00Z')).toBe(Date.parse('2026-10-07T12:00:00Z'))
    expect(timeMs(1_790_000_000)).toBe(1_790_000_000_000)
    expect(timeMs('nope')).toBeNull()
  })
})

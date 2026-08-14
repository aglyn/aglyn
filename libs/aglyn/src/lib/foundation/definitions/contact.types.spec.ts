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

import {
  isBlankAddress,
  normalizeAddress,
  normalizePhone,
} from './contact.types'

describe('normalizePhone', () => {
  it('normalizes a bare ten-digit number, the shape production had stored', () => {
    // The real profile doc held one of these on 2026-07-30 — ten digits, no
    // country code, unusable for SMS or for a Stripe customer.
    expect(normalizePhone('5122228232')).toBe('+15122228232')
  })

  it('strips the punctuation humans type', () => {
    expect(normalizePhone('(512) 555-0123')).toBe('+15125550123')
    expect(normalizePhone('512.555.0123')).toBe('+15125550123')
    expect(normalizePhone('  512 555 0123  ')).toBe('+15125550123')
  })

  it('keeps an explicit country code', () => {
    expect(normalizePhone('+44 20 7946 0958')).toBe('+442079460958')
    expect(normalizePhone('+1 512 555 0123')).toBe('+15125550123')
  })

  it('accepts NANP with a leading 1', () => {
    expect(normalizePhone('1-512-555-0123')).toBe('+15125550123')
  })

  it('returns null rather than a half-cleaned string', () => {
    // The point of the null: a partially normalized phone is the same bug in
    // a new format, and it would look normalized to every later reader.
    expect(normalizePhone('555-0123')).toBeNull()
    expect(normalizePhone('not a phone')).toBeNull()
    expect(normalizePhone('')).toBeNull()
    expect(normalizePhone(null)).toBeNull()
    expect(normalizePhone('+123')).toBeNull()
  })

  it('refuses to guess a country outside NANP', () => {
    // Inferring +49 for a bare German national number invents a different
    // subscriber; better to store nothing and ask.
    expect(normalizePhone('5122228232', 'DE')).toBeNull()
    // ...but an explicit country code is still honoured under any default.
    expect(normalizePhone('+49 30 12345678', 'DE')).toBe('+493012345678')
  })
})

describe('normalizeAddress', () => {
  it('trims and uppercases the country', () => {
    expect(
      normalizeAddress({
        line1: '  125 Johnston Ln ',
        city: 'Jarrell',
        state: 'TX',
        postalCode: '76537',
        country: 'us',
      }),
    ).toEqual({
      line1: '125 Johnston Ln',
      city: 'Jarrell',
      state: 'TX',
      postalCode: '76537',
      country: 'US',
    })
  })

  it('drops a country that is not ISO-3166 alpha-2', () => {
    // A typed country name would make Stripe reject the whole customer
    // update, taking the rest of the address down with it.
    const result = normalizeAddress({ line1: '1 A St', country: 'United States' })
    expect(result).toEqual({ line1: '1 A St' })
    expect(result?.country).toBeUndefined()
  })

  it('returns null for an address with nothing in it', () => {
    // An object of empty strings reads as "has an address" to every
    // `if (address)` in the codebase.
    expect(normalizeAddress({ line1: '', city: '   ', country: '' })).toBeNull()
    expect(normalizeAddress({})).toBeNull()
    expect(normalizeAddress(null)).toBeNull()
  })

  it('omits absent fields instead of storing empty strings', () => {
    expect(normalizeAddress({ line1: '1 A St', line2: '' })).toEqual({
      line1: '1 A St',
    })
  })
})

describe('isBlankAddress', () => {
  it('is true for absent, empty and whitespace-only', () => {
    expect(isBlankAddress(null)).toBe(true)
    expect(isBlankAddress({})).toBe(true)
    expect(isBlankAddress({ line1: '   ' })).toBe(true)
  })

  it('is false as soon as one field has content', () => {
    expect(isBlankAddress({ country: 'US' })).toBe(false)
    expect(isBlankAddress({ line1: '1 A St' })).toBe(false)
  })
})

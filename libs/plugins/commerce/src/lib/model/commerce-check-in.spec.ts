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
import { validateProduct, type HostProduct } from './commerce'
import {
  alreadyCheckedInLabel,
  checkInCustomers,
  checkInItemLabel,
  checkInSearchToken,
  describeWristband,
  normalizeWristband,
  productCheckInFor,
  productCheckInProblem,
  productNeedsCheckIn,
  type CheckInRow,
} from './commerce-check-in'

/** The product setting, wristbands and the labels the window reads (AGL-4043). */

const product = (extra: Partial<HostProduct> = {}): HostProduct => ({
  name: 'Day pass',
  slug: 'day-pass',
  type: 'service',
  status: 'active',
  variants: [
    { id: 'adult', priceUsd: 40 },
    { id: 'kid', priceUsd: 20, checkIn: { enabled: true, headcount: 2 } },
    { id: 'spectator', priceUsd: 5, checkIn: { enabled: false } },
  ],
  ...extra,
})

describe('which items need check-in, and for how many people', () => {
  it('follows the product, overridden by a variant', () => {
    const pass = product({ checkIn: { enabled: true } })
    expect(productCheckInFor(pass, 'adult')).toEqual({ headcount: 1 })
    expect(productCheckInFor(pass, 'kid')).toEqual({ headcount: 2 })
    expect(productCheckInFor(pass, 'spectator')).toBeNull()
    expect(productCheckInFor(pass, 'unknown')).toEqual({ headcount: 1 })
  })

  it('a product that is off can still have one variant that needs it', () => {
    const off = product()
    expect(productCheckInFor(off, 'adult')).toBeNull()
    expect(productCheckInFor(off, 'kid')).toEqual({ headcount: 2 })
    expect(productNeedsCheckIn(off)).toBe(true)
    expect(productNeedsCheckIn(product({ variants: [{ id: 'default', priceUsd: 1 }] }))).toBe(false)
    expect(productCheckInFor(null, 'adult')).toBeNull()
  })

  it('refuses a headcount that is not a whole number from 1 to 50, on the product or a variant', () => {
    expect(productCheckInProblem({ enabled: true, headcount: 0 })).toMatch(/1 to 50/)
    expect(productCheckInProblem({ enabled: true, headcount: 1.5 })).toMatch(/1 to 50/)
    expect(productCheckInProblem({ enabled: 'yes' })).toMatch(/on or off/)
    expect(productCheckInProblem(undefined)).toBeNull()
    expect(validateProduct(product({ checkIn: { enabled: true, headcount: 51 } }))).toMatch(/1 to 50/)
    expect(
      validateProduct(product({ variants: [{ id: 'default', priceUsd: 1, checkIn: { enabled: true, headcount: -1 } }] })),
    ).toMatch(/1 to 50/)
    expect(validateProduct(product({ checkIn: { enabled: true, headcount: 3 } }))).toBeNull()
  })
})

describe('wristbands', () => {
  it('takes a number and a color word, either optional', () => {
    expect(normalizeWristband({ number: ' 214 ', color: 'Blue' })).toEqual({
      ok: true,
      wristband: { number: '214', color: 'Blue' },
    })
    expect(normalizeWristband({ number: '', color: '' })).toEqual({ ok: true, wristband: null })
    expect(normalizeWristband(undefined)).toEqual({ ok: true, wristband: null })
    expect(normalizeWristband({ number: '<script>' })).toMatchObject({ ok: false })
    expect(normalizeWristband({ color: '#00f' })).toMatchObject({ ok: false })
    expect(normalizeWristband({ number: 'x'.repeat(25) })).toMatchObject({ ok: false })
    expect(describeWristband({ number: '214', color: 'Blue' })).toBe('Blue #214')
    expect(describeWristband(null)).toBe('')
  })
})

describe('what the window reads', () => {
  const row = (extra: Partial<CheckInRow>): CheckInRow =>
    ({
      id: 'o_a_0_0',
      customerKey: 'email:a@example.com',
      customerName: 'Jordan Lee',
      customerEmail: 'a@example.com',
      customerPhone: null,
      contactId: null,
      itemName: 'Day pass',
      variantLabel: null,
      unitIndex: 0,
      unitCount: 1,
      status: 'expected',
      ...extra,
    }) as CheckInRow

  it('groups check-ins by customer, the ones with most left to check in first', () => {
    const customers = checkInCustomers([
      row({ customerKey: 'k1', customerName: 'Ann', status: 'checked_in' }),
      row({ customerKey: 'k2', customerName: 'Bo' }),
      row({ customerKey: 'k2', customerName: 'Bo', itemName: 'Camping' }),
    ])
    expect(customers.map((c) => `${c.name} ${c.unitsCheckedIn}/${c.unitsDue} ${c.items.join('+')}`)).toEqual([
      'Bo 0/2 Day pass+Camping',
      'Ann 1/1 Day pass',
    ])
  })

  it('names each person and who checked them in, on the site’s clock', () => {
    expect(checkInItemLabel(row({ variantLabel: 'Adult', unitIndex: 1, unitCount: 3 }))).toBe('Day pass · Adult (2 of 3)')
    expect(checkInItemLabel(row({}))).toBe('Day pass')
    expect(
      alreadyCheckedInLabel(
        { checkedInAtMs: Date.UTC(2027, 0, 15, 15, 14), checkedInByName: 'Sam' },
        'America/Chicago',
      ),
    ).toBe('Already checked in at 9:14 AM by Sam')
  })

  it('asks the index for a phone’s digits or a word’s prefix', () => {
    expect(checkInSearchToken('(555) 201')).toBe('555201')
    expect(checkInSearchToken('Jordan Lee')).toBe('jordan')
    expect(checkInSearchToken('#1042')).toBe('#1042')
    expect(checkInSearchToken('12')).toBe('')
  })
})

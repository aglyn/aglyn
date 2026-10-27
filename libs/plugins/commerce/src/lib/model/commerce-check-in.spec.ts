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
  addCheckInDays,
  alreadyCheckedInLabel,
  checkInCustomers,
  checkInDayLabel,
  checkInDayTotals,
  checkInItemLabel,
  checkInSearchToken,
  checkInStatusLabel,
  checkInUseDayProblem,
  describeWristband,
  dueCheckInsForOrder,
  dueCheckInsForReservation,
  isCheckInDayKey,
  normalizeProductCheckIn,
  normalizeWristband,
  productAsksUseDate,
  productCheckInFor,
  productCheckInProblem,
  productNeedsCheckIn,
  rainCheckLabel,
  rainCheckProblem,
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
    expect(productCheckInFor(pass, 'adult')).toEqual({ headcount: 1, askUseDate: false })
    expect(productCheckInFor(pass, 'kid')).toEqual({ headcount: 2, askUseDate: false })
    expect(productCheckInFor(pass, 'spectator')).toBeNull()
    expect(productCheckInFor(pass, 'unknown')).toEqual({ headcount: 1, askUseDate: false })
  })

  it('a product that is off can still have one variant that needs it', () => {
    const off = product()
    expect(productCheckInFor(off, 'adult')).toBeNull()
    expect(productCheckInFor(off, 'kid')).toEqual({ headcount: 2, askUseDate: false })
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

describe('the day a pass is for (pass dates)', () => {
  it('asks the buyer only where the product or the variant says so', () => {
    const pass = product({ checkIn: { enabled: true, askUseDate: true } })
    expect(productCheckInFor(pass, 'adult')).toEqual({ headcount: 1, askUseDate: true })
    expect(productAsksUseDate(pass, 'adult')).toBe(true)
    // A variant's own setting replaces the product's, asking or not.
    expect(productAsksUseDate(pass, 'kid')).toBe(false)
    expect(productAsksUseDate(pass, 'spectator')).toBe(false)
    expect(productAsksUseDate(product(), 'adult')).toBe(false)
  })

  it('keeps the ask only on a setting that is on, and refuses one that is not on or off', () => {
    expect(normalizeProductCheckIn({ enabled: true, askUseDate: true })).toEqual({
      enabled: true,
      headcount: 1,
      askUseDate: true,
    })
    expect(normalizeProductCheckIn({ enabled: true, askUseDate: 'yes' })).toEqual({ enabled: true, headcount: 1 })
    expect(normalizeProductCheckIn({ enabled: false, askUseDate: true })).toEqual({ enabled: false })
    expect(productCheckInProblem({ enabled: true, askUseDate: 'yes' })).toMatch(/on or off/)
    expect(productCheckInProblem({ enabled: true, askUseDate: true })).toBeNull()
  })

  it('takes today or a later day within two years, on the store’s calendar', () => {
    expect(isCheckInDayKey('2027-02-28')).toBe(true)
    expect(isCheckInDayKey('2027-02-30')).toBe(false)
    expect(isCheckInDayKey('tomorrow')).toBe(false)
    expect(addCheckInDays('2027-12-31', 1)).toBe('2028-01-01')
    expect(checkInUseDayProblem('2027-01-15', '2027-01-15')).toBeNull()
    expect(checkInUseDayProblem('2027-01-14', '2027-01-15')).toMatch(/passed/)
    expect(checkInUseDayProblem('2029-01-14', '2027-01-15')).toBeNull()
    expect(checkInUseDayProblem('2029-01-15', '2027-01-15')).toMatch(/two years/)
    expect(checkInUseDayProblem('2027-1-15', '2027-01-15')).toMatch(/date/)
  })

  it('puts each line on the day its buyer chose, else the day it was bought', () => {
    const products = new Map([['pass', product({ checkIn: { enabled: true, askUseDate: true } })]])
    const due = dueCheckInsForOrder({
      orderId: 'o1',
      order: {
        status: 'paid',
        lineItems: [
          { productId: 'pass', variantId: 'adult', name: 'Day pass', quantity: 2, unitAmountCents: 4000, useDayKey: '2027-01-20' },
          { productId: 'pass', variantId: 'adult', name: 'Day pass', quantity: 1, unitAmountCents: 4000 },
          { productId: 'pass', variantId: 'adult', name: 'Day pass', quantity: 1, unitAmountCents: 4000, useDayKey: 'junk' },
        ],
      },
      products,
      purchaseDayKey: '2027-01-15',
    })
    expect([...due].map(([id, entry]) => `${id} ${entry.dayKey}`)).toEqual([
      'o_o1_0_0 2027-01-20',
      'o_o1_0_1 2027-01-20',
      'o_o1_1_0 2027-01-15',
      'o_o1_2_0 2027-01-15',
    ])
  })
})

describe('rain checks', () => {
  const pass = (extra: Partial<CheckInRow> = {}) =>
    ({ source: 'order', status: 'expected', dayKey: '2027-01-15', ...extra }) as CheckInRow

  it('only on a pass nobody has used yet', () => {
    expect(rainCheckProblem(pass(), { kind: 'open' }, '2027-01-15')).toBeNull()
    expect(rainCheckProblem(pass({ source: 'reservation' }), { kind: 'open' }, '2027-01-15')).toMatch(/Reservations card/)
    expect(rainCheckProblem(pass({ status: 'checked_in' }), { kind: 'open' }, '2027-01-15')).toMatch(/Undo the check-in/)
  })

  it('moves a pass only to a later day that has not passed', () => {
    expect(rainCheckProblem(pass(), { kind: 'date', dayKey: '2027-01-16' }, '2027-01-15')).toBeNull()
    expect(rainCheckProblem(pass(), { kind: 'date', dayKey: '2027-01-15' }, '2027-01-15')).toMatch(/after/)
    expect(rainCheckProblem(pass(), { kind: 'date', dayKey: 'soon' }, '2027-01-15')).toMatch(/date/)
    // Yesterday's unused pass can be moved to today, never to another past day.
    expect(rainCheckProblem(pass({ dayKey: '2027-01-14' }), { kind: 'date', dayKey: '2027-01-15' }, '2027-01-15')).toBeNull()
    expect(rainCheckProblem(pass({ dayKey: '2027-01-10' }), { kind: 'date', dayKey: '2027-01-12' }, '2027-01-15')).toMatch(
      /passed/,
    )
  })

  it('says what happened, and counts an open one apart from those expected', () => {
    const rainCheck = {
      kind: 'open' as const,
      fromDayKey: '2027-01-15',
      toDayKey: null,
      claimedDayKey: null,
      byUid: 'cashier',
      byName: 'Cal',
      atMs: 1,
    }
    expect(checkInDayLabel('2027-01-15')).toBe('Fri, Jan 15')
    expect(rainCheckLabel(pass({ rainCheck, rainCheckOpen: true }))).toBe(
      'Rain check from Fri, Jan 15: good on any later day',
    )
    expect(rainCheckLabel(pass({ rainCheck: { ...rainCheck, claimedDayKey: '2027-01-17' } }))).toBe(
      'Rain check from Fri, Jan 15, used Sun, Jan 17',
    )
    expect(rainCheckLabel(pass({ rainCheck: { ...rainCheck, kind: 'date', toDayKey: '2027-01-16' } }))).toBe(
      'Rain check: moved from Fri, Jan 15 to Sat, Jan 16',
    )
    expect(rainCheckLabel(pass())).toBe('')
    expect(checkInStatusLabel(pass({ rainCheckOpen: true }))).toBe('Rain check')
    expect(
      checkInDayTotals([
        pass({ rainCheckOpen: true }),
        pass(),
        pass({ status: 'checked_in' }),
      ]),
    ).toEqual({ expected: 2, checkedIn: 1, rainChecks: 1 })
  })
})

describe('a stay checked in per guest', () => {
  const stay = { status: 'confirmed' as const, checkInDayMs: Date.UTC(2027, 0, 15), checkOutDayMs: Date.UTC(2027, 0, 17), guestName: 'Sam Rivera', guests: 3 }

  it('makes one check-in per guest each day, or one for the stay', () => {
    const perGuest = dueCheckInsForReservation({ reservationId: 's1', reservation: stay, resourceName: 'Cabin 3', dayKey: '2027-01-16', perGuest: true })
    expect([...perGuest].map(([id, entry]) => `${id} ${entry.unitIndex + 1}/${entry.unitCount}`)).toEqual([
      'r_s1_2027-01-16_0 1/3',
      'r_s1_2027-01-16_1 2/3',
      'r_s1_2027-01-16_2 3/3',
    ])
    const perStay = dueCheckInsForReservation({ reservationId: 's1', reservation: stay, resourceName: 'Cabin 3', dayKey: '2027-01-16' })
    expect([...perStay.keys()]).toEqual(['r_s1_2027-01-16_0'])
    // No guest count: one, whichever way it is checked in.
    const unknown = dueCheckInsForReservation({
      reservationId: 's2',
      reservation: { ...stay, guests: undefined },
      resourceName: 'Cabin 3',
      dayKey: '2027-01-16',
      perGuest: true,
    })
    expect([...unknown.keys()]).toEqual(['r_s2_2027-01-16_0'])
  })
})

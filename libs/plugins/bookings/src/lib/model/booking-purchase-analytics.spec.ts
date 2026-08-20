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
  bookingPlatformNetCents,
  buildBookingPurchaseParams,
  shouldSendBookingPlatformPurchase,
  toBookingPurchaseSource,
} from './booking-purchase-analytics'

/**
 * The MERCHANT-side half of the booking `purchase` (AGL-2481) — and the proof
 * that it is a different number from the one our own property gets.
 *
 * The fixture below is chosen so that all four plausible answers are distinct
 * and none is a round function of another, which is what makes each assertion
 * load-bearing:
 *
 *   9500  gross the guest paid            → wrong: includes the merchant's tax
 *   8716  gross ex-tax                    → RIGHT for the merchant's property
 *   8099  gross ex-tax, less Aglyn's fee  → wrong: their margin, not their sales
 *    617  Aglyn's fee                     → RIGHT for OUR property, wrong here
 */

const GROSS_CENTS = 9500
const TAX_CENTS = 784
const FEE_CENTS = 617

const SOURCE = {
  transactionId: 'cs_booking_1',
  paidAmountCents: GROSS_CENTS,
  taxCents: TAX_CENTS,
  serviceId: 'service-1',
  serviceName: 'Deep tissue massage',
}

describe('the merchant-side value', () => {
  it('is the gross ex-tax — what the merchant sold', () => {
    expect(buildBookingPurchaseParams(SOURCE)?.value).toBe(87.16)
  })

  it('does NOT subtract Aglyn\'s fee — that is their cost of sale', () => {
    // 80.99 would report the merchant's margin after our cut as though it were
    // their sales revenue: not a number any merchant's books, tax return or ad
    // platform recognises, and a few percent of their real one.
    expect(buildBookingPurchaseParams(SOURCE)?.value).not.toBe(80.99)
  })

  it('is NOT the figure our own property receives', () => {
    // The inversion is the whole design. 6.17 here would show every merchant
    // on Aglyn a revenue figure a fraction of their real one.
    expect(buildBookingPurchaseParams(SOURCE)?.value).not.toBe(6.17)
    expect(bookingPlatformNetCents({ metadata: { feeCents: FEE_CENTS } })).toBe(
      617,
    )
  })

  it('excludes tax — money held for an authority is not revenue', () => {
    expect(buildBookingPurchaseParams(SOURCE)?.value).not.toBe(95)
  })

  it('MOVES with the payload rather than recording a constant', () => {
    const cheaper = buildBookingPurchaseParams({
      ...SOURCE,
      paidAmountCents: 4200,
      taxCents: 0,
    })
    expect(cheaper?.value).toBe(42)
  })

  it('sends no `tax` param beside an already-ex-tax value', () => {
    // Beside an ex-tax `value` a `tax` param asserts a relationship that does
    // not hold and invites the subtraction that removes tax a second time.
    expect(buildBookingPurchaseParams(SOURCE)).not.toHaveProperty('tax')
  })

  it('sends no `shipping` param — an appointment ships nothing', () => {
    // Commerce always sends `shipping`, including 0, because on a storefront 0
    // is a true statement. A booking has no shipping concept to be zero, and
    // sending one would put every service business in a shipping report.
    expect(buildBookingPurchaseParams(SOURCE)).not.toHaveProperty('shipping')
  })

  it('carries the service name — it is the merchant\'s own content here', () => {
    const [item] = buildBookingPurchaseParams(SOURCE)?.items ?? []
    expect(item.item_name).toBe('Deep tissue massage')
    expect(item.item_id).toBe('service-1')
  })

  it('sets NO item_category, matching the storefront items', () => {
    // In a merchant's property a constant category is a column with one value.
    // Worse for a merchant running both plugins: products carry none and
    // bookings would carry one, half-populating the dimension.
    const [item] = buildBookingPurchaseParams(SOURCE)?.items ?? []
    expect(item).not.toHaveProperty('item_category')
  })

  it('refuses to invent an event when there is nothing truthful to send', () => {
    expect(buildBookingPurchaseParams({ ...SOURCE, transactionId: '' })).toBeNull()
    expect(
      buildBookingPurchaseParams({ ...SOURCE, paidAmountCents: 0, taxCents: 0 }),
    ).toBeNull()
    // Tax exceeding the charge is nonsense rather than negative revenue.
    expect(
      buildBookingPurchaseParams({ ...SOURCE, paidAmountCents: 100, taxCents: 900 }),
    ).toBeNull()
  })
})

describe('the platform net', () => {
  it('reads the fee that was actually charged', () => {
    expect(bookingPlatformNetCents({ metadata: { feeCents: '617' } })).toBe(617)
  })

  it('is zero — and unsendable — on a 0%-fee tier', () => {
    expect(bookingPlatformNetCents({ metadata: { feeCents: '0' } })).toBe(0)
    expect(
      shouldSendBookingPlatformPurchase({ metadata: { feeCents: '0' } }),
    ).toBe(false)
  })

  it('never reads the gross as a fallback for a missing fee', () => {
    // The failure that would report the guest's whole payment as Aglyn
    // revenue. Absent means zero, never "use the nearest number".
    expect(bookingPlatformNetCents({ amount_total: 9500, metadata: {} })).toBe(0)
    expect(bookingPlatformNetCents({ amount_total: 9500 })).toBe(0)
  })

  it('clamps a negative rather than reporting negative revenue', () => {
    expect(bookingPlatformNetCents({ metadata: { feeCents: '-500' } })).toBe(0)
  })
})

describe('the wire projection', () => {
  it('withholds everything a guest should not hand to Google', () => {
    const source = toBookingPurchaseSource('cs_booking_1', {
      paidAmountCents: GROSS_CENTS,
      taxCents: TAX_CENTS,
      serviceId: 'service-1',
      serviceName: 'Deep tissue massage',
      // All of this is on the real booking document and none of it may travel.
      email: 'rhea@example.com',
      name: 'Rhea Salt',
      startsAtMs: 1_777_000_000_000,
      timezone: 'America/Chicago',
      feeCents: FEE_CENTS,
      paymentIntentId: 'pi_1',
    })

    expect(source).toEqual({
      transactionId: 'cs_booking_1',
      paidAmountCents: GROSS_CENTS,
      taxCents: TAX_CENTS,
      serviceId: 'service-1',
      serviceName: 'Deep tissue massage',
    })
    // Named individually so a future field added to the projection cannot
    // quietly satisfy `toEqual` by being expected.
    expect(source).not.toHaveProperty('email')
    expect(source).not.toHaveProperty('name')
    expect(source).not.toHaveProperty('startsAtMs')
    // A guest has no business learning Aglyn's take rate on their hairdresser.
    expect(source).not.toHaveProperty('feeCents')
  })

  it('treats an untaxed booking as zero tax, not a missing figure', () => {
    const source = toBookingPurchaseSource('cs_booking_1', {
      paidAmountCents: 4200,
      serviceId: 'service-1',
      serviceName: 'Trim',
    })
    expect(source.taxCents).toBe(0)
    expect(buildBookingPurchaseParams(source)?.value).toBe(42)
  })
})

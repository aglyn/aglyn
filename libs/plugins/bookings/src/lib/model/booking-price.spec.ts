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
  BOOKING_PRICE_DISPLAYS,
  bookingChargeUsd,
  bookingPriceDisplay,
  bookingPriceText,
} from './booking-price'

/**
 * How a service states its price (AGL-3475). A label books with no charge,
 * so the text a visitor reads and the amount the route charges are read from
 * one place, and can never disagree.
 */

describe('a service’s price', () => {
  it('reads anything it does not know as the price itself', () => {
    expect(BOOKING_PRICE_DISPLAYS).toEqual(['fixed', 'varies', 'estimate', 'contact'])
    expect(bookingPriceDisplay(undefined)).toBe('fixed')
    expect(bookingPriceDisplay('quote')).toBe('fixed')
    expect(bookingPriceDisplay('estimate')).toBe('estimate')
  })

  it('charges the stored price only when the service states it as the price', () => {
    expect(bookingChargeUsd({ priceUsd: 120 })).toBe(120)
    expect(bookingChargeUsd({ priceUsd: 120, priceDisplay: 'fixed' })).toBe(120)
    for (const priceDisplay of ['varies', 'estimate', 'contact']) {
      expect(bookingChargeUsd({ priceUsd: 120, priceDisplay })).toBe(0)
    }
    expect(bookingChargeUsd({ priceUsd: -5 })).toBe(0)
    expect(bookingChargeUsd({ priceUsd: 'abc' })).toBe(0)
    expect(bookingChargeUsd(null)).toBe(0)
  })

  it('shows the label in place of a price, and never the price beside it', () => {
    expect(bookingPriceText({ priceUsd: 120 })).toBe('$120')
    expect(bookingPriceText({ priceUsd: 0 })).toBe('Free')
    expect(bookingPriceText({ priceUsd: 120, priceDisplay: 'varies' })).toBe('Price varies')
    expect(bookingPriceText({ priceUsd: 120, priceDisplay: 'estimate' })).toBe('Free estimate')
    expect(bookingPriceText({ priceUsd: 0, priceDisplay: 'contact' })).toBe('Contact for price')
  })
})

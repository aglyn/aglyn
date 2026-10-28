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

import { productOfferedOnKiosk } from './commerce-kiosk-offer'

/*
 * "Offer on the kiosk" (AGL-4038): every merchant's own choice of what the
 * self-service kiosk offers, per product and per variant. Only an explicit
 * `false` turns either off, so every product stored before the choice
 * existed is offered exactly as it was.
 */
describe('productOfferedOnKiosk', () => {
  const variants = [{ id: 'small' }, { id: 'large', offerOnKiosk: false }, { id: 'medium', offerOnKiosk: true }]

  it('reads an absent choice as offered, and only `false` as not', () => {
    expect(productOfferedOnKiosk({})).toBe(true)
    expect(productOfferedOnKiosk({ offerOnKiosk: true })).toBe(true)
    expect(productOfferedOnKiosk({ offerOnKiosk: null })).toBe(true)
    expect(productOfferedOnKiosk({ offerOnKiosk: false })).toBe(false)
    expect(productOfferedOnKiosk(null)).toBe(false)
  })

  it("narrows by the variant's own choice, which follows the product when absent", () => {
    expect(productOfferedOnKiosk({ variants }, 'small')).toBe(true)
    expect(productOfferedOnKiosk({ variants }, 'medium')).toBe(true)
    expect(productOfferedOnKiosk({ variants }, 'large')).toBe(false)
    // A variant the product does not list follows the product.
    expect(productOfferedOnKiosk({ variants }, 'missing')).toBe(true)
  })

  it('offers no variant of a product the merchant kept off the kiosk', () => {
    expect(productOfferedOnKiosk({ offerOnKiosk: false, variants }, 'medium')).toBe(false)
  })
})

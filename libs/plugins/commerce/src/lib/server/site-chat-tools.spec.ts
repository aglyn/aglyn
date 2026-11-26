/**
 * @jest-environment node
 */

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

const products: Record<string, Record<string, unknown>> = {}

jest.mock('@aglyn/tenant-data-admin/server/firebase-admin', () => {
  const query = {
    where: () => query,
    limit: () => query,
    get: async () => ({ docs: Object.entries(products).map(([id, data]) => ({ id, data: () => data })) }),
  }
  return {
    firebaseAdmin: {
      app: () => ({
        firestore: () => ({ collection: () => ({ doc: () => ({ collection: () => query }) }) }),
      }),
    },
  }
})
jest.mock('./reservation-availability', () => ({ reservationAvailabilityHandler: jest.fn() }))

import { COMMERCE_SITE_CHAT_TOOLS } from '../site-chat-tool-definitions'
import { commerceProductDetails, commerceProposeAddToCart } from './site-chat-tools'

const product = (extra: Record<string, unknown> = {}) => ({
  name: 'Ride pass',
  slug: 'ride-pass',
  status: 'active',
  deletedAt: null,
  variants: [
    { id: 'v-day', options: { Length: 'Day' }, priceUsd: 45, compareAtPriceUsd: 50 },
    { id: 'v-3', options: { Length: '3-day' }, priceUsd: 95 },
  ],
  ...extra,
})

beforeEach(() => {
  for (const key of Object.keys(products)) delete products[key]
})

describe('commerce site chat tools (AGL-4250)', () => {
  it('declares a lookup and the proposals, each proposal with the door it posts to', () => {
    const proposals = COMMERCE_SITE_CHAT_TOOLS.filter((tool) => tool.kind === 'proposal')
    expect(proposals.map((tool) => [tool.name, tool.capability, tool.endpoints])).toEqual([
      ['commerce_propose_add_to_cart', 'cart', ['commerce/cart']],
      ['commerce_propose_reservation', 'book', ['commerce/reserve']],
    ])
  })

  it('states a product\'s options, sale prices and page', async () => {
    products['p1'] = product()
    const answer = await commerceProductDetails({ hostId: 'h', input: { product: 'ride pass' } })
    expect(answer.text).toContain('- Day: $45 (was $50)')
    expect(answer.text).toContain('page /products/ride-pass')
    expect(answer.cards?.[0]).toMatchObject({ kind: 'product', url: '/products/ride-pass', price: 'From $45' })
  })

  it('asks for the option first, then proposes the add the cart door takes', async () => {
    products['p1'] = product()
    const unsure = await commerceProposeAddToCart({ hostId: 'h', input: { product: 'Ride pass', option: '', quantity: 1, day: '' } })
    expect(unsure.proposal).toBeUndefined()
    expect(unsure.text).toMatch(/Day, 3-day/)
    const sure = await commerceProposeAddToCart({ hostId: 'h', input: { product: 'Ride pass', option: '3-day', quantity: 2, day: '' } })
    expect(sure.proposal).toMatchObject({
      kind: 'add-to-cart',
      afterEvent: 'aglyn:cart-updated',
      request: { path: 'commerce/cart', body: { hostId: 'h', action: 'add', productId: 'p1', variantId: 'v-3', quantity: 2 } },
    })
  })

  it('never proposes a product that is not sold online', async () => {
    products['p1'] = product({ sellOnline: false })
    const answer = await commerceProposeAddToCart({ hostId: 'h', input: { product: 'Ride pass', option: 'Day', quantity: 1, day: '' } })
    expect(answer.proposal).toBeUndefined()
  })
})

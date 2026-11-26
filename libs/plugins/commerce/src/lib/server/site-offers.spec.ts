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

/**
 * A product as another plugin's button sells it, and a stay in site search
 * (AGL-4252).
 */

jest.mock('@aglyn/tenant-data-admin/server/firebase-admin', () => ({
  __esModule: true,
  firebaseAdmin: {},
}))
jest.mock('@aglyn/tenant-data-admin', () => ({
  __esModule: true,
  getOrgForHost: async () => null,
}))
jest.mock('@aglyn/tenant-data-admin/server/release-flags', () => ({
  __esModule: true,
  isServerReleaseFlagOnForLoadedOrg: async () => true,
}))

import { productSiteOffer } from './site-offers'
import { staySiteSearchItem } from './stays-site-search'

const pass = {
  name: 'Night riding pass',
  slug: 'night-pass',
  status: 'active',
  deletedAt: null,
  checkIn: { enabled: true, askUseDate: true },
  variants: [{ id: 'v1', priceUsd: 20 }],
}

describe('productSiteOffer', () => {
  it('posts a one-variant product to the cart, with the day when it asks for one', () => {
    const offer = productSiteOffer('host-1', 'p1', pass, '2026-11-12')
    expect(offer?.title).toBe('Night riding pass')
    expect(offer?.action).toMatchObject({
      kind: 'post',
      endpoint: '/api/commerce/cart',
      body: {
        hostId: 'host-1',
        action: 'add',
        productId: 'p1',
        variantId: 'v1',
        quantity: 1,
        useDayKey: '2026-11-12',
      },
      notify: 'aglyn:cart-updated',
    })
    const undated = productSiteOffer(
      'host-1',
      'p1',
      { ...pass, checkIn: undefined },
      '2026-11-12',
    )
    expect(
      (undated?.action as { body: Record<string, unknown> }).body['useDayKey'],
    ).toBeUndefined()
  })

  it('opens the product page when the shopper must choose', () => {
    const offer = productSiteOffer('host-1', 'p1', {
      ...pass,
      variants: [
        { id: 'v1', priceUsd: 20 },
        { id: 'v2', priceUsd: 30 },
      ],
    })
    expect(offer?.action).toEqual({
      kind: 'link',
      href: '/products/night-pass',
    })
  })

  it('offers nothing the storefront does not list', () => {
    expect(
      productSiteOffer('host-1', 'p1', { ...pass, status: 'draft' }),
    ).toBeNull()
    expect(
      productSiteOffer('host-1', 'p1', { ...pass, deletedAt: 1 }),
    ).toBeNull()
  })
})

describe('staySiteSearchItem', () => {
  it('links a stay to the page its owner named', () => {
    expect(
      staySiteSearchItem({
        name: 'Cafe View cabin',
        description: 'Sleeps four,  on the hill.',
        nightlyRateUsd: 150,
        amenities: ['AC'],
        pagePath: '/cabins/cafe-view',
      }),
    ).toEqual({
      title: 'Cafe View cabin',
      terms: ['Sleeps four, on the hill.', 'AC'],
      url: '/cabins/cafe-view',
      snippet: 'Sleeps four, on the hill.',
      caption: 'From $150 a night',
    })
  })

  it('leaves out a stay with no page, or one that is not a site path', () => {
    expect(
      staySiteSearchItem({ name: 'Tent site', nightlyRateUsd: 20 }),
    ).toBeNull()
    expect(
      staySiteSearchItem({ name: 'Tent site', pagePath: '//evil.example' }),
    ).toBeNull()
  })
})

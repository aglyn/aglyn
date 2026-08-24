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
 * A commerce storefront image never names the platform (AGL-1726).
 *
 * Production stored a product's image as
 * `https://northwind-coffee.aglyn.app/api/media/cdn/{scope}/{mediaId}` — the
 * ABSOLUTE form — and commerce rendered every stored string unresolved:
 * `resolveMediaSrc` and `isRefusedAuthorImageSrc` appeared zero times in this
 * library. On a `*.aglyn.app` storefront that is same-origin and invisible.
 * On a customer's own domain it is three defects at once:
 *
 * 1. our platform subdomain in a white-label customer's page source and in
 *    every one of their visitors' requests;
 * 2. a cross-origin fetch, which an enforced `img-src 'self'` would blank —
 *    the measured reason the AGL-1726 flip cannot proceed;
 * 3. a hard dependency on `aglyn.app` resolving, for a page that has no other
 *    need of it.
 *
 * These tests assert the ABSENCE of the platform host in the rendered DOM,
 * because that is the property the customer is paying for. Asserting only the
 * expected path would pass on a resolver that emitted some OTHER absolute
 * URL.
 *
 * The fixture URL is the real production value, not an invented one.
 */

import { render, screen } from '@testing-library/react'
import ProductDetail from './product-detail'
import ProductGrid from './product-grid'

/** The exact string production carried, in `imageUrl` and in `mediaUrls[0]`. */
const STORED_ABSOLUTE =
  'https://northwind-coffee.aglyn.app/api/media/cdn/4uYCmrbU5t/U3aEMm5tLw'
const EXPECTED_RELATIVE = '/api/media/cdn/4uYCmrbU5t/U3aEMm5tLw'

const WITH_IMAGE = {
  id: 'p1',
  name: 'House Blend Coffee Beans',
  slug: 'house-blend-coffee-beans',
  mediaUrls: [STORED_ABSOLUTE],
  options: [],
  variants: [{ id: 'v1', priceUsd: 18, soldOut: false }],
}

/** The control: a real production product with NO image field at all. */
const WITHOUT_IMAGE = {
  id: 'p2',
  name: 'Consulting Session',
  slug: 'consulting-session',
  mediaUrls: [],
  options: [],
  variants: [{ id: 'v2', priceUsd: 100, soldOut: false }],
}

let pageProduct: unknown = WITH_IMAGE

jest.mock('@aglyn/aglyn', () => ({
  ...jest.requireActual('@aglyn/aglyn'),
  useSite: () => ({
    hostId: '4uYCmrbU5t',
    pageData: { commerce: { product: pageProduct } },
  }),
  useSiteFetch: () => async () => ({ ok: false, json: async () => ({}) }),
}))

const images = () => Array.from(document.querySelectorAll('img'))
const srcs = () => images().map((img) => img.getAttribute('src'))

describe('commerce storefront images are site-relative (AGL-1726)', () => {
  beforeEach(() => {
    pageProduct = WITH_IMAGE
    ;(global as any).fetch = jest.fn(async () => ({
      ok: true,
      json: async () => ({ items: [] }),
    }))
  })

  describe('product detail — the page the production defect was found on', () => {
    it('renders the gallery image with no platform host in the src', async () => {
      render(<ProductDetail />)
      await screen.findByText('House Blend Coffee Beans')
      expect(srcs()).toContain(EXPECTED_RELATIVE)
      // The property, stated directly: nothing in this page's images names us.
      for (const src of srcs()) expect(src).not.toContain('aglyn.app')
    })

    it('renders a src the browser resolves against the CUSTOMER origin', () => {
      render(<ProductDetail />)
      const src = srcs().find((value) => value?.includes('/api/media/cdn/'))
      expect(src).toBeTruthy()
      // Root-relative, so `new URL(src, page)` is same-origin whatever the
      // page's own domain is — the definition of "not cross-origin".
      expect(src?.startsWith('/')).toBe(true)
      expect(new URL(src as string, 'https://acme.com/products/x').origin).toBe(
        'https://acme.com',
      )
    })

    it('CONTROL: a product with no image renders no img at all', async () => {
      pageProduct = WITHOUT_IMAGE
      render(<ProductDetail />)
      await screen.findByText('Consulting Session')
      // Not "an <img> with an empty src" — none. `strictNullChecks` is off
      // repo-wide, so an absent field folds to falsy and a careless resolver
      // turns "no image" into a broken-image icon on a customer's shopfront.
      expect(images()).toHaveLength(0)
    })
  })

  describe('product grid — the same stored string, one card per product', () => {
    it('renders the card image site-relative', async () => {
      ;(global as any).fetch = jest.fn(async () => ({
        ok: true,
        json: async () => ({
          items: [
            {
              id: 'p1',
              name: 'House Blend Coffee Beans',
              slug: 'house-blend-coffee-beans',
              priceUsd: 18,
              soldOut: false,
              imageUrl: STORED_ABSOLUTE,
            },
          ],
        }),
      }))
      render(<ProductGrid />)
      await screen.findByText('House Blend Coffee Beans')
      expect(srcs()).toContain(EXPECTED_RELATIVE)
      for (const src of srcs()) expect(src).not.toContain('aglyn.app')
    })

    it('CONTROL: a card with no image renders no img', async () => {
      ;(global as any).fetch = jest.fn(async () => ({
        ok: true,
        json: async () => ({
          items: [
            {
              id: 'p2',
              name: 'Consulting Session',
              slug: 'consulting-session',
              priceUsd: 100,
              soldOut: false,
            },
          ],
        }),
      }))
      render(<ProductGrid />)
      await screen.findByText('Consulting Session')
      expect(images()).toHaveLength(0)
    })

    it('leaves an author hotlink on a third-party host untouched', async () => {
      // Hotlinking is an advertised feature (AGL-1725, `image.tsx:234-238`).
      // A fix that "cleaned up" image URLs generally would break it.
      const hotlink = 'https://images.example.com/beans.png'
      ;(global as any).fetch = jest.fn(async () => ({
        ok: true,
        json: async () => ({
          items: [
            {
              id: 'p3',
              name: 'Hotlinked product',
              slug: 'hotlinked',
              priceUsd: 5,
              soldOut: false,
              imageUrl: hotlink,
            },
          ],
        }),
      }))
      render(<ProductGrid />)
      await screen.findByText('Hotlinked product')
      expect(srcs()).toContain(hotlink)
    })
  })
})

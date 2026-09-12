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
 * A store template's card is described as its assets are now (AGL-2850).
 *
 * `/products/{slug}` and `/collections/{slug}` render a template screen, and
 * the head resolves that page's card from the template's image, then the site
 * default. The resolver hands both references to the template's composition,
 * so their documents ride the page's one facts batch, and returns what that
 * batch answered beside the nodes. The composition is a double answering the
 * way the real one does.
 */

const mockCompose = jest.fn()
const mockGetScreen = jest.fn()
const mockStore: Record<string, unknown> = {}
const mockProducts: Array<{ id: string; data: () => Record<string, unknown> }> = []
const mockCollections: Array<{
  id: string
  data: () => Record<string, unknown>
}> = []

jest.mock('@aglyn/tenant-runtime/compose-screen-nodes', () => ({
  __esModule: true,
  default: (...args: unknown[]) => mockCompose(...args),
}))
jest.mock('@aglyn/tenant-runtime/get-screen', () => ({
  __esModule: true,
  default: (...args: unknown[]) => mockGetScreen(...args),
}))
jest.mock('./reviews', () => ({
  readProductReviews: async () => ({
    reviews: [],
    aggregate: { count: 0, average: 0 },
  }),
}))
jest.mock('@aglyn/tenant-data-admin', () => ({
  firebaseAdmin: {
    app: () => ({
      firestore: () => ({
        collection: () => ({
          doc: () => ({
            collection: (name: string) => ({
              doc: () => ({
                get: async () => ({ get: (field: string) => mockStore[field] }),
              }),
              where: () => ({
                limit: () => ({
                  get: async () => ({
                    docs: name === 'products' ? mockProducts : mockCollections,
                  }),
                }),
              }),
            }),
          }),
        }),
      }),
    }),
  },
}))

import type { ComposeSocialImages } from '@aglyn/tenant-runtime/social-image-facts'
import { commerceSitePageResolver } from './site-page-resolver'

const TEMPLATE_CARD = 'media:host-1/template-card'
const HOST_CARD = 'media:host-1/host-card'

/** What each card's document records after a replace. */
const DAM: Record<string, { width: number; height: number }> = {
  [TEMPLATE_CARD]: { width: 1080, height: 1080 },
  [HOST_CARD]: { width: 1600, height: 900 },
}

/**
 * A composition answering the card as the real one does: each reference it
 * was handed whose asset records a pair, and no report when none does.
 */
const answering = async (options: { socialImages?: ComposeSocialImages }) => {
  const facts = Object.fromEntries(
    (options.socialImages?.images ?? [])
      .filter((image): image is string => Boolean(image && DAM[image]))
      .map((image) => [image, DAM[image]]),
  )
  if (Object.keys(facts).length) options.socialImages?.onFacts(facts)
  return { root: {} }
}

const HOST = {
  $id: 'host-1',
  subdomain: 'acme',
  seo: { image: HOST_CARD, imageWidth: 1200, imageHeight: 630 },
}

const resolve = (path: string) =>
  commerceSitePageResolver({
    hostId: 'host-1',
    host: HOST,
    path,
    slugSegments: path.split('/').filter(Boolean),
  }) as Promise<any>

/** The references the template's composition was handed. */
const imagesHanded = () =>
  (mockCompose.mock.calls[0]?.[0] as { socialImages?: ComposeSocialImages })
    ?.socialImages?.images

beforeEach(() => {
  jest.clearAllMocks()
  mockStore['pdpScreenId'] = 'pdp-tmpl'
  mockStore['collectionScreenId'] = 'shop-tmpl'
  mockProducts.splice(0, mockProducts.length, {
    id: 'p1',
    data: () => ({
      name: 'Blue Widget',
      slug: 'blue-widget',
      status: 'active',
      priceUsd: 20,
    }),
  })
  mockCollections.splice(0, mockCollections.length, {
    id: 'c1',
    data: () => ({ name: 'Summer', slug: 'summer', kind: 'catalog' }),
  })
  mockGetScreen.mockImplementation(async ({ screenId }: { screenId: string }) => ({
    screen: {
      $id: screenId,
      displayName: 'Template',
      versionId: 'v1',
      seo: { image: TEMPLATE_CARD, imageWidth: 1200, imageHeight: 630 },
    },
  }))
  mockCompose.mockImplementation(answering)
})

describe('a product page (AGL-2850)', () => {
  it("hands the template's image and the site default to the composition, and returns what it read", async () => {
    const answer = await resolve('/products/blue-widget')
    expect(imagesHanded()).toEqual([TEMPLATE_CARD, HOST_CARD])
    expect(answer.props.socialImageFacts).toEqual({
      [TEMPLATE_CARD]: DAM[TEMPLATE_CARD],
      [HOST_CARD]: DAM[HOST_CARD],
    })
    // Beside the template's own SEO, never in place of it.
    expect(answer.props.data.screen.data.seo.image).toBe(TEMPLATE_CARD)
  })

  it('returns no facts when the composition answered for none', async () => {
    mockCompose.mockResolvedValue({ root: {} })
    const answer = await resolve('/products/blue-widget')
    // Anti-vacuity: the composition was handed the card all the same.
    expect(imagesHanded()).toEqual([TEMPLATE_CARD, HOST_CARD])
    expect(answer.props).not.toHaveProperty('socialImageFacts')
  })
})

describe('a catalog collection page (AGL-2850)', () => {
  it("hands the template's image and the site default to the composition, and returns what it read", async () => {
    const answer = await resolve('/collections/summer')
    expect(imagesHanded()).toEqual([TEMPLATE_CARD, HOST_CARD])
    expect(answer.props.socialImageFacts).toEqual({
      [TEMPLATE_CARD]: DAM[TEMPLATE_CARD],
      [HOST_CARD]: DAM[HOST_CARD],
    })
  })
})

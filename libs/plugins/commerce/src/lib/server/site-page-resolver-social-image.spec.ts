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
// The order-status page's layout lookup (AGL-3610) reads Next's cache; this
// spec never reaches it.
jest.mock('@aglyn/tenant-runtime/built-in-page-layout', () => ({
  resolveBuiltInPageLayoutId: async () => null,
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
import * as Aglyn from '@aglyn/aglyn/server'
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

/**
 * The site the store renders for reaches the template's composition too
 * (AGL-2883): the composition fills host variables in from it, and renders
 * each as nothing without it — the store layout's footer included.
 */
describe('a store template names its site (AGL-2883)', () => {
  const hostHanded = () =>
    (mockCompose.mock.calls[0]?.[0] as { host?: unknown } | undefined)?.host

  it('on a product page', async () => {
    await resolve('/products/blue-widget')
    expect(hostHanded()).toBe(HOST)
  })

  it('on a catalog collection page', async () => {
    await resolve('/collections/summer')
    expect(hostHanded()).toBe(HOST)
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

describe("a product or collection page shares its own image", () => {
  const PHOTO = 'media:org:org-1/blue-widget-front'
  const PICKED = 'media:org:org-1/blue-widget-og'

  const withProduct = (extra: Record<string, unknown>) =>
    mockProducts.splice(0, mockProducts.length, {
      id: 'p1',
      data: () => ({ name: 'Blue Widget', slug: 'blue-widget', status: 'active', priceUsd: 20, ...extra }),
    })

  it("shares the product's first photo ahead of the template's card", async () => {
    withProduct({ mediaUrls: [PHOTO, 'media:org:org-1/blue-widget-back'] })
    const answer = await resolve('/products/blue-widget')
    expect(imagesHanded()).toEqual([PHOTO, TEMPLATE_CARD, HOST_CARD])
    const seo = answer.props.data.screen.data.seo
    expect(seo.image).toBe(PHOTO)
    // The template's 1200x630 described the template's image, not this one.
    expect(seo).not.toHaveProperty('imageWidth')
    expect(seo).not.toHaveProperty('imageHeight')
    expect(seo.imageAlt).toBe('Blue Widget')
  })

  it("shares the image picked in the product editor's OG image field first", async () => {
    withProduct({ mediaUrls: [PHOTO], seo: { imageUrl: PICKED } })
    const answer = await resolve('/products/blue-widget')
    expect(imagesHanded()).toEqual([PICKED, TEMPLATE_CARD, HOST_CARD])
    expect(answer.props.data.screen.data.seo.image).toBe(PICKED)
  })

  it("shares a store collection's image ahead of the template's card", async () => {
    mockCollections.splice(0, mockCollections.length, {
      id: 'c1',
      data: () => ({ name: 'Summer', slug: 'summer', kind: 'catalog', imageUrl: PHOTO }),
    })
    const answer = await resolve('/collections/summer')
    expect(imagesHanded()).toEqual([PHOTO, TEMPLATE_CARD, HOST_CARD])
    expect(answer.props.data.screen.data.seo.image).toBe(PHOTO)
    expect(answer.props.data.screen.data.seo.imageAlt).toBe('Summer')
  })
})

/**
 * The head's answer, end to end: what `og:image` says for a store page.
 *
 * The cases above stop at the composed SEO and the facts batch. This one
 * runs both through `resolveSocialImage` exactly as the tenant page head
 * does (`sources: [screen.seo, host.seo]`, with
 * `assetFacts: props.socialImageFacts`), so the card a crawler reads is the product's own
 * photo, as an absolute URL, with the pixel pair its asset records rather
 * than the template's 1200x630 or the site default.
 */
describe("a store page's og:image is its own picture with its own size", () => {
  const PHOTO = 'media:host-1/blue-widget-front'
  const PICKED = 'media:host-1/blue-widget-og'
  const COVER = 'media:host-1/summer-cover'

  const headCard = (answer: any) =>
    Aglyn.resolveSocialImage({
      sources: [answer.props.data.screen.data.seo, HOST.seo],
      host: HOST,
      assetFacts: answer.props.socialImageFacts,
    })

  beforeEach(() => {
    DAM[PHOTO] = { width: 1000, height: 1000 }
    DAM[PICKED] = { width: 1200, height: 630 }
    DAM[COVER] = { width: 1600, height: 1200 }
  })
  afterEach(() => {
    delete DAM[PHOTO]
    delete DAM[PICKED]
    delete DAM[COVER]
  })

  const withProduct = (extra: Record<string, unknown>) =>
    mockProducts.splice(0, mockProducts.length, {
      id: 'p1',
      data: () => ({ name: 'Blue Widget', slug: 'blue-widget', status: 'active', priceUsd: 20, ...extra }),
    })

  it("is the product's first photo, absolute, with that photo's dimensions", async () => {
    withProduct({ mediaUrls: [PHOTO, 'media:host-1/blue-widget-back'] })
    const card = headCard(await resolve('/products/blue-widget'))
    expect(card).toEqual({
      url: 'https://acme.aglyn.app/api/media/cdn/host-1/blue-widget-front',
      width: 1000,
      height: 1000,
      alt: 'Blue Widget',
    })
  })

  it("is the product editor's OG image ahead of the photo, with its dimensions", async () => {
    withProduct({ mediaUrls: [PHOTO], seo: { imageUrl: PICKED } })
    const card = headCard(await resolve('/products/blue-widget'))
    expect(card).toMatchObject({
      url: expect.stringMatching(/^https:\/\/.+\/blue-widget-og$/),
      width: 1200,
      height: 630,
    })
  })

  it("claims no size for a product photo whose asset records none, never the template's", async () => {
    withProduct({ mediaUrls: ['media:host-1/unmeasured'] })
    const card = headCard(await resolve('/products/blue-widget'))
    expect(card?.url).toMatch(/\/unmeasured$/)
    expect(card).not.toHaveProperty('width')
    expect(card).not.toHaveProperty('height')
  })

  it("is the template's card for a product with no picture of its own", async () => {
    const card = headCard(await resolve('/products/blue-widget'))
    expect(card).toMatchObject({
      url: expect.stringMatching(/\/template-card$/),
      ...DAM[TEMPLATE_CARD],
    })
  })

  it("is a store collection's own image, with its dimensions", async () => {
    mockCollections.splice(0, mockCollections.length, {
      id: 'c1',
      data: () => ({ name: 'Summer', slug: 'summer', kind: 'catalog', imageUrl: COVER }),
    })
    const card = headCard(await resolve('/collections/summer'))
    expect(card).toMatchObject({
      url: expect.stringMatching(/\/summer-cover$/),
      width: 1600,
      height: 1200,
      alt: 'Summer',
    })
  })
})

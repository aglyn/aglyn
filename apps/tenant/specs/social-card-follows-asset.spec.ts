/**
 * @jest-environment node
 *
 * Must stay the FIRST block comment in the file — Jest reads the pragma only
 * from the opening docblock, so a license header above it silently leaves the
 * suite on jsdom.
 *
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
 * A REPLACED SOCIAL CARD IS DECLARED AS IT IS NOW, ON EVERY LOADER BRANCH THAT
 * SHARES ONE (AGL-2850).
 *
 * A card's reference is stored beside the pixel pair its picker copied, on the
 * host, on each screen and on each template screen. A DAM replace keeps the
 * reference and its URL and rewrites the asset's pair, so every page sharing
 * that card went on declaring the old shape in `og:image:width`/`height`, and
 * on the Twitter card, while its URL served the new picture.
 *
 * These run the real loader into the real head, through the real composers
 * and the real media reader, with Firestore and the leaf reads stubbed. Each
 * branch is pinned by what it renders AND by what it reads: the card's
 * documents ride the page's one facts query, and a document with no usable
 * pair leaves the stored pair in place.
 */

const mockDocs = new Map<string, Record<string, unknown>>()
const mockGetAll = jest.fn()
const mockGetHost = jest.fn()
const mockGetScreen = jest.fn()
const mockGetScreenVersion = jest.fn()
const mockCollectionContent = jest.fn()
const mockAuthorContent = jest.fn()
const mockResolveSitePage = jest.fn()

jest.mock('@aglyn/tenant-data-admin', () => ({
  ...jest.requireActual('@aglyn/tenant-data-admin'),
  firebaseAdmin: {
    app: () => ({
      firestore: () => ({
        doc: (path: string) => ({ path }),
        getAll: (...args: unknown[]) => mockGetAll(...args),
      }),
    }),
  },
  getPlatformLockdown: async () => null,
  getDomainLockdown: async () => null,
  filterEnabledPluginsByReleaseFlags: async () => [],
  getRealmPluginInstalls: async () => [],
}))
jest.mock('@aglyn/aglyn/server', () => ({
  ...jest.requireActual('@aglyn/aglyn/server'),
  // The plugin hooks are registries no plugin has filled in here.
  resolveSiteRedirect: async () => undefined,
  resolveSitePage: (...args: unknown[]) => mockResolveSitePage(...args),
  runSitePageEnrichers: async () => ({
    props: {},
    contributors: [],
    unattributed: false,
  }),
}))
jest.mock('../utils/get-host', () => ({
  __esModule: true,
  default: (...args: unknown[]) => mockGetHost(...args),
  CNAME_HOST_PREFIX: 'cname--',
}))
jest.mock('../utils/get-org-billing', () => ({
  __esModule: true,
  default: async () => ({ org: { $id: 'org-1' } }),
}))
jest.mock('../utils/server-plugin-loader', () => ({
  __esModule: true,
  serverPluginLoader: { ensureAll: async () => undefined },
}))
jest.mock('../utils/render-timings', () => ({
  __esModule: true,
  startRenderTimer: () => ({ mark: () => undefined, report: () => undefined }),
}))
// The client renderer is a large browser-side graph, and only its props are
// read here.
jest.mock('../app/[host]/[scheme]/[[...slug]]/catch-all-client', () => ({
  __esModule: true,
  default: () => null,
}))
// The leaf reads beneath the composition. Everything between them and the
// head is real.
jest.mock('@aglyn/tenant-runtime/get-screen', () => ({
  __esModule: true,
  default: (...args: unknown[]) => mockGetScreen(...args),
}))
jest.mock('@aglyn/tenant-runtime/get-screen-version', () => ({
  __esModule: true,
  default: (...args: unknown[]) => mockGetScreenVersion(...args),
}))
jest.mock('@aglyn/tenant-runtime/apply-publish-schedule', () => ({
  __esModule: true,
  default: async () => undefined,
}))
jest.mock('@aglyn/tenant-runtime/get-layout-version', () => ({
  __esModule: true,
  default: async () => ({ version: { nodes: {} }, layout: {} }),
}))
jest.mock('@aglyn/tenant-runtime/get-components', () => ({
  __esModule: true,
  default: async () => ({ definitions: {} }),
}))
jest.mock('@aglyn/tenant-runtime/get-variables', () => ({
  __esModule: true,
  default: async () => [],
  getFunctions: async () => [],
  getWorkflows: async () => [],
}))
jest.mock('@aglyn/tenant-runtime/get-plugin-installs', () => ({
  __esModule: true,
  default: async () => [],
}))
jest.mock('@aglyn/tenant-runtime/get-forms', () => ({
  __esModule: true,
  default: async () => ({ forms: {} }),
}))
jest.mock('@aglyn/tenant-runtime/get-datasets', () => ({
  __esModule: true,
  default: async () => ({}),
}))
jest.mock('@aglyn/tenant-runtime/get-collection-content', () => ({
  __esModule: true,
  default: (...args: unknown[]) => mockCollectionContent(...args),
  getPublishedCollectionSource: async () => ({ entries: [], categories: [] }),
}))
jest.mock('@aglyn/tenant-runtime/get-author-content', () => ({
  __esModule: true,
  default: (...args: unknown[]) => mockAuthorContent(...args),
}))
jest.mock('@aglyn/tenant-runtime/template-screens', () => ({
  __esModule: true,
  default: async () => new Set<string>(),
  getTemplateScreenIds: async () => new Set<string>(),
  getTemplateScreenRouting: async () => ({
    templateScreenIds: new Set<string>(),
    listRoutes: {},
    collectionListings: {},
  }),
}))

import CatchAllClient from '../app/[host]/[scheme]/[[...slug]]/catch-all-client'
import CatchAllPage, {
  generateMetadata,
} from '../app/[host]/[scheme]/[[...slug]]/page'

const ROOT = '_@_'
const CDN = 'https://custom.example/api/media/cdn/host-1'

const HOST_CARD = 'media:host-1/host-card'
const SCREEN_CARD = 'media:host-1/screen-card'
const TEMPLATE_CARD = 'media:host-1/template-card'
const COVER = 'media:host-1/cover'
const AUTHOR_CARD = 'media:host-1/author-card'
const PORTRAIT = 'media:host-1/portrait'
/** An SVG: the upload could measure nothing, so its document has no pair. */
const SVG_CARD = 'media:host-1/svg-card'

/** Each asset's document after a replace with a picture of another shape. */
const DOCUMENTS: Record<string, Record<string, unknown>> = {
  'hosts/host-1/media/host-card': { width: 1600, height: 900 },
  'hosts/host-1/media/screen-card': { width: 1080, height: 1080 },
  'hosts/host-1/media/template-card': { width: 1000, height: 500 },
  'hosts/host-1/media/cover': { width: 1400, height: 700 },
  'hosts/host-1/media/author-card': { width: 1200, height: 628 },
  'hosts/host-1/media/portrait': { width: 512, height: 512 },
  'hosts/host-1/media/svg-card': {},
  'hosts/host-1/media/photo': { width: 480, height: 480 },
}

/** The pair every picker copied when the cards were first picked. */
const PICKED = { imageWidth: 1200, imageHeight: 630 }

/** A published tree that places one library image of its own. */
const TREE = {
  [ROOT]: { $id: ROOT, componentId: 'div', nodes: ['photo'] },
  photo: {
    $id: 'photo',
    componentId: 'image',
    parentId: ROOT,
    props: {
      src: 'media:host-1/photo',
      intrinsicWidth: 1200,
      intrinsicHeight: 630,
    },
  },
}

const hostWith = (
  seo: Record<string, unknown>,
  fields: Record<string, unknown> = {},
) => ({
  $id: 'host-1',
  subdomain: 'acme',
  cname: 'custom.example',
  displayName: 'Acme',
  screens: { 'screen-1': 'about', 'locked-1': 'locked' },
  seo,
  ...fields,
})

const givenHost = (
  seo: Record<string, unknown>,
  fields: Record<string, unknown> = {},
) => mockGetHost.mockResolvedValue({ host: hostWith(seo, fields), error: null })

/** The screen documents `getScreen` answers, by id. */
let screens: Record<string, Record<string, unknown>> = {}

const givenScreen = (id: string, fields: Record<string, unknown>) => {
  screens[id] = { $id: id, displayName: id, versionId: 'v1', ...fields }
}

const metadataFor = (...slug: string[]) =>
  generateMetadata({
    params: Promise.resolve({ host: 'acme', slug }),
  } as never) as Promise<any>

/** The card as the Open Graph block and the Twitter block each emit it. */
const cardsOf = (metadata: any) => [
  metadata.openGraph?.images?.[0],
  metadata.twitter?.images?.[0],
]

/** Every document the page's facts queries asked for. */
const documentsRead = () =>
  mockGetAll.mock.calls.flatMap((call: unknown[]) =>
    call
      .filter((arg): arg is { path: string } =>
        typeof (arg as { path?: unknown })?.path === 'string',
      )
      .map((arg) => arg.path.replace('hosts/host-1/media/', '')),
  )

/** The page issued exactly ONE facts query, and it asked for these documents. */
const expectOneQueryFor = (...documents: string[]) => {
  expect(mockGetAll).toHaveBeenCalledTimes(1)
  expect(documentsRead()).toEqual(expect.arrayContaining(documents))
}

beforeEach(() => {
  jest.clearAllMocks()
  mockDocs.clear()
  Object.entries(DOCUMENTS).forEach(([path, data]) => mockDocs.set(path, data))
  mockGetAll.mockReset()
  mockGetAll.mockImplementation(async (...args: unknown[]) =>
    args
      .filter((arg): arg is { path: string } =>
        typeof (arg as { path?: unknown })?.path === 'string',
      )
      .map(({ path }) => {
        const data = mockDocs.get(path)
        return {
          exists: data !== undefined,
          get: (field: string) => data?.[field],
        }
      }),
  )
  screens = {}
  mockGetScreen.mockImplementation(async ({ screenId }: { screenId: string }) =>
    screens[screenId]
      ? { screen: screens[screenId], error: null }
      : { screen: undefined, error: 'not found' },
  )
  mockGetScreenVersion.mockResolvedValue({ version: { nodes: TREE } })
  mockCollectionContent.mockResolvedValue({
    collection: null,
    entries: [],
    entry: null,
    error: null,
  })
  mockAuthorContent.mockResolvedValue({
    known: false,
    slug: '',
    name: '',
    author: null,
    entries: [],
    categories: [],
    page: 1,
    perPage: 10,
    totalEntries: 0,
    totalPages: 1,
  })
  mockResolveSitePage.mockResolvedValue(undefined)
})

describe("a screen's own card (AGL-2850)", () => {
  beforeEach(() => givenHost({ image: HOST_CARD, ...PICKED }))

  it("declares the replaced asset's pair, read in the page's one query", async () => {
    givenScreen('screen-1', { seo: { image: SCREEN_CARD, ...PICKED } })

    const metadata = await metadataFor('about')

    for (const card of cardsOf(metadata)) {
      expect(card).toEqual({
        url: `${CDN}/screen-card`,
        width: 1080,
        height: 1080,
      })
    }
    expectOneQueryFor('screen-card', 'host-card', 'photo')
  })

  it('keeps the stored pair when the asset records none', async () => {
    givenScreen('screen-1', { seo: { image: SVG_CARD, ...PICKED } })

    const metadata = await metadataFor('about')

    for (const card of cardsOf(metadata)) {
      expect(card).toEqual({ url: `${CDN}/svg-card`, width: 1200, height: 630 })
    }
    // Read, and found wanting: never skipped.
    expectOneQueryFor('svg-card')
  })

  it('keeps the stored pair when the read fails, and the page still renders', async () => {
    givenScreen('screen-1', { seo: { image: SCREEN_CARD, ...PICKED } })
    mockGetAll.mockRejectedValue(new Error('unavailable'))
    const logged = jest.spyOn(console, 'error').mockImplementation(() => undefined)
    try {
      const metadata = await metadataFor('about')

      expect(metadata.title).toBeTruthy()
      expect(cardsOf(metadata)[0]).toEqual({
        url: `${CDN}/screen-card`,
        width: 1200,
        height: 630,
      })
      // The card was in the read that failed.
      expectOneQueryFor('screen-card')
    } finally {
      logged.mockRestore()
    }
  })
})

describe('the site default card (AGL-2850)', () => {
  it("declares the replaced asset's pair on a screen with no card of its own", async () => {
    givenHost({ image: HOST_CARD, ...PICKED })
    givenScreen('screen-1', { seo: { image: '' } })

    const metadata = await metadataFor('about')

    expect(cardsOf(metadata)[1]).toEqual({
      url: `${CDN}/host-card`,
      width: 1600,
      height: 900,
    })
    expectOneQueryFor('host-card', 'photo')
  })

  it('keeps the stored pair when the asset records none', async () => {
    givenHost({ image: SVG_CARD, ...PICKED })
    givenScreen('screen-1', { seo: {} })

    const metadata = await metadataFor('about')

    expect(cardsOf(metadata)[0]).toEqual({
      url: `${CDN}/svg-card`,
      width: 1200,
      height: 630,
    })
    expectOneQueryFor('svg-card')
  })
})

describe('a password-protected screen (AGL-2850)', () => {
  beforeEach(() => givenHost({ image: HOST_CARD, ...PICKED }))

  it("declares the replaced asset's pair from one read of the card alone", async () => {
    givenScreen('locked-1', {
      protection: { passwordHash: 'hash' },
      seo: { image: SCREEN_CARD, ...PICKED },
    })

    const metadata = await metadataFor('locked')

    expect(metadata.robots).toEqual({ index: false, follow: true })
    expect(cardsOf(metadata)[0]).toEqual({
      url: `${CDN}/screen-card`,
      width: 1080,
      height: 1080,
    })
    // The nodes are withheld, so no placement is read: the card, and only it.
    expect(mockGetAll).toHaveBeenCalledTimes(1)
    expect(documentsRead()).toEqual(['screen-card', 'host-card'])
  })

  it('keeps the stored pair when the asset records none', async () => {
    givenScreen('locked-1', {
      protection: { passwordHash: 'hash' },
      seo: { image: SVG_CARD, ...PICKED },
    })

    const metadata = await metadataFor('locked')

    expect(cardsOf(metadata)[0]).toEqual({
      url: `${CDN}/svg-card`,
      width: 1200,
      height: 630,
    })
    expectOneQueryFor('svg-card')
  })
})

describe('a collection page composed through its template (AGL-2850)', () => {
  const BLOG = {
    $id: 'col-blog',
    displayName: 'Blog',
    slug: 'blog',
    listScreenId: 'list-tmpl',
    entryScreenId: 'entry-tmpl',
    categories: [],
  }

  beforeEach(() => {
    givenHost({ image: HOST_CARD, ...PICKED })
    givenScreen('entry-tmpl', { seo: { image: TEMPLATE_CARD, ...PICKED } })
    givenScreen('list-tmpl', { seo: { image: TEMPLATE_CARD, ...PICKED } })
  })

  it("describes an entry's cover by its asset, in the page's one query", async () => {
    mockCollectionContent.mockResolvedValue({
      collection: BLOG,
      entries: [],
      entry: { $id: 'e1', title: 'Hello', slug: 'hello', coverImage: COVER },
      error: null,
    })

    const metadata = await metadataFor('blog', 'hello')

    expect(cardsOf(metadata)[0]).toEqual({
      url: `${CDN}/cover`,
      width: 1400,
      height: 700,
    })
    expectOneQueryFor('cover', 'template-card', 'host-card', 'photo')
  })

  it("declares a list template's replaced card", async () => {
    mockCollectionContent.mockResolvedValue({
      collection: BLOG,
      entries: [],
      entry: null,
      pagination: null,
      error: null,
    })

    const metadata = await metadataFor('blog')

    expect(cardsOf(metadata)[0]).toEqual({
      url: `${CDN}/template-card`,
      width: 1000,
      height: 500,
    })
    expectOneQueryFor('template-card', 'host-card')
  })

  it("keeps a template card's stored pair when its asset records none", async () => {
    givenScreen('list-tmpl', { seo: { image: SVG_CARD, ...PICKED } })
    mockCollectionContent.mockResolvedValue({
      collection: BLOG,
      entries: [],
      entry: null,
      pagination: null,
      error: null,
    })

    const metadata = await metadataFor('blog')

    expect(cardsOf(metadata)[0]).toEqual({
      url: `${CDN}/svg-card`,
      width: 1200,
      height: 630,
    })
    expectOneQueryFor('svg-card')
  })
})

describe('a collection page with no template (AGL-2850)', () => {
  const NEWS = {
    $id: 'col-news',
    displayName: 'News',
    slug: 'news',
    categories: [],
  }

  it("declares the site default's replaced card on the listing", async () => {
    givenHost({ image: HOST_CARD, ...PICKED })
    mockCollectionContent.mockResolvedValue({
      collection: NEWS,
      entries: [],
      entry: null,
      pagination: null,
      error: null,
    })

    const metadata = await metadataFor('news')

    expect(cardsOf(metadata)[0]).toEqual({
      url: `${CDN}/host-card`,
      width: 1600,
      height: 900,
    })
    expectOneQueryFor('host-card')
  })

  it("describes an entry's cover by its asset", async () => {
    givenHost({ image: HOST_CARD, ...PICKED })
    mockCollectionContent.mockResolvedValue({
      collection: NEWS,
      entries: [],
      entry: { $id: 'e1', title: 'Hello', slug: 'hello', coverImage: COVER },
      error: null,
    })

    const metadata = await metadataFor('news', 'hello')

    expect(cardsOf(metadata)[0]).toEqual({
      url: `${CDN}/cover`,
      width: 1400,
      height: 700,
    })
    expectOneQueryFor('cover', 'host-card')
  })

  it("keeps the site default's stored pair when its asset records none", async () => {
    givenHost({ image: SVG_CARD, ...PICKED })
    mockCollectionContent.mockResolvedValue({
      collection: NEWS,
      entries: [],
      entry: null,
      pagination: null,
      error: null,
    })

    const metadata = await metadataFor('news')

    expect(cardsOf(metadata)[0]).toEqual({
      url: `${CDN}/svg-card`,
      width: 1200,
      height: 630,
    })
    expectOneQueryFor('svg-card')
  })
})

describe('an author page (AGL-2850)', () => {
  const authorWith = (record: Record<string, unknown>) =>
    mockAuthorContent.mockResolvedValue({
      known: true,
      slug: 'zg',
      name: 'Zach Gover',
      author: { $id: 'a1', name: 'Zach Gover', slug: 'zg', ...record },
      entries: [],
      categories: [],
      page: 1,
      perPage: 10,
      totalEntries: 0,
      totalPages: 1,
    })

  beforeEach(() => givenHost({ image: HOST_CARD, ...PICKED }))

  it("declares the share card's pair, which the record never stored", async () => {
    authorWith({ seoImage: AUTHOR_CARD, image: PORTRAIT })

    const metadata = await metadataFor('author', 'zg')

    for (const card of cardsOf(metadata)) {
      expect(card).toEqual({
        url: `${CDN}/author-card`,
        width: 1200,
        height: 628,
      })
    }
    expectOneQueryFor('author-card', 'portrait')
  })

  it("declares the portrait's pair when there is no share card", async () => {
    authorWith({ image: PORTRAIT })

    const metadata = await metadataFor('author', 'zg')

    expect(cardsOf(metadata)[0]).toEqual({
      url: `${CDN}/portrait`,
      width: 512,
      height: 512,
    })
    expect(metadata.twitter.card).toBe('summary')
    expectOneQueryFor('portrait')
  })

  it('declares the same through a designated author screen', async () => {
    givenHost({ image: HOST_CARD, ...PICKED }, { authorScreenId: 'author-tmpl' })
    givenScreen('author-tmpl', { seo: {} })
    authorWith({ seoImage: AUTHOR_CARD, image: PORTRAIT })

    const metadata = await metadataFor('author', 'zg')

    expect(cardsOf(metadata)[0]).toEqual({
      url: `${CDN}/author-card`,
      width: 1200,
      height: 628,
    })
    expectOneQueryFor('author-card', 'portrait', 'photo')
  })

  it('declares no pair when the asset records none, as the record stores none', async () => {
    authorWith({ seoImage: SVG_CARD })

    const metadata = await metadataFor('author', 'zg')

    expect(cardsOf(metadata)[0]).toEqual({ url: `${CDN}/svg-card` })
    expectOneQueryFor('svg-card')
  })
})

describe('a page a plugin resolver answers (AGL-2850)', () => {
  const resolvedWith = (fields: Record<string, unknown>) =>
    mockResolveSitePage.mockResolvedValue({
      props: {
        data: {
          host: hostWith({ image: HOST_CARD, ...PICKED }),
          screen: {
            data: {
              $id: 'pdp-tmpl',
              displayName: 'Blue Widget',
              seo: { image: TEMPLATE_CARD, ...PICKED },
            },
          },
        },
        nodes: TREE,
        ...fields,
      },
      revalidate: 60,
    })

  beforeEach(() => givenHost({ image: HOST_CARD, ...PICKED }))

  it("declares the pair the resolver's composition read", async () => {
    resolvedWith({
      socialImageFacts: { [TEMPLATE_CARD]: { width: 1000, height: 500 } },
    })

    const metadata = await metadataFor('products', 'blue-widget')

    expect(cardsOf(metadata)[0]).toEqual({
      url: `${CDN}/template-card`,
      width: 1000,
      height: 500,
    })
  })

  it('keeps the stored pair when the resolver read nothing', async () => {
    resolvedWith({})

    const metadata = await metadataFor('products', 'blue-widget')

    expect(cardsOf(metadata)[0]).toEqual({
      url: `${CDN}/template-card`,
      width: 1200,
      height: 630,
    })
  })
})

describe("the facts are the head's alone (AGL-2850)", () => {
  /** The props `CatchAllClient` is rendered with, found in the page's tree. */
  const clientPropsIn = (element: any): Record<string, unknown> | undefined => {
    if (!element || typeof element !== 'object') return undefined
    if (Array.isArray(element)) {
      for (const child of element) {
        const found = clientPropsIn(child)
        if (found) return found
      }
      return undefined
    }
    if (element.type === CatchAllClient) return element.props
    return clientPropsIn(element.props?.children)
  }

  it("never reach the client's payload", async () => {
    givenHost({ image: HOST_CARD, ...PICKED })
    givenScreen('screen-1', { seo: { image: SCREEN_CARD, ...PICKED } })

    const page = await CatchAllPage({
      params: Promise.resolve({ host: 'acme', slug: ['about'] }),
    } as never)
    const props = clientPropsIn(page)

    expect(props?.['data']).toBeDefined()
    expect(props).not.toHaveProperty('socialImageFacts')
    // Anti-vacuity: the head did read them for this very page.
    expect(cardsOf(await metadataFor('about'))[0]).toMatchObject({
      width: 1080,
      height: 1080,
    })
  })
})

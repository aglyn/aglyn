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
 * WHAT THE LOADER ASKS ABOUT A PREVIEW TOKEN, AND WHEN (AGL-3205).
 *
 * The signature itself is exhaustively tested where it lives
 * (`collection-preview-token.spec.ts`). What CANNOT be tested there is the
 * wiring, and the wiring is where this kind of thing actually goes wrong: a
 * check that verifies the token against the host the TOKEN names rather than
 * the host the request RESOLVED to is a check that passes every test and
 * secures nothing.
 *
 * So the verifier is a spy here, and the assertions are about the question the
 * loader puts to it:
 *
 *  - the scope handed over is the resolved `hostId` plus the collection and
 *    entry slugs parsed from the PATH, never anything the token said about
 *    itself;
 *  - a `false` answer changes nothing about the read that follows;
 *  - with no token the verifier is not called at all — the public path does
 *    not pay for a feature it is not using;
 *  - a list route never asks, because there is no entry to scope a grant to.
 */

jest.mock('@aglyn/tenant-data-admin', () => ({
  __esModule: true,
  firebaseAdmin: { app: jest.fn() },
  getPlatformLockdown: jest.fn(async () => null),
  getDomainLockdown: jest.fn(async () => null),
  filterEnabledPluginsByReleaseFlags: jest.fn(async () => ['mui']),
  getRealmPluginInstalls: jest.fn(async () => []),
  verifyCollectionPreviewToken: jest.fn(() => false),
}))
jest.mock('../utils/get-host', () => ({
  __esModule: true,
  default: jest.fn(),
  CNAME_HOST_PREFIX: 'cname--',
}))
jest.mock('../utils/get-org-billing', () => ({
  __esModule: true,
  default: jest.fn(async () => ({ org: { $id: 'org-1' } })),
}))
jest.mock('../utils/server-plugin-loader', () => ({
  __esModule: true,
  serverPluginLoader: { ensureAll: jest.fn(async () => undefined) },
}))
jest.mock('../utils/render-timings', () => ({
  __esModule: true,
  startRenderTimer: () => ({ mark: () => undefined, report: () => undefined }),
}))
jest.mock('@aglyn/tenant-runtime/compose-screen-nodes', () => ({
  __esModule: true,
  default: jest.fn(async () => ({ root: {} })),
  composeNodesWithChrome: jest.fn(async () => ({ root: {} })),
}))
jest.mock('@aglyn/tenant-runtime/get-variables', () => ({
  __esModule: true,
  default: jest.fn(async () => ({})),
}))
jest.mock('@aglyn/tenant-runtime/get-screen', () => ({
  __esModule: true,
  default: jest.fn(async () => ({ screen: null, error: null })),
}))
jest.mock('@aglyn/tenant-runtime/get-collection-content', () => ({
  __esModule: true,
  default: jest.fn(),
}))
jest.mock('@aglyn/tenant-runtime/compose-collection-page', () => ({
  __esModule: true,
  composeCollectionTemplatePage: jest.fn(async () => null),
  composeCollectionFallbackPage: jest.fn(async () => ({
    screen: null,
    nodes: { root: {} },
  })),
}))
// `entry-link-routes` reaches `render-cache`, which imports `next/cache`, and
// that module does not load under this project's test environment.
jest.mock('@aglyn/tenant-runtime/entry-link-routes', () => ({
  __esModule: true,
  resolveEntryLinkRoutes: jest.fn(async () => ({})),
}))
// Same reason as `entry-link-routes` above: the author path reaches the render
// cache, and `next/cache` does not load here.
jest.mock('@aglyn/tenant-runtime/get-author-content', () => ({
  __esModule: true,
  default: jest.fn(async () => ({
    slug: '',
    author: null,
    name: '',
    known: false,
    entries: [],
    categories: [],
    page: 1,
    perPage: 10,
    totalEntries: 0,
    totalPages: 1,
  })),
}))
jest.mock('@aglyn/tenant-runtime/compose-author-page', () => ({
  __esModule: true,
  composeAuthorTemplatePage: jest.fn(async () => null),
  composeAuthorFallbackPage: jest.fn(async () => null),
}))
jest.mock('@aglyn/tenant-runtime/template-screens', () => ({
  __esModule: true,
  default: jest.fn(async () => new Set<string>()),
  getTemplateScreenIds: jest.fn(async () => new Set<string>()),
  getTemplateScreenRouting: jest.fn(async () => ({
    templateScreenIds: new Set<string>(),
    listRoutes: {} as Record<string, string>,
  })),
}))

import { verifyCollectionPreviewToken } from '@aglyn/tenant-data-admin'
import getCollectionContent from '@aglyn/tenant-runtime/get-collection-content'
import { loadPageData } from '../app/[host]/[scheme]/[[...slug]]/load-page-data'
import getHost from '../utils/get-host'

const mockGetHost = getHost as jest.Mock
const mockCollectionContent = getCollectionContent as jest.Mock
const mockVerify = verifyCollectionPreviewToken as unknown as jest.Mock

const COLLECTION = { $id: 'col-blog', displayName: 'Blog', slug: 'blog' }
const ENTRY = { $id: 'p1', title: 'One platform', slug: 'one-platform' }
const TOKEN = 'aglyn-entry-preview-v1.payload.signature'

beforeEach(() => {
  jest.clearAllMocks()
  mockVerify.mockReturnValue(false)
  mockGetHost.mockResolvedValue({
    host: { $id: 'host-1', subdomain: 'acme', screens: {} },
    error: null,
  })
  // The public answer for a withheld entry: the collection resolves, the entry
  // does not. This is what the loader turns into a 404.
  mockCollectionContent.mockResolvedValue({
    collection: COLLECTION,
    entries: [],
    entry: null,
    error: null,
  })
})

/** The options the loader handed `getCollectionContent` on its last call. */
const lastReadOptions = () => mockCollectionContent.mock.calls.at(-1)?.[0]

describe('with no token, the loader behaves exactly as it always did', () => {
  it('never asks the verifier anything', async () => {
    await loadPageData('acme', ['blog', 'one-platform'])
    expect(mockVerify).not.toHaveBeenCalled()
  })

  it('reads the collection with no grant, and 404s the withheld entry', async () => {
    const result: any = await loadPageData('acme', ['blog', 'one-platform'])
    expect(lastReadOptions()).not.toHaveProperty('previewUnpublishedEntry')
    expect(result.notFound).toBe(true)
  })
})

describe('the verifier is asked about the RESOLVED request, not the token', () => {
  it('scopes the question to the resolved host and the path’s own slugs', async () => {
    await loadPageData('acme', ['blog', 'one-platform'], TOKEN)
    expect(mockVerify).toHaveBeenCalledWith(TOKEN, {
      // `host-1`, the id `getHost` resolved — NOT the `acme` in the URL and
      // certainly not a host named inside the payload.
      hostId: 'host-1',
      collectionSlug: 'blog',
      entrySlug: 'one-platform',
    })
  })

  it('asks about the entry the URL names, even when a token is reused', async () => {
    await loadPageData('acme', ['blog', 'a-different-post'], TOKEN)
    expect(mockVerify).toHaveBeenCalledWith(
      TOKEN,
      expect.objectContaining({ entrySlug: 'a-different-post' }),
    )
  })
})

describe('a refused token leaves the public answer in place', () => {
  it('reads the collection with no grant', async () => {
    mockVerify.mockReturnValue(false)
    await loadPageData('acme', ['blog', 'one-platform'], TOKEN)
    expect(lastReadOptions()).not.toHaveProperty('previewUnpublishedEntry')
  })

  it('still 404s the withheld entry', async () => {
    mockVerify.mockReturnValue(false)
    const result: any = await loadPageData('acme', ['blog', 'one-platform'], TOKEN)
    expect(result.notFound).toBe(true)
  })
})

describe('an accepted token grants exactly one entry', () => {
  it('passes the grant into the read', async () => {
    mockVerify.mockReturnValue(true)
    mockCollectionContent.mockResolvedValue({
      collection: COLLECTION,
      entries: [],
      entry: ENTRY,
      entryPreview: { status: 'scheduled', publishAtSeconds: 1_790_000_000 },
      error: null,
    })
    await loadPageData('acme', ['blog', 'one-platform'], TOKEN)
    expect(lastReadOptions()).toMatchObject({
      hostId: 'host-1',
      collectionSlug: 'blog',
      entrySlug: 'one-platform',
      previewUnpublishedEntry: true,
    })
  })

  it('carries the withheld facts out to the page that has to state them', async () => {
    mockVerify.mockReturnValue(true)
    mockCollectionContent.mockResolvedValue({
      collection: COLLECTION,
      entries: [],
      entry: ENTRY,
      entryPreview: { status: 'scheduled', publishAtSeconds: 1_790_000_000 },
      error: null,
    })
    const result: any = await loadPageData('acme', ['blog', 'one-platform'], TOKEN)
    expect(result.props.content.entryPreview).toEqual({
      status: 'scheduled',
      publishAtSeconds: 1_790_000_000,
    })
  })
})

describe('a LIST route never carries a grant', () => {
  beforeEach(() => {
    mockVerify.mockReturnValue(true)
    mockCollectionContent.mockResolvedValue({
      collection: COLLECTION,
      entries: [ENTRY],
      entry: null,
      pagination: { page: 1, perPage: 10, totalPages: 1, totalEntries: 1 },
      error: null,
    })
  })

  it.each([
    ['the listing', ['blog']],
    ['a paged listing', ['blog', 'page', '2']],
    ['a category listing', ['blog', 'category', 'product']],
  ])('does not even ask the verifier on %s', async (_label, segments) => {
    await loadPageData('acme', segments, TOKEN)
    expect(mockVerify).not.toHaveBeenCalled()
    expect(lastReadOptions()).not.toHaveProperty('previewUnpublishedEntry')
  })
})

describe('the grant is part of the per-request cache key', () => {
  it('does not serve a granted render from an ungranted one', async () => {
    // `loadPageData` is `React.cache`d on its arguments. If the token were
    // left out of that key, the FIRST render of a path in a request would
    // decide the grant for every later one — which is how a preview would end
    // up answering for a public request that arrived in the same render.
    mockVerify.mockReturnValue(true)
    await loadPageData('acme', ['blog', 'one-platform'])
    await loadPageData('acme', ['blog', 'one-platform'], TOKEN)
    const [first, second] = mockCollectionContent.mock.calls.map(
      (call) => call[0],
    )
    expect(first).not.toHaveProperty('previewUnpublishedEntry')
    expect(second).toHaveProperty('previewUnpublishedEntry', true)
  })
})

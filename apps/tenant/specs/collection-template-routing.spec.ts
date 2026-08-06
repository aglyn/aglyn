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
 * A collection's list/entry template screen must not be a page (AGL-1267).
 *
 * Publishing the blog's entry template is what made `/blog/{entry}` render —
 * that is the mechanism working. But the same publish wrote the template into
 * the host's routing map, so `https://aglyn.com/blog-entry-template` returned
 * 200 with seven raw `{{entry.*}}` tokens as body text. A template has no
 * standalone form: there is no routed entry to substitute.
 *
 * All four claims are asserted here, because the fix is a *removal* from the
 * route table and a removal is exactly the kind of change that takes working
 * routes with it:
 *
 *  1. the entry template's own slug 404s,
 *  2. a real entry URL still renders through that same template,
 *  3. an unknown entry still 404s,
 *  4. a LIST template published at its collection's root still serves — via
 *     the collection branch, which is the only branch that can give it
 *     entries and `{{collection.*}}` tokens.
 */

// Factories, not bare `jest.mock`: the loader's module graph reaches
// `@aglyn/tenant-data-admin` → `undici`, and an auto-mock still evaluates the
// real graph to derive its shape.
jest.mock('@aglyn/tenant-data-admin', () => ({
  __esModule: true,
  firebaseAdmin: { app: jest.fn() },
  filterEnabledPluginsByReleaseFlags: jest.fn(async () => []),
  getRealmPluginInstalls: jest.fn(async () => []),
}))
jest.mock('@aglyn/aglyn/server', () => ({
  __esModule: true,
  SCREEN_ROOT_PATH: '/',
  COLLECTION_LIST_PAGE_SIZE: 10,
  HostScreenVisibility: { AUTHENTICATED: 'authenticated' },
  resolveSiteRedirect: jest.fn(async () => null),
  resolveSitePage: jest.fn(async () => undefined),
  runSitePageEnrichers: jest.fn(async () => ({})),
  resolveEnabledPlugins: jest.fn(() => []),
  resolveOrgEntitlements: jest.fn(() => ({ features: {} })),
  resolveBrandingProfile: jest.fn(() => ({})),
  checkEntitlement: jest.fn(() => true),
}))
jest.mock('../utils/get-host', () => ({ __esModule: true, default: jest.fn() }))
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
  default: jest.fn(),
}))
jest.mock('@aglyn/tenant-runtime/get-collection-content', () => ({
  __esModule: true,
  default: jest.fn(),
}))
jest.mock('@aglyn/tenant-runtime/compose-collection-page', () => ({
  __esModule: true,
  composeCollectionTemplatePage: jest.fn(),
  composeCollectionFallbackPage: jest.fn(async () => null),
}))
jest.mock('@aglyn/tenant-runtime/collection-template-screens', () => ({
  __esModule: true,
  default: jest.fn(async () => new Set<string>()),
}))

import {
  composeCollectionFallbackPage,
  composeCollectionTemplatePage,
} from '@aglyn/tenant-runtime/compose-collection-page'
import getCollectionContent from '@aglyn/tenant-runtime/get-collection-content'
import getCollectionTemplateScreenIds from '@aglyn/tenant-runtime/collection-template-screens'
import getScreen from '@aglyn/tenant-runtime/get-screen'
import { loadPageData } from '../app/[host]/[[...slug]]/load-page-data'
import getHost from '../utils/get-host'

const mockGetHost = getHost as jest.Mock
const mockGetScreen = getScreen as jest.Mock
const mockTemplateScreenIds = getCollectionTemplateScreenIds as jest.Mock
const mockCollectionContent = getCollectionContent as jest.Mock
const mockComposeTemplate = composeCollectionTemplatePage as jest.Mock
const mockComposeFallback = composeCollectionFallbackPage as jest.Mock

/** Routing map as `publishScreenRoute` writes it: screen id → route path. */
const ROUTING = {
  home: '/',
  about: 'about',
  // What publishing the entry template added — the bug.
  blogEntryTmpl: 'blog-entry-template',
  blogListTmpl: 'blog',
}

const COLLECTION = {
  $id: 'col-blog',
  displayName: 'Blog',
  slug: 'blog',
  listScreenId: 'blogListTmpl',
  entryScreenId: 'blogEntryTmpl',
  categories: [],
}

beforeEach(() => {
  jest.clearAllMocks()
  mockGetHost.mockResolvedValue({
    host: { $id: 'host-1', subdomain: 'acme', screens: ROUTING },
    error: null,
  })
  mockGetScreen.mockImplementation(async ({ screenId }: any) => ({
    screen: { $id: screenId, displayName: screenId },
    error: null,
  }))
  // Both template screens are designated by the blog collection.
  mockTemplateScreenIds.mockResolvedValue(
    new Set(['blogListTmpl', 'blogEntryTmpl']),
  )
  mockCollectionContent.mockResolvedValue({
    collection: null,
    entries: [],
    entry: null,
    error: null,
  })
  mockComposeTemplate.mockResolvedValue(null)
  mockComposeFallback.mockResolvedValue(null)
})

describe('collection template screens are not pages (AGL-1267)', () => {
  it('serves an ordinary published screen from the routing map', async () => {
    const result: any = await loadPageData('acme', ['about'])

    expect(result.notFound).toBeUndefined()
    expect(result.props.data.screen.data.$id).toBe('about')
  })

  it('404s the entry template at its own published slug', async () => {
    const result: any = await loadPageData('acme', ['blog-entry-template'])

    expect(result.notFound).toBe(true)
    // Never composed as a screen — that is what rendered the raw tokens.
    expect(mockGetScreen).not.toHaveBeenCalledWith(
      expect.objectContaining({ screenId: 'blogEntryTmpl' }),
    )
  })

  it('renders a real entry URL through that same entry template', async () => {
    mockCollectionContent.mockResolvedValue({
      collection: COLLECTION,
      entries: [],
      entry: { $id: 'e1', title: 'Hello', slug: 'hello' },
      error: null,
    })
    mockComposeTemplate.mockResolvedValue({
      screen: { $id: 'blogEntryTmpl' },
      nodes: { root: {} },
    })

    const result: any = await loadPageData('acme', ['blog', 'hello'])

    expect(result.notFound).toBeUndefined()
    expect(result.props.nodes).toEqual({ root: {} })
    expect(result.props.content.entry.slug).toBe('hello')
  })

  it('still 404s an entry that does not exist', async () => {
    mockCollectionContent.mockResolvedValue({
      collection: COLLECTION,
      entries: [],
      entry: null,
      error: null,
    })

    const result: any = await loadPageData('acme', ['blog', 'nope'])

    expect(result.notFound).toBe(true)
  })

  it('still serves a list template published at its collection root', async () => {
    // `/blog` matches the LIST template in the routing map, so the naive fix
    // — 404 anything designated as a template — would take the blog index
    // down with the junk page. Dropping it from the route table instead lets
    // the collection branch pick the very same screen up, this time with the
    // entries and `{{collection.*}}` tokens it was designed against.
    mockCollectionContent.mockResolvedValue({
      collection: COLLECTION,
      entries: [{ $id: 'e1', title: 'Hello', slug: 'hello' }],
      entry: null,
      pagination: { page: 1, perPage: 10, totalPages: 1, totalEntries: 1 },
      error: null,
    })
    mockComposeTemplate.mockResolvedValue({
      screen: { $id: 'blogListTmpl' },
      nodes: { root: {} },
    })

    const result: any = await loadPageData('acme', ['blog'])

    expect(result.notFound).toBeUndefined()
    expect(result.props.data.screen.data.$id).toBe('blogListTmpl')
    expect(mockComposeTemplate).toHaveBeenCalledWith(
      expect.objectContaining({
        hostId: 'host-1',
        content: expect.objectContaining({ entry: null }),
      }),
    )
  })

  it('keeps serving template screens when the lookup fails open', async () => {
    // The lookup is on every render's critical path, so it degrades to an
    // empty set rather than 404ing the site. Assert the loader honours that
    // rather than treating "unknown" as "template".
    mockTemplateScreenIds.mockResolvedValue(new Set<string>())

    const result: any = await loadPageData('acme', ['blog-entry-template'])

    expect(result.notFound).toBeUndefined()
    expect(result.props.data.screen.data.$id).toBe('blogEntryTmpl')
  })
})

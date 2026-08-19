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
 * A template screen must not be a page (AGL-1267, AGL-1270).
 *
 * Publishing the blog's entry template is what made `/blog/{entry}` render —
 * that is the mechanism working. But the same publish wrote the template into
 * the host's routing map, so `https://aglyn.com/blog-entry-template` returned
 * 200 with seven raw `{{entry.*}}` tokens as body text. A template has no
 * standalone form: there is no routed subject to substitute.
 *
 * AGL-1270: commerce has two more of exactly this kind — `pdpScreenId` and
 * `collectionScreenId` — which live on `hosts/{h}/settings/store` rather than on
 * a collection doc, so AGL-1267's subtraction never saw them.
 *
 * Every claim is asserted here, because the fix is a *removal* from the route
 * table and a removal is exactly the kind of change that takes working routes
 * with it:
 *
 *  1. the entry template's own slug 404s,
 *  2. a real entry URL still renders through that same template,
 *  3. an unknown entry still 404s,
 *  4. a LIST template published at its collection's root still serves — via
 *     the collection branch, which is the only branch that can give it
 *     entries and `{{collection.*}}` tokens,
 *  5. the PDP and catalog-collection templates' own slugs 404,
 *  6. `/products/{slug}` and `/collections/{slug}` still reach the commerce
 *     resolver, which is the branch that renders those same two screens WITH a
 *     product or collection in context.
 */

// Factories, not bare `jest.mock`: the loader's module graph reaches
// `@aglyn/tenant-data-admin` → `undici`, and an auto-mock still evaluates the
// real graph to derive its shape.
jest.mock('@aglyn/tenant-data-admin', () => ({
  __esModule: true,
  firebaseAdmin: { app: jest.fn() },
  // Lockdown (AGL-1501): nothing is locked in these scenarios; the verdict
  // logic is unit-tested in libs/tenant/data/admin lockdown.spec.ts.
  getPlatformLockdown: jest.fn(async () => null),
  filterEnabledPluginsByReleaseFlags: jest.fn(async () => []),
  getRealmPluginInstalls: jest.fn(async () => []),
}))
jest.mock('@aglyn/aglyn/server', () => ({
  __esModule: true,
  // The REAL lockdown resolver (AGL-1501), reached by file path like the
  // parsers below: with no suspension fields in these fixtures it answers
  // null, and faking it would re-implement the precedence table here.
  ...jest.requireActual('../../../libs/aglyn/src/lib/app-utils/lockdown'),
  // …and the REAL bandwidth cap beside it (AGL-2155), for the same reason:
  // with no `bandwidthCap` marker on these fixtures it answers false, and a
  // stub would be one more copy of a rule that lives in one place.
  ...jest.requireActual('../../../libs/aglyn/src/lib/app-utils/bandwidth-cap'),
  SCREEN_ROOT_PATH: '/',
  COLLECTION_LIST_PAGE_SIZE: 10,
  // The REAL parser (AGL-1321), reached by file path so the stub stays light.
  // Faking it would mean writing the collection route table a second time in
  // a test whose entire subject is which paths reach which branch — the two
  // copies would drift, and this suite would keep passing while they did.
  parseCollectionRoute: jest.requireActual(
    '../../../libs/aglyn/src/lib/app-utils/collection-entries',
  ).parseCollectionRoute,
  HostScreenVisibility: { AUTHENTICATED: 'authenticated' },
  // None of these hosts has a custom domain, so the canonical-origin branch
  // (AGL-1272) is never taken — but the loader CALLS this on every render, and
  // a stub missing it throws into the loader's catch and 404s every case here
  // for a reason that has nothing to do with routing.
  liveCustomDomain: jest.fn(() => undefined),
  resolveSiteRedirect: jest.fn(async () => null),
  resolveSitePage: jest.fn(async () => undefined),
  runSitePageEnrichers: jest.fn(async () => ({})),
  resolveEnabledPlugins: jest.fn(() => []),
  // Per-site enablement (AGL-1014): the loader now resolves per host.
  resolveHostEnabledPlugins: jest.fn(() => []),
  resolveOrgEntitlements: jest.fn(() => ({ features: {} })),
  resolveBrandingProfile: jest.fn(() => ({})),
  checkEntitlement: jest.fn(() => true),
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
jest.mock('@aglyn/tenant-runtime/template-screens', () => ({
  __esModule: true,
  default: jest.fn(async () => new Set<string>()),
}))

import {
  composeCollectionFallbackPage,
  composeCollectionTemplatePage,
} from '@aglyn/tenant-runtime/compose-collection-page'
import { resolveSitePage } from '@aglyn/aglyn/server'
import getCollectionContent from '@aglyn/tenant-runtime/get-collection-content'
import getTemplateScreenIds from '@aglyn/tenant-runtime/template-screens'
import getScreen from '@aglyn/tenant-runtime/get-screen'
import { loadPageData } from '../app/[host]/[[...slug]]/load-page-data'
import getHost from '../utils/get-host'

const mockGetHost = getHost as jest.Mock
const mockGetScreen = getScreen as jest.Mock
const mockTemplateScreenIds = getTemplateScreenIds as jest.Mock
const mockCollectionContent = getCollectionContent as jest.Mock
const mockComposeTemplate = composeCollectionTemplatePage as jest.Mock
const mockComposeFallback = composeCollectionFallbackPage as jest.Mock
const mockResolveSitePage = resolveSitePage as jest.Mock

/** Routing map as `publishScreenRoute` writes it: screen id → route path. */
const ROUTING = {
  home: '/',
  about: 'about',
  // What publishing the entry template added — the bug.
  blogEntryTmpl: 'blog-entry-template',
  blogListTmpl: 'blog',
  // The same bug from the commerce side (AGL-1270): both are designated on
  // `settings/store`, and publishing either put its own slug on the site.
  pdpTmpl: 'product-page-template',
  shopCollectionTmpl: 'collection-page-template',
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
  // The blog collection designates two; `settings/store` designates two more
  // (AGL-1270). `getTemplateScreenIds` unions both sources.
  mockTemplateScreenIds.mockResolvedValue(
    new Set([
      'blogListTmpl',
      'blogEntryTmpl',
      'pdpTmpl',
      'shopCollectionTmpl',
    ]),
  )
  // Stands in for the commerce resolver: it answers only the real catalog
  // routes, exactly as `commerceSitePageResolver` does.
  mockResolveSitePage.mockImplementation(async ({ path }: any) => {
    const segments = String(path).split('/').filter(Boolean)
    if (segments.length !== 2) return undefined
    if (segments[0] === 'products') {
      return {
        props: {
          data: { host: { $id: 'host-1' }, screen: { data: { $id: 'pdpTmpl' } } },
          nodes: { root: {} },
        },
        revalidate: 60,
      }
    }
    if (segments[0] === 'collections') {
      return {
        props: {
          data: {
            host: { $id: 'host-1' },
            screen: { data: { $id: 'shopCollectionTmpl' } },
          },
          nodes: { root: {} },
        },
        revalidate: 60,
      }
    }
    return undefined
  })
  mockCollectionContent.mockResolvedValue({
    collection: null,
    entries: [],
    entry: null,
    error: null,
  })
  mockComposeTemplate.mockResolvedValue(null)
  mockComposeFallback.mockResolvedValue(null)
})

describe('template screens are not pages (AGL-1267, AGL-1270)', () => {
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

  it('404s the commerce PDP template at its own published slug (AGL-1270)', async () => {
    const result: any = await loadPageData('acme', ['product-page-template'])

    expect(result.notFound).toBe(true)
    // Never composed as a screen — that is what rendered the raw
    // `{{product.*}}` tokens.
    expect(mockGetScreen).not.toHaveBeenCalledWith(
      expect.objectContaining({ screenId: 'pdpTmpl' }),
    )
  })

  it('404s the catalog collection template at its own published slug (AGL-1270)', async () => {
    const result: any = await loadPageData('acme', [
      'collection-page-template',
    ])

    expect(result.notFound).toBe(true)
    expect(mockGetScreen).not.toHaveBeenCalledWith(
      expect.objectContaining({ screenId: 'shopCollectionTmpl' }),
    )
  })

  it('still serves /products/{slug} through that same PDP template', async () => {
    const result: any = await loadPageData('acme', ['products', 'anvil'])

    expect(result.notFound).toBeUndefined()
    expect(result.props.data.screen.data.$id).toBe('pdpTmpl')
    expect(mockResolveSitePage).toHaveBeenCalledWith(
      expect.objectContaining({ path: 'products/anvil' }),
    )
  })

  it('still serves /collections/{slug} through that same collection template', async () => {
    const result: any = await loadPageData('acme', ['collections', 'tools'])

    expect(result.notFound).toBeUndefined()
    expect(result.props.data.screen.data.$id).toBe('shopCollectionTmpl')
  })

  it('keeps serving template screens when the lookup fails open', async () => {
    // The lookup is on every render's critical path, so it degrades to an
    // empty set rather than 404ing the site. Assert the loader honours that
    // rather than treating "unknown" as "template" — for BOTH sources, since
    // widening the read widened what a failure would take down.
    mockTemplateScreenIds.mockResolvedValue(new Set<string>())

    const entry: any = await loadPageData('acme', ['blog-entry-template'])
    expect(entry.notFound).toBeUndefined()
    expect(entry.props.data.screen.data.$id).toBe('blogEntryTmpl')

    const pdp: any = await loadPageData('acme', ['product-page-template'])
    expect(pdp.notFound).toBeUndefined()
    expect(pdp.props.data.screen.data.$id).toBe('pdpTmpl')
  })

  it('leaves a host with no store settings alone', async () => {
    // Commerce disabled, or Store settings never opened: `settings/store` does
    // not exist, so the union is just the collection templates and every
    // ordinary screen still serves.
    mockTemplateScreenIds.mockResolvedValue(
      new Set(['blogListTmpl', 'blogEntryTmpl']),
    )

    const ordinary: any = await loadPageData('acme', ['about'])
    expect(ordinary.props.data.screen.data.$id).toBe('about')

    // Nothing designated them, so these are ordinary screens again.
    const pdp: any = await loadPageData('acme', ['product-page-template'])
    expect(pdp.notFound).toBeUndefined()
  })
})

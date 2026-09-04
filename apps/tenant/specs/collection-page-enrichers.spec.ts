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
 * Collection routes run the plugin enrichers (AGL-2509).
 *
 * A collection page renders the site's shared layout, which means it renders
 * the site's nav — and a nav menu built from primitives opens on hover through
 * `clientAutomations`, which only an enricher produces. The collection branch
 * returned several hundred lines before `runSitePageEnrichers`, so on
 * `aglyn.com` the Product and Solutions mega menus worked on every published
 * screen and were dead on every blog post and on the changelog, from chrome
 * that was byte-identical on both.
 *
 * The enricher is registered here for real rather than mocked out of
 * `@aglyn/aglyn/server`, because the wiring under test IS the registry: a mock
 * would pass just as happily against a loader that hands the enrichers a page
 * with no nodes, or that drops their props on the floor afterwards.
 */

jest.mock('@aglyn/tenant-data-admin', () => ({
  __esModule: true,
  firebaseAdmin: { app: jest.fn() },
  getPlatformLockdown: jest.fn(async () => null),
  getDomainLockdown: jest.fn(async () => null),
  filterEnabledPluginsByReleaseFlags: jest.fn(async () => [
    'mui',
    'marketing',
    'commerce',
  ]),
  getRealmPluginInstalls: jest.fn(async () => []),
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
  composeCollectionFallbackPage: jest.fn(async () => null),
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

import {
  registerSitePageEnricher,
  setRegisteringPluginId,
  type SitePageContext,
} from '@aglyn/aglyn/server'
import {
  composeCollectionFallbackPage,
  composeCollectionTemplatePage,
} from '@aglyn/tenant-runtime/compose-collection-page'
import getCollectionContent from '@aglyn/tenant-runtime/get-collection-content'
import { loadPageData } from '../app/[host]/[[...slug]]/load-page-data'
import getHost from '../utils/get-host'

const mockGetHost = getHost as jest.Mock
const mockCollectionContent = getCollectionContent as jest.Mock
const mockComposeTemplate = composeCollectionTemplatePage as jest.Mock
const mockComposeFallback = composeCollectionFallbackPage as jest.Mock

/** What the marketing enricher contributes for a page with a hover menu. */
const AUTOMATIONS = [
  {
    id: 'node:cmp__layout__nav__menu:1',
    event: 'elementHoverEnter',
    selector: '[data-aglyn="leaf:cmp__layout__nav__menu"]',
    steps: [{ type: 'showElement', target: 'leaf:cmp__layout__nav__panel' }],
  },
]

const TEMPLATE_NODES = { root: { pluginId: 'mui' } }
const FALLBACK_NODES = { root: { pluginId: 'mui' }, body: {} }

const seen: SitePageContext[] = []

// Attributed to `marketing` the way the plugin loader attributes a real one,
// so the `blockingPlugins` narrowing has an owner to name — an unattributed
// contribution makes the loader refuse to narrow at all, which would hide
// whether the contribution reached the decision.
setRegisteringPluginId('marketing')
registerSitePageEnricher(async (context) => {
  seen.push(context)
  return { clientAutomations: AUTOMATIONS }
})
setRegisteringPluginId(undefined)

const COLLECTION = {
  $id: 'col-blog',
  displayName: 'Blog',
  slug: 'blog',
  entryScreenId: 'blogEntryTmpl',
}
const ENTRY = { $id: 'p1', title: 'One platform', slug: 'one-platform' }

beforeEach(() => {
  jest.clearAllMocks()
  seen.length = 0
  mockGetHost.mockResolvedValue({
    host: { $id: 'host-1', subdomain: 'acme', screens: { home: '/' } },
    error: null,
  })
  mockCollectionContent.mockResolvedValue({
    collection: COLLECTION,
    entries: [],
    entry: ENTRY,
    error: null,
  })
  mockComposeTemplate.mockResolvedValue({
    screen: { $id: 'blogEntryTmpl' },
    nodes: TEMPLATE_NODES,
  })
})

describe('collection routes run the site-page enrichers (AGL-2509)', () => {
  it('ships an enricher slice on a templated entry page', async () => {
    const result: any = await loadPageData('acme', ['blog', 'one-platform'])

    expect(result.props.clientAutomations).toEqual(AUTOMATIONS)
  })

  it('hands the enricher the page it composed, at the page’s own path', async () => {
    await loadPageData('acme', ['blog', 'one-platform'])

    expect(seen).toHaveLength(1)
    expect(seen[0].nodes).toEqual(TEMPLATE_NODES)
    expect(seen[0].path).toBe('blog/one-platform')
    expect(seen[0].slugSegments).toEqual(['blog', 'one-platform'])
  })

  it('withholds the template screen, whose experiments would compose untokenized', async () => {
    // `getScreenExperiments` re-composes each variant with `composeScreenNodes`
    // and no collection context, so a variant of an entry template would
    // render `{{entry.*}}` raw against an empty entries block. Naming the
    // screen here is what would turn that on.
    await loadPageData('acme', ['blog', 'one-platform'])

    expect(seen[0].screenId).toBeUndefined()
    expect(seen[0].screen).toBeUndefined()
  })

  it('counts the contributing plugin as one that must register before paint', async () => {
    const result: any = await loadPageData('acme', ['blog', 'one-platform'])

    // `mui` for the nodes, `marketing` for the contribution — and `commerce`,
    // which this page uses for nothing, left behind.
    expect(result.props.blockingPlugins).toEqual(['mui', 'marketing'])
  })

  it('ships the slice on the built-in fallback page too', async () => {
    mockComposeTemplate.mockResolvedValue(null)
    mockComposeFallback.mockResolvedValue({ nodes: FALLBACK_NODES })

    const result: any = await loadPageData('acme', ['blog', 'one-platform'])

    expect(result.props.clientAutomations).toEqual(AUTOMATIONS)
    expect(seen[0].nodes).toEqual(FALLBACK_NODES)
  })

  it('skips the legacy plain article, which mounts no runtime to read it', async () => {
    mockComposeTemplate.mockResolvedValue(null)
    mockComposeFallback.mockResolvedValue(null)

    const result: any = await loadPageData('acme', ['blog', 'one-platform'])

    expect(result.props.nodes).toBeNull()
    expect(result.props.clientAutomations).toBeUndefined()
    expect(seen).toHaveLength(0)
  })

  it('runs on a list route as well as an entry route', async () => {
    mockCollectionContent.mockResolvedValue({
      collection: COLLECTION,
      entries: [ENTRY],
      entry: null,
      pagination: { page: 1, perPage: 10, totalEntries: 1, totalPages: 1 },
      error: null,
    })

    const result: any = await loadPageData('acme', ['blog'])

    expect(result.props.clientAutomations).toEqual(AUTOMATIONS)
    expect(seen[0].path).toBe('blog')
  })
})

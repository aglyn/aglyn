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
 * The loader's remaining exits run the enrichers too (AGL-2510).
 *
 * AGL-2509 fixed collection routes; these are the other two exits that render
 * the site's shared layout — a designated auth screen, and a page a plugin
 * resolver composed (commerce's PDP and PLP). Both shipped the site's nav with
 * none of the behavior that opens it.
 *
 * The maintenance exit is asserted the other way round. It renders nodes and
 * deliberately does NOT enrich, and a test that only checked the fixed
 * surfaces would let a future "consistency" pass quietly turn announcements
 * and experiments on for a site that is telling visitors it is down.
 */

jest.mock('@aglyn/tenant-data-admin', () => ({
  __esModule: true,
  firebaseAdmin: { app: jest.fn() },
  getPlatformLockdown: jest.fn(async () => null),
  getDomainLockdown: jest.fn(async () => null),
  filterEnabledPluginsByReleaseFlags: jest.fn(async () => [
    'mui',
    'accounts',
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
  default: jest.fn(async () => ({ authRoot: { pluginId: 'mui' } })),
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
  default: jest.fn(async () => ({
    collection: null,
    entries: [],
    entry: null,
    error: null,
  })),
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
  registerSitePageResolver,
  setRegisteringPluginId,
  type SitePageContext,
} from '@aglyn/aglyn/server'
import getScreen from '@aglyn/tenant-runtime/get-screen'
import { loadPageData } from '../app/[host]/[[...slug]]/load-page-data'
import getHost from '../utils/get-host'

const mockGetHost = getHost as jest.Mock
const mockGetScreen = getScreen as jest.Mock

const AUTOMATIONS = [{ id: 'a1', event: 'elementHoverEnter', steps: [] }]
const PDP_NODES = { pdpRoot: { pluginId: 'mui' } }

const seen: SitePageContext[] = []
/** What the resolver answers with; reset per test. */
let resolverAnswer: Record<string, unknown> | undefined

setRegisteringPluginId('marketing')
registerSitePageEnricher(async (context) => {
  seen.push(context)
  return {
    clientAutomations: AUTOMATIONS,
    // The enricher's half of the one key a resolver also writes.
    pageData: { commerce: { grids: { g1: ['seeded'] } } },
  }
})
setRegisteringPluginId(undefined)

setRegisteringPluginId('commerce')
registerSitePageResolver(async () => resolverAnswer)
setRegisteringPluginId(undefined)

beforeEach(() => {
  jest.clearAllMocks()
  seen.length = 0
  resolverAnswer = undefined
  mockGetHost.mockResolvedValue({
    host: {
      $id: 'host-1',
      subdomain: 'acme',
      screens: { home: '/' },
      authScreens: { signinScreenId: 'signinTmpl' },
    },
    error: null,
  })
  mockGetScreen.mockResolvedValue({
    screen: { $id: 'signinTmpl', versionId: 'v1' },
    error: null,
  })
})

describe('designated auth screens (AGL-2510)', () => {
  it('ships the enricher slice', async () => {
    const result: any = await loadPageData('acme', ['signin'])

    expect(result.props.membershipPage).toBe('signin')
    expect(result.props.clientAutomations).toEqual(AUTOMATIONS)
  })

  it('names its screen, because it IS one', async () => {
    // Unlike a collection or PDP template, a designed sign-in screen composes
    // with no substituted tokens — so an experiment variant of it is a real
    // page, and withholding the screen would only turn experiments off.
    await loadPageData('acme', ['signin'])

    expect(seen[0].screenId).toBe('signinTmpl')
    expect(seen[0].screen).toEqual({ $id: 'signinTmpl', versionId: 'v1' })
  })

  it('counts the contributing plugin as one that must register before paint', async () => {
    const result: any = await loadPageData('acme', ['signin'])

    expect(result.props.blockingPlugins).toEqual(['mui', 'marketing'])
  })
})

describe('plugin-resolved pages (AGL-2510)', () => {
  beforeEach(() => {
    resolverAnswer = {
      props: {
        nodes: PDP_NODES,
        data: { host: { $id: 'host-1' } },
        pageData: { commerce: { product: { id: 'p1' } } },
      },
      revalidate: 60,
    }
  })

  it('ships the enricher slice on a resolver’s page', async () => {
    const result: any = await loadPageData('acme', ['products', 'widget'])

    expect(result.props.clientAutomations).toEqual(AUTOMATIONS)
    expect(seen[0].nodes).toEqual(PDP_NODES)
    expect(seen[0].path).toBe('products/widget')
  })

  it('withholds the screen — a PDP template composes against a routed product', async () => {
    await loadPageData('acme', ['products', 'widget'])

    expect(seen[0].screenId).toBeUndefined()
  })

  it('keeps BOTH halves of pageData, merged per plugin', async () => {
    const result: any = await loadPageData('acme', ['products', 'widget'])

    // The product would be gone under a shallow spread, and the seeds gone
    // under the reverse one.
    expect(result.props.pageData.commerce).toEqual({
      product: { id: 'p1' },
      grids: { g1: ['seeded'] },
    })
  })

  it('fills in the page-level props the resolver never wrote', async () => {
    const result: any = await loadPageData('acme', ['products', 'widget'])

    // `showBranding` is the one that costs money when it is missing: a free
    // plan's product pages were dropping the badge every other page carries.
    expect(result.props.showBranding).toBe(true)
    expect(result.props.enabledPlugins).toEqual([
      'mui',
      'accounts',
      'marketing',
      'commerce',
    ])
    expect(result.props.branding).toBeDefined()
    expect(result.props.blockingPlugins).toEqual(['mui', 'marketing'])
  })

  it('lets the resolver win every key it wrote', async () => {
    const result: any = await loadPageData('acme', ['products', 'widget'])

    expect(result.props.data).toEqual({ host: { $id: 'host-1' } })
    expect(result.revalidate).toBe(60)
  })

  it('passes a resolver answer with no nodes straight through', async () => {
    resolverAnswer = { redirect: { destination: '/moved', statusCode: 301 } }

    const result: any = await loadPageData('acme', ['products', 'widget'])

    expect(result).toEqual({
      redirect: { destination: '/moved', statusCode: 301 },
    })
    expect(seen).toHaveLength(0)
  })
})

describe('the maintenance exit stays unenriched (AGL-2510)', () => {
  it('renders its 503 screen with no enricher slice', async () => {
    mockGetHost.mockResolvedValue({
      host: {
        $id: 'host-1',
        subdomain: 'acme',
        screens: { home: '/' },
        maintenance: true,
        errorScreens: { unavailable: 'downTmpl' },
      },
      error: null,
    })
    mockGetScreen.mockResolvedValue({
      screen: { $id: 'downTmpl' },
      error: null,
    })

    const result: any = await loadPageData('acme', ['anything'])

    expect(result.props.maintenanceFallback).toBe(true)
    expect(result.props.nodes).toBeTruthy()
    expect(result.props.clientAutomations).toBeUndefined()
    expect(seen).toHaveLength(0)
  })
})

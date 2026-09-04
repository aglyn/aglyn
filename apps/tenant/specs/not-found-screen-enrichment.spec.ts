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
 * The designed 404 body carries the site's behavior too (AGL-2511).
 *
 * It renders the site's own header, nav and footer — that is the whole reason
 * a host designates one — so it was the last surface left rendering a nav that
 * does not open, after AGL-2509 and AGL-2510 fixed the rest.
 *
 * The second assertion is the one that keeps the fix affordable. This body is
 * fetched by HOST and cached per host, so a scan of ten thousand dead URLs
 * costs one compose a minute; enriching it per path would key that cache per
 * URL. `pathUnknown` is how the enrichers are told to contribute only what
 * does not depend on a path, and a future change that quietly starts passing a
 * real path here would restore the nav's behavior and multiply the cost
 * without anything failing.
 *
 * The enricher is registered for real rather than mocked, for the reason
 * `collection-page-enrichers.spec.ts` gives: the wiring under test IS the
 * registry.
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
  default: jest.fn(async () => ({ notFoundBody: { pluginId: 'mui' } })),
  composeNodesWithChrome: jest.fn(async () => ({ root: {} })),
}))
jest.mock('@aglyn/tenant-runtime/get-variables', () => ({
  __esModule: true,
  default: jest.fn(async () => ({})),
}))
jest.mock('@aglyn/tenant-runtime/get-screen', () => ({
  __esModule: true,
  default: jest.fn(async () => ({
    screen: { $id: 'notFoundTmpl', versionId: 'v1' },
    error: null,
  })),
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
import { loadNotFoundScreen } from '../app/[host]/[[...slug]]/load-page-data'
import getHost from '../utils/get-host'
import { serverPluginLoader } from '../utils/server-plugin-loader'

const mockGetHost = getHost as jest.Mock
const mockEnsureAll = serverPluginLoader.ensureAll as jest.Mock

const AUTOMATIONS = [{ id: 'a1', event: 'elementHoverEnter', steps: [] }]

const seen: SitePageContext[] = []

setRegisteringPluginId('marketing')
registerSitePageEnricher(async (context) => {
  seen.push(context)
  return { clientAutomations: AUTOMATIONS }
})
setRegisteringPluginId(undefined)

beforeEach(() => {
  jest.clearAllMocks()
  seen.length = 0
  mockGetHost.mockResolvedValue({
    host: {
      $id: 'host-1',
      subdomain: 'acme',
      screens: { home: '/' },
      errorScreens: { notFound: 'notFoundTmpl' },
    },
    error: null,
  })
})

describe('the designed 404 body (AGL-2511)', () => {
  it('carries the enricher slice', async () => {
    const props: any = await loadNotFoundScreen('acme')

    expect(props.notFoundFallback).toBe(true)
    expect(props.clientAutomations).toEqual(AUTOMATIONS)
    expect(seen[0].nodes).toEqual({ notFoundBody: { pluginId: 'mui' } })
  })

  it('tells the enrichers the path is not knowable', async () => {
    await loadNotFoundScreen('acme')

    expect(seen[0].pathUnknown).toBe(true)
  })

  it('names its screen — a designed 404 substitutes no tokens', async () => {
    await loadNotFoundScreen('acme')

    expect(seen[0].screenId).toBe('notFoundTmpl')
    expect(seen[0].screen).toEqual({ $id: 'notFoundTmpl', versionId: 'v1' })
  })

  it('loads the plugins first, or the registry it asks is empty', async () => {
    // This function is also reached from `/api/screen/not-found`, which is not
    // the plugin dispatcher. Without this the enrichers answer `{}` and
    // nothing anywhere reports a problem.
    await loadNotFoundScreen('acme')

    expect(mockEnsureAll).toHaveBeenCalledWith(['tenantApi'])
  })

  it('narrows the plugins the page blocks on', async () => {
    const props: any = await loadNotFoundScreen('acme')

    expect(props.enabledPlugins).toEqual(['mui', 'marketing', 'commerce'])
    expect(props.blockingPlugins).toEqual(['mui', 'marketing'])
  })
})

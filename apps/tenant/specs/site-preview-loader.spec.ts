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
 * The tenant loader's preview branch (AGL-4086).
 *
 * A site in preview answers the PUBLIC from the cached catch-all with the 503
 * page, or the built-in notice worded "Coming soon" — the maintenance answer,
 * `revalidate: 30`, no page nodes — and answers its TEAM, verified by the
 * uncached preview route and passed in as `SITE_PREVIEW_TEAM_VIEW`, with the
 * real page. One page in preview on a public site is a 404 to the public and
 * the page to the team. Lockdown and maintenance outrank preview for everyone.
 *
 * The module boundary is the one `loader-lockdown.spec.ts` draws, so these
 * are the branches of the real loader with the reads stubbed.
 */

const mockGetPlatformLockdown = jest.fn(async (): Promise<unknown> => null)

jest.mock('@aglyn/tenant-data-admin', () => ({
  __esModule: true,
  firebaseAdmin: { app: jest.fn() },
  getPlatformLockdown: (...args: unknown[]) =>
    mockGetPlatformLockdown(...(args as [])),
  // AGL-1513. Present even though every case here uses a bare subdomain (so
  // the loader's `cname--` ternary short-circuits and never calls it): a
  // wholesale mock is a closed world, and the first `cname--` case added
  // below would otherwise fail as an inscrutable TypeError rather than as
  // whatever it was actually asserting.
  getDomainLockdown: jest.fn(async () => null),
  filterEnabledPluginsByReleaseFlags: jest.fn(async () => []),
  getRealmPluginInstalls: jest.fn(async () => []),
}))
jest.mock('../utils/get-host', () => ({
  __esModule: true,
  default: jest.fn(),
  CNAME_HOST_PREFIX: 'cname--',
}))
jest.mock('../utils/get-org-billing', () => ({
  __esModule: true,
  default: jest.fn(async () => ({ org: null })),
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
  default: jest.fn(async () => ({
    screen: { $id: 'home', versionId: 'v1' },
    error: null,
  })),
}))
jest.mock('@aglyn/tenant-runtime/entry-link-routes', () => ({
  __esModule: true,
  resolveEntryLinkRoutes: jest.fn(async () => ({})),
  default: jest.fn(async () => ({})),
}))
jest.mock('@aglyn/tenant-runtime/get-collection-content', () => ({
  __esModule: true,
  default: jest.fn(async () => ({ collection: null, entries: [], entry: null })),
}))
jest.mock('@aglyn/tenant-runtime/compose-collection-page', () => ({
  __esModule: true,
  composeCollectionTemplatePage: jest.fn(async () => null),
  composeCollectionFallbackPage: jest.fn(async () => null),
}))
// The author page (AGL-2518), mocked for the reason its collection siblings
// above are: this suite's subject is which branch a path reaches, and the real
// module reaches Firestore through `next/cache`, which does not load here.
// Resolving to an unknown author is what makes the loader fall past it.
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
  // Faithful to the real module's OTHER export (AGL-1998): a double that
  // omits it makes `loadNotFoundScreen`/`page.tsx` throw on an undefined
  // function, and the surrounding try/catch turns that into a silent null.
  getTemplateScreenIds: jest.fn(async () => new Set<string>()),
  getTemplateScreenRouting: jest.fn(async () => ({
    templateScreenIds: new Set<string>(),
    listRoutes: {} as Record<string, string>,
  })),
}))

import {
  loadPageData,
  SITE_PREVIEW_TEAM_VIEW,
} from '../app/[host]/[scheme]/[[...slug]]/load-page-data'
import getHost from '../utils/get-host'
import getOrgBilling from '../utils/get-org-billing'
import getScreen from '@aglyn/tenant-runtime/get-screen'
import composeScreenNodes from '@aglyn/tenant-runtime/compose-screen-nodes'

const mockGetHost = getHost as jest.Mock
const mockGetOrgBilling = getOrgBilling as unknown as jest.Mock
const mockGetScreen = getScreen as unknown as jest.Mock
const mockCompose = composeScreenNodes as unknown as jest.Mock

const HOST = {
  $id: 'host-1',
  subdomain: 'acme',
  displayName: 'Acme Bakery',
  screens: { home: '/', about: 'about' },
}

const host = (overrides: Record<string, unknown> = {}) => ({
  host: { ...HOST, ...overrides },
  error: null,
})

const originalVercelEnv = process.env.VERCEL_ENV

beforeEach(() => {
  jest.clearAllMocks()
  mockGetPlatformLockdown.mockResolvedValue(null)
  mockGetHost.mockResolvedValue(host())
  mockGetOrgBilling.mockResolvedValue({ org: { $id: 'org-1' } })
  mockGetScreen.mockResolvedValue({
    screen: { $id: 'home', versionId: 'v1' },
    error: null,
  })
  mockCompose.mockResolvedValue({ root: {} })
})

afterEach(() => {
  if (originalVercelEnv === undefined) delete process.env.VERCEL_ENV
  else process.env.VERCEL_ENV = originalVercelEnv
})

describe('a site in preview, to the public (AGL-4086)', () => {
  it('CONTROL — a public site serves its page', async () => {
    const result: any = await loadPageData('acme', [])
    expect(result.props?.maintenanceFallback).toBeUndefined()
    expect(result.props?.sitePreview).toBeUndefined()
  })

  it('serves the built-in notice at every address: no page nodes, cached 30 s', async () => {
    mockGetHost.mockResolvedValue(host({ preview: true }))
    for (const slug of [[], ['about'], ['not-a-page'], ['blog', 'post']]) {
      const result: any = await loadPageData('acme', slug)
      expect(result.props.sitePreview).toBe(true)
      expect(result.props.maintenanceFallback).toBe(true)
      expect(result.props.nodes).toBeNull()
      expect(result.revalidate).toBe(30)
    }
    // The page itself was never read for the public.
    expect(mockGetScreen).not.toHaveBeenCalled()
  })

  it('serves the assigned 503 page when one is assigned', async () => {
    mockGetHost.mockResolvedValue(
      host({ preview: true, errorScreens: { unavailable: 'soon' } }),
    )
    mockGetScreen.mockResolvedValue({ screen: { $id: 'soon' }, error: null })
    mockCompose.mockResolvedValue({ root: { id: 'soon-root' } })
    const result: any = await loadPageData('acme', ['about'])
    expect(result.props.sitePreview).toBe(true)
    expect(result.props.nodes).toEqual({ root: { id: 'soon-root' } })
    expect(mockGetScreen).toHaveBeenCalledWith({ hostId: 'host-1', screenId: 'soon' })
    expect(result.revalidate).toBe(30)
  })

  it('maintenance outranks preview: the maintenance answer, not the preview one', async () => {
    mockGetHost.mockResolvedValue(host({ preview: true, maintenance: true }))
    const result: any = await loadPageData('acme', [])
    expect(result.props.maintenanceFallback).toBe(true)
    expect(result.props.sitePreview).toBeUndefined()
  })

  it('maintenance outranks preview for the team too', async () => {
    mockGetHost.mockResolvedValue(host({ preview: true, maintenance: true }))
    const result: any = await loadPageData('acme', [], '', SITE_PREVIEW_TEAM_VIEW)
    expect(result.props.maintenanceFallback).toBe(true)
  })

  it('a lockdown outranks preview, for the team as for everyone', async () => {
    mockGetHost.mockResolvedValue(
      host({ preview: true, suspendedAt: Date.now(), suspendedReasonCode: 'security' }),
    )
    const result: any = await loadPageData('acme', [], '', SITE_PREVIEW_TEAM_VIEW)
    expect(result.props.maintenanceFallback).toBe(true)
    expect(result.props.lockdown.reason).toBe('security')
    expect(result.props.sitePreview).toBeUndefined()
  })

  it('only an explicit true is preview — a stray value keeps the site public', async () => {
    mockGetHost.mockResolvedValue(host({ preview: 'yes' }))
    const result: any = await loadPageData('acme', [])
    expect(result.props?.sitePreview).toBeUndefined()
    expect(result.props?.maintenanceFallback).toBeUndefined()
  })
})

describe('a site in preview, to its team (AGL-4086)', () => {
  it('serves the real page', async () => {
    mockGetHost.mockResolvedValue(host({ preview: true }))
    const result: any = await loadPageData('acme', [], '', SITE_PREVIEW_TEAM_VIEW)
    expect(result.props.sitePreview).toBeUndefined()
    expect(result.props.maintenanceFallback).toBeUndefined()
    expect(result.props.nodes).toBeTruthy()
    expect(mockGetScreen).toHaveBeenCalledWith({ hostId: 'host-1', screenId: 'home' })
  })

  it('stays on the address it was asked on rather than redirecting to the custom domain', async () => {
    process.env.VERCEL_ENV = 'production'
    mockGetHost.mockResolvedValue(host({ preview: true, cname: 'acme.example' }))
    const team: any = await loadPageData('acme', ['about'], '', SITE_PREVIEW_TEAM_VIEW)
    expect(team.redirect).toBeUndefined()
    expect(team.props).toBeTruthy()
    // The public is still sent to the one canonical address.
    const stranger: any = await loadPageData('acme', ['about'])
    expect(stranger.redirect?.destination).toBe('https://acme.example/about')
  })
})

describe('one page in preview on a public site (AGL-4086)', () => {
  it('is a 404 to the public, cached 30 s, and the other pages serve as usual', async () => {
    mockGetHost.mockResolvedValue(host({ previewScreens: { about: true } }))
    const about: any = await loadPageData('acme', ['about'])
    expect(about).toEqual({ notFound: true, revalidate: 30 })
    const home: any = await loadPageData('acme', [])
    expect(home.props?.nodes).toBeTruthy()
  })

  it('is the page to the team', async () => {
    mockGetHost.mockResolvedValue(host({ previewScreens: { about: true } }))
    mockGetScreen.mockResolvedValue({ screen: { $id: 'about', versionId: 'v1' }, error: null })
    const result: any = await loadPageData('acme', ['about'], '', SITE_PREVIEW_TEAM_VIEW)
    expect(result.props?.nodes).toBeTruthy()
    expect(mockGetScreen).toHaveBeenCalledWith({ hostId: 'host-1', screenId: 'about' })
  })
})

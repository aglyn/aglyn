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
 * `{sub}.aglyn.app` redirects to a live custom domain (AGL-1272).
 *
 * The happy path is one line of behaviour and four lines of guard, and it is
 * the guards this suite exists for: every one of them, wrong, is an outage
 * rather than a bad ranking. So each is asserted on its own, against the real
 * `loadPageData` — not against the predicate — because a redirect that fires
 * for the right reason in a unit test and the wrong host in production has
 * proved nothing.
 *
 * The one that takes a site down is the LOOP: a request arriving on the custom
 * domain itself must render. If it redirects, it redirects to itself, forever,
 * for the customers who paid for a domain.
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
// `liveCustomDomain` is deliberately NOT mocked — it is half the behaviour
// under test. Everything else is stubbed to the shape the loader expects.
jest.mock('@aglyn/aglyn/server', () => {
  const actual = jest.requireActual(
    '../../../libs/aglyn/src/lib/app-utils/host-naming',
  )
  return {
    __esModule: true,
    // The REAL lockdown resolver (AGL-1501): with no suspension fields in
    // these fixtures it answers null; faking it would re-implement the
    // precedence table here.
    ...jest.requireActual('../../../libs/aglyn/src/lib/app-utils/lockdown'),
    // …and the REAL bandwidth cap beside it (AGL-2155), for the same reason:
    // with no `bandwidthCap` marker on these fixtures it answers false, and a
    // stub would be one more copy of a rule that lives in one place.
    ...jest.requireActual(
      '../../../libs/aglyn/src/lib/app-utils/bandwidth-cap',
    ),
    SCREEN_ROOT_PATH: '/',
    COLLECTION_LIST_PAGE_SIZE: 10,
    HostScreenVisibility: { AUTHENTICATED: 'authenticated' },
    liveCustomDomain: actual.liveCustomDomain,
    hostPublicOrigin: actual.hostPublicOrigin,
    resolveSiteRedirect: jest.fn(async () => null),
    resolveSitePage: jest.fn(async () => undefined),
    runSitePageEnrichers: jest.fn(async () => ({})),
    resolveEnabledPlugins: jest.fn(() => []),
  // Per-site enablement (AGL-1014): the loader now resolves per host.
  resolveHostEnabledPlugins: jest.fn(() => []),
    resolveOrgEntitlements: jest.fn(() => ({ features: {} })),
    resolveBrandingProfile: jest.fn(() => ({})),
    checkEntitlement: jest.fn(() => true),
  }
})
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
  default: jest.fn(async ({ screenId }: any) => ({
    screen: { $id: screenId, displayName: screenId },
    error: null,
  })),
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
}))

import { loadPageData } from '../app/[host]/[[...slug]]/load-page-data'
import getHost from '../utils/get-host'

const mockGetHost = getHost as jest.Mock

/** Routing map as `publishScreenRoute` writes it: screen id → route path. */
const ROUTING = { home: '/', pricing: 'pricing', deep: 'a/b' }

/** A host as Firestore holds it once a domain is connected AND attached. */
const liveHost = (overrides: Record<string, unknown> = {}) => ({
  $id: 'host-1',
  subdomain: 'acme',
  cname: 'custom.example',
  screens: ROUTING,
  ...overrides,
})

const originalVercelEnv = process.env.VERCEL_ENV

beforeEach(() => {
  jest.clearAllMocks()
  // Only production redirects — see the deployment guard. Every assertion
  // about the happy path has to run with this set, or it is asserting the
  // guard rather than the behaviour.
  process.env.VERCEL_ENV = 'production'
  mockGetHost.mockResolvedValue({ host: liveHost(), error: null })
})

afterAll(() => {
  if (originalVercelEnv === undefined) delete process.env.VERCEL_ENV
  else process.env.VERCEL_ENV = originalVercelEnv
})

describe('the platform subdomain redirects to a live custom domain (AGL-1272)', () => {
  it('redirects, temporarily, preserving the path', async () => {
    const result: any = await loadPageData('acme', ['pricing'])

    expect(result.redirect).toEqual({
      destination: 'https://custom.example/pricing',
      // 307, not 301/308: a permanent redirect is cacheable by default and
      // we cannot revoke it when the customer disconnects the domain.
      statusCode: 307,
    })
  })

  it('redirects the home page to the destination root', async () => {
    const result: any = await loadPageData('acme', [])

    expect(result.redirect.destination).toBe('https://custom.example/')
  })

  it('preserves a nested path segment by segment', async () => {
    const result: any = await loadPageData('acme', ['a', 'b'])

    expect(result.redirect.destination).toBe('https://custom.example/a/b')
  })

  it('encodes path segments rather than letting one rewrite the target', async () => {
    // `params` arrives URL-decoded, so a decoded segment is untrusted input
    // heading for a `Location` header.
    const result: any = await loadPageData('acme', ['ev/il?x=1'])

    expect(result.redirect.destination).toBe(
      'https://custom.example/ev%2Fil%3Fx%3D1',
    )
  })

  it('returns before any of the page composition work', async () => {
    // The redirect is hooked immediately after `getHost` precisely so a
    // redirecting render costs LESS than a serving one (AGL-1152). If it ever
    // moves below the composition chain this fails.
    const getOrgBilling = jest.requireMock('../utils/get-org-billing').default
    const composeScreenNodes = jest.requireMock(
      '@aglyn/tenant-runtime/compose-screen-nodes',
    ).default

    await loadPageData('acme', ['pricing'])

    expect(getOrgBilling).not.toHaveBeenCalled()
    expect(composeScreenNodes).not.toHaveBeenCalled()
  })
})

describe('the guards, each of which is an outage if it is wrong', () => {
  it('does NOT redirect the custom domain itself — the loop that kills a site', async () => {
    // A request that arrived on `custom.example` reaches the loader as the
    // middleware sentinel. It must render. Redirecting here points the domain
    // at itself and the site is unreachable at every address it has.
    mockGetHost.mockResolvedValue({ host: liveHost(), error: null })

    const result: any = await loadPageData('cname--custom.example', ['pricing'])

    expect(result.redirect).toBeUndefined()
    expect(result.notFound).toBeUndefined()
    expect(result.props.data.screen.data.$id).toBe('pricing')
  })

  it('does NOT redirect a host with no custom domain', async () => {
    mockGetHost.mockResolvedValue({
      host: liveHost({ cname: undefined }),
      error: null,
    })

    const result: any = await loadPageData('acme', ['pricing'])

    expect(result.redirect).toBeUndefined()
    expect(result.props.data.screen.data.$id).toBe('pricing')
  })

  it('does NOT redirect to a domain that is attached but not live', async () => {
    // `cnameAttachmentPending` is the honest record that the Vercel attach
    // never landed: claimed in Firestore, serving nothing. Redirecting here
    // strands the entire site on a host with no certificate and no routing.
    mockGetHost.mockResolvedValue({
      host: liveHost({ cnameAttachmentPending: true }),
      error: null,
    })

    const result: any = await loadPageData('acme', ['pricing'])

    expect(result.redirect).toBeUndefined()
    expect(result.props.data.screen.data.$id).toBe('pricing')
  })

  it('does NOT redirect while a disconnect is still pending', async () => {
    mockGetHost.mockResolvedValue({
      host: liveHost({ cnameDetachmentPending: true }),
      error: null,
    })

    const result: any = await loadPageData('acme', ['pricing'])

    expect(result.redirect).toBeUndefined()
  })

  it('serves normally again the moment the domain is detached', async () => {
    // Detach deletes `cname`, so the next ISR rebuild stops redirecting. This
    // is the recovery the 307 exists to keep possible.
    mockGetHost.mockResolvedValue({ host: liveHost(), error: null })
    const before: any = await loadPageData('acme', ['deep-a'])
    expect(before.redirect).toBeDefined()

    mockGetHost.mockResolvedValue({
      host: liveHost({ cname: undefined }),
      error: null,
    })
    const after: any = await loadPageData('acme', ['deep-b'])

    expect(after.redirect).toBeUndefined()
  })

  it('does NOT redirect into the platform subdomain space', async () => {
    // A cname inside `aglyn.app` is resolved by `subdomain` before `cname` is
    // ever consulted, so honouring it would redirect the host to itself.
    mockGetHost.mockResolvedValue({
      host: liveHost({ cname: 'acme.aglyn.app' }),
      error: null,
    })

    const result: any = await loadPageData('acme', ['pricing'])

    expect(result.redirect).toBeUndefined()
  })

  it('does NOT redirect to a cname that is not hostname-shaped', async () => {
    // `/api/domains/attach` lowercases and trims but never pattern-checks, so
    // junk can reach Firestore — and from there a `Location` header.
    mockGetHost.mockResolvedValue({
      host: liveHost({ cname: 'evil.example/@attacker.test' }),
      error: null,
    })

    const result: any = await loadPageData('acme', ['pricing'])

    expect(result.redirect).toBeUndefined()
  })

  it('does NOT redirect on a preview deployment', async () => {
    // Preview resolves its tenant host from `?tenantHost=`, which lands here
    // as a bare subdomain indistinguishable from a real `{sub}.aglyn.app`
    // request. A reviewer bounced onto the customer's live site is reviewing
    // nothing.
    process.env.VERCEL_ENV = 'preview'

    const result: any = await loadPageData('acme', ['pricing'])

    expect(result.redirect).toBeUndefined()
    expect(result.props.data.screen.data.$id).toBe('pricing')
  })

  it('does NOT redirect in local development', async () => {
    delete process.env.VERCEL_ENV

    const result: any = await loadPageData('acme', ['pricing'])

    expect(result.redirect).toBeUndefined()
  })
})

describe('platform hostnames are untouched', () => {
  it('serves demo.aglyn.app normally', async () => {
    // The demo host has no custom domain, so it never enters the branch —
    // asserted rather than assumed, because `demo` is the fallback every
    // preview and `*.vercel.app` request also lands on.
    mockGetHost.mockResolvedValue({
      host: { $id: 'host-demo', subdomain: 'demo', screens: ROUTING },
      error: null,
    })

    const result: any = await loadPageData('demo', ['pricing'])

    expect(result.redirect).toBeUndefined()
    expect(result.props.data.screen.data.$id).toBe('pricing')
  })

  it('serves the marketing site on its own apex without redirecting it', async () => {
    // aglyn.com is itself a host on the platform, reached through the same
    // cname sentinel. The loop guard is the only thing keeping our own
    // marketing site up.
    mockGetHost.mockResolvedValue({
      host: {
        $id: 'host-www',
        subdomain: 'aglyn',
        cname: 'aglyn.com',
        screens: ROUTING,
      },
      error: null,
    })

    const result: any = await loadPageData('cname--aglyn.com', [])

    expect(result.redirect).toBeUndefined()
    expect(result.props.data.screen.data.$id).toBe('home')
  })
})

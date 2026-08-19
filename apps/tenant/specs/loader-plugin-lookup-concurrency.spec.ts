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
 * The two plugin lookups must overlap composition (AGL-1225).
 *
 * `getRealmPluginInstalls` and `filterEnabledPluginsByReleaseFlags` were
 * awaited back to back at the end of the loader, and neither reads anything
 * composition produces — both inputs are settled by `getOrgBilling`. Measured
 * on a cache-MISS render of `/product/besigner` against production Firestore,
 * issuing them before `composeScreenNodes` instead of after was worth a
 * 462 ms median, winning 15 of 15 interleaved pairs.
 *
 * Output equality cannot see any of that: re-serialising the awaits returns
 * byte-identical props and gives the whole saving back silently. So the
 * property asserted here is the ORDER — both lookups must have STARTED before
 * composition FINISHES — which is the thing that would regress.
 *
 * The second test is the other half, and it is why the lookups are issued
 * where they are rather than at the top of the loader: every exit above
 * composition (404, redirect, maintenance, auth screens, protected and
 * members-only screens) must still issue NEITHER. Hoisting them further would
 * spend two Firestore reads on every 404 — the read-amplification mistake
 * AGL-1302 exists to undo.
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
  filterEnabledPluginsByReleaseFlags: jest.fn(),
  getRealmPluginInstalls: jest.fn(),
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
  // …and the REAL abuse ceiling beside the cap. It lives in
  // `plan-entitlements` rather than `bandwidth-cap` because it is the other,
  // higher brace (10x the band, any plan) — two controls, two modules. Pulled
  // by name rather than spreading the whole module, which would also override
  // the deliberate stubs below. With no `bandwidthCeiling` marker on these
  // fixtures it answers false; absent entirely it threw into the loader's
  // catch and 404'd every case here for a reason unrelated to the subject.
  bandwidthCeilingMonthKey: jest.requireActual(
    '../../../libs/aglyn/src/lib/app-utils/plan-entitlements',
  ).bandwidthCeilingMonthKey,
  bandwidthCeilingDegradesHost: jest.requireActual(
    '../../../libs/aglyn/src/lib/app-utils/plan-entitlements',
  ).bandwidthCeilingDegradesHost,
  SCREEN_ROOT_PATH: '/',
  COLLECTION_LIST_PAGE_SIZE: 10,
  parseCollectionRoute: jest.fn(() => null),
  HostScreenVisibility: { AUTHENTICATED: 'authenticated' },
  liveCustomDomain: jest.fn(() => undefined),
  resolveSiteRedirect: jest.fn(async () => null),
  resolveSitePage: jest.fn(async () => undefined),
  runSitePageEnrichers: jest.fn(async () => ({
    props: {},
    contributors: [],
    unattributed: false,
  })),
  resolveHostEnabledPlugins: jest.fn(() => ['commerce']),
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
  default: jest.fn(),
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
  filterEnabledPluginsByReleaseFlags,
  getRealmPluginInstalls,
} from '@aglyn/tenant-data-admin'
import composeScreenNodes from '@aglyn/tenant-runtime/compose-screen-nodes'
import getScreen from '@aglyn/tenant-runtime/get-screen'
import { loadPageData } from '../app/[host]/[[...slug]]/load-page-data'
import getHost from '../utils/get-host'

const mockGetHost = getHost as jest.Mock
const mockGetScreen = getScreen as jest.Mock
const mockCompose = composeScreenNodes as unknown as jest.Mock
const mockRealm = getRealmPluginInstalls as jest.Mock
const mockFlags = filterEnabledPluginsByReleaseFlags as jest.Mock

/** Ordered log of the events the concurrency claim is about. */
let events: string[]
/** Held closed so composition is still in flight while we inspect. */
let releaseCompose: () => void

/**
 * Let the microtask/macrotask queues drain until `predicate` holds. The loader
 * awaits several mocked reads before composition, so a single tick is not
 * enough and a fixed sleep would be a race.
 */
const until = async (predicate: () => boolean): Promise<void> => {
  for (let i = 0; i < 100 && !predicate(); i++) {
    await new Promise((resolve) => setImmediate(resolve))
  }
}

beforeEach(() => {
  jest.clearAllMocks()
  events = []
  mockGetHost.mockResolvedValue({
    host: { $id: 'host-1', subdomain: 'acme', screens: { about: 'about' } },
    error: null,
  })
  mockGetScreen.mockImplementation(async ({ screenId }: any) => ({
    screen: { $id: screenId, displayName: screenId },
    error: null,
  }))
  mockCompose.mockImplementation(async () => {
    events.push('compose:start')
    await new Promise<void>((resolve) => {
      releaseCompose = () => {
        events.push('compose:end')
        resolve()
      }
    })
    return { root: {} }
  })
  mockRealm.mockImplementation(async () => {
    events.push('realm:start')
    return [{ listingId: 'plugin-a' }]
  })
  mockFlags.mockImplementation(async () => {
    events.push('flags:start')
    return ['commerce']
  })
})

describe('tenant loader plugin lookups (AGL-1225)', () => {
  it('starts both lookups before composition finishes', async () => {
    const pending = loadPageData('acme', ['about'])

    // Composition is now in flight and deliberately unresolved.
    await until(() => events.includes('compose:start'))
    expect(events).toContain('compose:start')

    // THE PROPERTY. Re-serialising the awaits — moving either lookup back
    // below composition — leaves these unstarted here and fails.
    expect(events).toContain('realm:start')
    expect(events).toContain('flags:start')

    releaseCompose()
    const result = (await pending) as any

    // Both were still genuinely awaited, and their values still reach props.
    expect(events.indexOf('realm:start')).toBeLessThan(
      events.indexOf('compose:end'),
    )
    expect(events.indexOf('flags:start')).toBeLessThan(
      events.indexOf('compose:end'),
    )
    expect(mockRealm).toHaveBeenCalledTimes(1)
    expect(mockFlags).toHaveBeenCalledTimes(1)
    expect(result.props.realmPlugins).toEqual([{ listingId: 'plugin-a' }])
    expect(result.props.enabledPlugins).toEqual(['commerce'])
  })

  it('issues neither lookup on a path that never reaches composition', async () => {
    // An unrouted path: no screen entry, no plugin resolver, no collection —
    // the loader 404s well above composition.
    const result = (await loadPageData('acme', ['nope'])) as any

    expect(result.notFound).toBe(true)
    expect(mockCompose).not.toHaveBeenCalled()
    expect(mockRealm).not.toHaveBeenCalled()
    expect(mockFlags).not.toHaveBeenCalled()
  })
})

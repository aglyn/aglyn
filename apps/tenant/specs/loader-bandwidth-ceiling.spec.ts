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
 * THE FORCED BRANCH for AGL-2155: a free host past the bandwidth abuse
 * ceiling is actually REFUSED by the real tenant loader, and a paying host at
 * the same number is not.
 *
 * Built on `loader-lockdown.spec.ts`'s harness deliberately — same mocks,
 * same real `@aglyn/aglyn/server` (the ceiling arithmetic and the flag reader
 * are the REAL ones here, not doubles), same real `loadPageData`. What is
 * being proved is not that `checkBandwidthAbuseCeiling` returns `true`; a
 * test that asserted a function's return value would have passed on every day
 * this hole was open. It is that the CALL SITE refuses.
 *
 * ## The two-plan pair, and why 150,000
 *
 * Free's ceiling is `BANDWIDTH_ABUSE_CEILING_FLOOR` = 100,000 page views
 * (10× its 5 GB band is only ~87,381, so the floor wins and gives a hobby
 * site real headroom). Starter's is 10× its 50 GB band = 873,813. 150,000
 * views sits between the two, so the same count on the two plans takes
 * opposite branches — the negative control is the same number, not a smaller
 * one.
 *
 * ## What the loader reads
 *
 * `hosts/{id}.bandwidthCeiling`, off the host document the loader ALREADY
 * loads (`getHost`, mocked here exactly as the lockdown suite mocks it). No
 * counter is read in this path, which is the objection the fix had to answer;
 * `analytics-collect.spec.ts` proves the other end — that the flag is written
 * where the counter is written.
 */

const mockGetPlatformLockdown = jest.fn(async (): Promise<unknown> => null)

jest.mock('@aglyn/tenant-data-admin', () => ({
  __esModule: true,
  firebaseAdmin: { app: jest.fn() },
  getPlatformLockdown: (...args: unknown[]) =>
    mockGetPlatformLockdown(...(args as [])),
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
jest.mock('@aglyn/tenant-runtime/get-collection-content', () => ({
  __esModule: true,
  default: jest.fn(async () => ({ collection: null, entries: [], entry: null })),
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

import * as Aglyn from '@aglyn/aglyn/server'
import { loadPageData } from '../app/[host]/[[...slug]]/load-page-data'
import getHost from '../utils/get-host'
import getOrgBilling from '../utils/get-org-billing'

const mockGetHost = getHost as jest.Mock
const mockGetOrgBilling = getOrgBilling as unknown as jest.Mock

const HOST = {
  $id: 'host-1',
  subdomain: 'acme',
  screens: { home: '/' },
}

beforeEach(() => {
  jest.clearAllMocks()
  mockGetPlatformLockdown.mockResolvedValue(null)
  mockGetHost.mockResolvedValue({ host: { ...HOST }, error: null })
  mockGetOrgBilling.mockResolvedValue({ org: { $id: 'org-1' } })
})

// AGL-2016: the lockdown notice's contact line is operator configuration.
// This is the AGLYN-OPERATED shape; the self-host and unconfigured shapes are
// covered at the source in libs/aglyn/src/lib/app-utils/lockdown.spec.ts.
beforeEach(() => {
  process.env.NEXT_PUBLIC_OPERATOR_NAME = 'Aglyn LLC'
  process.env.NEXT_PUBLIC_OPERATOR_SUPPORT_EMAIL = 'support@aglyn.com'
})
afterEach(() => {
  delete process.env.NEXT_PUBLIC_OPERATOR_NAME
  delete process.env.NEXT_PUBLIC_OPERATOR_SUPPORT_EMAIL
})

const MONTH = new Date().toISOString().slice(0, 7)
const lastMonthKey = () => {
  const date = new Date()
  date.setUTCDate(1)
  date.setUTCMonth(date.getUTCMonth() - 1)
  return date.toISOString().slice(0, 7)
}

/**
 * The flag EXACTLY as `/api/analytics/collect` writes it — derived here from
 * the real `checkBandwidthAbuseCeiling` and the real
 * `bandwidthCeilingDegradesRender`, driven by the plan, rather than
 * hand-written. A hand-written literal would let the loader keep passing
 * after the evaluator started producing a different shape.
 */
const tripFor = (plan: string, pageViews: number, month = MONTH) => {
  const org = { plan } as never
  const ceiling = Aglyn.checkBandwidthAbuseCeiling(org, pageViews)
  return {
    month,
    ceiling: ceiling.ceiling,
    used: ceiling.used,
    trippedAtMs: Date.now(),
    degraded: Aglyn.bandwidthCeilingDegradesRender(org),
    exceeded: ceiling.exceeded,
  }
}

describe('the ceiling arithmetic the loader is driven by', () => {
  it('separates the two plans at the same count — 150,000 views', () => {
    const free = tripFor('free', 150_000)
    const starter = tripFor('starter', 150_000)
    expect(free.ceiling).toBe(100_000)
    expect(free.exceeded).toBe(true)
    expect(free.degraded).toBe(true)
    expect(starter.ceiling).toBe(873_813)
    expect(starter.exceeded).toBe(false)
    // The metered plan never degrades even past its OWN ceiling.
    expect(tripFor('starter', 1_000_000).exceeded).toBe(true)
    expect(tripFor('starter', 1_000_000).degraded).toBe(false)
  })

  it('the ladder never inverts — a bigger plan never gets a smaller ceiling', () => {
    // The failure `FORM_ABUSE_CEILING_UNLIMITED` exists to prevent, restated:
    // a floor plus a multiple plus an infinite band is three rules that can
    // disagree, and enterprise's UNLIMITED bandwidth has nothing to multiply.
    const ladder = [
      'free',
      'starter',
      'pro',
      'business',
      'advanced',
      'agency',
      'enterprise',
    ].map((plan) => tripFor(plan, 0).ceiling)
    for (let i = 1; i < ladder.length; i++) {
      expect(ladder[i]).toBeGreaterThanOrEqual(ladder[i - 1])
    }
    expect(ladder[ladder.length - 1]).toBe(
      Aglyn.BANDWIDTH_ABUSE_CEILING_UNLIMITED,
    )
  })
})

describe('the tenant loader refuses a contained FREE site (AGL-2155)', () => {
  it('CONTROL — no flag serves the page', async () => {
    const result: any = await loadPageData('acme', [])
    expect(result.props?.maintenanceFallback).toBeUndefined()
    expect(result.props?.lockdown).toBeUndefined()
  })

  it('THE BRANCH: a free host past the ceiling is actually refused', async () => {
    const trip = tripFor('free', 150_000)
    expect(trip.exceeded).toBe(true) // the premise, stated
    mockGetHost.mockResolvedValue({
      host: { ...HOST, bandwidthCeiling: trip },
      error: null,
    })
    const result: any = await loadPageData('acme', [])
    // Refused: no composed canvas reaches the visitor, so none of the ~40
    // Firestore reads and ~600 KB of egress a real render costs are paid.
    expect(result.props.maintenanceFallback).toBe(true)
    expect(result.props.nodes).toBeNull()
    expect(result.props.lockdown.reason).toBe('bandwidth_ceiling')
    expect(result.props.lockdown.title).toBeTruthy()
    expect(result.revalidate).toBe(60)
  })

  it('THE NEGATIVE CONTROL: a PAYING host at the same 150,000 serves normally', async () => {
    const trip = tripFor('starter', 150_000)
    expect(trip.exceeded).toBe(false)
    // Nothing would have been written at all; planting it anyway is the
    // stronger test — even a flag that somehow existed must not degrade a
    // plan whose overage bills.
    mockGetHost.mockResolvedValue({
      host: { ...HOST, bandwidthCeiling: trip },
      error: null,
    })
    const result: any = await loadPageData('acme', [])
    expect(result.props?.maintenanceFallback).toBeUndefined()
    expect(result.props?.lockdown).toBeUndefined()
  })

  it('a PAYING host past its OWN ceiling still serves — flagged, not degraded', async () => {
    mockGetHost.mockResolvedValue({
      host: { ...HOST, bandwidthCeiling: tripFor('starter', 1_000_000) },
      error: null,
    })
    const result: any = await loadPageData('acme', [])
    expect(result.props?.maintenanceFallback).toBeUndefined()
  })

  it("LAST month's trip serves normally — self-clearing, no write, no staff action", async () => {
    mockGetHost.mockResolvedValue({
      host: {
        ...HOST,
        bandwidthCeiling: tripFor('free', 5_000_000, lastMonthKey()),
      },
      error: null,
    })
    const result: any = await loadPageData('acme', [])
    expect(result.props?.maintenanceFallback).toBeUndefined()
  })

  it('a malformed or client-forged flag is ignored rather than trusted', async () => {
    // `bandwidthCeiling` is frozen against client writes in
    // `cloud/firebase-firestore.rules` alongside the `suspendedAt` family, but
    // the reader must not depend on that being the only defence: junk in the
    // field must never take a site down.
    for (const bandwidthCeiling of [
      null,
      'yes',
      {},
      { month: MONTH },
      { month: MONTH, ceiling: 0, degraded: true },
      { month: MONTH, ceiling: 100_000 }, // no `degraded`
      { month: MONTH, ceiling: 100_000, degraded: 'true' }, // not the boolean
    ]) {
      mockGetHost.mockResolvedValue({
        host: { ...HOST, bandwidthCeiling },
        error: null,
      })
      const result: any = await loadPageData('acme', [])
      expect(result.props?.maintenanceFallback).toBeUndefined()
    }
  })

  it('a staff LOCKDOWN outranks the containment', async () => {
    // Precedence, asserted rather than assumed: a takedown must not be
    // downgraded to "over your bandwidth" copy, which would tell a suspended
    // site the wrong thing about why it is off the air.
    mockGetHost.mockResolvedValue({
      host: {
        ...HOST,
        suspendedAt: Date.now(),
        suspendedReasonCode: 'security',
        bandwidthCeiling: tripFor('free', 150_000),
      },
      error: null,
    })
    const result: any = await loadPageData('acme', [])
    expect(result.props.lockdown.reason).toBe('security')
  })
})

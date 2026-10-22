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
 * Billing → Usage meters storage as ONE band for the workspace (AGL-3479).
 *
 * Since AGL-2075 every site's media library and the org's shared one count
 * against one band, `hostLimit × storagePerHostMb` — what ingress refuses at
 * (`resolveOrgMediaBand`), what the invoice subtracts
 * (`meteredIncludedAllowance`) and what the usage alerts warn on. The Billing
 * card still drew a "Storage" meter per site, each site's bytes "of" the
 * per-site figure: on a multi-site org a workspace at 90% of its band showed
 * every site comfortably green, and on any org the shared library's bytes
 * appeared nowhere.
 *
 * The fixture is MULTI-SITE with UNEQUAL sites and a non-empty org library,
 * and every site is under the per-site figure while the pool is past the
 * warning point — so the per-site reading and the pooled one land on opposite
 * sides of the threshold, and this suite could not pass against the old meter.
 *
 * No plan figure is written here. The plans are found in `PLAN_ENTITLEMENTS`
 * by what they do, and every band is derived through `resolveOrgEntitlements`
 * by the `max(1, hostLimit) × storagePerHostMb` arithmetic the gate uses.
 */

import { render, screen, waitFor } from '@testing-library/react'
import {
  PLAN_ENTITLEMENTS,
  planMetersInfraOverage,
  resolveOrgEntitlements,
  UNLIMITED,
} from '@aglyn/aglyn/app-utils/plan-entitlements'
import { formatMediaBytes } from '../components/media/media-storage-copy'
import { meteredIncludedAllowance } from '../utils/usage-metering'

const MB = 1024 * 1024

type PlanKey = keyof typeof PLAN_ENTITLEMENTS
const PLANS = Object.keys(PLAN_ENTITLEMENTS) as PlanKey[]
const orgOn = (plan: PlanKey) =>
  ({ $id: 'org-1', plan, subscription: { status: 'active' } }) as any

/** The pooled band in MB, as `resolveOrgMediaBand` resolves it. */
function pooledBandMb(org: any): number {
  const resolved = resolveOrgEntitlements(org)
  return Math.max(1, resolved.hostLimit) * resolved.storagePerHostMb
}

/** A plan with room for three sites that bills storage past its band. */
const METERED_MULTI_SITE = PLANS.find((plan) => {
  const org = orgOn(plan)
  return (
    resolveOrgEntitlements(org).hostLimit >= 3 &&
    planMetersInfraOverage(org) &&
    Number.isFinite(pooledBandMb(org))
  )
}) as PlanKey
/** A plan whose band is a wall: past it uploads are refused, never billed. */
const HARD_BAND = PLANS.find((plan) => {
  const org = orgOn(plan)
  return !planMetersInfraOverage(org) && Number.isFinite(pooledBandMb(org))
}) as PlanKey
/**
 * An org whose storage caps nothing — an agreement's override, since no
 * published plan is uncapped.
 */
const UNLIMITED_ORG = {
  ...orgOn(METERED_MULTI_SITE),
  entitlements: { storagePerHostMb: UNLIMITED },
} as any

const HOSTS = [
  { $id: 'host-a', displayName: 'Site A' },
  { $id: 'host-b', displayName: 'Site B' },
  { $id: 'host-c', displayName: 'Site C' },
]

/** Each site's own `counters/media.bytes`, in whole MB. */
let mockSiteMb: Record<string, number> = {}
/** What `/api/media/storage` answers, or `null` for a refusal. */
let mockStorageAnswer: Record<string, unknown> | null = null
const mockFetched: string[] = []

jest.mock('../utils/fetch-seat-counts', () => ({
  __esModule: true,
  default: async () => ({ managerSeats: 1, collaboratorSeats: 0 }),
}))

const mockUser = { uid: 'u1', getIdToken: async () => 'tok' }
jest.mock('@aglyn/tenant-feature-instance', () => ({
  __esModule: true,
  useFirestore: () => ({}),
  // The per-site reusable-component meter's live count (AGL-3615), its own
  // two aggregations; not what this spec reads.
  useLiveArtifactCount: () => null,
  useUser: () => ({ data: mockUser }),
}))

jest.mock('firebase/firestore', () => ({
  __esModule: true,
  doc: (_db: unknown, ...segments: string[]) => ({ path: segments.join('/') }),
  collection: (_db: unknown, ...segments: string[]) => ({
    path: segments.join('/'),
  }),
  getCountFromServer: async () => ({ data: () => ({ count: 0 }) }),
  getDoc: async (ref: { path: string }) => {
    const site = /^hosts\/([^/]+)\/counters\/media$/.exec(ref.path)?.[1]
    if (site && mockSiteMb[site] != null) {
      return {
        exists: () => true,
        data: () => ({ bytes: mockSiteMb[site] * MB }),
      }
    }
    return { exists: () => false, data: () => ({}) }
  },
}))

import BillingUsageComponent from '../components/billing/billing-usage.component'

beforeEach(() => {
  mockFetched.length = 0
  mockSiteMb = {}
  mockStorageAnswer = null
  global.fetch = jest.fn(async (input: any) => {
    const url = String(input)
    mockFetched.push(url)
    if (url.startsWith('/api/media/storage')) {
      return mockStorageAnswer
        ? { ok: true, json: async () => mockStorageAnswer }
        : { ok: false, status: 403, json: async () => ({}) }
    }
    if (url.startsWith('/api/hosts/usage')) {
      return { ok: true, json: async () => ({ screens: 0 }) }
    }
    if (url.startsWith('/api/billing/host-usage')) {
      return { ok: true, json: async () => ({ monthPageViews: 0 }) }
    }
    return { ok: false, json: async () => ({}) }
  }) as any
})

/** The `<Stack>` holding one meter's label and its readout. */
const meterRow = (label: string) =>
  screen.getByText(label).parentElement as HTMLElement
const ORG_METER = 'Storage (organization)'
const siteShares = () => screen.queryAllByTestId('site-storage-share')

/**
 * Seeds a multi-site org whose pool is at 90% of its band while every site
 * stays under the per-site figure: each site at 60% of it, the library
 * holding the rest. Whole MB throughout, so every figure prints exactly.
 */
function seedNinetyPercentPool(org: any, hardBand: boolean) {
  const perSite = resolveOrgEntitlements(org).storagePerHostMb
  const band = pooledBandMb(org)
  const siteMb = Math.floor(perSite * 0.6)
  mockSiteMb = { 'host-a': siteMb, 'host-b': siteMb - 1, 'host-c': siteMb - 2 }
  const sitesMb = siteMb * 3 - 3
  const pooledMb = Math.ceil(band * 0.9)
  const libraryMb = pooledMb - sitesMb
  mockStorageAnswer = {
    allowanceMb: band,
    unlimited: false,
    usedBytes: pooledMb * MB,
    scopeBytes: libraryMb * MB,
    hardBand,
  }
  return { perSite, band, siteMb, pooledMb, libraryMb }
}

describe('the plans this spec reasons about exist', () => {
  it('has a metered multi-site plan, a hard-band plan and an uncapped org', () => {
    // Anti-vacuity: every case below is keyed on these.
    expect(METERED_MULTI_SITE).toBeDefined()
    expect(HARD_BAND).toBeDefined()
    expect(Number.isFinite(pooledBandMb(UNLIMITED_ORG))).toBe(false)
  })
})

describe('storage is one meter for the organization', () => {
  it('reads the pooled usage against the pooled band, once', async () => {
    const org = orgOn(METERED_MULTI_SITE)
    const { perSite, band, siteMb, pooledMb } = seedNinetyPercentPool(org, false)
    // Non-vacuous: every site is under the per-site figure (the old meter
    // said nothing) and the pool is past the warning point.
    expect(siteMb / perSite).toBeLessThan(0.8)
    expect(pooledMb / band).toBeGreaterThanOrEqual(0.8)

    render(<BillingUsageComponent org={org} hosts={HOSTS} />)
    await waitFor(() => {
      expect(meterRow(ORG_METER).textContent).toContain(
        `${pooledMb} / ${band} MB`,
      )
    })
    // The pool past 80% warns, as every Billing meter does.
    expect(meterRow(ORG_METER).textContent).toContain('Upgrade')
    // ONE row for the workspace, and ONE request for it however many sites.
    expect(screen.getAllByText(ORG_METER)).toHaveLength(1)
    expect(
      mockFetched.filter((url) => url.startsWith('/api/media/storage')),
    ).toEqual(['/api/media/storage?orgId=org-1'])
  })

  it('lists each site’s share as a figure, never "of" a cap', async () => {
    const org = orgOn(METERED_MULTI_SITE)
    const { perSite, siteMb } = seedNinetyPercentPool(org, false)
    render(<BillingUsageComponent org={org} hosts={HOSTS} />)
    await waitFor(() => {
      expect(siteShares().map((row) => row.textContent)).toEqual([
        `Storage on this site${siteMb} MB · counts toward the organization’s storage`,
        `Storage on this site${siteMb - 1} MB · counts toward the organization’s storage`,
        `Storage on this site${siteMb - 2} MB · counts toward the organization’s storage`,
      ])
    })
    for (const row of siteShares()) {
      expect(row.textContent).not.toContain(' / ')
      expect(row.textContent).not.toContain(`${perSite} MB`)
      expect(row.querySelector('[role="progressbar"]')).toBeNull()
    }
    // No per-site storage METER survives anywhere on the card.
    expect(screen.queryAllByText('Storage')).toHaveLength(0)
  })

  it('names the organization library’s share of the pool', async () => {
    const org = orgOn(METERED_MULTI_SITE)
    const { libraryMb } = seedNinetyPercentPool(org, false)
    render(<BillingUsageComponent org={org} hosts={HOSTS} />)
    await waitFor(() => {
      expect(
        screen.getByText(/share this one allowance/).textContent,
      ).toContain(
        `${formatMediaBytes(libraryMb * MB)} of it is in the organization library.`,
      )
    })
    // Non-vacuous: the library genuinely holds part of the pool.
    expect(libraryMb).toBeGreaterThan(0)
  })

  it('holds "not yet metered" against the invoice’s band when the route cannot answer', async () => {
    const org = orgOn(METERED_MULTI_SITE)
    seedNinetyPercentPool(org, false)
    mockStorageAnswer = null
    render(<BillingUsageComponent org={org} hosts={HOSTS} />)
    const bandMb = meteredIncludedAllowance(org).storageGb * 1024
    await waitFor(() => {
      expect(
        mockFetched.some((url) => url.startsWith('/api/media/storage')),
      ).toBe(true)
    })
    // A refused read is not an empty pool — and the sites' own counters, all
    // readable, are not summed into one either.
    expect(meterRow(ORG_METER).textContent).toContain(
      `not yet metered · limit ${bandMb} MB`,
    )
    expect(bandMb).toBe(pooledBandMb(org))
  })
})

describe('what happens at the band follows the plan', () => {
  it('a metered plan is told the extra bills, never that uploads stop', async () => {
    const org = orgOn(METERED_MULTI_SITE)
    seedNinetyPercentPool(org, false)
    render(<BillingUsageComponent org={org} hosts={HOSTS} />)
    const caption = await screen.findByText(/share this one allowance/)
    expect(caption.textContent).toContain(
      'Past it, extra storage is billed on your invoice unless you set a storage cap.',
    )
    expect(caption.textContent).not.toMatch(/stop/i)
  })

  it('a metered plan whose library is not billed yet is told the library stops', async () => {
    // The route's `hardBand` for the org scope: metered plan, but the
    // library's storage is not on the invoice yet, so the gate refuses it.
    const org = orgOn(METERED_MULTI_SITE)
    seedNinetyPercentPool(org, true)
    render(<BillingUsageComponent org={org} hosts={HOSTS} />)
    await waitFor(() => {
      expect(screen.getByText(/share this one allowance/).textContent).toContain(
        'Uploads to the organization library stop at it for now',
      )
    })
    expect(screen.getByText(/share this one allowance/).textContent).toContain(
      'extra storage is billed',
    )
  })

  it('a hard-band plan is told uploads stop, and nothing about a bill', async () => {
    const org = orgOn(HARD_BAND)
    const band = pooledBandMb(org)
    mockSiteMb = { 'host-a': 1 }
    mockStorageAnswer = {
      allowanceMb: band,
      unlimited: false,
      usedBytes: 1 * MB,
      scopeBytes: 0,
      hardBand: true,
    }
    render(<BillingUsageComponent org={org} hosts={[HOSTS[0]]} />)
    await waitFor(() => {
      expect(meterRow(ORG_METER).textContent).toContain(`1 / ${band} MB`)
    })
    const caption = screen.getByText(/share this one allowance/)
    expect(caption.textContent).toContain(
      'Uploads stop when your workspace reaches it',
    )
    expect(caption.textContent).not.toMatch(/bill/i)
  })

  it('an unlimited band reads "Unlimited", with no invented figure', async () => {
    const org = UNLIMITED_ORG
    mockSiteMb = { 'host-a': 5 }
    // The route reads nothing for an unlimited band and says so.
    mockStorageAnswer = {
      allowanceMb: null,
      unlimited: true,
      usedBytes: 0,
      scopeBytes: 0,
      hardBand: false,
    }
    render(<BillingUsageComponent org={org} hosts={[HOSTS[0]]} />)
    await waitFor(() => {
      expect(meterRow(ORG_METER).textContent).toBe(
        'Storage (organization)Unlimited',
      )
    })
    const caption = screen.getByText(/share this one allowance/)
    expect(caption.textContent).not.toMatch(/stop|bill/i)
    // The site's own figure still lists, as a share.
    await waitFor(() => {
      expect(siteShares()[0]?.textContent).toContain('5 MB')
    })
  })
})

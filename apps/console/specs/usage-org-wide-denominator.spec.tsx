/**
 * @jest-environment jsdom
 *
 * Pragma must stay in the FIRST block comment — behind the license header it
 * is silently ignored.
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
 * One org, one denominator (AGL-1371).
 *
 * `bandwidthGb` and `totalSiteSizeMb` are ORG-wide limits. Three surfaces
 * measured against them and they had drifted into measuring different things:
 *
 * | surface | numerator (before) |
 * | -- | -- |
 * | the invoice (`report-usage` → `estimateMonthlyUsageCost`) | org-wide sum |
 * | the warning email (`usage-alerts`) | org-wide sum |
 * | the console meter (`billing-usage.component`) | **ONE host** |
 *
 * The invoice is the authority, so the meter was the bug. On a 3-site Pro org
 * the meter read 45.8% of the bandwidth band while the cron emailed at 91.6%
 * and the invoice priced from 91.6% — the surface that sets expectations
 * understating, the surface that charges not.
 *
 * The fixture is deliberately MULTI-SITE with UNEQUAL sites, because a
 * single-site org cannot tell the two readings apart — which is exactly how
 * three implementations of the same fraction went unnoticed. Every figure
 * asserted here differs between the per-host and the org-wide reading.
 *
 * AGL-1370 then deleted the site-size row entirely — `totalSiteSizeMb` is
 * unreachable on every plan, so the meter could only read near zero. The
 * fixture still serves the rollup field, and the site-size case now asserts
 * that nothing renders it.
 */

import { render, screen, waitFor } from '@testing-library/react'
import {
  bandwidthGbFromPageViews,
  estimateMonthlyUsageCost,
  orgBandwidthGb,
  pageViewsFromBandwidthGb,
} from '../utils/usage-metering'
import { resolveOrgEntitlements } from '@aglyn/aglyn'

/**
 * Pro: `hostLimit: 3`, `bandwidthGb: 250`, `totalSiteSizeMb: 5120`.
 * Three sites, unequal, and none of them is the total.
 */
const ORG = { $id: 'org-1', plan: 'pro' } as any
const HOSTS = [
  { $id: 'host-a', displayName: 'Site A' },
  { $id: 'host-b', displayName: 'Site B' },
  { $id: 'host-c', displayName: 'Site C' },
]
const PAGE_VIEWS: Record<string, number> = {
  'host-a': 200_000,
  'host-b': 120_000,
  'host-c': 80_000,
}
const TOTAL_PAGE_VIEWS = 400_000
/** Org-wide site size, as `report-usage` wrote it onto the monthly rollup. */
const ROLLUP_SITE_SIZE_MB = 4_300
const ROLLUP_DATA_STORAGE_MB = 12.5

/** 400,000 × 600 KB ÷ 1 GB = 228.88 GB — vs 114.44 for the largest site. */
const EXPECTED_ORG_GB = '228.88'
const LARGEST_HOST_GB = '114.44'

const mockFetchSeatCounts = jest.fn(async () => ({
  managerSeats: 2,
  collaboratorSeats: 0,
}))
jest.mock('../utils/fetch-seat-counts', () => ({
  __esModule: true,
  default: (...args: unknown[]) => mockFetchSeatCounts(...(args as [])),
}))

jest.mock('@aglyn/tenant-feature-instance', () => ({
  __esModule: true,
  useFirestore: () => ({}),
  useUser: () => ({ data: { uid: 'u1', getIdToken: async () => 'tok' } }),
}))

jest.mock('firebase/firestore', () => ({
  __esModule: true,
  doc: (_db: unknown, ...segments: string[]) => ({
    path: segments.join('/'),
  }),
  collection: (_db: unknown, ...segments: string[]) => ({
    path: segments.join('/'),
  }),
  getCountFromServer: async () => ({ data: () => ({ count: 0 }) }),
  getDoc: async (ref: { path: string }) => {
    // The monthly rollup. `siteSizeMb` is still written by report-usage as an
    // internal signal, and is deliberately still served here so the "no site
    // size row" assertion below cannot pass for want of data.
    if (/^orgs\/org-1\/usage\//.test(ref.path)) {
      return {
        exists: () => true,
        data: () => ({
          siteSizeMb: ROLLUP_SITE_SIZE_MB,
          dataStorageMb: ROLLUP_DATA_STORAGE_MB,
        }),
      }
    }
    return { exists: () => false, data: () => ({}) }
  },
}))

import BillingUsageComponent from '../components/billing/billing-usage.component'

beforeEach(() => {
  global.fetch = jest.fn(async (input: any) => {
    const url = String(input)
    const hostId = new URL(url, 'https://console.test').searchParams.get(
      'hostId',
    )
    if (url.startsWith('/api/billing/host-usage')) {
      const monthPageViews = PAGE_VIEWS[hostId ?? ''] ?? 0
      return {
        ok: true,
        json: async () => ({
          monthPageViews,
          bandwidthGb: bandwidthGbFromPageViews(monthPageViews),
        }),
      }
    }
    if (url.startsWith('/api/hosts/usage')) {
      return { ok: true, json: async () => ({ screens: 4 }) }
    }
    return { ok: false, json: async () => ({}) }
  }) as any
})

/** The `<Stack>` holding one meter's label and its `used / limit` readout. */
function meterRow(label: string): HTMLElement {
  return screen.getByText(label).parentElement as HTMLElement
}

describe('the console meter measures the org, like the invoice does', () => {
  it('renders ONE bandwidth row, at the org-wide fraction of the band', async () => {
    render(<BillingUsageComponent org={ORG} hosts={HOSTS} />)

    const label = 'Bandwidth (this month, organization)'
    await waitFor(() => {
      expect(meterRow(label).textContent).toContain(EXPECTED_ORG_GB)
    })

    // One row for the org, not one per site. Three sites rendering three
    // bandwidth meters against one org-wide band is the shape of the bug.
    expect(screen.getAllByText(label)).toHaveLength(1)
    expect(screen.queryAllByText(/^Bandwidth/)).toHaveLength(1)

    const row = meterRow(label)
    expect(row.textContent).toContain(`${EXPECTED_ORG_GB} / 250 GB`)
    // The old reading, explicitly excluded: the largest single site's share.
    expect(row.textContent).not.toContain(LARGEST_HOST_GB)

    // 228.88 / 250 = 91.6% — past the 80% mark, so the meter warns and offers
    // the upgrade. At the per-host reading it was 45.8% and said nothing,
    // while the cron emailed the 80% warning off the org-wide figure. The
    // customer got the email and saw a meter at under half.
    expect(row.textContent).toContain('Upgrade')
  })

  it('renders NO site size row, even with the rollup field present', async () => {
    render(<BillingUsageComponent org={ORG} hosts={HOSTS} />)

    // Wait for the meters that do render, so this is not just asserting
    // against an unmounted tree.
    await waitFor(() => {
      expect(
        meterRow('Bandwidth (this month, organization)').textContent,
      ).toContain(EXPECTED_ORG_GB)
    })

    // AGL-1370 removed the row. The fixture still serves
    // `siteSizeMb: ${ROLLUP_SITE_SIZE_MB}` on the rollup — 84% of Pro's
    // 5120 MB cap, which under the old code rendered a meter in its warning
    // state — so nothing here passes for want of data.
    expect(screen.queryAllByText(/site size/i)).toHaveLength(0)
    expect(
      screen.queryAllByText(String(ROLLUP_SITE_SIZE_MB), { exact: false }),
    ).toHaveLength(0)
  })
})

describe('the meter, the cron and the invoice compute one figure', () => {
  const entitlements = resolveOrgEntitlements(ORG)
  /** What the meter sums, from the per-site `host-usage` readings. */
  const meterGb = orgBandwidthGb(HOSTS.map((host) => PAGE_VIEWS[host.$id]))
  /** What the cron sums: the same page views, over the same sites. */
  const cronGb = bandwidthGbFromPageViews(TOTAL_PAGE_VIEWS)
  /** What the invoice prices: the same page views against the same band. */
  const estimate = estimateMonthlyUsageCost(
    HOSTS.map((host) => ({
      storageBytes: 0,
      pageViews: PAGE_VIEWS[host.$id],
      formSubmissions: 0,
    })),
    ORG,
  )

  it('agrees on the numerator', () => {
    expect(meterGb).toBe(cronGb)
    expect(estimate.pageViews).toBe(TOTAL_PAGE_VIEWS)
    expect(bandwidthGbFromPageViews(estimate.pageViews)).toBe(meterGb)
  })

  it('agrees on the denominator', () => {
    // `bandwidthGb` is an ORG-wide band — the one entitlement in
    // `meteredIncludedAllowance` that is NOT multiplied by `hostLimit`. That
    // asymmetry is the whole bug: storage and form submissions expand per
    // site, bandwidth does not, and the meter treated it as if it did.
    expect(entitlements.bandwidthGb).toBe(250)
    expect(estimate.included.pageViews).toBe(pageViewsFromBandwidthGb(250))
    expect(estimate.included.pageViews).not.toBe(
      pageViewsFromBandwidthGb(250 * entitlements.hostLimit),
    )
  })

  it('agrees on the fraction, which is what all three surfaces show', () => {
    const meterFraction = meterGb / entitlements.bandwidthGb
    const cronFraction = cronGb / entitlements.bandwidthGb
    const invoiceFraction = estimate.pageViews / estimate.included.pageViews
    expect(meterFraction).toBeCloseTo(cronFraction, 12)
    expect(meterFraction).toBeCloseTo(invoiceFraction, 12)
    expect(meterFraction).toBeCloseTo(0.9155, 4)

    // Non-vacuous: the per-host reading the meter used to show is a
    // different number, and lands on the other side of the 80% threshold the
    // cron emails on — so this could not pass against the old code.
    const perHostFraction =
      bandwidthGbFromPageViews(PAGE_VIEWS['host-a']) / entitlements.bandwidthGb
    expect(perHostFraction).not.toBeCloseTo(invoiceFraction, 4)
    expect(perHostFraction).toBeLessThan(0.8)
    expect(invoiceFraction).toBeGreaterThan(0.8)
  })

  it('is a real multi-site org — no single site equals the total', () => {
    for (const host of HOSTS) {
      expect(PAGE_VIEWS[host.$id]).toBeLessThan(TOTAL_PAGE_VIEWS)
      expect(PAGE_VIEWS[host.$id]).toBeGreaterThan(0)
    }
    expect(HOSTS.length).toBeGreaterThan(1)
    expect(HOSTS.length).toBeLessThanOrEqual(entitlements.hostLimit)
  })
})

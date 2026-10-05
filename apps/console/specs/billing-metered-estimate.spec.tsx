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
 * The Billing card's metered estimate agrees with the invoice (AGL-1473's
 * console half).
 *
 * The rollup gained the org LIBRARY's stored bytes in AGL-1473 — an org DAM
 * upload moves `orgs/{id}/counters/media`, not any host's counter — but the
 * console card kept summing HOST counters only. The moment
 * `BILL_ORG_LIBRARY_STORAGE_FROM` names a month, the surface that sets
 * expectations understates the surface that charges: the precise bill
 * surprise the card exists to prevent.
 *
 * Three contracts pinned here:
 *
 *  1. ORG-LIBRARY BYTES REACH THE CARD — as one extra snapshot, the same
 *     shape the rollup uses, so the usage figures are the truth whether or
 *     not the billing switch is set.
 *  2. ONE ESTIMATOR — the rendered dollars are `estimateMonthlyUsageCost`'s
 *     output over the same counters the rollup reads. The expected figures
 *     below are COMPUTED through that function, never re-derived by hand, so
 *     any second formula in the component diverges from the spec exactly as
 *     it would diverge from the invoice.
 *  3. A LOADING STATE IS NOT AN ANSWER — until the counters AND the billing
 *     switch are known, the card says "Calculating…", never "$0.00"
 *     (`feedback_loading_default_answers_a_question`).
 */

import { render, screen, waitFor } from '@testing-library/react'
import {
  PLAN_ENTITLEMENTS,
  resolveOrgEntitlements,
} from '@aglyn/aglyn/app-utils/plan-entitlements'
import {
  estimateMonthlyUsageCost,
  meteredIncludedAllowance,
  METERED_BILLED_RATES_USD,
  METERED_MARKUP,
  METERED_UNIT_RATES_USD,
  type HostUsageSnapshot,
} from '../utils/usage-metering'

const GB = 1024 * 1024 * 1024
const MONTH = new Date().toISOString().slice(0, 7)

/** `counters/*` and analytics fixtures, keyed by Firestore path. */
let mockCounters: Record<string, Record<string, unknown>>
let mockMonthViews: Record<string, number>
/** When true, the ORG counter read is denied (a rules failure, not a 0). */
let mockOrgCounterDenied: boolean

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
  documentId: () => '__name__',
  where: () => ({}),
  query: (ref: { path: string }) => ref,
  getDoc: async (ref: { path: string }) => {
    if (mockOrgCounterDenied && ref.path.startsWith('orgs/')) {
      throw new Error('permission-denied')
    }
    const data = mockCounters[ref.path]
    return {
      exists: () => Boolean(data),
      get: (field: string) => data?.[field],
      data: () => data,
    }
  },
  getDocs: async (ref: { path: string }) => {
    const hostId = ref.path.split('/')[1]
    const total = mockMonthViews[hostId] ?? 0
    return {
      docs: total
        ? [{ get: (field: string) => (field === 'total' ? total : undefined) }]
        : [],
    }
  },
}))

import BillingMeteredEstimateComponent from '../components/billing/billing-metered-estimate.component'

/** Starter: 1 site × 2048 MB = a 2 GB org-wide storage band, metered. */
const ORG = { $id: 'org-1', plan: 'starter' } as any
const HOSTS = [{ $id: 'host-a', displayName: 'Site A' }]

interface Seed {
  hostMediaBytes?: number
  hostFormSubmissions?: number
  hostMonthViews?: number
  orgLibraryBytes?: number
}

function seed(options: Seed) {
  mockOrgCounterDenied = false
  mockCounters = {
    'hosts/host-a/counters/media': { bytes: options.hostMediaBytes ?? 0 },
    'hosts/host-a/counters/formSubmissions': {
      [MONTH]: options.hostFormSubmissions ?? 0,
    },
  }
  if (options.orgLibraryBytes != null) {
    mockCounters['orgs/org-1/counters/media'] = {
      bytes: options.orgLibraryBytes,
    }
  }
  mockMonthViews = { 'host-a': options.hostMonthViews ?? 0 }
}

/**
 * What the ROLLUP would price for the same seed — the org library as one
 * extra snapshot (`report-usage`'s exact shape). Every dollar assertion in
 * this file renders through this, so the spec cannot agree with a component
 * that computes its own arithmetic.
 */
function invoiceEstimate(options: Seed, withLibrary: boolean) {
  const hosts: HostUsageSnapshot[] = [
    {
      storageBytes: options.hostMediaBytes ?? 0,
      pageViews: options.hostMonthViews ?? 0,
      meters: { formSubmissions: options.hostFormSubmissions ?? 0 },
    },
  ]
  const orgLibrary: HostUsageSnapshot = {
    storageBytes: options.orgLibraryBytes ?? 0,
    pageViews: 0,
  }
  return estimateMonthlyUsageCost(
    withLibrary ? [...hosts, orgLibrary] : hosts,
    ORG,
  )
}

const dollars = (estimate: { billedCents: number }) =>
  `$${(estimate.billedCents / 100).toFixed(2)}`

/** The usage-config endpoint, controllable per test. */
function mockUsageConfig(
  behavior:
    | { orgLibraryBilledFrom: string | null }
    | 'failure'
    | 'never-resolves',
) {
  global.fetch = jest.fn(async (input: any) => {
    const url = String(input)
    if (!url.startsWith('/api/billing/usage-config')) {
      return { ok: false, json: async () => ({}) }
    }
    if (behavior === 'never-resolves') {
      return new Promise(() => undefined)
    }
    if (behavior === 'failure') {
      throw new Error('network down')
    }
    return { ok: true, json: async () => behavior }
  }) as any
}

afterEach(() => {
  jest.restoreAllMocks()
})

describe('org-library bytes reach the card (the AGL-1473 console half)', () => {
  /**
   * Host exactly at the 2 GB band, plus 1 GB in the org library. A host-only
   * sum reads "at the band, $0.00" — the understatement. The invoice, with
   * the switch on, prices 1 GB of overage.
   */
  const OVER_VIA_LIBRARY: Seed = {
    hostMediaBytes: 2 * GB,
    orgLibraryBytes: 1 * GB,
  }

  it('prices the month the way the invoice will once the switch covers it', async () => {
    mockUsageConfig({ orgLibraryBilledFrom: MONTH })
    seed(OVER_VIA_LIBRARY)
    const billed = invoiceEstimate(OVER_VIA_LIBRARY, true)
    // Non-vacuous: the library pushes the org past the band, so a host-only
    // sum shows a different (smaller) figure.
    expect(billed.billedCents).toBeGreaterThan(0)
    expect(invoiceEstimate(OVER_VIA_LIBRARY, false).billedCents).toBe(0)

    render(<BillingMeteredEstimateComponent org={ORG} hosts={HOSTS} />)
    await waitFor(() => {
      expect(screen.getByText(dollars(billed))).toBeTruthy()
    })
  })

  it('shows the TRUE storage figure even while the switch is off', async () => {
    // The usage line is the truth — 3 GB stored is 3 GB stored, whether or
    // not this month's invoice prices the library's share.
    mockUsageConfig({ orgLibraryBilledFrom: null })
    seed(OVER_VIA_LIBRARY)
    render(<BillingMeteredEstimateComponent org={ORG} hosts={HOSTS} />)
    await waitFor(() => {
      expect(screen.getByText(/3\.00 of 2\.00 GB/)).toBeTruthy()
    })
    // …and the DOLLARS match the invoice, which excludes the library until
    // the switch names a month — with a caption saying exactly that, so the
    // gap between "over the band" and "$0.00" is explained, not confusing.
    expect(screen.getByText('$0.00')).toBeTruthy()
    expect(screen.getByText(/measured but not yet billed/i)).toBeTruthy()
  })

  it('never publishes a low number when the org counter read fails', async () => {
    // The billing-usage posture: a partial sum is the same defect in a
    // smaller size. A denied org-counter read must hold the loading state
    // rather than render a host-only figure as if it were the answer.
    mockUsageConfig({ orgLibraryBilledFrom: MONTH })
    seed(OVER_VIA_LIBRARY)
    mockOrgCounterDenied = true
    render(<BillingMeteredEstimateComponent org={ORG} hosts={HOSTS} />)
    // Give the pipeline a beat to resolve everything it is going to resolve.
    await waitFor(() => {
      expect(screen.getByText('Calculating…')).toBeTruthy()
    })
    expect(screen.queryByText('$0.00')).toBeNull()
  })
})

/**
 * The org library has no allowance of its own (AGL-3479).
 *
 * Since AGL-2075 ingress measures every site's library and the org's against
 * ONE band — `resolveOrgMediaBand`, `hostLimit × storagePerHostMb`, the same
 * arithmetic `meteredIncludedAllowance` sizes the invoice's allowance with.
 * The caption used to state the library's bytes "of" the per-site figure and
 * promise that uploads there stop at it: a cap ingress does not enforce, and
 * on a metered plan a stop that does not happen, because past the band the
 * upload is accepted and billed.
 *
 * No plan figure is written here: the multi-site plan is found in
 * `PLAN_ENTITLEMENTS`, and every band is read through
 * `meteredIncludedAllowance`.
 */
describe('the org library shares the workspace allowance (AGL-3479)', () => {
  /** The library caption, wherever it renders. */
  const libraryCaption = () =>
    screen.getByText(/in your organization library/i).textContent ?? ''

  it('names the library as a share of the one allowance, on a metered plan', async () => {
    mockUsageConfig({ orgLibraryBilledFrom: MONTH })
    seed({ hostMediaBytes: 1 * GB, orgLibraryBytes: Math.round(0.5 * GB) })
    render(<BillingMeteredEstimateComponent org={ORG} hosts={HOSTS} />)
    await waitFor(() => {
      expect(libraryCaption()).toBe(
        'Includes 0.50 GB in your organization library, which shares this ' +
          'allowance with your sites.',
      )
    })
    // Metered: past the band an upload bills, so nothing may say it stops —
    // and the library's bytes are written "of" nothing.
    expect(meteredIncludedAllowance(ORG).metered).toBe(true)
    expect(libraryCaption()).not.toMatch(/stop/i)
    expect(libraryCaption()).not.toMatch(/own allowance/i)
    expect(libraryCaption()).not.toMatch(/ of /)
  })

  it('says uploads into it stop only while its storage is not billed', async () => {
    // `scopeBillsStorageOverage('orgs')` is false until the switch names a
    // month, and the gate then refuses org-library bytes past the band — no
    // price to attach. Said, because it is the one metered-plan stop.
    mockUsageConfig({ orgLibraryBilledFrom: null })
    seed({ hostMediaBytes: 1 * GB, orgLibraryBytes: Math.round(0.5 * GB) })
    render(<BillingMeteredEstimateComponent org={ORG} hosts={HOSTS} />)
    await waitFor(() => {
      expect(libraryCaption()).toMatch(/measured but not yet billed/i)
    })
    expect(libraryCaption()).toMatch(/uploads into it stop at the allowance/i)
  })

  it('on Free, says uploads stop when the WORKSPACE reaches the allowance', async () => {
    const freeOrg = { $id: 'org-1', plan: 'free' } as any
    expect(meteredIncludedAllowance(freeOrg).metered).toBe(false)
    mockUsageConfig({ orgLibraryBilledFrom: MONTH })
    seed({ orgLibraryBytes: Math.round(0.1 * GB) })
    render(<BillingMeteredEstimateComponent org={freeOrg} hosts={HOSTS} />)
    await waitFor(() => {
      expect(libraryCaption()).toMatch(
        /shares this allowance with your sites\. New uploads stop when your workspace reaches it\.$/,
      )
    })
    expect(libraryCaption()).not.toMatch(/bill/i)
  })

  it('reads every site and the library against the pooled band on a multi-site plan', async () => {
    // A metered plan with room for more than one site, from the plan table.
    const plan = (Object.keys(PLAN_ENTITLEMENTS) as Array<keyof typeof PLAN_ENTITLEMENTS>).find(
      (key) => {
        const org = { $id: 'org-1', plan: key } as any
        const included = meteredIncludedAllowance(org)
        return (
          resolveOrgEntitlements(org).hostLimit > 1 &&
          included.metered &&
          Number.isFinite(included.storageGb)
        )
      },
    )
    expect(plan).toBeDefined()
    const org = { $id: 'org-1', plan } as any
    const included = meteredIncludedAllowance(org)
    const perSiteGb = resolveOrgEntitlements(org).storagePerHostMb / 1024
    // Non-vacuous: the pooled band is not the per-site figure.
    expect(included.storageGb).toBeGreaterThan(perSiteGb)

    mockUsageConfig({ orgLibraryBilledFrom: MONTH })
    seed({ hostMediaBytes: Math.round(0.25 * GB), orgLibraryBytes: Math.round(0.5 * GB) })
    mockCounters['hosts/host-b/counters/media'] = { bytes: Math.round(0.75 * GB) }
    const hosts = [...HOSTS, { $id: 'host-b', displayName: 'Site B' }]
    render(<BillingMeteredEstimateComponent org={org} hosts={hosts} />)
    // 0.25 + 0.75 across the sites, 0.50 in the library: one pool.
    await waitFor(() => {
      expect(
        screen.getByText(
          `Storage: 1.50 of ${included.storageGb.toFixed(2)} GB`,
          { exact: false },
        ),
      ).toBeTruthy()
    })
    expect(libraryCaption()).not.toContain(perSiteGb.toFixed(2))
  })
})

describe('one estimator — the card renders what estimateMonthlyUsageCost says', () => {
  it('agrees with the shared function on a messy, nothing-round month', async () => {
    // Deliberately awkward numbers: any hand-rolled second formula in the
    // component (a re-derived rate, a float rounded at a different step)
    // lands on different cents than the shared function and fails here.
    const messy: Seed = {
      hostMediaBytes: Math.round(2.37 * GB),
      hostMonthViews: 123_456,
      hostFormSubmissions: 641,
      orgLibraryBytes: Math.round(1.19 * GB),
    }
    mockUsageConfig({ orgLibraryBilledFrom: MONTH })
    seed(messy)
    const billed = invoiceEstimate(messy, true)
    expect(billed.billedCents).toBeGreaterThan(0)
    render(<BillingMeteredEstimateComponent org={ORG} hosts={HOSTS} />)
    await waitFor(() => {
      expect(screen.getByText(dollars(billed))).toBeTruthy()
    })
  })
})

describe('band boundaries (the boundary belongs to the customer)', () => {
  const included = meteredIncludedAllowance(ORG)

  it('usage exactly AT every band is $0.00, said proudly', async () => {
    const atBand: Seed = {
      hostMediaBytes: included.storageGb * GB,
      hostMonthViews: Math.floor(included.pageViews),
      hostFormSubmissions: included.meters.formSubmissions,
    }
    mockUsageConfig({ orgLibraryBilledFrom: MONTH })
    seed(atBand)
    render(<BillingMeteredEstimateComponent org={ORG} hosts={HOSTS} />)
    await waitFor(() => {
      expect(screen.getByText('$0.00')).toBeTruthy()
    })
    // Reassurance is the feature: most orgs live here.
    expect(screen.getByText(/no metered charges this period/i)).toBeTruthy()
    // Nothing is flagged as billable at the boundary.
    expect(screen.queryByText(/billable/)).toBeNull()
  })

  it('one GB over the band prices exactly the marginal rate', async () => {
    const oneOver: Seed = {
      hostMediaBytes: (included.storageGb + 1) * GB,
    }
    mockUsageConfig({ orgLibraryBilledFrom: MONTH })
    seed(oneOver)
    const billed = invoiceEstimate(oneOver, true)
    // 1 GB × $0.026 × 1.30 = 3.38¢ → 3¢. Pinned via the shared function AND
    // as a literal, so a rate change is loud here as well as in the unit
    // spec.
    expect(billed.billedCents).toBe(3)
    render(<BillingMeteredEstimateComponent org={ORG} hosts={HOSTS} />)
    await waitFor(() => {
      expect(screen.getByText('$0.03')).toBeTruthy()
    })
    // The excess — and only the excess — is called out as billable.
    expect(screen.getByText(/1\.00 GB billable/)).toBeTruthy()
  })
})

describe('a loading state is not an answer', () => {
  it('says Calculating — never $0.00 — until the billing switch is known', async () => {
    mockUsageConfig('never-resolves')
    seed({ hostMediaBytes: 1 * GB, orgLibraryBytes: 1 * GB })
    render(<BillingMeteredEstimateComponent org={ORG} hosts={HOSTS} />)
    await waitFor(() => {
      expect(screen.getByText('Calculating…')).toBeTruthy()
    })
    expect(screen.queryByText(/\$\d/)).toBeNull()
  })

  it('on a config failure it fails HIGH, never understating the invoice', async () => {
    // The server evaluates the real env var; a failed fetch means the card
    // cannot know whether the library bills. The one direction the card must
    // never be wrong in is LOW — so it includes the library and overstates
    // at worst.
    const overViaLibrary: Seed = {
      hostMediaBytes: 2 * GB,
      orgLibraryBytes: 1 * GB,
    }
    mockUsageConfig('failure')
    seed(overViaLibrary)
    const conservative = invoiceEstimate(overViaLibrary, true)
    expect(conservative.billedCents).toBeGreaterThan(0)
    render(<BillingMeteredEstimateComponent org={ORG} hosts={HOSTS} />)
    await waitFor(() => {
      expect(screen.getByText(dollars(conservative))).toBeTruthy()
    })
  })
})

/**
 * THE RATE AND THE CHARGE, PER DIMENSION.
 *
 * The card told a customer how much of each band they had spent and what the
 * whole month came to, and never once what a unit past the band costs. So the
 * only way to learn the price of a GB was to go over and read the difference
 * in the total — the learn-your-cap-by-refusal shape, with money.
 *
 * Two properties, and the second is the one that could go quietly wrong:
 *
 *  1. The published rate is the one that is CHARGED — our cost + 30% kept
 *     after the card fee, rounded up (AGL-3476) — not the cost table. Printing
 *     the input would be quoting a number no invoice uses.
 *  2. The per-dimension charges are the same three products `billedCents` is
 *     rounded from. They are asserted to SUM to it, so a second cost model in
 *     the component (or in the split) diverges here exactly as it would
 *     diverge from the invoice.
 */
describe('each metered dimension names its overage rate', () => {
  const included = meteredIncludedAllowance(ORG)

  it('quotes the CHARGED rate, not our unit cost', async () => {
    mockUsageConfig({ orgLibraryBilledFrom: MONTH })
    seed({ hostMediaBytes: 1 * GB })
    render(<BillingMeteredEstimateComponent org={ORG} hosts={HOSTS} />)
    // $0.026 × 1.3 ÷ 0.971, rounded up, is $0.0349. Both halves asserted: the
    // charged rate is present, and the raw cost — which differs only in the
    // third decimal — is not, so a component that printed
    // `METERED_UNIT_RATES_USD` fails.
    await waitFor(() => {
      expect(screen.getByText(/\$0\.0349\/GB-month/)).toBeTruthy()
    })
    expect(METERED_BILLED_RATES_USD.storagePerGbMonth * 0.971).toBeGreaterThanOrEqual(
      METERED_UNIT_RATES_USD.storagePerGbMonth * METERED_MARKUP,
    )
    expect(screen.queryByText(/\$0\.026\/GB-month/)).toBeNull()
  })

  it('quotes page views and form submissions PER 1,000', async () => {
    // Per unit these are $0.00083 and $0.000083, which read as zero at any
    // precision a customer would trust — the reason the unit is 1,000 here
    // and a GB-month for storage.
    //
    // The page-view figure is also where `rateText` earns its trailing-zero
    // strip, and its floor at the cent: $0.83 per 1,000 renders as $0.83,
    // never $0.8300, and the form figure keeps its third place as $0.083.
    mockUsageConfig({ orgLibraryBilledFrom: MONTH })
    seed({ hostMonthViews: 10, hostFormSubmissions: 3 })
    render(<BillingMeteredEstimateComponent org={ORG} hosts={HOSTS} />)
    await waitFor(() => {
      expect(screen.getByText(/\$0\.83 per 1,000/)).toBeTruthy()
    })
    expect(screen.queryByText(/\$0\.80 per 1,000/)).toBeNull()
    expect(screen.queryByText(/\$0\.8300 per 1,000/)).toBeNull()
    expect(screen.getByText(/\$0\.083 per 1,000/)).toBeTruthy()
    // The forms plugin's band is drawn under the label it declares, and named
    // in the caption among the meters, in the order the card bills them.
    expect(screen.getByText(/^Form submissions: 3 of [\d,]+$/)).toBeTruthy()
    expect(
      screen.getByText(
        /included storage, bandwidth and form submissions is metered/,
      ),
    ).toBeTruthy()
  })

  it('shows the rate while still INSIDE the band', async () => {
    // The question a customer asks about a meter they are not over is "what
    // happens if I go over". Nothing is billable here, so nothing may be
    // called billable — but the price is still printed.
    mockUsageConfig({ orgLibraryBilledFrom: MONTH })
    seed({ hostMediaBytes: Math.round(0.5 * GB) })
    render(<BillingMeteredEstimateComponent org={ORG} hosts={HOSTS} />)
    await waitFor(() => {
      expect(screen.getByText(/0\.50 of 2\.00 GB/)).toBeTruthy()
    })
    expect(screen.getByText(/\$0\.0349\/GB-month past the band/)).toBeTruthy()
    expect(screen.queryByText(/billable/)).toBeNull()
  })

  it('attributes the charge to the meter that caused it, and the three sum', async () => {
    const messy: Seed = {
      hostMediaBytes: Math.round(4.31 * GB),
      hostMonthViews: 999_999,
      hostFormSubmissions: 12_345,
    }
    mockUsageConfig({ orgLibraryBilledFrom: MONTH })
    seed(messy)
    const billed = invoiceEstimate(messy, true)
    const byMeter = billed.billableUsdByMeter

    // Every dimension is genuinely over, so this is not passing because two
    // of the three are zero.
    expect(byMeter.storage).toBeGreaterThan(0)
    expect(byMeter.pageViews).toBeGreaterThan(0)
    expect(byMeter['formSubmissions']).toBeGreaterThan(0)
    // THE INVARIANT: the split is the total, not a second opinion about it.
    const sum =
      byMeter.storage + byMeter.pageViews + byMeter['formSubmissions']!
    expect(Math.round(sum * 100)).toBe(billed.billedCents)

    render(<BillingMeteredEstimateComponent org={ORG} hosts={HOSTS} />)
    await waitFor(() => {
      expect(screen.getByText(dollars(billed))).toBeTruthy()
    })
    // Each row carries its own share, rendered from the same numbers.
    for (const share of [
      byMeter.storage,
      byMeter.pageViews,
      byMeter['formSubmissions']!,
    ]) {
      expect(
        screen.getByText(new RegExp(`≈ \\$${share.toFixed(2)}\\b`)),
      ).toBeTruthy()
    }
  })

  it('reports a sub-cent share as <$0.01, never as $0.00', async () => {
    // A dimension can genuinely contribute less than a cent while the month
    // still bills something, because `billedCents` rounds the SUM once.
    // "$0.00 billable" beside a non-zero total is the contradiction a
    // customer would correctly read as a broken number.
    const barelyOver: Seed = {
      hostMediaBytes: Math.round((included.storageGb + 5) * GB),
      hostFormSubmissions: included.meters.formSubmissions! + 1,
    }
    mockUsageConfig({ orgLibraryBilledFrom: MONTH })
    seed(barelyOver)
    const billed = invoiceEstimate(barelyOver, true)
    // One form submission over: $0.00005 × 1.30 = $0.000065.
    expect(billed.billableUsdByMeter['formSubmissions']).toBeGreaterThan(0)
    expect(billed.billableUsdByMeter['formSubmissions']).toBeLessThan(0.005)
    // …while the month as a whole bills real money, off the storage overage.
    expect(billed.billedCents).toBeGreaterThan(0)

    render(<BillingMeteredEstimateComponent org={ORG} hosts={HOSTS} />)
    await waitFor(() => {
      expect(screen.getByText(/1 billable at .* ≈ <\$0\.01/)).toBeTruthy()
    })
  })

  it('a plan with NO pass-through is quoted no rate at all', async () => {
    // Free has no subscription to hang a metered item on, so its bands are
    // hard caps. Quoting an overage rate there would advertise a charge that
    // cannot arise — the same reason Agency's contacts rate went null.
    const freeOrg = { $id: 'org-1', plan: 'free' } as any
    mockUsageConfig({ orgLibraryBilledFrom: MONTH })
    seed({ hostMediaBytes: 50 * GB, hostMonthViews: 5_000_000 })
    render(<BillingMeteredEstimateComponent org={freeOrg} hosts={HOSTS} />)
    await waitFor(() => {
      expect(
        screen.getByText(/included caps, not meters — no usage charges/i),
      ).toBeTruthy()
    })
    // Massively over every band, and still not one price on the card.
    expect(meteredIncludedAllowance(freeOrg).metered).toBe(false)
    expect(screen.queryByText(/per 1,000/)).toBeNull()
    expect(screen.queryByText(/GB-month/)).toBeNull()
    expect(screen.queryByText(/billable/)).toBeNull()
  })
})

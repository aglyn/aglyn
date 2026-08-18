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
  estimateMonthlyUsageCost,
  meteredIncludedAllowance,
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
      formSubmissions: options.hostFormSubmissions ?? 0,
    },
  ]
  const orgLibrary: HostUsageSnapshot = {
    storageBytes: options.orgLibraryBytes ?? 0,
    pageViews: 0,
    formSubmissions: 0,
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

  it('names the org library share AGAINST ITS OWN ALLOWANCE (AGL-1886)', async () => {
    // The split was legible from AGL-1473; the allowance is what AGL-1886
    // added, and it is a different number from the org-wide band in the row
    // above. Uploads are enforced PER SCOPE against `storagePerHostMb`, so
    // the org library refuses at ITS cap while the org-wide total is still a
    // fraction of the band the card otherwise shows. A customer told only the
    // second is refused at a third of the number they were given.
    mockUsageConfig({ orgLibraryBilledFrom: MONTH })
    seed({ hostMediaBytes: 1 * GB, orgLibraryBytes: Math.round(0.5 * GB) })
    render(<BillingMeteredEstimateComponent org={ORG} hosts={HOSTS} />)
    await waitFor(() => {
      expect(
        screen.getByText(/0\.50 of .* GB in your organization library/i),
      ).toBeTruthy()
    })
    // And it says what the allowance MEANS — that uploads stop there.
    expect(screen.getByText(/new uploads there stop at it/i)).toBeTruthy()
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
      hostFormSubmissions: included.formSubmissions,
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

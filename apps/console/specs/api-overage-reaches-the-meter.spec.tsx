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
 * API REQUESTS PAST THE BAND ARE PRICED WHERE THEY ARE COUNTED.
 *
 * `apiQuota.overageMonthlyUsd` is one of the five terms `report-usage` adds
 * into `billedCents`, so an org past its included requests is already being
 * invoiced. The meter beside it said only how many requests had been made —
 * the same shape the audience band had before AGL-890 gave it a caption, and
 * the same consequence: the first place a customer learns the price is the
 * invoice.
 *
 * ## The figure is READ, never re-derived
 *
 * `checkApiRequestQuota` owns the arithmetic — band subtraction, per-1,000
 * division, the rounding — and the cron calls the same function over the same
 * counter. A caption that multiplied a rate by a count itself would be a
 * second cost model, and the two would disagree in exactly the cents a
 * customer would write in about. Every expected figure below is computed
 * THROUGH that function, so a second formula in the component fails here as it
 * would fail against the invoice.
 *
 * ## Not every plan may be quoted a rate
 *
 * `extraApiRequestsUsdPer1k` is null wherever no API overage can be charged.
 * On Enterprise that is because the price is negotiated and the band is
 * `UNLIMITED` — the sentinel case, where `used - Infinity` is never positive
 * and quoting a rate would advertise a charge that cannot arise.
 */

import { render, screen, waitFor } from '@testing-library/react'
import {
  checkApiRequestQuota,
  resolveOrgEntitlements,
  UNLIMITED,
} from '@aglyn/aglyn'

/** `mock`-prefixed so the `jest.mock` factory below may close over it. */
const mockMonth = new Date().toISOString().slice(0, 7)
/** What `orgs/{id}/apiUsage/{month}.count` holds, or `'missing'`. */
let mockApiRequests: number | 'missing'

const mockUser = { uid: 'u1', getIdToken: async () => 'tok' }

jest.mock('../utils/fetch-seat-counts', () => ({
  __esModule: true,
  default: async () => ({ managerSeats: 1, collaboratorSeats: 0 }),
}))

jest.mock('@aglyn/tenant-feature-instance', () => ({
  __esModule: true,
  useFirestore: () => ({}),
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
    if (ref.path === `orgs/org-1/apiUsage/${mockMonth}`) {
      if (mockApiRequests === 'missing') {
        // Never settles: the counter read is still in flight, which is the
        // window a caption must not fill with a default.
        return new Promise(() => undefined)
      }
      return {
        exists: () => true,
        data: () => ({ count: mockApiRequests }),
      }
    }
    return { exists: () => false, data: () => ({}) }
  },
}))

import BillingUsageComponent from '../components/billing/billing-usage.component'

/** Business: `apiRequestsPerMonth: 100,000`, `extraApiRequestsUsdPer1k: 0.5`. */
const BUSINESS = { $id: 'org-1', plan: 'business' } as any
/** Pro: no API requests included at all, so there is no meter to caption. */
const PRO = { $id: 'org-1', plan: 'pro' } as any
/** Enterprise: `UNLIMITED` requests, and no published overage rate. */
const ENTERPRISE = { $id: 'org-1', plan: 'enterprise' } as any
const HOSTS = [{ $id: 'host-a', displayName: 'Site A' }]

const METER = 'API requests (this month)'

beforeEach(() => {
  mockApiRequests = 0
  global.fetch = jest.fn(async (input: any) => {
    const url = String(input)
    if (url.startsWith('/api/hosts/usage')) {
      return { ok: true, json: async () => ({ screens: 0 }) }
    }
    return { ok: false, json: async () => ({}) }
  }) as any
})

describe('the fixture is a plan that really is charged for overage', () => {
  it('Business includes a band and publishes a rate', () => {
    const quota = checkApiRequestQuota(BUSINESS, 137_500)
    expect(quota.included).toBe(100_000)
    expect(quota.overageRequests).toBe(37_500)
    expect(quota.overageRateUsd).toBe(0.5)
    // 37.5 thousand × $0.50 = $18.75, the figure the cron adds to billedCents.
    expect(quota.overageMonthlyUsd).toBe(18.75)
  })
})

describe('a workspace over the band is told the price', () => {
  it('names the excess, the rate and the estimated charge', async () => {
    mockApiRequests = 137_500
    const quota = checkApiRequestQuota(BUSINESS, 137_500)
    render(<BillingUsageComponent org={BUSINESS} hosts={HOSTS} />)

    await waitFor(() => {
      expect(
        screen.getByText(new RegExp('API overage: 37,500 requests')),
      ).toBeTruthy()
    })
    // Both numbers come from the quota helper, not from this file's
    // arithmetic — the same call the invoice makes.
    expect(
      screen.getByText(
        new RegExp(`\\$${quota.overageRateUsd?.toFixed(2)}/1,000`),
      ),
    ).toBeTruthy()
    expect(
      screen.getByText(
        new RegExp(`≈\\$${quota.overageMonthlyUsd.toFixed(2)}\\b`),
      ),
    ).toBeTruthy()
    // The meter itself is unchanged and still reads against the month's band.
    expect(
      (screen.getByText(METER).parentElement as HTMLElement).textContent,
    ).toContain('137500 / 100000')
  })

  it('prints a rate with its cents column', async () => {
    // Business bills $0.5/1,000 and a bare interpolation renders "$0.5",
    // which on the one line that is about money reads as a typo.
    mockApiRequests = 137_500
    render(<BillingUsageComponent org={BUSINESS} hosts={HOSTS} />)
    await waitFor(() => {
      expect(screen.getByText(/\$0\.50\/1,000/)).toBeTruthy()
    })
    expect(screen.queryByText(/\$0\.5\/1,000/)).toBeNull()
  })

  it('says nothing while inside the band', async () => {
    mockApiRequests = 42_000
    render(<BillingUsageComponent org={BUSINESS} hosts={HOSTS} />)
    await waitFor(() => {
      expect(
        (screen.getByText(METER).parentElement as HTMLElement).textContent,
      ).toContain('42000 / 100000')
    })
    expect(screen.queryByText(/API overage/)).toBeNull()
  })

  it('says nothing while the counter is still loading', async () => {
    // The quota is computed from `apiRequests ?? 0`, and zero is never over a
    // positive band — which is the only reason no separate loading guard is
    // needed. That reasoning is a property of the FALLBACK, so this pins it:
    // change the fallback to anything that can exceed the band and a dollar
    // figure appears from a number nobody has read yet.
    mockApiRequests = 'missing'
    render(<BillingUsageComponent org={BUSINESS} hosts={HOSTS} />)
    await waitFor(() => {
      expect(screen.getByText(METER)).toBeTruthy()
    })
    expect(
      (screen.getByText(METER).parentElement as HTMLElement).textContent,
    ).toContain('not yet metered')
    expect(screen.queryByText(/API overage/)).toBeNull()
  })
})

describe('a plan that cannot be charged is quoted nothing', () => {
  it('shows no meter at all when the plan includes no API access', async () => {
    // Pro's `apiRequestsPerMonth` is 0 — the REST API is not part of the plan,
    // so a meter reading `0 / 0` would invent a quota out of an absence.
    expect(resolveOrgEntitlements(PRO).apiRequestsPerMonth).toBe(0)
    mockApiRequests = 5_000
    render(<BillingUsageComponent org={PRO} hosts={HOSTS} />)
    await waitFor(() => {
      expect(screen.getByText('Sites')).toBeTruthy()
    })
    expect(screen.queryByText(METER)).toBeNull()
    expect(screen.queryByText(/API overage/)).toBeNull()
  })

  it('an UNLIMITED band reads as unlimited and carries no rate', async () => {
    // `UNLIMITED` is `Number.POSITIVE_INFINITY`, so `used - Infinity` is never
    // positive and no overage can arise however large the count. The meter
    // must say Unlimited — not 0, and not a full bar.
    expect(resolveOrgEntitlements(ENTERPRISE).apiRequestsPerMonth).toBe(
      UNLIMITED,
    )
    mockApiRequests = 90_000_000
    render(<BillingUsageComponent org={ENTERPRISE} hosts={HOSTS} />)
    await waitFor(() => {
      expect(screen.getByText(METER)).toBeTruthy()
    })
    const row = screen.getByText(METER).parentElement as HTMLElement
    expect(row.textContent).toContain('90000000 / Unlimited')
    expect(row.textContent).not.toContain('/ 0')
    expect(screen.queryByText(/API overage/)).toBeNull()
    expect(checkApiRequestQuota(ENTERPRISE, 90_000_000).overageRequests).toBe(0)
  })
})

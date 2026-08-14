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
 * The billing page quotes what the invoice will actually carry (AGL-1658).
 *
 * AGL-1604 stopped the usage cron putting `contactsOverageUsd` into
 * `billedCents` while `release_contacts` is off for the org (`ad6117436`,
 * per-org overrides in `8c2dac60a`). The console's own caption kept rendering
 * "≈$3.15 this month" with no flag check — the same defect with the sign
 * reversed, and on the page a customer reads before deciding to stay.
 *
 * Three contracts pinned here:
 *
 *  1. THE SAME VERDICT AS THE INVOICE — not an approximation of it. The
 *     provider is REAL in this spec: `ReleaseFlagsProvider` resolves through
 *     `isReleaseFlagOnForOrg` over the Remote Config value, bucketed by org
 *     id, with `parseOrgReleaseFlagOverrides` applied to the org doc — the
 *     identical expression `report-usage` resolves from `orgData`. Only
 *     Remote Config and the org listener are faked, so the resolution under
 *     test is the shipped one.
 *  2. BOTH DIRECTIONS — an org staff granted Contacts early (AGL-1635) IS
 *     billed and is told the dollar figure; an org forced off is not billed
 *     and is not shown one. Suppressing the caption unconditionally would
 *     trade a phantom charge for a hidden real one, so the grant case fails
 *     that "fix" as loudly as the unfixed code fails the withheld case.
 *  3. A LOADING DEFAULT IS NOT A BILLING CLAIM — `release_contacts` is
 *     default-off, so before Remote Config activation an unguarded caption
 *     asserts "not billed" for one paint on an org that is billed. Until the
 *     verdict settles, no caption; the head-count meter renders throughout.
 *
 * The withheld wording is the one published in
 * `apps/docs/docs/workspace-and-billing/billing-and-plans/overview.md`
 * (AGL-1601/1603, `1a2aed5cb`): the page is unavailable, paid audience
 * overage is not billed while it is, and the rate applies once it opens.
 *
 * NO STRIPE PATH IS EXERCISED — `fetch` is mocked at the boundary and this
 * spec never reaches the metering route (localhost carries the LIVE key).
 */

import { render, screen, waitFor } from '@testing-library/react'
import type { ReleaseFlagValue } from '@aglyn/aglyn'

/** Pro: `contactsPerHost: 10000`, `extraContactsUsdPer1k: 0.75`. */
const ORG_ID = 'org-1'
const CONTACTS = 14_200
/** 14,200 − 10,000 = 4,200 over the band … */
const OVERAGE = '4,200'
/** … at $0.75/1,000 = $3.15 — the figure that must not appear when withheld. */
const ESTIMATE = '3.15'

const ORG = { $id: ORG_ID, plan: 'pro' } as any
const HOSTS = [{ $id: 'host-a', displayName: 'Site A' }]

/** The published Remote Config value for `release_contacts`. */
let mockFlagValue: ReleaseFlagValue
/** `org.releaseFlags`, exactly as staff store it from /admin/orgs. */
let mockOrgOverrides: Record<string, unknown> | undefined
/** When false, Remote Config activation never settles — the loading window. */
let mockActivationSettles: boolean

jest.mock('../utils/fetch-seat-counts', () => ({
  __esModule: true,
  default: async () => ({ managerSeats: 2, collaboratorSeats: 0 }),
}))

jest.mock('@aglyn/tenant-feature-instance', () => ({
  __esModule: true,
  useFirestore: () => ({}),
  useUser: () => ({
    data: {
      uid: 'u1',
      getIdToken: async () => 'tok',
      // Not staff. `released` is what bills, and the staff bypass
      // (`visible`) deliberately does not move a billing claim.
      getIdTokenResult: async () => ({ claims: {} }),
    },
  }),
  useRemoteConfig: () => ({ defaultConfig: {} }),
}))

// The org DOC the provider reads its per-org overrides from (AGL-1635). The
// same document `report-usage` resolves the cron's verdict from.
jest.mock('../hooks/use-current-org', () => ({
  __esModule: true,
  default: () => ({
    org: { $id: ORG_ID, plan: 'pro', releaseFlags: mockOrgOverrides },
    orgId: ORG_ID,
    ready: true,
    entitlementsFromCache: false,
  }),
  useCurrentOrg: () => ({
    org: { $id: ORG_ID, plan: 'pro', releaseFlags: mockOrgOverrides },
    orgId: ORG_ID,
    ready: true,
    entitlementsFromCache: false,
  }),
}))

jest.mock('firebase/remote-config', () => ({
  __esModule: true,
  fetchAndActivate: async () => {
    if (!mockActivationSettles) return new Promise(() => undefined)
    return true
  },
  getValue: (_config: unknown, key: string) => ({
    asString: () =>
      key === 'release_contacts' ? JSON.stringify(mockFlagValue) : '',
  }),
}))

jest.mock('firebase/firestore', () => ({
  __esModule: true,
  doc: (_db: unknown, ...segments: string[]) => ({ path: segments.join('/') }),
  collection: (_db: unknown, ...segments: string[]) => ({
    path: segments.join('/'),
  }),
  getCountFromServer: async (ref: { path: string }) => ({
    data: () => ({ count: ref.path.endsWith('/contacts') ? CONTACTS : 0 }),
  }),
  getDoc: async () => ({ exists: () => false, data: () => ({}) }),
}))

import BillingUsageComponent from '../components/billing/billing-usage.component'
import { ReleaseFlagsProvider } from '../hooks/use-release-flags'

beforeEach(() => {
  mockFlagValue = { enabled: false }
  mockOrgOverrides = undefined
  mockActivationSettles = true
  global.fetch = jest.fn(async (input: any) => {
    const url = String(input)
    if (url.startsWith('/api/billing/host-usage')) {
      return { ok: true, json: async () => ({ monthPageViews: 1000 }) }
    }
    if (url.startsWith('/api/hosts/usage')) {
      return { ok: true, json: async () => ({ screens: 4 }) }
    }
    return { ok: false, json: async () => ({}) }
  }) as any
})

function mount() {
  render(
    <ReleaseFlagsProvider>
      <BillingUsageComponent org={ORG} hosts={HOSTS} />
    </ReleaseFlagsProvider>,
  )
}

/** The contacts meter's readout — the head-count, which never goes away. */
async function contactsMeter(): Promise<HTMLElement> {
  const row = screen.getByText('Contacts (organization)')
    .parentElement as HTMLElement
  await waitFor(() => {
    expect(row.textContent).toContain(`${CONTACTS} / 10000`)
  })
  return row
}

function caption(): HTMLElement | null {
  return screen.queryByText(/Audience overage/)
}

describe('the audience-overage caption follows what is billed', () => {
  it('withholds the dollar estimate while `release_contacts` is off', async () => {
    mount()
    await contactsMeter()

    await waitFor(() => expect(caption()).not.toBeNull())
    const text = caption()?.textContent ?? ''

    // The head-count is real — ingestion captured these records — so it stays.
    expect(text).toContain(`${OVERAGE} over the included band`)
    // The monthly total is the part no invoice will carry.
    expect(text).not.toContain(ESTIMATE)
    expect(text).not.toContain('this month')
    // Worded to the docs pass (AGL-1601/1603): the PAGE is unavailable, and
    // the published rate is what applies once it opens.
    expect(text).toContain('not billed while the Contacts page is unavailable')
    expect(text).toContain('$0.75/1,000 rate applies once Contacts opens')
  })

  it('quotes the estimate for an org staff granted Contacts early', async () => {
    // AGL-1635 grant: this org CAN open the page, so the cron bills it — and
    // the page must say so. A blanket suppression fails here.
    mockOrgOverrides = { release_contacts: true }
    mount()
    await contactsMeter()

    await waitFor(() =>
      expect(caption()?.textContent ?? '').toContain(`≈$${ESTIMATE} this month`),
    )
    const text = caption()?.textContent ?? ''
    expect(text).toContain(`${OVERAGE} over the included band at $0.75/1,000`)
    expect(text).not.toContain('not billed')
  })

  it('withholds it for an org forced off after the flag ships globally', async () => {
    // The per-org kill switch is half of AGL-1635, and the cron honours it:
    // globally enabled, off for this org, so nothing is invoiced.
    mockFlagValue = { enabled: true }
    mockOrgOverrides = { release_contacts: false }
    mount()
    await contactsMeter()

    await waitFor(() => expect(caption()).not.toBeNull())
    const text = caption()?.textContent ?? ''
    expect(text).toContain('not billed while the Contacts page is unavailable')
    expect(text).not.toContain(ESTIMATE)
  })

  it('quotes the estimate once the flag ships globally', async () => {
    mockFlagValue = { enabled: true }
    mount()
    await contactsMeter()

    await waitFor(() =>
      expect(caption()?.textContent ?? '').toContain(`≈$${ESTIMATE} this month`),
    )
    expect(caption()?.textContent ?? '').not.toContain('not billed')
  })

  it('makes no billing claim at all before the flag verdict settles', async () => {
    // Activation never lands. `release_contacts` is default-off, so an
    // unguarded caption would assert "not billed" here — on an org whose
    // published value may well be ON.
    mockActivationSettles = false
    mockFlagValue = { enabled: true }
    mount()

    // The meter still renders the count: the head-count is not a claim about
    // money, and blanking it would be its own defect.
    await contactsMeter()
    expect(caption()).toBeNull()
  })
})

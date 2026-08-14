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
 * The Contacts page's own overage alert quotes what the invoice will carry
 * (AGL-1662) — the surface `db5ecdf2b` fixed on the console billing page.
 *
 * AGL-1604 stopped the usage cron putting `contactsOverageUsd` into
 * `billedCents` while `release_contacts` is off for the org. This alert kept
 * quoting "(≈$0.05 this month)" with no flag check.
 *
 * The gap is narrower than the billing page's and staff-only, which is the
 * whole reason it exists: the shell's `FeatureGate` admits a viewer on
 * `visible` (`released || isStaff`), so with the flag off the ONLY person who
 * reaches this page is staff — previewing an org the cron is deliberately not
 * billing. Support then reads the figure back to the customer, and the two
 * surfaces disagree about the same org's money.
 *
 * Four contracts:
 *
 *  1. WITHHELD MEANS WITHHELD — the dollar total goes, and so does the
 *     upgrade nudge that is premised on it. The head-count stays: it is real,
 *     it is what ingestion captured, and it is not a claim about money.
 *  2. THE WORDING MATCHES the billing page's (`db5ecdf2b`), which is itself
 *     `billing-and-plans/overview.md` as `1a2aed5cb` published it: the page
 *     is unavailable, paid overage is not billed while it is, the rate
 *     applies once it opens.
 *  3. BOTH DIRECTIONS — an org whose flag resolves ON is billed and is told
 *     the figure. A blanket suppression fails that case as loudly as the
 *     unfixed code fails the withheld one.
 *  4. A LOADING DEFAULT IS NOT A BILLING CLAIM — until the verdict settles
 *     there is no alert, and a caller that supplies no verdict at all gets
 *     the same silence rather than the charge.
 *
 * The verdict arrives as a prop because the release-flag hooks live in
 * `scope:app` and this plugin is `scope:lib`. The shell resolves it from
 * `released` — never `visible` — so what is asserted here is the same
 * expression `report-usage` bills from, one hop away.
 *
 * NO STRIPE PATH IS EXERCISED — nothing here reaches a metering route;
 * localhost carries the LIVE key.
 */

import { render, screen } from '@testing-library/react'
import type { ReactNode } from 'react'
import ContactsConsolePage from './contacts-console-page'

/**
 * Starter carries `extraContactsUsdPer1k: 1`, and the per-org entitlement
 * override sets the included band small enough that a 60-row fixture clears
 * it. Real `checkContactQuota`, real `resolveOrgEntitlements` — only the
 * count is staged.
 *
 * 60 − 10 = 50 over, at $1/1,000 = $0.05.
 */
const ORG = {
  $id: 'org-1',
  plan: 'starter',
  entitlements: { contactsPerHost: 10 },
} as any
const OVERAGE_LEAD = "50 contacts over your plan's included 10"
/** The figure that must not appear while the flag is off. */
const ESTIMATE = '0.05'

const contactDocs = Array.from({ length: 60 }, (_, index) => ({
  $id: `con-${index}`,
  email: `person-${index}@example.test`,
  name: `Person ${index}`,
  sources: ['form'],
  interactions: [],
  tags: [],
  notes: '',
}))
const collections: Record<string, Array<Record<string, unknown>>> = {
  contacts: contactDocs,
  contactSegments: [],
}

jest.mock('@aglyn/tenant-feature-instance', () => ({
  useFirestore: () => ({}),
  useOrgDataScope: () => ({ scope: ['orgs', 'org-1'] }),
  useFirestoreCollection: (build: () => unknown) => ({
    data: collections[build() as string] ?? [],
    status: 'success',
    fromCache: false,
  }),
  // `hosts/{id}/counters/contactsDropped` — zero, so the dropped-visitor
  // alert never stands in for the one under test.
  useFirestoreDoc: () => ({
    data: { total: 0 },
    status: 'success',
    fromCache: false,
  }),
  writeGuardedBySeed: jest.requireActual('@aglyn/tenant-feature-instance')
    .writeGuardedBySeed,
}))

jest.mock('firebase/firestore', () => ({
  ...jest.requireActual('firebase/firestore'),
  collection: (_db: unknown, ...segments: string[]) =>
    segments[segments.length - 1],
  query: (name: string) => name,
  limit: () => undefined,
  doc: () => ({}),
  // The audience head-count is a server aggregate now (AGL-1706). Answering
  // it with the fixture's own length keeps this spec's arithmetic (60 − 10 =
  // 50 over, at $1/1,000 = $0.05) true on both the pending fallback and the
  // resolved read, so nothing here depends on which one paints.
  getCountFromServer: jest.fn(async () => ({
    data: () => ({ count: contactDocs.length }),
  })),
  addDoc: jest.fn().mockResolvedValue(undefined),
  deleteDoc: jest.fn().mockResolvedValue(undefined),
  updateDoc: jest.fn().mockResolvedValue(undefined),
}))

jest.mock('@aglyn/shared-ui-snackstack', () => ({
  useSnackbar: () => ({ enqueueSnackbar: jest.fn() }),
}))
jest.mock('@aglyn/shared-ui-jsx', () => ({
  CardDisplay: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  MdiIcon: () => null,
  useConfirmationContext: () => ({
    confirm: jest.fn().mockResolvedValue(undefined),
  }),
}))

const mount = (releaseFlag?: { released: boolean; ready: boolean }) =>
  render(
    <ContactsConsolePage
      hostId="host-1"
      entitled
      org={ORG}
      {...(releaseFlag ? { releaseFlag } : {})}
    />,
  )

/** The overage alert, found by the head-count it always leads with. */
const alertText = (): string =>
  screen.queryByText(new RegExp(OVERAGE_LEAD))?.textContent ?? ''

describe('the Contacts overage alert follows what is billed (AGL-1662)', () => {
  it('withholds the dollar figure while `release_contacts` is off', () => {
    mount({ released: false, ready: true })

    const text = alertText()
    // The head-count is real, so it stays.
    expect(text).toContain(OVERAGE_LEAD)
    // The total, the rate-as-a-charge, and the upgrade nudge premised on it
    // all go — no invoice will carry any of them.
    expect(text).not.toContain(ESTIMATE)
    expect(text).not.toContain('this month')
    expect(text).not.toContain('metered at')
    expect(text).not.toContain('Upgrade in Billing')
    // The billing page's exact sentences (`db5ecdf2b` / `1a2aed5cb`).
    expect(text).toContain('not billed while the Contacts page is unavailable')
    expect(text).toContain('$1/1,000 rate applies once Contacts opens')
  })

  it('quotes the figure for an org whose flag resolves ON', () => {
    // Billed by the cron, so this page says so — a blanket suppression of the
    // alert fails here.
    mount({ released: true, ready: true })

    const text = alertText()
    expect(text).toContain(`metered at $1/1,000 per month (≈$${ESTIMATE} this month)`)
    expect(text).toContain('Upgrade in Billing for a larger included audience')
    expect(text).not.toContain('not billed')
  })

  it('makes no claim at all before the flag verdict settles', () => {
    // `release_contacts` is default-off, so an ungated alert would assert the
    // withheld wording here — on an org whose published value may be ON.
    mount({ released: false, ready: false })

    expect(screen.queryByText(new RegExp(OVERAGE_LEAD))).toBeNull()
  })

  it('makes no claim for a caller that resolved no verdict', () => {
    mount()

    expect(screen.queryByText(new RegExp(OVERAGE_LEAD))).toBeNull()
  })
})

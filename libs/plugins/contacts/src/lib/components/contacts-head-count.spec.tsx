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
 * The Contacts audience head-count is a SERVER AGGREGATE, not the length of
 * a capped listener (AGL-1706).
 *
 * Found while fixing AGL-1662 on this same alert. The list query is
 * `limit(1000)` — correctly, nobody needs 40,000 rows streamed into a table
 * — and `contacts.length` was then handed to `checkContactQuota` as the
 * org's audience. That number saturates at 1,000, which is *exactly*
 * `starter`'s included band, so `overageContacts = max(0, used − included)`
 * was 0 on every stock paid plan and the overage alert could not render at
 * all. Free (band 100, no rate) fell into the `!allowed` branch instead, so
 * no plan reached it.
 *
 * The dead alert is the smaller half. The same capped number fed the
 * toolbar readout, so an org with 40,000 contacts on Pro read
 * "1,000 contacts · 10,000 included" — the page whose job is telling a
 * customer where they sit in their band telling them they have room they do
 * not have — while `billing-usage.component.tsx`, reading the same
 * collection with `getCountFromServer`, showed 40,000 against 10,000. Two
 * surfaces, one org, two answers.
 *
 * Three contracts:
 *
 *  1. THE COUNT COMES FROM THE AGGREGATE. The rendered head-count and the
 *     quota input are the server's count, not the row count. This is the
 *     assertion that was red before the fix: with a saturated listener the
 *     toolbar read 1,000 and the alert did not exist.
 *  2. THE LIST KEEPS ITS CAP. The head-count and the row list are different
 *     questions; fixing the first must not start streaming the second. The
 *     `limit(1000)` stays on the list query.
 *  3. AN UNANSWERED AGGREGATE DOES NOT ANSWER THE QUESTION. Pending or
 *     denied, the count falls back to the listener length — a lower bound,
 *     and this page's prior behaviour — never to 0. `checkContactQuota`
 *     answers from whatever it is handed, and a defaulted 0 would clear the
 *     free plan's hard-band warning on an org that is over it.
 *
 * The counting RULE is untouched: `checkContactQuota` and the usage cron
 * that bills from it are the same as before. Only this page's INPUT stopped
 * being a saturated one.
 *
 * NO STRIPE PATH IS EXERCISED and no production data is read.
 */

import { render, screen, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import ContactsConsolePage from './contacts-console-page'

/**
 * Stock `pro`, no per-org entitlement override — the whole point being that
 * the alert must be reachable WITHOUT one. `PLAN_ENTITLEMENTS.pro`
 * carries `contactsPerHost: 10000` and `PLAN_PRICING.pro`
 * `extraContactsUsdPer1k: 0.75`. Real `checkContactQuota`, real
 * `resolveOrgEntitlements` — only the counts are staged.
 */
const ORG = { $id: 'org-1', plan: 'pro' } as any

/** What the server says the org actually has. */
const SERVER_COUNT = 40_000
/** What the `limit(1000)` listener can ever hand back. */
const LISTENER_ROWS = 1_000

const contactDocs = Array.from({ length: LISTENER_ROWS }, (_, index) => ({
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

/** Mutable so a spec can choose how the aggregate read resolves. */
const aggregate: { count: number | null } = { count: SERVER_COUNT }

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

const limitSpy = jest.fn((value: number) => value)
const countSpy = jest.fn(async (path: string) => {
  if (aggregate.count == null) {
    throw Object.assign(new Error('denied'), { code: 'permission-denied' })
  }
  return { data: () => ({ count: aggregate.count }), path } as any
})

jest.mock('firebase/firestore', () => ({
  ...jest.requireActual('firebase/firestore'),
  collection: (_db: unknown, ...segments: string[]) =>
    segments[segments.length - 1],
  query: (name: string) => name,
  limit: (value: number) => limitSpy(value),
  doc: () => ({}),
  getCountFromServer: (path: string) => countSpy(path),
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

beforeEach(() => {
  jest.clearAllMocks()
  aggregate.count = SERVER_COUNT
})

/** The org whose flag is ON, so the alert quotes the figure (AGL-1662). */
const mount = (org: any = ORG) =>
  render(
    <ContactsConsolePage
      hostId="host-1"
      entitled
      org={org}
      releaseFlag={{ released: true, ready: true }}
    />,
  )

describe('the Contacts head-count is a server aggregate (AGL-1706)', () => {
  it('reads the org audience, not the capped row list', async () => {
    mount()

    // Before the fix this read "1,000 contacts · 10,000 included" — the
    // listener cap, presented as the org's audience.
    await waitFor(() =>
      expect(
        screen.queryByText(/40,000 contacts · 10,000 included/),
      ).not.toBeNull(),
    )
    expect(screen.queryByText(/1,000 contacts ·/)).toBeNull()
  })

  it('makes the stock-plan overage alert reachable at all', async () => {
    mount()

    // 40,000 − 10,000 = 30,000 over, at $0.75/1,000 = $22.50. Unreachable
    // before the fix: `used` saturated at 1,000, below every paid band, so
    // `overageContacts` was 0 and this alert had no way to render on a plan
    // without a per-org `contactsPerHost` override.
    const alert = await screen.findByText(
      /30,000 contacts over your plan's included 10,000/,
    )
    expect(alert.textContent).toContain('metered at $0.75/1,000 per month')
    expect(alert.textContent).toContain('≈$22.50 this month')
  })

  it('reads the count ONCE, from the contacts collection', async () => {
    mount()

    await waitFor(() => expect(countSpy).toHaveBeenCalled())
    // One aggregate per mount is the whole cost of this fix; a read per
    // render would be a different bug wearing this one's fix.
    expect(countSpy).toHaveBeenCalledTimes(1)
    expect(countSpy).toHaveBeenCalledWith('contacts')
  })

  it('keeps the list capped — the cap was never the defect', () => {
    mount()

    // The row list stays `limit(1000)`. Fixing the head-count must not turn
    // this table into a 40,000-row stream; that the two questions now have
    // two answers is the point.
    expect(limitSpy).toHaveBeenCalledWith(1000)
  })

  it('falls back to the row count, never to zero, when the read fails', async () => {
    aggregate.count = null
    // Free hard-bands at 100 with no overage rate, so 1,000 known rows are
    // already over it. A defaulted 0 would resolve `allowed` true and delete
    // this warning from a page whose ingestion has genuinely stopped.
    mount({ $id: 'org-1', plan: 'free' })

    await waitFor(() => expect(countSpy).toHaveBeenCalled())
    expect(
      screen.queryByText(/Contact limit reached/)?.textContent ?? '',
    ).toContain('new visitors are no longer captured')
    // And the readout still shows what is known rather than nothing.
    expect(screen.queryByText(/1,000 contacts · 100 included/)).not.toBeNull()
  })
})

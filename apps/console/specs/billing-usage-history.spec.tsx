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
 * The Billing page's usage trend reads the monthly rollups (AGL-1530).
 *
 * Five contracts, each of which is a way the card could look right and be
 * wrong:
 *
 *  1. ORDERED BY DOCUMENT ID, NOT BY THE `month` FIELD. Firestore drops from
 *     an ordered query every document missing the ordered field, so
 *     `orderBy('month')` would silently delete a rollup written before that
 *     field existed — the history would simply be short, with nothing to see.
 *  2. NULL IS NOT ZERO. A meter that recorded nothing must render as
 *     unrecorded; a zero-height bar is a measurement nobody took (AGL-2321's
 *     rule, applied to the customer-facing surface).
 *  3. THE OPEN MONTH IS MARKED. AGL-2219's in-progress rollup is a real
 *     document, so it charts — but a month still accruing is not comparable
 *     to a settled one and must not read as if it were.
 *  4. A FAILED READ IS NOT AN EMPTY HISTORY. A denied query must say so,
 *     never render the reassuring "nothing here yet"
 *     (`feedback_loading_default_answers_a_question`).
 *  5. OLDEST FIRST. The query is newest-first; a chart reads left to right.
 */

import { render, screen, waitFor } from '@testing-library/react'

/** Rollup fixtures keyed by document id, as `orgs/{id}/usage` holds them. */
let mockRollups: Record<string, Record<string, unknown>>
/** When true the list query is denied (a rules failure, not an empty list). */
let mockDenied: boolean
/** What the component asked Firestore to order by. */
let mockOrderByField: string | null
let mockLimit: number | null

jest.mock('@aglyn/tenant-feature-instance', () => ({
  __esModule: true,
  useFirestore: () => ({}),
}))

jest.mock('firebase/firestore', () => ({
  __esModule: true,
  collection: (_db: unknown, ...segments: string[]) => ({
    path: segments.join('/'),
  }),
  documentId: () => '__name__',
  orderBy: (field: string, direction: string) => {
    mockOrderByField = field
    return { kind: 'orderBy', field, direction }
  },
  limit: (count: number) => {
    mockLimit = count
    return { kind: 'limit', count }
  },
  query: (ref: { path: string }) => ref,
  getDocs: async (ref: { path: string }) => {
    if (mockDenied) throw new Error('permission-denied')
    // Newest first, exactly as `orderBy(documentId(), 'desc')` returns them.
    const ids = Object.keys(mockRollups).sort().reverse()
    return {
      docs: ids.map((id) => ({
        id,
        data: () => mockRollups[id],
      })),
    }
  },
}))

import BillingUsageHistoryComponent, {
  monthLabel,
  readMeter,
} from '../components/billing/billing-usage-history.component'

const ORG = { $id: 'org-1' } as any

function seed(rollups: Record<string, Record<string, unknown>>) {
  mockRollups = rollups
  mockDenied = false
  mockOrderByField = null
  mockLimit = null
}

/** A settled month with every meter this card plots. */
function closedMonth(billedCents: number) {
  return {
    billedCents,
    pageViews: billedCents * 10,
    formSubmissions: 5,
    storageGb: 1.5,
    contactsCount: 20,
    stockBasis: 'period-end',
  }
}

/** Every bar the chart drew, oldest first. */
function bars(): HTMLElement[] {
  return Array.from(document.querySelectorAll('[data-month]'))
}

describe('the Billing usage history chart (AGL-1530)', () => {
  beforeEach(() => {
    seed({
      '2026-06': closedMonth(100),
      '2026-07': closedMonth(250),
      '2026-08': { ...closedMonth(90), stockBasis: 'in-progress' },
    })
  })

  it('reads the rollups ordered by DOCUMENT ID, not by the `month` field', async () => {
    render(<BillingUsageHistoryComponent org={ORG} />)
    await waitFor(() => expect(bars()).toHaveLength(3))
    // The whole point: `__name__` is what `documentId()` resolves to. Were
    // this `'month'`, a rollup lacking that field would vanish from the
    // history rather than show as unrecorded.
    expect(mockOrderByField).toBe('__name__')
    expect(mockLimit).toBe(12)
  })

  it('charts oldest-first, though the query returns newest-first', async () => {
    render(<BillingUsageHistoryComponent org={ORG} />)
    await waitFor(() => expect(bars()).toHaveLength(3))
    expect(bars().map((bar) => bar.getAttribute('data-month'))).toEqual([
      '2026-06',
      '2026-07',
      '2026-08',
    ])
  })

  it('marks the month in progress instead of charting it as settled', async () => {
    render(<BillingUsageHistoryComponent org={ORG} />)
    await waitFor(() => expect(bars()).toHaveLength(3))
    const flags = bars().map((bar) => bar.getAttribute('data-in-progress'))
    expect(flags).toEqual(['false', 'false', 'true'])
    expect(
      screen.getByText(/dashed bar is the month in progress/i),
    ).toBeTruthy()
  })

  it('renders a meter that recorded NOTHING as unrecorded, never as zero', async () => {
    // A rollup written before `contactsCount` was metered. The default series
    // is `billedCents`, which this month DID record — so the bar must be a
    // real bar there and unrecorded only for the meter that is missing.
    seed({
      '2026-06': { billedCents: 100, stockBasis: 'period-end' },
      '2026-07': closedMonth(250),
    })
    render(<BillingUsageHistoryComponent org={ORG} />)
    await waitFor(() => expect(bars()).toHaveLength(2))
    expect(bars().map((bar) => bar.getAttribute('data-unrecorded'))).toEqual([
      'false',
      'false',
    ])
    // And the unit under it, directly: a missing field is null, and a zero
    // that WAS recorded stays zero. These two must never collapse together.
    expect(readMeter({ billedCents: 100 }, 'contactsCount')).toBeNull()
    expect(readMeter({ contactsCount: 0 }, 'contactsCount')).toBe(0)
    // Corrupt values are unrecorded, not clamped into a fabricated figure.
    expect(readMeter({ contactsCount: -5 }, 'contactsCount')).toBeNull()
    expect(readMeter({ contactsCount: Number.NaN }, 'contactsCount')).toBeNull()
    expect(readMeter({ contactsCount: '12' }, 'contactsCount')).toBeNull()
  })

  it('says a failed read FAILED, rather than showing an empty history', async () => {
    seed({})
    mockDenied = true
    render(<BillingUsageHistoryComponent org={ORG} />)
    await waitFor(() =>
      expect(screen.getByText(/unavailable right now/i)).toBeTruthy(),
    )
    // The reassuring answer must NOT be the one a denied read produces.
    expect(screen.queryByText(/two months of billing history/i)).toBeNull()
    expect(bars()).toHaveLength(0)
  })

  it('waits rather than drawing a single lonely bar', async () => {
    // AGL-1530 names this case: one org-month of history charts as one bar,
    // which implies a comparison it cannot support.
    seed({ '2026-08': closedMonth(100) })
    render(<BillingUsageHistoryComponent org={ORG} />)
    await waitFor(() =>
      expect(screen.getByText(/two months of billing history/i)).toBeTruthy(),
    )
    expect(bars()).toHaveLength(0)
  })

  it('holds a loading state instead of answering before the read returns', async () => {
    render(<BillingUsageHistoryComponent org={ORG} />)
    // Before the promise settles the card must not have decided anything.
    expect(screen.getByText(/loading usage history/i)).toBeTruthy()
    await waitFor(() => expect(bars()).toHaveLength(3))
  })

  it('labels months, and names the year only when it turns', () => {
    expect(monthLabel('2026-08', '2026-07')).toBe('Aug')
    // No previous month (the leftmost bar) always carries the year.
    expect(monthLabel('2026-07')).toBe("Jul '26")
    // And the turn of the year is where the label must reappear.
    expect(monthLabel('2027-01', '2026-12')).toBe("Jan '27")
  })
})

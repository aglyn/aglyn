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
 * The per-screen traffic table reads the RECENT end of its window, and shows
 * all of what it read (AGL-693).
 *
 * Two failures, both invisible from the outside, both about a cap with nothing
 * saying which end it bites:
 *
 *  1. **The query.** A Firestore range filter carries an IMPLICIT ascending
 *     order on its own field, so `where('day', '>=', start)` with a bare
 *     `limit(1000)` answers with the OLDEST thousand documents in the window.
 *     A site over the ceiling therefore saw the start of its range and none of
 *     this week — on a card whose entire subject is recent traffic. The file's
 *     own comment claimed the opposite, which is how it survived.
 *
 *  2. **The table.** It rendered `rows.slice(0, 50)` with no footer and
 *     nothing saying so, on a card whose purpose is comparing screens against
 *     each other.
 *
 * The fixture models the implicit ordering rule rather than stubbing the
 * result, because that rule IS the bug: a fake that answers the same array
 * whatever the query asked for would pass on both shapes.
 */

import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'

/** The card's own ceiling. The fixture has to exceed it to say anything. */
const QUERY_LIMIT = 1000
/** How many rows the table used to render, silently. */
const LEGACY_ROW_CAP = 50

/** Fixed so the day ids the card computes are the day ids seeded here. */
const NOW = Date.parse('2026-08-20T12:00:00Z')

/** Every day doc the fake site holds, and every query it was asked. */
let mockDayDocs: Array<Record<string, unknown>> = []
let mockRequests: any[] = []

/**
 * Firestore's answer to a range query, modelled — `mock`-prefixed and hoisted
 * so the `jest.mock` factory below may reference it.
 *
 * The load-bearing rule is the ORDER: a query with an inequality and no
 * explicit `orderBy` is ordered ascending BY THAT FIELD, so the cap takes the
 * low end. That is exactly what the old query did, and modelling it is what
 * makes this suite fail on it.
 */
function mockEvaluateQuery(request: any): Array<Record<string, unknown>> {
  const wheres = request.constraints.filter((c: any) => c.type === 'where')
  let rows = mockDayDocs.filter((row) =>
    wheres.every((clause: any) =>
      clause.op === '>=' ? String(row[clause.field]) >= clause.value : true,
    ),
  )
  const explicit = request.constraints.filter((c: any) => c.type === 'orderBy')
  const clauses = explicit.length
    ? explicit
    : // The IMPLICIT order: the inequality's own field, ascending.
      wheres.map((clause: any) => ({ field: clause.field, direction: 'asc' }))
  for (const clause of clauses) {
    rows = [...rows].sort((a: any, b: any) => {
      const order =
        String(a[clause.field]) < String(b[clause.field])
          ? -1
          : String(a[clause.field]) > String(b[clause.field])
            ? 1
            : 0
      return clause.direction === 'desc' ? -order : order
    })
  }
  const cap = request.constraints.find((c: any) => c.type === 'limit')
  return cap ? rows.slice(0, cap.value) : rows
}

jest.mock('firebase/firestore', () => ({
  __esModule: true,
  collection: (_db: unknown, ...segments: string[]) => ({
    path: segments.join('/'),
    constraints: [] as unknown[],
  }),
  orderBy: (field: string, direction = 'asc') => ({
    type: 'orderBy',
    field,
    direction,
  }),
  limit: (value: number) => ({ type: 'limit', value }),
  where: (field: string, op: string, value: unknown) => ({
    type: 'where',
    field,
    op,
    value,
  }),
  query: (source: any, ...constraints: unknown[]) => ({
    ...source,
    constraints: [...source.constraints, ...constraints],
  }),
  doc: () => ({}),
  getDoc: async () => ({ get: () => ({}) }),
  getDocs: async (request: any) => {
    mockRequests.push(request)
    return { docs: mockEvaluateQuery(request).map((data) => ({ data: () => data })) }
  },
}))

jest.mock('@aglyn/tenant-feature-instance', () => ({
  __esModule: true,
  useFirestore: () => ({}),
}))

jest.mock('@aglyn/shared-ui-jsx', () => ({
  __esModule: true,
  AppLink: ({ children }: { children: ReactNode }) => <span>{children}</span>,
  CardDisplay: ({
    children,
    HeaderProps,
  }: {
    children: ReactNode
    HeaderProps?: { action?: ReactNode }
  }) => (
    <div>
      {HeaderProps?.action}
      {children}
    </div>
  ),
}))

jest.mock('../hooks/use-current-org', () => ({
  __esModule: true,
  default: () => ({ org: { $id: 'org-1', plan: 'business' }, ready: true }),
}))

jest.mock('../hooks/use-org-scope', () => ({
  __esModule: true,
  useOrgSlug: () => 'acme',
}))

import ScreensAnalyticsTable from '../components/analytics/screens-analytics-table.component'
import { recentDayIds } from '../utils/analytics-day-cache'
import { TABLE_PAGE_SIZE_DEFAULT } from '../constants/shared'

/** The default range the card opens on. */
const RANGE = 14

/**
 * More day documents than the ceiling, spread over the window so that the
 * OLDEST end alone fills it.
 *
 * `SCREENS_PER_DAY × RANGE` is comfortably over `QUERY_LIMIT`, so a query that
 * takes the low end of the range cannot reach today at all — which is the
 * whole point of the fixture.
 */
const SCREENS_PER_DAY = 90
const TODAY_ONLY_SCREEN = 'screen-today'

const seedDays = () => {
  const days = recentDayIds(NOW, RANGE)
  const docs: Array<Record<string, unknown>> = []
  for (const day of days) {
    for (let n = 0; n < SCREENS_PER_DAY; n += 1) {
      docs.push({
        day,
        screenId: `screen-${String(n).padStart(3, '0')}`,
        // Views descend with the screen number so the aggregate's own order is
        // predictable, and the row ranked past the old 50-row cap is knowable.
        total: 10_000 - n,
        devices: { desktop: 1 },
        referrers: { 'example.test': 1 },
      })
    }
  }
  // One screen that exists ONLY on the most recent day — invisible to a query
  // that takes the oldest thousand.
  docs.push({
    day: days[0],
    screenId: TODAY_ONLY_SCREEN,
    total: 999_999,
    devices: { mobile: 1 },
    referrers: { 'example.test': 1 },
  })
  return docs
}

let hostSeq = 0
/** A fresh host id per test: the card memoises its result at module scope. */
const mountFreshHost = () => {
  hostSeq += 1
  return render(<ScreensAnalyticsTable hostId={`host-${hostSeq}`} />)
}

const rowScreenIds = () =>
  screen
    .getAllByRole('row')
    .map((row) => row.querySelectorAll('td')[0]?.textContent ?? '')
    .filter(Boolean)

beforeEach(() => {
  jest.spyOn(Date, 'now').mockReturnValue(NOW)
  mockDayDocs = seedDays()
  mockRequests = []
})

afterEach(() => {
  jest.restoreAllMocks()
})

describe('the traffic table reads the RECENT end of its window (AGL-693)', () => {
  it('seeds more day documents than the ceiling', () => {
    // The premise. Without it every assertion below is about a window that
    // never truncates, and the suite proves nothing.
    expect(mockDayDocs.length).toBeGreaterThan(QUERY_LIMIT)
  })

  it('asks for the newest days, so the cap costs the far end', async () => {
    mountFreshHost()
    await waitFor(() => expect(mockRequests.length).toBeGreaterThan(0))
    const request = mockRequests[0]
    expect(request.constraints).toContainEqual({
      type: 'orderBy',
      field: 'day',
      direction: 'desc',
    })
    // And the answer proves it: the screen that exists only on the most recent
    // day is in the result. Under the implicit ascending order it is not.
    const returned = mockEvaluateQuery(request).map((row) => row.screenId)
    expect(returned).toContain(TODAY_ONLY_SCREEN)
  })

  it('renders the screen that only today has traffic for', async () => {
    mountFreshHost()
    await waitFor(() => expect(rowScreenIds().length).toBeGreaterThan(0))
    // It is the highest-total screen, so the aggregate ranks it first — the
    // one row a reader of this card would notice missing, and the old query
    // never read it.
    expect(rowScreenIds()).toContain(TODAY_ONLY_SCREEN)
  })

  it('pages instead of cutting the comparison off at fifty', async () => {
    mountFreshHost()
    await waitFor(() => expect(rowScreenIds().length).toBeGreaterThan(0))
    expect(rowScreenIds().length).toBe(TABLE_PAGE_SIZE_DEFAULT)
    // `screen-060` ranks past the old 50-row slice: reachable now, and
    // unreachable then, from any interaction the card offered.
    for (let click = 0; click < 6; click += 1) {
      fireEvent.click(screen.getByRole('button', { name: /go to next page/i }))
      await waitFor(() => expect(rowScreenIds().length).toBeGreaterThan(0))
    }
    expect(rowScreenIds()).toContain('screen-060')
  })

  it('counts the WHOLE window, not the page', async () => {
    mountFreshHost()
    await waitFor(() => expect(rowScreenIds().length).toBeGreaterThan(0))
    // The rows are aggregated in the browser, so the total is known and the
    // footer says it outright rather than "more than 10".
    expect(
      screen.getByText(new RegExp(`of ${SCREENS_PER_DAY + 1}$`)),
    ).toBeTruthy()
  })
})

describe('THE CONTROL: the query model bites (AGL-693)', () => {
  it('the OLD query could not reach the most recent day', () => {
    // Rebuilt rather than remembered: the inequality with no explicit order,
    // which is what this card shipped.
    const legacy = {
      path: 'hosts/host-1/screenAnalytics',
      constraints: [
        { type: 'where', field: 'day', op: '>=', value: recentDayIds(NOW, RANGE)[RANGE - 1] },
        { type: 'limit', value: QUERY_LIMIT },
      ],
    }
    const returned = mockEvaluateQuery(legacy)
    expect(returned).toHaveLength(QUERY_LIMIT)
    expect(returned.map((row) => row.screenId)).not.toContain(TODAY_ONLY_SCREEN)
    // And it stopped short of the window's recent end, which is the fact the
    // card's comment used to get backwards.
    const days = new Set(returned.map((row) => row.day))
    expect(days.has(recentDayIds(NOW, RANGE)[0])).toBe(false)
  })

  it('the fixture has rows past the old fifty-row slice', () => {
    // Otherwise the paging assertion above is satisfied by a table that still
    // renders everything it has.
    expect(SCREENS_PER_DAY + 1).toBeGreaterThan(LEGACY_ROW_CAP)
  })
})

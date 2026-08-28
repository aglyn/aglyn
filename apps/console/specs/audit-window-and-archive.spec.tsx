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
 * THE AUDIT WINDOW MOVES, AND THE ARCHIVE HAS A DOOR (AGL-2324).
 *
 * The page read `orderBy('at','desc').limit(200)` with no cursor, no date
 * range and no way to ask for row 201, while ~70 distinct action strings
 * write to `adminAudit` and several are system-actored and high-frequency.
 * Those flood the window within hours and evict `org.override` — the
 * lowest-frequency, highest-consequence row, and the one this page has
 * bespoke handling for. Separately, the 90-to-365-day archive that
 * `docs/DATA_RETENTION.md` promises had no product reader at all.
 *
 * WHAT THIS FILE HAS TO CATCH, and the false greens it is written against:
 *
 *  - **A control that exists but changes no query.** Every assertion about
 *    paging and date range is made against the CONSTRAINTS HANDED TO
 *    FIRESTORE, recorded by the `firebase/firestore` double. A "Load older"
 *    button that re-renders and re-requests the same 200 rows satisfies any
 *    check written against the screen alone, and dies here.
 *  - **A constant where a measured value belongs.** The page size is
 *    asserted against the SHARED default and against the limit the query
 *    carried. A page that passed a fixed `limit(200)` — the original defect —
 *    survives every "is there a footer" assertion and fails this one.
 *  - **A pager that shows the same rows on every page.** Page two is checked
 *    for what it DOES NOT contain. The control it replaced could only grow:
 *    "Load older" re-rendered rows 0–399 under a bigger limit, so a check
 *    that page two "has rows" passed on a page that had never moved.
 *  - **A window that ends silently.** `hasMore` is asserted in BOTH
 *    directions. A list that always offers a next page is as useless as one
 *    that never does.
 *  - **A slice with no ordering.** The Firestore double answers an unordered
 *    query in DOCUMENT-ID order, exactly as Firestore does, and the fixture's
 *    id order is deliberately not its date order. A page that dropped
 *    `orderBy('at','desc')` therefore renders a plausible-looking page of the
 *    WRONG rows and fails here — the seven-times-repeated bug in this repo,
 *    caught by the data rather than by a string match on the source.
 *  - **An import that outlives its JSX.** Nothing here asserts on a symbol
 *    name; every claim is a rendered string or a recorded call argument.
 */

import { fireEvent, render, screen, waitFor } from '@testing-library/react'

jest.mock('@aglyn/aglyn', () => ({
  __esModule: true,
  orgOverrideReasonSummary: () => null,
}))

jest.mock('@aglyn/shared-data-enums', () => ({
  __esModule: true,
  ICON_VARIANT_SYMBOL_SECURE: { path: 'M0 0' },
}))

jest.mock('@aglyn/shared-ui-jsx', () => ({
  __esModule: true,
  Container: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  CardDisplay: ({
    header,
    children,
  }: {
    header: React.ReactNode
    children: React.ReactNode
  }) => (
    <section>
      <h2>{header}</h2>
      {children}
    </section>
  ),
}))

jest.mock('../components/layouts/dashboard.layout', () => ({
  __esModule: true,
  default: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}))

jest.mock('../components/layouts/authenticated.layout', () => ({
  __esModule: true,
  default: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}))

jest.mock('../components/layouts/main.layout', () => ({
  __esModule: true,
  default: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}))

jest.mock('../components/staff-only.component', () => ({
  __esModule: true,
  default: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}))

jest.mock('../constants/docs-links', () => ({
  __esModule: true,
  docsHelp: () => undefined,
}))

jest.mock('../constants/route-links', () => ({
  __esModule: true,
  buildRoute: () => '/admin/audit',
  Route: { ADMIN_OVERVIEW: 'ADMIN_OVERVIEW', ADMIN_AUDIT: 'ADMIN_AUDIT' },
}))

/*
 * A STABLE Firestore identity, not a fresh object per call.
 *
 * `useFirestore` returns a singleton in the product. A double returning
 * `() => ({})` hands back a new identity on every render, which makes the
 * page's `deps` array differ every time and re-runs the read unconditionally
 * — and that silently repairs the very bug the deps array can have. Caught
 * here by mutation: dropping `pageSize` from the page's `deps` left this
 * file GREEN until the identity was made stable.
 */
const mockFirestore = {}

/*==========================================
 * THE QUERY RECORDER.
 *
 * The constraint builders return TAGGED objects and `query` keeps every set
 * it is handed, so an assertion can read what Firestore was actually asked
 * for. This is the difference between testing that a date field exists on
 * the screen and testing that picking a date narrows the read.
 *=========================================*/
const queries: any[][] = []
let mockRows: any[] = []

/*==========================================
 * FIRESTORE'S ANSWER, INCLUDING THE PART NOBODY ASKS FOR.
 *
 * `mockRows` is a POOL held in DOCUMENT-ID order, because that is the order
 * Firestore answers a query that named none — and that is the whole of the
 * bug this repo has now hit seven times. An unordered `limit(n)` is not "the
 * first n by anything a reader would guess"; it is n arbitrary documents.
 *
 * So the double honours what the query actually carried:
 *
 *  - `orderBy` sorts the pool. Absent, the pool stays in id order.
 *  - `where` on the ordered field bounds it.
 *  - `limit` truncates last, exactly as a real read does.
 *
 * A double that always sorted by date would hand a page with NO `orderBy`
 * the rows it meant to ask for, and every assertion below would pass on the
 * defect.
 *=========================================*/
const mockServe = (constraints: any[]) => {
  const order = constraints.find((entry: any) => entry?.kind === 'orderBy')
  const seconds = (row: any, field: string) => Number(row?.[field]?.seconds ?? 0)
  let served = [...mockRows]
  if (order) {
    const direction = order.direction === 'desc' ? -1 : 1
    served.sort(
      (a, b) =>
        direction * (seconds(a, order.field) - seconds(b, order.field)),
    )
  }
  for (const bound of constraints.filter((entry: any) => entry?.kind === 'where')) {
    const edge = Date.parse(bound.value?.iso ?? '') / 1000
    served = served.filter((row) =>
      bound.op === '>='
        ? seconds(row, bound.field) >= edge
        : seconds(row, bound.field) < edge,
    )
  }
  const capped = constraints.find((entry: any) => entry?.kind === 'limit')
  return capped ? served.slice(0, capped.count) : served
}

jest.mock('firebase/firestore', () => ({
  __esModule: true,
  collection: () => ({ kind: 'collection' }),
  query: (...args: any[]) => {
    queries.push(args.slice(1))
    return { constraints: args.slice(1) }
  },
  orderBy: (field: string, direction: string) => ({
    kind: 'orderBy',
    field,
    direction,
  }),
  limit: (count: number) => ({ kind: 'limit', count }),
  where: (field: string, op: string, value: unknown) => ({
    kind: 'where',
    field,
    op,
    value,
  }),
  // The compliance export reads for ITSELF now, so the double has to answer
  // a one-shot get as well as a listener. An incomplete module mock is how a
  // page that gained one import renders as "Element type is invalid".
  getDocs: async (built: any) => {
    const served = mockServe(built?.constraints ?? [])
    return {
      size: served.length,
      docs: served.map((row) => ({ id: row.$id, data: () => row })),
    }
  },
  Timestamp: {
    fromDate: (date: Date) => ({ kind: 'ts', iso: date.toISOString() }),
  },
}))

/*==========================================
 * THE PAGED-COLLECTION DOUBLE, MODELLED ON THE REAL ONE.
 *
 * Faithful to the contract in `use-paged-collection.ts`, because every
 * behaviour it models is one the page can get wrong:
 *
 *  1. The window is `pageSize × (page + 1)`, requested PLUS ONE. The extra
 *     document is what makes `hasMore` a fact instead of a `length === limit`
 *     guess, which is wrong in both directions on an exact multiple.
 *  2. `rows` is the current page's slice of that window, never the whole
 *     window. A double that returned everything would let a "pager" that
 *     never moved satisfy every assertion below.
 *  3. `buildQuery` is re-invoked from an effect keyed on `deps` + the window
 *     size, so the DEPENDENCY ARRAY stays testable: a page that changes the
 *     range but omits it from `deps` never re-reads.
 *  4. Changing the page size returns to page one, and so does a change of
 *     subject — an out-of-range page renders as an empty list with no
 *     explanation, which reads as the data having gone.
 *
 * The rows come back through `mockServe`, so what this hands the page is
 * whatever the page's own constraints earned.
 *=========================================*/
jest.mock('@aglyn/tenant-feature-instance', () => {
  const { useCallback, useEffect, useState } = require('react')
  return {
    __esModule: true,
    useFirestore: () => mockFirestore,
    useUser: () => ({ data: { getIdToken: async () => 'staff-token' } }),
    /* eslint-disable react-hooks/rules-of-hooks, react-hooks/exhaustive-deps
       -- this IS the hook; the linter cannot see that from inside a mock
       factory, and the dep list is forwarded from the caller by design. */
    usePagedCollection: (
      buildQuery: (pageLimit: number) => unknown,
      deps: unknown[],
    ) => {
      // `useState` here comes off an untyped `require`, so the type rides on
      // the initial value rather than a type argument (TS2347).
      const [pageSize, setPageSizeState] = useState(10)
      const [page, setPage] = useState(0)
      const [data, setData] = useState([] as any[])
      const windowSize = pageSize * (page + 1)
      useEffect(() => {
        setPage(0)
      }, deps)
      useEffect(() => {
        buildQuery(windowSize + 1)
        setData(mockServe((queries[queries.length - 1] ?? []) as any[]))
      }, [...deps, windowSize])
      const setPageSize = useCallback((next: number) => {
        setPageSizeState(next)
        setPage(0)
      }, [])
      return {
        data,
        rows: data.slice(page * pageSize, windowSize),
        hasMore: data.length > windowSize,
        page,
        setPage,
        pageSize,
        setPageSize,
      }
    },
    /* eslint-enable react-hooks/rules-of-hooks, react-hooks/exhaustive-deps */
  }
})

import AdminAudit from '../app/(app)/admin/audit/page'

const AT = { seconds: 1_760_000_000 }

/**
 * N rows in DOCUMENT-ID order, each distinguishable, and each carrying a
 * timestamp that is deliberately NOT in id order.
 *
 * That mismatch is the point. Firestore answers an unordered `limit()` in
 * document-id order, so a page missing its `orderBy` gets `row-000` first
 * here — a page that looks entirely reasonable and is the wrong rows. With
 * the ordering in place the newest row leads, and the two are different
 * enough to tell apart on sight.
 *
 * 37 is coprime with every count used below, so the offsets are a
 * permutation: no two rows share a timestamp and no row is dropped.
 */
const rows = (count: number) =>
  Array.from({ length: count }, (_, index) => ({
    $id: `row-${String(index).padStart(3, '0')}`,
    actorUid: `u-${index}`,
    actorEmail: `staff${index}@aglyn.com`,
    action: 'plugins.artifacts.reap',
    target: `plugins/p-${String(index).padStart(3, '0')}`,
    at: { seconds: AT.seconds + ((index * 37) % count) },
  }))

/** The target cells actually on screen, in render order. */
const targetsOnScreen = () =>
  screen
    .queryAllByText(/^plugins\/p-\d{3}$/)
    .map((node) => node.textContent ?? '')

/** The newest row in a pool, which is the one an ordered page one must lead with. */
const newestTarget = (pool: any[]) =>
  [...pool].sort((a, b) => b.at.seconds - a.at.seconds)[0].target

const lastQuery = () => queries[queries.length - 1] ?? []
const constraint = (kind: string) =>
  lastQuery().filter((entry: any) => entry?.kind === kind)

beforeEach(() => {
  queries.length = 0
  mockRows = []
  jest.clearAllMocks()
})

describe('the audit log pages on the shared footer (AGL-693, AGL-2324)', () => {
  it('THE CONTROL: the fixture can tell an ordered page from an id-ordered one', () => {
    // Both halves of this file's premise. If id order and date order agreed,
    // every ordering assertion below would pass on a page that named no
    // order at all — the exact false green that let this bug recur seven
    // times.
    const pool = rows(60)
    expect(newestTarget(pool)).not.toBe(pool[0].target)
    expect(new Set(pool.map((row) => row.at.seconds)).size).toBe(pool.length)
  })

  it('opens on the console-wide page size, not a bespoke one', () => {
    mockRows = rows(60)
    render(<AdminAudit />)

    // Ten rows, plus the probe row that makes "is there more" a fact rather
    // than a guess. A page that still passed a fixed `limit(200)` — the
    // original defect — renders a perfectly good list and fails here.
    expect(constraint('limit')[0].count).toBe(11)
    expect(targetsOnScreen()).toHaveLength(10)
    expect(screen.getByText('Rows per page:')).toBeTruthy()
  })

  it('fills page one with the NEWEST rows, not an id-ordered sample', () => {
    mockRows = rows(60)
    render(<AdminAudit />)

    // The whole trap, measured against the data rather than a source string:
    // the double answers an unordered query in document-id order, so a page
    // that dropped `orderBy('at','desc')` leads with `plugins/p-000` and
    // fails both of these.
    expect(targetsOnScreen()[0]).toBe(newestTarget(mockRows))
    expect(targetsOnScreen()).not.toContain('plugins/p-000')
    expect(constraint('orderBy')[0]).toMatchObject({
      field: 'at',
      direction: 'desc',
    })
  })

  it('moves to DIFFERENT rows on page two, and back again', async () => {
    mockRows = rows(60)
    render(<AdminAudit />)
    const first = targetsOnScreen()

    fireEvent.click(screen.getByLabelText('Go to next page'))
    await waitFor(() => expect(constraint('limit')[0].count).toBe(21))

    // What page two must NOT contain. The control this replaced could only
    // grow: "Load older" re-rendered rows 0–399 under a bigger limit, so an
    // assertion that page two "has rows" passed on a list that never moved.
    const second = targetsOnScreen()
    expect(second).toHaveLength(10)
    for (const target of first) expect(second).not.toContain(target)

    fireEvent.click(screen.getByLabelText('Go to previous page'))
    await waitFor(() => expect(targetsOnScreen()).toEqual(first))
  })

  it('carries the chosen page size into the READ', async () => {
    mockRows = rows(60)
    render(<AdminAudit />)

    fireEvent.mouseDown(screen.getByLabelText('Rows per page:'))
    fireEvent.click(screen.getByRole('option', { name: '25' }))

    // The size menu was one of the two things the old control could not do
    // at all. A menu that re-renders without re-reading is furniture.
    await waitFor(() => expect(constraint('limit')[0].count).toBe(26))
    expect(targetsOnScreen()).toHaveLength(25)
  })

  it('offers a next page only when there is one', async () => {
    mockRows = rows(60)
    const deep = render(<AdminAudit />)
    expect(
      (screen.getByLabelText('Go to next page') as HTMLButtonElement).disabled,
    ).toBe(false)
    deep.unmount()

    // A pool SHORTER than one page. Claiming more would send an auditor
    // paging through nothing; the probe row is what settles it, and it
    // settles the exact-multiple case a `length === pageSize` guess cannot.
    mockRows = rows(4)
    render(<AdminAudit />)
    expect(targetsOnScreen()).toHaveLength(4)
    expect(
      (screen.getByLabelText('Go to next page') as HTMLButtonElement).disabled,
    ).toBe(true)
  })

  it('filters THIS PAGE, and says that is what it did', () => {
    mockRows = rows(60)
    render(<AdminAudit />)

    fireEvent.change(
      screen.getByLabelText('Filter this page (actor, email, action, target)'),
      { target: { value: 'no-such-actor' } },
    )
    // Not "no audit entries" — the log is full, the page is not. A
    // client-side filter can only narrow rows the client already holds, and
    // saying otherwise would report an empty log off a full one.
    expect(screen.getByText('Nothing on this page matches the filter.')).toBeTruthy()
  })

  it('narrows the READ by date, not the rows already fetched', async () => {
    mockRows = rows(200)
    render(<AdminAudit />)
    // No range asked for, none sent. A page that always sent a bound would
    // be filtering by a default nobody chose.
    expect(constraint('where')).toHaveLength(0)

    fireEvent.change(screen.getByLabelText('From'), {
      target: { value: '2026-03-01' },
    })
    fireEvent.change(screen.getByLabelText('To'), {
      target: { value: '2026-03-31' },
    })

    await waitFor(() => expect(constraint('where')).toHaveLength(2))
    const [lower, upper] = constraint('where')
    expect(lower).toMatchObject({ field: 'at', op: '>=' })
    expect(upper).toMatchObject({ field: 'at', op: '<' })
    // The upper bound is EXCLUSIVE OF THE FOLLOWING DAY. An inclusive
    // midnight bound silently drops every row written on the 31st — a range
    // filter that loses the last day of the range looks entirely correct.
    expect(upper.value.iso.slice(0, 10)).toBe('2026-04-01')
    expect(lower.value.iso.slice(0, 10)).toBe('2026-03-01')

    // The range rides the SAME field the query orders by, which is what
    // keeps it on the single-field index. A range on any other field would
    // need a composite index that does not exist and would throw in
    // production for every staff member.
    expect(constraint('orderBy')[0].field).toBe('at')
    expect(lower.field).toBe(constraint('orderBy')[0].field)
  })
})

describe('a staff grant in a customer pool is visible (AGL-2324)', () => {
  it('renders targetTenantId on the row and exports it with a value', async () => {
    mockRows = [
      {
        $id: 'grant-1',
        actorUid: 'u-alice',
        actorEmail: 'alice@aglyn.com',
        action: 'user.grantStaff',
        target: 'users/carol',
        targetTenantId: 'tenant-northwind',
        at: AT,
      },
      {
        $id: 'grant-2',
        actorUid: 'u-alice',
        actorEmail: 'alice@aglyn.com',
        action: 'user.grantStaff',
        target: 'users/dave',
        at: AT,
      },
    ]
    render(<AdminAudit />)

    // The tenant-pool grant is marked and the project-pool one is NOT. Both
    // halves matter: a chip on every row names nothing.
    expect(screen.getByText('tenant pool: tenant-northwind')).toBeTruthy()
    expect(screen.queryAllByText(/^tenant pool:/)).toHaveLength(1)

    const written: string[] = []
    const OriginalBlob = globalThis.Blob
    const originalCreate = URL.createObjectURL
    const originalRevoke = URL.revokeObjectURL
    ;(globalThis as any).Blob = class extends OriginalBlob {
      constructor(parts: any[], options?: any) {
        written.push(parts.map(String).join(''))
        super(parts, options)
      }
    }
    ;(URL as any).createObjectURL = () => 'blob:audit'
    ;(URL as any).revokeObjectURL = () => undefined
    try {
      fireEvent.click(screen.getByText('Export CSV'))
      await waitFor(() => expect(written).toHaveLength(1))
      const [header, first, second] = written[0].split('\n')
      const column = header.split(',').indexOf('targetTenantId')
      expect(column).toBeGreaterThan(-1)
      // The VALUE in its own column, and empty for the row that has none. A
      // header with nothing under it is the same silence with a label on it.
      expect(first.split(',')[column]).toBe('tenant-northwind')
      expect(second.split(',')[column]).toBe('')
    } finally {
      ;(globalThis as any).Blob = OriginalBlob
      ;(URL as any).createObjectURL = originalCreate
      ;(URL as any).revokeObjectURL = originalRevoke
    }
  })
})

describe('the archive is readable from the product (AGL-2324)', () => {
  const ARCHIVED = [
    {
      $id: 'a1',
      actorEmail: 'alice@aglyn.com',
      action: 'org.override',
      target: 'orgs/acme',
      reason: 'enterprise-rate',
      at: '2026-03-04T10:00:00.000Z',
    },
    {
      $id: 'b2',
      actorEmail: 'bob@aglyn.com',
      action: 'user.grantStaff',
      target: 'users/carol',
      at: '2026-03-05T11:00:00.000Z',
    },
  ]

  it('lists a month and reads one object back into rows', async () => {
    const calls: string[] = []
    global.fetch = jest.fn(async (url: any) => {
      calls.push(String(url))
      return {
        ok: true,
        json: async () =>
          String(url).includes('file=')
            ? { rows: ARCHIVED, unreadable: 0, total: 2 }
            : {
                files: [
                  { name: 'run-a.jsonl', bytes: 4096, archivedAt: null },
                ],
              },
      }
    }) as unknown as typeof fetch

    render(<AdminAudit />)
    fireEvent.change(screen.getByLabelText('Month'), {
      target: { value: '2026-03' },
    })
    fireEvent.click(screen.getByText('List archive'))

    expect(await screen.findByText('run-a.jsonl')).toBeTruthy()
    expect(calls[0]).toContain('month=2026-03')

    fireEvent.click(screen.getByText('Open'))

    // Each archived row renders ITS OWN content. `org.override` is the row
    // the hot window evicts first and the reason the archive needed a door;
    // asserting only that "some rows appeared" would pass on a reader that
    // returned the first line twice.
    expect(await screen.findByText('orgs/acme')).toBeTruthy()
    expect(screen.getByText('users/carol')).toBeTruthy()
    expect(screen.getByText('Why: enterprise-rate')).toBeTruthy()
    expect(calls[1]).toContain('file=run-a.jsonl')
  })

  it('reports a month with nothing in it as empty, not as an error', async () => {
    global.fetch = jest.fn(async () => ({
      ok: true,
      json: async () => ({ files: [] }),
    })) as unknown as typeof fetch

    render(<AdminAudit />)
    fireEvent.change(screen.getByLabelText('Month'), {
      target: { value: '2026-01' },
    })
    fireEvent.click(screen.getByText('List archive'))
    expect(
      await screen.findByText('Nothing archived for that month.'),
    ).toBeTruthy()
  })

  it('surfaces lines the archive could not parse rather than showing a short list', async () => {
    global.fetch = jest.fn(async (url: any) =>
      String(url).includes('file=')
        ? {
            ok: true,
            json: async () => ({
              rows: [ARCHIVED[0]],
              unreadable: 2,
              total: 3,
            }),
          }
        : {
            ok: true,
            json: async () => ({
              files: [{ name: 'run-a.jsonl', bytes: 10, archivedAt: null }],
            }),
          },
    ) as unknown as typeof fetch

    render(<AdminAudit />)
    fireEvent.change(screen.getByLabelText('Month'), {
      target: { value: '2026-03' },
    })
    fireEvent.click(screen.getByText('List archive'))
    fireEvent.click(await screen.findByText('Open'))

    // One row shown out of three lines, and the page SAYS SO. A compliance
    // trail that renders a shorter list without a word is the 200-row
    // window's defect wearing a different hat.
    expect(
      await screen.findByText(/2 line\(s\) in this object could not be parsed/),
    ).toBeTruthy()
  })

  it('shows the archive route error instead of an empty archive', async () => {
    global.fetch = jest.fn(async () => ({
      ok: false,
      json: async () => ({ error: 'Staff only' }),
    })) as unknown as typeof fetch

    render(<AdminAudit />)
    fireEvent.change(screen.getByLabelText('Month'), {
      target: { value: '2026-03' },
    })
    fireEvent.click(screen.getByText('List archive'))
    // A refusal must not read as "nothing was archived" — opposite
    // conclusions from the same blank card.
    expect(await screen.findByText('Staff only')).toBeTruthy()
    expect(screen.queryByText('Nothing archived for that month.')).toBeNull()
  })
})

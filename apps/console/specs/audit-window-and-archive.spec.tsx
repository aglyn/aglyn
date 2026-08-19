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
 *  - **A constant where a measured value belongs.** `a constant limit cannot
 *    pass` drives the button twice and demands 200 → 400 → 600. A page that
 *    passed a fixed `limit(200)` — the exact defect being fixed — survives
 *    every "is there a button" assertion and fails this one.
 *  - **A window that ends silently.** The end-of-window notice is asserted in
 *    BOTH directions: present when the read came back full, absent when it
 *    did not. A page that always claims there is more is as useless as one
 *    that never does.
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
jest.mock('@aglyn/tenant-feature-instance', () => ({
  __esModule: true,
  useFirestore: () => mockFirestore,
  useUser: () => ({ data: { getIdToken: async () => 'staff-token' } }),
}))

/*==========================================
 * THE QUERY RECORDER.
 *
 * The constraint builders return TAGGED objects and `query` keeps every set
 * it is handed, so an assertion can read what Firestore was actually asked
 * for. This is the difference between testing that a date field exists on
 * the screen and testing that picking a date narrows the read.
 *=========================================*/
const queries: any[][] = []
jest.mock('firebase/firestore', () => ({
  __esModule: true,
  collection: () => ({ kind: 'collection' }),
  query: (...args: any[]) => {
    queries.push(args.slice(1))
    return {}
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
  Timestamp: {
    fromDate: (date: Date) => ({ kind: 'ts', iso: date.toISOString() }),
  },
}))

/*==========================================
 * THE HOOK DOUBLE, MODELLED ON THE REAL ONE.
 *
 * Two behaviours are modelled because both are load-bearing here, and a
 * thinner double hides the thing this file exists to catch:
 *
 *  1. `useFirestoreCollection` re-invokes `buildQuery` from a `useEffect`
 *     keyed on the `deps` array it is handed. Reproducing that makes the
 *     DEPENDENCY ARRAY testable: a page that grows `pageSize` but omits it
 *     from `deps` never re-reads, and a double that called the factory on
 *     every render would report a growing window that never happened.
 *
 *  2. A Firestore read returns `min(limit, available)` rows. `mockRows` is
 *     therefore a POOL, sliced by the limit the page actually asked for.
 *     A double that returned the whole pool regardless would leave the
 *     end-of-window notice permanently on, and one that returned a fixed
 *     count would make the window look exhausted after a single page — which
 *     is exactly what a fixed `limit(200)` does, the defect under test.
 *=========================================*/
let mockRows: any[] = []
jest.mock('../hooks/use-firestore-collection', () => {
  const { useEffect, useState } = require('react')
  return {
    __esModule: true,
    /* eslint-disable react-hooks/rules-of-hooks, react-hooks/exhaustive-deps
       -- this IS the hook; the linter cannot see that from inside a mock
       factory, and the dep list is forwarded from the caller by design. */
    default: (buildQuery: () => unknown, deps: unknown[]) => {
      // `useState` here comes off an untyped `require`, so the type rides on
      // the initial value rather than a type argument (TS2347).
      const [served, setServed] = useState(null as number | null)
      useEffect(() => {
        buildQuery()
        const asked = (queries[queries.length - 1] ?? []).find(
          (entry: any) => entry?.kind === 'limit',
        )
        setServed(asked ? asked.count : null)
      }, deps)
      return {
        data: served == null ? mockRows : mockRows.slice(0, served),
      }
    },
    /* eslint-enable react-hooks/rules-of-hooks, react-hooks/exhaustive-deps */
  }
})

import AdminAudit from '../app/(app)/admin/audit/page'

const AT = { seconds: 1_760_000_000 }

/** N rows, each distinguishable, so nothing can be satisfied by a repeat. */
const rows = (count: number) =>
  Array.from({ length: count }, (_, index) => ({
    $id: `row-${index}`,
    actorUid: `u-${index}`,
    actorEmail: `staff${index}@aglyn.com`,
    action: 'plugins.artifacts.reap',
    target: `plugins/p-${index}`,
    at: AT,
  }))

const lastQuery = () => queries[queries.length - 1] ?? []
const constraint = (kind: string) =>
  lastQuery().filter((entry: any) => entry?.kind === kind)

beforeEach(() => {
  queries.length = 0
  mockRows = []
  jest.clearAllMocks()
})

describe('the audit window can be advanced (AGL-2324)', () => {
  it('asks for a bigger window each time older entries are requested', () => {
    // A pool DEEPER than three pages, so the window stays full across every
    // click and the button cannot vanish for an honest reason mid-test.
    mockRows = rows(650)
    render(<AdminAudit />)

    expect(constraint('limit')[0].count).toBe(200)
    fireEvent.click(screen.getByText('Load older'))
    expect(constraint('limit')[0].count).toBe(400)
    fireEvent.click(screen.getByText('Load older'))
    // 200 → 400 → 600. A page that passed a fixed `limit(200)` — the defect
    // being fixed — renders the same button and fails exactly here.
    expect(constraint('limit')[0].count).toBe(600)
  })

  it('says the window ended, and only when it did', () => {
    // A pool deeper than one page: the read comes back at its 200-row
    // ceiling with more behind it.
    mockRows = rows(500)
    const full = render(<AdminAudit />)
    expect(
      screen.getByText(/Showing the newest 200 entries — there are older ones\./),
    ).toBeTruthy()
    full.unmount()

    // A SHORT window. The read did not reach its ceiling, so this is
    // everything — and claiming otherwise would send an auditor paging
    // through nothing.
    mockRows = rows(12)
    render(<AdminAudit />)
    expect(screen.queryByText(/there are older ones/)).toBeNull()
    expect(screen.queryByText('Load older')).toBeNull()
    expect(screen.getByText(/Showing all 12 entries in range\./)).toBeTruthy()
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

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
 * THE AUDIT LOG PAGES A CURSOR, FILTERS ITS QUERY, AND THE ARCHIVE HAS A
 * DOOR (AGL-2324, AGL-2501, AGL-3321).
 *
 * The page once read `orderBy('at','desc').limit(200)` with no cursor, no
 * date range and no way to ask for row 201, while system-actored,
 * high-frequency actions flooded that window and evicted `org.override` — the
 * lowest-frequency, highest-consequence row.
 *
 * WHAT THIS FILE HAS TO CATCH, and the false greens it is written against:
 *
 *  - **A control that exists but changes no query.** Every assertion about
 *    paging and filtering is made against the CONSTRAINTS HANDED TO
 *    FIRESTORE, recorded by the `firebase/firestore` double.
 *  - **A pager that shows the same rows on every page.** Page two is checked
 *    for what it DOES NOT contain, and for the entry it resumed after.
 *  - **A window that ends silently.** `hasMore` is asserted in BOTH
 *    directions.
 *  - **A slice with no ordering.** The double answers an unordered query in
 *    DOCUMENT-ID order, as Firestore does, and the fixture's id order is not
 *    its date order.
 *  - **A search over the page on screen.** The search reads the log in
 *    batches until it fills a page, and the next page resumes after the last
 *    entry it READ — so a match on the tenth batch is still found.
 */

import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'

jest.mock('@aglyn/aglyn', () => {
  // The action facet groups entries through the plugin activity-action
  // catalog; the real grouping, with no plugin registered, is what the page
  // shows for core actions.
  const actions = jest.requireActual(
    '@aglyn/aglyn/plugin-manager/plugin-activity-actions',
  )
  return {
    __esModule: true,
    orgOverrideReasonSummary: () => null,
    listPluginActivityFilters: actions.listPluginActivityFilters,
    pluginStaffAuditActionGroup: actions.pluginStaffAuditActionGroup,
    pluginStaffAuditActionGroupLabel: actions.pluginStaffAuditActionGroupLabel,
  }
})

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

/** Held: a Firestore handle minted per render would re-run every read. */
const mockFirestore = {}

/** Every query's constraints, in the order the page built them. */
const queries: any[][] = []
let mockRows: any[] = []

/*==========================================
 * A Firestore double that ANSWERS the constraints: equalities and `in`,
 * ranges on `at`, the order, the cursor and the limit. An unordered query is
 * answered in document-id order, as Firestore answers it.
 *=========================================*/
const mockServe = (constraints: any[]) => {
  const seconds = (row: any) => Number(row?.at?.seconds ?? 0)
  let served = [...mockRows].sort((a, b) => String(a.$id).localeCompare(String(b.$id)))
  for (const bound of constraints.filter((entry: any) => entry?.kind === 'where')) {
    served = served.filter((row) => {
      if (bound.field === 'at') {
        const edge = Date.parse(bound.value?.iso ?? '') / 1000
        return bound.op === '>=' ? seconds(row) >= edge : seconds(row) < edge
      }
      if (bound.op === 'in') return bound.value.includes(row[bound.field])
      return row[bound.field] === bound.value
    })
  }
  const order = constraints.find((entry: any) => entry?.kind === 'orderBy')
  if (order) {
    const direction = order.direction === 'desc' ? -1 : 1
    served.sort((a, b) => direction * (seconds(a) - seconds(b)))
  }
  const after = constraints.find((entry: any) => entry?.kind === 'startAfter')
  if (after) {
    served = served.slice(served.findIndex((row) => row.$id === after.cursor.id) + 1)
  }
  const capped = constraints.find((entry: any) => entry?.kind === 'limit')
  return capped ? served.slice(0, capped.count) : served
}

jest.mock('firebase/firestore', () => ({
  __esModule: true,
  collection: () => ({ kind: 'collection' }),
  query: (_ref: unknown, ...constraints: any[]) => {
    queries.push(constraints)
    return { constraints }
  },
  orderBy: (field: string, direction: string) => ({ kind: 'orderBy', field, direction }),
  limit: (count: number) => ({ kind: 'limit', count }),
  startAfter: (cursor: unknown) => ({ kind: 'startAfter', cursor }),
  where: (field: string, op: string, value: unknown) => ({ kind: 'where', field, op, value }),
  documentId: () => '__name__',
  startAt: (value: unknown) => ({ kind: 'startAt', value }),
  endAt: (value: unknown) => ({ kind: 'endAt', value }),
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

jest.mock('@aglyn/tenant-feature-instance', () => ({
  __esModule: true,
  useFirestore: () => mockFirestore,
  useUser: () => ({ data: { getIdToken: async () => 'staff-token' } }),
}))

import AdminAudit from '../app/(app)/admin/audit/page'

/** Seconds, as Firestore hands a `Timestamp` to the browser. */
const AT = { seconds: 1_760_000_000 }

/**
 * `count` rows whose DOCUMENT-ID order is not their date order, so a page
 * that dropped the `orderBy` renders the wrong rows rather than the right
 * ones by accident.
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

const byDate = (pool: any[]) => [...pool].sort((a, b) => b.at.seconds - a.at.seconds)

const lastQuery = () => queries[queries.length - 1] ?? []
const constraint = (kind: string) =>
  lastQuery().filter((entry: any) => entry?.kind === kind)

/** Sets the Filters panel's value on its first column, Action. */
async function filterAction(value: string) {
  fireEvent.click(screen.getByRole('button', { name: /Filters/ }))
  const input = await screen.findByRole('textbox', { name: 'Value' })
  fireEvent.change(input, { target: { value } })
}

beforeEach(() => {
  queries.length = 0
  mockRows = []
  jest.clearAllMocks()
})

describe('the audit log pages a cursor on the shared footer (AGL-2501, AGL-3321)', () => {
  it('THE CONTROL: the fixture can tell an ordered page from an id-ordered one', () => {
    const pool = rows(60)
    expect(byDate(pool)[0].target).not.toBe(pool[0].target)
    expect(new Set(pool.map((row) => row.at.seconds)).size).toBe(pool.length)
  })

  it('opens on the console-wide page size, in the shared grid', async () => {
    mockRows = rows(60)
    render(<AdminAudit />)
    await waitFor(() => expect(targetsOnScreen()).toHaveLength(10))
    expect(constraint('limit')[0].count).toBe(11)
    expect(screen.getByRole('grid')).toBeTruthy()
    expect(screen.getByText('Rows per page:')).toBeTruthy()
  })

  it('fills page one with the NEWEST rows, not an id-ordered sample', async () => {
    mockRows = rows(60)
    render(<AdminAudit />)
    await waitFor(() => expect(targetsOnScreen()).toHaveLength(10))
    expect(targetsOnScreen()).toEqual(byDate(mockRows).slice(0, 10).map((row) => row.target))
    expect(constraint('orderBy')[0]).toMatchObject({ field: 'at', direction: 'desc' })
  })

  it('page two resumes after the last entry page one read, and Back returns', async () => {
    mockRows = rows(60)
    render(<AdminAudit />)
    await waitFor(() => expect(targetsOnScreen()).toHaveLength(10))
    const first = targetsOnScreen()

    fireEvent.click(screen.getByLabelText('Go to next page'))
    await waitFor(() => expect(constraint('startAfter')).toHaveLength(1))
    expect(constraint('startAfter')[0].cursor.id).toBe(byDate(mockRows)[9].$id)
    await waitFor(() =>
      expect(targetsOnScreen()).toEqual(byDate(mockRows).slice(10, 20).map((row) => row.target)),
    )
    for (const target of first) expect(targetsOnScreen()).not.toContain(target)

    fireEvent.click(screen.getByLabelText('Go to previous page'))
    await waitFor(() => expect(targetsOnScreen()).toEqual(first))
    expect(constraint('startAfter')).toHaveLength(0)
  })

  it('carries the chosen page size into the READ', async () => {
    mockRows = rows(60)
    render(<AdminAudit />)
    await waitFor(() => expect(targetsOnScreen()).toHaveLength(10))

    fireEvent.mouseDown(screen.getByLabelText('Rows per page:'))
    fireEvent.click(screen.getByRole('option', { name: '25' }))

    await waitFor(() => expect(constraint('limit')[0].count).toBe(26))
    await waitFor(() => expect(targetsOnScreen()).toHaveLength(25))
  })

  it('offers a next page only when there is one', async () => {
    mockRows = rows(60)
    const deep = render(<AdminAudit />)
    await waitFor(() => expect(targetsOnScreen()).toHaveLength(10))
    expect((screen.getByLabelText('Go to next page') as HTMLButtonElement).disabled).toBe(false)
    deep.unmount()

    mockRows = rows(4)
    render(<AdminAudit />)
    await waitFor(() => expect(targetsOnScreen()).toHaveLength(4))
    expect((screen.getByLabelText('Go to next page') as HTMLButtonElement).disabled).toBe(true)
  })
})

describe('the audit log filters its QUERY (AGL-3321)', () => {
  it('puts an Action filter onto the query, beneath the date sort', async () => {
    mockRows = [
      ...rows(30),
      { ...rows(1)[0], $id: 'override', action: 'org.override', target: 'orgs/acme' },
    ]
    render(<AdminAudit />)
    await waitFor(() => expect(targetsOnScreen()).toHaveLength(10))
    await filterAction('org.override')
    await waitFor(() =>
      expect(constraint('where')).toEqual([
        { kind: 'where', field: 'action', op: '==', value: 'org.override' },
      ]),
    )
    expect(constraint('orderBy')[0]).toMatchObject({ field: 'at', direction: 'desc' })
    expect(await screen.findByText('orgs/acme')).toBeTruthy()
    // A filter change is a new query: page one, no cursor.
    expect(constraint('startAfter')).toHaveLength(0)
  })

  it('searches the whole log, reading batches until a page is full', async () => {
    // One match per twenty entries, so a page of three spans several batches
    // and page one on screen holds none of the later ones.
    mockRows = rows(200).map((row, index) => ({
      ...row,
      actorEmail: index % 20 === 0 ? `auditor${index}@aglyn.com` : row.actorEmail,
    }))
    render(<AdminAudit />)
    await waitFor(() => expect(targetsOnScreen()).toHaveLength(10))
    act(() => {
      fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'auditor' } })
    })
    const matches = byDate(mockRows.filter((row) => row.actorEmail.startsWith('auditor')))
    await waitFor(
      () => expect(targetsOnScreen()).toEqual(matches.slice(0, 10).map((row) => row.target)),
      { timeout: 3000 },
    )
    // Batches larger than a page, and never a filter the query cannot serve.
    expect(constraint('limit')[0].count).toBe(100)
    expect(constraint('where')).toEqual([])
    expect(screen.getByText(/each page looks through up to 500 entries/)).toBeTruthy()
  })

  it('a search the page cannot fill says there is more rather than ending', async () => {
    mockRows = rows(600)
    render(<AdminAudit />)
    await waitFor(() => expect(targetsOnScreen()).toHaveLength(10))
    act(() => {
      fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'no-such-actor' } })
    })
    await waitFor(
      () => expect(screen.getByText('No audit entries match these filters')).toBeTruthy(),
      { timeout: 3000 },
    )
    // 500 read, 100 left: the walk stopped at its budget, not at the end.
    expect((screen.getByLabelText('Go to next page') as HTMLButtonElement).disabled).toBe(false)
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
    expect(await screen.findByText('tenant pool: tenant-northwind')).toBeTruthy()
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

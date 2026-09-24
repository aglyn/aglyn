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
 * THE AUDIT LOG READS THE FIELDS IT IS WRITTEN (AGL-2287), THROUGH ITS
 * TOOLBAR (AGL-3321).
 *
 * `admin/lockdown/route.ts` stores `scope` on every audit row so the log can
 * filter by it: it is derivable from `target` only by prefix-matching a path,
 * and `lockdowns/` alone covers several different scopes. Nine routes write
 * `actorEmail`, the only identifier a reviewer outside engineering has.
 *
 * Every assertion drives the rendered page: a chip that carries the row's
 * value, a Scope pick in the grid's Filters panel that changes which rows
 * survive, a search that matches on the email, and an exported CSV whose
 * bytes are read back. The load-bearing case is two rows differing ONLY in
 * `scope`, under the same `lockdowns/` target prefix.
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

const ROWS = [
  {
    $id: 'row-platform',
    at: { seconds: AT.seconds + 3 },
    actorUid: 'uid-alice',
    actorEmail: 'alice@aglyn.com',
    action: 'lockdown.lock',
    scope: 'platform',
    target: 'lockdowns/platform',
  },
  {
    $id: 'row-host',
    at: { seconds: AT.seconds + 2 },
    actorUid: 'uid-bob',
    actorEmail: 'bob@aglyn.com',
    action: 'lockdown.lock',
    scope: 'host',
    target: 'lockdowns/host-77',
  },
  {
    $id: 'row-asset',
    at: { seconds: AT.seconds + 1 },
    actorUid: 'uid-carol',
    actorEmail: 'carol@aglyn.com',
    action: 'mediaQuarantine.quarantine',
    scope: 'asset',
    target: 'mediaQuarantines/index',
  },
]

const lastQuery = () => queries[queries.length - 1] ?? []
const constraint = (kind: string) =>
  lastQuery().filter((entry: any) => entry?.kind === kind)

/** Picks a column and a value in the grid's Filters panel. */
async function pickFilter(column: string, value: string) {
  fireEvent.click(screen.getByRole('button', { name: /Filters/ }))
  fireEvent.mouseDown(await screen.findByRole('combobox', { name: 'Column' }))
  act(() => {
    fireEvent.click(screen.getByRole('option', { name: column }))
  })
  fireEvent.mouseDown(await screen.findByRole('combobox', { name: 'Value' }))
  return screen.findByRole('option', { name: value })
}

beforeEach(() => {
  queries.length = 0
  mockRows = ROWS.map((row) => ({ ...row }))
})

describe('the staff audit log surfaces scope and actorEmail', () => {
  it('renders the row’s own scope, not a constant', async () => {
    render(<AdminAudit />)
    // Each value once, from its own row. A page rendering a fixed string, or
    // deriving one from the shared `lockdowns/` prefix, cannot produce three.
    expect(await screen.findByText('platform')).toBeTruthy()
    expect(screen.getByText('host')).toBeTruthy()
    expect(screen.getByText('asset')).toBeTruthy()
  })

  it('names the actor by email, keeping the uid', async () => {
    render(<AdminAudit />)
    expect(await screen.findByText('alice@aglyn.com (uid-alice)')).toBeTruthy()
  })

  it('falls back to the uid on a row written before actorEmail', async () => {
    mockRows = [{ ...ROWS[0], actorEmail: undefined }]
    render(<AdminAudit />)
    expect(await screen.findByText('uid-alice')).toBeTruthy()
    expect(screen.queryByText(/alice@aglyn\.com/)).toBeNull()
  })

  it('a Scope pick separates two rows with the SAME target prefix, across the log', async () => {
    render(<AdminAudit />)
    await screen.findByText('lockdowns/platform')
    const host = await pickFilter('Scope', 'host')
    act(() => {
      fireEvent.click(host)
    })
    // THE ASSERTION. The two lockdown rows share `lockdowns/` and differ only
    // in `scope`, so a filter that survived on `target` would keep both.
    await waitFor(() => expect(screen.queryByText('lockdowns/platform')).toBeNull())
    expect(screen.getByText('lockdowns/host-77')).toBeTruthy()
    expect(screen.queryByText('mediaQuarantines/index')).toBeNull()
    // Matched as the log is read — `scope` has no composite — and said so.
    expect(constraint('where')).toEqual([])
    expect(screen.getByText(/matched as the log is read/)).toBeTruthy()
    expect(screen.getByText('Scope is host')).toBeTruthy()
  })

  it('offers exactly the scopes the log has shown — no phantom facet', async () => {
    mockRows = [{ ...ROWS[0] }]
    render(<AdminAudit />)
    await screen.findByText('lockdowns/platform')
    expect(await pickFilter('Scope', 'platform')).toBeTruthy()
    expect(screen.queryByRole('option', { name: 'host' })).toBeNull()
    expect(screen.queryByRole('option', { name: 'asset' })).toBeNull()
  })

  it('the search matches an actor’s email address', async () => {
    render(<AdminAudit />)
    await screen.findByText('lockdowns/platform')
    act(() => {
      fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'carol@aglyn.com' } })
    })
    await waitFor(() => expect(screen.queryByText('lockdowns/platform')).toBeNull(), {
      timeout: 3000,
    })
    expect(screen.getByText('mediaQuarantines/index')).toBeTruthy()
  })

  it('the compliance CSV carries scope and actorEmail as columns', async () => {
    // jsdom's `Blob` has no `.text()`, so the CONTENT is captured at
    // construction rather than read back off the object. Recording the parts
    // is also the stricter check: it sees exactly the string the page built,
    // with no encoding round trip in between to launder a mistake.
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
      render(<AdminAudit />)
      await screen.findByText('lockdowns/platform')
      fireEvent.click(screen.getByText('Export CSV'))
      await waitFor(() => expect(written).toHaveLength(1))
      const [header, ...rows] = written[0].split('\n')
      // The header names them…
      expect(header.split(',')).toEqual([
        'at',
        'actorUid',
        'actorEmail',
        'action',
        'scope',
        'target',
        // AGL-2324 gave the staff-access review its column.
        'targetTenantId',
        'reason',
        'note',
        'before',
        'after',
      ])
      // …and the rows carry the VALUES. A header with empty columns under it
      // is the same silence with a label on top.
      expect(rows[0]).toContain('alice@aglyn.com')
      expect(rows[0]).toContain('platform')
      expect(rows[1]).toContain('bob@aglyn.com')
      expect(rows[1]).toContain('host')
    } finally {
      ;(globalThis as any).Blob = OriginalBlob
      ;(URL as any).createObjectURL = originalCreate
      ;(URL as any).revokeObjectURL = originalRevoke
    }
  })
})

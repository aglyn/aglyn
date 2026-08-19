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
 * THE AUDIT LOG READS THE FIELDS IT IS WRITTEN (AGL-2287).
 *
 * `admin/lockdown/route.ts` stores `scope` on every audit row and says why, in
 * the field's own docblock:
 *
 * > "Stored top-level so the audit log filters by scope on an equality match.
 * >  It is derivable from `target`, but only by prefix-matching a path — and
 * >  `lockdowns/` alone covers three different scopes."
 *
 * Five call sites wrote it — the five lockdown branches, media quarantine,
 * abuse reports, DMCA counter-notices. The audit log did not filter on it, did
 * not display it, and did not export it. Nine routes likewise wrote
 * `actorEmail`, and all three readers projected `actorUid` alone, so an
 * auditor searching for a colleague by the only identifier they have got
 * nothing off a log that had been storing exactly that string all along.
 *
 * WHAT THIS FILE HAS TO CATCH. Not "does the word `scope` appear in the
 * file" — a docblock satisfies that, and a guard satisfied by its own comment
 * is the false green this sweep exists to end. Every assertion below drives
 * the rendered page: a chip that carries the row's value, a select that
 * changes which rows survive, a text filter that matches on the email, and an
 * exported CSV whose bytes are read back.
 *
 * The load-bearing shape is that two rows differing ONLY in `scope` must be
 * separable. A page that rendered a constant, or filtered on `target` and
 * happened to agree, dies on the two `lockdowns/…` rows below — which is
 * precisely the case the writers' comment says a path prefix cannot answer.
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

jest.mock('@aglyn/tenant-feature-instance', () => ({
  __esModule: true,
  useFirestore: () => ({}),
}))

jest.mock('firebase/firestore', () => ({
  __esModule: true,
  collection: () => ({}),
  query: () => ({}),
  orderBy: () => ({}),
  limit: () => ({}),
}))

/**
 * The rows the page is handed. Modelled as the collection hook's real return
 * shape — `{ data }` with an `$id` per row — because a double thinner than the
 * thing it stands in for hides the change it is meant to catch.
 */
let mockRows: any[] = []
jest.mock('../hooks/use-firestore-collection', () => ({
  __esModule: true,
  default: () => ({ data: mockRows }),
}))

import AdminAudit from '../app/(app)/admin/audit/page'

/** Seconds, as Firestore hands a `Timestamp` to the browser. */
const AT = { seconds: 1_760_000_000 }

/**
 * Two lockdown rows under the SAME `lockdowns/` target prefix and two
 * different scopes, plus one row from a different subsystem.
 *
 * The first two are the case the writers' comment names: their targets cannot
 * distinguish them, so anything that separates them has to be reading `scope`.
 */
const ROWS = [
  {
    $id: 'row-platform',
    at: AT,
    actorUid: 'uid-alice',
    actorEmail: 'alice@aglyn.com',
    action: 'lockdown.lock',
    scope: 'platform',
    target: 'lockdowns/platform',
  },
  {
    $id: 'row-host',
    at: AT,
    actorUid: 'uid-bob',
    actorEmail: 'bob@aglyn.com',
    action: 'lockdown.lock',
    scope: 'host',
    target: 'lockdowns/host-77',
  },
  {
    $id: 'row-asset',
    at: AT,
    actorUid: 'uid-carol',
    actorEmail: 'carol@aglyn.com',
    action: 'mediaQuarantine.quarantine',
    scope: 'asset',
    target: 'mediaQuarantines/index',
  },
]

beforeEach(() => {
  mockRows = ROWS.map((row) => ({ ...row }))
})

describe('the staff audit log surfaces scope and actorEmail', () => {
  it('renders the row’s own scope, not a constant', () => {
    render(<AdminAudit />)
    // Each value once, from its own row. A page rendering a fixed string, or
    // deriving one from the shared `lockdowns/` prefix, cannot produce three.
    expect(screen.getByText('platform')).toBeTruthy()
    expect(screen.getByText('host')).toBeTruthy()
    expect(screen.getByText('asset')).toBeTruthy()
  })

  it('names the actor by email, keeping the uid', () => {
    render(<AdminAudit />)
    // Both halves: the email is what an auditor outside engineering can act
    // on, and the uid is the identifier that survives a mailbox change.
    expect(
      screen.getByText(/alice@aglyn\.com \(uid-alice\)/),
    ).toBeTruthy()
  })

  it('falls back to the uid on a row written before actorEmail', () => {
    mockRows = [{ ...ROWS[0], actorEmail: undefined }]
    render(<AdminAudit />)
    expect(screen.getByText(/uid-alice/)).toBeTruthy()
    expect(screen.queryByText(/alice@aglyn\.com/)).toBeNull()
  })

  it('the Scope select separates two rows with the SAME target prefix', () => {
    const { container } = render(<AdminAudit />)
    expect(screen.getByText('lockdowns/platform')).toBeTruthy()
    expect(screen.getByText('lockdowns/host-77')).toBeTruthy()

    // MUI renders the select through a hidden native input; setting it is the
    // only interaction that does not depend on the popup's portal.
    const select = container.querySelector(
      'input[name="scope"], select',
    ) as HTMLSelectElement | null
    if (select) {
      fireEvent.change(select, { target: { value: 'host' } })
    } else {
      fireEvent.mouseDown(screen.getByRole('combobox'))
      fireEvent.click(screen.getByRole('option', { name: 'host' }))
    }

    // THE ASSERTION. The two lockdown rows share `lockdowns/` and differ only
    // in `scope`, so a filter that survived on `target` would keep both.
    expect(screen.queryByText('lockdowns/platform')).toBeNull()
    expect(screen.getByText('lockdowns/host-77')).toBeTruthy()
    expect(screen.queryByText('mediaQuarantines/index')).toBeNull()
  })

  it('offers exactly the scopes present — no phantom facet', () => {
    // The other half of the same defect: a hardcoded vocabulary would offer
    // options that match nothing, which is a filter that lies about coverage.
    mockRows = [{ ...ROWS[0] }]
    render(<AdminAudit />)
    fireEvent.mouseDown(screen.getByRole('combobox'))
    expect(screen.getByRole('option', { name: 'platform' })).toBeTruthy()
    expect(screen.queryByRole('option', { name: 'host' })).toBeNull()
    expect(screen.queryByRole('option', { name: 'asset' })).toBeNull()
  })

  it('the free-text filter matches an actor’s email address', () => {
    render(<AdminAudit />)
    fireEvent.change(
      screen.getByLabelText(/Filter \(actor, email, action, target\)/),
      { target: { value: 'carol@aglyn.com' } },
    )
    expect(screen.getByText('mediaQuarantines/index')).toBeTruthy()
    expect(screen.queryByText('lockdowns/platform')).toBeNull()
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

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
 * A console list shows ALL of its collection, in the order it says (AGL-2501).
 *
 * The reusable-components card read `limit(100)` with no `orderBy` and sorted
 * the result by `displayName` in the browser. That is the eighth time this
 * repo has shipped that shape, and it is invisible from the outside: the rows
 * on screen run in a believable alphabetical order, they are simply the wrong
 * rows — Firestore answers an unordered limit in DOCUMENT-ID order, and these
 * ids are generated — and the components past the hundredth leave no gap to
 * notice.
 *
 * ## Why this file models Firestore rather than stubbing it
 *
 * A fixture that hands the component a ready-made array proves nothing: it
 * answers the same rows whether the query orders, caps, or does neither, so
 * every assertion below would pass on the bug. `mockEvaluateQuery` applies the
 * three rules the fix actually depends on —
 *
 *  1. results come back in document-id order unless an `orderBy` says
 *     otherwise;
 *  2. an `orderBy` matches only documents that HAVE that field;
 *  3. `limit` truncates AFTER ordering —
 *
 * so a query that drops one of them fails here. The control at the bottom
 * proves the model itself bites, by running the OLD query against the same
 * fixture and showing what it could not reach.
 *
 * The fixture is deliberately anti-correlated: document ids ascend while the
 * names they carry descend, so an id-ordered page and a name-ordered page
 * share no rows at all. A fixture where the two orders agree would pass on
 * both the bug and the fix.
 */

import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import type { ReactNode } from 'react'

/** How many components the fake site holds — comfortably over the old cap. */
const TOTAL = 120
/** The old, unordered ceiling this list used to read. */
const LEGACY_CAP = 100

interface SeededDoc {
  $id: string
  displayName?: string
  deletedAt?: unknown
}

/**
 * `cmp-000` carries the LAST name and `cmp-119` the first, so the two orders
 * are exact opposites. `cmp-042` carries no name at all — the shape that makes
 * `orderBy('displayName')` a data-loss bug rather than a sorting one — and
 * `cmp-007` is a tombstone, which a delete leaves behind in place.
 */
const NAMELESS_ID = 'cmp-042'
const DELETED_ID = 'cmp-007'
const seedComponents = (): SeededDoc[] =>
  Array.from({ length: TOTAL }, (_unused, index) => {
    const id = `cmp-${String(index).padStart(3, '0')}`
    const doc: SeededDoc = { $id: id }
    if (id !== NAMELESS_ID) {
      doc.displayName = `Component ${String(TOTAL - 1 - index).padStart(3, '0')}`
    }
    if (id === DELETED_ID) doc.deletedAt = { seconds: 1 }
    return doc
  })

/** The name `cmp-{index}` carries, for asserting a specific row is on screen. */
const nameOf = (index: number) =>
  `Component ${String(TOTAL - 1 - index).padStart(3, '0')}`

/** What the mocked collection hook answers over, and every cap it was asked. */
let mockDocs: SeededDoc[] = []
let mockLimitsAsked: number[] = []

/**
 * ONE Firestore instance for the life of the suite, like the real hook.
 *
 * `useFirestore: () => ({})` hands back a new object on every render, and
 * `usePagedCollection` resets to page one whenever its deps change — so the
 * list would jump home on every render and no amount of clicking Next would
 * ever move it. A stable identity is part of the contract being exercised.
 */
let mockDb: Record<string, never> | undefined
function mockFirestoreInstance() {
  if (!mockDb) mockDb = {}
  return mockDb
}

/**
 * Firestore's answer to a query, modelled.
 *
 * `mock`-prefixed and declared as a hoisted function so the `jest.mock`
 * factory below may reference it — the factory runs at require time, which is
 * before any `const` in this file has been initialized.
 */
function mockEvaluateQuery(request: any, docs: SeededDoc[]): SeededDoc[] {
  // RULE 1: with no explicit order, results arrive in document-id order.
  let rows = [...docs].sort((a, b) => (a.$id < b.$id ? -1 : 1))
  const clauses = request.constraints.filter(
    (clause: any) => clause.type === 'orderBy',
  )
  for (const clause of clauses) {
    // RULE 2: an `orderBy` matches only documents that HAVE the field. This
    // is the whole reason the shared builder orders on the document name.
    if (clause.field !== '__name__') {
      rows = rows.filter(
        (row: any) => (row as any)[clause.field] !== undefined,
      )
    }
    rows = [...rows].sort((a: any, b: any) => {
      const left = clause.field === '__name__' ? a.$id : a[clause.field]
      const right = clause.field === '__name__' ? b.$id : b[clause.field]
      const order = left < right ? -1 : left > right ? 1 : 0
      return clause.direction === 'desc' ? -order : order
    })
  }
  const cap = request.constraints.find((clause: any) => clause.type === 'limit')
  // RULE 3: the cap truncates the ORDERED result, not the collection.
  return cap ? rows.slice(0, cap.value) : rows
}

jest.mock('firebase/firestore', () => ({
  __esModule: true,
  collection: (_db: unknown, ...segments: string[]) => ({
    path: segments.join('/'),
    constraints: [] as unknown[],
  }),
  documentId: () => '__name__',
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
  setDoc: jest.fn().mockResolvedValue(undefined),
  updateDoc: jest.fn().mockResolvedValue(undefined),
  // The card's head-count. Answering it keeps `useLiveArtifactCount` off the
  // network without stubbing the card's own arithmetic.
  getCountFromServer: jest
    .fn()
    .mockResolvedValue({ data: () => ({ count: 0 }) }),
}))

jest.mock('../../../libs/tenant/feature/instance/src/lib/hooks/use-firestore-collection', () => ({
  __esModule: true,
  useFirestoreCollection: (build: () => any) => {
    const request = build()
    if (request) {
      const cap = request.constraints.find(
        (clause: any) => clause.type === 'limit',
      )
      if (cap) mockLimitsAsked.push(cap.value)
    }
    return {
      data: request ? mockEvaluateQuery(request, mockDocs) : undefined,
      status: 'success',
      error: undefined,
      fromCache: false,
      serverDenied: false,
    }
  },
}))

/*
 * The REAL `usePagedCollection`, reached by its own module path rather than
 * through the barrel — the barrel is mocked below, and the hook imports its
 * collection hook relatively, so mocking that leaf is what keeps the window
 * arithmetic real while nothing touches Firestore.
 */
jest.mock('@aglyn/tenant-feature-instance', () => ({
  __esModule: true,
  useFirestore: () => mockFirestoreInstance(),
  useUser: () => ({ data: { uid: 'uid-1', getIdToken: async () => 't' } }),
  useHostVersionApi: () => jest.fn(),
  /*
   * The catalog's head-count, which reaches the card through the barrel now
   * that a plugin surface needs it too. Answered rather than left to the real
   * hook so the card's quota arithmetic stays real without a network read.
   */
  useLiveArtifactCount: () => 0,
  writeGuardedBySeed: jest.fn(),
  usePagedCollection: jest.requireActual(
    '../../../libs/tenant/feature/instance/src/lib/hooks/use-paged-collection',
  ).usePagedCollection,
}))

jest.mock('@aglyn/shared-ui-jsx', () => ({
  __esModule: true,
  AppLink: ({ children }: { children: ReactNode }) => <span>{children}</span>,
  CardDisplay: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  MdiIcon: () => null,
  useConfirmationContext: () => ({
    confirm: jest.fn().mockRejectedValue(undefined),
  }),
}))

jest.mock('@aglyn/shared-ui-snackstack', () => ({
  __esModule: true,
  useSnackbar: () => ({ enqueueSnackbar: jest.fn() }),
}))

jest.mock('next/navigation', () => ({
  __esModule: true,
  useRouter: () => ({ push: jest.fn() }),
}))

jest.mock('../hooks/use-current-org', () => ({
  __esModule: true,
  default: () => ({ org: { $id: 'org-1', plan: 'business' }, ready: true }),
}))

jest.mock('../hooks/use-presence-summary', () => ({
  __esModule: true,
  default: () => ({ peopleIn: () => [], ready: true }),
}))

jest.mock('../hooks/use-org-scope', () => ({
  __esModule: true,
  useOrgSlug: () => 'acme',
}))

jest.mock('../components/host-id-provider', () => ({
  __esModule: true,
  useHostSubdomain: () => 'demo',
  useHostId: () => 'host-1',
}))

jest.mock('../components/document-presence-chips.component', () => ({
  __esModule: true,
  default: () => null,
}))

jest.mock('../components/component-icon-field.component', () => ({
  __esModule: true,
  default: () => null,
}))

jest.mock('../components/templates/save-as-template-dialog.component', () => ({
  __esModule: true,
  default: () => null,
}))

jest.mock('../components/artifacts/artifact-delete-confirm.component', () => ({
  __esModule: true,
  default: () => null,
  fetchArtifactUsage: jest.fn().mockResolvedValue({ usages: [] }),
}))

import HostComponentsCard from '../components/host-components-card.component'
import {
  ceilingedWindow,
  hostArtifactQuery,
} from '../utils/host-artifact-queries'
import { TABLE_PAGE_SIZE_DEFAULT } from '../constants/shared'

beforeEach(() => {
  mockDocs = seedComponents()
  mockLimitsAsked = []
})

/** Every component name currently rendered in the grid, in row order. */
const visibleNames = () =>
  screen
    .getAllByRole('row')
    // The header row has column headers, not cells.
    .filter((row) => within(row).queryAllByRole('gridcell').length > 0)
    .map((row) => within(row).getAllByRole('gridcell')[0].textContent ?? '')

const nextPage = () =>
  fireEvent.click(screen.getByRole('button', { name: /go to next page/i }))

/** Click Next until the window covers `index`, at the default page size. */
const pageTo = async (index: number) => {
  await waitFor(() => expect(visibleNames().length).toBeGreaterThan(0))
  const target = Math.floor(index / TABLE_PAGE_SIZE_DEFAULT)
  for (let click = 0; click < target; click += 1) {
    nextPage()
    // Each click widens the listener by one page, so the rows for the new
    // page have to arrive before the next click reads the footer's geometry.
    await waitFor(() => expect(visibleNames().length).toBeGreaterThan(0))
  }
}

describe('the components list pages an ORDERED walk (AGL-2501)', () => {
  it('opens on the head of the walk, not on an alphabetized sample', async () => {
    render(<HostComponentsCard hostId="host-1" />)
    await waitFor(() => expect(visibleNames().length).toBeGreaterThan(0))
    /*
     * The first page is `cmp-000`…, which carry the LAST names. The old query
     * read `cmp-000`…`cmp-099` and then sorted them by name, so its first page
     * was the other end of the fixture entirely — `Component 020` downward.
     * Asserting the names on the page rather than merely that ten rows
     * rendered is what makes this fail on the old behaviour.
     */
    expect(visibleNames()[0]).toBe(nameOf(0))
    expect(visibleNames()).not.toContain(nameOf(TOTAL - 1))
  })

  it('reads only the page it renders, never the whole collection', () => {
    render(<HostComponentsCard hostId="host-1" />)
    // The page plus one probe row, and nothing wider. The old read asked for
    // a hundred documents to render a table nobody had scrolled.
    expect(Math.max(...mockLimitsAsked)).toBe(TABLE_PAGE_SIZE_DEFAULT + 1)
    expect(Math.max(...mockLimitsAsked)).toBeLessThan(LEGACY_CAP)
  })

  it('reaches the components past the old cap', async () => {
    render(<HostComponentsCard hostId="host-1" />)
    // Page 11 holds `cmp-110`…`cmp-119` — the band the old `limit(100)` could
    // not reach from any page, on any click, ever.
    await pageTo(TOTAL - 1)
    await waitFor(() => expect(visibleNames()).toContain(nameOf(TOTAL - 1)))
  })

  it('keeps a component that has no name at all', async () => {
    // `orderBy('displayName')` would have dropped this row rather than
    // mis-placing it — the failure the shared builder's document-id order
    // exists to avoid, and the one a reader could never diagnose. The grid
    // falls back to the id, so that is what the row reads.
    render(<HostComponentsCard hostId="host-1" />)
    await pageTo(42)
    await waitFor(() => expect(visibleNames()).toContain(NAMELESS_ID))
  })

  it('never renders a deleted component', async () => {
    render(<HostComponentsCard hostId="host-1" />)
    await waitFor(() => expect(visibleNames().length).toBeGreaterThan(0))
    // A tombstone spends its slot in the page it falls in, so the first page
    // is one row short — that is the documented cost, and it must not be a
    // row.
    expect(visibleNames()).not.toContain(nameOf(7))
    expect(visibleNames().length).toBe(TABLE_PAGE_SIZE_DEFAULT - 1)
  })
})

describe('THE CONTROL: the Firestore model bites (AGL-2501)', () => {
  /*
   * Without these, every assertion above could pass against a model that
   * ignored `orderBy` and `limit` entirely — the fixture would be answering
   * "all 120 documents" to every query and the card would look correct
   * whatever it asked for.
   */
  const evaluate = (request: any) => mockEvaluateQuery(request, seedComponents())

  it('the OLD query cannot reach the tail of the collection', () => {
    // Rebuilt here rather than remembered: `limit()` with no `orderBy`, which
    // is what this card shipped. Document-id order, truncated at a hundred.
    const legacy = {
      path: 'hosts/host-1/components',
      constraints: [{ type: 'limit', value: LEGACY_CAP }],
    }
    const ids = evaluate(legacy).map((row) => row.$id)
    expect(ids).toHaveLength(LEGACY_CAP)
    expect(ids[0]).toBe('cmp-000')
    expect(ids).not.toContain('cmp-119')
  })

  it('ordering on `displayName` DROPS the document that has none', () => {
    const byName = {
      path: 'hosts/host-1/components',
      constraints: [{ type: 'orderBy', field: 'displayName', direction: 'asc' }],
    }
    const ids = evaluate(byName).map((row) => row.$id)
    expect(ids).toHaveLength(TOTAL - 1)
    expect(ids).not.toContain(NAMELESS_ID)
  })

  it('ordering on the document name drops nothing and is total', () => {
    const request = hostArtifactQuery(
      {} as never,
      'host-1',
      'components',
      TOTAL,
    ) as unknown as any
    const ids = evaluate(request).map((row) => row.$id)
    expect(ids).toHaveLength(TOTAL)
    expect(ids).toContain(NAMELESS_ID)
    expect(ids[0]).toBe('cmp-000')
    expect(ids[TOTAL - 1]).toBe('cmp-119')
  })

  it('the shared builder is what the card asks with', () => {
    // The three assertions above are about `hostArtifactQuery`. This is what
    // ties them to the surface: a card that hand-rolled its own query would
    // pass all of them and still ship the bug.
    const asked = hostArtifactQuery({} as never, 'host-1', 'components', 11)
    render(<HostComponentsCard hostId="host-1" />)
    expect((asked as unknown as any).path).toBe('hosts/host-1/components')
    expect(mockLimitsAsked).toContain(TABLE_PAGE_SIZE_DEFAULT + 1)
  })
})

/**
 * The two lists that cannot be paged still say when they are short (AGL-2501).
 *
 * The screens tree and the template library read a CEILING rather than a page,
 * because slicing either by document breaks the thing it is drawing — a child
 * separated from its parent, a starter bundle rendered twice and partial each
 * time. A ceiling with nothing measuring it is a partial site drawn as a whole
 * one, which is the failure paging solves everywhere else.
 */
describe('a ceilinged read knows when it was cut short (AGL-2501)', () => {
  const rowsNamed = (count: number) =>
    Array.from({ length: count }, (_unused, index) => ({ $id: `row-${index}` }))

  it('is not truncated when the collection exactly fills the ceiling', () => {
    // The even-multiple case, which a `length === ceiling` comparison gets
    // wrong: it would warn a site of exactly 200 screens that it has more.
    const window = ceilingedWindow(rowsNamed(200), 200)
    expect(window.rows).toHaveLength(200)
    expect(window.truncated).toBe(false)
  })

  it('one document past the ceiling is a FACT, and never a row', () => {
    const window = ceilingedWindow(rowsNamed(201), 200)
    expect(window.truncated).toBe(true)
    // The probe is not rendered: a caller drawing 201 rows would be
    // describing a window it did not draw.
    expect(window.rows).toHaveLength(200)
    expect(window.rows.at(-1)).toEqual({ $id: 'row-199' })
  })

  it('a pending read is short, not truncated', () => {
    // `undefined` is "not answered yet". Reading it as truncation would put a
    // ceiling warning on every mount, before anything had been read at all.
    expect(ceilingedWindow(undefined, 200)).toEqual({
      rows: [],
      truncated: false,
    })
  })
})

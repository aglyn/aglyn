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
 * Two marketing lists, two different answers (AGL-2501).
 *
 * Both were `limit(50)` with no `orderBy` and a client sort on top, so both
 * were arbitrary fifty-document samples arranged into a convincing order. Both
 * now name their ordering. Only ONE of them is paged, and the difference is
 * the point of this file.
 *
 * ## Experiments: paged
 *
 * A flat list, sorted by name, with nothing about a row that depends on the
 * row above it. It pages by query — the list query (AGL-3321), answered here
 * by its test double, which runs the real plan and answers it the way
 * Firestore would.
 *
 * ## Overlays: ordered and ceilinged, deliberately NOT paged
 *
 * The row order IS the feature — the first enabled overlay of each kind is the
 * one a visitor sees — and the arrows reorder by swapping `order` with the
 * ADJACENT row. A page boundary separates a row from the neighbor it would
 * trade places with, so the eleventh overlay could never be moved into tenth
 * place. That is the same reason the console's screen tree and starter bundles
 * are ceilinged rather than paged.
 *
 * And the obvious server-side fix is the trap: `orderBy('order')` would not
 * mis-sort this list, it would HIDE every overlay nobody has ever reordered,
 * because `EMPTY_BAR` and `EMPTY_POPUP` carry no `order` and only the arrows
 * ever write one. The fixture is mostly such overlays, and the drop is
 * asserted rather than described.
 */

import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { TABLE_PAGE_SIZE_DEFAULT } from '@aglyn/shared-ui-jsx/const/table-pagination'
import { nameSearchFields } from '@aglyn/aglyn/app-utils/name-search'
import {
  lastListQueryPlan,
  useListQueryDouble,
} from '@aglyn/tenant-feature-instance/testing/list-query-double'

jest.setTimeout(30_000)

const EXPERIMENTS = 34
const OVERLAY_CEILING = 50
const OVERLAYS = 12

/**
 * Ids run OPPOSITE to names, so an id-ordered window holds the END of the
 * alphabet and re-sorting it by name — the old behaviour — starts the table on
 * the wrong letter.
 */
const mockExperimentDocs = Array.from({ length: EXPERIMENTS }, (_, index) => ({
  $id: `exp-${String(EXPERIMENTS - 1 - index).padStart(2, '0')}`,
  // The keys every writer stamps beside the name (AGL-3321).
  ...nameSearchFields(`Test ${String(index).padStart(2, '0')}`),
  status: index === 30 ? 'running' : 'draft',
  target: 'screen',
  screenId: 'screen-1',
  variants: [{ id: 'a', name: 'A', weight: 1 }],
}))
const experimentDocs = mockExperimentDocs

/**
 * Overlays, mostly without `order` — the shape a site actually has, because
 * only the up/down arrows ever write that field. Two have been reordered.
 */
const overlayDocs = Array.from({ length: OVERLAYS }, (_, index) => ({
  $id: `ovl-${String(OVERLAYS - 1 - index).padStart(2, '0')}`,
  name: `Banner ${String(index).padStart(2, '0')}`,
  kind: 'bar',
  enabled: true,
  bar: { text: `Bar ${index}`, dismissible: true },
  ...(index === 5 ? { order: -2 } : index === 7 ? { order: -1 } : {}),
}))

const byCollection: Record<string, Array<Record<string, any>>> = {
  experiments: experimentDocs,
  overlays: overlayDocs,
  screens: [],
  versions: [],
  campaigns: [],
}

const firestoreAnswer = (
  all: Array<Record<string, any>>,
  constraints: Array<Record<string, any>>,
) => {
  const order = constraints.find((item) => 'orderBy' in item)
  const cap = constraints.find((item) => 'limit' in item)?.limit
  // `orderBy` FILTERS as well as sorts: a document without the field is not
  // in the result at all.
  const matching = order
    ? all.filter((doc) => doc[order.orderBy] !== undefined)
    : all
  const sorted = [...matching].sort((a, b) => {
    const left = order ? a[order.orderBy] : a.$id
    const right = order ? b[order.orderBy] : b.$id
    const step = left < right ? -1 : left > right ? 1 : 0
    return order?.direction === 'desc' ? -step : step
  })
  return typeof cap === 'number' ? sorted.slice(0, cap) : sorted
}

/** Every cap a ceilinged read asked for. */
let mockCapsAsked: number[] = []
const FIRESTORE = {}

jest.mock('@aglyn/tenant-feature-instance', () => ({
  useFirestore: () => FIRESTORE,
  useHostActivityLogger: () => jest.fn(),
  writeGuardedBySeed: jest.requireActual('@aglyn/tenant-feature-instance')
    .writeGuardedBySeed,
  useFirestoreCollection: (build: () => any) => {
    const built = build()
    const name = String(built?.path ?? '').split('/').pop() ?? ''
    const cap = (built?.constraints ?? []).find(
      (item: any) => 'limit' in item,
    )?.limit
    if (name === 'overlays' && typeof cap === 'number') mockCapsAsked.push(cap)
    return {
      data: firestoreAnswer(byCollection[name] ?? [], built?.constraints ?? []),
      status: 'success',
      fromCache: false,
    }
  },
  usePagedCollection: (build: (pageLimit: number) => any) => {
    const { useState } = require('react')
    const [page, setPage] = useState(0)
    const [pageSize, setPageSizeState] = useState(10)
    const windowSize = pageSize * (page + 1)
    const built = build(windowSize + 1)
    const name = String(built?.path ?? '').split('/').pop() ?? ''
    const answered = firestoreAnswer(
      byCollection[name] ?? [],
      built?.constraints ?? [],
    )
    return {
      rows: answered.slice(page * pageSize, windowSize),
      hasMore: answered.length > windowSize,
      page,
      setPage,
      pageSize,
      setPageSize: (next: number) => {
        setPageSizeState(next)
        setPage(0)
      },
      status: 'success',
      fromCache: false,
    }
  },
}))

/*
 * The list query, answered by its double: the real plan, answered over the
 * fixture the way Firestore would. Seeded below from the double's static
 * import — `listQueryModule` reaches `jest` through `globalThis`, which this
 * project's runner does not set.
 */
let mockListQuery: (options: unknown) => unknown = () => {
  throw new Error('the list query double was not seeded')
}
jest.mock('@aglyn/tenant-feature-instance/hooks/use-list-query', () => ({
  useListQuery: (options: unknown) => mockListQuery(options),
}))

jest.mock('firebase/firestore', () => ({
  collection: (_db: unknown, ...segments: string[]) => ({
    path: segments.join('/'),
    constraints: [],
  }),
  query: (base: any, ...constraints: unknown[]) => ({
    path: base?.path ?? base,
    constraints: [...(base?.constraints ?? []), ...constraints],
  }),
  limit: (value: number) => ({ limit: value }),
  where: (field: string, op: string, value: unknown) => ({ where: [field, op, value] }),
  orderBy: (field: string, direction?: string) => ({
    orderBy: field,
    direction,
  }),
  doc: (_db: unknown, ...segments: string[]) => ({ path: segments.join('/') }),
  deleteDoc: jest.fn().mockResolvedValue(undefined),
  getDocs: jest.fn().mockResolvedValue({ docs: [] }),
  setDoc: jest.fn().mockResolvedValue(undefined),
}))

jest.mock('@aglyn/shared-util-timestamp', () => ({
  Timestamp: { now: () => ({ seconds: 0 }) },
}))
const mockEnqueueSnackbar = jest.fn()
jest.mock('@aglyn/shared-ui-snackstack', () => ({
  useSnackbar: () => ({ enqueueSnackbar: mockEnqueueSnackbar }),
}))
jest.mock('@aglyn/shared-ui-jsx', () => ({
  CardDisplay: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  MdiIcon: () => null,
  useConfirmationContext: () => ({
    confirm: jest.fn().mockResolvedValue(undefined),
  }),
}))

import { getDocs, setDoc } from 'firebase/firestore'
import { HostExperimentsCard } from './host-experiments-card.component'
import { HostOverlaysCard } from './host-overlays-card.component'

/** Entitled, so neither card renders its upgrade panel instead of the list. */
const ORG = {
  $id: 'org-1',
  plan: 'scale',
  entitlements: { abTesting: true, marketingOverlays: true },
} as any

beforeEach(() => {
  mockCapsAsked = []
  mockListQuery = (options) => useListQueryDouble(() => mockExperimentDocs, options as never)
})

const firstCells = () =>
  Array.from(document.querySelectorAll('tbody tr')).map(
    (row) => row.querySelector('td')?.textContent?.trim() ?? '',
  )

/** The experiment names the grid draws, top to bottom. */
const experimentNames = () =>
  Array.from(document.querySelectorAll('[role="row"][data-id]')).map(
    (row) => row.querySelector('[data-field="name"]')?.textContent?.trim() ?? '',
  )

describe('the experiments table walks the collection (AGL-2501)', () => {
  it('THE CONTROL: the two behaviours disagree at the page size', () => {
    const page = TABLE_PAGE_SIZE_DEFAULT + 1
    const oldWindow = firestoreAnswer(experimentDocs, [{ limit: page }]).sort(
      (a, b) => String(a.name).localeCompare(String(b.name)),
    )
    const walked = firestoreAnswer(experimentDocs, [
      { orderBy: 'name' },
      { limit: page },
    ])
    expect(oldWindow[0].name).not.toBe(walked[0].name)
    expect(oldWindow.map((row: any) => row.name)).not.toContain('Test 00')
  })

  it('shows the alphabetical first page and pages to the next', async () => {
    render(<HostExperimentsCard hostId="host-1" org={ORG} />)
    expect(experimentNames()[0]).toBe('Test 00')
    fireEvent.click(screen.getByLabelText('Go to next page'))
    await waitFor(() => expect(experimentNames()[0]).toBe('Test 10'))
  })

  it('a page holds every row the query returned: nothing is dropped after it (AGL-3321)', () => {
    render(<HostExperimentsCard hostId="host-1" org={ORG} />)
    // An experiment is never soft-deleted — Delete is a `deleteDoc` — so the
    // card matches nothing over the page it is handed, and a full page is a
    // full page.
    expect(experimentNames()).toHaveLength(TABLE_PAGE_SIZE_DEFAULT)
  })
})

describe('the experiments search is asked of Firestore (AGL-3321)', () => {
  it('finds an experiment whose only match is past the first page', async () => {
    render(<HostExperimentsCard hostId="host-1" org={ORG} />)
    expect(experimentNames()).not.toContain('Test 33')
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: '33' } })
    await waitFor(() => expect(experimentNames()).toEqual(['Test 33']))
    // On the query, as the written token — not matched over a loaded page.
    expect(lastListQueryPlan()?.filters).toContainEqual({
      path: 'nameTokens',
      op: 'array-contains',
      value: '33',
    })
    expect(lastListQueryPlan()?.orderBy).toEqual({ path: 'name', direction: 'asc' })
  })
})

describe('the overlays table is ceilinged, not paged (AGL-2501)', () => {
  it('THE TRAP: ordering on `order` would hide most of the overlays', () => {
    // Driven through the same evaluator the card is fed, so this is a claim
    // about the query rather than about a comment. Only the two overlays
    // somebody has reordered carry the field.
    const onOrder = firestoreAnswer(overlayDocs, [{ orderBy: 'order' }])
    expect(onOrder).toHaveLength(2)
    const onName = firestoreAnswer(overlayDocs, [{ orderBy: 'name' }])
    expect(onName).toHaveLength(OVERLAYS)
  })

  it('reads one document PAST the ceiling', () => {
    render(<HostOverlaysCard hostId="host-1" org={ORG} />)
    // `length === 50` is wrong at exactly the count that equals the ceiling,
    // so the read probes instead of comparing.
    expect(mockCapsAsked).toEqual([OVERLAY_CEILING + 1])
  })

  it('renders every overlay, in PRECEDENCE order, with no pager', () => {
    render(<HostOverlaysCard hostId="host-1" org={ORG} />)
    // No footer: a page boundary would separate a row from the neighbor its
    // arrows swap with.
    expect(
      document.querySelector('.MuiTablePagination-displayedRows'),
    ).toBeNull()
    expect(document.querySelectorAll('tbody tr')).toHaveLength(OVERLAYS)
    // The two reordered overlays come first, in their `order`, and the rest
    // follow by name — which is the runtime precedence, and only computable
    // because the card holds the whole set.
    expect(firstCells().slice(0, 3)).toEqual([
      'Banner 05',
      'Banner 07',
      'Banner 00',
    ])
  })

  it('the first row cannot be moved up and the last cannot be moved down', () => {
    render(<HostOverlaysCard hostId="host-1" org={ORG} />)
    const up = screen.getAllByLabelText('move up')
    const down = screen.getAllByLabelText('move down')
    // The ends of the WHOLE list, not the ends of a page. On a paged table
    // these would be the ends of ten rows, and the swap across the boundary
    // would be unreachable.
    expect((up[0] as HTMLButtonElement).disabled).toBe(true)
    expect((up.at(-1) as HTMLButtonElement).disabled).toBe(false)
    expect((down.at(-1) as HTMLButtonElement).disabled).toBe(true)
    expect(up).toHaveLength(OVERLAYS)
  })
})

describe('starting a test asks Firestore what else runs on its screen (AGL-3321)', () => {
  it('refuses a second running test on the screen even when the first is on another page', async () => {
    ;(getDocs as jest.Mock).mockImplementationOnce(async (built: any) => {
      const clauses = (built?.constraints ?? [])
        .filter((item: any) => 'where' in item)
        .map((item: any) => item.where as [string, string, unknown])
      const docs = mockExperimentDocs
        .filter((row: any) => clauses.every(([field, , value]) => row[field] === value))
        .map((row) => ({ id: row.$id, data: () => row }))
      return { docs }
    })
    render(<HostExperimentsCard hostId="host-1" org={ORG} />)
    // `Test 30`, the running one, is on page four; page one holds `Test 00`.
    expect(experimentNames()).not.toContain('Test 30')
    fireEvent.click(screen.getByRole('button', { name: 'More actions for Test 01' }))
    fireEvent.click(screen.getByRole('menuitem', { name: 'Start' }))
    await waitFor(() =>
      expect(mockEnqueueSnackbar).toHaveBeenCalledWith(
        expect.stringContaining('"Test 30" is already running'),
        expect.anything(),
      ),
    )
    expect(setDoc).not.toHaveBeenCalled()
  })
})

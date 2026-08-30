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
 *
 * @jest-environment jsdom
 */

/**
 * What opening a dataset record COSTS.
 *
 * The record viewer renders a document in full, and the obvious way to build
 * one is to fetch the document — a `getDoc` on open, or worse a hook per row
 * that fetches on mount and bills the whole page for a table nobody has
 * clicked. Neither is necessary here: the row's values are already in hand
 * from the table's page query, and the viewer takes them as a prop.
 *
 * A spec asserting on rendered output cannot tell the two designs apart. Both
 * put the same fields on screen; only one of them charges for it. So the meter
 * sits at the Firestore boundary and counts:
 *
 *  * one-shot READS — `getDoc`, `getDocs`, `getCountFromServer` — by path,
 *    since each is a billed round-trip; and
 *  * distinct LISTENS, as path plus the `limit()` the query carries, because
 *    that limit is the billable ceiling. A listener re-registered under a new
 *    query identity is a new subscription; the same identity is not.
 *
 * Contracts:
 *
 *  1. THE MOUNT DOES NOT SCALE WITH THE PAGE. A page of twenty-five rows
 *     costs exactly what a page of one costs. Red if the viewer were mounted
 *     per row and read on mount.
 *  2. OPENING A RECORD READS NOTHING. Not the record, not its references, not
 *     the count. Every value shown was already paid for by the table.
 *  3. NEITHER DOES THE SECOND ONE, OR THE TENTH. A per-open read is a cost
 *     that grows with use rather than with data, which is the one most easily
 *     missed in review.
 *  4. THERE IS ONE VIEWER, NOT ONE PER ROW.
 *  5. THE TABLE'S OWN CEILING DOES NOT MOVE. Whatever the viewer does, it may
 *     not widen the page query that feeds it.
 */

import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { HostDatasetsCard } from './host-datasets-card.component'

const ORG = { $id: 'org-1', plan: 'scale' } as any

/**
 * Every billed one-shot, and every distinct listen. Module-scoped and
 * `mock`-prefixed so the `jest.mock` factories may close over them — jest's
 * out-of-scope-variable guard admits that one prefix.
 */
const mockReads: Array<{ kind: string; path: string }> = []
const mockListens = new Set<string>()

/** How many rows the page hands over — contract 1 varies this. */
const rowCount = { value: 1 }
const datasetDocs = [
  {
    $id: 'ds-1',
    displayName: 'Leads',
    model: {
      order: ['title', 'owner'],
      fields: {
        title: { name: 'Title', type: 'text' },
        owner: {
          name: 'Owner',
          type: 'reference',
          reference: { datasetId: 'people', displayFieldId: 'name' },
        },
      },
    },
    visibleTo: ['org'],
  },
]
const recordsFor = (count: number) =>
  Array.from({ length: count }, (_, index) => ({
    $id: `rec-${index}`,
    values: { title: `Row ${index}`, owner: 'p1' },
  }))

const DATA_SCOPE = { scope: ['orgs', 'org-1'], orgId: 'org-1' }
const FIRESTORE = {}

jest.mock('firebase/firestore', () => {
  const marker =
    (kind: string) =>
    (...args: unknown[]) => ({ __constraint: kind, args })
  const record = (kind: string) => async (ref: { __path?: string }) => {
    mockReads.push({ kind, path: ref?.__path ?? '(unknown)' })
    if (kind === 'count') return { data: () => ({ count: 2 }) }
    if (kind === 'getDoc') return { exists: () => false, data: () => undefined }
    return { docs: [], empty: true, size: 0 }
  }
  return {
    __esModule: true,
    collection: (_db: unknown, ...segments: string[]) => ({
      __path: segments.join('/'),
    }),
    doc: (_db: unknown, ...segments: string[]) => ({
      __path: segments.join('/'),
      __doc: true,
    }),
    query: (base: { __path?: string }, ...constraints: unknown[]) => {
      const limits = constraints
        .filter(
          (c): c is { __constraint: string; args: number[] } =>
            !!c && (c as { __constraint?: string }).__constraint === 'limit',
        )
        .map((c) => c.args[0])
        .filter((n) => typeof n === 'number')
      return {
        __path: base?.__path ?? '(unknown)',
        __limit: limits.length ? Math.max(...limits) : 0,
      }
    },
    limit: marker('limit'),
    where: marker('where'),
    orderBy: marker('orderBy'),
    documentId: () => '__name__',
    deleteField: () => ({ __delete: true }),
    getDocs: record('getDocs'),
    getDoc: record('getDoc'),
    getCountFromServer: record('count'),
    deleteDoc: async () => undefined,
    setDoc: async () => undefined,
    updateDoc: async () => undefined,
    writeBatch: () => ({
      set: () => undefined,
      update: () => undefined,
      commit: async () => undefined,
    }),
  }
})

jest.mock('@aglyn/tenant-feature-instance', () => {
  /** One subscription = one distinct query identity, path plus its ceiling. */
  const note = (ref: { __path?: string; __limit?: number } | null) => {
    if (ref?.__path) mockListens.add(`${ref.__path}#${ref.__limit ?? 0}`)
  }
  return {
    useFirestore: () => FIRESTORE,
    useOrgDataScope: () => DATA_SCOPE,
    useScopeTokens: () => ({ tokens: ['org'], orgWide: true, loaded: true }),
    useUser: () => ({ data: { uid: 'uid-test' } }),
    useHostActivityLogger: () => jest.fn(),
    writeGuardedBySeed: async () => undefined,
    useFirestoreCollection: (build: () => any) => {
      const ref = build()
      note(ref)
      return {
        data: ref?.__path?.endsWith('/datasets') ? datasetDocs : [],
        status: 'success',
        fromCache: false,
      }
    },
    usePagedCollection: (build: (pageLimit: number) => any) => {
      const { useState } = require('react')
      const [page, setPage] = useState(0)
      const [pageSize, setPageSize] = useState(10)
      const ref = build(pageSize * (page + 1) + 1)
      note(ref)
      return {
        rows: ref?.__path?.endsWith('/records')
          ? recordsFor(rowCount.value)
          : [],
        hasMore: false,
        page,
        setPage,
        pageSize,
        setPageSize,
        status: 'success',
        fromCache: false,
      }
    },
  }
})

jest.mock('@aglyn/shared-ui-snackstack', () => ({
  useSnackbar: () => ({ enqueueSnackbar: jest.fn() }),
}))
jest.mock('@aglyn/shared-ui-jsx', () => ({
  CardDisplay: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  MdiIcon: () => null,
  useConfirmationContext: () => ({
    confirm: jest.fn().mockRejectedValue(new Error('cancelled')),
  }),
}))

beforeEach(() => {
  mockReads.length = 0
  mockListens.clear()
  rowCount.value = 1
})

/** Mounts and waits for every read the card starts on its own to settle. */
const mountSettled = async () => {
  const result = render(<HostDatasetsCard orgId="org-1" org={ORG} />)
  // The two aggregates and the reference-picker window are the card's own
  // mount-time reads; snapshotting before they land would credit the viewer
  // with a quiet period it did not earn.
  await waitFor(() =>
    expect(mockReads.filter((read) => read.kind === 'count').length).toBe(2),
  )
  await act(async () => {
    await Promise.resolve()
  })
  return result
}

/** The meter, as one comparable value. */
const meter = () => ({
  reads: mockReads.map((read) => `${read.kind} ${read.path}`).sort(),
  listens: [...mockListens].sort(),
})

describe('the mount does not scale with the page', () => {
  it('costs the same for twenty-five rows as for one', async () => {
    rowCount.value = 1
    const { unmount } = await mountSettled()
    const one = meter()
    unmount()

    mockReads.length = 0
    mockListens.clear()
    rowCount.value = 25
    await mountSettled()
    // Twenty-five rows on screen; the same reads behind them. A viewer
    // mounted per row that fetched its own record would make this
    // twenty-five times longer.
    expect(screen.getAllByRole('row').length).toBeGreaterThan(25)
    expect(meter()).toEqual(one)
  })
})

describe('opening a record reads nothing', () => {
  it('adds no read and no listen', async () => {
    rowCount.value = 5
    await mountSettled()
    const before = meter()

    fireEvent.click(screen.getByText('Row 0'))
    expect(screen.getByText('View record')).toBeTruthy()
    await act(async () => {
      await Promise.resolve()
    })
    expect(meter()).toEqual(before)
  })

  it('adds none for the second record either', async () => {
    rowCount.value = 5
    await mountSettled()
    const before = meter()

    // Every row in the page, opened one after another. A per-open `getDoc`
    // is a cost that grows with USE, which no single-open assertion catches.
    for (let index = 0; index < 5; index += 1) {
      fireEvent.click(screen.getByText(`Row ${index}`))
      await act(async () => {
        await Promise.resolve()
      })
    }
    expect(meter()).toEqual(before)
  })

  it('adds none when opened from the View button', async () => {
    rowCount.value = 3
    await mountSettled()
    const before = meter()

    fireEvent.click(screen.getAllByRole('button', { name: 'View' })[1])
    expect(screen.getByText('View record')).toBeTruthy()
    await act(async () => {
      await Promise.resolve()
    })
    expect(meter()).toEqual(before)
  })

  it('opens ONE viewer, not one per row', async () => {
    rowCount.value = 5
    await mountSettled()
    fireEvent.click(screen.getByText('Row 2'))
    expect(screen.getAllByRole('dialog')).toHaveLength(1)
  })
})

describe('the table’s own ceiling does not move', () => {
  it('keeps the records walk capped at one page plus a probe row', async () => {
    rowCount.value = 5
    await mountSettled()
    const records = [...mockListens].filter((listen) =>
      listen.includes('/records#'),
    )
    // `usePagedCollection` asks for page 0 plus one probe row. The viewer
    // must not have widened it to fill itself.
    expect(records).toEqual(['orgs/org-1/datasets/ds-1/records#11'])

    fireEvent.click(screen.getByText('Row 0'))
    await act(async () => {
      await Promise.resolve()
    })
    expect(
      [...mockListens].filter((listen) => listen.includes('/records#')),
    ).toEqual(records)
  })
})

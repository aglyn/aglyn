/**
 * @jest-environment jsdom
 */

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
 * The React half of the sorted walk (AGL-2853): what it SUBSCRIBES to, and
 * when.
 *
 * `sorted-collection-window.spec.ts` covers the planner's arithmetic, and the
 * emulator spec covers Firestore agreeing with it. Neither can see the one
 * thing this adapter adds — that `useFirestoreCollection` answers the render
 * in which its inputs change with the PREVIOUS subscription's rows. A hook
 * that planned on those would open scans at limits nobody asked for, and call
 * a window settled that has not been read.
 *
 * So the collection hook is replaced by a double with the real one's timing:
 * inputs change, the old rows are still returned for that render, the effect
 * clears them to `loading`, and the answer arrives later — here, when a test
 * flushes it. The answer itself comes from a model that filters as well as
 * sorts, so the scan is exercised rather than assumed.
 */

import { act, renderHook } from '@testing-library/react'

jest.mock('firebase/firestore', () => ({
  documentId: () => '__name__',
  limit: (value: number) => ({ limit: value }),
  orderBy: (field: string, direction = 'asc') => ({
    orderBy: field,
    direction,
  }),
  query: (base: any, ...constraints: unknown[]) => ({
    constraints: [...(base?.constraints ?? []), ...constraints],
  }),
}))

type Row = Record<string, unknown> & { $id: string }

/** The collection the double answers from. */
let mockDocuments: Row[] = []
/** Every query subscribed, in order, as `keyed:<limit>` or `scan:<limit>`. */
let mockSubscribed: string[] = []
/** Answers not yet delivered. */
let mockPending: Array<() => void> = []

/** Firestore's answer: `orderBy` on a field sorts AND drops what lacks it. */
function mockAnswer(built: any): Row[] {
  const constraints: Array<Record<string, any>> = built.constraints
  const orders = constraints.filter((item) => 'orderBy' in item)
  const cap = constraints.find((item) => 'limit' in item)?.limit
  const has = (doc: Row, field: string) =>
    field === '__name__' || doc[field] !== undefined
  const value = (doc: Row, field: string) =>
    field === '__name__' ? doc.$id : doc[field]
  return mockDocuments
    .filter((doc) => orders.every((item) => has(doc, item.orderBy)))
    .sort((a, b) => {
      for (const item of orders) {
        const x = value(a, item.orderBy) as number | string
        const y = value(b, item.orderBy) as number | string
        if (x === y) continue
        return (x < y ? -1 : 1) * (item.direction === 'desc' ? -1 : 1)
      }
      return 0
    })
    .slice(0, cap)
}

jest.mock('./use-firestore-collection', () => {
  const React = jest.requireActual('react')
  return {
    useFirestoreCollection: (
      buildQuery: () => any,
      deps: unknown[],
      options: { idField?: string },
    ) => {
      const [state, setState] = React.useState({
        data: [],
        status: 'loading',
        fromCache: true,
      })
      const buildRef = React.useRef(buildQuery)
      buildRef.current = buildQuery
      React.useEffect(() => {
        // The real hook's reset: rows cleared, status back to loading.
        setState({ data: [], status: 'loading', fromCache: true })
        const built = buildRef.current()
        if (!built) return
        const isScan = built.constraints.some(
          (item: any) => item.orderBy === '__name__' && item.direction === 'asc',
        ) && !built.constraints.some(
          (item: any) => 'orderBy' in item && item.orderBy !== '__name__',
        )
        const cap = built.constraints.find((item: any) => 'limit' in item).limit
        mockSubscribed.push(`${isScan ? 'scan' : 'keyed'}:${cap}`)
        let live = true
        mockPending.push(() => {
          if (!live) return
          setState({
            data: mockAnswer(built).map((doc) => ({
              ...doc,
              [options.idField ?? '$id']: doc.$id,
            })),
            status: 'success',
            fromCache: false,
          })
        })
        return () => {
          live = false
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
      }, deps)
      return { ...state, error: undefined, serverDenied: false }
    },
  }
})

import { useSortedPagedCollection } from './use-sorted-paged-collection'
import type { CollectionSort } from './sorted-collection-window'

/** Deliver every answer, including the ones the answers cause. */
async function settle() {
  for (let round = 0; round < 20 && mockPending.length; round += 1) {
    const due = mockPending
    mockPending = []
    await act(async () => {
      due.forEach((deliver) => deliver())
    })
  }
}

const dated = (id: string, at: number): Row => ({ $id: id, publishedAt: at })
const undated = (id: string): Row => ({ $id: id })

const NEWEST: CollectionSort = { field: 'publishedAt', direction: 'desc' }

function mount(sort: CollectionSort = NEWEST, pageSize = 3) {
  return renderHook(
    ({ order }: { order: CollectionSort }) =>
      useSortedPagedCollection<Row>(() => ({ constraints: [] }) as never, order, [
        'host-1',
      ], { idField: '$id', pageSize }),
    { initialProps: { order: sort } },
  )
}

beforeEach(() => {
  mockDocuments = []
  mockSubscribed = []
  mockPending = []
})

describe('useSortedPagedCollection', () => {
  it('reads one page and a probe row, and no scan while the field fills it', async () => {
    mockDocuments = [dated('a', 5), dated('b', 4), dated('c', 3), dated('d', 2)]
    const { result } = mount()
    await settle()

    expect(mockSubscribed).toEqual(['keyed:4'])
    expect(result.current.rows.map((row) => row.$id)).toEqual(['a', 'b', 'c'])
    expect(result.current.hasMore).toBe(true)
    expect(result.current.status).toBe('success')
  })

  it('opens the scan once the keyed walk comes back short, and fills the page', async () => {
    mockDocuments = [undated('a'), dated('b', 9), undated('c'), undated('d')]
    const { result } = mount()
    await settle()

    // The keyed walk found one; the window and its probe need three more. A
    // scan of three reads `b` again and keeps two, while holding its whole
    // limit, so it widens once — and reads past the end of the collection.
    expect(mockSubscribed).toEqual(['keyed:4', 'scan:3', 'scan:6'])
    expect(result.current.rows.map((row) => row.$id)).toEqual(['b', 'a', 'c'])
    expect(result.current.hasMore).toBe(true)
    expect(result.current.status).toBe('success')
  })

  it('is LOADING, not empty, while the scan it opened has not answered', async () => {
    mockDocuments = [undated('a'), undated('b')]
    const { result } = mount()
    // Deliver the keyed answer alone.
    const keyed = mockPending
    mockPending = []
    await act(async () => keyed.forEach((deliver) => deliver()))

    expect(mockSubscribed).toEqual(['keyed:4', 'scan:4'])
    // A short window is a claim that the list ends; nothing has earned it.
    expect(result.current.status).toBe('loading')
    await settle()
    expect(result.current.rows.map((row) => row.$id)).toEqual(['a', 'b'])
    expect(result.current.hasMore).toBe(false)
    expect(result.current.status).toBe('success')
  })

  it('widens a scan that held its limit without finding enough', async () => {
    mockDocuments = [
      undated('a'),
      dated('b', 2),
      dated('c', 1),
      undated('d'),
      undated('e'),
    ]
    const { result } = mount()
    await settle()

    // Keyed found b, c: one row owed plus the probe → scan 2 reads a, b and
    // keeps only a, while holding its limit → widen to 4 → a..d keeps a, d.
    expect(mockSubscribed).toEqual(['keyed:4', 'scan:2', 'scan:4'])
    expect(result.current.rows.map((row) => row.$id)).toEqual(['b', 'c', 'a'])
    expect(result.current.hasMore).toBe(true)
  })

  it('does not judge a new page by the previous page’s rows', async () => {
    // Seven dated entries: page two's keyed window of seven is FULL. Planned
    // on page one's four rows, it would look short and open a scan.
    mockDocuments = Array.from({ length: 7 }, (_, i) => dated(`e${i}`, 100 - i))
    mockDocuments.push(undated('z1'), undated('z2'))
    const { result } = mount()
    await settle()
    expect(mockSubscribed).toEqual(['keyed:4'])

    act(() => result.current.setPage(1))
    await settle()

    expect(mockSubscribed).toEqual(['keyed:4', 'keyed:7'])
    expect(result.current.rows.map((row) => row.$id)).toEqual(['e3', 'e4', 'e5'])
    expect(result.current.hasMore).toBe(true)
  })

  it('starts a new sort on page one, asking for page one’s limit', async () => {
    mockDocuments = Array.from({ length: 12 }, (_, i) =>
      dated(`e${String(i).padStart(2, '0')}`, i),
    )
    const { result, rerender } = mount()
    await settle()
    act(() => result.current.setPage(2))
    await settle()
    expect(mockSubscribed.at(-1)).toBe('keyed:10')

    rerender({ order: { field: 'publishedAt', direction: 'asc' } })
    await settle()

    // Not `keyed:10` for the new order: the reset lands in the same render.
    expect(mockSubscribed.slice(2)).toEqual(['keyed:4'])
    expect(result.current.page).toBe(0)
    expect(result.current.rows.map((row) => row.$id)).toEqual([
      'e00',
      'e01',
      'e02',
    ])
  })

  it('walks every entry exactly once across the pages', async () => {
    mockDocuments = [
      dated('a', 3),
      undated('b'),
      dated('c', 3),
      undated('d'),
      dated('e', 1),
      undated('f'),
      undated('g'),
    ]
    const { result } = mount(NEWEST, 2)
    await settle()
    const seen: string[] = []
    for (let page = 0; page < 10; page += 1) {
      seen.push(...result.current.rows.map((row) => row.$id))
      if (!result.current.hasMore) break
      act(() => result.current.setPage(page + 1))
      await settle()
    }
    // Ties on 3 break by name in the sort's direction; the undated follow.
    expect(seen).toEqual(['c', 'a', 'e', 'b', 'd', 'f', 'g'])
  })
})

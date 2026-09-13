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
 * The sorted walk's DECISIONS, against a model of Firestore (AGL-2853).
 *
 * The model is not the proof that Firestore drops a document lacking an
 * ordered field — `content-entries-total-order.emulator.spec.ts` runs these
 * same functions against a real Firestore for that. What this file adds is
 * coverage on every run: the arithmetic of limits, the scan's widening, the
 * page slicing and the dedupe, walked page by page over a fixture where half
 * the documents lack the sort field. The model FILTERS as well as sorts, the
 * way `host-collection-queries.spec.ts` does, because a double that only
 * sorted would let a keyed-only walk pass.
 */

import {
  lacksSortField,
  planKeyedSegment,
  planSortedWindow,
  sortedKeyedQuery,
  sortedScanLimit,
  sortedUnkeyedQuery,
  sortFieldIsTotal,
  type CollectionSort,
} from './sorted-collection-window'

jest.mock('firebase/firestore', () => ({
  documentId: () => '__name__',
  limit: (value: number) => ({ limit: value }),
  orderBy: (field: string, direction = 'asc') => ({
    orderBy: field,
    direction,
  }),
  where: (field: string, op: string, value: unknown) => ({
    where: field,
    op,
    value,
  }),
  query: (base: any, ...constraints: unknown[]) => ({
    constraints: [...(base?.constraints ?? []), ...constraints],
  }),
}))

type Row = Record<string, unknown> & { $id: string }

const idOf = (row: Row) => row.$id

/** A value's place in Firestore's cross-type order, for the few types used. */
const typeRank = (value: unknown) =>
  value === null ? 0 : typeof value === 'number' ? 1 : 2

const compare = (a: unknown, b: unknown) => {
  const rank = typeRank(a) - typeRank(b)
  if (rank !== 0) return rank
  if (a === b) return 0
  return (a as number | string) < (b as number | string) ? -1 : 1
}

/**
 * Firestore's answer in the respects the walk depends on: an equality
 * narrows, an `orderBy` on a field SORTS and also FILTERS — a document without
 * the field is not in the result at all — and `limit` caps.
 */
function answer(documents: readonly Row[], built: any): Row[] {
  const constraints: Array<Record<string, any>> = built.constraints
  const wheres = constraints.filter((item) => 'where' in item)
  const orders = constraints.filter((item) => 'orderBy' in item)
  const cap = constraints.find((item) => 'limit' in item)?.limit
  const matching = documents
    .filter((doc) => wheres.every((item) => doc[item.where] === item.value))
    .filter((doc) =>
      orders.every(
        (item) => item.orderBy === '__name__' || !lacksSortField(doc, item.orderBy),
      ),
    )
  const sorted = [...matching].sort((a, b) => {
    for (const item of orders) {
      const field = item.orderBy === '__name__' ? '$id' : item.orderBy
      const order = compare(a[field], b[field])
      if (order !== 0) return item.direction === 'desc' ? -order : order
    }
    return 0
  })
  return typeof cap === 'number' ? sorted.slice(0, cap) : sorted
}

/** A collection with every gap a writer leaves, and ties to break. */
const DOCUMENTS: readonly Row[] = [
  { $id: 'e01', title: 'Launch', status: 'published', publishedAt: 50 },
  { $id: 'e02', title: 'beta notes', status: 'published', publishedAt: 40 },
  // Unpublished: the date went with it.
  { $id: 'e03', title: 'Draft A', status: 'draft' },
  { $id: 'e04', title: 'Tie one', status: 'published', publishedAt: 30 },
  { $id: 'e05', title: 'Tie two', status: 'published', publishedAt: 30 },
  // Restored from an import that carried no title.
  { $id: 'e06', status: 'published', publishedAt: 20 },
  { $id: 'e07', title: 'Draft B', status: 'draft' },
  // An explicit null is a stored value: keyed, and first when ascending.
  { $id: 'e08', title: 'Nulled', status: 'scheduled', publishedAt: null },
  { $id: 'e09', title: 'Draft C', status: 'draft' },
  { $id: 'e10', title: 'Old', status: 'published', publishedAt: 10 },
  // No status at all.
  { $id: 'e11', title: 'Bare' },
]

const BASE = { constraints: [] }

/**
 * One page, planned the way the hook plans it: read the keyed walk, open the
 * scan at the limit the plan names, re-read while the plan widens it.
 */
function readPage(
  documents: readonly Row[],
  sort: CollectionSort,
  page: number,
  pageSize: number,
  base: any = BASE,
  equalityFields: string[] = [],
) {
  const keyedIsTotal = sortFieldIsTotal(sort, equalityFields)
  const { keyedLimit } = planKeyedSegment({
    page,
    pageSize,
    keyed: undefined,
    keyedSettled: false,
    keyedIsTotal,
  })
  const keyed = answer(
    documents,
    sortedKeyedQuery(base, sort, keyedLimit, equalityFields),
  )
  const keyedPlan = planKeyedSegment({
    page,
    pageSize,
    keyed,
    keyedSettled: true,
    keyedIsTotal,
  })
  const scanLimits: number[] = []
  let widenedTo = 0
  for (;;) {
    const scanLimit = sortedScanLimit(keyedPlan, widenedTo)
    if (scanLimit) scanLimits.push(scanLimit)
    const scan = scanLimit
      ? answer(documents, sortedUnkeyedQuery(base, scanLimit))
      : undefined
    const plan = planSortedWindow({
      page,
      pageSize,
      sort,
      keyedIsTotal,
      keyed,
      keyedSettled: true,
      scan,
      scanSettled: true,
      scanLimit,
      idOf,
    })
    if (plan.scanLimit === scanLimit) return { plan, keyedLimit, scanLimits }
    widenedTo = plan.scanLimit
  }
}

/** Every page of a sort, in order, as the ids a reader would see. */
function walk(
  documents: readonly Row[],
  sort: CollectionSort,
  pageSize: number,
  base: any = BASE,
  equalityFields: string[] = [],
) {
  const pages: string[][] = []
  for (let page = 0; page < 100; page += 1) {
    const { plan } = readPage(documents, sort, page, pageSize, base, equalityFields)
    expect(plan.settled).toBe(true)
    pages.push(plan.rows.map(idOf))
    if (!plan.hasMore) break
  }
  return pages
}

const SORTS: CollectionSort[] = ['title', 'status', 'publishedAt'].flatMap(
  (field) => [
    { field, direction: 'asc' as const },
    { field, direction: 'desc' as const },
  ],
)

describe('lacksSortField', () => {
  it('is true only for a field that is not there', () => {
    expect(lacksSortField({}, 'publishedAt')).toBe(true)
    expect(lacksSortField({ publishedAt: undefined }, 'publishedAt')).toBe(true)
    // An explicit null is stored, indexed and returned by `orderBy`.
    expect(lacksSortField({ publishedAt: null }, 'publishedAt')).toBe(false)
    expect(lacksSortField({ publishedAt: 0 }, 'publishedAt')).toBe(false)
    expect(lacksSortField({ title: '' }, 'title')).toBe(false)
  })

  it('reads a dotted path as a nested field', () => {
    expect(lacksSortField({ seo: { title: 'x' } }, 'seo.title')).toBe(false)
    expect(lacksSortField({ seo: {} }, 'seo.title')).toBe(true)
    expect(lacksSortField({ seo: 'flat' }, 'seo.title')).toBe(true)
  })
})

describe('the two query shapes', () => {
  const sort: CollectionSort = { field: 'publishedAt', direction: 'desc' }

  it('keyed: the field, then the name in the SAME direction, then the limit', () => {
    expect(sortedKeyedQuery(BASE as never, sort, 11)).toEqual({
      constraints: [
        { orderBy: 'publishedAt', direction: 'desc' },
        // The same direction as the field, which is the order the field's
        // single-field index already holds — a mixed pair needs a composite.
        { orderBy: '__name__', direction: 'desc' },
        { limit: 11 },
      ],
    })
  })

  it('keyed on a field the base pins by equality orders by name alone', () => {
    expect(
      sortedKeyedQuery(
        { constraints: [{ where: 'status', op: '==', value: 'draft' }] } as never,
        { field: 'status', direction: 'desc' },
        11,
        ['status'],
      ),
    ).toEqual({
      constraints: [
        { where: 'status', op: '==', value: 'draft' },
        // Ascending whichever way the column points: every row holds the one
        // value, and this is the shape the automatic index serves.
        { orderBy: '__name__', direction: 'asc' },
        { limit: 11 },
      ],
    })
    expect(sortFieldIsTotal({ field: 'status', direction: 'asc' }, ['status'])).toBe(true)
    expect(sortFieldIsTotal(sort, ['status'])).toBe(false)
  })

  it('unkeyed: the base by name, ascending, and no ordering on any field', () => {
    expect(sortedUnkeyedQuery(BASE as never, 8)).toEqual({
      constraints: [{ orderBy: '__name__', direction: 'asc' }, { limit: 8 }],
    })
  })
})

describe('planKeyedSegment', () => {
  const input = {
    page: 1,
    pageSize: 10,
    keyedSettled: true,
    keyedIsTotal: false,
  }

  it('asks for every page up to this one, plus one probe row', () => {
    const plan = planKeyedSegment({ ...input, keyed: undefined })
    expect(plan).toMatchObject({ offset: 10, windowSize: 20, keyedLimit: 21 })
  })

  it('owes the scan nothing while the keyed walk fills the window', () => {
    const keyed = Array.from({ length: 21 }, (_, i) => ({ $id: `k${i}` }))
    expect(planKeyedSegment({ ...input, keyed }).tailNeeded).toBe(0)
  })

  it('owes the scan the rows the window is short of, once the SERVER says so', () => {
    const keyed = Array.from({ length: 14 }, (_, i) => ({ $id: `k${i}` }))
    expect(planKeyedSegment({ ...input, keyed }).tailNeeded).toBe(7)
    // A cached answer can be short because the cache is: no scan on it.
    expect(
      planKeyedSegment({ ...input, keyed, keyedSettled: false }).tailNeeded,
    ).toBe(0)
  })

  it('owes nothing when every base document carries the field', () => {
    expect(
      planKeyedSegment({ ...input, keyed: [], keyedIsTotal: true }).tailNeeded,
    ).toBe(0)
  })

  it('never re-opens a widened scan narrower than it reached', () => {
    const plan = planKeyedSegment({ ...input, keyed: [] })
    expect(sortedScanLimit(plan, 0)).toBe(21)
    expect(sortedScanLimit(plan, 84)).toBe(84)
    expect(sortedScanLimit({ ...plan, tailNeeded: 0 }, 84)).toBe(0)
  })
})

describe('planSortedWindow', () => {
  const sort: CollectionSort = { field: 'publishedAt', direction: 'desc' }
  const base = {
    page: 0,
    pageSize: 3,
    sort,
    keyedIsTotal: false,
    keyedSettled: true,
    scanSettled: true,
    idOf,
  }
  const dated = (id: string, at: number): Row => ({ $id: id, publishedAt: at })
  const undated = (id: string): Row => ({ $id: id })

  it('a full keyed window needs no scan and says there is more', () => {
    const plan = planSortedWindow({
      ...base,
      keyed: [dated('a', 4), dated('b', 3), dated('c', 2), dated('d', 1)],
      scan: undefined,
      scanLimit: 0,
    })
    expect(plan.rows.map(idOf)).toEqual(['a', 'b', 'c'])
    expect(plan).toMatchObject({ hasMore: true, scanLimit: 0, settled: true })
  })

  it('a short keyed walk opens the scan, and is not settled until it answers', () => {
    const plan = planSortedWindow({
      ...base,
      keyed: [dated('a', 4)],
      scan: undefined,
      scanLimit: 0,
    })
    expect(plan.scanLimit).toBe(3)
    expect(plan.settled).toBe(false)
    expect(plan.rows.map(idOf)).toEqual(['a'])
  })

  it('fills the window from the documents the keyed walk could not see', () => {
    const plan = planSortedWindow({
      ...base,
      keyed: [dated('b', 4)],
      // The scan reads the base by name: the keyed row comes back too, and is
      // not the scan's to show.
      scan: [undated('a'), dated('b', 4), undated('c'), undated('d')],
      scanLimit: 4,
    })
    expect(plan.rows.map(idOf)).toEqual(['b', 'a', 'c'])
    expect(plan).toMatchObject({ hasMore: true, settled: true, scanLimit: 4 })
  })

  it('widens a scan that held its whole limit and still fell short', () => {
    const plan = planSortedWindow({
      ...base,
      keyed: [dated('x', 4)],
      scan: [dated('x', 4), undated('y'), dated('z', 1)],
      scanLimit: 3,
    })
    expect(plan.scanLimit).toBe(6)
    expect(plan.settled).toBe(false)
  })

  it('a scan that read past the end is done, however few it kept', () => {
    const plan = planSortedWindow({
      ...base,
      keyed: [dated('x', 4)],
      scan: [dated('x', 4), undated('y')],
      scanLimit: 3,
    })
    expect(plan.rows.map(idOf)).toEqual(['x', 'y'])
    expect(plan).toMatchObject({ hasMore: false, settled: true, scanLimit: 3 })
  })

  it('shows a document the two listeners briefly disagree about ONCE', () => {
    const plan = planSortedWindow({
      ...base,
      keyed: [dated('moving', 4)],
      // The scan's snapshot still has it without the field.
      scan: [undated('moving'), undated('other')],
      scanLimit: 3,
    })
    expect(plan.rows.map(idOf)).toEqual(['moving', 'other'])
    expect(plan.rows[0]).toEqual(dated('moving', 4))
  })

  it('holds rows from a scan that has not answered yet, without settling', () => {
    const plan = planSortedWindow({
      ...base,
      keyed: [],
      scan: [undated('cached')],
      scanSettled: false,
      scanLimit: 4,
    })
    expect(plan.rows.map(idOf)).toEqual(['cached'])
    expect(plan).toMatchObject({ settled: false, scanLimit: 4 })
  })
})

describe('every page of every sort, over documents that lack the field', () => {
  const ALL = DOCUMENTS.map(idOf).sort()

  it('THE CONTROL: the fixture really has documents a field sort hides', () => {
    // Without these, a keyed-only walk would pass everything below.
    for (const field of ['title', 'status', 'publishedAt']) {
      const keyed = answer(DOCUMENTS, {
        constraints: [{ orderBy: field, direction: 'asc' }],
      })
      expect(keyed.length).toBeLessThan(DOCUMENTS.length)
    }
  })

  it.each(SORTS)('reaches every document once: $field $direction', (sort) => {
    for (const pageSize of [1, 2, 3, 4, 10, 25]) {
      const pages = walk(DOCUMENTS, sort, pageSize)
      const seen = pages.flat()
      expect([...seen].sort()).toEqual(ALL)
      expect(new Set(seen).size).toBe(seen.length)
      // No page is longer than a page, and only the last may be shorter.
      pages.forEach((rows, index) => {
        expect(rows.length).toBeLessThanOrEqual(pageSize)
        if (index < pages.length - 1) expect(rows.length).toBe(pageSize)
      })
    }
  })

  it.each(SORTS)('orders the keyed rows, then the rest: $field $direction', (sort) => {
    const seen = walk(DOCUMENTS, sort, 3).flat()
    const rows = seen.map((id) => DOCUMENTS.find((doc) => doc.$id === id) as Row)
    const firstMissing = rows.findIndex((row) => lacksSortField(row, sort.field))
    const keyed = firstMissing === -1 ? rows : rows.slice(0, firstMissing)
    const rest = firstMissing === -1 ? [] : rows.slice(firstMissing)
    // Every document lacking the value comes after every one that has it.
    expect(rest.every((row) => lacksSortField(row, sort.field))).toBe(true)
    // The keyed rows run in the requested order, ties broken by name.
    const expected = answer(DOCUMENTS, sortedKeyedQuery(BASE as never, sort, 1000))
    expect(keyed.map(idOf)).toEqual(expected.map(idOf))
    // The rest run by name.
    expect(rest.map(idOf)).toEqual([...rest.map(idOf)].sort())
  })

  it('opens on the newest published date, drafts after every dated entry', () => {
    const [first] = walk(DOCUMENTS, { field: 'publishedAt', direction: 'desc' }, 4)
    expect(first).toEqual(['e01', 'e02', 'e05', 'e04'])
  })

  it('a filtered walk reaches every document the filter matches, once', () => {
    const drafts = { constraints: [{ where: 'status', op: '==', value: 'draft' }] }
    for (const sort of SORTS) {
      const seen = walk(DOCUMENTS, sort, 2, drafts, ['status']).flat()
      expect([...seen].sort()).toEqual(['e03', 'e07', 'e09'])
      expect(new Set(seen).size).toBe(seen.length)
    }
  })

  it('costs the first page nothing past the window when the field is common', () => {
    // Four dated entries fill a page of three and its probe: no scan at all.
    const { keyedLimit, scanLimits } = readPage(
      DOCUMENTS,
      { field: 'publishedAt', direction: 'desc' },
      0,
      3,
    )
    expect(keyedLimit).toBe(4)
    expect(scanLimits).toEqual([])
  })
})

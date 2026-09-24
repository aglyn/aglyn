/**
 * @jest-environment node
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
 * The content entries table is TOTAL under every sort and every filter
 * (AGL-2853) — proved against a REAL Firestore.
 *
 * ## Why this cannot be a unit test
 *
 * The defect a field sort invites is not in the console's logic but in
 * Firestore's: `orderBy(field)` returns only documents that HAVE the field. A
 * mocked query answers whatever it was told to, so a spec written against one
 * passes with a walk that silently drops every draft. The table's other specs
 * meter and render the list; this is the one that can see a clause matching
 * nothing.
 *
 * ## What runs
 *
 * The queries are the console's own: `entryListBase` builds the collection and
 * its filter exactly as the content scope does, `sortedKeyedQuery` and
 * `sortedUnkeyedQuery` add the ordering, and `planKeyedSegment` /
 * `planSortedWindow` decide every limit, every widening and every page — the
 * same functions `useSortedPagedCollection` calls. Only the listener is
 * replaced, by `getDocs` against the emulator, and it reads each query at the
 * limit the plan names.
 *
 * Through the WEB SDK, because that is the SDK that builds these queries in
 * the browser. It connects with the emulator's `owner` token, which bypasses
 * the security rules: the claim is about indexing, not about who may read.
 *
 * ## The fixture is written the way production writes
 *
 * Each entry is produced by the sequence of writes its real writer performs —
 * the resources route's create, the list's publish and unpublish, the
 * scheduler, the tenant's due-schedule flip, and the import's allow-list with
 * a server timestamp — so the gaps in it are the gaps production has, not
 * ones a fixture author chose. The expected members of every filter are read
 * back from the stored documents by key, never from a query.
 *
 * ## Running it
 *
 * `npm run test:emulator-guards` boots the emulators and runs it with every
 * other emulator guard. Against an emulator already running on port 8082:
 *
 *   FIRESTORE_EMULATOR_HOST=127.0.0.1:8082 npx jest --config apps/console/jest.config.ts --testPathPatterns content-entries-total-order
 *
 * Skipped unless `FIRESTORE_EMULATOR_HOST` is set, so a normal run can never
 * touch a real project; `tools/scripts/test-emulator-guards.sh` sets it and
 * fails a run in which this file skipped.
 */

import { deleteApp, initializeApp, type FirebaseApp } from 'firebase/app'
import {
  collection,
  connectFirestoreEmulator,
  deleteDoc,
  deleteField,
  doc,
  getDoc,
  getDocs,
  getFirestore,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  terminate,
  Timestamp,
  updateDoc,
  where,
  type DocumentData,
  type Firestore,
  type Query,
} from 'firebase/firestore'
import type { ListFilterRequest } from '@aglyn/shared-ui-jsx/const/list-filter'
import {
  lacksSortField,
  planKeyedSegment,
  planSortedWindow,
  sortedKeyedQuery,
  sortedScanLimit,
  sortedUnkeyedQuery,
  sortFieldIsTotal,
  type CollectionSort,
} from '@aglyn/tenant-feature-instance/hooks/sorted-collection-window'
import {
  ENTRY_PUBLISH_SORT_FIELD,
  entryPublishSortStamp,
} from '@aglyn/aglyn/app-utils/collection-entry-date'
import { IMPORTABLE_FIELDS } from '../app/api/_lib/site-export'
import { entryPublishSortPatch } from '../components/content/content-scope.context'
import {
  ENTRY_LIST_DEFAULT_SORT,
  ENTRY_LIST_SORT_FIELDS,
  ENTRY_STATUS_OPTIONS,
  entryListBase,
  entryListEqualityFields,
  entryListStoredSort,
} from '../components/content/entry-list-query'
import { ENTRY_LIST_FILTER_FIELDS } from '../utils/list-filters'

const EMULATOR = process.env.FIRESTORE_EMULATOR_HOST ?? ''
const EMULATED = Boolean(EMULATOR)
const describeEmulated = EMULATED ? describe : describe.skip

const HOST_ID = 'agl2853-total-order'
const COLLECTION_ID = 'changelog'

type Row = DocumentData & { $id: string }

let app: FirebaseApp | undefined
let db: Firestore

const day = (n: number) => Timestamp.fromMillis(Date.UTC(2026, 0, n))
const entryRef = (id: string) =>
  doc(db, 'hosts', HOST_ID, 'collections', COLLECTION_ID, 'entries', id)

/* ── the writers, as production performs them ─────────────────────────── */

/**
 * `/api/hosts/resources` creating an entry: the allow-listed fields the
 * editor sent, a server-decided `status: 'draft'`, both stamps and the
 * creator. No field is validated for presence, so a create may omit `title`.
 */
const create = (id: string, data: Record<string, unknown>, at: number) =>
  setDoc(entryRef(id), {
    slug: id,
    ...data,
    status: 'draft',
    createdAt: day(at),
    updatedAt: day(at),
    createdBy: 'uid-editor',
  })

/**
 * The list's Publish: keeps a date the entry already has, else stamps one —
 * and the sort key the console's Published column walks (AGL-3323).
 */
const publish = (id: string, at: number) =>
  updateDoc(entryRef(id), {
    status: 'published',
    publishedAt: day(at),
    ...entryPublishSortPatch({ status: 'published', publishedAt: day(at) }),
  })

/** The list's Unpublish: the date goes with it, and so does the sort key. */
const unpublish = (id: string) =>
  updateDoc(entryRef(id), {
    status: 'draft',
    publishedAt: deleteField(),
    ...entryPublishSortPatch({ status: 'draft' }),
  })

/**
 * The scheduler: a future `publishAt`, no `publishedAt` of its own, and the
 * schedule as its sort key (AGL-3323).
 */
const schedule = (id: string, at: Timestamp) =>
  updateDoc(entryRef(id), {
    status: 'scheduled',
    publishAt: at,
    ...entryPublishSortPatch({ status: 'scheduled', publishAt: at }),
  })

/** The tenant's due-schedule flip, which dates the entry to its schedule. */
const flipDue = async (id: string) => {
  const stored = (await getDoc(entryRef(id))).data() ?? {}
  await updateDoc(entryRef(id), {
    status: 'published',
    publishedAt: stored['publishAt'],
    [ENTRY_PUBLISH_SORT_FIELD]: stored['publishAt'],
  })
}

/**
 * `/api/hosts/import`'s `cleanDoc`: the bundle item through the entries
 * allow-list, then a server `updatedAt`. The exported document's `createdAt`
 * and `createdBy` are not on the list, so a restored entry has neither.
 */
const restore = (id: string, exported: Record<string, unknown>) => {
  const permitted = new Set(IMPORTABLE_FIELDS['entries'])
  const clean: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(exported)) {
    if (permitted.has(key) && value !== undefined) clean[key] = value
  }
  const publishSortAt = entryPublishSortStamp(clean as any)
  return setDoc(entryRef(id), {
    ...clean,
    ...(publishSortAt ? { [ENTRY_PUBLISH_SORT_FIELD]: publishSortAt } : {}),
    updatedAt: serverTimestamp(),
  })
}

/** Every entry, and the writes that made it what it is. */
const FIXTURE: Array<[string, () => Promise<unknown>]> = [
  /*
    Published, dated, and spread across two categories — with a date tie and
    a lower-case title, so the tiebreak and byte order both matter.
  */
  [
    'p-aurora',
    async () => {
      await create('p-aurora', { title: 'Aurora release', categoryId: 'releases' }, 1)
      await publish('p-aurora', 20)
    },
  ],
  [
    'p-basalt',
    async () => {
      await create('p-basalt', { title: 'Basalt release', categoryId: 'releases' }, 2)
      await publish('p-basalt', 19)
    },
  ],
  [
    'p-cobalt',
    async () => {
      await create('p-cobalt', { title: 'cobalt guide', categoryId: 'guides' }, 3)
      await publish('p-cobalt', 18)
    },
  ],
  [
    'p-delta',
    async () => {
      await create('p-delta', { title: 'Delta guide', categoryId: 'guides' }, 4)
      await publish('p-delta', 18)
    },
  ],
  [
    'p-ember',
    async () => {
      await create('p-ember', { title: 'Ember notes' }, 5)
      await publish('p-ember', 17)
    },
  ],
  [
    'p-flint',
    async () => {
      await create('p-flint', { title: 'Flint release', categoryId: 'releases' }, 6)
      await publish('p-flint', 16)
    },
  ],
  // Drafts that were never published: no `publishedAt` at all.
  [
    'd-garnet',
    () => create('d-garnet', { title: 'Garnet draft', categoryId: 'guides' }, 7),
  ],
  ['d-harbor', () => create('d-harbor', { title: 'Harbor draft' }, 8)],
  // Published, then pulled: unpublishing deleted the date.
  [
    'u-iris',
    async () => {
      await create('u-iris', { title: 'Iris pulled', categoryId: 'releases' }, 9)
      await publish('u-iris', 15)
      await unpublish('u-iris')
    },
  ],
  // Waiting on a schedule.
  [
    's-jade',
    async () => {
      await create('s-jade', { title: 'Jade scheduled', categoryId: 'releases' }, 10)
      await schedule('s-jade', day(400))
    },
  ],
  // Went out on its schedule, dated by the tenant's flip.
  [
    'f-kelp',
    async () => {
      await create('f-kelp', { title: 'Kelp went out', categoryId: 'guides' }, 11)
      await schedule('f-kelp', day(14))
      await flipDue('f-kelp')
    },
  ],
  // Restored archives: no `createdAt`, a server `updatedAt`.
  [
    'i-lumen',
    () =>
      restore('i-lumen', {
        title: 'Lumen archive',
        slug: 'i-lumen',
        status: 'published',
        publishedAt: day(3),
        categoryId: 'releases',
        createdAt: day(1),
        createdBy: 'uid-old',
      }),
  ],
  [
    'i-moss',
    () =>
      restore('i-moss', {
        title: 'Moss archive draft',
        slug: 'i-moss',
        status: 'draft',
        createdAt: day(1),
      }),
  ],
  // A hand-written bundle that carried no status.
  [
    'i-nova',
    () =>
      restore('i-nova', {
        title: 'Nova no status',
        slug: 'i-nova',
        publishedAt: day(2),
      }),
  ],
  // Created through the API with no title.
  ['t-untitled', () => create('t-untitled', {}, 12)],
  /*
    A document no current writer produces — no stamp, status or date —
    because totality is a claim about every document, not every writer.
  */
  [
    'x-legacy',
    () => setDoc(entryRef('x-legacy'), { title: 'Legacy', slug: 'x-legacy' }),
  ],
]

const IDS = FIXTURE.map(([id]) => id)

/** Every entry as stored, read back by key. */
const stored = new Map<string, DocumentData>()

beforeAll(async () => {
  if (!EMULATED) return
  const [hostname, port] = EMULATOR.split(':')
  app = initializeApp(
    { projectId: 'aglyn-main', apiKey: 'emulator' },
    `agl2853-${Date.now()}`,
  )
  db = getFirestore(app)
  connectFirestoreEmulator(db, hostname, Number(port), {
    mockUserToken: 'owner',
  })
  for (const id of IDS) {
    await deleteDoc(entryRef(id)).catch(() => undefined)
  }
  for (const [, write] of FIXTURE) await write()
  for (const id of IDS) {
    stored.set(id, (await getDoc(entryRef(id))).data() ?? {})
  }
}, 120_000)

afterAll(async () => {
  if (!EMULATED) return
  for (const id of IDS) {
    await deleteDoc(entryRef(id)).catch(() => undefined)
  }
  await terminate(db)
  if (app) await deleteApp(app)
}, 60_000)

/* ── the console's walk, with the listener replaced by a read ─────────── */

const rowsOf = async (built: Query): Promise<Row[]> =>
  (await getDocs(built)).docs.map((snapshot) => ({
    ...snapshot.data(),
    $id: snapshot.id,
  }))

/** One page, planned exactly as `useSortedPagedCollection` plans it. */
async function readPage(
  columnSort: CollectionSort,
  filter: ListFilterRequest | null,
  page: number,
  pageSize: number,
) {
  const base = entryListBase(db, HOST_ID, COLLECTION_ID, filter, columnSort)
  // The walk orders on the stored field, as the content scope hands it to
  // `useSortedPagedCollection` (AGL-3323).
  const sort = entryListStoredSort(columnSort)
  const equalityFields = entryListEqualityFields(filter)
  const keyedIsTotal = sortFieldIsTotal(sort, equalityFields)
  const { keyedLimit } = planKeyedSegment({
    page,
    pageSize,
    keyed: undefined,
    keyedSettled: false,
    keyedIsTotal,
  })
  const keyed = await rowsOf(
    sortedKeyedQuery(base, sort, keyedLimit, equalityFields),
  )
  const keyedPlan = planKeyedSegment({
    page,
    pageSize,
    keyed,
    keyedSettled: true,
    keyedIsTotal,
  })
  const scans: number[] = []
  let widenedTo = 0
  for (;;) {
    const scanLimit = sortedScanLimit(keyedPlan, widenedTo)
    const scan = scanLimit
      ? await rowsOf(sortedUnkeyedQuery(base, scanLimit))
      : undefined
    if (scanLimit) scans.push(scanLimit)
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
      idOf: (row: Row) => row.$id,
    })
    if (plan.scanLimit === scanLimit) return { plan, scans }
    widenedTo = plan.scanLimit
  }
}

/** Every page of a view, as a reader pages it. */
async function walk(
  sort: CollectionSort,
  filter: ListFilterRequest | null,
  pageSize: number,
): Promise<Row[][]> {
  const pages: Row[][] = []
  for (let page = 0; page < IDS.length + 2; page += 1) {
    const { plan } = await readPage(sort, filter, page, pageSize)
    expect(plan.settled).toBe(true)
    pages.push(plan.rows)
    if (!plan.hasMore) return pages
  }
  throw new Error('the walk never reached a last page')
}

/** Firestore's order for the value types these fields hold. */
const compareValues = (a: unknown, b: unknown): number => {
  const rank = (value: unknown) =>
    value === null ? 0 : value instanceof Timestamp ? 1 : 2
  if (rank(a) !== rank(b)) return rank(a) - rank(b)
  if (a instanceof Timestamp && b instanceof Timestamp) {
    return a.toMillis() - b.toMillis()
  }
  if (a === b) return 0
  return String(a) < String(b) ? -1 : 1
}

/* ── the views the table offers ───────────────────────────────────────── */

const SORTS: CollectionSort[] = ENTRY_LIST_SORT_FIELDS.flatMap((field) => [
  { field, direction: 'asc' as const },
  { field, direction: 'desc' as const },
])

const categoriesInFixture = () =>
  [...new Set([...stored.values()].map((data) => data['categoryId']))].filter(
    (value): value is string => typeof value === 'string',
  )

/** Every filter the table can send: none, each status, each category. */
const filters = (): Array<ListFilterRequest | null> => {
  const declared = ENTRY_LIST_FILTER_FIELDS.map((field) => field.column)
  expect(declared).toEqual(['status', 'categoryId'])
  return [
    null,
    ...ENTRY_STATUS_OPTIONS.map((option) => ({
      field: 'status',
      op: 'equals',
      value: option.value,
    })),
    ...categoriesInFixture().map((value) => ({
      field: 'categoryId',
      op: 'equals',
      value,
    })),
  ]
}

/** Who a filter must reach, read off the stored documents rather than a query. */
const membersOf = (filter: ListFilterRequest | null): string[] =>
  IDS.filter(
    (id) => !filter || stored.get(id)?.[filter.field] === filter.value,
  ).sort()

describeEmulated('the entries table under every sort and filter (emulator)', () => {
  it('THE CONTROL: a plain field sort really does hide entries here', async () => {
    // Without this the fixture could hold no gap at all, and every walk below
    // would pass on a keyed segment alone.
    const entries = collection(
      db,
      'hosts',
      HOST_ID,
      'collections',
      COLLECTION_ID,
      'entries',
    )
    for (const field of ENTRY_LIST_SORT_FIELDS) {
      const naive = await getDocs(query(entries, orderBy(field)))
      expect(naive.size).toBeGreaterThan(0)
      expect(naive.size).toBeLessThan(IDS.length)
    }
    // And under a filter: a draft carries no date, so the drafts filter
    // sorted by date the naive way returns none of the drafts there are.
    const drafts = await getDocs(
      query(entries, where('status', '==', 'draft'), orderBy('publishedAt')),
    )
    expect(drafts.size).toBe(0)
    expect(membersOf({ field: 'status', op: 'equals', value: 'draft' }).length)
      .toBeGreaterThan(1)
  })

  it('THE CONTROL: the writers left the gaps production has', () => {
    expect(stored.get('u-iris')).not.toHaveProperty('publishedAt')
    expect(stored.get('i-lumen')).not.toHaveProperty('createdAt')
    expect(stored.get('i-lumen')?.['updatedAt']).toBeInstanceOf(Timestamp)
    expect(stored.get('i-nova')).not.toHaveProperty('status')
    expect(stored.get('t-untitled')).not.toHaveProperty('title')
    expect(stored.get('f-kelp')?.['publishedAt']).toEqual(day(14))
    expect(stored.get('s-jade')).not.toHaveProperty('publishedAt')
  })

  it('reaches every entry exactly once, under every sort and filter, at every page size', async () => {
    for (const filter of filters()) {
      const expected = membersOf(filter)
      expect(expected.length).toBeGreaterThan(0)
      for (const sort of SORTS) {
        for (const pageSize of [1, 3, 10]) {
          const pages = await walk(sort, filter, pageSize)
          const seen = pages.flat().map((row) => row.$id)
          const view = `${sort.field} ${sort.direction}, ${
            filter ? `${filter.field}=${filter.value}` : 'unfiltered'
          }, ${pageSize} per page`
          expect({ view, seen: [...seen].sort() }).toEqual({
            view,
            seen: expected,
          })
          expect({ view, duplicates: seen.length - new Set(seen).size }).toEqual(
            { view, duplicates: 0 },
          )
          pages.forEach((rows, index) => {
            if (index < pages.length - 1) expect(rows).toHaveLength(pageSize)
            else expect(rows.length).toBeLessThanOrEqual(pageSize)
          })
        }
      }
    }
  }, 300_000)

  it('orders what has the value, then walks what lacks it', async () => {
    for (const filter of filters()) {
      for (const columnSort of SORTS) {
        const rows = (await walk(columnSort, filter, 3)).flat()
        const sort = entryListStoredSort(columnSort)
        const split = rows.findIndex((row) => lacksSortField(row, sort.field))
        const keyed = split === -1 ? rows : rows.slice(0, split)
        const rest = split === -1 ? [] : rows.slice(split)
        const pinned = sortFieldIsTotal(sort, entryListEqualityFields(filter))

        // Nothing that lacks the value comes before something that has it.
        expect(rest.every((row) => lacksSortField(row, sort.field))).toBe(true)
        // The keyed rows run in the requested order, ties broken by name in
        // the same direction — or, where the filter pins the sorted field to
        // one value, by name ascending.
        const sign = sort.direction === 'desc' ? -1 : 1
        for (let i = 1; i < keyed.length; i += 1) {
          const byName = keyed[i - 1].$id < keyed[i].$id ? -1 : 1
          if (pinned) {
            expect(byName).toBe(-1)
            continue
          }
          const order = compareValues(
            keyed[i - 1][sort.field],
            keyed[i][sort.field],
          )
          expect(sign * (order || byName)).toBeLessThan(0)
        }
        // The rest run by name.
        expect(rest.map((row) => row.$id)).toEqual(
          rest.map((row) => row.$id).sort(),
        )
      }
    }
  }, 300_000)

  it('opens on the furthest-future schedule, then the newest published date', async () => {
    // AGL-3323: `s-jade` is due on day 400 and has no `publishedAt`. Ordered
    // on `publishedAt` it fell to the unkeyed segment — the last page.
    const [first] = await walk(ENTRY_LIST_DEFAULT_SORT, null, 3)
    expect(first.map((row) => row.$id)).toEqual(['s-jade', 'p-aurora', 'p-basalt'])
  })

  it('ends the dated entries on the schedule when oldest first, drafts after', async () => {
    const rows = (
      await walk({ field: 'publishedAt', direction: 'asc' }, null, 3)
    ).flat()
    const ids = rows.map((row) => row.$id)
    const undated = ['d-garnet', 'd-harbor', 'i-moss', 't-untitled', 'u-iris', 'x-legacy']
    // Every dated entry, then the undated ones in name order.
    expect(ids.slice(-undated.length)).toEqual(undated)
    expect(ids[ids.length - undated.length - 1]).toBe('s-jade')
  })

  it('lists a Scheduled filter in both directions', async () => {
    const scheduled = { field: 'status', op: 'equals', value: 'scheduled' }
    for (const direction of ['desc', 'asc'] as const) {
      const rows = (
        await walk({ field: 'publishedAt', direction }, scheduled, 3)
      ).flat()
      expect(rows.map((row) => row.$id)).toEqual(['s-jade'])
    }
  })

  it('pays for no scan while the first page is all dated entries', async () => {
    const { plan, scans } = await readPage(ENTRY_LIST_DEFAULT_SORT, null, 0, 3)
    expect(plan.keyedLimit).toBe(4)
    expect(scans).toEqual([])
  })
})

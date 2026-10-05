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

import {
  buildTransferFieldCatalog,
  createTransferPolicy,
  matchLookupRequests,
  matchRows,
  plannedWrites,
  transferFieldProblems,
  transferPlanConflicts,
  type TransferPlan,
  type TransferPolicy,
  type TransferRowResult,
  type TransferUndoEntry,
} from '@aglyn/aglyn/data-transfer'
import type {
  TransferApplyWriter,
  TransferResourceContext,
} from '@aglyn/aglyn/plugin-manager/plugin-transfer-resources'
import {
  createEventsTransferResource,
  type EventsTransferResource,
} from './events-transfer'
import { EVENTS_MATCH_KEYS, eventsValuesEqual } from './events-transfer-catalog'

/*==========================================
 * AN IN-MEMORY FIRESTORE
 *
 * Just what the resource asks: documents by path, `getAll`, `create` /
 * `update` / `delete`, and collection queries with `==` / `in`, `orderBy`
 * (a field or `__name__`), `startAfter`, `limit` and `select`. A query drops
 * a document missing an `orderBy` field, as Firestore does.
 *=========================================*/

type Data = Record<string, unknown>

const DELETE = Object.freeze({ delete: true })
const docs = new Map<string, Data>()
/** Every collection query run: its filters and its order. */
const asked: Array<{ wheres: string[]; orders: string[] }> = []

function snapshotOf(path: string) {
  const data = docs.get(path)
  const id = path.slice(path.lastIndexOf('/') + 1)
  return {
    id,
    exists: data !== undefined,
    ref: docRef(path),
    data: () => (data ? { ...data } : undefined),
    get: (field: string) => data?.[field],
  }
}

function docRef(path: string): any {
  const id = path.slice(path.lastIndexOf('/') + 1)
  return {
    id,
    path,
    collection: (name: string) => collectionRef(`${path}/${name}`),
    get: async () => snapshotOf(path),
    create: async (data: Data) => {
      if (docs.has(path)) throw new Error(`ALREADY_EXISTS: ${path}`)
      docs.set(path, { ...data })
    },
    update: async (data: Data) => {
      const current = docs.get(path)
      if (!current) throw new Error(`NOT_FOUND: ${path}`)
      const next = { ...current }
      for (const [key, value] of Object.entries(data)) {
        if (value === DELETE) delete next[key]
        else next[key] = value
      }
      docs.set(path, next)
    },
    delete: async () => {
      docs.delete(path)
    },
  }
}

interface QueryState {
  path: string
  wheres: Array<[string, string, unknown]>
  orders: Array<[string, 'asc' | 'desc']>
  cap: number
  after: unknown[] | null
}

const valueOf = (path: string, data: Data, field: string): unknown =>
  field === '__name__' ? path.slice(path.lastIndexOf('/') + 1) : data[field]

function compare(a: unknown, b: unknown): number {
  if (a === b) return 0
  return (a as number) < (b as number) ? -1 : 1
}

function query(state: QueryState): any {
  const next = (patch: Partial<QueryState>) => query({ ...state, ...patch })
  return {
    where: (field: string, op: string, value: unknown) =>
      next({ wheres: [...state.wheres, [field, op, value]] }),
    orderBy: (field: string, direction: 'asc' | 'desc' = 'asc') =>
      next({ orders: [...state.orders, [field, direction]] }),
    limit: (cap: number) => next({ cap }),
    startAfter: (...after: unknown[]) => next({ after }),
    select: () => next({}),
    get: async () => {
      asked.push({
        wheres: state.wheres.map(
          ([field, op, value]) => `${field} ${op} ${JSON.stringify(value)}`,
        ),
        orders: state.orders.map(
          ([field, direction]) => `${field} ${direction}`,
        ),
      })
      const prefix = `${state.path}/`
      let rows = [...docs.entries()].filter(
        ([path]) =>
          path.startsWith(prefix) && !path.slice(prefix.length).includes('/'),
      )
      for (const [field, op, value] of state.wheres) {
        rows = rows.filter(([, data]) =>
          op === '=='
            ? data[field] === value
            : op === 'in'
              ? (value as unknown[]).includes(data[field])
              : false,
        )
      }
      rows = rows.filter(([path, data]) =>
        state.orders.every(
          ([field]) => valueOf(path, data, field) !== undefined,
        ),
      )
      const order = (left: [string, Data], right: [string, Data]) => {
        for (const [field, direction] of state.orders) {
          const sign = compare(
            valueOf(left[0], left[1], field),
            valueOf(right[0], right[1], field),
          )
          if (sign) return direction === 'desc' ? -sign : sign
        }
        return 0
      }
      rows.sort(order)
      if (state.after) {
        const after = state.after
        rows = rows.filter(([path, data]) => {
          for (let at = 0; at < after.length; at += 1) {
            const [field, direction] = state.orders[at] as [
              string,
              'asc' | 'desc',
            ]
            const sign = compare(valueOf(path, data, field), after[at])
            if (sign) return direction === 'desc' ? sign < 0 : sign > 0
          }
          return false
        })
      }
      const page = rows.slice(0, state.cap).map(([path]) => snapshotOf(path))
      return { docs: page, size: page.length, empty: !page.length }
    },
  }
}

function collectionRef(path: string): any {
  return {
    ...query({
      path,
      wheres: [],
      orders: [],
      cap: Number.POSITIVE_INFINITY,
      after: null,
    }),
    doc: (id: string) => docRef(`${path}/${id}`),
  }
}

const firestore = {
  collection: (name: string) => collectionRef(name),
  getAll: async (...refs: Array<{ path: string }>) =>
    refs.map((ref) => snapshotOf(ref.path)),
}

/*==========================================
 * THE RESOURCE UNDER TEST
 *=========================================*/

const HOST = 'host-1'
const CTX: TransferResourceContext = {
  resource: 'events',
  orgId: 'org-1',
  hostId: HOST,
  actorUid: 'uid-1',
}
const clock = { now: Date.parse('2026-10-05T12:00:00Z') }
const access = { entitled: true }
let nextId = 0

const resource: EventsTransferResource = createEventsTransferResource({
  firestore: firestore as unknown as FirebaseFirestore.Firestore,
  deleteField: () => DELETE,
  timestamp: (ms) => ({ toMillis: () => ms }),
  requireEntitled: async () => {
    if (!access.entitled) throw new Error("Importing events isn't included in any plan — it's a paid add-on.")
  },
  now: () => clock.now,
  createId: () => `new-${(nextId += 1)}`,
})

const at = (iso: string) => Date.parse(iso)
const eventPath = (id: string) => `hosts/${HOST}/events/${id}`
const stored = (id: string) => docs.get(eventPath(id))

function seed(id: string, data: Data): void {
  docs.set(eventPath(id), {
    status: 'draft',
    createdAt: { toMillis: () => at('2026-01-01T00:00:00Z') },
    updatedAt: { toMillis: () => at('2026-01-01T00:00:00Z') },
    ...data,
  })
}

/** Five live events, two deletes (one from before the delete wrote `status`), another site's event. */
function seedSite(): void {
  seed('yoga-1', {
    title: 'Yoga',
    startsAtMs: at('2026-11-02T09:00:00Z'),
    endsAtMs: at('2026-11-02T10:00:00Z'),
    status: 'published',
    location: 'Studio A',
  })
  seed('yoga-2', {
    title: 'Yoga',
    startsAtMs: at('2026-11-09T09:00:00Z'),
    endsAtMs: at('2026-11-09T10:00:00Z'),
    status: 'published',
  })
  seed('gala', {
    title: 'Winter Gala',
    startsAtMs: at('2026-12-12T19:00:00Z'),
    endsAtMs: at('2026-12-12T23:00:00Z'),
    coverImage: '/gala.jpg',
    coverImageAlt: 'A ballroom',
  })
  seed('talk', {
    title: 'Founders talk',
    startsAtMs: at('2026-10-20T17:00:00Z'),
    endsAtMs: at('2026-10-20T18:00:00Z'),
  })
  seed('market', {
    title: 'Market',
    startsAtMs: at('2026-10-10T08:00:00Z'),
    endsAtMs: at('2026-10-10T12:00:00Z'),
  })
  seed('gone', {
    title: 'Gone',
    startsAtMs: at('2026-11-20T09:00:00Z'),
    status: 'deleted',
    deletedAt: 1,
  })
  seed('legacy-gone', {
    title: 'Legacy',
    startsAtMs: at('2026-11-21T09:00:00Z'),
    status: 'published',
    deletedAt: 1,
  })
  docs.set(`hosts/host-2/events/elsewhere`, {
    title: 'Yoga',
    startsAtMs: at('2026-11-02T09:00:00Z'),
    status: 'draft',
  })
}

beforeEach(() => {
  docs.clear()
  asked.length = 0
  nextId = 0
  access.entitled = true
  seedSite()
})

const catalog = () => buildTransferFieldCatalog(resource.fields(CTX) as never)

/** Reads every page of an export. */
async function readAll(
  fieldIds: string[],
  options: Record<string, unknown> = {},
): Promise<Data[][]> {
  const pages: Data[][] = []
  let cursor: string | null = null
  do {
    const page = await resource.readPage(CTX, cursor, fieldIds, options)
    pages.push(page.rows)
    cursor = page.next
  } while (cursor)
  return pages
}

/** A file's rows through lookup, matching and the resource's plan, as the job engine runs them. */
async function planFor(
  rows: Data[],
  policy: Partial<TransferPolicy> = {},
): Promise<TransferPlan> {
  const keys = EVENTS_MATCH_KEYS
  const found = await resource.lookup(CTX, matchLookupRequests(rows, keys))
  return resource.plan(CTX, {
    fields: catalog().fields,
    rows: rows.map((values, index) => ({ index, values })),
    matches: matchRows(rows, keys, found.lookup),
    existing: found.records,
    policy: createTransferPolicy(policy),
  })
}

function memoryWriter(timeLeft = () => 60_000) {
  const ledger = new Map<
    number,
    { result: TransferRowResult; undo?: TransferUndoEntry }
  >()
  const writer: TransferApplyWriter = {
    alreadyApplied: async (row) => ledger.get(row)?.result ?? null,
    markApplied: async (result, undo) => {
      ledger.set(result.row, { result, ...(undo ? { undo } : {}) })
    },
    timeLeftMs: timeLeft,
  }
  return { ledger, writer }
}

async function applyPlan(plan: TransferPlan, writer = memoryWriter().writer) {
  return resource.apply(
    CTX,
    {
      jobId: 'job-1',
      index: 0,
      start: 0,
      end: plan.rows.length,
      rows: plannedWrites(plan),
    },
    writer,
  )
}

/*==========================================
 * SPECS
 *=========================================*/

describe('the events catalog', () => {
  it('lists every field, with the Aglyn ID and the system times read-only', () => {
    const fields = catalog().fields
    expect(transferFieldProblems(fields)).toEqual([])
    expect(fields.map((field) => field.id)).toEqual([
      'title',
      'startsAt',
      'endsAt',
      'location',
      'organizer',
      'description',
      'status',
      'coverImage',
      'coverImageAlt',
      'createdAt',
      'updatedAt',
      'id',
    ])
    const byId = catalog().byId
    expect(byId.get('title')).toMatchObject({ required: true, maxLength: 150 })
    expect(byId.get('startsAt')).toMatchObject({
      required: true,
      type: 'datetime',
    })
    expect(byId.get('description')).toMatchObject({
      type: 'longText',
      maxLength: 2000,
    })
    for (const id of ['createdAt', 'updatedAt', 'id'])
      expect(byId.get(id)).toMatchObject({ system: true, readOnly: true })
  })

  it('finds an event by its Aglyn ID, then by its title and start together', () => {
    expect(resource.matchKeys).toEqual([
      { fieldId: 'id', normalizer: 'aglynId' },
      {
        fieldId: 'title',
        normalizer: 'name',
        with: [{ fieldId: 'startsAt', normalizer: 'instant' }],
      },
    ])
  })

  it('knows the headers of common calendar exports', () => {
    const sources = Object.fromEntries(
      (resource.aliases ?? []).map((entry) => [entry.source, entry.aliases]),
    )
    expect(sources['Google Calendar']?.['title']).toEqual(['Subject'])
    expect(sources['The Events Calendar (WordPress)']?.['location']).toEqual([
      'Event Venue Name',
    ])
  })
})

describe('export reads', () => {
  it('pages the live events newest start first, holding only the chosen fields', async () => {
    const pages = await readAll(['id', 'title', 'startsAt', 'status'], {
      pageSize: 2,
    })
    expect(pages.flat().map((row) => row['id'])).toEqual([
      'gala',
      'yoga-2',
      'yoga-1',
      'talk',
      'market',
    ])
    expect(pages.flat()[0]).toEqual({
      id: 'gala',
      title: 'Winter Gala',
      startsAt: '2026-12-12T19:00:00.000Z',
      status: 'draft',
    })
    // Through the `(status, startsAtMs desc)` composite, the id breaking ties.
    expect(asked[0]).toEqual({
      wheres: ['status in ["draft","published"]'],
      orders: ['startsAtMs desc', '__name__ desc'],
    })
  })

  it('leaves out an event deleted before the delete wrote its status, and counts exactly what it reads', async () => {
    const rows = (await readAll(['id'])).flat()
    expect(rows.map((row) => row['id'])).not.toContain('legacy-gone')
    expect(await resource.count(CTX, {})).toBe(rows.length)
  })

  it('reads the selection by id in its order, skipping deleted and missing events', async () => {
    const ids = ['talk', 'gone', 'nope', 'yoga-1', 'gala']
    const pages = await readAll(['id', 'title'], { ids, pageSize: 2 })
    expect(pages.flat()).toEqual([
      { id: 'talk', title: 'Founders talk' },
      { id: 'yoga-1', title: 'Yoga' },
      { id: 'gala', title: 'Winter Gala' },
    ])
    expect(await resource.count(CTX, { ids })).toBe(3)
  })

  it('reads by status as a query, and refuses a filter it does not have', async () => {
    const rows = (
      await readAll(['id'], { filter: { status: 'published' } })
    ).flat()
    expect(rows.map((row) => row['id'])).toEqual(['yoga-2', 'yoga-1'])
    expect(asked[0]?.wheres).toEqual(['status == "published"'])
    expect(await resource.count(CTX, { filter: { status: 'Draft' } })).toBe(3)
    await expect(
      resource.readPage(CTX, null, ['id'], { filter: { location: 'x' } }),
    ).rejects.toThrow(/location/)
  })

  it('writes the times as ISO and the cover beside its description', async () => {
    const [row] = (
      await readAll(['endsAt', 'coverImage', 'coverImageAlt', 'createdAt'], {
        ids: ['gala'],
      })
    ).flat()
    expect(row).toEqual({
      endsAt: '2026-12-12T23:00:00.000Z',
      coverImage: '/gala.jpg',
      coverImageAlt: 'A ballroom',
      createdAt: '2026-01-01T00:00:00.000Z',
    })
  })
})

describe('lookup', () => {
  it('finds by Aglyn ID and by title and start, never a deleted event or another site’s', async () => {
    const found = await resource.lookup(CTX, [
      { fieldId: 'id', normalizer: 'aglynId', values: ['gala', 'gone'] },
      {
        fieldId: 'title',
        normalizer: 'name',
        with: [{ fieldId: 'startsAt', normalizer: 'instant' }],
        values:
          matchLookupRequests(
            [
              { title: 'YOGA!', startsAt: '2026-11-09T09:00:00.000Z' },
              { title: 'Legacy', startsAt: '2026-11-21T09:00:00Z' },
            ],
            EVENTS_MATCH_KEYS,
          )[1]?.values ?? [],
      },
    ])
    expect([...found.records.keys()].sort()).toEqual(['gala', 'yoga-2'])
    expect(found.records.get('yoga-2')).toMatchObject({
      title: 'Yoga',
      startsAt: '2026-11-09T09:00:00.000Z',
      status: 'published',
    })
  })
})

describe('the dry run', () => {
  it('tells the weekly class apart by its start, and plans a matched row as an update', async () => {
    const plan = await planFor(
      [
        {
          title: 'Yoga',
          startsAt: '2026-11-09T09:00:00.000Z',
          location: 'Studio B',
        },
        { title: 'Yoga', startsAt: '2026-11-16T09:00:00.000Z' },
        {
          id: 'gala',
          title: 'Winter Gala',
          startsAt: '2026-12-12T19:00:00.000Z',
          organizer: 'The board',
        },
      ],
      { fields: { location: { mode: 'overwrite', blank: 'leave' } } },
    )
    expect(plan.rows.map((row) => [row.verdict, row.recordId])).toEqual([
      ['update', 'yoga-2'],
      ['create', null],
      ['update', 'gala'],
    ])
  })

  it('folds a status case and plans an unchanged row as unchanged', async () => {
    const plan = await planFor([{ id: 'yoga-1', status: 'Published' }])
    expect(plan.rows[0]?.verdict).toBe('unchanged')
  })

  it('shows no conflict for a status in another case, as the dry run plans none (AGL-3548)', async () => {
    const rows = [{ id: 'yoga-1', status: 'Published' }]
    const found = await resource.lookup(CTX, matchLookupRequests(rows, EVENTS_MATCH_KEYS))
    const input = {
      fields: catalog().byId,
      rows: rows.map((values, index) => ({ index, values })),
      matches: matchRows(rows, EVENTS_MATCH_KEYS, found.lookup),
      existing: found.records,
      policy: createTransferPolicy({ fieldDefault: { mode: 'overwrite', blank: 'leave' } }),
    }
    expect(transferPlanConflicts(input)).toHaveLength(1)
    expect(transferPlanConflicts({ ...input, valuesEqual: eventsValuesEqual })).toEqual([])
    const status = catalog().byId.get('status') as NonNullable<ReturnType<ReturnType<typeof catalog>['byId']['get']>>
    expect(eventsValuesEqual(status, 'Published', 'published')).toBe(true)
    expect(eventsValuesEqual(status, 'Cancelled', 'cancelled')).toBeUndefined()
  })

  it('refuses a status that is not draft or published', async () => {
    const plan = await planFor([
      {
        title: 'Open day',
        startsAt: '2026-11-01T10:00:00Z',
        status: 'archived',
      },
    ])
    expect(plan.rows[0]).toMatchObject({
      verdict: 'fail',
      reason: 'resourceRule',
    })
    expect(plan.acknowledgementsRequired).toContain('resourceRule')
  })

  it('warns that an end before the start becomes start + one hour', async () => {
    const plan = await planFor(
      [
        {
          title: 'Open day',
          startsAt: '2026-11-01T10:00:00Z',
          endsAt: '2026-11-01T09:00:00Z',
        },
        // Moving an existing event past its stored end trips the same rule.
        { id: 'market', startsAt: '2026-10-10T13:00:00Z' },
      ],
      { fields: { startsAt: { mode: 'overwrite', blank: 'leave' } } },
    )
    expect(plan.rows.map((row) => row.verdict)).toEqual(['create', 'update'])
    const warning = plan.warnings.find(
      (entry) => entry.class === 'resourceRule',
    )
    expect(warning?.rows).toBe(2)
    expect(warning?.samples[0]?.detail).toMatch(/one hour after it starts/)
  })

  it('refuses a row that would clear the title', async () => {
    const plan = await planFor([{ id: 'talk', title: '' }], {
      fields: { title: { mode: 'overwrite', blank: 'clear' } },
    })
    expect(plan.rows[0]).toMatchObject({
      verdict: 'fail',
      reason: 'resourceRule',
    })
  })

  it('leaves the add-on to the transfer gate: the dry run reads no plan (AGL-3548)', async () => {
    access.entitled = false
    const plan = await planFor([
      { title: 'Open day', startsAt: '2026-11-01T10:00:00Z' },
    ])
    expect(plan.rows[0]).toMatchObject({ verdict: 'create' })
  })
})

describe('apply', () => {
  it('creates through the shared write rule, with fresh ids and both times', async () => {
    const plan = await planFor([
      {
        title: 'Open day',
        startsAt: '2026-11-01T10:00:00Z',
        endsAt: '2026-11-01T09:00:00Z',
        coverImageAlt: 'A poster',
        status: 'Published',
      },
    ])
    const { results, undo } = await applyPlan(plan)
    expect(results).toEqual([{ row: 0, outcome: 'created', recordId: 'new-1' }])
    const doc = stored('new-1') as Data
    expect(doc).toMatchObject({
      title: 'Open day',
      startsAtMs: at('2026-11-01T10:00:00Z'),
      endsAtMs: at('2026-11-01T11:00:00Z'),
      status: 'published',
    })
    // No cover, so no cover description, as the editor stores it.
    expect(doc).not.toHaveProperty('coverImageAlt')
    expect((doc['createdAt'] as { toMillis(): number }).toMillis()).toBe(
      clock.now,
    )
    expect(undo[0]).toEqual({
      row: 0,
      recordId: 'new-1',
      action: 'created',
      written: {
        title: 'Open day',
        startsAt: '2026-11-01T10:00:00.000Z',
        endsAt: '2026-11-01T11:00:00.000Z',
        status: 'published',
      },
    })
  })

  it('makes a new event a draft unless the file says otherwise', async () => {
    await applyPlan(
      await planFor([{ title: 'Open day', startsAt: '2026-11-01T10:00:00Z' }]),
    )
    expect(stored('new-1')?.['status']).toBe('draft')
  })

  it('updates in place, clears what the policy clears, and keeps what undo needs', async () => {
    const plan = await planFor(
      [{ id: 'yoga-1', location: '', organizer: 'Mina' }],
      {
        fields: { location: { mode: 'overwrite', blank: 'clear' } },
      },
    )
    const { results, undo } = await applyPlan(plan)
    expect(results).toEqual([
      { row: 0, outcome: 'updated', recordId: 'yoga-1' },
    ])
    expect(stored('yoga-1')).not.toHaveProperty('location')
    expect(stored('yoga-1')).toMatchObject({
      organizer: 'Mina',
      status: 'published',
      title: 'Yoga',
    })
    expect(undo[0]).toMatchObject({
      action: 'updated',
      previous: { location: 'Studio A', organizer: null },
      written: { location: null, organizer: 'Mina' },
    })
  })

  it('never writes a row twice when a chunk is retried', async () => {
    const plan = await planFor([
      { title: 'Open day', startsAt: '2026-11-01T10:00:00Z' },
      { id: 'talk', organizer: 'Lee' },
    ])
    const { writer, ledger } = memoryWriter()
    await applyPlan(plan, writer)
    const before = [...docs.keys()].length
    const again = await applyPlan(plan, writer)
    expect([...docs.keys()].length).toBe(before)
    expect(nextId).toBe(1)
    expect(again.results).toEqual(
      [...ledger.values()].map((entry) => entry.result),
    )
    expect(again.undo).toEqual([])
  })

  it('stops at a row boundary when the budget runs short', async () => {
    const plan = await planFor([
      { title: 'One', startsAt: '2026-11-01T10:00:00Z' },
      { title: 'Two', startsAt: '2026-11-02T10:00:00Z' },
    ])
    let left = 3
    const { writer } = memoryWriter(() => ((left -= 1) > 1 ? 60_000 : 0))
    const { results } = await applyPlan(plan, writer)
    expect(results).toHaveLength(1)
  })

  it('fails a row whose event was deleted after the dry run', async () => {
    const plan = await planFor([{ id: 'talk', organizer: 'Lee' }])
    docs.set(eventPath('talk'), {
      ...stored('talk'),
      status: 'deleted',
      deletedAt: 1,
    })
    const { results } = await applyPlan(plan)
    expect(results[0]).toMatchObject({
      outcome: 'failed',
      reason: 'matchedRecordMissing',
    })
  })

  it('writes nothing for a workspace without the add-on', async () => {
    const plan = await planFor([
      { title: 'Open day', startsAt: '2026-11-01T10:00:00Z' },
    ])
    access.entitled = false
    await expect(applyPlan(plan)).rejects.toThrow(/add-on/)
    expect(nextId).toBe(0)
  })
})

describe('revert', () => {
  async function imported() {
    const plan = await planFor(
      [
        { title: 'Open day', startsAt: '2026-11-01T10:00:00Z' },
        { id: 'talk', organizer: 'Lee', location: 'Hall' },
      ],
      { fields: { location: { mode: 'overwrite', blank: 'leave' } } },
    )
    const { undo } = await applyPlan(plan)
    return { jobId: 'job-1', chunk: 0, entries: undo }
  }

  it('deletes what it created and restores what it changed', async () => {
    const snapshot = await imported()
    const { done, conflicts } = await resource.revert(CTX, snapshot)
    expect(conflicts).toEqual([])
    expect(done.map((step) => step.action)).toEqual(['delete', 'restore'])
    expect(stored('new-1')).toBeUndefined()
    expect(stored('talk')).not.toHaveProperty('organizer')
    expect(stored('talk')).not.toHaveProperty('location')
    expect(stored('talk')?.['title']).toBe('Founders talk')
  })

  it('asks about an event edited since, and does what the person decides', async () => {
    const snapshot = await imported()
    docs.set(eventPath('talk'), {
      ...stored('talk'),
      organizer: 'Someone else',
    })
    docs.set(eventPath('new-1'), { ...stored('new-1'), status: 'published' })

    const asked = await resource.revert(CTX, snapshot)
    expect(asked.conflicts.map((step) => step.recordId).sort()).toEqual([
      'new-1',
      'talk',
    ])
    expect(stored('new-1')).toBeDefined()

    const kept = await resource.revert(CTX, snapshot, {
      talk: 'keep',
      'new-1': 'keep',
    })
    expect(kept.done.map((step) => step.action)).toEqual(['nothing', 'nothing'])
    expect(stored('talk')?.['organizer']).toBe('Someone else')

    const reverted = await resource.revert(CTX, snapshot, {
      talk: 'revert',
      'new-1': 'revert',
    })
    expect(reverted.conflicts).toEqual([])
    expect(stored('new-1')).toBeUndefined()
    expect(stored('talk')).not.toHaveProperty('organizer')
  })

  it('does nothing for an event deleted since', async () => {
    const snapshot = await imported()
    docs.set(eventPath('talk'), {
      ...stored('talk'),
      status: 'deleted',
      deletedAt: 1,
    })
    const { done } = await resource.revert(CTX, snapshot)
    expect(done.find((step) => step.recordId === 'talk')).toEqual({
      action: 'nothing',
      recordId: 'talk',
      why: 'gone',
    })
  })
})

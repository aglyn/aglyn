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
 * A dataset's records as a transfer resource (AGL-3530), the server half,
 * run against an in-memory Firestore: what an export reads (the selection,
 * the table's filter, a collaborator's scope, and the count it promises),
 * how a row finds its record, the dry run held to the dataset (references
 * resolved, the plan's room, the model's rules), and the writes and their
 * undo through the dataset's own write path — the integrity index on every
 * write, the record cap in the creating transaction, a retried chunk never
 * creating twice, and undo keeping references whole.
 */

import {
  TRANSFER_ID_FIELD,
  buildTransferFieldCatalog,
  createTransferPolicy,
  transferLookupNewValue,
  type PlannedTransferRow,
  type TransferRowResult,
  type TransferUndoEntry,
} from '@aglyn/aglyn/data-transfer'
import type {
  TransferApplyWriter,
  TransferMatchKeyOffer,
  TransferRecordsHooks,
  TransferResourceContext,
} from '@aglyn/aglyn/plugin-manager/plugin-transfer-resources'

/*------------------------------------------
 * An in-memory Firestore, as far as the hooks use one
 *-----------------------------------------*/

const DELETE = Symbol('delete')
const ID = '__name__'
const store = new Map<string, Record<string, unknown>>()

const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T
const at = (data: Record<string, unknown>, path: string): unknown =>
  path.split('.').reduce<unknown>((value, key) => (value as Record<string, unknown> | undefined)?.[key], data)

function snapshot(path: string) {
  const data = store.get(path)
  const id = path.split('/').pop() as string
  return { id, ref: docRef(path), exists: data !== undefined, data: () => (data ? clone(data) : undefined), get: (field: string) => (data ? clone(at(data, field)) : undefined) }
}

type Filter = { path: string; op: string; value: unknown }

function query(collection: string, filters: Filter[] = [], after: string | null = null, take: number | null = null): any {
  const run = () => {
    let docs = [...store.keys()]
      .filter((path) => path.startsWith(`${collection}/`) && !path.slice(collection.length + 1).includes('/'))
      .sort()
      .map(snapshot)
    for (const filter of filters) {
      docs = docs.filter((doc) => {
        const value = filter.path === ID ? doc.id : at(doc.data() as Record<string, unknown>, filter.path)
        if (filter.op === '==') return value === filter.value
        if (filter.op === 'in') return (filter.value as unknown[]).includes(value)
        if (filter.op === 'array-contains') return Array.isArray(value) && value.includes(filter.value)
        throw new Error(`op ${filter.op}`)
      })
    }
    if (after !== null) docs = docs.filter((doc) => doc.id > after)
    return take === null ? docs : docs.slice(0, take)
  }
  return {
    path: collection,
    where: (path: string, op: string, value: unknown) => query(collection, [...filters, { path, op, value }], after, take),
    orderBy: (path: string) => {
      if (path !== ID) throw new Error(`ordered by ${path}, which drops records without it`)
      return query(collection, filters, after, take)
    },
    startAfter: (id: string) => query(collection, filters, id, take),
    limit: (count: number) => query(collection, filters, after, count),
    get: async () => {
      const docs = run()
      return { docs, empty: !docs.length, size: docs.length }
    },
    count: () => ({ isCount: true, get: async () => ({ data: () => ({ count: run().length }) }), run }),
    doc: (id: string) => docRef(`${collection}/${id}`),
  }
}

function docRef(path: string): any {
  return {
    path,
    id: path.split('/').pop(),
    get: async () => snapshot(path),
    collection: (name: string) => query(`${path}/${name}`),
    update: async (data: Record<string, unknown>) => write(path, data, Object.keys(data)),
  }
}

function write(path: string, data: Record<string, unknown>, fields: string[] | null) {
  const next: Record<string, unknown> = fields ? { ...(store.get(path) ?? {}) } : {}
  for (const [key, value] of Object.entries(data)) {
    if (fields && !fields.includes(key)) continue
    if (value === DELETE) delete next[key]
    else next[key] = clone(value)
  }
  for (const field of fields ?? []) if (!(field in data)) delete next[field]
  store.set(path, next)
}

const firestore: any = {
  collection: (name: string) => query(name),
  getAll: async (...refs: Array<{ path: string }>) => refs.map((ref) => snapshot(ref.path)),
  batch: () => {
    const ops: Array<() => void> = []
    return {
      set: (ref: { path: string }, data: Record<string, unknown>, options?: { mergeFields?: string[] }) =>
        ops.push(() => write(ref.path, data, options?.mergeFields ?? null)),
      update: (ref: { path: string }, data: Record<string, unknown>) => ops.push(() => write(ref.path, data, Object.keys(data))),
      delete: (ref: { path: string }) => ops.push(() => store.delete(ref.path)),
      commit: async () => ops.forEach((op) => op()),
    }
  },
  runTransaction: async (body: (tx: any) => Promise<unknown>) => {
    const ops: Array<() => void> = []
    const result = await body({
      get: async (target: any) => (target.isCount ? { data: () => ({ count: target.run().length }) } : snapshot(target.path)),
      getAll: async (...refs: Array<{ path: string }>) => refs.map((ref) => snapshot(ref.path)),
      create: (ref: { path: string }, data: Record<string, unknown>) => {
        if (store.has(ref.path)) throw new Error('ALREADY_EXISTS')
        ops.push(() => write(ref.path, data, null))
      },
      update: (ref: { path: string }, data: Record<string, unknown>) => ops.push(() => write(ref.path, data, Object.keys(data))),
    })
    ops.forEach((op) => op())
    return result
  },
}

const mockMember: { value: Record<string, unknown> | null } = { value: null }
const mockStorageRefusal: { value: unknown } = { value: null }
const mockAnnounce = jest.fn(async () => ({ dropped: 0 }))

jest.mock('firebase-admin/firestore', () => ({
  __esModule: true,
  FieldPath: { documentId: () => '__name__' },
  FieldValue: { delete: () => DELETE },
  Timestamp: { now: () => 1_700_000_000_000, fromDate: (date: Date) => date.getTime() },
}))
jest.mock('@aglyn/tenant-data-admin', () => ({
  __esModule: true,
  firebaseAdmin: { app: () => ({ firestore: () => firestore }) },
  dataStorageRefusal: async () => mockStorageRefusal.value,
  isServerReleaseFlagOnForOrg: async () => true,
  resolveOrgMembership: async () => (mockMember.value ? { member: mockMember.value } : null),
}))
jest.mock('@aglyn/tenant-data-admin/server/transfer-jobs', () => ({
  __esModule: true,
  TransferEngineError: class TransferEngineError extends Error {
    constructor(readonly code: string, readonly status: number, message: string) {
      super(message)
    }
  },
}))
jest.mock('@aglyn/aglyn/server', () => ({
  __esModule: true,
  checkQuota: jest.requireActual('@aglyn/aglyn/app-utils/plan-entitlements').checkQuota,
  memberCanSee: jest.requireActual('@aglyn/aglyn/app-utils/organizations').memberCanSee,
  ensureDeclaredCustomFieldTypes: async () => undefined,
}))
jest.mock('../server/announce-dataset-records', () => ({
  __esModule: true,
  announceDatasetRecords: (...args: unknown[]) => mockAnnounce(...(args as [])),
}))

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { datasetTransferHooks, transferRecordId } = require('./dataset-transfer.server')
const hooks: TransferRecordsHooks = datasetTransferHooks(() => ({ firestore }))

/*------------------------------------------
 * The workspace
 *-----------------------------------------*/

const ORG = 'orgs/o1'
const DS = `${ORG}/datasets/ds`
const PEOPLE = `${ORG}/datasets/people`
const JOBS = `${ORG}/datasets/jobs`

const SERVICES = {
  order: ['title', 'slug', 'kind', 'count', 'owner'],
  fields: {
    title: { name: 'Title', type: 'text', required: true, validation: { max: 30 } },
    slug: { name: 'Page address', type: 'text', customType: 'pageAddress', slugFrom: 'title' },
    kind: { name: 'Kind', type: 'text', validation: { options: ['Residential', 'Commercial'] } },
    count: { name: 'Count', type: 'int32' },
    owner: { name: 'Owner', type: 'reference', reference: { datasetId: 'people', displayFieldId: 'name' } },
  },
}

/** A record as the dataset's own writers leave it: values with their filter values. */
const record = (values: Record<string, unknown>) => {
  const { datasetIntegrityFields } = jest.requireActual('../model/dataset-models')
  return { values, ...datasetIntegrityFields(SERVICES, values) }
}

/** A People record with its filter fields, as the dataset's writers leave one. */
const peopleRecord = (values: Record<string, unknown>) => {
  const { datasetIntegrityFields } = jest.requireActual('../model/dataset-models')
  return { values, ...datasetIntegrityFields({ order: ['name'], fields: { name: { name: 'Name', type: 'text' } } }, values) }
}

/** A plan whose dataset holds five records, so the cap is reachable. */
const CAPPED = { plan: 'scale', entitlements: { recordsPerDataset: 5 } }

const seed = (org: Record<string, unknown> = { plan: 'scale' }) => {
  store.clear()
  store.set(ORG, org)
  store.set(DS, { displayName: 'Services', model: SERVICES, visibleTo: ['org'] })
  store.set(PEOPLE, {
    displayName: 'People',
    model: { order: ['name'], fields: { name: { name: 'Name', type: 'text' } } },
    visibleTo: ['org'],
  })
  store.set(`${PEOPLE}/records/p1`, peopleRecord({ name: 'Ada' }))
  store.set(`${PEOPLE}/records/p2`, peopleRecord({ name: 'Bob' }))
  store.set(`${DS}/records/r1`, record({ title: 'Roofing', slug: 'roofing', kind: 'Commercial', count: 1 }))
  store.set(`${DS}/records/r2`, record({ title: 'Siding', slug: 'siding', count: 2, owner: 'p1' }))
  store.set(`${DS}/records/r3`, record({ title: 'Gutters', slug: 'gutters', kind: 'Residential' }))
}

const ctx = (patch: Partial<TransferResourceContext> = {}): TransferResourceContext => ({
  resource: 'data.dataset:ds',
  orgId: 'o1',
  hostId: null,
  actorUid: 'u1',
  jobId: 'job-1',
  ...patch,
})

const ledger = new Map<number, { result: TransferRowResult; undo?: TransferUndoEntry }>()
const writer: TransferApplyWriter = {
  alreadyApplied: async (row) => ledger.get(row)?.result ?? null,
  markApplied: async (result, undo) => void ledger.set(result.row, { result, ...(undo ? { undo } : {}) }),
  timeLeftMs: () => 60_000,
}

const planned = (row: Partial<PlannedTransferRow> & Pick<PlannedTransferRow, 'index' | 'verdict'>): PlannedTransferRow => ({
  recordId: null,
  diff: [],
  heldBack: [],
  warnings: [],
  match: { kind: 'new' },
  ...row,
})
const change = (fieldId: string, after: unknown, before: unknown = null) => ({
  fieldId,
  before,
  after,
  mode: 'overwrite' as const,
  source: 'default' as const,
  rule: 'written' as const,
})

beforeEach(() => {
  seed()
  ledger.clear()
  mockMember.value = null
  mockStorageRefusal.value = null
  mockAnnounce.mockClear()
})

/*------------------------------------------
 * The cases
 *-----------------------------------------*/

describe('what the dataset offers', () => {
  it('lists its fields under its name, and starts matching on the ID and the page address', async () => {
    const catalog = buildTransferFieldCatalog(await hooks.fields(ctx()))
    expect(catalog.groups[0]).toEqual({ id: 'fields', label: 'Services' })
    expect(catalog.fields.map((field) => field.id)).toEqual(
      expect.arrayContaining(['title', 'slug', 'kind', 'count', 'owner', TRANSFER_ID_FIELD]),
    )
    const offer = await (hooks.matchKeys as (c: TransferResourceContext) => Promise<TransferMatchKeyOffer>)(ctx())
    expect(offer.defaults).toEqual(['id', 'slug'])
  })

  it('lists a reference as a lookup of its dataset, creatable when a record there needs only a name', async () => {
    const owner = buildTransferFieldCatalog(await hooks.fields(ctx())).byId.get('owner')
    expect(owner).toMatchObject({
      type: 'lookup',
      lookup: { resource: 'data.dataset:people', by: ['id', 'name'], creatable: true },
    })
    // A target that requires more than the name offers no "create it".
    const people = store.get(PEOPLE) as Record<string, any>
    store.set(PEOPLE, {
      ...people,
      model: { order: ['name', 'email'], fields: { ...people.model.fields, email: { name: 'Email', type: 'text', required: true } } },
    })
    const strict = buildTransferFieldCatalog(await hooks.fields(ctx())).byId.get('owner')
    expect(strict?.lookup?.creatable).toBeUndefined()
  })

  it('never imports a reference to a dataset the member cannot see, and still exports it', async () => {
    mockMember.value = { role: 'editor', allHosts: false, hostAccess: { h1: 'editor' } }
    store.set(DS, { ...store.get(DS), visibleTo: ['host:h1'] })
    store.set(PEOPLE, { ...store.get(PEOPLE), visibleTo: ['host:h9'] })
    const owner = buildTransferFieldCatalog(await hooks.fields(ctx())).byId.get('owner')
    expect(owner).toMatchObject({ readOnly: true, lookup: { resource: 'data.dataset:people' } })
    expect(owner?.lookup?.creatable).toBeUndefined()
  })

  it('is no dataset at all to a member it is not shared with, or for a key naming none', async () => {
    mockMember.value = { role: 'editor', allHosts: false, hostAccess: { h9: 'editor' } }
    store.set(DS, { ...store.get(DS), visibleTo: ['host:h1'] })
    await expect(hooks.fields(ctx())).rejects.toMatchObject({ code: 'notFound' })
    await expect(hooks.fields(ctx({ resource: 'data.dataset:missing' }))).rejects.toMatchObject({ code: 'notFound' })
  })
})

describe('the export reads', () => {
  const ids = ['id', 'title', 'kind']
  const readAll = async (options: Parameters<TransferRecordsHooks['readPage']>[3]) => {
    const rows: Array<Record<string, unknown>> = []
    let cursor: string | null = null
    do {
      const page = await hooks.readPage(ctx(), cursor, ids, { ...options, pageSize: 2 })
      rows.push(...page.rows)
      cursor = page.next
    } while (cursor)
    return rows
  }

  it('every record, page by page in document order, holding only the chosen fields — and counts them first', async () => {
    expect(await readAll({})).toEqual([
      { id: 'r1', title: 'Roofing', kind: 'Commercial' },
      { id: 'r2', title: 'Siding' },
      { id: 'r3', title: 'Gutters', kind: 'Residential' },
    ])
    expect(await hooks.count?.(ctx(), {})).toBe(3)
  })

  it('the selection, skipping a record deleted since, with a count that matches', async () => {
    const selection = { ids: ['r3', 'gone', 'r1'] }
    expect((await readAll(selection)).map((row) => row['id'])).toEqual(['r3', 'r1'])
    expect(await hooks.count?.(ctx(), selection)).toBe(2)
  })

  it('the records the table’s filter shows, planned the way the table plans it', async () => {
    const filter = { clauses: [{ field: 'f:kind', op: 'equals', value: 'Commercial' }], search: [] }
    const { datasetRecordFilter } = jest.requireActual('../components/dataset-record-filter')
    const column = datasetRecordFilter(SERVICES).fields.find((field: { column: string }) => field.column.endsWith('kind')).column
    filter.clauses[0].field = column
    expect(await readAll({ filter })).toEqual([{ id: 'r1', title: 'Roofing', kind: 'Commercial' }])
    expect(await hooks.count?.(ctx(), { filter })).toBe(1)
  })

  it('nothing for a collaborator whose scope tokens do not reach the dataset', async () => {
    await expect(hooks.readPage(ctx(), null, ids, { scopeTokens: ['host:h9'] })).rejects.toMatchObject({ code: 'notFound' })
    await expect(hooks.count?.(ctx(), { scopeTokens: ['host:h9'] })).rejects.toMatchObject({ code: 'notFound' })
    expect((await hooks.readPage(ctx(), null, ids, { scopeTokens: ['org'] })).rows).toHaveLength(3)
  })
})

describe('a row finds its record', () => {
  it('by its ID, and by a text field through the filter values, caseless', async () => {
    const found = await hooks.lookup(ctx(), [
      { fieldId: 'id', normalizer: 'aglynId', values: ['r2', 'nope'] },
      { fieldId: 'title', normalizer: 'caseless', values: ['roofing', 'nothing'] },
    ])
    expect(found.lookup.get('id\u0000r2')).toEqual(['r2'])
    expect(found.lookup.get('title\u0000roofing')).toEqual(['r1'])
    expect(found.lookup.has('title\u0000nothing')).toBe(false)
    expect(found.records.get('r1')).toMatchObject({ id: 'r1', title: 'Roofing', count: 1 })
  })

  it('suggests records named like a value no reference found, by a word of the display field', async () => {
    store.set(`${PEOPLE}/records/p3`, peopleRecord({ name: 'Adam Smith' }))
    store.set(`${PEOPLE}/records/p4`, peopleRecord({ name: 'Zed' }))
    const answer = await hooks.suggest?.(ctx({ resource: 'data.dataset:people' }), {
      by: ['id', 'name'],
      values: ['Adaa', 'Smith Adam', 'Quinn'],
    })
    // A misspelling past the first letters still finds the record.
    expect(answer?.['Adaa']?.map((one) => one.label)).toEqual(expect.arrayContaining(['Ada']))
    expect(answer?.['Smith Adam']?.[0]).toEqual({ recordId: 'p3', label: 'Adam Smith' })
    expect(answer?.['Quinn']).toEqual([])
  })

  it('answers as a reference’s target: the engine asks the referenced dataset by its display field', async () => {
    // A `lookup` field names `data.dataset:people` by `['id', 'name']`; the
    // job engine resolves a cell through that dataset's own lookup.
    const found = await hooks.lookup(ctx({ resource: 'data.dataset:people' }), [
      { fieldId: 'name', normalizer: 'caseless', values: ['ada'] },
    ])
    expect(found.lookup.get('name\u0000ada')).toEqual(['p1'])
  })
})

describe('the dry run', () => {
  const plan = async (rows: Array<Record<string, unknown>>) => {
    const catalog = buildTransferFieldCatalog(await hooks.fields(ctx()))
    return (hooks.plan as NonNullable<TransferRecordsHooks['plan']>)(ctx(), {
      fields: catalog.fields,
      rows: rows.map((values, index) => ({ index, values })),
      matches: rows.map(() => ({ kind: 'new' as const })),
      existing: new Map(),
      policy: createTransferPolicy(),
    })
  }

  it('plans a reference as the engine resolved it: a record’s id, or a name to create', async () => {
    // The engine's lookup step (AGL-3541) has already turned each cell into
    // an id or the person's "create it"; the dry run holds neither back.
    const result = await plan([
      { title: 'A', owner: 'p2' },
      { title: 'B', owner: transferLookupNewValue('Cy') },
    ])
    expect(result.rows.map((row) => row.verdict)).toEqual(['create', 'create'])
    expect(result.rows[1].diff.find((entry) => entry.fieldId === 'owner')?.after).toBe(transferLookupNewValue('Cy'))
  })

  it('fails what the plan has no room for, and what the model refuses', async () => {
    seed(CAPPED)
    const room = 2
    const rows: Array<Record<string, unknown>> = Array.from({ length: room + 2 }, (_unused, index) => ({ title: `Row ${index}` }))
    rows.unshift({ title: 'x'.repeat(40) })
    const result = await plan(rows)
    // The refused row takes none of the room a valid row could have had.
    expect(result.rows[0]).toMatchObject({ verdict: 'fail', reason: 'refusedValue', missing: ['title'] })
    expect(result.summary.create).toBe(room)
    expect(result.rows.slice(1).map((row) => row.verdict)).toEqual(['create', 'create', 'fail', 'fail'])
    expect(result.rows[room + 1]).toMatchObject({ verdict: 'fail', reason: 'planLimit' })
    expect(result.acknowledgementsRequired).toContain('planLimit')
  })

  it('creates nothing while the data storage band is full', async () => {
    mockStorageRefusal.value = { includedMb: 5 }
    const result = await plan([{ title: 'A' }])
    expect(result.rows[0]).toMatchObject({ verdict: 'fail', reason: 'planLimit' })
  })
})

describe('the writes', () => {
  it('create through the dataset’s write path: coerced, addressed, indexed, counted in', async () => {
    const result = await hooks.apply(
      ctx(),
      { jobId: 'job-1', index: 0, start: 0, end: 1, rows: [planned({ index: 0, verdict: 'create', diff: [change('title', 'Kitchen Remodel'), change('count', 4), change('owner', 'p2')] })] },
      writer,
    )
    const id = transferRecordId('job-1', 0)
    expect(result.results).toEqual([{ row: 0, outcome: 'created', recordId: id }])
    const stored = store.get(`${DS}/records/${id}`) as Record<string, any>
    expect(stored.values).toEqual({ title: 'Kitchen Remodel', count: 4, owner: 'p2', slug: 'kitchen-remodel' })
    expect(stored.referencedIds).toEqual(['p2'])
    expect(stored.filterValues).toMatchObject({ title: 'kitchen remodel', count: 4 })
    expect(stored.order).toBe(3)
    expect(ledger.get(0)?.undo).toMatchObject({ action: 'created', recordId: id, written: { title: 'Kitchen Remodel', owner: 'p2' } })
    expect(mockAnnounce).toHaveBeenCalledTimes(1)
  })

  it('creates a record a reference names for creation in the referenced dataset, once, through its write path', async () => {
    const rows = [
      planned({ index: 0, verdict: 'create', diff: [change('title', 'Decks'), change('owner', transferLookupNewValue('Cy'))] }),
      planned({ index: 1, verdict: 'update', recordId: 'r1', diff: [change('owner', transferLookupNewValue('cy '))] }),
    ]
    await hooks.apply(ctx(), { jobId: 'job-1', index: 0, start: 0, end: 2, rows }, writer)
    // A later chunk naming it again finds the same record.
    ledger.clear()
    const later = planned({ index: 2, verdict: 'create', diff: [change('title', 'Fences'), change('owner', transferLookupNewValue('Cy'))] })
    await hooks.apply(ctx(), { jobId: 'job-1', index: 1, start: 2, end: 3, rows: [later] }, writer)

    const created = [...store.keys()].filter((path) => path.startsWith(`${PEOPLE}/records/`) && !/\/p\d$/.test(path))
    expect(created).toHaveLength(1)
    const cy = store.get(created[0] as string) as Record<string, any>
    expect(cy.values).toEqual({ name: 'Cy' })
    // Indexed as every create is, and counted in at the end of the dataset.
    expect(cy.filterValues).toEqual({ name: 'cy' })
    expect(cy.order).toBe(2)
    const id = (created[0] as string).split('/').pop()
    expect((store.get(`${DS}/records/${transferRecordId('job-1', 0)}`) as Record<string, any>).values.owner).toBe(id)
    expect((store.get(`${DS}/records/r1`) as Record<string, any>).values.owner).toBe(id)
    expect((store.get(`${DS}/records/r1`) as Record<string, any>).referencedIds).toEqual([id])
    expect((store.get(`${DS}/records/${transferRecordId('job-1', 2)}`) as Record<string, any>).values.owner).toBe(id)
    expect(mockAnnounce).toHaveBeenCalledWith(expect.objectContaining({ datasetId: 'people' }))
  })

  it('fails a row whose reference could not be created, saying why, and writes nothing for it', async () => {
    const people = store.get(PEOPLE) as Record<string, any>
    store.set(PEOPLE, {
      ...people,
      model: { order: ['name'], fields: { name: { name: 'Name', type: 'text', validation: { max: 5 } } } },
    })
    const result = await hooks.apply(
      ctx(),
      {
        jobId: 'job-1',
        index: 0,
        start: 0,
        end: 1,
        rows: [planned({ index: 0, verdict: 'create', diff: [change('title', 'Decks'), change('owner', transferLookupNewValue('Bartholomew'))] })],
      },
      writer,
    )
    expect(result.results[0]).toMatchObject({ row: 0, outcome: 'failed', reason: 'refusedValue' })
    expect(result.results[0]?.message).toContain('“Bartholomew” could not be created in People')
    expect(store.has(`${DS}/records/${transferRecordId('job-1', 0)}`)).toBe(false)
  })

  it('never creates a row twice when a chunk is retried after its write landed', async () => {
    const chunk = { jobId: 'job-1', index: 0, start: 0, end: 1, rows: [planned({ index: 0, verdict: 'create', diff: [change('title', 'Once')] })] }
    await hooks.apply(ctx(), chunk, writer)
    ledger.clear() // the write landed; the ledger never heard of it
    const again = await hooks.apply(ctx(), chunk, writer)
    expect(again.results[0]).toMatchObject({ outcome: 'created', recordId: transferRecordId('job-1', 0) })
    expect([...store.keys()].filter((path) => path.startsWith(`${DS}/records/`))).toHaveLength(4)
  })

  it('holds creates to the record cap inside the creating transaction', async () => {
    seed(CAPPED)
    const room = 2
    const rows = Array.from({ length: room + 2 }, (_unused, index) => planned({ index, verdict: 'create', diff: [change('title', `Row ${index}`)] }))
    const result = await hooks.apply(ctx(), { jobId: 'job-1', index: 0, start: 0, end: rows.length, rows }, writer)
    expect(result.results.filter((one) => one.outcome === 'created')).toHaveLength(room)
    expect(result.results.filter((one) => one.outcome === 'failed').map((one) => one.reason)).toEqual(['planLimit', 'planLimit'])
  })

  it('update the fields the row changes, re-deriving the index, and keep what undo needs', async () => {
    await hooks.apply(
      ctx(),
      {
        jobId: 'job-1',
        index: 0,
        start: 0,
        end: 1,
        rows: [planned({ index: 0, verdict: 'update', recordId: 'r2', diff: [change('owner', null, 'p1'), change('count', 7, 2)] })],
      },
      writer,
    )
    const stored = store.get(`${DS}/records/r2`) as Record<string, any>
    expect(stored.values).toEqual({ title: 'Siding', slug: 'siding', count: 7 })
    // The last reference cleared REMOVES the index rather than leaving it stale.
    expect(stored).not.toHaveProperty('referencedIds')
    expect(stored.filterValues).toMatchObject({ count: 7 })
    expect(ledger.get(0)?.undo).toEqual({
      row: 0,
      recordId: 'r2',
      action: 'updated',
      previous: { owner: 'p1', count: 2 },
      written: { owner: null, count: 7 },
      modes: { owner: 'overwrite', count: 'overwrite' },
    })
  })

  it('fail an update the model refuses, naming why, and a record deleted since the dry run', async () => {
    const result = await hooks.apply(
      ctx(),
      {
        jobId: 'job-1',
        index: 0,
        start: 0,
        end: 2,
        rows: [
          planned({ index: 0, verdict: 'update', recordId: 'r1', diff: [change('kind', 'Industrial')] }),
          planned({ index: 1, verdict: 'update', recordId: 'gone', diff: [change('count', 1)] }),
        ],
      },
      writer,
    )
    expect(result.results).toEqual([
      { row: 0, outcome: 'failed', recordId: 'r1', reason: 'refusedValue', message: 'Kind must be one of: Residential, Commercial' },
      { row: 1, outcome: 'failed', recordId: 'gone', reason: 'matchedRecordMissing' },
    ])
    expect((store.get(`${DS}/records/r1`) as Record<string, any>).values.kind).toBe('Commercial')
  })

  it('add the values the person chose to an options field before writing them', async () => {
    const context = ctx()
    await hooks.fields(context)
    await hooks.addPicklistValues?.(context, 'options:kind', [{ id: 'industrial', label: 'Industrial', active: true }])
    const model = (store.get(DS) as Record<string, any>).model
    expect(model.fields.kind.validation.options).toEqual(['Residential', 'Commercial', 'Industrial'])
    const result = await hooks.apply(
      context,
      { jobId: 'job-1', index: 0, start: 0, end: 1, rows: [planned({ index: 0, verdict: 'update', recordId: 'r1', diff: [change('kind', 'Industrial')] })] },
      writer,
    )
    expect(result.results[0].outcome).toBe('updated')
  })
})

describe('undo', () => {
  const importOne = async () => {
    await hooks.apply(
      ctx(),
      {
        jobId: 'job-1',
        index: 0,
        start: 0,
        end: 2,
        rows: [
          planned({ index: 0, verdict: 'create', diff: [change('title', 'New')] }),
          planned({ index: 1, verdict: 'update', recordId: 'r1', diff: [change('count', 9, 1)] }),
        ],
      },
      writer,
    )
    return [...ledger.values()].map((entry) => entry.undo as TransferUndoEntry)
  }

  it('deletes what it created and restores what it changed', async () => {
    const entries = await importOne()
    const created = transferRecordId('job-1', 0)
    const reverted = await hooks.revert(ctx(), { jobId: 'job-1', chunk: 0, entries })
    expect(reverted.conflicts).toEqual([])
    expect(reverted.done.map((step) => step.action).sort()).toEqual(['delete', 'restore'])
    expect(store.has(`${DS}/records/${created}`)).toBe(false)
    const r1 = store.get(`${DS}/records/r1`) as Record<string, any>
    expect(r1.values.count).toBe(1)
    expect(r1.filterValues.count).toBe(1)
  })

  it('leaves a record edited since unless the person says revert', async () => {
    const entries = await importOne()
    const r1 = store.get(`${DS}/records/r1`) as Record<string, any>
    store.set(`${DS}/records/r1`, { ...r1, values: { ...r1.values, count: 12 } })
    const kept = await hooks.revert(ctx(), { jobId: 'job-1', chunk: 0, entries: entries.filter((entry) => entry.recordId === 'r1') })
    expect(kept.conflicts).toHaveLength(1)
    expect((store.get(`${DS}/records/r1`) as Record<string, any>).values.count).toBe(12)
    const forced = await hooks.revert(ctx(), { jobId: 'job-1', chunk: 0, entries: entries.filter((entry) => entry.recordId === 'r1') }, { r1: 'revert' })
    expect(forced.done).toHaveLength(1)
    expect((store.get(`${DS}/records/r1`) as Record<string, any>).values.count).toBe(1)
  })

  it('keeps every reference whole: strips a set-null holder, and keeps a record a restrict holder points at', async () => {
    const entries = await importOne()
    const created = transferRecordId('job-1', 0)
    const jobsModel = (onDelete: 'setNull' | 'restrict') => ({
      order: ['service'],
      fields: { service: { name: 'Service', type: 'reference', reference: { datasetId: 'ds', onDelete } } },
    })
    store.set(JOBS, { displayName: 'Jobs', model: jobsModel('restrict'), visibleTo: ['org'] })
    store.set(`${JOBS}/records/j1`, { values: { service: created }, referencedIds: [created] })
    const createdEntry = entries.filter((entry) => entry.action === 'created')

    const held = await hooks.revert(ctx(), { jobId: 'job-1', chunk: 0, entries: createdEntry })
    expect(held.conflicts).toHaveLength(1)
    expect(store.has(`${DS}/records/${created}`)).toBe(true)

    store.set(JOBS, { ...store.get(JOBS), model: jobsModel('setNull') })
    const stripped = await hooks.revert(ctx(), { jobId: 'job-1', chunk: 0, entries: createdEntry })
    expect(stripped.done).toEqual([{ action: 'delete', recordId: created }])
    expect(store.has(`${DS}/records/${created}`)).toBe(false)
    const holder = store.get(`${JOBS}/records/j1`) as Record<string, any>
    expect(holder.values).toEqual({})
    expect(holder).not.toHaveProperty('referencedIds')
  })
})

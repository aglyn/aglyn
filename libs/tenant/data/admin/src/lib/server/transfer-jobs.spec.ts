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

import type { ResolvedTransferResourceDeclaration } from '@aglyn/aglyn/plugin-manager/plugin-transfer-resources'

const mockDeclared: ResolvedTransferResourceDeclaration[] = [
  {
    pluginId: 'cellar',
    key: 'bottles',
    label: 'Bottles',
    scope: 'org',
    kinds: ['records'],
    formats: ['csv', 'json', 'ndjson'],
    limits: { maxRows: 1000 },
  },
]

jest.mock('@aglyn/aglyn/plugin-manager/first-party-plugins.generated', () => {
  const actual = jest.requireActual('@aglyn/aglyn/plugin-manager/first-party-plugins.generated')
  return {
    __esModule: true,
    ...actual,
    get PLUGIN_TRANSFER_RESOURCES_DECLARED() {
      return mockDeclared
    },
  }
})

import {
  TRANSFER_UNDO_WINDOW_MS,
  buildMatchLookup,
  planTransferUndo,
  type PlannedTransferRow,
  type TransferJobRecord,
  type TransferRowResult,
  type TransferUndoEntry,
  type TransferUndoStep,
} from '@aglyn/aglyn/data-transfer'
import {
  registerPluginTransferResource,
  resetTransferResourcesForTests,
  type PluginTransferResource,
} from '@aglyn/aglyn/plugin-manager/plugin-transfer-resources'
import {
  analyzeTransferJob,
  applyTransferJob,
  applyTransferJobUndo,
  planTransferJob,
  planTransferJobUndo,
  readTransferJobStatus,
  readTransferPlanRows,
  readTransferResourceInfo,
  sweepAbandonedTransferJobs,
  transferResultFile,
  uploadTransferSource,
  TransferEngineError,
  type TransferBucket,
  type TransferEngineDeps,
} from './transfer-jobs'

/**
 * The transfer job engine (AGL-3524) against an in-memory Firestore and
 * bucket, with a test-only `bottles` resource registered through the real
 * extension point. What matters most: the dry run writes nothing, a retried
 * chunk never writes a row twice, Apply waits for every acknowledgement and
 * for any other running import of the same records, undo asks about a record
 * edited since, and the sweep finishes what a closed tab left.
 */

/*==========================================
 * An in-memory Firestore: documents by path, the operators the engine issues
 *=========================================*/

type Data = Record<string, unknown>

const docs = new Map<string, Data>()

function copy<T>(value: T): T {
  return value === undefined ? value : (JSON.parse(JSON.stringify(value)) as T)
}

function compare(a: unknown, b: unknown): number {
  if (a === b) return 0
  return (a as number) < (b as number) ? -1 : 1
}

class Snapshot {
  constructor(readonly ref: DocRef) {}
  get id() {
    return this.ref.id
  }
  get exists() {
    return docs.has(this.ref.path)
  }
  data() {
    return copy(docs.get(this.ref.path))
  }
}

let autoId = 0

class DocRef {
  constructor(readonly path: string) {}
  get id() {
    return this.path.slice(this.path.lastIndexOf('/') + 1)
  }
  get parent(): CollectionRef {
    return new CollectionRef(this.path.slice(0, this.path.lastIndexOf('/')))
  }
  collection(name: string) {
    return new CollectionRef(`${this.path}/${name}`)
  }
  async get() {
    return new Snapshot(this)
  }
  async set(data: Data) {
    docs.set(this.path, copy(data))
  }
  async create(data: Data) {
    if (docs.has(this.path)) throw Object.assign(new Error('6 ALREADY_EXISTS'), { code: 6 })
    docs.set(this.path, copy(data))
  }
  async delete() {
    docs.delete(this.path)
  }
}

type Filter = { field: string; op: string; value: unknown }

class Query {
  constructor(
    readonly match: (path: string) => boolean,
    readonly filters: Filter[] = [],
    readonly order: { field: string; dir: string } | null = null,
    readonly max: number | null = null,
  ) {}
  where(field: string, op: string, value: unknown) {
    if (!['==', '<=', '<'].includes(op)) throw new Error(`unmodelled operator ${op}`)
    return new Query(this.match, [...this.filters, { field, op, value }], this.order, this.max)
  }
  orderBy(field: string, dir = 'asc') {
    return new Query(this.match, this.filters, { field, dir }, this.max)
  }
  limit(max: number) {
    return new Query(this.match, this.filters, this.order, max)
  }
  async get() {
    let found = [...docs.entries()].filter(([path, data]) =>
      this.match(path) &&
      this.filters.every(({ field, op, value }) => {
        const stored = data[field]
        if (op === '==') return stored === value
        if (op === '<=') return stored !== undefined && compare(stored, value) <= 0
        return stored !== undefined && compare(stored, value) < 0
      }),
    )
    if (this.order) {
      const { field, dir } = this.order
      found.sort(([, a], [, b]) => compare(a[field], b[field]) * (dir === 'desc' ? -1 : 1))
    }
    if (this.max !== null) found = found.slice(0, this.max)
    const snapshots = found.map(([path]) => new Snapshot(new DocRef(path)))
    return { docs: snapshots, empty: !snapshots.length, size: snapshots.length }
  }
}

class CollectionRef extends Query {
  constructor(readonly path: string) {
    super((candidate) => candidate.startsWith(`${path}/`) && !candidate.slice(path.length + 1).includes('/'))
  }
  get id() {
    return this.path.slice(this.path.lastIndexOf('/') + 1)
  }
  get parent(): DocRef | null {
    const at = this.path.lastIndexOf('/')
    return at < 0 ? null : new DocRef(this.path.slice(0, at))
  }
  doc(id?: string) {
    autoId += 1
    return new DocRef(`${this.path}/${id ?? `auto${autoId}`}`)
  }
}

const firestore = {
  collection: (name: string) => new CollectionRef(name),
  collectionGroup: (name: string) =>
    new Query((path) => {
      const parts = path.split('/')
      return parts.length >= 2 && parts[parts.length - 2] === name
    }),
  batch() {
    const ops: Array<() => void> = []
    return {
      set: (ref: DocRef, data: Data) => ops.push(() => docs.set(ref.path, copy(data))),
      delete: (ref: DocRef) => ops.push(() => docs.delete(ref.path)),
      commit: async () => ops.forEach((op) => op()),
    }
  },
  async runTransaction<T>(fn: (transaction: unknown) => Promise<T>): Promise<T> {
    return fn({
      get: (target: DocRef | Query) => target.get(),
      set: (ref: DocRef, data: Data) => docs.set(ref.path, copy(data)),
    })
  },
}

const files = new Map<string, Buffer>()
const bucket: TransferBucket = {
  file: (path) => ({
    save: async (data) => {
      files.set(path, Buffer.from(data))
    },
    download: async () => {
      const data = files.get(path)
      if (!data) throw new Error(`no object ${path}`)
      return [data]
    },
    delete: async () => {
      files.delete(path)
    },
  }),
}

/*==========================================
 * The test-only `bottles` resource: records in a map, written by `apply`
 *=========================================*/

interface Bottle {
  id: string
  values: Record<string, unknown>
}

const bottles = new Map<string, Bottle>()
let writes = 0
let nextBottle = 0
const added: Array<{ picklistId: string; ids: string[] }> = []
const clock = { now: 1_800_000_000_000 }
const behavior: {
  /** Throw after this many rows of the next `apply` call. */
  crashAfter: number | null
  /** Milliseconds each `apply` call moves the clock. */
  costMs: number
} = { crashAfter: null, costMs: 0 }

const MATCH_KEYS = [
  { fieldId: 'id', normalizer: 'aglynId' as const },
  { fieldId: 'email', normalizer: 'email' as const },
]

const RESOURCE: PluginTransferResource = {
  fields: () => ({
    standard: [
      { id: 'name', label: 'Name', type: 'text', required: true },
      { id: 'email', label: 'Email', type: 'email', matchKey: true },
      { id: 'color', label: 'Color', type: 'picklist', picklistId: 'color' },
      { id: 'tags', label: 'Tags', type: 'tags' },
    ],
  }),
  matchKeys: MATCH_KEYS,
  readPage: async () => ({ rows: [], next: null }),
  lookup: async (_ctx, requests) => {
    const all = [...bottles.values()]
    const lookup = buildMatchLookup(all, requests)
    const records = new Map<string, Record<string, unknown>>()
    for (const ids of lookup.values()) {
      for (const id of ids) records.set(id, { ...bottles.get(id)?.values, id })
    }
    return { lookup, records }
  },
  picklists: async () => ({
    color: {
      spec: {
        restricted: true,
        standardValues: [
          { id: 'red', label: 'Red' },
          { id: 'white', label: 'White' },
        ],
      },
      set: {
        values: [
          { id: 'red', label: 'Red', active: true },
          { id: 'white', label: 'White', active: true },
        ],
        defaultValueId: null,
      },
    },
  }),
  addPicklistValues: async (_ctx, picklistId, values) => {
    added.push({ picklistId, ids: values.map((value) => value.id) })
  },
  apply: async (_ctx, chunk, writer) => {
    clock.now += behavior.costMs
    const results: TransferRowResult[] = []
    const undo: TransferUndoEntry[] = []
    let handled = 0
    for (const row of chunk.rows as PlannedTransferRow[]) {
      const before = await writer.alreadyApplied(row.index)
      if (before) {
        results.push(before)
        continue
      }
      if (behavior.crashAfter !== null && handled >= behavior.crashAfter) {
        behavior.crashAfter = null
        throw new Error('the store went away')
      }
      handled += 1
      const after = Object.fromEntries(row.diff.map((change) => [change.fieldId, change.after]))
      let result: TransferRowResult
      let entry: TransferUndoEntry
      if (row.verdict === 'create') {
        nextBottle += 1
        const id = `b${nextBottle}`
        bottles.set(id, { id, values: after })
        result = { row: row.index, outcome: 'created', recordId: id }
        entry = { row: row.index, recordId: id, action: 'created', written: after }
      } else {
        const bottle = bottles.get(row.recordId as string) as Bottle
        const previous = Object.fromEntries(row.diff.map((change) => [change.fieldId, bottle.values[change.fieldId] ?? null]))
        bottle.values = { ...bottle.values, ...after }
        result = { row: row.index, outcome: 'updated', recordId: bottle.id }
        entry = { row: row.index, recordId: bottle.id, action: 'updated', previous, written: after }
      }
      writes += 1
      await writer.markApplied(result, entry)
      results.push(result)
      undo.push(entry)
    }
    return { results, undo }
  },
  revert: async (_ctx, snapshot, decisions) => {
    const done: TransferUndoStep[] = []
    const conflicts: TransferUndoStep[] = []
    for (const entry of snapshot.entries) {
      const bottle = bottles.get(entry.recordId)
      const step = planTransferUndo(entry, bottle ? bottle.values : null)
      if (step.action === 'conflict' && decisions?.[entry.recordId] !== 'revert') {
        if (decisions?.[entry.recordId] === 'keep') done.push({ action: 'nothing', recordId: entry.recordId, why: 'alreadyReverted' })
        else conflicts.push(step)
        continue
      }
      if (step.action === 'delete' || (step.action === 'conflict' && entry.action === 'created')) bottles.delete(entry.recordId)
      else if (step.action === 'restore' || step.action === 'conflict') {
        const target = bottle as Bottle
        target.values = { ...target.values, ...step.values }
      }
      done.push(step)
    }
    return { done, conflicts }
  },
}

const deps: TransferEngineDeps = {
  firestore: firestore as unknown as FirebaseFirestore.Firestore,
  bucket,
  now: () => clock.now,
}

const ORG = 'org-1'
const ME = 'uid-me'

function csv(rows: number, start = 0, extra: (index: number) => string = () => 'Red'): string {
  const lines = ['Name,Email,Color']
  for (let index = start; index < start + rows; index += 1) {
    lines.push(`Bottle ${index},bottle${index}@cellar.test,${extra(index)}`)
  }
  return lines.join('\n')
}

async function uploaded(content: string, fileName = 'bottles.csv'): Promise<TransferJobRecord> {
  const { job } = await uploadTransferSource(deps, { orgId: ORG, actorUid: ME, resource: 'bottles', fileName, content })
  return job
}

async function planned(content: string, policy: Record<string, unknown> = {}): Promise<TransferJobRecord> {
  const job = await uploaded(content)
  const analysis = await analyzeTransferJob(deps, { orgId: ORG, jobId: job.id, actorUid: ME })
  const result = await planTransferJob(deps, {
    orgId: ORG,
    jobId: job.id,
    actorUid: ME,
    choices: { mapping: analysis.match.mapping, policy },
  })
  return result.job
}

async function refusal(promise: Promise<unknown>): Promise<TransferEngineError> {
  try {
    await promise
  } catch (error) {
    if (error instanceof TransferEngineError) return error
    throw error
  }
  throw new Error('expected a refusal')
}

const applyAll = (jobId: string, acknowledged = [] as never[]) =>
  applyTransferJob(deps, { orgId: ORG, jobId, actorUid: ME, acknowledged, deadlineMs: clock.now + 600_000, driver: `d${clock.now}` })

const ledgerOf = (jobId: string) =>
  [...docs.keys()].filter((path) => path.startsWith(`orgs/${ORG}/transferJobs/${jobId}/ledger/`))

beforeEach(() => {
  docs.clear()
  files.clear()
  bottles.clear()
  added.length = 0
  writes = 0
  nextBottle = 0
  clock.now = 1_800_000_000_000
  behavior.crashAfter = null
  behavior.costMs = 0
  resetTransferResourcesForTests()
  registerPluginTransferResource('bottles', RESOURCE, { pluginId: 'cellar' })
})

describe('upload and analyze', () => {
  it('stores the file, counts its rows and proposes a mapping with picklist values', async () => {
    const job = await uploaded(csv(3, 0, (index) => (index === 2 ? 'Rosé' : 'Red')))
    expect(job.status).toBe('draft')
    expect(job.rowCount).toBe(3)
    expect(files.get(`orgs/${ORG}/transfers/${job.id}/source`)).toBeDefined()

    const analysis = await analyzeTransferJob(deps, { orgId: ORG, jobId: job.id, actorUid: ME })
    expect(analysis.job.status).toBe('analyzed')
    expect(analysis.match.mapping).toEqual({ 0: 'name', 1: 'email', 2: 'color' })
    expect(analysis.samples[0]).toEqual(['Bottle 0', 'bottle0@cellar.test', 'Red'])
    const color = analysis.picklists.find((entry) => entry.fieldId === 'color')
    expect(color?.matched.map((value) => value.label)).toEqual(['Red'])
    expect(color?.unmatched.map((value) => value.value)).toEqual(['Rosé'])
    // A restricted list proposes leaving an unknown value blank, never adding it.
    expect(Object.values(color?.proposals ?? {})).toEqual([{ action: 'leaveBlank' }])
  })

  it('takes a file in parts and stores it once the last part lands', async () => {
    const content = csv(10)
    const half = Math.floor(content.length / 2)
    const first = await uploadTransferSource(deps, {
      orgId: ORG, actorUid: ME, resource: 'bottles', fileName: 'bottles.csv', content: content.slice(0, half), part: 0, parts: 2,
    })
    expect(first.complete).toBe(false)
    const second = await uploadTransferSource(deps, {
      orgId: ORG, actorUid: ME, resource: 'bottles', fileName: 'bottles.csv', content: content.slice(half), part: 1, parts: 2, jobId: first.job.id,
    })
    expect(second.complete).toBe(true)
    expect(second.job.rowCount).toBe(10)
    expect([...files.keys()].filter((path) => path.includes('/parts/'))).toEqual([])
  })

  it('refuses an executable named as a CSV before storing a byte, and a format the resource does not take', async () => {
    const refused = await refusal(
      uploadTransferSource(deps, { orgId: ORG, actorUid: ME, resource: 'bottles', fileName: 'x.csv', content: 'MZ\u0090\u0000rest' }),
    )
    expect(refused.code).toBe('rejectedFile')
    expect(files.size).toBe(0)
    const unknown = await refusal(
      uploadTransferSource(deps, { orgId: ORG, actorUid: ME, resource: 'casks', fileName: 'x.csv', content: 'a\n1' }),
    )
    expect(unknown.status).toBe(404)
  })

  it('refuses a file past the resource’s row limit', async () => {
    const refused = await refusal(uploaded(csv(1001)))
    expect(refused.code).toBe('tooLarge')
  })
})

describe('plan — the dry run', () => {
  it('plans every row, stores it in chunks of 200, and writes no record', async () => {
    bottles.set('b-old', { id: 'b-old', values: { name: 'Old', email: 'bottle1@cellar.test' } })
    const job = await planned(csv(450))
    expect(job.status).toBe('planned')
    expect(job.summary).toMatchObject({ create: 449, update: 1, total: 450 })
    expect(job.chunkCount).toBe(3)
    expect(writes).toBe(0)
    expect(bottles.size).toBe(1)
    expect([...docs.keys()].filter((path) => path.includes(`${job.id}/chunks/`))).toHaveLength(3)

    const page = await readTransferPlanRows(deps, { orgId: ORG, jobId: job.id, offset: 0, limit: 10, verdicts: ['update'] })
    expect(page.rows.map((row) => row.recordId)).toEqual(['b-old'])
    expect(page.next).toBeNull()
    const second = await readTransferPlanRows(deps, { orgId: ORG, jobId: job.id, offset: 195, limit: 10 })
    expect(second.rows.map((row) => row.index)).toEqual([195, 196, 197, 198, 199, 200, 201, 202, 203, 204])
    expect(second.next).toBe(205)
  })

  it('needs a choice for every picklist value the list does not hold, and adds the ones chosen', async () => {
    const job = await uploaded(csv(2, 0, (index) => (index ? 'Rosé' : 'Red')))
    const analysis = await analyzeTransferJob(deps, { orgId: ORG, jobId: job.id, actorUid: ME })
    const missing = await refusal(
      planTransferJob(deps, { orgId: ORG, jobId: job.id, actorUid: ME, choices: { mapping: analysis.match.mapping } }),
    )
    expect(missing.code).toBe('choicesNeeded')
    const key = analysis.picklists[0]?.unmatched[0]?.key as string
    const plan = await planTransferJob(deps, {
      orgId: ORG,
      jobId: job.id,
      actorUid: ME,
      choices: { mapping: analysis.match.mapping, picklistChoices: { color: { [key]: { action: 'addValue' } } } },
    })
    expect(plan.picklistAdditions['color']?.map((value) => value.label)).toEqual(['Rosé'])
    expect(plan.acknowledgementsRequired).toContain('newPicklistValue')
    await applyAll(job.id, ['newPicklistValue'] as never[])
    expect(added).toEqual([{ picklistId: 'color', ids: plan.picklistAdditions['color']?.map((value) => value.id) }])
  })
})

describe('apply', () => {
  it('waits for every required acknowledgement', async () => {
    bottles.set('b-old', { id: 'b-old', values: { name: 'Old', email: 'bottle0@cellar.test' } })
    const job = await planned(csv(3), { fieldDefault: { mode: 'overwrite', blank: 'leave' } })
    expect(job.acknowledgementsRequired).toEqual(['overwriteNonBlank'])
    const refused = await refusal(applyAll(job.id))
    expect(refused.code).toBe('acknowledgementsMissing')
    expect(refused.details).toEqual({ missing: ['overwriteNonBlank'] })
    expect(writes).toBe(0)
    const applied = await applyAll(job.id, ['overwriteNonBlank'] as never[])
    expect(applied.done).toBe(true)
    expect(bottles.get('b-old')?.values['name']).toBe('Bottle 0')
  })

  it('writes chunk by chunk within the budget and resumes at the cursor', async () => {
    const job = await planned(csv(450))
    behavior.costMs = 3_000
    const first = await applyTransferJob(deps, {
      orgId: ORG, jobId: job.id, actorUid: ME, deadlineMs: clock.now + 5_000, driver: 'tab-1',
    })
    expect(first.started).toBe(true)
    expect(first.done).toBe(false)
    expect(first.progress).toMatchObject({ status: 'applying', chunk: 1, rowsDone: 200 })
    expect(first.job.lease).toBeNull()
    expect(writes).toBe(200)

    const rest = await applyTransferJob(deps, {
      orgId: ORG, jobId: job.id, actorUid: ME, deadlineMs: clock.now + 600_000, driver: 'tab-2',
    })
    expect(rest.started).toBe(false)
    expect(rest.done).toBe(true)
    expect(rest.job.status).toBe('applied')
    expect(rest.job.results).toMatchObject({ created: 450, total: 450 })
    expect(writes).toBe(450)
    expect(bottles.size).toBe(450)
    expect(ledgerOf(job.id)).toEqual([])
  })

  it('never writes a row twice when a chunk is retried after a failure', async () => {
    const job = await planned(csv(250))
    behavior.crashAfter = 120
    const failed = await applyAll(job.id)
    expect(failed.job.status).toBe('failed')
    expect(failed.job.error).toMatchObject({ code: 'applyFailed', chunk: 0 })
    expect(writes).toBe(120)
    // The rows that landed are in the ledger; the chunk did not commit.
    expect(ledgerOf(job.id)).toHaveLength(120)

    const resumed = await applyAll(job.id)
    expect(resumed.started).toBe(true)
    expect(resumed.resumed).toBe(true)
    expect(resumed.job.status).toBe('applied')
    expect(writes).toBe(250)
    expect(bottles.size).toBe(250)
    expect(resumed.job.results).toMatchObject({ created: 250, total: 250 })
  })

  it('runs one import of a resource at a time, and one driver per import', async () => {
    const first = await planned(csv(450))
    behavior.costMs = 3_000
    await applyTransferJob(deps, { orgId: ORG, jobId: first.id, actorUid: ME, deadlineMs: clock.now + 5_000, driver: 'a' })
    behavior.costMs = 0
    const second = await planned(csv(5, 1000))
    const busy = await refusal(applyAll(second.id))
    expect(busy.code).toBe('busy')
    expect(busy.details).toEqual({ jobId: first.id })

    // A live lease held by another driver refuses a second one.
    const ref = `orgs/${ORG}/transferJobs/${first.id}`
    docs.set(ref, { ...(docs.get(ref) as Data), lease: { owner: 'other-tab', expiresAt: clock.now + 60_000 } })
    const held = await refusal(applyAll(first.id))
    expect(held.code).toBe('busy')
  })

  it('answers a result file with each row’s outcome and record', async () => {
    const job = await planned(csv(2))
    await applyAll(job.id)
    const file = await transferResultFile(deps, { orgId: ORG, jobId: job.id })
    expect(file.fileName).toBe('bottles-results.csv')
    expect(file.csv.split('\r\n').slice(0, 3)).toEqual([
      'Name,Email,Color,Outcome,Reason,Record ID',
      'Bottle 0,bottle0@cellar.test,Red,created,,b1',
      'Bottle 1,bottle1@cellar.test,Red,created,,b2',
    ])
  })
})

describe('undo', () => {
  it('lists a record edited since as a conflict, writes nothing, then reverts with the person’s decisions', async () => {
    bottles.set('b-old', { id: 'b-old', values: { name: 'Old', email: 'bottle0@cellar.test' } })
    const job = await planned(csv(3), { fieldDefault: { mode: 'overwrite', blank: 'leave' } })
    await applyAll(job.id, ['overwriteNonBlank'] as never[])
    // b1 and b2 were created; b-old was updated. Someone then edits b2.
    ;(bottles.get('b2') as Bottle).values['name'] = 'Edited later'

    const plan = await planTransferJobUndo(deps, { orgId: ORG, jobId: job.id, actorUid: ME })
    expect(plan.counts).toEqual({ restore: 1, delete: 1, conflict: 1, nothing: 0 })
    expect(plan.conflicts).toEqual([
      {
        row: 2,
        recordId: 'b2',
        label: 'Edited later',
        action: 'created',
        fields: ['name'],
        current: { name: 'Edited later' },
        restore: {},
      },
    ])
    expect(bottles.size).toBe(3)

    const undone = await applyTransferJobUndo(deps, {
      orgId: ORG, jobId: job.id, actorUid: ME, decisions: { b2: 'keep' }, otherwise: 'revert', deadlineMs: clock.now + 60_000, driver: 'u',
    })
    expect(undone.done).toBe(true)
    expect(undone.job.status).toBe('undone')
    expect([...bottles.keys()].sort()).toEqual(['b-old', 'b2'])
    expect(bottles.get('b-old')?.values['name']).toBe('Old')
    expect((await readTransferJobStatus(deps, { orgId: ORG, jobId: job.id })).undo.available).toBe(false)
  })

  it('closes seven days after the import', async () => {
    const job = await planned(csv(1))
    await applyAll(job.id)
    clock.now += TRANSFER_UNDO_WINDOW_MS + 1
    const refused = await refusal(planTransferJobUndo(deps, { orgId: ORG, jobId: job.id, actorUid: ME }))
    expect(refused.code).toBe('undoExpired')
  })
})

describe('what the wizard reads (AGL-3539)', () => {
  it('lists the resource’s fields, groups, keys and locked rules', async () => {
    const info = await readTransferResourceInfo(deps, { orgId: ORG, actorUid: ME, resource: 'bottles' })
    expect(info.resource).toMatchObject({ key: 'bottles', label: 'Bottles', scope: 'org' })
    expect(info.fields.map((field) => field.id)).toEqual(expect.arrayContaining(['name', 'email', 'color', 'tags', 'id']))
    expect(info.defaultMatchKeys).toEqual(['id', 'email'])
    expect(info.presetHints).toEqual({ matchKeyFieldIds: ['id', 'email'] })
    expect(info.canCreateCustomField).toBe(false)
  })

  it('reads a CSV with the delimiter and header row the person confirmed', async () => {
    const job = await uploadTransferSource(deps, {
      orgId: ORG,
      actorUid: ME,
      resource: 'bottles',
      fileName: 'bottles.csv',
      content: 'Red one|red@cellar.test\nWhite one|white@cellar.test',
      delimiter: '|',
      headerRow: false,
    })
    expect(job.job.read).toEqual({ delimiter: '|', headerRow: false })
    expect(job.job.headers).toEqual(['Column 1', 'Column 2'])
    expect(job.job.rowCount).toBe(2)
    const analysis = await analyzeTransferJob(deps, { orgId: ORG, jobId: job.job.id, actorUid: ME })
    expect(analysis.samples[0]).toEqual(['Red one', 'red@cellar.test'])
  })

  it('reads the file under a mapping: each field’s derivations and the rows against existing records', async () => {
    bottles.set('b-old', { id: 'b-old', values: { name: 'Old', email: 'bottle1@cellar.test' } })
    const job = await uploaded('Name,Email,Color\nA,  BOTTLE0@cellar.test ,Red\nB,bottle1@cellar.test,Red')
    const analysis = await analyzeTransferJob(deps, {
      orgId: ORG,
      jobId: job.id,
      actorUid: ME,
      mapping: { 0: 'name', 1: 'email', 2: 'color' },
      matchKeys: ['email'],
    })
    const email = analysis.derivations?.find((summary) => summary.fieldId === 'email')
    expect(email).toMatchObject({ filled: 2 })
    expect(email?.derivations.length).toBeGreaterThan(0)
    expect(analysis.matches?.summary).toEqual({ new: 1, matched: 1, ambiguous: 0, duplicateInFile: 0 })
    expect(analysis.matches?.keys.map((key) => key.fieldId)).toEqual(['email'])
    expect(analysis.matches?.rows.find((row) => row.row === 1)).toMatchObject({ outcome: { kind: 'matched', recordId: 'b-old' }, label: 'B' })
    expect(analysis.recordLabels).toEqual({ 'b-old': 'Old' })
    // Without a mapping, the answer is the proposal alone.
    const bare = await analyzeTransferJob(deps, { orgId: ORG, jobId: job.id, actorUid: ME })
    expect(bare.derivations).toBeUndefined()
    expect(bare.matches).toBeUndefined()
  })

  it('answers the dry run with each verdict’s rows, the conflicts and the record names', async () => {
    bottles.set('b-old', { id: 'b-old', values: { name: 'Old', email: 'bottle0@cellar.test' } })
    const job = await uploaded(csv(3))
    const analysis = await analyzeTransferJob(deps, { orgId: ORG, jobId: job.id, actorUid: ME })
    const result = await planTransferJob(deps, {
      orgId: ORG,
      jobId: job.id,
      actorUid: ME,
      choices: { mapping: analysis.match.mapping, extras: { consent: true } },
    })
    expect(result.sample.map((row) => row.verdict)).toEqual(['update', 'create', 'create'])
    expect(result.conflicts).toEqual([
      {
        row: 0,
        recordId: 'b-old',
        fields: [expect.objectContaining({ fieldId: 'name', before: 'Old', incoming: 'Bottle 0', after: 'Old', mode: 'fillBlanks' })],
      },
    ])
    expect(result.conflictCount).toBe(1)
    expect(result.ambiguous).toEqual([])
    expect(result.recordLabels).toEqual({ 'b-old': 'Old' })
    expect(result.job.extras).toEqual({ consent: true })
  })

  it('answers each apply call with the results it wrote, and status with every row’s result', async () => {
    const job = await planned(csv(3))
    const applied = await applyAll(job.id)
    expect(applied.results.map((result) => result.outcome)).toEqual(['created', 'created', 'created'])
    const status = await readTransferJobStatus(deps, { orgId: ORG, jobId: job.id, include: 'results' })
    expect(status.rows?.map((result) => result.row)).toEqual([0, 1, 2])
    expect((await readTransferJobStatus(deps, { orgId: ORG, jobId: job.id })).rows).toBeUndefined()
  })
})

describe('the sweep', () => {
  it('resumes an import a closed tab left applying, and leaves a fresh one to its driver', async () => {
    const job = await planned(csv(450))
    behavior.costMs = 3_000
    await applyTransferJob(deps, { orgId: ORG, jobId: job.id, actorUid: ME, deadlineMs: clock.now + 5_000, driver: 'tab' })
    behavior.costMs = 0

    const fresh = await sweepAbandonedTransferJobs(deps, { deadlineMs: clock.now + 60_000 })
    expect(fresh.found).toBe(0)

    clock.now += 5 * 60 * 1000
    const dry = await sweepAbandonedTransferJobs(deps, { deadlineMs: clock.now + 60_000, dryRun: true })
    expect(dry.found).toBe(1)
    expect(writes).toBe(200)

    const swept = await sweepAbandonedTransferJobs(deps, { deadlineMs: clock.now + 60_000 })
    expect(swept.resumed).toEqual([{ orgId: ORG, jobId: job.id, status: 'applied', done: true }])
    expect(writes).toBe(450)
    expect(bottles.size).toBe(450)
  })
})

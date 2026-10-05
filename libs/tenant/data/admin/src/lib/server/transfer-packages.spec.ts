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
  { pluginId: 'cellar', key: 'cellar.labels', label: 'Labels', singularLabel: 'Label', scope: 'org', kinds: ['package'], formats: ['json'] },
  { pluginId: 'cellar', key: 'cellar.racks', label: 'Racks', singularLabel: 'Rack', scope: 'org', kinds: ['package'], formats: ['json'] },
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
  existingPackageItemsOf,
  remapPackageReference,
  type TransferPackage,
  type TransferRowResult,
} from '@aglyn/aglyn/data-transfer'
import {
  registerPluginTransferResource,
  resetTransferResourcesForTests,
  type PluginTransferResource,
} from '@aglyn/aglyn/plugin-manager/plugin-transfer-resources'
import {
  listTransferJobs,
  readTransferJobStatus,
  sweepAbandonedTransferJobs,
  transferResultFile,
  TransferEngineError,
  type TransferBucket,
  type TransferEngineDeps,
} from './transfer-jobs'
import {
  applyTransferPackage,
  applyTransferPackageUndo,
  exportTransferPackage,
  listTransferPackageItems,
  planTransferPackageImport,
  planTransferPackageUndo,
} from './transfer-packages'

/**
 * Workspace packages (AGL-3535) against the in-memory Firestore and bucket
 * the row engine's spec uses, with two test-only package resources: labels,
 * and racks that name a label, a cork (a kind no package owns) and a site.
 * What matters most: the dry run writes nothing and never assumes a
 * replace; references are rewritten for a kept-both copy; a retried apply
 * never writes an item twice; undo restores and deletes, and asks before
 * overwriting a later edit.
 */

/*==========================================
 * An in-memory Firestore (as `transfer-jobs.spec.ts`)
 *=========================================*/

type Data = Record<string, unknown>

const docs = new Map<string, Data>()

function copy<T>(value: T): T {
  return value === undefined ? value : (JSON.parse(JSON.stringify(value)) as T)
}

/** A field by its dotted path, as Firestore reads `undo.status`. */
function at(data: Data, path: string): unknown {
  return path.split('.').reduce<unknown>((value, key) => (value as Data | undefined)?.[key], data)
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
        const stored = at(data, field)
        if (op === '==') return stored === value
        if (op === '<=') return stored !== undefined && compare(stored, value) <= 0
        return stored !== undefined && compare(stored, value) < 0
      }),
    )
    if (this.order) {
      const { field, dir } = this.order
      found.sort(([, a], [, b]) => compare(at(a, field), at(b, field)) * (dir === 'desc' ? -1 : 1))
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
 * Two package resources over maps
 *=========================================*/

interface Label {
  name: string
  text: string
}

interface Rack {
  name: string
  labelId: string | null
  corkId: string | null
  hostId: string | null
  active: boolean
}

const labels = new Map<string, Label>()
const racks = new Map<string, Rack>()
const corks = new Set<string>(['cork-1'])
const clock = { now: 1_800_000_000_000 }
let writes = 0
let crashAfter: number | null = null

function writtenBy<T>(store: Map<string, T>, project: (content: T, rename?: { name?: string }) => T): NonNullable<PluginTransferResource['writeItems']> {
  return async (_ctx, items, writer) => {
    const results: TransferRowResult[] = []
    for (const item of items) {
      const before = await writer.alreadyApplied(item.row)
      if (before) {
        results.push(before)
        continue
      }
      if (crashAfter !== null && writes >= crashAfter) {
        crashAfter = null
        throw new Error('the store went away')
      }
      writes += 1
      const existed = store.has(item.targetId)
      store.set(item.targetId, project(item.content as T, item.rename))
      const result: TransferRowResult = { row: item.row, outcome: existed ? 'updated' : 'created', recordId: item.targetId }
      await writer.markApplied(result)
      results.push(result)
    }
    return { results, undo: [] }
  }
}

function revertedIn<T>(store: Map<string, T>): NonNullable<PluginTransferResource['revertItems']> {
  return async (_ctx, steps) => {
    for (const step of steps) {
      if (step.action === 'delete') store.delete(step.id)
      else store.set(step.id, step.content as T)
    }
    return { done: steps.map((step) => step.id), refused: [] }
  }
}

const LABELS: PluginTransferResource = {
  items: async () => existingPackageItemsOf('cellar.labels', [...labels].map(([id, content]) => ({ id, name: content.name, content }))),
  dependencies: () => [],
  remapIds: (item) => item,
  readItems: async (_ctx, ids) =>
    ids.flatMap((id) => {
      const content = labels.get(id)
      return content ? [{ kind: 'cellar.labels', id, name: content.name, content }] : []
    }),
  writeItems: writtenBy(labels, (content: Label, rename) => ({ ...content, name: rename?.name ?? content.name })),
  revertItems: revertedIn(labels),
  problems: async (_ctx, write) => ((write.content as Label).text ? [] : ['A label needs its text.']),
}

const RACKS: PluginTransferResource = {
  items: async () => existingPackageItemsOf('cellar.racks', [...racks].map(([id, content]) => ({ id, name: content.name, content }))),
  dependencies: (item) => {
    const rack = item as Rack
    return [
      ...(rack.labelId ? [{ kind: 'cellar.labels', id: rack.labelId }] : []),
      ...(rack.corkId ? [{ kind: 'cellar.corks', id: rack.corkId }] : []),
      ...(rack.hostId ? [{ kind: 'site', id: rack.hostId }] : []),
    ]
  },
  remapIds: (item, idMap) => {
    const rack = item as Rack
    return {
      ...rack,
      labelId: remapPackageReference(idMap, 'cellar.labels', rack.labelId),
      corkId: remapPackageReference(idMap, 'cellar.corks', rack.corkId),
      hostId: remapPackageReference(idMap, 'site', rack.hostId),
    }
  },
  readItems: async (_ctx, ids) =>
    ids.flatMap((id) => {
      const content = racks.get(id)
      return content ? [{ kind: 'cellar.racks', id, name: content.name, content }] : []
    }),
  // An imported rack is never switched on: the rule the sequences resource keeps.
  writeItems: writtenBy(racks, (content: Rack, rename) => ({ ...content, name: rename?.name ?? content.name, active: false })),
  revertItems: revertedIn(racks),
  referenceTargets: async (_ctx, kinds) =>
    kinds.includes('cellar.corks') ? [{ kind: 'cellar.corks', label: 'Cork', targets: [...corks].map((id) => ({ id })) }] : [],
  rules: [{ id: 'inactive', label: 'Imported racks are off', reason: 'A rack starts pouring only when someone switches it on.' }],
}

const deps: TransferEngineDeps = {
  firestore: firestore as unknown as FirebaseFirestore.Firestore,
  bucket,
  now: () => clock.now,
}

const ORG = 'org-1'
const ME = 'uid-me'
const ALLOWED = ['cellar.labels', 'cellar.racks']

const planImport = (input: Record<string, unknown>) =>
  planTransferPackageImport(deps, { orgId: ORG, actorUid: ME, allowed: ALLOWED, ...input })

const apply = (jobId: string, acknowledged: string[] = []) =>
  applyTransferPackage(deps, {
    orgId: ORG,
    jobId,
    actorUid: ME,
    acknowledged: acknowledged as never,
    deadlineMs: clock.now + 600_000,
    driver: `d${clock.now}`,
  })

async function refusal(promise: Promise<unknown>): Promise<TransferEngineError> {
  try {
    await promise
  } catch (error) {
    if (error instanceof TransferEngineError) return error
    throw error
  }
  throw new Error('expected a refusal')
}

/** A package made by exporting this workspace, then the workspace cleared to stand in for another one. */
async function exportedThenCleared(): Promise<TransferPackage> {
  const file = await exportTransferPackage(deps, { orgId: ORG, actorUid: ME, allowed: ALLOWED })
  labels.clear()
  racks.clear()
  return JSON.parse(JSON.stringify(file)) as TransferPackage
}

beforeEach(() => {
  docs.clear()
  files.clear()
  labels.clear()
  racks.clear()
  writes = 0
  crashAfter = null
  clock.now = 1_800_000_000_000
  resetTransferResourcesForTests()
  registerPluginTransferResource('cellar.labels', LABELS, { pluginId: 'cellar' })
  registerPluginTransferResource('cellar.racks', RACKS, { pluginId: 'cellar' })
  docs.set('hosts/host-1', { orgId: ORG, name: 'Acme' })
  labels.set('l1', { name: 'Reserve', text: 'Aged twelve years' })
  racks.set('r1', { name: 'North wall', labelId: 'l1', corkId: 'cork-1', hostId: 'host-1', active: true })
})

describe('listing and exporting', () => {
  it('lists every item with what it names, and the rules', async () => {
    const lists = await listTransferPackageItems(deps, { orgId: ORG, actorUid: ME, allowed: ALLOWED })
    expect(lists.map((list) => [list.key, list.items.map((item) => item.key)])).toEqual([
      ['cellar.labels', ['cellar.labels/l1']],
      ['cellar.racks', ['cellar.racks/r1']],
    ])
    expect(lists[1]?.items[0]?.deps).toContainEqual({ kind: 'cellar.labels', id: 'l1' })
    expect(lists[1]?.rules[0]?.id).toBe('inactive')
  })

  it('adds what the chosen items need when asked', async () => {
    const alone = await exportTransferPackage(deps, { orgId: ORG, actorUid: ME, allowed: ALLOWED, items: ['cellar.racks/r1'] })
    expect(alone.manifest.items.map((item) => item.kind)).toEqual(['cellar.racks'])
    const withDeps = await exportTransferPackage(deps, {
      orgId: ORG,
      actorUid: ME,
      allowed: ALLOWED,
      items: ['cellar.racks/r1'],
      dependencies: true,
    })
    expect(withDeps.manifest.items.map((item) => item.kind).sort()).toEqual(['cellar.labels', 'cellar.racks'])
    expect(withDeps.manifest.items.find((item) => item.kind === 'cellar.racks')?.deps).toContainEqual({ kind: 'site', id: 'host-1' })
  })
})

describe('planning', () => {
  it('writes nothing, stores the file and the plan, and creates new items', async () => {
    const file = await exportedThenCleared()
    const { job, plan } = await planImport({ package: file, fileName: 'cellar.json' })
    expect(job).toMatchObject({ kind: 'package', resource: 'package', status: 'planned', rowCount: 2 })
    expect(plan.items.map((item) => item.verdict)).toEqual(['create', 'create'])
    expect(plan.order).toEqual(['cellar.labels/l1', 'cellar.racks/r1'])
    expect(plan.references).toEqual([])
    expect(writes).toBe(0)
    expect(files.has(`orgs/${ORG}/transfers/${job.id}/source`)).toBe(true)
  })

  it('refuses a file changed after it was made', async () => {
    const file = await exportedThenCleared()
    ;(file.items['cellar.labels/l1'] as Label).text = 'Tampered'
    const refused = await refusal(planImport({ package: file }))
    expect(refused.code).toBe('rejectedFile')
  })

  it('asks about a site, a cork and a label the workspace lacks', async () => {
    const file = await exportedThenCleared()
    docs.delete('hosts/host-1')
    docs.set('hosts/host-2', { orgId: ORG, name: 'Other' })
    corks.delete('cork-1')
    const pkg: TransferPackage = {
      manifest: { ...file.manifest, items: file.manifest.items.filter((item) => item.kind === 'cellar.racks') },
      items: { 'cellar.racks/r1': file.items['cellar.racks/r1'] },
    }
    const { job, plan } = await planImport({ package: pkg })
    expect(plan.references.map((reference) => [reference.key, reference.label])).toEqual([
      ['cellar.labels/l1', 'Label'],
      ['cellar.corks/cork-1', 'Cork'],
      ['site/host-1', 'Site'],
    ])
    expect(plan.references[2]?.targets).toEqual([{ id: 'host-2', name: 'Other' }])
    expect((await refusal(apply(job.id))).code).toBe('choicesNeeded')

    corks.add('cork-1')
    const answered = await planImport({
      jobId: job.id,
      dependencyChoices: {
        'cellar.labels/l1': { action: 'dropReference' },
        'site/host-1': { action: 'mapTo', id: 'host-2' },
      },
    })
    expect(answered.plan.blocking).toEqual([])
    expect((await refusal(apply(job.id))).code).toBe('acknowledgementsMissing')
    const done = await apply(job.id, ['dropReference'])
    expect(done.done).toBe(true)
    expect(racks.get('r1')).toEqual({ name: 'North wall', labelId: null, corkId: 'cork-1', hostId: 'host-2', active: false })
  })

  it('fails an item its plugin refuses, before Apply', async () => {
    const file = await exportedThenCleared()
    ;(file.items['cellar.labels/l1'] as Label).text = ''
    file.manifest.items[0]!.contentHash = (await existingPackageItemsOf('x', [{ id: 'x', content: file.items['cellar.labels/l1'] }]))[0]!.contentHash
    const { plan } = await planImport({ package: file })
    expect(plan.items[0]).toMatchObject({ verdict: 'fail', problems: ['A label needs its text.'] })
    expect(plan.acknowledgementsRequired).toEqual(['failed'])
  })
})

describe('applying', () => {
  it('keeps both under a new id, points the rack at the copy, and lands the rack switched off', async () => {
    const file = await exportTransferPackage(deps, { orgId: ORG, actorUid: ME, allowed: ALLOWED })
    labels.set('l1', { name: 'Reserve', text: 'Edited here' })
    racks.clear()
    const { job, plan } = await planImport({ package: file, decisions: { 'cellar.labels/l1': 'keepBoth' } })
    const copy = plan.items[0]?.targetId as string
    expect(copy).not.toBe('l1')
    expect(plan.items[0]?.rename).toEqual({ name: 'Reserve (copy)' })
    const done = await apply(job.id)
    expect(done.done).toBe(true)
    expect(labels.get(copy)).toEqual({ name: 'Reserve (copy)', text: 'Aged twelve years' })
    expect(labels.get('l1')?.text).toBe('Edited here')
    expect(racks.get('r1')).toMatchObject({ labelId: copy, active: false })
    const status = await readTransferJobStatus(deps, { orgId: ORG, jobId: job.id })
    expect(status.job.results).toMatchObject({ created: 2, total: 2 })
    expect(status.undo.available).toBe(true)
  })

  it('never assumes a replace, and resumes a crashed apply without writing an item twice', async () => {
    const file = await exportTransferPackage(deps, { orgId: ORG, actorUid: ME, allowed: ALLOWED })
    labels.set('l1', { name: 'Reserve', text: 'Edited here' })
    racks.set('r1', { name: 'North wall', labelId: 'l1', corkId: null, hostId: 'host-1', active: true })
    const first = await planImport({ package: file })
    expect(first.plan.items.map((item) => [item.verdict, item.needsChoice])).toEqual([
      ['skip', true],
      ['skip', true],
    ])
    const { job } = await planImport({
      jobId: first.job.id,
      decisions: { 'cellar.labels/l1': 'replace', 'cellar.racks/r1': 'replace' },
    })
    crashAfter = 1
    const crashed = await apply(job.id, ['replace'])
    expect(crashed.job.status).toBe('failed')
    expect(writes).toBe(1)
    const resumed = await apply(job.id)
    expect(resumed.done).toBe(true)
    expect(writes).toBe(2)
    expect(labels.get('l1')?.text).toBe('Aged twelve years')
    const csv = await transferResultFile(deps, { orgId: ORG, jobId: job.id })
    expect(csv.csv.split('\r\n')[0]).toBe('Kind,Name,ID,Decision,Outcome,Reason,Record ID')
    expect(csv.rows).toBe(2)
  })

  it('lets the sweep finish what a closed tab left', async () => {
    const file = await exportedThenCleared()
    const { job } = await planImport({ package: file })
    crashAfter = 1
    await apply(job.id)
    // Failed jobs are resumed by the person; one left `applying` is the sweep's.
    const stored = docs.get(`orgs/${ORG}/transferJobs/${job.id}`) as Record<string, unknown>
    docs.set(`orgs/${ORG}/transferJobs/${job.id}`, { ...stored, status: 'applying', lease: null, error: null })
    clock.now += 10 * 60_000
    const sweep = await sweepAbandonedTransferJobs(deps, { deadlineMs: clock.now + 60_000 })
    expect(sweep.resumed).toEqual([{ orgId: ORG, jobId: job.id, status: 'applied', done: true }])
    expect(racks.has('r1')).toBe(true)
  })
})

describe('undo', () => {
  it('restores a replaced item, deletes a created one, and asks about one edited since', async () => {
    const file = await exportTransferPackage(deps, { orgId: ORG, actorUid: ME, allowed: ALLOWED })
    labels.set('l1', { name: 'Reserve', text: 'Before the import' })
    racks.clear()
    const { job } = await planImport({ package: file, decisions: { 'cellar.labels/l1': 'replace' } })
    await apply(job.id, ['replace'])
    expect(labels.get('l1')?.text).toBe('Aged twelve years')

    const untouched = await planTransferPackageUndo(deps, { orgId: ORG, jobId: job.id, actorUid: ME })
    expect(untouched.counts).toEqual({ restore: 1, delete: 1, conflict: 0, nothing: 0 })

    racks.set('r1', { ...(racks.get('r1') as Rack), name: 'Renamed since' })
    const edited = await planTransferPackageUndo(deps, { orgId: ORG, jobId: job.id, actorUid: ME })
    expect(edited.counts).toEqual({ restore: 1, delete: 0, conflict: 1, nothing: 0 })
    expect(edited.conflicts).toEqual([
      { row: 1, key: 'cellar.racks/r1', resource: 'cellar.racks', id: 'r1', name: 'North wall', action: 'created' },
    ])

    const undone = await applyTransferPackageUndo(deps, {
      orgId: ORG,
      jobId: job.id,
      actorUid: ME,
      otherwise: 'keep',
      deadlineMs: clock.now + 60_000,
      driver: 'undo',
    })
    expect(undone.done).toBe(true)
    expect(undone.job.status).toBe('undone')
    expect(undone.undo.counts).toEqual({ restore: 1, delete: 0, conflict: 1, nothing: 0 })
    expect(labels.get('l1')?.text).toBe('Before the import')
    expect(racks.get('r1')?.name).toBe('Renamed since')
  })
})

describe('the history', () => {
  it('lists package and row imports newest first, with who and whether undo is open', async () => {
    const file = await exportedThenCleared()
    const { job } = await planImport({ package: file })
    await apply(job.id)
    clock.now += 1000
    const second = await planImport({ package: file, decisions: {} })
    const page = await listTransferJobs(deps, {
      orgId: ORG,
      limit: 1,
      labels: {},
      emailsOf: async (uids) => new Map(uids.map((uid) => [uid, `${uid}@cellar.test`])),
    })
    expect(page.jobs.map((one) => [one.id, one.label, one.createdByEmail])).toEqual([[second.job.id, 'Package', 'uid-me@cellar.test']])
    expect(page.next).toBe(page.jobs[0]?.createdAt)
    const rest = await listTransferJobs(deps, { orgId: ORG, after: page.next })
    expect(rest.jobs.map((one) => [one.id, one.status, one.undo.available, one.resultFile])).toEqual([[job.id, 'applied', true, true]])
    expect(rest.next).toBeNull()
  })
})

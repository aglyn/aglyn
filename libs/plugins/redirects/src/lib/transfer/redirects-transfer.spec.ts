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

import {
  buildTransferFieldCatalog,
  createTransferPolicy,
  matchHeaders,
  matchLookupRequests,
  matchRows,
  transferFieldProblems,
  type PlannedTransferRow,
  type TransferPlan,
  type TransferPolicy,
  type TransferRowResult,
  type TransferUndoEntry,
} from '@aglyn/aglyn/data-transfer'
import {
  pluginTransferResourceProblems,
  resetTransferResourcesForTests,
  resolveTransferResource,
  type TransferApplyWriter,
  type TransferRecordsHooks,
  type TransferResourceContext,
} from '@aglyn/aglyn/plugin-manager/plugin-transfer-resources'
import { PLUGIN_TRANSFER_RESOURCES_DECLARED } from '@aglyn/aglyn/plugin-manager/first-party-plugins.generated'
import { FieldValue, Timestamp } from 'firebase-admin/firestore'
import { registerRedirectsConsoleServerDeclarations } from '../declarations.console-server'
import { createRedirectsTransferResource } from './redirects-transfer'
import {
  REDIRECTS_ALIAS_DICTIONARIES,
  REDIRECTS_MATCH_KEYS,
  canonicalRedirectKind,
  redirectsTransferCatalog,
} from './redirects-transfer-fields'

/**
 * The redirects transfer resource (AGL-3532) against an in-memory Firestore:
 * the catalog, the from-path read the way the page stores it, the dry run's
 * refusals and warnings (the page's own checks, the plan's counter, the
 * publishing role), writes that stamp an off-site destination with the
 * importer, a retry that never writes twice, undo, and the export's reads.
 */

/*==========================================
 * An in-memory Firestore: documents by path, the operators the resource issues
 *=========================================*/

type Data = Record<string, unknown>

const docs = new Map<string, Data>()

function isDelete(value: unknown): boolean {
  return value instanceof FieldValue && value.isEqual(FieldValue.delete())
}

function withoutDeletes(data: Data): Data {
  return Object.fromEntries(Object.entries(data).filter(([, value]) => !isDelete(value)))
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
    const data = docs.get(this.ref.path)
    return data ? { ...data } : undefined
  }
}

let autoId = 0

class DocRef {
  constructor(readonly path: string) {}
  get id() {
    return this.path.slice(this.path.lastIndexOf('/') + 1)
  }
  collection(name: string) {
    return new CollectionRef(`${this.path}/${name}`)
  }
  async get() {
    return new Snapshot(this)
  }
  async set(data: Data, options?: { merge?: boolean }) {
    const merged = options?.merge ? { ...(docs.get(this.path) ?? {}), ...data } : data
    docs.set(this.path, withoutDeletes(merged))
  }
  createNow(data: Data) {
    if (docs.has(this.path)) throw Object.assign(new Error('6 ALREADY_EXISTS'), { code: 6 })
    docs.set(this.path, withoutDeletes(data))
  }
  async create(data: Data) {
    this.createNow(data)
  }
  async delete() {
    docs.delete(this.path)
  }
}

type Filter = { field: string; op: string; value: unknown }

class Query {
  constructor(
    readonly path: string,
    readonly filters: Filter[] = [],
    readonly max: number | null = null,
    readonly after: string | null = null,
  ) {}
  where(field: string, op: string, value: unknown) {
    if (!['in', '!='].includes(op)) throw new Error(`unmodelled operator ${op}`)
    return new Query(this.path, [...this.filters, { field, op, value }], this.max, this.after)
  }
  orderBy(field: unknown) {
    // Only the document-id order is modelled: the resource asks for no other.
    if (typeof field === 'string') throw new Error(`unmodelled order ${field}`)
    return this
  }
  limit(max: number) {
    return new Query(this.path, this.filters, max, this.after)
  }
  startAfter(id: string) {
    return new Query(this.path, this.filters, this.max, id)
  }
  select() {
    return this
  }
  matching(): Array<[string, Data]> {
    let found = [...docs.entries()]
      .filter(([path]) => path.startsWith(`${this.path}/`) && !path.slice(this.path.length + 1).includes('/'))
      .filter(([, data]) =>
        this.filters.every(({ field, op, value }) =>
          op === 'in'
            ? (value as unknown[]).includes(data[field])
            : data[field] !== undefined && data[field] !== null && data[field] !== value,
        ),
      )
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    if (this.after !== null) found = found.filter(([path]) => path.slice(path.lastIndexOf('/') + 1) > (this.after as string))
    if (this.max !== null) found = found.slice(0, this.max)
    return found
  }
  async get() {
    const snapshots = this.matching().map(([path]) => new Snapshot(new DocRef(path)))
    return { docs: snapshots, empty: !snapshots.length, size: snapshots.length }
  }
  count() {
    return { get: async () => ({ data: () => ({ count: this.matching().length }) }) }
  }
}

class CollectionRef extends Query {
  constructor(path: string) {
    super(path)
  }
  doc(id?: string) {
    autoId += 1
    return new DocRef(`${this.path}/${id ?? `auto${autoId}`}`)
  }
}

const firestore = {
  collection: (name: string) => new CollectionRef(name),
  async getAll(...refs: DocRef[]) {
    return refs.map((ref) => new Snapshot(ref))
  },
  async runTransaction<T>(fn: (tx: unknown) => Promise<T>): Promise<T> {
    return fn({
      get: (target: { get(): Promise<unknown> }) => target.get(),
      create: (ref: DocRef, data: Data) => ref.createNow(data),
    })
  },
}

/*==========================================
 * The site
 *=========================================*/

const HOST = 'host-1'
const EDITOR = 'uid-editor'
const AUTHOR = 'uid-author'
const NOW = Date.parse('2026-10-05T12:00:00Z')
const RULES = `hosts/${HOST}/redirects`

let org: Record<string, unknown> = { plan: 'starter' }
const announced: Array<{ hostId: string; paths: readonly string[] }> = []
const logged: string[] = []

const resource = createRedirectsTransferResource({
  firestore: firestore as unknown as FirebaseFirestore.Firestore,
  now: () => NOW,
  loadOrg: async () => org as never,
  announcePaths: async (hostId, paths) => {
    announced.push({ hostId, paths })
  },
  logCreated: async (_hostId, _actor, ruleId) => {
    logged.push(ruleId)
  },
}) as TransferRecordsHooks

const catalog = buildTransferFieldCatalog(redirectsTransferCatalog())

function ctx(actorUid = EDITOR, jobId = 'job1'): TransferResourceContext {
  return { resource: 'redirects', orgId: 'org-1', hostId: HOST, actorUid, jobId }
}

function seed(): void {
  docs.set(`hosts/${HOST}`, {
    memberRoles: { [EDITOR]: 'editor', [AUTHOR]: 'author' },
    subdomain: 'acme',
    screens: { home: '/', about: 'about' },
  })
  docs.set(`${RULES}/r1`, {
    source: '/old-page',
    destination: '/new-page',
    statusCode: 301,
    kind: 'exact',
    priority: 100,
    enabled: true,
    createdAt: Timestamp.fromMillis(Date.parse('2026-01-01T00:00:00Z')),
    lastHitAt: Timestamp.fromMillis(Date.parse('2026-10-01T08:00:00Z')),
    createdBy: EDITOR,
  })
  docs.set(`${RULES}/r2`, { source: '/blog', destination: '/news', statusCode: 302, kind: 'prefix', enabled: true })
  docs.set(`${RULES}/r3`, {
    source: '/gone',
    destination: '/x',
    statusCode: 302,
    enabled: false,
    deletedAt: Timestamp.fromMillis(NOW - 1000),
  })
  // A v1 rule: no mode, priority or switch.
  docs.set(`${RULES}/r4`, { source: '/b', destination: '/c', statusCode: 302 })
}

beforeEach(() => {
  docs.clear()
  announced.length = 0
  logged.length = 0
  org = { plan: 'starter' }
  seed()
})

/** The job engine's dry run, in short: match through `lookup`, then the resource's plan. */
async function dryRun(
  values: Array<Record<string, unknown>>,
  options: { actor?: string; policy?: Partial<TransferPolicy> } = {},
): Promise<TransferPlan> {
  const context = ctx(options.actor)
  const found = await resource.lookup(context, matchLookupRequests(values, REDIRECTS_MATCH_KEYS))
  const matches = matchRows(values, REDIRECTS_MATCH_KEYS, found.lookup)
  return (resource.plan as NonNullable<TransferRecordsHooks['plan']>)(context, {
    fields: catalog.fields,
    rows: values.map((rowValues, index) => ({ index, values: rowValues })),
    matches,
    existing: found.records,
    policy: createTransferPolicy(options.policy),
  })
}

function rowOf(plan: TransferPlan, index: number): PlannedTransferRow {
  return plan.rows.find((row) => row.index === index) as PlannedTransferRow
}

function findingsOf(plan: TransferPlan): string[] {
  return plan.warnings.find((warning) => warning.class === 'resourceRule')?.samples.map((sample) => sample.detail ?? '') ?? []
}

const overwrite: Partial<TransferPolicy> = { fieldDefault: { mode: 'overwrite', blank: 'leave' } }

function memoryWriter(timeLeft = 60_000) {
  const ledger = new Map<number, { result: TransferRowResult; undo?: TransferUndoEntry }>()
  const writer: TransferApplyWriter = {
    alreadyApplied: async (row) => ledger.get(row)?.result ?? null,
    markApplied: async (result, undo) => {
      ledger.set(result.row, { result, ...(undo ? { undo } : {}) })
    },
    timeLeftMs: () => timeLeft,
  }
  return { ledger, writer }
}

async function applyPlan(plan: TransferPlan, writer = memoryWriter().writer, actor = EDITOR) {
  const rows = plan.rows.filter((row) => row.verdict === 'create' || row.verdict === 'update')
  return resource.apply(ctx(actor), { jobId: 'job1', index: 0, start: 0, end: plan.rows.length, rows }, writer)
}

const rule = (id: string) => docs.get(`${RULES}/${id}`) as Data

/*==========================================
 * The catalog
 *=========================================*/

describe('the catalog', () => {
  it('names the rule, its usage and its stamps, and nothing a file may write it cannot', () => {
    expect(transferFieldProblems(catalog.fields)).toEqual([])
    const byId = catalog.byId
    expect([...byId.keys()]).toEqual(
      expect.arrayContaining([
        'id',
        'source',
        'kind',
        'destination',
        'statusCode',
        'priority',
        'enabled',
        'hits30d',
        'externalDestinationApprovedBy',
        'createdAt',
        'updatedAt',
        'createdBy',
        'lastHitAt',
      ]),
    )
    expect(byId.get('source')).toMatchObject({ label: 'From path', required: true, matchKey: true })
    expect(byId.get('destination')).toMatchObject({ label: 'To', required: true })
    // The approver is provenance: exported, never read from a file.
    expect(byId.get('externalDestinationApprovedBy')).toMatchObject({ system: true, readOnly: true })
    expect(byId.get('hits30d')).toMatchObject({ derived: true })
    expect(byId.get('id')).toMatchObject({ system: true, matchKey: true })
  })

  it('maps other products’ exports by their own headers', () => {
    const shopify = matchHeaders(['Redirect from', 'Redirect to'], catalog.fields, {
      dictionaries: REDIRECTS_ALIAS_DICTIONARIES,
    })
    expect(shopify.mapping).toEqual({ 0: 'source', 1: 'destination' })
    const wordpress = matchHeaders(['source', 'target', 'code'], catalog.fields, {
      dictionaries: REDIRECTS_ALIAS_DICTIONARIES,
    })
    expect(wordpress.mapping).toEqual({ 0: 'source', 1: 'destination', 2: 'statusCode' })
    const wix = matchHeaders(['Old URL', 'New URL', 'Type'], catalog.fields, {
      dictionaries: REDIRECTS_ALIAS_DICTIONARIES,
    })
    expect(wix.mapping).toEqual({ 0: 'source', 1: 'destination', 2: 'statusCode' })
  })

  it('reads a Kind cell in the words people use', () => {
    expect(canonicalRedirectKind('Path prefix')).toBe('prefix')
    expect(canonicalRedirectKind(' Regular  Expression ')).toBe('regex')
    expect(canonicalRedirectKind('1')).toBe('regex')
    expect(canonicalRedirectKind('plain')).toBe('exact')
    expect(canonicalRedirectKind('wildcard')).toBeNull()
  })
})

/*==========================================
 * Matching
 *=========================================*/

describe('lookup and matching', () => {
  it('finds a rule by its from-path as the page stores it, never a deleted one', async () => {
    const found = await resource.lookup(ctx(), [
      { fieldId: 'source', normalizer: 'trim', values: ['/Old-Page/', '/gone', '/blog'] },
      { fieldId: 'id', normalizer: 'aglynId', values: ['r1', 'r3'] },
    ])
    expect(found.lookup.get('source\u0000/Old-Page/')).toEqual(['r1'])
    expect(found.lookup.get('source\u0000/gone')).toBeUndefined()
    expect(found.lookup.get('source\u0000/blog')).toEqual(['r2'])
    expect(found.lookup.get('id\u0000r1')).toEqual(['r1'])
    expect(found.lookup.get('id\u0000r3')).toBeUndefined()
    // The page's reading of a v1 rule: exact, priority 100, on.
    expect(found.records.get('r1')).toMatchObject({ source: '/old-page', statusCode: 301, enabled: true })
  })

  it('matches within the row’s mode, exact when the file gives none', async () => {
    const plan = await dryRun(
      [
        { source: '/Old-Page/', destination: '/newer' },
        { source: '/blog', destination: '/stories' },
        { source: '/blog', kind: 'Path prefix', destination: '/stories' },
      ],
      { policy: overwrite },
    )
    expect(rowOf(plan, 0)).toMatchObject({ verdict: 'update', recordId: 'r1' })
    expect(rowOf(plan, 0).diff).toEqual([expect.objectContaining({ fieldId: 'destination', before: '/new-page', after: '/newer' })])
    // An exact /blog stands beside the prefix rule, as the page allows.
    expect(rowOf(plan, 1)).toMatchObject({ verdict: 'create' })
    expect(rowOf(plan, 2)).toMatchObject({ verdict: 'update', recordId: 'r2' })
  })

  it('keeps an existing rule’s values unless the person chooses to overwrite them', async () => {
    const plan = await dryRun([{ source: '/old-page', destination: '/elsewhere', statusCode: 302 }])
    expect(rowOf(plan, 0)).toMatchObject({ verdict: 'unchanged', recordId: 'r1' })
  })

  it('refuses a later row that names a rule an earlier row already does', async () => {
    const plan = await dryRun([
      { source: '/dup', destination: '/one' },
      { source: '/DUP/', destination: '/two' },
    ])
    expect(rowOf(plan, 0).verdict).toBe('create')
    expect(rowOf(plan, 1)).toMatchObject({ verdict: 'fail', reason: 'resourceRule' })
    expect(findingsOf(plan)).toContain('Row 1 already redirects /dup')
  })
})

/*==========================================
 * The dry run
 *=========================================*/

describe('the dry run', () => {
  it('refuses what the page refuses about a rule on its own', async () => {
    const plan = await dryRun([
      { source: '/a', destination: 'http://example.com' },
      { source: '/same', destination: '/Same/' },
      { source: '/doc', destination: 'https://paypa1.com/login' },
      { source: '/c', destination: '/d', statusCode: 303 },
      { source: '/e', destination: '/f', kind: 'wildcard' },
    ])
    expect(plan.rows.map((row) => row.verdict)).toEqual(['fail', 'fail', 'fail', 'fail', 'fail'])
    expect(findingsOf(plan)).toEqual([
      'Destinations are internal paths or https:// URLs',
      'That would redirect the path to itself',
      "That destination's address looks like another company's website, so it can't be used",
      'Status codes are 301, 302, 307 or 308',
      'Unknown match mode',
    ])
    expect(plan.acknowledgementsRequired).toContain('resourceRule')
  })

  it('refuses a loop through the site’s rules and through earlier rows, as saving them in order would be', async () => {
    const plan = await dryRun([
      // r4 sends /b to /c.
      { source: '/c', destination: '/b' },
      { source: '/x', destination: '/y' },
      { source: '/y', destination: '/x' },
    ])
    expect(rowOf(plan, 0)).toMatchObject({ verdict: 'fail', reason: 'resourceRule' })
    expect(rowOf(plan, 1).verdict).toBe('create')
    expect(rowOf(plan, 2)).toMatchObject({ verdict: 'fail', reason: 'resourceRule' })
    expect(findingsOf(plan)).toContain('That destination chains back to this rule — a redirect loop')
  })

  it('refuses a rule that would collide with another the import leaves in place', async () => {
    const plan = await dryRun([{ id: 'r4', source: '/old-page' }], { policy: overwrite })
    expect(rowOf(plan, 0)).toMatchObject({ verdict: 'fail', reason: 'resourceRule' })
    expect(findingsOf(plan)).toContain('A rule for /old-page already exists')
  })

  it('warns about a chain, a loop it leads into, an off-site destination and a published page', async () => {
    docs.set(`${RULES}/p`, { source: '/p', destination: '/q', statusCode: 302, enabled: true })
    docs.set(`${RULES}/q`, { source: '/q', destination: '/p', statusCode: 302, enabled: true })
    const plan = await dryRun([
      { source: '/a', destination: '/b' },
      { source: '/z', destination: '/p' },
      { source: '/promo', destination: 'https://shop.example.net/sale' },
      { source: '/about', destination: '/about-us' },
    ])
    expect(plan.rows.map((row) => row.verdict)).toEqual(['create', 'create', 'create', 'create'])
    expect(findingsOf(plan)).toEqual([
      'Chains through another rule: /b → /c',
      'Leads into a redirect loop: /p → /q → /p',
      'Sends visitors to shop.example.net; importing approves it in your name',
      '/about is a published page — the redirect takes precedence',
    ])
    expect(plan.acknowledgementsRequired).toContain('resourceRule')
  })

  it('holds the creates past what the plan’s counter leaves, counting only the rows that would write', async () => {
    // Four documents (the soft-deleted one included, as the create route
    // counts it) of six: room for two.
    org = { plan: 'starter', entitlements: { redirectsPerHost: 6 } }
    const plan = await dryRun([
      { source: '/bad', destination: 'http://nope.example' },
      { source: '/one', destination: '/1' },
      { source: '/two', destination: '/2' },
      { source: '/three', destination: '/3' },
    ])
    expect(plan.rows.map((row) => [row.verdict, row.reason ?? null])).toEqual([
      ['fail', 'resourceRule'],
      ['create', null],
      ['create', null],
      ['fail', 'planLimit'],
    ])
    expect(plan.summary).toMatchObject({ create: 2, fail: 2 })
    expect(plan.acknowledgementsRequired).toEqual(expect.arrayContaining(['planLimit', 'resourceRule']))
  })

  it('refuses every row for a member without the publishing role, and for a plan without redirects', async () => {
    const author = await dryRun([{ source: '/one', destination: '/1' }], { actor: AUTHOR })
    expect(rowOf(author, 0)).toMatchObject({ verdict: 'fail', reason: 'resourceRule' })
    expect(findingsOf(author)).toEqual([
      'Importing redirects needs a publishing role on this site — ask an editor or admin',
    ])
    org = { plan: 'free' }
    const free = await dryRun([{ source: '/one', destination: '/1' }])
    expect(findingsOf(free)).toEqual(['URL redirects are not included in this workspace’s plan — see Billing'])
  })

  it('shows a new rule with the defaults it is created with', async () => {
    const plan = await dryRun([{ source: 'New-Path', destination: '/target/' }])
    const after = Object.fromEntries(rowOf(plan, 0).diff.map((change) => [change.fieldId, change.after]))
    expect(after).toEqual({
      source: '/new-path',
      destination: '/target',
      kind: 'exact',
      statusCode: 302,
      priority: 100,
      enabled: true,
    })
  })
})

/*==========================================
 * Apply and undo
 *=========================================*/

describe('apply', () => {
  it('creates through the create route’s terms: the allow-list, the stamps, the importer’s approval', async () => {
    const plan = await dryRun([
      { source: '/promo', destination: 'https://shop.example.net/sale', statusCode: 301 },
      { source: '/inside', destination: '/pricing' },
    ])
    const { results, undo } = await applyPlan(plan)
    expect(results.map((result) => [result.outcome, result.recordId])).toEqual([
      ['created', 'job1-0'],
      ['created', 'job1-1'],
    ])
    expect(rule('job1-0')).toEqual({
      source: '/promo',
      destination: 'https://shop.example.net/sale',
      statusCode: 301,
      kind: 'exact',
      priority: 100,
      enabled: true,
      externalDestinationApprovedBy: EDITOR,
      createdAt: Timestamp.fromMillis(NOW),
      updatedAt: Timestamp.fromMillis(NOW),
      createdBy: EDITOR,
    })
    expect(rule('job1-1')['externalDestinationApprovedBy']).toBeUndefined()
    expect(undo.map((entry) => entry.action)).toEqual(['created', 'created'])
    expect(logged).toEqual(['job1-0', 'job1-1'])
    expect(announced).toEqual([{ hostId: HOST, paths: ['/promo', '/inside'] }])
  })

  it('updates as the page edits: the stamp set for an off-site destination, removed for one on the site', async () => {
    docs.set(`${RULES}/ext`, {
      source: '/away',
      destination: 'https://old.example.net/',
      statusCode: 302,
      kind: 'exact',
      enabled: true,
      externalDestinationApprovedBy: 'uid-someone',
      lastHitAt: Timestamp.fromMillis(NOW - 5000),
    })
    const plan = await dryRun(
      [
        { source: '/old-page', destination: 'https://shop.example.net/new' },
        { source: '/away', destination: '/home' },
      ],
      { policy: overwrite },
    )
    const { results, undo } = await applyPlan(plan)
    expect(results.map((result) => result.outcome)).toEqual(['updated', 'updated'])
    expect(rule('r1')).toMatchObject({
      destination: 'https://shop.example.net/new',
      externalDestinationApprovedBy: EDITOR,
      updatedAt: Timestamp.fromMillis(NOW),
      // Written elsewhere, kept by the merge.
      lastHitAt: expect.anything(),
      createdBy: EDITOR,
    })
    expect(rule('ext')['externalDestinationApprovedBy']).toBeUndefined()
    expect(rule('ext')).toMatchObject({ destination: '/home', lastHitAt: Timestamp.fromMillis(NOW - 5000) })
    expect(undo[0]).toMatchObject({
      action: 'updated',
      previous: { destination: '/new-page', externalDestinationApprovedBy: null },
      written: { destination: 'https://shop.example.net/new', externalDestinationApprovedBy: EDITOR },
    })
    expect(undo[1]).toMatchObject({
      previous: { destination: 'https://old.example.net/', externalDestinationApprovedBy: 'uid-someone' },
      written: { destination: '/home', externalDestinationApprovedBy: null },
    })
    expect(announced[0]?.paths).toEqual(['/old-page', '/away'])
  })

  it('never writes a row twice: the ledger skips it, and a write that landed before its entry finds its own rule', async () => {
    const plan = await dryRun([{ source: '/once', destination: '/1' }])
    const { ledger, writer } = memoryWriter()
    await applyPlan(plan, writer)
    const again = await applyPlan(plan, writer)
    expect(again.results).toEqual([ledger.get(0)?.result])
    expect([...docs.keys()].filter((path) => path.startsWith(`${RULES}/job1-`))).toEqual([`${RULES}/job1-0`])

    // The write landed and the ledger never heard: the retry is the same rule.
    const lost = await applyPlan(plan, memoryWriter().writer)
    expect(lost.results).toEqual([{ row: 0, outcome: 'created', recordId: 'job1-0' }])
    expect([...docs.keys()].filter((path) => path.startsWith(`${RULES}/job1-`))).toHaveLength(1)
    expect(logged).toEqual(['job1-0'])
  })

  it('counts the plan’s slots again as it creates, and stops at a row boundary when time runs short', async () => {
    org = { plan: 'starter', entitlements: { redirectsPerHost: 5 } }
    const plan = await dryRun([
      { source: '/one', destination: '/1' },
      { source: '/two', destination: '/2' },
    ])
    expect(plan.summary.create).toBe(1)
    // A rule made elsewhere since the dry run takes the last slot.
    docs.set(`${RULES}/late`, { source: '/late', destination: '/l', statusCode: 302 })
    const { results } = await applyPlan(plan)
    expect(results).toEqual([
      expect.objectContaining({ row: 0, outcome: 'failed', message: 'Your plan includes 5 redirects — upgrade in Billing for more' }),
    ])

    const short = await applyPlan(plan, memoryWriter(500).writer)
    expect(short.results).toEqual([])
  })

  it('writes nothing for a member without the publishing role', async () => {
    const plan = await dryRun([{ source: '/one', destination: '/1' }])
    const { results } = await applyPlan(plan, memoryWriter().writer, AUTHOR)
    expect(results).toEqual([
      expect.objectContaining({
        outcome: 'failed',
        message: 'Importing redirects needs a publishing role on this site — ask an editor or admin',
      }),
    ])
    expect(docs.has(`${RULES}/job1-0`)).toBe(false)
  })
})

describe('undo', () => {
  async function applied(values: Array<Record<string, unknown>>) {
    const plan = await dryRun(values, { policy: overwrite })
    const { undo } = await applyPlan(plan)
    announced.length = 0
    return { jobId: 'job1', chunk: 0, entries: undo }
  }

  it('deletes a created rule and restores an updated one, the approval with it', async () => {
    const snapshot = await applied([
      { source: '/fresh', destination: '/1' },
      { source: '/old-page', destination: 'https://shop.example.net/' },
    ])
    expect(rule('r1')['externalDestinationApprovedBy']).toBe(EDITOR)
    const reverted = await resource.revert(ctx(), snapshot)
    expect(reverted.conflicts).toEqual([])
    expect(reverted.done.map((step) => step.action)).toEqual(['delete', 'restore'])
    expect(docs.has(`${RULES}/job1-0`)).toBe(false)
    expect(rule('r1')).toMatchObject({ destination: '/new-page' })
    expect(rule('r1')['externalDestinationApprovedBy']).toBeUndefined()
    expect(announced[0]?.paths).toEqual(['/fresh', '/old-page'])
  })

  it('asks about a rule edited since, and reverts it only when told to', async () => {
    const snapshot = await applied([
      { source: '/fresh', destination: '/1' },
      { source: '/old-page', destination: '/elsewhere' },
    ])
    docs.set(`${RULES}/job1-0`, { ...rule('job1-0'), destination: '/edited' })
    docs.set(`${RULES}/r1`, { ...rule('r1'), destination: '/edited-too' })
    const first = await resource.revert(ctx(), snapshot)
    expect(first.done).toEqual([])
    expect(first.conflicts.map((step) => step.recordId)).toEqual(['job1-0', 'r1'])

    const kept = await resource.revert(ctx(), snapshot, { 'job1-0': 'keep', r1: 'revert' })
    expect(kept.done.map((step) => step.action)).toEqual(['nothing', 'conflict'])
    expect(rule('job1-0')['destination']).toBe('/edited')
    expect(rule('r1')['destination']).toBe('/new-page')
  })

  it('needs the publishing role', async () => {
    const snapshot = await applied([{ source: '/fresh', destination: '/1' }])
    await expect(resource.revert(ctx(AUTHOR), snapshot)).rejects.toThrow('publishing role')
    expect(docs.has(`${RULES}/job1-0`)).toBe(true)
  })
})

/*==========================================
 * Export
 *=========================================*/

describe('export', () => {
  it('reads every live rule by id, holding only the chosen fields, times as ISO text and hits summed', async () => {
    docs.set(`hosts/${HOST}/analytics/2026-10-05`, { redirects: { r1: 2, r2: 1 } })
    docs.set(`hosts/${HOST}/analytics/2026-09-20`, { redirects: { r1: 3 } })
    // Past the thirty days the page sums.
    docs.set(`hosts/${HOST}/analytics/2026-08-01`, { redirects: { r1: 100 } })
    const page = await resource.readPage(ctx(), null, ['id', 'source', 'kind', 'priority', 'enabled', 'lastHitAt', 'hits30d'])
    expect(page).toEqual({
      rows: [
        { id: 'r1', source: '/old-page', kind: 'exact', priority: 100, enabled: true, lastHitAt: '2026-10-01T08:00:00.000Z', hits30d: 5 },
        { id: 'r2', source: '/blog', kind: 'prefix', priority: 100, enabled: true, lastHitAt: null, hits30d: 1 },
        { id: 'r4', source: '/b', kind: 'exact', priority: 100, enabled: true, lastHitAt: null, hits30d: 0 },
      ],
      next: null,
    })
    expect(await resource.count?.(ctx(), {})).toBe(3)
  })

  it('pages by document id, and reads a selection in its own order', async () => {
    const first = await resource.readPage(ctx(), null, ['id'], { pageSize: 2 })
    expect(first).toEqual({ rows: [{ id: 'r1' }, { id: 'r2' }], next: 'r2' })
    // The soft-deleted r3 is read past, not exported.
    const second = await resource.readPage(ctx(), first.next, ['id'], { pageSize: 2 })
    expect(second).toEqual({ rows: [{ id: 'r4' }], next: 'r4' })
    expect(await resource.readPage(ctx(), second.next, ['id'], { pageSize: 2 })).toEqual({ rows: [], next: null })

    const selected = await resource.readPage(ctx(), null, ['id', 'destination'], { ids: ['r4', 'r3', 'r1'], pageSize: 2 })
    expect(selected).toEqual({ rows: [{ id: 'r4', destination: '/c' }], next: '2' })
    const rest = await resource.readPage(ctx(), selected.next, ['id'], { ids: ['r4', 'r3', 'r1'], pageSize: 2 })
    expect(rest).toEqual({ rows: [{ id: 'r1' }], next: null })
    expect(await resource.count?.(ctx(), { ids: ['r4', 'r3', 'r1'] })).toBe(2)
  })

  it('reads a file it exported back in as unchanged', async () => {
    const fieldIds = ['id', 'source', 'kind', 'destination', 'statusCode', 'priority', 'enabled']
    const exported = await resource.readPage(ctx(), null, fieldIds)
    const plan = await dryRun(exported.rows, { policy: overwrite })
    expect(plan.summary).toMatchObject({ unchanged: 3, create: 0, update: 0, fail: 0 })
  })
})

/*==========================================
 * The extension point
 *=========================================*/

describe('registration', () => {
  it('registers against the declared resource with nothing missing', async () => {
    const declared = PLUGIN_TRANSFER_RESOURCES_DECLARED.find((entry) => entry.key === 'redirects')
    expect(declared).toMatchObject({ pluginId: 'redirects', scope: 'host', kinds: ['records'] })
    expect(pluginTransferResourceProblems(declared as NonNullable<typeof declared>, resource)).toEqual([])

    resetTransferResourcesForTests()
    registerRedirectsConsoleServerDeclarations()
    const resolved = await resolveTransferResource('redirects')
    expect(resolved.pluginId).toBe('redirects')
    expect(resolved.impl.matchKeys).toBe(REDIRECTS_MATCH_KEYS)
    expect(pluginTransferResourceProblems(resolved, resolved.impl)).toEqual([])
  })
})

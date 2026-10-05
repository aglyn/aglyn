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
  canApplyTransferPlan,
  createTransferPolicy,
  matchLookupRequests,
  matchRows,
  plannedWrites,
  TRANSFER_ID_FIELD,
  transferFieldProblems,
  type TransferPlan,
  type TransferPolicy,
  type TransferRowResult,
  type TransferUndoEntry,
} from '@aglyn/aglyn/data-transfer'
import {
  declaredTransferResource,
  pluginTransferResourceProblems,
  registerPluginTransferResource,
  resetTransferResourcesForTests,
  resolveTransferResource,
  type TransferApplyWriter,
  type TransferResourceContext,
} from '@aglyn/aglyn/plugin-manager/plugin-transfer-resources'
import { OUTREACH_DNC_MATCH_KEYS, OUTREACH_DO_NOT_CONTACT_TRANSFER_KEY } from '../constants/transfer-resources'
import { outreachDoNotContactKey } from '../engine/do-not-contact'
import { outreachDomainSearchTokens } from '../model/do-not-contact-domain-list-query'
import type { OutreachMembership } from '../engine/outreach-access'
import {
  createOutreachDoNotContactTransferResource,
  OUTREACH_DNC_ADD_ONLY_REASON,
  outreachDoNotContactTarget,
  type OutreachDoNotContactTransferResource,
} from './do-not-contact-transfer'

/**
 * The do-not-contact list as a file, against an in-memory Firestore that
 * answers the queries the export asks (equality, `in`, `array-contains`,
 * ranges, an order with the id breaking ties, `startAfter`, `limit`,
 * `count`) and whose `create` refuses an existing document the way
 * Firestore's does. Imports are planned the way the job engine plans them:
 * the core's `matchLookupRequests` and `matchRows` over this resource's
 * `lookup`, then its `plan`.
 */

type Data = Record<string, unknown>

function pathOf(value: unknown): string {
  return String(value)
}

function compare(a: unknown, b: unknown): number {
  if (a === b) return 0
  if (a === undefined || a === null) return -1
  if (b === undefined || b === null) return 1
  return (a as number | string) < (b as number | string) ? -1 : 1
}

function fakeFirestore(docs: Map<string, Data>) {
  const field = (id: string, data: Data, path: string) => (path === '__name__' ? id : data[path])
  const snapshot = (path: string) => {
    const data = docs.get(path)
    const id = path.slice(path.lastIndexOf('/') + 1)
    return {
      id,
      exists: data !== undefined,
      ref: doc(path),
      data: () => (data ? structuredClone(data) : undefined),
      get: (fieldPath: string) => (data ? field(id, data, fieldPath) : undefined),
    }
  }
  function doc(path: string): any {
    return {
      path,
      id: path.slice(path.lastIndexOf('/') + 1),
      collection: (name: string) => collection(`${path}/${name}`),
      get: async () => snapshot(path),
      create: async (data: Data) => {
        if (docs.has(path)) throw Object.assign(new Error('ALREADY_EXISTS'), { code: 6 })
        docs.set(path, structuredClone(data))
      },
      delete: async () => void docs.delete(path),
    }
  }
  interface Shape {
    filters: Array<{ path: string; op: string; value: unknown }>
    orders: Array<{ path: string; direction: 'asc' | 'desc' }>
    after: unknown[] | null
    limit: number | null
  }
  function query(base: string, shape: Shape): any {
    const run = () => {
      let rows = [...docs.keys()]
        .filter((key) => key.startsWith(`${base}/`) && !key.slice(base.length + 1).includes('/'))
        .map(snapshot)
      for (const filter of shape.filters) {
        rows = rows.filter((row) => {
          const value = field(row.id, docs.get(`${base}/${row.id}`) as Data, filter.path)
          switch (filter.op) {
            case '==':
              return value === filter.value
            case 'in':
              return (filter.value as unknown[]).includes(value)
            case 'array-contains':
              return Array.isArray(value) && value.includes(filter.value)
            case '<':
              return compare(value, filter.value) < 0
            case '<=':
              return compare(value, filter.value) <= 0
            case '>':
              return compare(value, filter.value) > 0
            case '>=':
              return compare(value, filter.value) >= 0
            default:
              throw new Error(`the fake does not answer ${filter.op}`)
          }
        })
      }
      const orders = shape.orders.some((order) => order.path === '__name__')
        ? shape.orders
        : [...shape.orders, { path: '__name__', direction: shape.orders.at(-1)?.direction ?? 'asc' }]
      const tuple = (row: ReturnType<typeof snapshot>) => orders.map((order) => row.get(order.path))
      const cmp = (a: unknown[], b: unknown[]) => {
        for (let at = 0; at < orders.length; at += 1) {
          const sign = orders[at].direction === 'desc' ? -1 : 1
          const result = compare(a[at], b[at]) * sign
          if (result) return result
        }
        return 0
      }
      rows.sort((a, b) => cmp(tuple(a), tuple(b)))
      if (shape.after) {
        const after = shape.after
        rows = rows.filter((row) => cmp(tuple(row).slice(0, after.length), after) > 0)
      }
      return shape.limit === null ? rows : rows.slice(0, shape.limit)
    }
    return {
      where: (path: unknown, op: string, value: unknown) =>
        query(base, { ...shape, filters: [...shape.filters, { path: pathOf(path), op, value }] }),
      orderBy: (path: unknown, direction: 'asc' | 'desc' = 'asc') =>
        query(base, { ...shape, orders: [...shape.orders, { path: pathOf(path), direction }] }),
      startAfter: (...values: unknown[]) => query(base, { ...shape, after: values }),
      limit: (limit: number) => query(base, { ...shape, limit }),
      get: async () => {
        const found = run()
        return { docs: found, size: found.length, empty: !found.length }
      },
      count: () => ({ get: async () => ({ data: () => ({ count: run().length }) }) }),
    }
  }
  function collection(path: string): any {
    return { ...query(path, { filters: [], orders: [], after: null, limit: null }), doc: (id: string) => doc(`${path}/${id}`) }
  }
  return {
    collection,
    getAll: async (...refs: Array<{ path: string }>) => refs.map((ref) => snapshot(ref.path)),
  } as unknown as FirebaseFirestore.Firestore
}

const ORG = 'org-dnc'
const ME = 'uid-me'
const AT = Date.UTC(2026, 9, 5, 15, 0)
const DOMAINS = `orgs/${ORG}/outreachDoNotContactDomains`
const ADDRESSES = `orgs/${ORG}/outreachDoNotContact`
const addressPath = (email: string) => `${ADDRESSES}/${outreachDoNotContactKey(email)}`
const addressId = (email: string) => `address:${outreachDoNotContactKey(email)}`

let docs: Map<string, Data>
let membership: OutreachMembership
let org: Data | null
let activity: Array<{ orgId: string; uid: string | null; action: string }>
let clock: number
let resource: OutreachDoNotContactTransferResource
const ctx: TransferResourceContext = {
  resource: OUTREACH_DO_NOT_CONTACT_TRANSFER_KEY,
  orgId: ORG,
  hostId: null,
  actorUid: ME,
  jobId: 'job-1',
}

function storedDomain(domain: string, overrides: Data = {}): void {
  const entry = {
    domain,
    reason: 'gateway_block',
    source: 'runtime',
    addedByUid: null,
    addedAtMs: AT - 86_400_000,
    enrollmentId: null,
    sequenceId: 'seq-1',
    detail: null,
    ...overrides,
  }
  docs.set(`${DOMAINS}/${domain}`, {
    ...entry,
    searchTokens: outreachDomainSearchTokens({ domain, detail: entry.detail as string | null }),
  })
}

function storedAddress(email: string, overrides: Data = {}): void {
  docs.set(addressPath(email), {
    key: outreachDoNotContactKey(email),
    reason: 'unsubscribe',
    source: 'runtime',
    addedByUid: null,
    addedAtMs: AT - 86_400_000,
    enrollmentId: 'enr-1',
    sequenceId: 'seq-1',
    detail: null,
    ...overrides,
  })
}

beforeEach(() => {
  docs = new Map()
  membership = { orgId: ORG, role: 'admin', orgWide: true, permissions: { 'outreach.use': true } }
  org = { plan: 'pro', entitlements: { features: { outreach: true } } }
  activity = []
  clock = AT
  resource = createOutreachDoNotContactTransferResource({
    firestore: fakeFirestore(docs),
    now: () => clock,
    resolveOrgPermissions: async () => membership,
    readOrg: async () => org,
    logOrgActivity: async (orgId, actor, action) => {
      activity.push({ orgId, uid: actor.uid, action })
    },
  })
})

/** The dry run, as the job engine makes it for a file of these rows. */
async function planned(cells: Data[], policy: Partial<TransferPolicy> = {}): Promise<TransferPlan> {
  const catalog = buildTransferFieldCatalog(await resource.fields(ctx))
  const lookup = await resource.lookup(ctx, matchLookupRequests(cells, OUTREACH_DNC_MATCH_KEYS))
  return resource.plan(ctx, {
    fields: catalog.fields,
    rows: cells.map((values, index) => ({ index, values })),
    matches: matchRows(cells, OUTREACH_DNC_MATCH_KEYS, lookup.lookup),
    existing: lookup.records,
    policy: createTransferPolicy({ locked: [...(await resource.lockedRules(ctx))], ...policy }),
  })
}

function memoryWriter(timeLeftMs = () => 60_000) {
  const ledger = new Map<number, { result: TransferRowResult; undo?: TransferUndoEntry }>()
  const writer: TransferApplyWriter = {
    alreadyApplied: async (row) => ledger.get(row)?.result ?? null,
    markApplied: async (result, undo) => {
      ledger.set(result.row, { result, undo })
    },
    timeLeftMs,
  }
  return { ledger, writer }
}

async function applied(plan: TransferPlan, writer = memoryWriter().writer) {
  const rows = plannedWrites(plan)
  return resource.apply(ctx, { jobId: 'job-1', index: 0, start: 0, end: plan.rows.length, rows }, writer)
}

const sentences = (plan: TransferPlan) =>
  plan.warnings.find((warning) => warning.class === 'resourceRule')?.samples.map((sample) => [sample.row, sample.detail]) ?? []

describe('the catalog and the registration', () => {
  it('lists the entry, its note and kind, and what the list records about it, honestly flagged', async () => {
    const catalog = buildTransferFieldCatalog(await resource.fields(ctx))
    expect(transferFieldProblems(catalog.fields)).toEqual([])
    const flags = Object.fromEntries(
      catalog.fields.map((field) => [
        field.id,
        [field.required && 'required', field.matchKey && 'matchKey', field.readOnly && 'readOnly', field.derived && 'derived', field.system && 'system']
          .filter(Boolean)
          .join(' '),
      ]),
    )
    expect(flags).toEqual({
      entry: 'required matchKey',
      note: '',
      kind: 'derived',
      id: 'matchKey readOnly system',
      reason: 'readOnly system',
      source: 'readOnly system',
      addedByUid: 'readOnly system',
      addedAt: 'readOnly system',
      sequenceId: 'readOnly system',
    })
    // The field description says why an address never comes back out.
    expect(catalog.byId.get('entry')?.description).toMatch(/fingerprint, so it is never exported/)
  })

  it('matches by the Aglyn ID, then the entry, and holds Note to the add-only rule', async () => {
    expect(OUTREACH_DNC_MATCH_KEYS.map((key) => key.fieldId)).toEqual([TRANSFER_ID_FIELD, 'entry'])
    expect(await resource.lockedRules(ctx)).toEqual([
      { fieldId: 'note', reason: OUTREACH_DNC_ADD_ONLY_REASON, forced: { mode: 'keepExisting', blank: 'leave' } },
    ])
  })

  it('registers against the declaration plugins.config.json compiles', () => {
    const declared = declaredTransferResource(OUTREACH_DO_NOT_CONTACT_TRANSFER_KEY)
    expect(declared).toMatchObject({ pluginId: 'outreach', scope: 'org', kinds: ['records'] })
    expect(declared?.exportOnly).toBeUndefined()
    expect(pluginTransferResourceProblems(declared as NonNullable<typeof declared>, resource)).toEqual([])
    resetTransferResourcesForTests()
    expect(() =>
      registerPluginTransferResource(OUTREACH_DO_NOT_CONTACT_TRANSFER_KEY, resource, { pluginId: 'outreach' }),
    ).not.toThrow()
    return expect(resolveTransferResource(OUTREACH_DO_NOT_CONTACT_TRANSFER_KEY)).resolves.toMatchObject({
      pluginId: 'outreach',
    })
  })
})

describe('what an entry cell names', () => {
  it('reads an address, a domain in any spelling, and refuses the rest', () => {
    expect(outreachDoNotContactTarget(' Casey.Morgan@Example.com ')).toMatchObject({ kind: 'address', email: 'casey.morgan@example.com' })
    expect(outreachDoNotContactTarget('Casey Morgan <casey@example.com>')).toMatchObject({ kind: 'address', email: 'casey@example.com' })
    expect(outreachDoNotContactTarget('mailto:casey@example.com')).toMatchObject({ kind: 'address' })
    expect(outreachDoNotContactTarget('https://www.Acme.com/about')).toEqual({ kind: 'domain', id: 'domain:acme.com', domain: 'acme.com' })
    expect(outreachDoNotContactTarget('@acme.com')).toMatchObject({ kind: 'domain', domain: 'acme.com' })
    // A mistyped address is refused, never read as its whole domain.
    expect(outreachDoNotContactTarget('casey morgan@acme.com')).toBeNull()
    expect(outreachDoNotContactTarget('not a thing')).toBeNull()
    expect(outreachDoNotContactTarget('')).toBeNull()
  })
})

describe('lookup', () => {
  it('resolves each value to the entry it names, filed under the value asked for', async () => {
    storedDomain('acme.com')
    storedAddress('casey@beta.io')
    const found = await resource.lookup(ctx, [
      { fieldId: 'entry', normalizer: 'caseless', values: ['www.acme.com', 'casey@beta.io', 'other.org', 'nonsense'] },
      { fieldId: 'id', normalizer: 'aglynId', values: ['domain:acme.com', addressId('casey@beta.io'), 'domain:gone.com', 'bogus'] },
    ])
    expect([...found.lookup.entries()]).toEqual([
      ['entry\u0000www.acme.com', ['domain:acme.com']],
      ['entry\u0000casey@beta.io', [addressId('casey@beta.io')]],
      ['id\u0000domain:acme.com', ['domain:acme.com']],
      ['id\u0000' + addressId('casey@beta.io'), [addressId('casey@beta.io')]],
    ])
    expect(found.records.get('domain:acme.com')).toMatchObject({
      entry: 'acme.com',
      kind: 'Domain',
      reason: 'Its mail gateway blocked the sender',
      source: 'Sequences, automatically',
    })
    // Asked for by its address, the address is shown; it is never stored.
    expect(found.records.get(addressId('casey@beta.io'))).toMatchObject({ entry: 'casey@beta.io', kind: 'Address', reason: 'Unsubscribed' })
  })

  it('tells a member who may not work Sequences nothing', async () => {
    storedDomain('acme.com')
    membership = { ...membership, permissions: {} }
    const found = await resource.lookup(ctx, [{ fieldId: 'entry', normalizer: 'caseless', values: ['acme.com'] }])
    expect(found.lookup.size).toBe(0)
    expect(found.records.size).toBe(0)
  })
})

describe('plan — add-only, with what each row means', () => {
  it('skips a row whose entry is on the list, whatever the policy and the row say', async () => {
    storedDomain('acme.com', { detail: 'Asked by legal' })
    const plan = await planned(
      [
        { entry: 'acme.com', note: 'A new note' },
        { id: 'domain:acme.com', note: 'Another note' },
        { entry: 'fresh.io' },
      ],
      { record: { onMatch: 'update', onNew: 'create', onAmbiguous: 'ask' }, rows: { 0: { action: 'update', recordId: 'domain:acme.com' } } },
    )
    expect(plan.rows.map((row) => [row.verdict, row.reason ?? null])).toEqual([
      ['skip', 'matchedSkipped'],
      ['skip', 'matchedSkipped'],
      ['create', null],
    ])
    expect(plan.summary).toMatchObject({ create: 1, update: 0, skip: 2 })
  })

  it('refuses a value that is neither an address nor a domain', async () => {
    const plan = await planned([{ entry: 'not a thing' }, { entry: 'casey morgan@acme.com' }, { entry: 'ok.example' }])
    expect(plan.rows.map((row) => [row.verdict, row.reason ?? null])).toEqual([
      ['fail', 'resourceRule'],
      ['fail', 'resourceRule'],
      ['create', null],
    ])
    expect(sentences(plan)).toEqual([
      [0, '"not a thing" is neither an email address nor a domain.'],
      [1, '"casey morgan@acme.com" is neither an email address nor a domain.'],
    ])
  })

  it('warns that a public mailbox domain blocks everyone at it, and that a covered address is covered already', async () => {
    storedDomain('listed.com')
    const plan = await planned([
      { entry: 'gmail.com' },
      { entry: 'kim@listed.com' },
      { entry: 'newco.io' },
      { entry: 'lee@newco.io' },
    ])
    expect(plan.rows.map((row) => row.verdict)).toEqual(['create', 'create', 'create', 'create'])
    expect(sentences(plan)).toEqual([
      [0, 'gmail.com is a public mailbox provider: adding it blocks every address at gmail.com, not one person.'],
      [1, 'Its domain, listed.com, is already on the list, which already covers this address.'],
      [3, 'Its domain, newco.io, is added by row 3 of this file, which already covers this address.'],
    ])
    expect(plan.acknowledgementsRequired).toContain('resourceRule')
    expect(canApplyTransferPlan(plan, ['resourceRule'])).toBe(true)
  })

  it('holds back a second spelling of one entry as a repeat of the first', async () => {
    const plan = await planned([{ entry: 'Acme.com' }, { entry: 'https://www.acme.com' }, { entry: 'X@Acme.com' }, { entry: 'x@acme.com ' }])
    expect(plan.rows.map((row) => [row.verdict, row.reason ?? null])).toEqual([
      ['create', null],
      ['skip', 'duplicateInFile'],
      ['create', null],
      ['skip', 'duplicateInFile'],
    ])
  })

  it('refuses every row, saying why, for a member the Compliance page would refuse', async () => {
    membership = { ...membership, orgWide: false }
    let plan = await planned([{ entry: 'a.com' }, { entry: 'b.com' }])
    expect(plan.rows.map((row) => row.verdict)).toEqual(['fail', 'fail'])
    expect(sentences(plan)[0]).toEqual([0, 'Sequences covers the whole organization, and your access is to particular sites.'])

    membership = { ...membership, orgWide: true }
    org = { plan: 'pro' }
    plan = await planned([{ entry: 'a.com' }])
    expect(plan.rows[0].verdict).toBe('fail')
    expect(sentences(plan)[0]).toEqual([0, "Sequences isn't available to this workspace yet."])
  })
})

describe('apply — through the list’s own adders', () => {
  it('adds domains and addresses as a member would, files one activity line, and keeps undo', async () => {
    const plan = await planned([
      { entry: 'Acme.com', note: '  Asked by their counsel  ' },
      { entry: 'Casey.Morgan@Beta.io' },
    ])
    const { results, undo } = await applied(plan)
    expect(results.map((result) => [result.outcome, result.recordId])).toEqual([
      ['created', 'domain:acme.com'],
      ['created', addressId('casey.morgan@beta.io')],
    ])
    expect(docs.get(`${DOMAINS}/acme.com`)).toMatchObject({
      domain: 'acme.com',
      reason: 'manual',
      source: 'member',
      addedByUid: ME,
      addedAtMs: AT,
      detail: 'Asked by their counsel',
      searchTokens: expect.arrayContaining(['acme']),
    })
    const address = docs.get(addressPath('casey.morgan@beta.io'))
    expect(address).toMatchObject({ reason: 'manual', source: 'member', addedByUid: ME, addedAtMs: AT, detail: null })
    expect(JSON.stringify(address).toLowerCase()).not.toContain('casey')
    expect(undo.map((entry) => [entry.recordId, entry.action])).toEqual([
      ['domain:acme.com', 'created'],
      [addressId('casey.morgan@beta.io'), 'created'],
    ])
    expect(activity).toEqual([
      { orgId: ORG, uid: ME, action: 'Imported 1 domain and 1 address to the Sequences do-not-contact list' },
    ])
  })

  it('writes a row once across a retried chunk', async () => {
    const plan = await planned([{ entry: 'a.com' }, { entry: 'b.com' }])
    const { ledger, writer } = memoryWriter()
    await applied(plan, writer)
    const again = await applied(plan, writer)
    expect(again.results.map((result) => result.outcome)).toEqual(['created', 'created'])
    expect(again.undo).toEqual([])
    expect(ledger.size).toBe(2)
    expect(activity).toHaveLength(1)
  })

  it('stops at a row boundary when the chunk’s time runs short', async () => {
    const plan = await planned([{ entry: 'a.com' }, { entry: 'b.com' }])
    let left = 60_000
    const { writer } = memoryWriter(() => left)
    const original = writer.markApplied
    writer.markApplied = async (result, undo) => {
      await original(result, undo)
      left = 0
    }
    const { results } = await applied(plan, writer)
    expect(results).toHaveLength(1)
    expect(docs.has(`${DOMAINS}/b.com`)).toBe(false)
  })

  it('leaves an entry added since the plan as it is, with nothing to undo', async () => {
    const plan = await planned([{ entry: 'late.com' }])
    storedDomain('late.com', { reason: 'gateway_block' })
    const { results, undo } = await applied(plan)
    expect(results[0]).toMatchObject({ outcome: 'unchanged', recordId: 'domain:late.com' })
    expect(undo).toEqual([])
    expect(docs.get(`${DOMAINS}/late.com`)?.['reason']).toBe('gateway_block')
    expect(activity).toEqual([])
  })

  it('asks again before writing, and writes nothing for a member who lost Use Sequences', async () => {
    const plan = await planned([{ entry: 'a.com' }])
    membership = { ...membership, permissions: { 'outreach.use': false } }
    const { results } = await applied(plan)
    expect(results[0]).toMatchObject({ outcome: 'failed', message: 'Your role does not include Use Sequences.' })
    expect(docs.size).toBe(0)
  })
})

describe('revert — only what the import added, and only while it is unchanged', () => {
  async function imported(cells: Data[]) {
    const plan = await planned(cells)
    const { undo } = await applied(plan)
    activity = []
    return { jobId: 'job-1', chunk: 0, entries: undo }
  }

  it('takes off every entry it added that nobody has touched since', async () => {
    storedDomain('kept.com')
    const snapshot = await imported([{ entry: 'kept.com' }, { entry: 'new.com' }, { entry: 'pat@new.org' }])
    const { done, conflicts } = await resource.revert(ctx, snapshot)
    expect(done).toEqual([
      { action: 'delete', recordId: 'domain:new.com' },
      { action: 'delete', recordId: addressId('pat@new.org') },
    ])
    expect(conflicts).toEqual([])
    expect(docs.has(`${DOMAINS}/kept.com`)).toBe(true)
    expect(docs.has(`${DOMAINS}/new.com`)).toBe(false)
    expect(docs.has(addressPath('pat@new.org'))).toBe(false)
    expect(activity).toEqual([
      { orgId: ORG, uid: ME, action: 'Undid an import: removed 1 domain and 1 address from the Sequences do-not-contact list' },
    ])
  })

  it('asks about an entry taken off and added again since, and never removes one Sequences added itself', async () => {
    const snapshot = await imported([{ entry: 'member.com' }, { entry: 'runtime.com' }, { entry: 'gone.com' }])
    storedDomain('member.com', { reason: 'manual', source: 'member', addedByUid: 'uid-other', addedAtMs: AT + 5_000 })
    storedDomain('runtime.com', { reason: 'gateway_block', source: 'runtime', addedAtMs: AT + 5_000 })
    docs.delete(`${DOMAINS}/gone.com`)

    const kept = await resource.revert(ctx, snapshot, { 'domain:member.com': 'keep', 'domain:runtime.com': 'keep' })
    expect(kept.conflicts.map((step) => [step.action, step.recordId])).toEqual([
      ['conflict', 'domain:member.com'],
      ['conflict', 'domain:runtime.com'],
    ])
    expect(kept.done).toEqual([{ action: 'nothing', recordId: 'domain:gone.com', why: 'gone' }])

    const reverted = await resource.revert(ctx, snapshot, { 'domain:member.com': 'revert', 'domain:runtime.com': 'revert' })
    expect(reverted.done).toContainEqual({ action: 'delete', recordId: 'domain:member.com' })
    expect(reverted.conflicts.map((step) => step.recordId)).toEqual(['domain:runtime.com'])
    expect(docs.has(`${DOMAINS}/member.com`)).toBe(false)
    expect(docs.has(`${DOMAINS}/runtime.com`)).toBe(true)
  })

  it('stops, saying why, for a member who may not work the list', async () => {
    const snapshot = await imported([{ entry: 'a.com' }])
    membership = { ...membership, role: null }
    await expect(resource.revert(ctx, snapshot)).rejects.toThrow('You are not a member of that organization.')
    expect(docs.has(`${DOMAINS}/a.com`)).toBe(true)
  })
})

describe('export — the domains, never an address', () => {
  beforeEach(() => {
    storedDomain('alpha.com', { reason: 'manual', source: 'member', addedByUid: 'uid-a', addedAtMs: Date.UTC(2026, 8, 1), detail: 'Barracuda' })
    storedDomain('bravo.com', { addedAtMs: Date.UTC(2026, 8, 20, 12) })
    storedDomain('charlie.com', { addedAtMs: Date.UTC(2026, 8, 25) })
    storedDomain('delta.com', { reason: 'manual', source: 'member', addedByUid: 'uid-a', addedAtMs: Date.UTC(2026, 9, 1) })
    storedDomain('echo.com', { addedAtMs: Date.UTC(2026, 9, 2) })
    storedAddress('someone@alpha.com')
  })

  async function everyPage(fieldIds: string[], options: Parameters<typeof resource.readPage>[3] = {}) {
    const rows: Data[] = []
    let cursor: string | null = null
    let pages = 0
    do {
      const page = await resource.readPage(ctx, cursor, fieldIds, { pageSize: 2, ...options })
      rows.push(...page.rows)
      cursor = page.next
      pages += 1
    } while (cursor && pages < 20)
    return { rows, pages }
  }

  it('reads every domain a page at a time, in id order, holding only the fields asked for', async () => {
    const { rows, pages } = await everyPage(['id', 'entry', 'kind', 'reason', 'addedAt'])
    expect(pages).toBe(3)
    expect(rows.map((row) => row['id'])).toEqual([
      'domain:alpha.com',
      'domain:bravo.com',
      'domain:charlie.com',
      'domain:delta.com',
      'domain:echo.com',
    ])
    expect(rows[0]).toEqual({
      id: 'domain:alpha.com',
      entry: 'alpha.com',
      kind: 'Domain',
      reason: 'Added by a member',
      addedAt: '2026-09-01T00:00:00.000Z',
    })
    expect(await resource.count(ctx, {})).toBe(5)
  })

  it('reads the selection by id, and nothing for an address it cannot read back', async () => {
    const ids = ['domain:echo.com', addressId('someone@alpha.com'), 'domain:alpha.com', 'domain:missing.com']
    const { rows } = await everyPage(['id'], { ids })
    expect(rows).toEqual([{ id: 'domain:alpha.com' }, { id: 'domain:echo.com' }])
    expect(await resource.count(ctx, { ids })).toBe(2)
  })

  it('reads the list’s search and filters as its Firestore query', async () => {
    const searched = await everyPage(['entry'], { filter: { search: ['barracuda'], clauses: [] } })
    expect(searched.rows).toEqual([{ entry: 'alpha.com' }])

    const why = { clauses: [{ field: 'reason', op: 'equals', value: 'manual' }] }
    expect((await everyPage(['entry'], { filter: why })).rows).toEqual([{ entry: 'alpha.com' }, { entry: 'delta.com' }])
    expect(await resource.count(ctx, { filter: why })).toBe(2)

    // A date orders newest first, the id breaking ties, across pages.
    const since = { clauses: [{ field: 'addedAtMs', op: 'onOrAfter', value: '2026-09-20' }] }
    expect((await everyPage(['entry'], { filter: since })).rows).toEqual([
      { entry: 'echo.com' },
      { entry: 'delta.com' },
      { entry: 'charlie.com' },
      { entry: 'bravo.com' },
    ])
  })

  it('reads nothing for a reader scoped to some sites, or one who may not work Sequences', async () => {
    expect(await resource.readPage(ctx, null, ['id'], { scopeTokens: ['host:h1'] })).toEqual({ rows: [], next: null })
    expect(await resource.count(ctx, { scopeTokens: ['host:h1'] })).toBe(0)
    org = null
    expect(await resource.readPage(ctx, null, ['id'])).toEqual({ rows: [], next: null })
  })
})

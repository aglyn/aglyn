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
 * @jest-environment node
 */

/**
 * IMPORTING AND EXPORTING A SITE'S SUPPRESSION LIST (AGL-3529): an import only
 * ever adds, an entry already on the list is never relabeled, and nothing
 * removes one. The key derivation is the REAL one — a double would let this
 * suite certify entries filed under a key no send path looks up.
 */

jest.mock('firebase-admin/firestore', () => ({
  __esModule: true,
  FieldValue: { serverTimestamp: () => '__serverTimestamp' },
  Timestamp: { fromMillis: (ms: number) => ({ toMillis: () => ms }) },
}))

jest.mock('@aglyn/tenant-data-admin/server/transfer-jobs', () => ({
  __esModule: true,
  TransferEngineError: class TransferEngineError extends Error {
    constructor(
      readonly code: string,
      readonly status: number,
      message: string,
    ) {
      super(message)
    }
  },
}))

jest.mock('@aglyn/aglyn/server', () => ({
  __esModule: true,
  registerPluginApiRoute: jest.fn(),
}))

let store: Record<string, Record<string, any>> = {}

const snapshotFor = (path: string) => ({
  id: path.slice(path.lastIndexOf('/') + 1),
  get exists() {
    return store[path] !== undefined
  },
  get: (field: string) => store[path]?.[field],
  data: () => store[path],
})

const docHandle = (path: string): any => ({
  id: path.slice(path.lastIndexOf('/') + 1),
  path,
  get: async () => snapshotFor(path),
  create: async (data: Record<string, any>) => {
    if (store[path]) throw Object.assign(new Error('6 ALREADY_EXISTS: Document already exists'), { code: 6 })
    store[path] = data
  },
})

const collectionHandle = (path: string): any => {
  const make = (filters: Array<[string, string, unknown]>, cap: number | null, after: string | null): any => {
    const all = () =>
      Object.keys(store)
        .filter((key) => key.startsWith(`${path}/`) && !key.slice(path.length + 1).includes('/'))
        .filter((key) =>
          filters.every(([field, op, value]) =>
            op === 'in'
              ? (value as unknown[]).includes(store[key]?.[field])
              : op === 'array-contains'
                ? (store[key]?.[field] ?? []).includes(value)
                : store[key]?.[field] === value,
          ),
        )
        .sort()
    return {
      firestore: firestoreHandle,
      doc: (id: string) => docHandle(`${path}/${id}`),
      where: (field: string, op: string, value: unknown) => make([...filters, [field, op, value]], cap, after),
      orderBy: () => make(filters, cap, after),
      limit: (value: number) => make(filters, value, after),
      startAfter: (id: string) => make(filters, cap, id),
      count: () => ({ get: async () => ({ data: () => ({ count: all().length }) }) }),
      get: async () => {
        const docs = all()
          .filter((key) => !after || key.slice(path.length + 1) > after)
          .slice(0, cap ?? Infinity)
          .map(snapshotFor)
        return { docs }
      },
    }
  }
  return make([], null, null)
}

const firestoreHandle: any = {
  collection: (name: string) => ({
    doc: (id: string) => ({ collection: (sub: string) => collectionHandle(`${name}/${id}/${sub}`) }),
  }),
  getAll: async (...refs: any[]) => refs.map((ref) => snapshotFor(ref.path)),
}

jest.mock('@aglyn/tenant-data-admin', () => ({
  __esModule: true,
  ...jest.requireActual('@aglyn/tenant-data-admin/server/email-suppression'),
  firebaseAdmin: { app: () => ({ firestore: () => firestoreHandle }) },
}))

import {
  buildTransferFieldCatalog,
  buildTransferPlan,
  createTransferPolicy,
  deriveTransferRow,
  matchLookupRequests,
  matchRows,
  type TransferRowResult,
} from '@aglyn/aglyn/data-transfer'
import type { TransferResourceContext } from '@aglyn/aglyn/plugin-manager/plugin-transfer-resources'
import { emailSuppressionKey } from '@aglyn/tenant-data-admin/server/email-suppression'
import {
  SUPPRESSION_LOCKED_RULES,
  SUPPRESSION_MATCH_KEYS,
  suppressionCatalog,
} from './email-transfer-catalog'
import { suppressionsTransferResource as hooks } from './suppressions.server'

const HOST_ID = 'site-1'
const PATH = `hosts/${HOST_ID}/suppressions`
const catalog = buildTransferFieldCatalog(suppressionCatalog())
const ctx: TransferResourceContext = {
  resource: 'email.suppressions',
  orgId: 'org-1',
  hostId: HOST_ID,
  actorUid: 'editor-uid',
  jobId: 'job-1',
}

/** A file planned and applied, the way the job engine runs one. */
async function importRows(rows: Array<Record<string, string>>, policy = {}) {
  const read = rows.map((cells, index) => ({ index, ...deriveTransferRow(catalog.byId, cells) }))
  const values = read.map((row) => row.values)
  const found = await hooks.lookup(ctx, matchLookupRequests(values, SUPPRESSION_MATCH_KEYS))
  const plan = buildTransferPlan({
    fields: catalog.fields,
    rows: read,
    matches: matchRows(values, SUPPRESSION_MATCH_KEYS, found.lookup),
    existing: found.records,
    policy: createTransferPolicy({ ...policy, locked: SUPPRESSION_LOCKED_RULES }),
  })
  const done = new Map<number, TransferRowResult>()
  const applied = await hooks.apply(
    ctx,
    { jobId: 'job-1', index: 0, start: 0, end: rows.length, rows: plan.rows.filter((row) => row.verdict === 'create' || row.verdict === 'update') },
    {
      alreadyApplied: async (row) => done.get(row) ?? null,
      markApplied: async (result) => void done.set(result.row, result),
      timeLeftMs: () => 60_000,
    },
  )
  return { plan, applied }
}

const keyOf = (email: string) => `${PATH}/${emailSuppressionKey(email)}`

beforeEach(() => {
  store = {}
})

describe('importing suppressions', () => {
  it('adds a new address under the key every send path looks up, as added by a person', async () => {
    const { applied } = await importRows([{ email: 'Dana@Lumen.co', note: 'Asked by phone' }])
    expect(applied.results[0]).toMatchObject({ outcome: 'created' })
    expect(store[keyOf('dana@lumen.co')]).toMatchObject({
      email: 'dana@lumen.co',
      reason: 'manual',
      note: 'Asked by phone',
      suppressedByUid: 'editor-uid',
      importJobId: 'job-1',
    })
  })

  it('leaves an address already suppressed exactly as it is', async () => {
    store[keyOf('dana@lumen.co')] = { email: 'dana@lumen.co', reason: 'bounce', createdAt: 'then' }
    const { plan } = await importRows([{ email: 'dana@lumen.co', note: 'Asked by phone' }], {
      fieldDefault: { mode: 'overwrite', blank: 'clear' },
    })
    expect(plan.rows[0]?.verdict).toBe('unchanged')
    expect(store[keyOf('dana@lumen.co')]).toEqual({ email: 'dana@lumen.co', reason: 'bounce', createdAt: 'then' })
  })

  it('never relabels an entry that arrived between the dry run and the write', async () => {
    const read = [{ index: 0, ...deriveTransferRow(catalog.byId, { email: 'dana@lumen.co' }) }]
    const plan = buildTransferPlan({
      fields: catalog.fields,
      rows: read,
      matches: [{ kind: 'new' }],
      existing: new Map(),
      policy: createTransferPolicy({ locked: SUPPRESSION_LOCKED_RULES }),
    })
    store[keyOf('dana@lumen.co')] = { email: 'dana@lumen.co', reason: 'complaint' }
    const applied = await hooks.apply(ctx, { jobId: 'job-1', index: 0, start: 0, end: 1, rows: plan.rows }, {
      alreadyApplied: async () => null,
      markApplied: async () => undefined,
      timeLeftMs: () => 60_000,
    })
    expect(applied.results[0]).toMatchObject({ outcome: 'unchanged' })
    expect(store[keyOf('dana@lumen.co')]?.['reason']).toBe('complaint')
  })

  it('writes no undo, so nothing — not even Undo — removes a suppression', async () => {
    const { applied } = await importRows([{ email: 'dana@lumen.co' }])
    expect(applied.undo).toEqual([])
    const reverted = await hooks.revert(ctx, { jobId: 'job-1', chunk: 0, entries: [] })
    expect(reverted).toEqual({ done: [], conflicts: [] })
    expect(store[keyOf('dana@lumen.co')]).toBeDefined()
  })
})

describe('exporting suppressions', () => {
  beforeEach(() => {
    store[`${PATH}/a`] = { email: 'a@lumen.co', reason: 'bounce', emailTokens: ['a'] }
    store[`${PATH}/b`] = { email: 'b@lumen.co', emailTokens: ['b'] }
  })

  it('reads the chosen fields, an absent reason as an unsubscribe', async () => {
    const page = await hooks.readPage(ctx, null, ['email', 'reason'], {})
    expect(page.rows).toEqual([
      { email: 'a@lumen.co', reason: 'bounce' },
      { email: 'b@lumen.co', reason: 'unsubscribe' },
    ])
  })

  it('reads the selection and the card’s own filter, and counts what it reads', async () => {
    expect((await hooks.readPage(ctx, null, ['email'], { ids: ['b'] })).rows).toEqual([{ email: 'b@lumen.co' }])
    const filter = { filters: [{ path: 'reason', op: '==', value: 'bounce' }] }
    expect((await hooks.readPage(ctx, null, ['email'], { filter })).rows).toEqual([{ email: 'a@lumen.co' }])
    expect(await hooks.count?.(ctx, { filter })).toBe(1)
  })

  it('refuses a filter the card could never have asked', async () => {
    await expect(
      hooks.readPage(ctx, null, ['email'], { filter: { filters: [{ path: 'note', op: '==', value: 'x' }] } }),
    ).rejects.toMatchObject({ status: 400 })
  })
})

/**
 * @jest-environment node
 *
 * Pragma must stay in the FIRST block comment — behind the license header it is
 * silently ignored, and this suite needs `Request`/`Response`.
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
 * Plan allowances count LIVE documents: archived yes, deleted no (AGL-3918).
 *
 * Deleting a product, workflow, service, function, variable, redirect, shared
 * layout or template stamps `deletedAt` and keeps the document. Every one of
 * those allowances used to be a plain `count()`, so a deletion never gave its
 * slot back: a Starter site that deleted a product to make room was refused
 * the next one, and Automation read "4/25 workflows" beside a list of three.
 *
 * Per kind, at an allowance of 2:
 *
 *  1. two live documents refuse the third (the control: the cap still holds);
 *  2. two documents, one of them deleted, admit it — the deleted one freed
 *     its slot;
 *  3. an ARCHIVED (or disabled, or draft) document still counts — only a
 *     delete frees a slot;
 *  4. both live shapes count: no `deletedAt` at all, and `deletedAt: null`.
 *
 * Templates keep their starter exclusion on top: a starter's page never
 * counted and a deleted one is not subtracted twice.
 *
 * The REAL `checkQuota`, the REAL plan table and the REAL generated plugin
 * declarations are wired in; only Firestore is a fake, and it evaluates the
 * filters the route sends rather than answering a canned number.
 */

const mockVerifyIdToken = jest.fn()
const mockCreate = jest.fn()

type Row = Record<string, unknown>

const state: {
  memberRoles: Record<string, string>
  org: Record<string, unknown>
  /** Each collection's documents as the SERVER sees them. */
  rows: Record<string, Row[]>
} = { memberRoles: {}, org: {}, rows: {} }

const snapshotOf = (data: Row | null) => ({
  exists: data !== null,
  data: () => data ?? undefined,
  get: (field: string) =>
    field.split('.').reduce<unknown>((value, key) => (value as Row | undefined)?.[key], data ?? {}),
})

type Filter = { field: string; op: string; value: unknown }

/** A field's value on a row, by dotted path. */
const valueAt = (row: Row, field: string): unknown =>
  field.split('.').reduce<unknown>((value, key) => (value as Row | undefined)?.[key], row)

/**
 * Firestore's own semantics for the two filters the route sends: `!=`
 * matches a document that HAS the field with a different value, so an
 * absent field matches neither `!=` nor anything else.
 */
const matches = (row: Row, filters: Filter[]) =>
  filters.every(({ field, op, value }) => {
    const present = valueAt(row, field)
    if (op !== '!=') throw new Error(`the fake does not evaluate ${op}`)
    return present !== undefined && present !== value
  })

const queryOf = (name: string, filters: Filter[]): any => ({
  where: (field: string, op: string, value: unknown) => queryOf(name, [...filters, { field, op, value }]),
  count: () => ({
    get: async () => ({
      data: () => ({ count: (state.rows[name] ?? []).filter((row) => matches(row, filters)).length }),
    }),
  }),
  select: () => ({
    get: async () => ({
      docs: (state.rows[name] ?? []).filter((row) => matches(row, filters)).map((row) => snapshotOf(row)),
    }),
  }),
  get: async () => ({
    empty: true,
    docs: (state.rows[name] ?? []).filter((row) => matches(row, filters)).map((row) => snapshotOf(row)),
  }),
  limit: () => queryOf(name, filters),
  orderBy: () => queryOf(name, filters),
  doc: () => ({
    id: 'generated-id',
    get: async () => snapshotOf(null),
    create: (...args: unknown[]) => mockCreate(name, ...args),
    set: (...args: unknown[]) => mockCreate(name, ...args),
  }),
})

/** Reads before writes; a buffered write lands only on commit. */
const runTransaction = async (body: (tx: any) => Promise<any>) => {
  const buffered: Array<() => unknown> = []
  const tx = {
    get: (query: any) => {
      if (buffered.length) throw new Error('Firestore transactions cannot read after a write')
      return query.get()
    },
    create: (ref: any, data: unknown) => {
      buffered.push(() => ref.create(data))
    },
    set: (ref: any, data: unknown) => {
      buffered.push(() => ref.set(data))
    },
    update: () => undefined,
  }
  const result = await body(tx)
  for (const write of buffered) write()
  return result
}

jest.mock('next/server', () => ({
  after: (work: () => unknown) => work(),
}))

jest.mock('@aglyn/tenant-data-admin', () => ({
  __esModule: true,
  firebaseAdmin: {
    app: () => ({
      auth: () => ({
        verifyIdToken: (...args: unknown[]) => mockVerifyIdToken(...args),
      }),
      firestore: () => ({
        runTransaction: (body: (tx: any) => Promise<any>) => runTransaction(body),
        collection: () => ({
          doc: () => ({
            get: async () => snapshotOf({ memberRoles: state.memberRoles, screens: {} }),
            collection: (name: string) => queryOf(name, []),
          }),
        }),
      }),
    }),
  },
  getOrgForHost: async () => ({ org: state.org }),
  logHostActivity: async () => undefined,
  isImpersonationSession: () => false,
  emailUnverifiedResponse: () => Response.json({ error: 'Verify your email' }, { status: 403 }),
  getLockdownVerdict: async () => null,
  lockdownJsonResponse: (verdict: Record<string, unknown>) =>
    Response.json({ error: 'locked', ...verdict }, { status: 423 }),
}))

jest.mock('@aglyn/aglyn/server', () => ({
  __esModule: true,
  // The REAL policy: a stubbed one answers 0 for every allowance, and "the
  // third is refused" goes green on a platform that refuses the first too.
  ...jest.requireActual('../../../libs/aglyn/src/lib/app-utils/plan-entitlements'),
  ...jest.requireActual('../../../libs/aglyn/src/lib/app-utils/stored-nodes'),
  ...jest.requireActual('../../../libs/aglyn/src/lib/app-utils/site-interactions'),
  ...jest.requireActual('../../../libs/aglyn/src/lib/app-utils/organizations'),
  newFormListFields: jest.requireActual('../../../libs/aglyn/src/lib/app-utils/forms').newFormListFields,
  createResourceUid: () => 'generated-id',
  nameSearchKey: (value: string) => value.toLowerCase(),
  pluginRequestFromWeb: async (request: Request) => ({
    method: request.method,
    body: await request.json().catch(() => ({})),
    headers: { authorization: request.headers.get('authorization') ?? undefined },
  }),
}))

import { POST } from '../app/api/hosts/resources/route'

/** Each plan-counted kind that soft-deletes, the collection it lives in, a minimal create, and its archived shape. */
const KINDS: Array<{
  resource: string
  collection: string
  quotaKey: string
  data: Row
  archived: Row
}> = [
  { resource: 'product', collection: 'products', quotaKey: 'productsPerHost', data: { name: 'Mug' }, archived: { status: 'archived' } },
  { resource: 'workflow', collection: 'workflows', quotaKey: 'workflowsPerHost', data: { name: 'Flow' }, archived: { trigger: null } },
  { resource: 'service', collection: 'services', quotaKey: 'servicesPerHost', data: { name: 'Cut' }, archived: { active: false } },
  { resource: 'function', collection: 'functions', quotaKey: 'functionsPerHost', data: { name: 'fn' }, archived: {} },
  { resource: 'variable', collection: 'variables', quotaKey: 'variablesPerHost', data: { name: 'v' }, archived: {} },
  {
    resource: 'redirect',
    collection: 'redirects',
    quotaKey: 'redirectsPerHost',
    data: { source: '/old', destination: '/new' },
    archived: { enabled: false },
  },
  {
    resource: 'layout',
    collection: 'layouts',
    quotaKey: 'sharedLayoutsPerHost',
    data: { displayName: 'Main' },
    archived: {},
  },
]

const create = (resource: string, data: Row) =>
  POST(
    new Request('https://app.aglyn.com/api/hosts/resources', {
      method: 'POST',
      headers: { authorization: 'Bearer tok' },
      body: JSON.stringify({ hostId: 'host-1', resource, data }),
    }),
  )

/** An org on a paid plan with every feature these kinds need, and an allowance of 2 for `quotaKey`. */
const allowing = (quotaKey: string) => ({
  plan: 'business',
  subscription: { status: 'active' },
  entitlements: {
    [quotaKey]: 2,
    features: { commerce: true, workflows: true, bookings: true, redirects: true },
  },
})

beforeEach(() => {
  jest.clearAllMocks()
  state.memberRoles = { 'user-1': 'admin' }
  state.rows = {}
  mockVerifyIdToken.mockResolvedValue({ uid: 'user-1', email_verified: true })
})

describe.each(KINDS)('$resource: $quotaKey counts live documents (AGL-3918)', (kind) => {
  beforeEach(() => {
    state.org = allowing(kind.quotaKey)
  })

  it('CONTROL: two live documents refuse the third', async () => {
    state.rows[kind.collection] = [{ name: 'a' }, { name: 'b', deletedAt: null }]
    const response = await create(kind.resource, kind.data)
    expect(response.status).toBe(403)
    expect((await response.json()).error).toMatch(/^Your plan includes 2 /)
    expect(mockCreate).not.toHaveBeenCalled()
  })

  it('a deleted document frees its slot', async () => {
    state.rows[kind.collection] = [{ name: 'a' }, { name: 'gone', deletedAt: { seconds: 1 } }]
    const response = await create(kind.resource, kind.data)
    expect(response.status).toBe(200)
    expect(mockCreate).toHaveBeenCalledTimes(1)
  })

  it('an archived document still counts', async () => {
    state.rows[kind.collection] = [{ name: 'a' }, { name: 'shelved', deletedAt: null, ...kind.archived }]
    expect((await create(kind.resource, kind.data)).status).toBe(403)
    expect(mockCreate).not.toHaveBeenCalled()
  })
})

describe('templatesPerHost: live, and never a starter (AGL-3918, AGL-687)', () => {
  const template = { kind: 'page', displayName: 'Landing', nodes: {}, rootId: 'root' }

  beforeEach(() => {
    state.org = allowing('templatesPerHost')
  })

  it('CONTROL: two authored templates refuse the third, and a starter beside them never counted', async () => {
    state.rows['templates'] = [
      { source: { type: 'authored' } },
      { source: { type: 'marketplace' }, deletedAt: null },
      { source: { type: 'starter' } },
    ]
    expect((await create('template', template)).status).toBe(403)
  })

  it('a deleted authored template frees its slot', async () => {
    state.rows['templates'] = [
      { source: { type: 'authored' } },
      { source: { type: 'authored' }, deletedAt: { seconds: 1 } },
    ]
    expect((await create('template', template)).status).toBe(200)
  })

  it('a deleted STARTER is not subtracted: it was never counted', async () => {
    state.rows['templates'] = [
      { source: { type: 'authored' } },
      { source: { type: 'marketplace' } },
      { source: { type: 'starter' }, deletedAt: { seconds: 1 } },
    ]
    expect((await create('template', template)).status).toBe(403)
  })
})

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
 * `crm/company-delete` — a company's contacts unlinked, then the company
 * (AGL-2804).
 *
 * Firestore does not cascade, so a company deleted on its own would leave
 * every contact at it naming a record that no longer exists. The unlink
 * clears a facet, and a facet is the server's to write, so the pass is a
 * route. What is pinned here:
 *
 *  1. THE GATE. POST only; a body with no scope or company; no token; a
 *     viewer; and a member scoped to particular sites, whose access cannot
 *     reach every contact the company names.
 *  2. THE DETACH. Under the bound every linked contact loses the id from its
 *     mirror and every facet naming it is cleared — a link to another
 *     company is untouched — and only then is the document deleted.
 *  3. PAST THE BOUND. A pass detaches a batch's worth, keeps the company and
 *     says more remain.
 *  4. THE PLAN (AGL-2851). Companies are the CRM's, included from Starter: a
 *     plan without it is refused once the writer is known, staff included,
 *     and nothing is unlinked.
 */

const verifyIdToken = jest.fn()
const getOrgForHost = jest.fn()
const getOrgDoc = jest.fn()
const resolveOrgMembership = jest.fn()
const memberHasOrgPermission = jest.fn()
const resolveOrgPermissions = jest.fn()

type Doc = Record<string, any>
let store: Record<string, Doc> = {}
/** How many batches committed, and how many updates each carried. */
let committed: number[] = []

function applyPatch(target: Doc, patch: Doc): Doc {
  const next: Doc = JSON.parse(JSON.stringify(target))
  for (const [path, value] of Object.entries(patch)) {
    const keys = path.split('.')
    let node = next
    for (const key of keys.slice(0, -1)) {
      if (!node[key] || typeof node[key] !== 'object') node[key] = {}
      node = node[key]
    }
    const leaf = keys[keys.length - 1]
    const op = value && typeof value === 'object' ? value.__sentinel : undefined
    if (op === 'delete') delete node[leaf]
    else if (op === 'serverTimestamp') node[leaf] = 'server-time'
    else if (op === 'arrayRemove') {
      node[leaf] = (node[leaf] ?? []).filter((entry: unknown) => !value.values.includes(entry))
    } else node[leaf] = JSON.parse(JSON.stringify(value))
  }
  return next
}

const snapshotOf = (path: string): any => ({
  id: path.slice(path.lastIndexOf('/') + 1),
  ref: docHandle(path),
  exists: path in store,
  get: (field: string) => store[path]?.[field],
  data: () => (path in store ? JSON.parse(JSON.stringify(store[path])) : undefined),
})

const docHandle = (path: string): any => ({
  id: path.slice(path.lastIndexOf('/') + 1),
  path,
  get: async () => snapshotOf(path),
  update: async (patch: Doc) => {
    if (!(path in store)) throw new Error(`no document at ${path}`)
    store[path] = applyPatch(store[path], patch)
  },
  delete: async () => {
    delete store[path]
  },
  collection: (name: string) => collectionHandle(`${path}/${name}`),
})

const childrenOf = (path: string) =>
  Object.keys(store).filter(
    (key) => key.startsWith(`${path}/`) && !key.slice(path.length + 1).includes('/'),
  )

const queryHandle = (
  path: string,
  filters: Array<(doc: Doc) => boolean>,
  cap?: number,
): any => ({
  where: (field: string, op: string, value: unknown) =>
    queryHandle(
      path,
      [
        ...filters,
        (doc: Doc) =>
          op === 'array-contains'
            ? Array.isArray(doc[field]) && doc[field].includes(value)
            : doc[field] === value,
      ],
      cap,
    ),
  limit: (count: number) => queryHandle(path, filters, count),
  get: async () => {
    const docs = childrenOf(path)
      .filter((key) => filters.every((keep) => keep(store[key])))
      .slice(0, cap ?? Infinity)
      .map(snapshotOf)
    return { docs, empty: docs.length === 0, size: docs.length }
  },
})

const collectionHandle = (path: string): any => ({
  ...queryHandle(path, []),
  doc: (id: string) => docHandle(`${path}/${id}`),
})

const firestoreHandle = {
  collection: (name: string) => collectionHandle(name),
  batch: () => {
    const staged: Array<{ ref: any; patch: Doc }> = []
    return {
      update: (ref: any, patch: Doc) => void staged.push({ ref, patch }),
      commit: async () => {
        for (const { ref, patch } of staged) await ref.update(patch)
        committed.push(staged.length)
      },
    }
  },
}

jest.mock('firebase-admin/firestore', () => ({
  __esModule: true,
  FieldValue: {
    delete: () => ({ __sentinel: 'delete' }),
    serverTimestamp: () => ({ __sentinel: 'serverTimestamp' }),
    arrayRemove: (...values: unknown[]) => ({ __sentinel: 'arrayRemove', values }),
  },
}))

jest.mock('@aglyn/tenant-runtime', () => ({
  __esModule: true,
  emitHostEvent: jest.fn(),
}))

jest.mock('@aglyn/tenant-runtime/org-permissions', () => ({
  __esModule: true,
  resolveOrgPermissions: (...args: unknown[]) => resolveOrgPermissions(...args),
}))

jest.mock('@aglyn/tenant-data-admin', () => ({
  __esModule: true,
  firebaseAdmin: {
    app: () => ({
      auth: () => ({ verifyIdToken: (token: string) => verifyIdToken(token) }),
      firestore: () => firestoreHandle,
    }),
  },
  getOrgForHost: (...args: unknown[]) => getOrgForHost(...args),
  getOrgDoc: (...args: unknown[]) => getOrgDoc(...args),
  resolveOrgMembership: (...args: unknown[]) => resolveOrgMembership(...args),
  memberHasOrgPermission: (...args: unknown[]) => memberHasOrgPermission(...args),
  notifyUsers: jest.fn(),
  recomputeCrmNextTaskAt: jest.fn(),
  crmNextActivityLinksOf: jest.fn(),
}))

import { COMPANY_DETACH_LIMIT } from '../model/company-delete-route'
import { crmCompanyDeleteHandler } from './company-delete'

const ORG_ID = 'org-1'
const HOST = 'host-1'
const CONTACTS = `orgs/${ORG_ID}/contacts`
const COMPANIES = `orgs/${ORG_ID}/companies`

let caller: Record<string, unknown>
let org: Record<string, unknown>
let members: Record<string, Record<string, unknown>>

async function post(
  body: Record<string, unknown>,
  options: { token?: string | null; method?: string } = {},
) {
  const token = options.token === undefined ? 'good' : options.token
  let status = 0
  let payload: any
  const headers: Record<string, unknown> = {}
  const res: any = {
    status: (code: number) => {
      status = code
      return res
    },
    json: (value: unknown) => {
      payload = value
    },
    setHeader: (name: string, value: unknown) => {
      headers[name] = value
    },
    send: () => undefined,
    end: () => undefined,
    redirect: () => undefined,
  }
  await crmCompanyDeleteHandler(
    {
      method: options.method ?? 'POST',
      query: {},
      body,
      headers: token ? { authorization: `Bearer ${token}` } : {},
      cookies: {},
      socket: {},
    } as any,
    res,
  )
  return { status, payload, headers }
}

/** `count` contacts whose site-1 facet links Acme. */
function seedLinked(count: number) {
  for (let index = 0; index < count; index += 1) {
    store[`${CONTACTS}/linked-${index}`] = {
      email: `person-${index}@acme.test`,
      visibleTo: [`host:${HOST}`],
      companyIds: ['co-acme'],
      facets: { [HOST]: { sources: {}, interactions: [], companyId: 'co-acme' } },
    }
  }
}

const DELETE_ACME = { hostId: HOST, companyId: 'co-acme' }

beforeEach(() => {
  jest.clearAllMocks()
  committed = []
  caller = { uid: 'owner-uid' }
  org = { plan: 'starter' }
  members = {
    'owner-uid': { role: 'owner', allHosts: true, scopeTokens: ['org'] },
    'scoped-uid': {
      role: 'editor',
      allHosts: false,
      hostAccess: { [HOST]: 'editor' },
      scopeTokens: ['org', `host:${HOST}`],
    },
    'viewer-uid': { role: 'viewer', allHosts: true, scopeTokens: ['org'] },
  }
  verifyIdToken.mockImplementation(async (token: string) => {
    if (token !== 'good') throw new Error('bad token')
    return caller
  })
  getOrgForHost.mockImplementation(async (hostId: string) =>
    hostId === HOST ? { orgId: ORG_ID, org } : null,
  )
  getOrgDoc.mockImplementation(async (orgId: string) => (orgId === ORG_ID ? org : null))
  resolveOrgMembership.mockImplementation(async (uid: string) =>
    members[uid] ? { orgId: ORG_ID, member: { $id: uid, ...members[uid] } } : null,
  )
  memberHasOrgPermission.mockImplementation(
    async (_orgId: string, member: { role?: string }) => member?.role !== 'viewer',
  )
  resolveOrgPermissions.mockImplementation(async (uid: string) =>
    members[uid]
      ? {
          orgId: ORG_ID,
          orgWide: members[uid]['allHosts'] === true,
          role: members[uid]['role'],
          permissions: { 'data.manage': members[uid]['role'] !== 'viewer' },
        }
      : null,
  )
  store = {
    [`${COMPANIES}/co-acme`]: { name: 'Acme', visibleTo: [`host:${HOST}`], contactsCount: 2 },
    [`${COMPANIES}/co-globex`]: { name: 'Globex', visibleTo: ['org'], contactsCount: 1 },
  }
})

describe('the gate', () => {
  it('refuses any method but POST, and a body naming no site or no company', async () => {
    const wrongMethod = await post(DELETE_ACME, { method: 'GET' })
    expect(wrongMethod.status).toBe(405)
    expect(wrongMethod.headers['Allow']).toBe('POST')
    expect((await post({ hostId: HOST })).status).toBe(400)
    expect((await post({ companyId: 'co-acme' })).status).toBe(400)
    expect(verifyIdToken).not.toHaveBeenCalled()
  })

  it('refuses a caller with no token, and a viewer', async () => {
    expect((await post(DELETE_ACME, { token: null })).status).toBe(401)
    caller = { uid: 'viewer-uid' }
    expect((await post(DELETE_ACME)).status).toBe(403)
    expect(store[`${COMPANIES}/co-acme`]).toBeDefined()
  })

  it('refuses a member scoped to particular sites, and says why', async () => {
    seedLinked(1)
    caller = { uid: 'scoped-uid' }
    const { status, payload } = await post(DELETE_ACME)
    expect(status).toBe(403)
    expect(payload.error).toMatch(/limited to specific sites/)
    expect(store[`${COMPANIES}/co-acme`]).toBeDefined()
    expect(store[`${CONTACTS}/linked-0`].companyIds).toEqual(['co-acme'])
  })

  it('answers a company that does not exist as unknown', async () => {
    const { status } = await post({ hostId: HOST, companyId: 'co-gone' })
    expect(status).toBe(404)
  })
})

/**
 * THE PLAN (AGL-2851). Companies are the CRM's, and the CRM is included from
 * Starter: a workspace whose plan does not carry it deletes no company here,
 * staff included, and nothing is unlinked. Asked once the caller is known, so
 * a viewer on Free still hears about their role.
 */
describe('the plan', () => {
  const refusedForPlan = (answer: { status: number; payload: any }) =>
    answer.status === 403 &&
    answer.payload?.reason === 'plan_required' &&
    answer.payload?.code === 'crm'

  it('refuses a Free workspace, staff included, and unlinks nothing', async () => {
    seedLinked(1)
    org = { plan: 'free' }
    expect(refusedForPlan(await post(DELETE_ACME))).toBe(true)
    caller = { uid: 'staff-uid', staff: true }
    expect(refusedForPlan(await post(DELETE_ACME))).toBe(true)
    expect(store[`${COMPANIES}/co-acme`]).toBeDefined()
    expect(store[`${CONTACTS}/linked-0`].companyIds).toEqual(['co-acme'])
  })

  it('reads a paid plan whose subscription died as Free', async () => {
    org = { plan: 'pro', billingStatus: 'canceled' }
    expect(refusedForPlan(await post(DELETE_ACME))).toBe(true)
    expect(store[`${COMPANIES}/co-acme`]).toBeDefined()
  })

  it('answers authorization before the plan', async () => {
    org = { plan: 'free' }
    expect((await post(DELETE_ACME, { token: null })).status).toBe(401)
    caller = { uid: 'viewer-uid' }
    const viewer = await post(DELETE_ACME)
    expect(viewer.status).toBe(403)
    expect(viewer.payload.reason).toBeUndefined()
  })

  it('CONTROL: admits Starter', async () => {
    org = { plan: 'starter', subscription: { status: 'active' } }
    expect((await post(DELETE_ACME)).status).toBe(200)
    expect(store[`${COMPANIES}/co-acme`]).toBeUndefined()
  })
})

describe('the detach', () => {
  it('unlinks every contact — the mirror and every facet naming it — then deletes the company', async () => {
    store[`${CONTACTS}/shared`] = {
      email: 'shared@acme.test',
      visibleTo: [`host:${HOST}`, 'host:host-2'],
      companyIds: ['co-acme', 'co-globex'],
      facets: {
        [HOST]: { sources: {}, interactions: [], companyId: 'co-acme' },
        'host-2': { sources: {}, interactions: [], companyId: 'co-acme' },
        'host-3': { sources: {}, interactions: [], companyId: 'co-globex' },
      },
    }
    seedLinked(1)
    const { status, payload } = await post(DELETE_ACME)
    expect(status).toBe(200)
    expect(payload).toEqual({ ok: true, deleted: true, detached: 2, moreRemain: false })
    expect(committed).toEqual([2])
    const shared = store[`${CONTACTS}/shared`]
    expect(shared.companyIds).toEqual(['co-globex'])
    expect(shared.facets[HOST]).not.toHaveProperty('companyId')
    expect(shared.facets['host-2']).not.toHaveProperty('companyId')
    // Another company's link is not this delete's business.
    expect(shared.facets['host-3'].companyId).toBe('co-globex')
    expect(store[`${CONTACTS}/linked-0`].companyIds).toEqual([])
    expect(store[`${COMPANIES}/co-acme`]).toBeUndefined()
    expect(store[`${COMPANIES}/co-globex`]).toBeDefined()
  })

  it('deletes a company nobody is linked to without a batch', async () => {
    const { status, payload } = await post(DELETE_ACME)
    expect(status).toBe(200)
    expect(payload).toEqual({ ok: true, deleted: true, detached: 0, moreRemain: false })
    expect(committed).toEqual([])
    expect(store[`${COMPANIES}/co-acme`]).toBeUndefined()
  })

  it('past the bound: detaches a batch, keeps the company, and says more remain', async () => {
    seedLinked(COMPANY_DETACH_LIMIT + 1)
    const { status, payload } = await post(DELETE_ACME)
    expect(status).toBe(200)
    expect(payload).toEqual({
      ok: true,
      deleted: false,
      detached: COMPANY_DETACH_LIMIT,
      moreRemain: true,
    })
    expect(committed).toEqual([COMPANY_DETACH_LIMIT])
    expect(store[`${COMPANIES}/co-acme`]).toBeDefined()
    const stillLinked = Object.keys(store).filter(
      (key) => key.startsWith(`${CONTACTS}/`) && store[key].companyIds.includes('co-acme'),
    )
    expect(stillLinked).toHaveLength(1)
  })
})

describe('the organization level', () => {
  it('deletes from the organization level', async () => {
    const { status, payload } = await post({ orgId: ORG_ID, companyId: 'co-acme' })
    expect(status).toBe(200)
    expect(payload.deleted).toBe(true)
  })
})

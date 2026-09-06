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

import { createHash } from 'node:crypto'
import type { PluginApiRequest, PluginApiResponse } from '@aglyn/aglyn/server'
import { crmErasePersonHandler } from './erase-person'

/*==========================================
 * A path-keyed store — the shape `lead-convert.spec.ts` uses. What this
 * suite watches is what the route WRITES: the request document, the markers
 * on the records, one suppression row per site, and an audit row that
 * carries no address.
 *=========================================*/
const docs = new Map<string, Record<string, any>>()
const audit: Record<string, any>[] = []
let autoId = 0

function childPaths(path: string): string[] {
  const prefix = `${path}/`
  return [...docs.keys()].filter(
    (key) => key.startsWith(prefix) && !key.slice(prefix.length).includes('/'),
  )
}

function applyPatch(existing: Record<string, any>, patch: Record<string, any>) {
  const next = { ...existing }
  for (const [field, value] of Object.entries(patch)) {
    if (value && typeof value === 'object' && '__delete' in value) delete next[field]
    else next[field] = value
  }
  return next
}

function snapshot(path: string) {
  const data = docs.get(path)
  return {
    id: path.split('/').pop() as string,
    exists: data !== undefined,
    data: () => data,
    get: (field: string) => data?.[field],
    ref: docRef(path),
  }
}

function docRef(path: string): any {
  return {
    id: path.split('/').pop() as string,
    path,
    get: async () => snapshot(path),
    set: async (value: Record<string, any>, options?: { merge?: boolean }) => {
      docs.set(path, options?.merge ? applyPatch(docs.get(path) ?? {}, value) : { ...value })
    },
    update: async (value: Record<string, any>) => {
      const existing = docs.get(path)
      if (existing === undefined) throw new Error(`NOT_FOUND ${path}`)
      docs.set(path, applyPatch(existing, value))
    },
    delete: async () => {
      docs.delete(path)
    },
    collection: (name: string) => collectionRef(`${path}/${name}`),
  }
}

function collectionRef(path: string): any {
  const make = (filters: Array<[string, unknown]>, max?: number): any => ({
    where: (field: string, op: string, value: unknown) => {
      if (op !== '==') throw new Error(`unsupported op ${op}`)
      return make([...filters, [field, value]], max)
    },
    limit: (n: number) => make(filters, n),
    get: async () => {
      const hits = childPaths(path)
        .map(snapshot)
        .filter((snap) => filters.every(([field, value]) => snap.data()?.[field] === value))
        .slice(0, max ?? Number.POSITIVE_INFINITY)
      return { empty: hits.length === 0, size: hits.length, docs: hits }
    },
    doc: (id?: string) => docRef(`${path}/${id ?? `auto-${++autoId}`}`),
    add: async (data: Record<string, any>) => {
      if (path === 'adminAudit') audit.push(data)
      const ref = docRef(`${path}/auto-${++autoId}`)
      await ref.set(data)
      return ref
    },
  })
  return make([])
}

const fakeFirestore = { collection: (name: string) => collectionRef(name) }

const HOST = 'h1'
const ORG = 'org1'
const CALLER = 'uid-admin'
const EMAIL = 'jane@example.com'
const KEY = createHash('sha256').update(EMAIL).digest('hex')

const mockVerifyIdToken = jest.fn(async () => ({ uid: CALLER, email: 'admin@acme.test' }))
const mockLogHostActivity = jest.fn(async () => undefined)
const mockLogOrgActivity = jest.fn(async () => undefined)
const mockResolveOrgPermissions = jest.fn(async () => ({
  orgId: ORG,
  role: 'admin',
  isOwner: true,
  permissions: { 'data.manage': true },
  orgWide: true,
  hostRole: 'admin',
}))
const mockSuppress = jest.fn(async (input: { hostId: string; email: string }) => {
  docs.set(`hosts/${input.hostId}/suppressions/${KEY}`, { email: null, reason: 'erasure' })
  return { key: KEY, created: true }
})

jest.mock('firebase-admin/firestore', () => ({
  FieldValue: {
    serverTimestamp: () => ({ __serverTimestamp: true }),
    delete: () => ({ __delete: true }),
  },
}))
jest.mock('@aglyn/tenant-runtime/org-permissions', () => ({
  resolveOrgPermissions: (...args: unknown[]) => (mockResolveOrgPermissions as any)(...args),
}))
jest.mock('@aglyn/tenant-data-admin', () => ({
  firebaseAdmin: {
    app: () => ({
      auth: () => ({ verifyIdToken: (...args: unknown[]) => (mockVerifyIdToken as any)(...args) }),
      firestore: () => fakeFirestore,
    }),
  },
  getOrgForHost: async (hostId: string) => (hostId === HOST ? { orgId: ORG, org: {} } : null),
  orgDataCollectionForHost: async (_hostId: string, name: string) =>
    collectionRef(`orgs/${ORG}/${name}`),
  logHostActivity: (...args: unknown[]) => mockLogHostActivity(...(args as [])),
  logOrgActivity: (...args: unknown[]) => mockLogOrgActivity(...(args as [])),
  getOrgDoc: async (orgId: string) => (orgId === ORG ? { $id: ORG } : null),
  suppressEmailForHostErasure: (input: { hostId: string; email: string }) => mockSuppress(input),
}))

async function call(
  body: unknown,
  options: { method?: string; token?: string | null } = {},
) {
  const { method = 'POST', token = 'token' } = options
  let status = 0
  let answer: any
  const headers: Record<string, unknown> = {}
  const res: PluginApiResponse = {
    status: (code: number) => {
      status = code
      return res
    },
    json: (value: unknown) => {
      answer = value
    },
    send: (value: unknown) => {
      answer = value
    },
    setHeader: (name: string, value: unknown) => {
      headers[name] = value
    },
    redirect: () => undefined,
    end: () => undefined,
  }
  const req = {
    method,
    query: {},
    body,
    headers: token ? { authorization: `Bearer ${token}` } : {},
    cookies: {},
    socket: {},
  } as unknown as PluginApiRequest
  await crmErasePersonHandler(req, res)
  return { status, body: answer, headers }
}

function seed() {
  docs.set(`hosts/${HOST}`, { orgId: ORG })
  docs.set('hosts/h2', { orgId: ORG })
  docs.set('hosts/other', { orgId: 'org2' })
  docs.set(`orgs/${ORG}/contacts/c1`, { email: EMAIL, name: 'Jane' })
  docs.set(`hosts/${HOST}/leads/${KEY}`, { email: EMAIL })
  docs.set(`hosts/h2/leads/${KEY}`, { email: EMAIL })
  docs.set(`hosts/other/leads/${KEY}`, { email: EMAIL })
}

beforeEach(() => {
  docs.clear()
  audit.length = 0
  autoId = 0
  mockVerifyIdToken.mockClear()
  mockLogHostActivity.mockClear()
  mockLogOrgActivity.mockClear()
  mockSuppress.mockClear()
  mockResolveOrgPermissions.mockClear()
  mockResolveOrgPermissions.mockResolvedValue({
    orgId: ORG,
    role: 'admin',
    isOwner: true,
    permissions: { 'data.manage': true },
    orgWide: true,
    hostRole: 'admin',
  })
})

describe('the door', () => {
  it('answers POST only', async () => {
    const { status, headers } = await call({}, { method: 'GET' })
    expect(status).toBe(405)
    expect(headers['Allow']).toBe('POST')
  })

  it('refuses without a token', async () => {
    seed()
    const { status } = await call({ hostId: HOST, contactId: 'c1', email: EMAIL }, { token: null })
    expect(status).toBe(401)
  })

  it('refuses a member who is not a workspace admin, whatever their data permission', async () => {
    // A site editor may detach a contact from their own site; removing the
    // person from every site in the workspace is the workspace's decision.
    seed()
    mockResolveOrgPermissions.mockResolvedValue({
      orgId: ORG,
      role: 'editor',
      isOwner: false,
      permissions: { 'data.manage': true },
      orgWide: true,
      hostRole: 'editor',
    })
    const { status } = await call({ hostId: HOST, contactId: 'c1', email: EMAIL })
    expect(status).toBe(403)
    expect(docs.has(`personErasures/${ORG}__${KEY}`)).toBe(false)
  })

  it('needs the site and exactly one record', async () => {
    seed()
    expect((await call({ hostId: HOST, email: EMAIL })).status).toBe(400)
    expect((await call({ hostId: HOST, contactId: 'c1', leadId: KEY, email: EMAIL })).status).toBe(400)
  })

  it('answers not-found for a record that is not there', async () => {
    seed()
    expect((await call({ hostId: HOST, contactId: 'nope', email: EMAIL })).status).toBe(404)
    expect((await call({ hostId: HOST, leadId: 'nope', email: EMAIL })).status).toBe(404)
  })

  it('refuses when the typed address is not the record\'s', async () => {
    seed()
    const { status } = await call({ hostId: HOST, contactId: 'c1', email: 'jane@example.org' })
    expect(status).toBe(400)
    expect(docs.has(`personErasures/${ORG}__${KEY}`)).toBe(false)
    expect(mockSuppress).not.toHaveBeenCalled()
  })
})

describe('filing from a contact', () => {
  it('writes a pending request carrying the address the sweep will need', async () => {
    seed()
    const before = Date.now()
    const { status, body } = await call({ hostId: HOST, contactId: 'c1', email: ' Jane@Example.com ' })
    expect(status).toBe(200)
    expect(body).toMatchObject({ ok: true, requestId: `${ORG}__${KEY}`, alreadyPending: false })
    const request = docs.get(`personErasures/${ORG}__${KEY}`)
    expect(request).toMatchObject({
      orgId: ORG,
      personKey: KEY,
      status: 'pending',
      email: EMAIL,
      requestedByUid: CALLER,
      hostId: HOST,
      contactId: 'c1',
    })
    expect(request?.pendingSinceMs).toBeGreaterThanOrEqual(before)
    expect(body.pendingSinceMs).toBe(request?.pendingSinceMs)
  })

  it('closes the door on every site of the workspace at once, and no other workspace\'s', async () => {
    seed()
    await call({ hostId: HOST, contactId: 'c1', email: EMAIL })
    expect(mockSuppress.mock.calls.map(([input]) => input.hostId).sort()).toEqual([HOST, 'h2'])
    expect(docs.has(`hosts/other/suppressions/${KEY}`)).toBe(false)
  })

  it('stamps the contact and each of the workspace\'s leads so their pages can say so', async () => {
    seed()
    await call({ hostId: HOST, contactId: 'c1', email: EMAIL })
    const stamp = docs.get(`personErasures/${ORG}__${KEY}`)?.pendingSinceMs
    expect(docs.get(`orgs/${ORG}/contacts/c1`)?.erasureRequestedAtMs).toBe(stamp)
    expect(docs.get(`hosts/${HOST}/leads/${KEY}`)?.erasureRequestedAtMs).toBe(stamp)
    expect(docs.get(`hosts/h2/leads/${KEY}`)?.erasureRequestedAtMs).toBe(stamp)
    expect(docs.get(`hosts/other/leads/${KEY}`)).not.toHaveProperty('erasureRequestedAtMs')
  })

  it('records the act on the site feed and the audit log without the address', async () => {
    seed()
    await call({ hostId: HOST, contactId: 'c1', email: EMAIL })
    expect(mockLogHostActivity).toHaveBeenCalledWith(
      HOST,
      { uid: CALLER, email: 'admin@acme.test' },
      'Requested privacy erasure',
      { type: 'contact', id: 'c1' },
    )
    expect(audit).toHaveLength(1)
    expect(audit[0]).toMatchObject({
      actorUid: CALLER,
      action: 'person.erasure-requested',
      target: `orgs/${ORG}/people/${KEY}`,
    })
    expect(JSON.stringify(audit[0])).not.toContain(EMAIL)
  })

  it('does not re-file a request that is already waiting', async () => {
    seed()
    docs.set(`personErasures/${ORG}__${KEY}`, {
      orgId: ORG,
      status: 'pending',
      pendingSinceMs: 5,
      requestedByUid: 'someone-earlier',
    })
    const { status, body } = await call({ hostId: HOST, contactId: 'c1', email: EMAIL })
    expect(status).toBe(200)
    expect(body).toMatchObject({ ok: true, alreadyPending: true, pendingSinceMs: 5 })
    expect(docs.get(`personErasures/${ORG}__${KEY}`)?.requestedByUid).toBe('someone-earlier')
    expect(mockSuppress).not.toHaveBeenCalled()
  })

  it('re-files cleanly over a request that had failed', async () => {
    seed()
    docs.set(`personErasures/${ORG}__${KEY}`, {
      orgId: ORG,
      status: 'failed',
      failedAtMs: 9,
      lastError: 'boom',
    })
    await call({ hostId: HOST, contactId: 'c1', email: EMAIL })
    const request = docs.get(`personErasures/${ORG}__${KEY}`)
    expect(request?.status).toBe('pending')
    expect(request).not.toHaveProperty('failedAtMs')
    expect(request).not.toHaveProperty('lastError')
  })
})

describe('filing from a lead', () => {
  it('takes the address off the lead and files the same request', async () => {
    seed()
    const { status, body } = await call({ hostId: HOST, leadId: KEY, email: EMAIL })
    expect(status).toBe(200)
    expect(body).toMatchObject({ ok: true, requestId: `${ORG}__${KEY}` })
    expect(docs.get(`personErasures/${ORG}__${KEY}`)).toMatchObject({ leadId: KEY, email: EMAIL })
    expect(docs.get(`personErasures/${ORG}__${KEY}`)).not.toHaveProperty('contactId')
    expect(mockLogHostActivity).toHaveBeenCalledWith(
      HOST,
      expect.anything(),
      'Requested privacy erasure',
      { type: 'lead', id: KEY },
    )
  })
})

/**
 * THE ORGANIZATION VARIANT (AGL-2634): filed from the org-level hub for a
 * contact no site need have captured. The same admin-only gate, answered by
 * the org; the same sweep over every site the org has; the row in the org's
 * feed rather than a site's.
 */
describe('the door at the organization level', () => {
  const org = { orgId: ORG, contactId: 'c1', email: EMAIL }

  it('files the request from a contact with no site, sweeps every site of the org, and logs the org line', async () => {
    seed()
    const { status, body } = await call(org)
    expect(status).toBe(200)
    expect(body).toMatchObject({ ok: true, alreadyPending: false })
    expect(mockResolveOrgPermissions).toHaveBeenCalledWith(CALLER, { orgId: ORG })
    const request = docs.get(`personErasures/${ORG}__${KEY}`)
    expect(request).toMatchObject({ orgId: ORG, status: 'pending', contactId: 'c1' })
    expect(request).not.toHaveProperty('hostId')
    // Both of the org's sites, and not the other org's.
    expect(mockSuppress.mock.calls.map((call) => (call as any)[0].hostId).sort()).toEqual(['h1', 'h2'])
    expect(docs.get(`hosts/${HOST}/leads/${KEY}`)?.['erasureRequestedAtMs']).toEqual(expect.any(Number))
    expect(docs.get(`hosts/other/leads/${KEY}`)?.['erasureRequestedAtMs']).toBeUndefined()
    expect(docs.get(`orgs/${ORG}/contacts/c1`)?.['erasureRequestedAtMs']).toEqual(expect.any(Number))
    expect(mockLogOrgActivity).toHaveBeenCalledWith(
      ORG,
      { uid: CALLER, email: 'admin@acme.test' },
      'Requested privacy erasure',
      { type: 'contact', id: 'c1' },
    )
    expect(mockLogHostActivity).not.toHaveBeenCalled()
    expect(audit[0].after).toEqual({ hostId: null, hosts: 2, from: 'contact' })
  })

  it('refuses an org-wide editor and a site-scoped admin alike, before any read', async () => {
    seed()
    mockResolveOrgPermissions.mockResolvedValue({
      orgId: ORG,
      role: 'editor',
      isOwner: false,
      permissions: { 'data.manage': true },
      orgWide: true,
      hostRole: 'editor',
    })
    expect((await call(org)).status).toBe(403)
    mockResolveOrgPermissions.mockResolvedValue({
      orgId: ORG,
      role: 'admin',
      isOwner: true,
      permissions: { 'data.manage': true },
      orgWide: false,
      hostRole: 'admin',
    })
    expect((await call(org)).status).toBe(403)
    expect(docs.has(`personErasures/${ORG}__${KEY}`)).toBe(false)
    expect(mockLogOrgActivity).not.toHaveBeenCalled()
  })

  it('needs a site for a lead, and files from one with the org line still the org’s', async () => {
    seed()
    expect((await call({ orgId: ORG, leadId: KEY, email: EMAIL })).status).toBe(400)
    const { status } = await call({ orgId: ORG, hostId: HOST, leadId: KEY, email: EMAIL })
    expect(status).toBe(200)
    expect(docs.get(`personErasures/${ORG}__${KEY}`)).toMatchObject({ hostId: HOST, leadId: KEY })
    expect(mockLogOrgActivity).toHaveBeenCalledWith(ORG, expect.anything(), 'Requested privacy erasure', {
      type: 'lead',
      id: KEY,
    })
    expect(mockLogHostActivity).not.toHaveBeenCalled()
  })

  it('answers not-found for a contact the org does not hold', async () => {
    seed()
    expect((await call({ ...org, contactId: 'nope' })).status).toBe(404)
  })
})

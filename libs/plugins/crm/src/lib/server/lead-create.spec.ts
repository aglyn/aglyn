/**
 * `crm/leads-create` (AGL-3231): a lead typed in by hand — who may call
 * it, that it goes through the one lead door, what it writes, and what it
 * refuses before writing.
 *
 * `addHostLead` is the REAL capture door, as in the import's spec, because
 * everything this route is judged on is the door's: the `personKey` id,
 * the `capturedByHostIds` stamp, the absence of `visibleTo`, the basis it
 * does not write. Firestore is an in-memory map keyed by path.
 */

import type { PluginApiRequest, PluginApiResponse } from '@aglyn/aglyn/server'

const docs = new Map<string, Record<string, any>>()
let autoId = 0

function childPaths(path: string): string[] {
  const prefix = `${path}/`
  return [...docs.keys()].filter(
    (key) => key.startsWith(prefix) && !key.slice(prefix.length).includes('/'),
  )
}

function applyWrite(
  existing: Record<string, any> | undefined,
  value: Record<string, any>,
): Record<string, any> {
  const next: Record<string, any> = { ...(existing ?? {}) }
  for (const [key, field] of Object.entries(value)) {
    if (field && typeof field === 'object' && '__arrayUnion' in field) {
      const before = Array.isArray(next[key]) ? next[key] : []
      next[key] = [
        ...before,
        ...(field.__arrayUnion as unknown[]).filter((item) => !before.includes(item)),
      ]
    } else if (field && typeof field === 'object' && '__increment' in field) {
      next[key] = Number(next[key] ?? 0) + Number(field.__increment)
    } else if (field && typeof field === 'object' && '__delete' in field) {
      delete next[key]
    } else {
      next[key] = field
    }
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
  }
}

function docRef(path: string): any {
  return {
    id: path.split('/').pop() as string,
    path,
    firestore: fakeFirestore,
    get: async () => snapshot(path),
    set: async (value: Record<string, any>, options?: { merge?: boolean }) => {
      docs.set(path, options?.merge ? applyWrite(docs.get(path), value) : { ...value })
    },
    collection: (name: string) => collectionRef(`${path}/${name}`),
  }
}

function countQuery(path: string): any {
  return {
    __aggregate: true,
    get: async () => ({ data: () => ({ count: childPaths(path).length }) }),
  }
}

function collectionRef(path: string): any {
  return {
    path,
    doc: (id?: string) => docRef(`${path}/${id ?? `auto-${++autoId}`}`),
    count: () => countQuery(path),
  }
}

const fakeFirestore: any = {
  collection: (name: string) => collectionRef(name),
  runTransaction: async (body: (tx: any) => Promise<unknown>) => {
    const tx = {
      get: async (target: any) => target.get(),
      set: (ref: any, value: Record<string, any>, options?: { merge?: boolean }) => {
        docs.set(
          ref.path,
          options?.merge ? applyWrite(docs.get(ref.path), value) : { ...value },
        )
      },
    }
    return body(tx)
  },
}

const HOST = 'site-1'
const ORG = 'org-1'
const CALLER = 'editor-uid'

let org: Record<string, unknown> = { plan: 'starter' }
let leadCeiling = 200_000
const mockLogHostActivity = jest.fn(async (..._args: unknown[]) => undefined)
const mockResolveOrgPermissions = jest.fn(async () => ({
  orgId: ORG,
  role: 'editor',
  isOwner: false,
  permissions: { 'data.manage': true },
  orgWide: true,
  hostRole: 'editor',
}))
let mockLastMembership: any = null

jest.mock('firebase-admin/firestore', () => ({
  __esModule: true,
  FieldValue: {
    serverTimestamp: () => ({ __serverTimestamp: true }),
    arrayUnion: (...values: unknown[]) => ({ __arrayUnion: values }),
    increment: (operand: number) => ({ __increment: operand }),
    delete: () => ({ __delete: true }),
  },
}))

jest.mock('@aglyn/aglyn/server', () => ({
  __esModule: true,
  registerPluginApiRoute: jest.fn(),
  ...jest.requireActual('@aglyn/aglyn/app-utils/plan-entitlements'),
  ...jest.requireActual('@aglyn/aglyn/app-utils/contacts'),
  ...jest.requireActual('@aglyn/aglyn/app-utils/consent-groups'),
  ...jest.requireActual('@aglyn/aglyn/app-utils/crm'),
  ...jest.requireActual('@aglyn/aglyn/app-utils/form-abuse-ceiling'),
  ...jest.requireActual('@aglyn/aglyn/app-utils/marketing-consent'),
  ...jest.requireActual('@aglyn/aglyn/app-utils/person-key'),
  ...jest.requireActual('@aglyn/aglyn/app-utils/scope-tokens'),
  ...jest.requireActual('@aglyn/aglyn/app-utils/visitor-record-ceiling'),
  get LEADS_MAX_PER_HOST() {
    return leadCeiling
  },
}))

jest.mock(
  '../../../../../tenant/data/admin/src/lib/server/campaign-conversion-attribution',
  () => ({
    __esModule: true,
    attributeCampaignConversion: jest.fn(async () => undefined),
  }),
)
jest.mock('../../../../../tenant/data/admin/src/lib/server/notifications', () => ({
  __esModule: true,
  notifyHostManagers: jest.fn(async () => undefined),
}))

jest.mock('@aglyn/tenant-runtime/org-permissions', () => ({
  resolveOrgPermissions: async (...args: unknown[]) =>
    (mockLastMembership = await (mockResolveOrgPermissions as any)(...args)),
}))

jest.mock('@aglyn/tenant-data-admin', () => ({
  __esModule: true,
  firebaseAdmin: {
    app: () => ({
      auth: () => ({ verifyIdToken: async () => ({ uid: CALLER, email: 'ed@example.com' }) }),
      firestore: () => fakeFirestore,
    }),
  },
  getOrgForHost: async (hostId: string) => (hostId === HOST ? { orgId: ORG, org } : null),
  resolveOrgMembership: async (uid: string, orgId: string) =>
    mockLastMembership?.orgId === orgId
      ? { orgId, member: { $id: uid, role: mockLastMembership.role } }
      : null,
  memberHasOrgPermission: async (_orgId: string, _member: unknown, permission: string) =>
    mockLastMembership?.permissions?.[permission] === true,
  logHostActivity: (...args: unknown[]) => mockLogHostActivity(...(args as [])),
  // The real capture door — see the file docblock.
  ...jest.requireActual(
    '../../../../../tenant/data/admin/src/lib/server/host-visitor-records',
  ),
}))

import { personKey, readMarketingBasis, soloConsentGroup } from '@aglyn/aglyn/server'
import { leadCreateHandler } from './lead-create'

async function call(body: unknown, options: { method?: string; token?: string | null } = {}) {
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
  await leadCreateHandler(req, res)
  return { status, body: answer, headers }
}

const leadAt = (email: string) => docs.get(`hosts/${HOST}/leads/${personKey(email)}`)
const leadPaths = () => [...docs.keys()].filter((path) => path.includes('/leads/'))

beforeEach(() => {
  docs.clear()
  autoId = 0
  org = { plan: 'starter' }
  leadCeiling = 200_000
  mockLogHostActivity.mockClear()
  mockResolveOrgPermissions.mockClear()
  mockResolveOrgPermissions.mockResolvedValue({
    orgId: ORG,
    role: 'editor',
    isOwner: false,
    permissions: { 'data.manage': true },
    orgWide: true,
    hostRole: 'editor',
  } as never)
})

describe('the request shape and the gates', () => {
  it('answers only POST, and needs a site, an address and a bearer token', async () => {
    const wrong = await call({ hostId: HOST, email: 'a@b.com' }, { method: 'GET' })
    expect(wrong.status).toBe(405)
    expect(wrong.headers['Allow']).toBe('POST')
    expect((await call({ email: 'a@b.com' })).status).toBe(400)
    expect((await call({ hostId: HOST, email: 'nope' })).status).toBe(400)
    expect((await call({ hostId: HOST, email: 'a@b.com' }, { token: null })).status).toBe(401)
    expect(leadPaths()).toEqual([])
  })

  it('needs a role on the site and data.manage, and a plan that carries the suite', async () => {
    mockResolveOrgPermissions.mockResolvedValueOnce({
      orgId: ORG,
      role: 'editor',
      isOwner: false,
      permissions: { 'data.manage': true },
      orgWide: true,
      hostRole: null,
    } as never)
    expect((await call({ hostId: HOST, email: 'a@b.com' })).status).toBe(403)
    mockResolveOrgPermissions.mockResolvedValueOnce({
      orgId: ORG,
      role: 'editor',
      isOwner: false,
      permissions: { 'data.manage': false },
      orgWide: true,
      hostRole: 'editor',
    } as never)
    expect((await call({ hostId: HOST, email: 'a@b.com' })).status).toBe(403)
    org = { plan: 'free' }
    const free = await call({ hostId: HOST, email: 'a@b.com' })
    expect(free.status).toBe(403)
    expect(free.body).toMatchObject({ reason: 'plan_required', code: 'crm' })
    expect(leadPaths()).toEqual([])
  })

  it('refuses a phone or a website it cannot store, under the field, before any write', async () => {
    const phone = await call({ hostId: HOST, email: 'a@b.com', phone: 'call me' })
    expect(phone.status).toBe(400)
    expect(phone.body.field).toBe('phone')
    const website = await call({ hostId: HOST, email: 'a@b.com', website: 'javascript:x' })
    expect(website.status).toBe(400)
    expect(website.body.field).toBe('website')
    expect((await call({ hostId: HOST, email: 'a@b.com', status: 'qualified' })).status).toBe(400)
    expect(leadPaths()).toEqual([])
  })
})

describe('what is written', () => {
  it('files the lead through the door, keyed by address, with the profile and the working state', async () => {
    const out = await call({
      hostId: HOST,
      email: '  Dana@EXAMPLE.com ',
      name: ' Dana  Marsh ',
      company: 'Acme Brands',
      jobTitle: 'CMO',
      phone: '(512) 555-0107',
      website: 'acme.com',
      leadSource: 'Sales Navigator',
      address: { city: 'Austin', country: 'us' },
      tags: ['ICP2', 'a-list'],
      status: 'working',
      ownerUid: 'rep-uid',
      notes: 'Met at the show',
    })
    expect(out.status).toBe(201)
    expect(out.body).toEqual({ leadId: personKey('dana@example.com'), created: true })
    const lead = leadAt('dana@example.com')
    expect(lead).toMatchObject({
      email: 'dana@example.com',
      name: 'Dana Marsh',
      sources: ['manual'],
      submissionCount: 1,
      capturedByHostIds: [HOST],
      company: 'Acme Brands',
      jobTitle: 'CMO',
      phone: '+15125550107',
      website: 'https://acme.com/',
      leadSource: 'Sales Navigator',
      address: { city: 'Austin', country: 'US' },
      tags: ['icp2', 'a-list'],
      status: 'working',
      ownerUid: 'rep-uid',
      notes: 'Met at the show',
    })
    // No contact, no company: the conversion's to make.
    expect([...docs.keys()].filter((path) => path.startsWith('orgs/'))).toEqual([])
    expect(lead?.['visibleTo']).toBeUndefined()
    expect(lead?.['facets']).toBeUndefined()
    // No basis: a person typed in by the team did not tick a box.
    expect(readMarketingBasis(lead ?? null, soloConsentGroup(HOST)).basis).toBe('unrecorded')
    expect(mockLogHostActivity).toHaveBeenCalledWith(
      HOST,
      { uid: CALLER, email: 'ed@example.com' },
      'Added lead',
      { type: 'lead', id: personKey('dana@example.com'), name: 'Dana Marsh' },
    )
  })

  it('updates the lead the site already holds for the address, and says so', async () => {
    docs.set(`hosts/${HOST}/leads/${personKey('dana@example.com')}`, {
      email: 'dana@example.com',
      sources: ['signup'],
      submissionCount: 1,
      firstSeenAtMs: 1,
      lastSeenAtMs: 1,
      jobTitle: 'CMO',
    })
    const out = await call({ hostId: HOST, email: 'dana@example.com', company: 'Acme' })
    expect(out.status).toBe(200)
    expect(out.body.created).toBe(false)
    expect(leadAt('dana@example.com')).toMatchObject({
      sources: ['signup', 'manual'],
      submissionCount: 2,
      jobTitle: 'CMO',
      company: 'Acme',
    })
    expect(mockLogHostActivity.mock.calls[0]?.[2]).toBe('Updated lead')
  })

  it('refuses a new person by name once the site is at the platform ceiling', async () => {
    leadCeiling = 1
    docs.set(`hosts/${HOST}/leads/${personKey('first@example.com')}`, {
      email: 'first@example.com',
    })
    const out = await call({ hostId: HOST, email: 'second@example.com' })
    expect(out.status).toBe(409)
    expect(out.body.reason).toBe('lead-ceiling')
    expect(leadAt('second@example.com')).toBeUndefined()
  })
})

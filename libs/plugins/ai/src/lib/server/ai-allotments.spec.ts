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

/**
 * The allotments door (AGL-2942): who may set whose allotment, and who may
 * read which.
 *
 * Every refusal here has a paired admission with the SAME fixture and one
 * fact changed, because a route that refused everybody would pass every
 * refusal: the manager is admitted where the member is refused, the site's
 * admin is admitted for another collaborator where they are refused for
 * themselves. The Firestore double applies writes the way the route's reads
 * see them, and every case asserts what was written, not only the status.
 */

type Doc = Record<string, unknown>

let mockDocs = new Map<string, Doc>()
let mockAutoId = 0
let mockCaller = 'manager-1'
/** `${uid}:${permission}` → granted. */
let mockGrants = new Set<string>()
const mockFeed: unknown[][] = []

function mockSnapshot(path: string) {
  return {
    id: path.split('/').pop() as string,
    ref: mockRef(path),
    exists: mockDocs.has(path),
    data: () => mockDocs.get(path),
    get: (field: string) => (mockDocs.get(path) ?? {})[field],
  }
}

function mockQuery(prefix: string, filters: Array<[string, unknown]> = []): any {
  const matches = () =>
    [...mockDocs.keys()].filter((path) => {
      if (!path.startsWith(`${prefix}/`)) return false
      if (path.slice(prefix.length + 1).includes('/')) return false
      const data = mockDocs.get(path) ?? {}
      return filters.every(([field, value]) => data[field] === value)
    })
  return {
    where: (field: string, _op: string, value: unknown) => mockQuery(prefix, [...filters, [field, value]]),
    limit: () => mockQuery(prefix, filters),
    orderBy: () => mockQuery(prefix, filters),
    get: async () => ({ docs: matches().map(mockSnapshot) }),
  }
}

function mockRef(path: string): any {
  return {
    id: path.split('/').pop(),
    path,
    collection: (name: string) => mockCollection(`${path}/${name}`),
    get: async () => mockSnapshot(path),
    set: async (data: Doc) => {
      mockDocs.set(path, { ...(mockDocs.get(path) ?? {}), ...data })
    },
  }
}

function mockCollection(prefix: string): any {
  return {
    ...mockQuery(prefix),
    doc: (id?: string) => mockRef(`${prefix}/${id ?? `auto-${++mockAutoId}`}`),
    add: async (data: Doc) => {
      const path = `${prefix}/auto-${++mockAutoId}`
      mockDocs.set(path, data)
      return mockRef(path)
    },
  }
}

const mockFirestore = {
  collection: (name: string) => mockCollection(name),
  getAll: async (...refs: Array<{ path: string }>) => refs.map((ref) => mockSnapshot(ref.path)),
  batch: () => {
    const queued: Array<() => void> = []
    const batch = {
      set: (ref: { path: string }, data: Doc) => {
        queued.push(() => mockDocs.set(ref.path, data))
        return batch
      },
      delete: (ref: { path: string }) => {
        queued.push(() => mockDocs.delete(ref.path))
        return batch
      },
      commit: async () => {
        for (const write of queued) write()
      },
    }
    return batch
  },
  runTransaction: async (fn: (tx: unknown) => Promise<unknown>) => {
    const queued: Array<() => void> = []
    const result = await fn({
      get: async (ref: { path: string }) => mockSnapshot(ref.path),
      set: (ref: { path: string }, data: Doc) => {
        queued.push(() => mockDocs.set(ref.path, { ...(mockDocs.get(ref.path) ?? {}), ...data }))
      },
    })
    for (const write of queued) write()
    return result
  },
}

jest.mock('firebase-admin/firestore', () => ({
  __esModule: true,
  FieldValue: {
    increment: (n: number) => ({ __inc: n }),
    serverTimestamp: () => '__now__',
  },
}))
jest.mock('@aglyn/aglyn/server', () => ({
  __esModule: true,
  pluginRequestFromWeb: async (request: Request) => ({
    method: request.method,
    headers: Object.fromEntries(request.headers.entries()),
    query: Object.fromEntries(new URL(request.url).searchParams.entries()),
    body: request.method === 'POST' ? await request.json() : undefined,
  }),
}))
jest.mock('@aglyn/tenant-data-admin', () => ({
  __esModule: true,
  firebaseAdmin: {
    app: () => ({
      auth: () => ({
        verifyIdToken: async () => ({ uid: mockCaller, email_verified: true }),
      }),
      firestore: () => mockFirestore,
    }),
  },
  emailUnverifiedResponse: () => Response.json({ error: 'verify' }, { status: 403 }),
  isImpersonationSession: () => false,
  resolveOrgMembership: async (uid: string, orgId: string) => {
    const member = mockDocs.get(`orgs/${orgId}/members/${uid}`)
    return member ? { orgId, member: { $id: uid, ...member } } : null
  },
  memberHasOrgPermission: async (
    _orgId: string,
    member: { $id?: string } | null,
    permission: string,
  ) => Boolean(member?.$id && mockGrants.has(`${member.$id}:${permission}`)),
}))
jest.mock('@aglyn/tenant-data-admin/server/id-token-refusal', () => ({
  __esModule: true,
  invalidIdTokenResponse: () => null,
}))
jest.mock('@aglyn/tenant-data-admin/server/organizations', () => ({
  __esModule: true,
  resolveOrgIdForHost: async (hostId: string) =>
    (mockDocs.get(`hosts/${hostId}`)?.['orgId'] as string | undefined) ?? null,
}))
jest.mock('../activity/ai-activity', () => ({
  __esModule: true,
  logAiAllotmentChanged: async (...args: unknown[]) => {
    mockFeed.push(args)
  },
}))

import { AI_MODEL_CATALOG } from '../providers/catalog'
import { GET, POST } from './ai-allotments'

const ORG = 'org-allot'
const OTHER_ORG = 'org-other'
const MODEL = AI_MODEL_CATALOG[0].id

function seed(plan = 'agency') {
  mockDocs = new Map<string, Doc>([
    [`orgs/${ORG}`, { name: 'Allot', slug: 'allot', plan }],
    [`orgs/${ORG}/members/manager-1`, { role: 'admin', allHosts: true, email: 'manager@example.test' }],
    [`orgs/${ORG}/members/member-1`, { role: 'editor', allHosts: true, displayName: 'Member One' }],
    [`orgs/${ORG}/members/site-admin`, { role: 'editor', allHosts: false, hostAccess: { 'host-a': 'admin' } }],
    [`orgs/${ORG}/members/collab-1`, { role: 'editor', allHosts: false, hostAccess: { 'host-a': 'editor', 'host-b': 'editor' } }],
    ['hosts/host-a', { orgId: ORG, displayName: 'Site A' }],
    ['hosts/host-b', { orgId: ORG, displayName: 'Site B' }],
    ['hosts/host-z', { orgId: OTHER_ORG, displayName: 'Someone else’s site' }],
  ])
  mockGrants = new Set(['manager-1:billing.manage', 'manager-1:billing.view'])
}

beforeEach(() => {
  seed()
  mockAutoId = 0
  mockCaller = 'manager-1'
  mockFeed.length = 0
  jest.spyOn(console, 'error').mockImplementation(() => undefined)
})
afterEach(() => jest.restoreAllMocks())

const post = (body: Record<string, unknown>) =>
  POST(
    new Request('https://console.example.test/api/ai/allotments', {
      method: 'POST',
      headers: { authorization: 'Bearer token', 'content-type': 'application/json' },
      body: JSON.stringify({ orgId: ORG, ...body }),
    }),
  )
const get = (params: Record<string, string>) =>
  GET(
    new Request(`https://console.example.test/api/ai/allotments?${new URLSearchParams(params)}`, {
      headers: { authorization: 'Bearer token' },
    }),
  )
const allotmentDoc = (subject: string) => mockDocs.get(`orgs/${ORG}/aiAllotments/${subject}`)

describe('who may set an allotment', () => {
  it('a manager with billing.manage sets a member’s and a site’s, and each change reaches the feed', async () => {
    const response = await post({
      set: [
        { subject: 'member:member-1', credits: 5000, mode: 'soft' },
        { subject: 'host:host-a', credits: 20000, mode: 'hard', models: [MODEL] },
      ],
    })
    expect(response.status).toBe(200)
    expect(allotmentDoc('member:member-1')).toMatchObject({
      scope: 'member',
      uid: 'member-1',
      hostId: null,
      credits: 5000,
      mode: 'soft',
      models: null,
      setBy: 'manager-1',
      alerted: null,
    })
    expect(allotmentDoc('host:host-a')).toMatchObject({ scope: 'host', hostId: 'host-a', models: [MODEL] })
    expect(mockFeed).toHaveLength(2)
  })

  it('a member without billing.manage sets nobody’s — the same write, refused, nothing stored', async () => {
    mockCaller = 'member-1'
    const response = await post({ set: [{ subject: 'member:member-1', credits: 999999 }] })
    expect(response.status).toBe(403)
    expect(allotmentDoc('member:member-1')).toBeUndefined()
  })

  it('a SITE ADMIN collaborator sets another collaborator’s allotment on their own site', async () => {
    mockCaller = 'site-admin'
    const response = await post({ set: [{ subject: 'collab:host-a:collab-1', credits: 800 }] })
    expect(response.status).toBe(200)
    expect(allotmentDoc('collab:host-a:collab-1')).toMatchObject({ uid: 'collab-1', hostId: 'host-a', mode: 'hard' })
  })

  it('…and never their own, never on another site, and never the site’s own budget', async () => {
    mockCaller = 'site-admin'
    // Their own: a site admin is a collaborator on the site too.
    mockDocs.set(`orgs/${ORG}/members/site-admin`, { role: 'editor', allHosts: false, hostAccess: { 'host-a': 'admin' } })
    const own = await post({ set: [{ subject: 'collab:host-a:site-admin', credits: 1_000_000 }] })
    expect(own.status).toBe(403)
    await expect(own.json()).resolves.toMatchObject({ code: 'own_allotment' })
    expect((await post({ set: [{ subject: 'collab:host-b:collab-1', credits: 800 }] })).status).toBe(403)
    expect((await post({ set: [{ subject: 'host:host-a', credits: 800 }] })).status).toBe(403)
    // A team member on the site is the organization's to bound, not the site's.
    expect((await post({ set: [{ subject: 'collab:host-a:member-1', credits: 800 }] })).status).toBe(403)
    expect((await post({ remove: ['member:member-1'] })).status).toBe(403)
    expect([...mockDocs.keys()].some((path) => path.includes('/aiAllotments/'))).toBe(false)
  })

  it('a manager may set their OWN member allotment — billing.manage controls the pool anyway', async () => {
    expect((await post({ set: [{ subject: 'member:manager-1', credits: 100 }] })).status).toBe(200)
  })

  it('the subject must belong: a stranger, a collaborator off the site, a site of another org', async () => {
    expect((await post({ set: [{ subject: 'member:stranger', credits: 100 }] })).status).toBe(404)
    expect((await post({ set: [{ subject: 'collab:host-b:site-admin', credits: 100 }] })).status).toBe(404)
    expect((await post({ set: [{ subject: 'host:host-z', credits: 100 }] })).status).toBe(404)
    expect([...mockDocs.keys()].some((path) => path.includes('/aiAllotments/'))).toBe(false)
  })

  it('removes an allotment', async () => {
    await post({ set: [{ subject: 'member:member-1', credits: 100 }] })
    expect((await post({ remove: ['member:member-1'] })).status).toBe(200)
    expect(allotmentDoc('member:member-1')).toBeUndefined()
  })
})

describe('the same for every client site', () => {
  it('expands on the server to every site the org has, and no site it does not', async () => {
    const response = await post({ everySite: { credits: 10000, mode: 'hard' } })
    expect(response.status).toBe(200)
    expect(allotmentDoc('host:host-a')).toMatchObject({ credits: 10000 })
    expect(allotmentDoc('host:host-b')).toMatchObject({ credits: 10000 })
    expect(allotmentDoc('host:host-z')).toBeUndefined()
  })

  it('needs billing.manage', async () => {
    mockCaller = 'site-admin'
    expect((await post({ everySite: { credits: 10000 } })).status).toBe(403)
  })

  it('gives a site its month so far from its people’s months when its map has no key yet', async () => {
    mockDocs.set(`orgs/${ORG}/aiUsageByUser/collab-1/months/${new Date().toISOString().slice(0, 7)}`, {
      credits: 900,
      byHost: { 'host-a': 700, 'host-b': 200 },
    })
    await post({ set: [{ subject: 'host:host-a', credits: 5000 }] })
    expect(
      mockDocs.get(`orgs/${ORG}/assistUsage/${new Date().toISOString().slice(0, 7)}`),
    ).toMatchObject({ byHost: { 'host-a': 700 } })
  })
})

describe('the org-wide model restriction', () => {
  it('is set on Agency and Enterprise, carries models and never credits', async () => {
    expect((await post({ set: [{ subject: 'org', models: [MODEL] }] })).status).toBe(200)
    expect(allotmentDoc('org')).toMatchObject({ scope: 'org', credits: null, models: [MODEL] })
    expect((await post({ set: [{ subject: 'org', credits: 10, models: [MODEL] }] })).status).toBe(400)
  })

  it('is refused on a plan that does not offer it, and clearing it is always allowed', async () => {
    seed('pro')
    const response = await post({ set: [{ subject: 'org', models: [MODEL] }] })
    expect(response.status).toBe(409)
    expect(allotmentDoc('org')).toBeUndefined()
    expect((await post({ remove: ['org'] })).status).toBe(200)
  })
})

describe('what a write must say', () => {
  it('refuses credits that are not a whole positive number, a model the platform does not offer, and an empty allotment', async () => {
    for (const credits of ['5000', 0, -1, 1.5e12]) {
      expect((await post({ set: [{ subject: 'member:member-1', credits }] })).status).toBe(400)
    }
    expect((await post({ set: [{ subject: 'member:member-1', models: ['no-such-model'] }] })).status).toBe(400)
    expect((await post({ set: [{ subject: 'member:member-1' }] })).status).toBe(400)
    expect((await post({ set: [{ subject: 'member:member-1', credits: 10, mode: 'sometimes' }] })).status).toBe(400)
    expect((await post({ set: [{ subject: 'user:member-1', credits: 10 }] })).status).toBe(400)
    expect(allotmentDoc('member:member-1')).toBeUndefined()
  })
})

describe('who may read', () => {
  beforeEach(async () => {
    await post({
      set: [
        { subject: 'member:member-1', credits: 5000 },
        { subject: 'collab:host-a:collab-1', credits: 800 },
        { subject: 'collab:host-b:collab-1', credits: 300 },
        { subject: 'host:host-b', credits: 900 },
      ],
    })
  })

  it('billing.view reads the whole org, with the editors’ answers', async () => {
    const response = await get({ orgId: ORG })
    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body.allotments.map((row: { subject: string }) => row.subject).sort()).toEqual([
      'collab:host-a:collab-1',
      'collab:host-b:collab-1',
      'host:host-b',
      'member:member-1',
    ])
    expect(body).toMatchObject({ orgId: ORG, canEdit: { billing: true }, restrictionAvailable: true })
  })

  it('a member without billing.view reads their own allotment and nobody else’s', async () => {
    mockCaller = 'member-1'
    expect((await get({ orgId: ORG })).status).toBe(403)
    const own = await get({ orgId: ORG, uid: 'member-1' })
    expect(own.status).toBe(200)
    expect((await own.json()).allotments).toEqual([
      expect.objectContaining({ subject: 'member:member-1', credits: 5000 }),
    ])
    expect((await get({ orgId: ORG, uid: 'collab-1' })).status).toBe(403)
  })

  it('a site’s admin reads their site from the site alone, and cannot read another site', async () => {
    mockCaller = 'site-admin'
    const response = await get({ hostId: 'host-a' })
    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body.orgId).toBe(ORG)
    expect(body.allotments.map((row: { subject: string }) => row.subject)).toEqual(['collab:host-a:collab-1'])
    expect(body.canEdit).toEqual({ billing: false, collaborators: true })
    expect((await get({ hostId: 'host-b' })).status).toBe(403)
  })
})

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
 * Where a plugin runs across a workspace's sites (AGL-4047): the route writes
 * each site's own deny-list, in one transaction that reads the workspace's
 * sites, asks today's keys, refuses what would strand a plugin, and drops the
 * sites that moved.
 */

export {}

/** Every document, keyed by its full path. */
let mockDocs = new Map<string, Record<string, unknown>>()
/** Keys the member holds on the workspace, and per site. */
let mockOrgKeys: string[] = []
let mockSiteKeys: Record<string, string[]> = {}
let mockStaff = false
let mockLocked: Response | null = null
const mockDrops: Array<{ hostIds: string[]; plugins: unknown }> = []
const mockActivity: string[] = []

function mockSnapshot(path: string) {
  const data = mockDocs.get(path)
  return {
    id: path.split('/').pop(),
    exists: data !== undefined,
    data: () => data,
    get: (field: string) => data?.[field],
  }
}

function mockFirestore() {
  const doc = (path: string) => ({ path, id: path.split('/').pop() })
  return {
    collection: (name: string) => ({ doc: (id: string) => doc(`${name}/${id}`) }),
    runTransaction: async <T>(body: (tx: unknown) => Promise<T>): Promise<T> => {
      const writes: Array<() => void> = []
      const result = await body({
        get: async (ref: { path: string }) => mockSnapshot(ref.path),
        getAll: async (...refs: Array<{ path: string }>) => refs.map((ref) => mockSnapshot(ref.path)),
        update: (ref: { path: string }, data: Record<string, unknown>) => {
          writes.push(() => mockDocs.set(ref.path, { ...mockDocs.get(ref.path), ...data }))
        },
      })
      for (const write of writes) write()
      return result
    },
  }
}

jest.mock('../../../../utils/server/tenant-revalidate', () => ({
  __esModule: true,
  dropSiteCaches: async (_firestore: unknown, options: { hostIds: string[]; plugins: unknown }) => {
    mockDrops.push({ hostIds: [...options.hostIds], plugins: options.plugins })
    return { hosts: [], hostsDropped: 0, lost: 0 }
  },
}))

jest.mock('@aglyn/aglyn/server', () => ({
  __esModule: true,
  pluginRequestFromWeb: async (request: Request) => ({
    method: request.method,
    body: await request.json(),
    headers: Object.fromEntries(request.headers),
  }),
}))

jest.mock('@aglyn/tenant-data-admin', () => ({
  __esModule: true,
  firebaseAdmin: {
    app: () => ({
      auth: () => ({
        verifyIdToken: async (token: string) => {
          if (token === 'expired') {
            throw Object.assign(new Error('expired'), { code: 'auth/id-token-expired' })
          }
          return { uid: 'u1', email: 'u1@example.test', email_verified: true, staff: mockStaff }
        },
      }),
      firestore: () => mockFirestore(),
    }),
    firestore: { FieldValue: { serverTimestamp: () => '__now__' } },
  },
  emailUnverifiedResponse: () => Response.json({ error: 'Verify your email' }, { status: 403 }),
  getOrgDoc: async (orgId: string) => mockDocs.get(`orgs/${orgId}`) ?? null,
  isImpersonationSession: () => false,
  lockdownRefusal: async () => mockLocked,
  logOrgActivity: async (_orgId: string, _actor: unknown, text: string) => {
    mockActivity.push(text)
  },
  resolveOrgMembership: async () => ({ orgId: 'o1', member: { role: 'admin', allHosts: true } }),
  memberHasOrgPermission: async (_orgId: string, _member: unknown, key: string) => mockOrgKeys.includes(key),
  memberHasPermissionOnHost: async (_orgId: string, hostId: string, _member: unknown, key: string) =>
    (mockSiteKeys[hostId] ?? []).includes(key),
}))

import { POST } from './route'

const post = (body: Record<string, unknown>, token = 'token') =>
  POST(
    new Request('https://console.test/api/orgs/plugin-sites', {
      method: 'POST',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify({ orgId: 'o1', ...body }),
    }),
  )

const disabled = (hostId: string) => mockDocs.get(`hosts/${hostId}`)?.['disabledPlugins']

beforeEach(() => {
  mockDocs = new Map<string, Record<string, unknown>>([
    ['orgs/o1', { enabledPlugins: ['crm', 'commerce', 'accounts', 'bookings'], hosts: { a: true, b: true, c: true } }],
    ['hosts/a', { orgId: 'o1', displayName: 'Bakery', enabledPlugins: ['accounts'] }],
    ['hosts/b', { orgId: 'o1', displayName: 'Cafe', disabledPlugins: ['bookings'] }],
    ['hosts/c', { orgId: 'o1', subdomain: 'deli' }],
  ])
  mockOrgKeys = ['org.settings']
  mockSiteKeys = { a: ['site.manage'], b: ['site.manage'], c: ['site.manage'] }
  mockStaff = false
  mockLocked = null
  mockDrops.length = 0
  mockActivity.length = 0
})

describe('POST /api/orgs/plugin-sites', () => {
  it('leaves sites out by writing their own deny-lists, and drops just those sites', async () => {
    const response = await post({ pluginId: 'crm', choice: { mode: 'allExcept', exceptHostIds: ['b', 'c'] } })
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ ok: true, leftOutHostIds: ['b', 'c'], broughtBackHostIds: [] })
    expect(disabled('a')).toBeUndefined()
    expect(disabled('b')).toEqual(['bookings', 'crm'])
    expect(disabled('c')).toEqual(['crm'])
    expect(mockDocs.get('hosts/b')?.['updatedAt']).toBe('__now__')
    expect(mockDrops).toEqual([{ hostIds: ['b', 'c'], plugins: 'host' }])
    expect(mockActivity).toEqual(['Set crm to run on all sites except 2'])
  })

  it('All sites takes the plugin back out of every deny-list, keeping the others', async () => {
    const response = await post({ pluginId: 'bookings', choice: { mode: 'all' } })
    expect(await response.json()).toEqual({ ok: true, leftOutHostIds: [], broughtBackHostIds: ['b'] })
    expect(disabled('b')).toEqual([])
  })

  it('writes and drops nothing when the sites already say it', async () => {
    const response = await post({ pluginId: 'bookings', choice: { mode: 'allExcept', exceptHostIds: ['b'] } })
    expect(response.status).toBe(200)
    expect(mockDrops).toEqual([])
    expect(mockActivity).toEqual([])
  })

  it('never touches a site’s opt-in list: a deny beats User Accounts’ opt-in', async () => {
    await post({ pluginId: 'accounts', choice: { mode: 'allExcept', exceptHostIds: ['a'] } })
    expect(mockDocs.get('hosts/a')).toMatchObject({ enabledPlugins: ['accounts'], disabledPlugins: ['accounts'] })
  })

  it('refuses leaving Commerce out where User Accounts runs, naming the site, and writes nothing', async () => {
    const response = await post({ pluginId: 'commerce', choice: { mode: 'allExcept', exceptHostIds: ['a', 'c'] } })
    expect(response.status).toBe(400)
    const body = await response.json()
    expect(body.error).toBe(
      'User Accounts on Bakery needs Commerce. Switch it off on that site first, or keep the site in.',
    )
    expect(body.stranded).toEqual([{ hostId: 'a', pluginId: 'accounts', missing: ['commerce'] }])
    expect(disabled('c')).toBeUndefined()
    expect(mockDrops).toEqual([])
  })

  it('refuses leaving every site out, and leaving none out', async () => {
    const every = await post({ pluginId: 'crm', choice: { mode: 'allExcept', exceptHostIds: ['a', 'b', 'c'] } })
    expect(every.status).toBe(400)
    expect((await every.json()).error).toMatch(/^Keep at least one site in/)
    const none = await post({ pluginId: 'crm', choice: { mode: 'allExcept', exceptHostIds: [] } })
    expect(none.status).toBe(400)
    expect(mockDocs.get('hosts/a')?.['disabledPlugins']).toBeUndefined()
  })

  it('refuses Selected sites, which an ordinary plugin does not offer', async () => {
    const response = await post({ pluginId: 'crm', choice: { mode: 'selected', hostIds: ['a'] } })
    expect(response.status).toBe(400)
  })

  it('refuses the base library and an id that is not a built-in plugin', async () => {
    const base = await post({ pluginId: 'mui', choice: { mode: 'allExcept', exceptHostIds: ['a'] } })
    expect(base.status).toBe(400)
    expect((await base.json()).error).toMatch(/can’t be left out/)
    const listing = await post({ pluginId: 'listing-123', choice: { mode: 'all' } })
    expect(listing.status).toBe(400)
  })

  it('drops a site the workspace doesn’t hold, and never writes one another workspace holds', async () => {
    mockDocs.set('hosts/c', { orgId: 'o2' })
    const response = await post({ pluginId: 'crm', choice: { mode: 'allExcept', exceptHostIds: ['b', 'c', 'z'] } })
    expect(await response.json()).toEqual({ ok: true, leftOutHostIds: ['b'], broughtBackHostIds: [] })
    expect(mockDocs.get('hosts/c')).toEqual({ orgId: 'o2' })
  })

  it('a site added after the choice has no entry, so it runs the plugin', async () => {
    await post({ pluginId: 'crm', choice: { mode: 'allExcept', exceptHostIds: ['b'] } })
    mockDocs.set('hosts/d', { orgId: 'o1' })
    mockDocs.set('orgs/o1', { ...mockDocs.get('orgs/o1'), hosts: { a: true, b: true, c: true, d: true } })
    const { pluginRunsOnOf } = jest.requireActual(
      '../../../../../../libs/aglyn/src/lib/plugin-manager/plugin-site-exclusions',
    )
    const sites = ['a', 'b', 'c', 'd'].map((id) => ({ id, ...mockDocs.get(`hosts/${id}`) }))
    expect(pluginRunsOnOf('crm', sites)).toEqual({ mode: 'allExcept', exceptHostIds: ['b'] })
  })

  it('asks "Organization settings" first, naming it', async () => {
    mockOrgKeys = []
    const response = await post({ pluginId: 'crm', choice: { mode: 'allExcept', exceptHostIds: ['b'] } })
    expect(response.status).toBe(403)
    expect((await response.json()).error).toBe(
      'Your role does not include "Organization settings" — ask an organization admin',
    )
    expect(disabled('b')).toEqual(['bookings'])
  })

  it('asks "Manage site settings" on each site whose entry changes, and writes nothing if one says no', async () => {
    mockSiteKeys = { a: ['site.manage'], b: ['site.manage'] }
    const response = await post({ pluginId: 'crm', choice: { mode: 'allExcept', exceptHostIds: ['b', 'c'] } })
    expect(response.status).toBe(403)
    expect((await response.json()).error).toBe(
      'On deli: Your role does not include "Manage site settings" — ask an organization admin',
    )
    expect(disabled('b')).toEqual(['bookings'])
    expect(mockDrops).toEqual([])
  })

  it('does not ask a site whose entry does not change', async () => {
    mockSiteKeys = { b: ['site.manage'] }
    const response = await post({ pluginId: 'crm', choice: { mode: 'allExcept', exceptHostIds: ['b'] } })
    expect(response.status).toBe(200)
  })

  it('lets staff through both keys, as the workspace switch does', async () => {
    mockStaff = true
    mockOrgKeys = []
    mockSiteKeys = {}
    const response = await post({ pluginId: 'crm', choice: { mode: 'allExcept', exceptHostIds: ['b'] } })
    expect(response.status).toBe(200)
  })

  it('answers a lockdown before writing', async () => {
    mockLocked = Response.json({ error: 'locked' }, { status: 423 })
    const response = await post({ pluginId: 'crm', choice: { mode: 'allExcept', exceptHostIds: ['b'] } })
    expect(response.status).toBe(423)
    expect(disabled('b')).toEqual(['bookings'])
  })

  it('answers a refused credential with 401, not a fault', async () => {
    const response = await post({ pluginId: 'crm', choice: { mode: 'all' } }, 'expired')
    expect(response.status).toBe(401)
  })
})

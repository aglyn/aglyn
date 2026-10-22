/**
 * @jest-environment node
 *
 * Pragma must stay in the FIRST block comment — behind the license header it
 * is silently ignored and the suite runs on jsdom.
 *
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

import { hasOrgPermission as mockHasOrgPermission } from '@aglyn/aglyn'

/**
 * A create that claimed its site and then failed (AGL-3734).
 *
 * On 2026-10-08 14:20Z `POST /api/hosts/create` answered 500 after 4.2s.
 * The claim transaction had committed, so the host doc existed and held the
 * subdomain. The registration after it (`registerOrgHost`) then failed, on an
 * emoji name's lone-surrogate search token (AGL-3689). The caller saw "Site
 * creation failed". Their retry got 409 on their OWN address, and the next
 * name hit the Free site limit, which the half-made site was already using.
 *
 * Pinned here:
 * - a transient registration failure is retried once and the create succeeds;
 * - a registration that still fails answers with copy that says the site
 *   exists, carries its `hostId`, and is REPORTED with that id;
 * - a retry of the same address FINISHES that site (200, same `hostId`, no
 *   second site), instead of a 409;
 * - only the caller's own org's recent, unregistered site is resumed: a
 *   finished site, or another org's, still answers 409;
 * - a transient failure before anything was claimed answers 503 and is
 *   reported too.
 */

export {}

let mockDocs = new Map<string, Record<string, unknown>>()

/** Faithful `increment`-free merge semantics; maps deep-merge as Firestore does. */
function mockMerge(
  existing: Record<string, unknown> | undefined,
  data: Record<string, unknown>,
  merge: boolean,
): Record<string, unknown> {
  const base = merge ? { ...(existing ?? {}) } : {}
  for (const [key, value] of Object.entries(data)) {
    if (
      merge &&
      value &&
      typeof value === 'object' &&
      !Array.isArray(value) &&
      base[key] &&
      typeof base[key] === 'object'
    ) {
      base[key] = { ...(base[key] as object), ...(value as object) }
    } else {
      base[key] = value
    }
  }
  return base
}

/** Serialises transactions FIFO — real Firestore gets there by retry. */
let mockTxChain: Promise<void> = Promise.resolve()
function mockTxLock(): Promise<() => void> {
  let release!: () => void
  const next = new Promise<void>((resolve) => {
    release = resolve
  })
  const waitFor = mockTxChain
  mockTxChain = mockTxChain.then(() => next)
  return waitFor.then(() => release)
}

function mockMakeFirestore() {
  const makeDoc = (path: string): any => ({
    path,
    id: path.split('/').pop(),
    // The home page a site is created with lives under it (AGL-3408).
    collection: (name: string) => makeCollection(`${path}/${name}`),
    get: async () => ({
      exists: mockDocs.has(path),
      data: () => mockDocs.get(path),
      get: (field: string) => (mockDocs.get(path) ?? {})[field],
    }),
    set: async (
      data: Record<string, unknown>,
      options?: { merge?: boolean },
    ) => {
      mockDocs.set(path, mockMerge(mockDocs.get(path), data, Boolean(options?.merge)))
    },
  })
  const makeQuery = (prefix: string, field?: string, value?: unknown) => ({
    where: (nextField: string, _op: string, nextValue: unknown) =>
      makeQuery(prefix, nextField, nextValue),
    limit: () => makeQuery(prefix, field, value),
    get: async () => {
      const docs = [...mockDocs.entries()].filter(
        ([path, data]) =>
          path.startsWith(`${prefix}/`) &&
          path.split('/').length === 2 &&
          (!field || data[field] === value),
      )
      // Query results are SNAPSHOTS, whose `get(field)` is synchronous.
      return {
        empty: docs.length === 0,
        docs: docs.map(([path, data]) => ({
          id: path.split('/').pop(),
          ref: makeDoc(path),
          data: () => data,
          get: (field: string) => data[field],
        })),
      }
    },
    count: () => ({
      get: async () => {
        const n = [...mockDocs.entries()].filter(
          ([path, data]) =>
            path.startsWith(`${prefix}/`) &&
            path.split('/').length === 2 &&
            (!field || data[field] === value),
        ).length
        return { data: () => ({ count: n }) }
      },
    }),
  })
  const makeCollection = (prefix: string) => ({
    doc: (id: string) => makeDoc(`${prefix}/${id}`),
    where: (field: string, _op: string, value: unknown) =>
      makeQuery(prefix, field, value),
  })
  return {
    collection: (name: string) => makeCollection(name),
    runTransaction: async <T,>(fn: (tx: unknown) => Promise<T>): Promise<T> => {
      const release = await mockTxLock()
      try {
        const queued: Array<() => void> = []
        const tx = {
          /**
           * Overloaded exactly as the real `Transaction.get` is — a document
           * reference or a QUERY. `claimHostForOrg` re-reads subdomain
           * uniqueness inside this transaction (AGL-2465); a query has no
           * `path`, and it reads COMMITTED state, since `queued` below is not
           * applied until commit. That is what lets the loser of a race see
           * the winner's host, the same way it already sees the winner's entry
           * in the org directory map.
           */
          get: async (target: { path?: string; get?: () => Promise<unknown> }) => {
            if (!target?.path && typeof target?.get === 'function') {
              return await target.get()
            }
            const ref = target as { path: string }
            return {
              exists: mockDocs.has(ref.path),
              data: () => mockDocs.get(ref.path),
              get: (field: string) => (mockDocs.get(ref.path) ?? {})[field],
            }
          },
          set: (
            ref: { path: string },
            data: Record<string, unknown>,
            options?: { merge?: boolean },
          ) => {
            queued.push(() => {
              mockDocs.set(
                ref.path,
                mockMerge(mockDocs.get(ref.path), data, Boolean(options?.merge)),
              )
            })
          },
        }
        const result = await fn(tx)
        for (const write of queued) write()
        return result
      } finally {
        release()
      }
    },
  }
}

const mockVerifyIdToken = jest.fn(async () => ({
  uid: 'user-1',
  email: 'a@example.com',
  email_verified: true,
}))

const mockReportServerError = jest.fn(async () => 'written' as const)

/** `registerOrgHost`, modelled: it writes the `hostIndex` row a finished site has. */
const mockRegisterOrgHost = jest.fn(
  async (orgId: string, hostId: string, subdomain?: string) => {
    mockDocs.set(`hostIndex/${hostId}`, { orgId, subdomain })
  },
)

let mockClock = Date.now()

jest.mock('@aglyn/tenant-data-admin', () => ({
  __esModule: true,
  reportServerError: mockReportServerError,
  firebaseAdmin: {
    app: () => ({
      auth: () => ({ verifyIdToken: mockVerifyIdToken }),
      firestore: () => mockMakeFirestore(),
    }),
    firestore: {
      FieldValue: { serverTimestamp: () => ({ toMillis: () => mockClock }) },
    },
  },
  isImpersonationSession: () => false,
  emailUnverifiedResponse: () =>
    Response.json({ error: 'unverified' }, { status: 403 }),
  resolveOrgMembership: async (_uid: string, orgId: string) => ({
    orgId,
    member: { role: 'owner' },
  }),
  ensureOrgForUser: async () => ({ orgId: 'org-1', member: { role: 'owner' } }),
  freeWorkspaceCapRefusalResponse: () => null,
  logHostActivity: async () => undefined,
  lockdownRefusal: async () => null,
  registerOrgHost: (orgId: string, hostId: string, subdomain?: string) =>
    mockRegisterOrgHost(orgId, hostId, subdomain),
  memberHasOrgPermission: async (
    _orgId: string,
    member: Record<string, unknown> | null | undefined,
    permission: string,
  ) => mockHasOrgPermission(member as never, permission as never, null),
  consumeRateLimit: async () => ({
    allowed: true,
    limit: 20,
    remaining: 19,
    resetMs: Date.now() + 60 * 60 * 1000,
    degraded: false,
  }),
}))

// The moved server routines import these modules directly, which the index mock
// above does not reach; each hands back the index mock's value.
jest.mock('@aglyn/tenant-data-admin/server/firebase-admin', () => ({
  ...jest.requireActual('@aglyn/tenant-data-admin/server/firebase-admin'),
  get firebaseAdmin() {
    return jest.requireMock('@aglyn/tenant-data-admin').firebaseAdmin
  },
  get isImpersonationSession() {
    return jest.requireMock('@aglyn/tenant-data-admin').isImpersonationSession
  },
  get emailUnverifiedResponse() {
    return jest.requireMock('@aglyn/tenant-data-admin').emailUnverifiedResponse
  },
}))
jest.mock('@aglyn/tenant-data-admin/server/organizations', () => ({
  ...jest.requireActual('@aglyn/tenant-data-admin/server/organizations'),
  get resolveOrgMembership() {
    return jest.requireMock('@aglyn/tenant-data-admin').resolveOrgMembership
  },
  get ensureOrgForUser() {
    return jest.requireMock('@aglyn/tenant-data-admin').ensureOrgForUser
  },
  get logHostActivity() {
    return jest.requireMock('@aglyn/tenant-data-admin').logHostActivity
  },
  get registerOrgHost() {
    return jest.requireMock('@aglyn/tenant-data-admin').registerOrgHost
  },
  get memberHasOrgPermission() {
    return jest.requireMock('@aglyn/tenant-data-admin').memberHasOrgPermission
  },
}))
jest.mock('@aglyn/tenant-data-admin/server/lockdown', () => ({
  ...jest.requireActual('@aglyn/tenant-data-admin/server/lockdown'),
  get lockdownRefusal() {
    return jest.requireMock('@aglyn/tenant-data-admin').lockdownRefusal
  },
}))
jest.mock('@aglyn/tenant-data-admin/server/rate-limit-store', () => ({
  ...jest.requireActual('@aglyn/tenant-data-admin/server/rate-limit-store'),
  get consumeRateLimit() {
    return jest.requireMock('@aglyn/tenant-data-admin').consumeRateLimit
  },
}))

const { POST } = require('../app/api/hosts/create/route') as {
  POST: (request: Request) => Promise<Response>
}

const ORG = 'org-1'

const create = (subdomain: string, displayName = 'Nova Library') =>
  POST(
    new Request('https://console.aglyn.com/api/hosts/create', {
      method: 'POST',
      headers: {
        authorization: 'Bearer token',
        'content-type': 'application/json',
      },
      body: JSON.stringify({ displayName, subdomain, orgId: ORG }),
    }),
  )

const siteIds = () =>
  [...mockDocs.keys()]
    .filter((path) => path.startsWith('hosts/') && path.split('/').length === 2)
    .map((path) => path.split('/')[1])

/** A Firestore error as the admin SDK raises it: a numeric gRPC code. */
const grpcError = (code: number, message: string) =>
  Object.assign(new Error(message), { code })

let logged: jest.SpyInstance

beforeEach(() => {
  mockDocs = new Map()
  mockTxChain = Promise.resolve()
  mockClock = Date.now()
  mockRegisterOrgHost.mockClear()
  mockReportServerError.mockClear()
  mockDocs.set(`orgs/${ORG}`, { plan: 'free', slug: 'acme' })
  logged = jest.spyOn(console, 'error').mockImplementation(() => undefined)
})

afterEach(() => {
  logged.mockRestore()
})

describe('a registration that fails after the claim (AGL-3734)', () => {
  it('retries a transient failure once and the create succeeds', async () => {
    mockRegisterOrgHost.mockRejectedValueOnce(grpcError(14, '14 UNAVAILABLE'))
    const response = await create('nova-library')
    expect(response.status).toBe(200)
    const body = await response.json()
    expect(siteIds()).toEqual([body.hostId])
    expect(mockRegisterOrgHost).toHaveBeenCalledTimes(2)
    expect(mockReportServerError).not.toHaveBeenCalled()
  })

  it('says the site exists, and reports which one, when registration keeps failing', async () => {
    mockRegisterOrgHost.mockRejectedValueOnce(
      grpcError(3, '3 INVALID_ARGUMENT: invalid UTF-8'),
    )
    const response = await create('nova-library')
    expect(response.status).toBe(500)
    const body = await response.json()
    expect(body.hostId).toBe(siteIds()[0])
    expect(String(body.error)).toContain('was created')
    // A non-transient failure is not retried.
    expect(mockRegisterOrgHost).toHaveBeenCalledTimes(1)
    expect(mockReportServerError).toHaveBeenCalledWith(
      expect.objectContaining({
        route: '/api/hosts/create',
        message: expect.stringContaining(body.hostId),
        stack: expect.stringContaining('INVALID_ARGUMENT'),
      }),
      { service: 'console-web' },
    )
  })

  it('FINISHES that site on retry: 200, same hostId, no second site, no 409', async () => {
    mockRegisterOrgHost.mockRejectedValueOnce(grpcError(3, '3 INVALID_ARGUMENT'))
    const first = await (await create('nova-library')).json()

    const retry = await create('nova-library')
    expect(retry.status).toBe(200)
    await expect(retry.json()).resolves.toMatchObject({
      hostId: first.hostId,
      subdomain: 'nova-library',
      orgSlug: 'acme',
      orgCreated: false,
    })
    expect(siteIds()).toEqual([first.hostId])
    expect(mockDocs.has(`hostIndex/${first.hostId}`)).toBe(true)
  })

  it('still answers 409 for a FINISHED site of the same org', async () => {
    expect((await create('nova-library')).status).toBe(200)
    const again = await create('nova-library')
    expect(again.status).toBe(409)
  })

  it('still answers 409 for another org’s unfinished site', async () => {
    mockDocs.set('hosts/theirs', {
      orgId: 'org-2',
      subdomain: 'nova-library',
      createdAt: { toMillis: () => mockClock },
    })
    const response = await create('nova-library')
    expect(response.status).toBe(409)
    expect(mockRegisterOrgHost).not.toHaveBeenCalled()
  })

  it('does not resume an unregistered site older than the window', async () => {
    mockDocs.set('hosts/old', {
      orgId: ORG,
      subdomain: 'nova-library',
      createdAt: { toMillis: () => mockClock - 2 * 60 * 60 * 1000 },
    })
    expect((await create('nova-library')).status).toBe(409)
    expect(mockRegisterOrgHost).not.toHaveBeenCalled()
  })
})

describe('a transient failure before anything was claimed (AGL-3734)', () => {
  it('answers 503 with copy the dialog can show, and reports it', async () => {
    // The harness creates fine: the 503 below is the failure, not the setup.
    expect((await create('busy-site')).status).toBe(200)

    mockVerifyIdToken.mockRejectedValueOnce(grpcError(10, '10 ABORTED: contention'))
    const busy = await create('busy-two')
    expect(busy.status).toBe(503)
    expect(busy.headers.get('Retry-After')).toBe('5')
    expect(String((await busy.json()).error)).toContain('try again')
    expect(mockReportServerError).toHaveBeenCalledWith(
      expect.objectContaining({ message: '10 ABORTED: contention' }),
      { service: 'console-web' },
    )
  })
})

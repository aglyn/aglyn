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

/**
 * The applied-edit record (AGL-2906): every rung forced red once, and the
 * one green path writes exactly one `ai.edit.applied` row. The load-bearing
 * cases are the evidence checks — a report is recorded only when it stands
 * on a proposal the server issued to the same member about the same
 * document, and a second report for the same exchange writes nothing.
 */

export {}

let mockDocs = new Map<string, Record<string, unknown>>()
let mockFlagOn = true
let mockPermitted = true
let mockLocked: Response | null = null
let mockRateAllowed = true
const mockHostRows: Array<[string, unknown, string, unknown]> = []
const mockVerifyIdToken = jest.fn()

function mockFirestore() {
  const doc = (path: string) => ({
    path,
    collection: (name: string) => ({ doc: (id: string) => doc(`${path}/${name}/${id}`) }),
    get: async () => ({ exists: mockDocs.has(path), data: () => mockDocs.get(path) }),
  })
  return {
    collection: (name: string) => ({ doc: (id: string) => doc(`${name}/${id}`) }),
    runTransaction: async (fn: (tx: unknown) => Promise<unknown>) => {
      const queued: Array<() => void> = []
      const tx = {
        get: async (ref: { path: string }) => ({
          exists: mockDocs.has(ref.path),
          data: () => mockDocs.get(ref.path),
        }),
        update: (ref: { path: string }, data: Record<string, unknown>) => {
          queued.push(() => mockDocs.set(ref.path, { ...(mockDocs.get(ref.path) ?? {}), ...data }))
        },
      }
      const result = await fn(tx)
      for (const write of queued) write()
      return result
    },
  }
}

jest.mock('firebase-admin/firestore', () => ({
  __esModule: true,
  FieldValue: { serverTimestamp: () => '__now__' },
}))

jest.mock('@aglyn/tenant-data-admin/server/organizations', () => ({
  __esModule: true,
  logHostActivity: async (hostId: string, actor: unknown, action: string, target: unknown) => {
    mockHostRows.push([hostId, actor, action, target])
  },
  logOrgActivity: async () => undefined,
}))

jest.mock('@aglyn/tenant-data-admin', () => ({
  __esModule: true,
  firebaseAdmin: {
    app: () => ({
      auth: () => ({ verifyIdToken: (...args: unknown[]) => mockVerifyIdToken(...args) }),
      firestore: () => mockFirestore(),
    }),
  },
  emailUnverifiedResponse: () => Response.json({ error: 'Verify your email' }, { status: 403 }),
  isImpersonationSession: () => false,
  getOrgForUser: async (uid: string, orgId: string) =>
    mockDocs.has(`orgs/${orgId}`) ? { orgId, org: mockDocs.get(`orgs/${orgId}`), member: { $id: uid } } : null,
  memberHasPermissionOnHost: async () => mockPermitted,
  permissionRefusal: (permission: string) =>
    Response.json({ error: `Your role does not include ${permission}`, reason: 'permission' }, { status: 403 }),
  isServerReleaseFlagOnForOrg: async () => mockFlagOn,
  lockdownRefusal: async () => mockLocked,
  checkRateLimit: () => ({ allowed: mockRateAllowed, limit: 30, remaining: 0, resetMs: 0 }),
  rateLimitHeaders: () => ({ 'X-RateLimit-Limit': '30' }),
}))

const { POST } = require('./assist-edit-applied') as {
  POST: (request: Request) => Promise<Response>
}

const ORG = 'org-1'
const REPORT = {
  orgId: ORG,
  hostId: 'host-1',
  exchangeId: 'exchange-1',
  documentKind: 'screen',
  documentId: 'screen-1',
  versionId: 'v-2',
  opCounts: { set: 2, insert: 1 },
}

function post(body: unknown, token: string | null = 'token'): Request {
  return new Request('https://app.aglyn.com/api/assist/edit-applied', {
    method: 'POST',
    headers: {
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      'content-type': 'application/json',
    },
    body: JSON.stringify(body),
  })
}

beforeEach(() => {
  mockDocs = new Map()
  mockFlagOn = true
  mockPermitted = true
  mockLocked = null
  mockRateAllowed = true
  mockHostRows.length = 0
  mockVerifyIdToken.mockReset()
  mockVerifyIdToken.mockResolvedValue({ uid: 'user-1', email: 'author@example.test', email_verified: true })
  mockDocs.set(`orgs/${ORG}`, { plan: 'pro' })
  mockDocs.set(`orgs/${ORG}/assistExchanges/exchange-1`, { uid: 'user-1', hostId: 'host-1' })
  mockDocs.set(`orgs/${ORG}/assistSignals/exchange-1`, {
    route: '/acme/hosts/host-1/screens/screen-1/versions/v-1/besigner',
    editOps: 3,
  })
  jest.spyOn(console, 'error').mockImplementation(() => undefined)
})

afterEach(() => jest.restoreAllMocks())

describe('the ladder — every rung forced red once', () => {
  it('405 for anything but POST, 401 without a token', async () => {
    expect((await POST(new Request('https://x.test', { method: 'GET' }))).status).toBe(405)
    expect((await POST(post(REPORT, null))).status).toBe(401)
  })

  it('400 for a malformed report — no counts, an unknown kind, a path-shaped id', async () => {
    expect((await POST(post({ ...REPORT, opCounts: {} }))).status).toBe(400)
    expect((await POST(post({ ...REPORT, opCounts: { publish: 1 } }))).status).toBe(400)
    expect((await POST(post({ ...REPORT, documentKind: 'email' }))).status).toBe(400)
    expect((await POST(post({ ...REPORT, orgId: 'org-1/hosts/x' }))).status).toBe(400)
    expect(mockHostRows).toEqual([])
  })

  it('403 for a non-member, and for a role without ai.generate — staff pass that rung', async () => {
    expect((await POST(post({ ...REPORT, orgId: 'org-else' }))).status).toBe(403)
    mockPermitted = false
    expect((await POST(post(REPORT))).status).toBe(403)
    mockVerifyIdToken.mockResolvedValue({ uid: 'user-1', email_verified: true, staff: true })
    expect((await POST(post(REPORT))).status).toBe(200)
  })

  it('404 while release_ai_generative is off', async () => {
    mockFlagOn = false
    expect((await POST(post(REPORT))).status).toBe(404)
    expect(mockHostRows).toEqual([])
  })

  it('passes a lockdown refusal through, and 429 on the rate window', async () => {
    mockLocked = Response.json({ error: 'locked' }, { status: 423 })
    expect((await POST(post(REPORT))).status).toBe(423)
    mockLocked = null
    mockRateAllowed = false
    expect((await POST(post(REPORT))).status).toBe(429)
    expect(mockHostRows).toEqual([])
  })
})

describe('GUARD: a row stands on a proposal the server issued', () => {
  it('404 for an exchange that does not exist, or that another member asked, or on another site', async () => {
    expect((await POST(post({ ...REPORT, exchangeId: 'nope' }))).status).toBe(404)
    mockDocs.set(`orgs/${ORG}/assistExchanges/exchange-1`, { uid: 'someone-else', hostId: 'host-1' })
    expect((await POST(post(REPORT))).status).toBe(404)
    mockDocs.set(`orgs/${ORG}/assistExchanges/exchange-1`, { uid: 'user-1', hostId: 'host-2' })
    expect((await POST(post(REPORT))).status).toBe(404)
    expect(mockHostRows).toEqual([])
  })

  it('409 for an exchange that proposed no edit', async () => {
    mockDocs.set(`orgs/${ORG}/assistSignals/exchange-1`, {
      route: '/acme/hosts/host-1/screens/screen-1/versions/v-1/besigner',
    })
    expect((await POST(post(REPORT))).status).toBe(409)
    expect(mockHostRows).toEqual([])
  })

  it('409 when the proposal was made for a different document', async () => {
    expect((await POST(post({ ...REPORT, documentId: 'screen-2' }))).status).toBe(409)
    expect((await POST(post({ ...REPORT, documentKind: 'layout' }))).status).toBe(409)
    expect(mockHostRows).toEqual([])
  })

  it('409 when more edits are reported than the exchange proposed', async () => {
    expect((await POST(post({ ...REPORT, opCounts: { set: 4 } }))).status).toBe(409)
    expect(mockHostRows).toEqual([])
  })
})

describe('the green path', () => {
  it('writes one host row with the counts, and marks the signal', async () => {
    const response = await POST(post({ ...REPORT, opCounts: { ...REPORT.opCounts, bogus: 7 } }))
    expect(response.status).toBe(200)
    expect(mockHostRows).toEqual([
      [
        'host-1',
        { uid: 'user-1', email: 'author@example.test' },
        'ai.edit.applied',
        { type: 'screen', id: 'screen-1', name: '2 set, 1 insert', versionId: 'v-2' },
      ],
    ])
    expect(mockDocs.get(`orgs/${ORG}/assistSignals/exchange-1`)?.['editAppliedAt']).toBe('__now__')
  })

  it('a second report for the same exchange writes no second row', async () => {
    expect((await POST(post(REPORT))).status).toBe(200)
    const again = await POST(post(REPORT))
    expect(again.status).toBe(200)
    expect(await again.json()).toEqual({ ok: true, duplicate: true })
    expect(mockHostRows).toHaveLength(1)
  })
})

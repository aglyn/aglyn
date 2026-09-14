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
 * A member's own addresses, the management route (AGL-2975), over an
 * in-memory store: a member lists, adds, re-sends and removes their own
 * addresses and nobody else's; the emailed link lands on the console origin
 * whatever Origin the caller sent; the link confirms only for the member
 * who added it, in their own session. The alias store and the pure rules
 * are REAL — the session, the lock and the mail are the seams.
 */

export {}

const mockStore = new Map<string, Record<string, any>>()
const mockLast = (path: string) => path.slice(path.lastIndexOf('/') + 1)

function mockSnapshot(path: string) {
  const data = mockStore.get(path)
  return { id: mockLast(path), exists: data !== undefined, data: () => data }
}
function mockDocRef(path: string): any {
  return {
    id: mockLast(path),
    path,
    get: async () => mockSnapshot(path),
    collection: (name: string) => mockCollectionRef(`${path}/${name}`),
  }
}
function mockCollectionRef(path: string): any {
  return { path, doc: (id: string) => mockDocRef(`${path}/${id}`) }
}
const mockFirestore = {
  collection: (name: string) => mockCollectionRef(name),
  runTransaction: async (body: (tx: any) => Promise<unknown>) =>
    body({
      get: async (ref: { path: string }) => mockSnapshot(ref.path),
      set: (ref: { path: string }, data: Record<string, any>) => {
        mockStore.set(ref.path, structuredClone(data))
      },
      delete: (ref: { path: string }) => {
        mockStore.delete(ref.path)
      },
    }),
}

/** Bearer token → the decoded session the route sees. */
const mockSessions = new Map<string, Record<string, unknown>>()
const mockSent: Array<Record<string, any>> = []
const mockActivity: unknown[][] = []
let mockLocked = false

jest.mock('@aglyn/shared-util-email', () => ({
  __esModule: true,
  isEmailConfigured: () => true,
  sendEmail: async (options: Record<string, any>) => {
    mockSent.push(options)
    return { sent: true, id: `em_${mockSent.length}` }
  },
}))

jest.mock('@aglyn/tenant-data-admin', () => {
  const aliases = jest.requireActual('@aglyn/tenant-data-admin/server/member-email-aliases')
  return {
    __esModule: true,
    ...aliases,
    firebaseAdmin: {
      app: () => ({
        auth: () => ({
          verifyIdToken: async (token: string) => {
            const session = mockSessions.get(token)
            if (!session) {
              throw Object.assign(new Error('bad token'), { code: 'auth/argument-error' })
            }
            return session
          },
        }),
        firestore: () => mockFirestore,
      }),
    },
    emailUnverifiedResponse: () =>
      Response.json({ error: 'Verify your email', code: 'email-unverified' }, { status: 403 }),
    isImpersonationSession: (decoded: Record<string, unknown>) =>
      typeof decoded['impersonatedBy'] === 'string',
    getOrgDoc: async (orgId: string) => {
      const data = mockStore.get(`orgs/${orgId}`)
      return data ? { $id: orgId, ...data } : null
    },
    resolveOrgMembership: async (uid: string, orgId: string) => {
      const member = mockStore.get(`orgs/${orgId}/members/${uid}`)
      return member ? { orgId, member: { $id: uid, ...member } } : null
    },
    lockdownRefusal: async () =>
      mockLocked ? Response.json({ error: 'Locked', lockdown: true }, { status: 423 }) : null,
    logOrgActivity: async (...args: unknown[]) => {
      mockActivity.push(args)
    },
  }
})

jest.mock('@aglyn/tenant-data-admin/server/rate-limit-store', () => ({
  __esModule: true,
  consumeRateLimit: async () => ({ allowed: true }),
}))
jest.mock('@aglyn/tenant-data-admin/server/email-metering', () => ({
  __esModule: true,
  meterOrgEmail: async () => undefined,
}))

import { DELETE, GET, POST } from './route'

const ORG = 'org-1'
const URL_BASE = 'https://app.aglyn.com/api/orgs/members/email-aliases'

const call = (
  method: 'GET' | 'POST' | 'DELETE' | 'PUT',
  options: { token?: string; body?: Record<string, unknown>; query?: string; origin?: string } = {},
) => {
  const handler = method === 'GET' ? GET : method === 'DELETE' ? DELETE : POST
  return handler(
    new Request(`${URL_BASE}${options.query ?? ''}`, {
      method,
      headers: {
        ...(options.token ? { authorization: `Bearer ${options.token}` } : {}),
        ...(options.body ? { 'content-type': 'application/json' } : {}),
        ...(options.origin ? { origin: options.origin } : {}),
      },
      ...(options.body ? { body: JSON.stringify(options.body) } : {}),
    }),
  )
}

const aliasesOf = (uid: string) =>
  (mockStore.get(`orgs/${ORG}/memberEmailAliases/${uid}`)?.['aliases'] ?? []) as Array<
    Record<string, unknown>
  >

/** The token out of the last confirmation link mailed. */
const lastLinkToken = () => {
  const text = String(mockSent[mockSent.length - 1]?.['text'] ?? '')
  const link = text.split('\n').find((line) => line.includes('confirmEmailAlias='))
  return new URL(String(link)).searchParams.get('confirmEmailAlias') ?? ''
}

beforeEach(() => {
  mockStore.clear()
  mockSessions.clear()
  mockSent.length = 0
  mockActivity.length = 0
  mockLocked = false
  process.env['TOKEN_SIGNING_SECRET'] = 'email-aliases-route-spec-secret'
  delete process.env['NEXT_PUBLIC_CONSOLE_URL']
  delete process.env['AUTH_ACTION_ALLOWED_ORIGINS']
  delete process.env['CRM_INBOUND_DOMAIN']
  mockStore.set(`orgs/${ORG}`, { name: 'Acme' })
  mockStore.set(`orgs/${ORG}/members/u-zach`, {
    role: 'admin',
    email: 'zach@aglyn.com',
    displayName: 'Zach Gover',
  })
  mockStore.set(`orgs/${ORG}/members/u-kim`, { role: 'editor', email: 'kim@aglyn.com' })
  mockSessions.set('zach', { uid: 'u-zach', email: 'zach@aglyn.com', email_verified: true })
  mockSessions.set('kim', { uid: 'u-kim', email: 'kim@aglyn.com', email_verified: true })
  mockSessions.set('outsider', { uid: 'u-out', email: 'out@else.example', email_verified: true })
  mockSessions.set('staff-as-zach', {
    uid: 'u-zach',
    email: 'zach@aglyn.com',
    email_verified: false,
    impersonatedBy: 'u-staff',
  })
  mockSessions.set('unverified', { uid: 'u-kim', email: 'kim@aglyn.com', email_verified: false })
})

describe('/api/orgs/members/email-aliases', () => {
  it('refuses a request with no session, a bad one, an unverified one and an unknown method', async () => {
    expect((await call('GET', { query: `?orgId=${ORG}` })).status).toBe(401)
    expect((await call('GET', { token: 'forged', query: `?orgId=${ORG}` })).status).toBe(401)
    expect((await call('GET', { token: 'unverified', query: `?orgId=${ORG}` })).status).toBe(403)
    expect((await call('PUT', { token: 'zach' })).status).toBe(405)
    expect((await call('POST', { token: 'zach', body: { orgId: ORG, action: 'grant' } })).status).toBe(400)
  })

  it('refuses somebody who is not a member of the workspace', async () => {
    const response = await call('POST', {
      token: 'outsider',
      body: { orgId: ORG, action: 'add', address: 'zach@aglyn.io' },
    })
    expect(response.status).toBe(403)
    expect(mockSent).toHaveLength(0)
  })

  it('adds an address, mails a link on the console origin whatever Origin was sent, and confirms it for the member', async () => {
    const added = await call('POST', {
      token: 'zach',
      origin: 'https://attacker.example',
      body: { orgId: ORG, action: 'add', address: ' Zach@Aglyn.IO', returnPath: '/acme/crm/settings' },
    })
    expect(added.status).toBe(200)
    expect(await added.json()).toEqual({
      ok: true,
      sent: true,
      alias: { address: 'zach@aglyn.io', addedAtMs: expect.any(Number), verified: false, verifiedAtMs: null },
    })
    expect(mockSent).toHaveLength(1)
    expect(mockSent[0]).toMatchObject({ to: 'zach@aglyn.io', subject: 'Confirm your address for Acme' })
    expect(mockSent[0]['text']).toContain('https://app.aglyn.com/acme/crm/settings?confirmEmailAlias=')
    expect(mockSent[0]['text']).not.toContain('attacker.example')

    const listed = await call('GET', { token: 'zach', query: `?orgId=${ORG}` })
    expect(await listed.json()).toEqual({
      signInEmail: 'zach@aglyn.com',
      aliases: [expect.objectContaining({ address: 'zach@aglyn.io', verified: false })],
    })

    const confirmed = await call('POST', { token: 'zach', body: { action: 'confirm', token: lastLinkToken() } })
    expect(confirmed.status).toBe(200)
    expect(await confirmed.json()).toEqual({
      ok: true,
      orgId: ORG,
      address: 'zach@aglyn.io',
      alreadyConfirmed: false,
    })
    expect(aliasesOf('u-zach')[0]['verifiedAtMs']).toEqual(expect.any(Number))
    expect(mockActivity).toEqual([
      [
        ORG,
        { uid: 'u-zach', email: 'zach@aglyn.com' },
        'Confirmed a sending address for email capture',
        { type: 'member', id: 'u-zach' },
      ],
    ])
  })

  it('refuses the link to another member, and to an impersonated session, writing nothing', async () => {
    await call('POST', { token: 'zach', body: { orgId: ORG, action: 'add', address: 'zach@aglyn.io' } })
    const token = lastLinkToken()
    const other = await call('POST', { token: 'kim', body: { action: 'confirm', token } })
    expect(other.status).toBe(403)
    expect(await other.json()).toMatchObject({ reason: 'wrong-member' })
    const impersonated = await call('POST', { token: 'staff-as-zach', body: { action: 'confirm', token } })
    expect(impersonated.status).toBe(403)
    const tampered = await call('POST', { token: 'zach', body: { action: 'confirm', token: `${token}x` } })
    expect(tampered.status).toBe(400)
    expect(aliasesOf('u-zach')[0]['verifiedAtMs']).toBeUndefined()
  })

  it('refuses the sign-in address and a capture-domain address, sending nothing', async () => {
    const own = await call('POST', { token: 'zach', body: { orgId: ORG, action: 'add', address: 'ZACH@aglyn.com' } })
    expect(own.status).toBe(400)
    expect(await own.json()).toMatchObject({ reason: 'sign-in-address' })
    const capture = await call('POST', {
      token: 'zach',
      body: { orgId: ORG, action: 'add', address: `crm+${'a'.repeat(32)}@in.aglyn.com` },
    })
    expect(await capture.json()).toMatchObject({ reason: 'reserved-domain' })
    expect(mockSent).toHaveLength(0)
  })

  it('re-sends only for an address already on the list and waiting', async () => {
    const unknown = await call('POST', {
      token: 'zach',
      body: { orgId: ORG, action: 'resend', address: 'someone@else.example' },
    })
    expect(unknown.status).toBe(404)
    expect(mockSent).toHaveLength(0)
    await call('POST', { token: 'zach', body: { orgId: ORG, action: 'add', address: 'zach@aglyn.io' } })
    const again = await call('POST', { token: 'zach', body: { orgId: ORG, action: 'resend', address: 'zach@aglyn.io' } })
    expect(again.status).toBe(200)
    expect(mockSent).toHaveLength(2)
  })

  it('removes an address from the caller’s own list only', async () => {
    await call('POST', { token: 'zach', body: { orgId: ORG, action: 'add', address: 'zach@aglyn.io' } })
    const notTheirs = await call('DELETE', { token: 'kim', body: { orgId: ORG, address: 'zach@aglyn.io' } })
    expect(notTheirs.status).toBe(404)
    expect(aliasesOf('u-zach')).toHaveLength(1)
    const removed = await call('DELETE', { token: 'zach', body: { orgId: ORG, address: 'zach@aglyn.io' } })
    expect(removed.status).toBe(200)
    expect(mockStore.has(`orgs/${ORG}/memberEmailAliases/u-zach`)).toBe(false)
  })

  it('answers a locked workspace with the 423 before any write', async () => {
    mockLocked = true
    const response = await call('POST', { token: 'zach', body: { orgId: ORG, action: 'add', address: 'zach@aglyn.io' } })
    expect(response.status).toBe(423)
    expect(mockStore.has(`orgs/${ORG}/memberEmailAliases/u-zach`)).toBe(false)
    expect(mockSent).toHaveLength(0)
  })
})

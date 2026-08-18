/**
 * @jest-environment node
 *
 * Pragma must stay in the FIRST block comment — behind the license header it is
 * silently ignored and the suite runs on jsdom.
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
 * `/api/domains/status` — the surface that makes "still issuing" and "this will
 * never work" different things on screen (AGL-1913).
 *
 * Two properties, and the second is the one worth writing down: it answers for
 * the SITE IN THE URL, for a caller who belongs to it. A status route that
 * skipped the membership check would be a public probe of any site's domain
 * configuration keyed by document id.
 */

// A module, not a script — without this the const declarations below collide
// with the other console route specs' identical globals under `tsc`.
export {}

let docs = new Map<string, Record<string, unknown>>()

const mockVerifyIdToken = jest.fn()
const mockProjectDomainStatus = jest.fn()

function mockMakeFirestore() {
  return {
    collection: (name: string) => ({
      doc: (id: string) => ({
        get: async () => {
          const path = `${name}/${id}`
          return {
            exists: docs.has(path),
            id,
            data: () => docs.get(path),
            get: (field: string) => (docs.get(path) ?? {})[field],
          }
        },
      }),
    }),
  }
}

jest.mock('@aglyn/tenant-data-admin', () => ({
  __esModule: true,
  firebaseAdmin: {
    app: () => ({
      auth: () => ({ verifyIdToken: (...args: unknown[]) => mockVerifyIdToken(...args) }),
      firestore: () => mockMakeFirestore(),
    }),
  },
  isImpersonationSession: () => false,
  emailUnverifiedResponse: () =>
    Response.json({ error: 'Verify your email' }, { status: 403 }),
  projectDomainStatus: (...args: unknown[]) => mockProjectDomainStatus(...args),
}))

jest.mock('@aglyn/aglyn/server', () => ({
  __esModule: true,
  pluginRequestFromWeb: async (request: Request) => ({
    method: request.method,
    query: Object.fromEntries(new URL(request.url).searchParams),
    headers: Object.fromEntries(request.headers),
  }),
}))

const { GET } = require('./route') as {
  GET: (request: Request) => Promise<Response>
}

function get(hostId: string, token = 'token') {
  return new Request(
    `https://app.aglyn.com/api/domains/status?hostId=${encodeURIComponent(hostId)}`,
    { headers: token ? { authorization: `Bearer ${token}` } : {} },
  )
}

function seedHost(id: string, fields: Record<string, unknown> = {}) {
  docs.set(`hosts/${id}`, {
    displayName: 'A site',
    orgId: 'org-1',
    subdomain: id,
    memberRoles: { 'user-1': 'admin', 'user-2': 'viewer' },
    ...fields,
  })
}

beforeEach(() => {
  docs = new Map()
  mockVerifyIdToken.mockReset()
  mockVerifyIdToken.mockResolvedValue({ uid: 'user-1', email_verified: true })
  mockProjectDomainStatus.mockReset()
  mockProjectDomainStatus.mockResolvedValue({
    state: 'certificate-pending',
    domain: 'example.com',
    verification: [],
    conflicts: [],
  })
  process.env.VERCEL_TENANT_PROJECT_ID = 'prj_tenant'
})

afterEach(() => {
  delete process.env.VERCEL_TENANT_PROJECT_ID
  jest.restoreAllMocks()
})

describe('it reports the live state, not the stored one', () => {
  it('separates a certificate still issuing from a domain that is up', async () => {
    seedHost('mine', { cname: 'example.com' })
    const response = await GET(get('mine'))
    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({
      domain: 'example.com',
      state: 'certificate-pending',
      verification: [],
      conflicts: [],
      attachmentPending: false,
    })
    expect(mockProjectDomainStatus).toHaveBeenCalledWith('example.com', {
      projectId: 'prj_tenant',
    })
  })

  it('carries the ownership challenge and the conflicting records through', async () => {
    seedHost('mine', { cname: 'example.com', cnameAttachmentPending: true })
    mockProjectDomainStatus.mockResolvedValue({
      state: 'ownership-pending',
      domain: 'example.com',
      verification: [
        { type: 'TXT', domain: '_vercel.example.com', value: 'vc-domain-verify=…' },
      ],
      conflicts: [{ type: 'A', name: 'example.com', value: '203.0.113.9' }],
    })
    const body = await (await GET(get('mine'))).json()
    expect(body.state).toBe('ownership-pending')
    expect(body.verification[0].domain).toBe('_vercel.example.com')
    expect(body.conflicts[0].value).toBe('203.0.113.9')
    // Our own record of the last attach, kept distinct from the platform's.
    expect(body.attachmentPending).toBe(true)
  })

  it('answers `none` for a site with no custom domain, without calling out', async () => {
    seedHost('mine')
    const response = await GET(get('mine'))
    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({ domain: null, state: 'none' })
    expect(mockProjectDomainStatus).not.toHaveBeenCalled()
  })
})

describe('it answers for the site in the URL, to someone who belongs to it', () => {
  it('401s without a bearer token', async () => {
    seedHost('mine', { cname: 'example.com' })
    const response = await GET(
      new Request('https://app.aglyn.com/api/domains/status?hostId=mine'),
    )
    expect(response.status).toBe(401)
    expect(mockProjectDomainStatus).not.toHaveBeenCalled()
  })

  it('401s on a token that does not verify', async () => {
    seedHost('mine', { cname: 'example.com' })
    mockVerifyIdToken.mockRejectedValue(new Error('bad token'))
    expect((await GET(get('mine'))).status).toBe(401)
  })

  it('403s a signed-in stranger — this is not a public domain probe', async () => {
    seedHost('mine', { cname: 'example.com' })
    mockVerifyIdToken.mockResolvedValue({ uid: 'nobody', email_verified: true })
    const response = await GET(get('mine'))
    expect(response.status).toBe(403)
    expect(mockProjectDomainStatus).not.toHaveBeenCalled()
  })

  it('admits a non-admin MEMBER — the control on the check above', async () => {
    // Any member may ask whether the site is up. A gate that refused everyone
    // but admins would pass the stranger test and hide the status from the
    // people most likely to notice the site is down.
    seedHost('mine', { cname: 'example.com' })
    mockVerifyIdToken.mockResolvedValue({ uid: 'user-2', email_verified: true })
    expect((await GET(get('mine'))).status).toBe(200)
  })

  it('admits staff, so support can see a stuck domain without impersonating', async () => {
    seedHost('mine', { cname: 'example.com' })
    mockVerifyIdToken.mockResolvedValue({
      uid: 'staff-1',
      email_verified: true,
      staff: true,
    })
    expect((await GET(get('mine'))).status).toBe(200)
  })

  it('404s an unknown site', async () => {
    const response = await GET(get('ghost'))
    expect(response.status).toBe(404)
  })

  it('400s a missing hostId', async () => {
    const response = await GET(
      new Request('https://app.aglyn.com/api/domains/status', {
        headers: { authorization: 'Bearer token' },
      }),
    )
    expect(response.status).toBe(400)
  })

  it('refuses an unverified email', async () => {
    seedHost('mine', { cname: 'example.com' })
    mockVerifyIdToken.mockResolvedValue({ uid: 'user-1', email_verified: false })
    const response = await GET(get('mine'))
    expect(response.status).toBe(403)
    await expect(response.json()).resolves.toEqual({ error: 'Verify your email' })
  })
})

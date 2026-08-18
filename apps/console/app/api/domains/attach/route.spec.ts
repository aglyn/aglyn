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
 * `/api/domains/attach` — the hop where a customer's own domain either starts
 * serving their site or quietly does not (AGL-1913).
 *
 * This route had no coverage at all, including the transaction AGL-743 added
 * precisely because one org had been served on another org's domain. So the
 * uniqueness guard is tested in BOTH directions here: a domain another host
 * holds is refused, and a first-time claim on a free domain still succeeds. A
 * guard that only ever sees the rejection case passes just as happily when it
 * rejects everything, and a wizard that refuses every domain is a worse
 * product than one that occasionally collides.
 *
 * The second half is the false green. Vercel answers a successful add for a
 * domain that serves nothing — `domain_already_in_use` when the name is on
 * someone else's project, `verified: false` when it wants an ownership
 * challenge first — and this route used to read both as `attached: true`.
 * Worse, it then registered the platform subdomain as an edge REDIRECT to that
 * dead domain, so a site that was working on `{sub}.aglyn.app` lost that
 * address too.
 *
 * `projectDomainStatus` is mocked, not stubbed away: its own suite in
 * `workspace-domains.spec.ts` pins the real API payloads it reads.
 */

// A module, not a script — without this the const declarations below collide
// with the other console route specs' identical globals under `tsc`.
export {}

/** Every document, keyed by `collection/id`. */
let docs = new Map<string, Record<string, unknown>>()
/** A sentinel the fake understands, standing in for `FieldValue.delete()`. */
const DELETE = { __delete__: true }

const mockVerifyIdToken = jest.fn()
const mockCheckEntitlement = jest.fn()
const mockProjectDomainStatus = jest.fn()
const fetchMock = jest.fn()

/** Applies a `set(..., { merge: true })` the way Firestore does, deletes included. */
function applySet(
  path: string,
  data: Record<string, unknown>,
  merge: boolean | undefined,
) {
  const next: Record<string, unknown> = merge ? { ...docs.get(path) } : {}
  for (const [key, value] of Object.entries(data)) {
    if (value === DELETE) delete next[key]
    else next[key] = value
  }
  docs.set(path, next)
}

function snapshotFor(path: string) {
  return {
    exists: docs.has(path),
    id: path.split('/').pop(),
    ref: refFor(path),
    data: () => docs.get(path),
    get: (field: string) => (docs.get(path) ?? {})[field],
  }
}

function refFor(path: string) {
  return {
    path,
    id: path.split('/').pop(),
    set: async (data: Record<string, unknown>, options?: { merge?: boolean }) => {
      applySet(path, data, options?.merge)
      return undefined
    },
  }
}

/**
 * In-memory Firestore with the one query and the one transaction this route
 * runs. `runTransaction` applies its writes immediately, which is faithful
 * enough for a suite that never runs two transactions at once — and the
 * uniqueness claim under test is about what the query SEES, not about
 * contention.
 */
function mockMakeFirestore() {
  const collection = (name: string) => ({
    doc: (id: string) => ({
      ...refFor(`${name}/${id}`),
      get: async () => snapshotFor(`${name}/${id}`),
    }),
    where: (field: string, _op: string, value: unknown) => ({
      limit: (count: number) => ({
        __query: { name, field, value, count },
      }),
    }),
  })
  return {
    collection,
    runTransaction: async (body: (tx: unknown) => Promise<unknown>) =>
      body({
        get: async (query: { __query: { name: string; field: string; value: unknown; count: number } }) => {
          const matched = [...docs.entries()]
            .filter(
              ([path, data]) =>
                path.startsWith(`${query.__query.name}/`) &&
                data[query.__query.field] === query.__query.value,
            )
            .slice(0, query.__query.count)
          return {
            empty: matched.length === 0,
            docs: matched.map(([path, data]) => ({
              id: path.split('/').pop(),
              data: () => data,
              get: (key: string) => data[key],
            })),
          }
        },
        set: (
          ref: { path: string },
          data: Record<string, unknown>,
          options?: { merge?: boolean },
        ) => {
          applySet(ref.path, data, options?.merge)
          return undefined
        },
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
    firestore: { FieldValue: { delete: () => DELETE } },
  },
  isImpersonationSession: () => false,
  emailUnverifiedResponse: () =>
    Response.json({ error: 'Verify your email' }, { status: 403 }),
  getOrgForHost: async () => ({ org: { plan: 'starter' } }),
  lockdownRefusal: async () => null,
  projectDomainStatus: (...args: unknown[]) => mockProjectDomainStatus(...args),
}))

jest.mock('@aglyn/aglyn/server', () => ({
  __esModule: true,
  TENANT_APEX: 'aglyn.app',
  checkEntitlement: (...args: unknown[]) => mockCheckEntitlement(...args),
  pluginRequestFromWeb: async (request: Request) => ({
    method: request.method,
    body: await request.json(),
    headers: Object.fromEntries(request.headers),
  }),
}))

const { POST } = require('./route') as {
  POST: (request: Request) => Promise<Response>
}

function post(body: unknown) {
  return new Request('https://app.aglyn.com/api/domains/attach', {
    method: 'POST',
    headers: {
      authorization: 'Bearer token',
      'content-type': 'application/json',
    },
    body: JSON.stringify(body),
  })
}

function seedHost(id: string, fields: Record<string, unknown> = {}) {
  docs.set(`hosts/${id}`, {
    displayName: 'A site',
    orgId: 'org-1',
    subdomain: id,
    memberRoles: { 'user-1': 'admin' },
    ...fields,
  })
}

/** A Vercel add-domain response. */
function respond(status: number, body: unknown = {}) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as unknown as Response
}

beforeEach(() => {
  docs = new Map()
  mockVerifyIdToken.mockReset()
  mockVerifyIdToken.mockResolvedValue({ uid: 'user-1', email_verified: true })
  mockCheckEntitlement.mockReset()
  mockCheckEntitlement.mockReturnValue(true)
  mockProjectDomainStatus.mockReset()
  mockProjectDomainStatus.mockResolvedValue({
    state: 'certificate-pending',
    domain: 'example.com',
    verification: [],
    conflicts: [],
  })
  fetchMock.mockReset()
  fetchMock.mockResolvedValue(respond(200, { name: 'example.com' }))
  global.fetch = fetchMock as unknown as typeof fetch
  process.env.VERCEL_TOKEN = 'tok_test'
  process.env.VERCEL_TENANT_PROJECT_ID = 'prj_tenant'
  process.env.VERCEL_TEAM_ID = 'team_test'
  jest.spyOn(console, 'error').mockImplementation(() => undefined)
})

afterEach(() => {
  delete process.env.VERCEL_TOKEN
  delete process.env.VERCEL_TENANT_PROJECT_ID
  delete process.env.VERCEL_TEAM_ID
  jest.restoreAllMocks()
})

describe('one domain, one site — in both directions (AGL-743)', () => {
  it('REFUSES a domain another site already holds, and leaves both docs alone', async () => {
    seedHost('mine')
    seedHost('theirs', { cname: 'example.com' })

    const response = await POST(post({ hostId: 'mine', domain: 'example.com' }))

    expect(response.status).toBe(409)
    await expect(response.json()).resolves.toEqual({
      error: 'That domain is already connected to another site',
    })
    // The claim did not move, and the loser did not silently acquire it —
    // which is the AGL-743 bug exactly: the client wrote `cname` first and
    // kept it after losing the check.
    expect(docs.get('hosts/mine')?.['cname']).toBeUndefined()
    expect(docs.get('hosts/theirs')?.['cname']).toBe('example.com')
    // And nothing was said to Vercel about a domain we did not claim.
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('ALLOWS a first-time claim on a domain nobody holds — the control', async () => {
    // Without this, a uniqueness guard that returns 409 unconditionally passes
    // the test above and ships a wizard that can never connect anything.
    seedHost('mine')

    const response = await POST(post({ hostId: 'mine', domain: 'example.com' }))

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({ attached: true })
    expect(docs.get('hosts/mine')?.['cname']).toBe('example.com')
    expect(fetchMock.mock.calls[0][0]).toBe(
      'https://api.vercel.com/v10/projects/prj_tenant/domains?teamId=team_test',
    )
  })

  it('lets a site RE-attach the domain it already holds', async () => {
    // The re-attach button sends the connected domain back to this route. A
    // uniqueness check that matched the caller's own document would answer
    // "already connected to another site" — about itself.
    seedHost('mine', { cname: 'example.com', cnameAttachmentPending: true })

    const response = await POST(post({ hostId: 'mine', domain: 'example.com' }))

    expect(response.status).toBe(200)
    expect(docs.get('hosts/mine')?.['cname']).toBe('example.com')
    expect(docs.get('hosts/mine')?.['cnameAttachmentPending']).toBeUndefined()
  })

  it('refuses a non-admin before any claim is made', async () => {
    seedHost('mine', { memberRoles: { 'user-1': 'editor' } })
    const response = await POST(post({ hostId: 'mine', domain: 'example.com' }))
    expect(response.status).toBe(403)
    expect(docs.get('hosts/mine')?.['cname']).toBeUndefined()
  })

  it('refuses a Free org, and writes no claim', async () => {
    seedHost('mine')
    mockCheckEntitlement.mockReturnValue(false)
    const response = await POST(post({ hostId: 'mine', domain: 'example.com' }))
    expect(response.status).toBe(403)
    expect(docs.get('hosts/mine')?.['cname']).toBeUndefined()
    expect(fetchMock).not.toHaveBeenCalled()
  })
})

describe('a successful POST is not a serving domain (AGL-1913)', () => {
  it('refuses to call it attached when the name is on someone ELSE’s project', async () => {
    // `domain_already_in_use` is tolerated as idempotency. It is also what
    // Vercel says when the name belongs to another project entirely — and the
    // route used to answer `attached: true` to both.
    seedHost('mine')
    fetchMock.mockResolvedValue(
      respond(409, { error: { code: 'domain_already_in_use' } }),
    )
    mockProjectDomainStatus.mockResolvedValue({
      state: 'not-attached',
      domain: 'example.com',
      verification: [],
      conflicts: [],
    })

    const response = await POST(post({ hostId: 'mine', domain: 'example.com' }))

    expect(response.status).toBe(409)
    await expect(response.json()).resolves.toMatchObject({
      state: 'not-attached',
    })
    expect(docs.get('hosts/mine')?.['cnameAttachmentPending']).toBe(true)
    // No edge redirect: the platform subdomain must keep serving the site.
    expect(
      fetchMock.mock.calls.some(([url]) => String(url).includes('mine.aglyn.app')),
    ).toBe(false)
  })

  it('hands back the ownership challenge instead of a green tick', async () => {
    seedHost('mine')
    mockProjectDomainStatus.mockResolvedValue({
      state: 'ownership-pending',
      domain: 'example.com',
      verification: [
        { type: 'TXT', domain: '_vercel.example.com', value: 'vc-domain-verify=…' },
      ],
      conflicts: [],
    })

    const response = await POST(post({ hostId: 'mine', domain: 'example.com' }))

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({
      state: 'ownership-pending',
      verification: [{ type: 'TXT', domain: '_vercel.example.com' }],
    })
    // It does not serve, so the two redirects that would strand the site are
    // both withheld: the flag `liveCustomDomain` reads stays true…
    expect(docs.get('hosts/mine')?.['cnameAttachmentPending']).toBe(true)
    // …and no edge redirect is registered on the platform subdomain.
    expect(
      fetchMock.mock.calls.some(([url]) => String(url).includes('mine.aglyn.app')),
    ).toBe(false)
  })

  it('withholds the subdomain redirect when the platform says DNS points elsewhere', async () => {
    seedHost('mine')
    mockProjectDomainStatus.mockResolvedValue({
      state: 'dns-misconfigured',
      domain: 'example.com',
      verification: [],
      conflicts: [{ type: 'A', name: 'example.com', value: '203.0.113.9' }],
    })

    const response = await POST(post({ hostId: 'mine', domain: 'example.com' }))

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({
      state: 'dns-misconfigured',
      conflicts: [{ type: 'A', value: '203.0.113.9' }],
    })
    expect(docs.get('hosts/mine')?.['cnameAttachmentPending']).toBe(true)
    expect(
      fetchMock.mock.calls.some(([url]) => String(url).includes('mine.aglyn.app')),
    ).toBe(false)
  })

  it('registers the subdomain redirect once the domain DOES serve — the control', async () => {
    // The other half of the gate. A version that never registers the redirect
    // passes all three tests above and silently reverts AGL-1273.
    seedHost('mine')
    mockProjectDomainStatus.mockResolvedValue({
      state: 'serving',
      domain: 'example.com',
      verification: [],
      conflicts: [],
    })

    const response = await POST(post({ hostId: 'mine', domain: 'example.com' }))

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({ state: 'serving' })
    expect(docs.get('hosts/mine')?.['cnameAttachmentPending']).toBeUndefined()
    const redirect = fetchMock.mock.calls.find(([url]) =>
      String(url).includes('mine.aglyn.app'),
    )
    expect(redirect).toBeDefined()
    expect(JSON.parse(redirect[1].body)).toEqual({
      redirect: 'example.com',
      redirectStatusCode: 307,
    })
  })

  it('falls through to the old behaviour when the status probe cannot answer', async () => {
    // A status API outage must not block an attach that otherwise succeeded.
    seedHost('mine')
    mockProjectDomainStatus.mockResolvedValue({
      state: 'unknown',
      domain: 'example.com',
      verification: [],
      conflicts: [],
      detail: 'network',
    })

    const response = await POST(post({ hostId: 'mine', domain: 'example.com' }))

    expect(response.status).toBe(200)
    expect(docs.get('hosts/mine')?.['cname']).toBe('example.com')
    expect(docs.get('hosts/mine')?.['cnameAttachmentPending']).toBeUndefined()
    expect(
      fetchMock.mock.calls.some(([url]) => String(url).includes('mine.aglyn.app')),
    ).toBe(true)
  })

  it('records the gap when the platform env is missing, and claims nothing', async () => {
    delete process.env.VERCEL_TOKEN
    seedHost('mine')
    const response = await POST(post({ hostId: 'mine', domain: 'example.com' }))
    expect(response.status).toBe(501)
    // The claim still lands — the domain is reserved to this site — but the
    // pending flag keeps `liveCustomDomain` from advertising it.
    expect(docs.get('hosts/mine')?.['cname']).toBe('example.com')
    expect(docs.get('hosts/mine')?.['cnameAttachmentPending']).toBe(true)
    expect(mockProjectDomainStatus).not.toHaveBeenCalled()
  })
})

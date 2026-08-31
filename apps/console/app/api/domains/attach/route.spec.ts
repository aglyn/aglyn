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
  // The REAL `domainStateServes` (AGL-2011). The predicate that decides
  // whether a probed state counts as serving used to be four inline
  // comparisons in this route and four more in the completer cron, kept
  // identical by a comment; it is now one exported function, and stubbing it
  // here would make every state case below a test of the stub.
  //
  // Reached through the defining FILE, not
  // `jest.requireActual('@aglyn/tenant-data-admin')`: the package barrel pulls
  // in `render-cache.ts` -> `next/cache`, which throws under this test
  // environment. That file has no imports of its own.
  ...jest.requireActual(
    '../../../../../../libs/tenant/data/admin/src/lib/server/workspace-domains',
  ),
  // The REAL provider seam, reached the same way and for the same reason: it
  // is what turns a name into an outbound call, and the `fetch` double below
  // is the only thing standing in for the network. A stub here would make
  // every assertion about what we sent an assertion about the stub.
  ...jest.requireActual(
    '../../../../../../libs/tenant/data/admin/src/lib/server/domain-provider',
  ),
  // The REAL `validatePlatformDomain` too, and for the same reason (AGL-1430):
  // stubbing the blocklist would turn every reserved-name test below into a
  // test of the stub. Its own suite in `platform-domain-names.spec.ts` pins the
  // list; these tests pin that the ROUTE consults it before it claims.
  ...jest.requireActual(
    '../../../../../../libs/tenant/data/admin/src/lib/server/platform-domain-names',
  ),
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
  // The route writes the site's audit entry at its single terminal success
  // (AGL-118). The real one swallows its own failures and resolves with
  // nothing, and the route does not branch on it, so a no-op IS the contract.
  // Named explicitly because this factory is a closed world: an absent export
  // is `undefined`, the route throws past every assertion below, and its own
  // catch answers 500 — which reads exactly like the attach regressing.
  logHostActivity: async () => undefined,
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

/**
 * Every outbound call that concerns `{subdomain}.aglyn.app`.
 *
 * The name reaches the provider two ways — in the PATH when an entry that
 * already exists is repointed, and in the BODY when the entry is created
 * carrying its redirect. Matching only the URL therefore reads a successful
 * registration as "no redirect was sent", which would pass a route that had
 * quietly reverted AGL-1273.
 */
function redirectCalls(name = 'mine.aglyn.app') {
  return fetchMock.mock.calls.filter(([url, init]) => {
    if (String(url).includes(name)) return true
    try {
      return JSON.parse(String(init?.body ?? '{}'))?.name === name
    } catch {
      return false
    }
  })
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
    // Stated rather than inherited from the default (AGL-1996). This test is
    // about the uniqueness check, and clearing the pending flag is only
    // correct for a domain that SERVES. It used to ride the suite's
    // `certificate-pending` default and assert the flag was cleared, which
    // pinned the defect as passing behaviour.
    mockProjectDomainStatus.mockResolvedValue({
      domain: 'example.com',
      state: 'serving',
    })

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
      redirectCalls().length,
    ).toBe(0)
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
      redirectCalls().length,
    ).toBe(0)
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
      redirectCalls().length,
    ).toBe(0)
  })

  it('a domain with no certificate yet is NOT serving — no redirect, flag stays', async () => {
    // AGL-1996. `certificate-pending` means Vercel has accepted and routed
    // the name but no certificate exists, so HTTPS fails. It used to count as
    // serving, which is the one case the redirect comment above describes and
    // the one it did not defend against: the flag was deleted, the edge
    // redirect was registered, and the site lost BOTH addresses — the
    // subdomain now redirects, and the destination answers a TLS error.
    seedHost('mine')
    mockProjectDomainStatus.mockResolvedValue({
      state: 'certificate-pending',
      domain: 'example.com',
      verification: [],
      conflicts: [],
    })

    const response = await POST(post({ hostId: 'mine', domain: 'example.com' }))

    // Still a successful attach — the domain IS on the project. What it is
    // not is ready for visitors, and the body says which.
    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({
      attached: true,
      state: 'certificate-pending',
    })
    expect(docs.get('hosts/mine')?.['cnameAttachmentPending']).toBe(true)
    expect(
      redirectCalls().length,
    ).toBe(0)
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
    const redirect = redirectCalls()[0]
    expect(redirect).toBeDefined()
    expect(JSON.parse(String(redirect[1].body))).toEqual({
      name: 'mine.aglyn.app',
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
    expect(redirectCalls().length).toBeGreaterThan(0)
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

/**
 * The claim/attach correspondence (AGL-1430, AGL-1311 §5.2).
 *
 * The tolerated `domain_already_in_use` above is only safe while **every name
 * the platform holds on the tenant Vercel project is covered by the Firestore
 * claim this route runs**. The memo asserted that correspondence held; it did
 * not. Two families of name sit on that project and are invisible to
 * `where('cname','==',…)`:
 *
 *  1. `{subdomain}.{TENANT_APEX}` — attached as a per-domain 307 redirect by
 *     AGL-1273's `upsertSubdomainRedirect` every time any customer connects a
 *     custom domain. Indexed on `hosts.subdomain`, never on `hosts.cname`.
 *  2. The platform's own redirect names — `www.aglyn.com`, `aglyn.app`,
 *     `www.aglyn.app`, `aglyn.io` — which are project domains and no host
 *     document's `cname`.
 *
 * Claiming either one used to walk the whole happy path: the transaction found
 * no duplicate, Vercel answered `domain_already_in_use`, that was tolerated,
 * `projectDomainStatus` truthfully answered `serving` **because the name really
 * is on our project**, the pending flag was deleted, and the wizard went green
 * — after which this route pointed the claimant's OWN `{sub}.aglyn.app` at the
 * name as a 307. So the claimant's visitors were redirected to a stranger's
 * site and the claimant's site was never served there. That is the failure
 * AGL-1311 §5.2 predicted a twin would create, reachable with no twin at all.
 *
 * Every test here therefore drives the FULL route, with Vercel answering
 * exactly what it answers for a name already on the project. A test that
 * stopped at the 400 would pass against a guard that refuses the name and then
 * attaches it anyway.
 */
describe('the claim covers every name Vercel holds (AGL-1430)', () => {
  /** Vercel's answer for a name already on this project. */
  function seedNameAlreadyOnOurProject() {
    fetchMock.mockResolvedValue(
      respond(409, { error: { code: 'domain_already_in_use' } }),
    )
    mockProjectDomainStatus.mockResolvedValue({
      state: 'serving',
      domain: 'x',
      verification: [],
      conflicts: [],
    })
  }

  /** Nothing was claimed, nothing was attached, nothing was redirected. */
  async function expectRefused(response: Response, hostId = 'mine') {
    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toMatchObject({
      error: expect.stringContaining('reserved'),
    })
    expect(docs.get(`hosts/${hostId}`)?.['cname']).toBeUndefined()
    expect(docs.get(`hosts/${hostId}`)?.['cnameAttachmentPending']).toBeUndefined()
    // The refusal must land BEFORE the claim and before Vercel — a route that
    // claimed first and apologised later is AGL-743 again.
    expect(fetchMock).not.toHaveBeenCalled()
  }

  it('REFUSES another site’s platform subdomain, which Vercel already holds', async () => {
    // Org A connected a custom domain, so AGL-1273 put `alice.aglyn.app` on
    // the tenant project as a 307 to it. Nothing indexes that name as a
    // `cname`, so the uniqueness transaction cannot see it.
    seedHost('alice', { subdomain: 'alice', cname: 'alice-store.com' })
    seedHost('mine', { subdomain: 'mine' })
    seedNameAlreadyOnOurProject()

    await expectRefused(
      await POST(post({ hostId: 'mine', domain: 'alice.aglyn.app' })),
    )
    // And org A is untouched — it never learns this happened.
    expect(docs.get('hosts/alice')?.['cname']).toBe('alice-store.com')
  })

  it('REFUSES the platform’s own names, none of which are anybody’s cname', async () => {
    for (const reserved of [
      'www.aglyn.com',
      'aglyn.app',
      'www.aglyn.app',
      'aglyn.io',
      'app.aglyn.com',
    ]) {
      docs = new Map()
      seedHost('mine', { subdomain: 'mine' })
      fetchMock.mockClear()
      seedNameAlreadyOnOurProject()

      await expectRefused(await POST(post({ hostId: 'mine', domain: reserved })))
    }
  })

  it('REFUSES a name on a hosting suffix nobody can prove they own', async () => {
    // The console path has refused these since AGL-1353; this one never did.
    for (const shared of ['acme.vercel.app', 'acme.pages.dev', 'acme.github.io']) {
      docs = new Map()
      seedHost('mine', { subdomain: 'mine' })
      fetchMock.mockClear()
      seedNameAlreadyOnOurProject()

      await expectRefused(await POST(post({ hostId: 'mine', domain: shared })))
    }
  })

  it('REFUSES a value that is not a hostname at all', async () => {
    // `liveCustomDomain`'s own comment records that this route "lowercases and
    // trims what the wizard sends but never pattern-checks it, so a junk value
    // can reach Firestore". A junk value in a `Location:` header is a
    // different class of problem again.
    for (const junk of ['com', 'localhost', '-acme.com', 'acme..com', 'acme.c']) {
      docs = new Map()
      seedHost('mine', { subdomain: 'mine' })
      fetchMock.mockClear()

      const response = await POST(post({ hostId: 'mine', domain: junk }))
      expect(response.status).toBe(400)
      expect(docs.get('hosts/mine')?.['cname']).toBeUndefined()
      expect(fetchMock).not.toHaveBeenCalled()
    }
  })

  it('still accepts an ordinary customer domain, and normalises a pasted URL', async () => {
    // Without this control every test above passes against a route that
    // refuses everything, which is a wizard that can never connect anything.
    seedHost('mine', { subdomain: 'mine' })
    mockProjectDomainStatus.mockResolvedValue({
      state: 'serving',
      domain: 'example.com',
      verification: [],
      conflicts: [],
    })

    const response = await POST(
      post({ hostId: 'mine', domain: '  HTTPS://Example.com/path?x=1  ' }),
    )

    expect(response.status).toBe(200)
    expect(docs.get('hosts/mine')?.['cname']).toBe('example.com')
    // The NORMALISED name is what reaches Vercel and what the edge redirect
    // targets — a route that claimed `example.com` and attached the raw string
    // would break the correspondence in the other direction.
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({
      name: 'example.com',
    })
    expect(JSON.parse(String(redirectCalls()[0][1].body))).toEqual({
      name: 'mine.aglyn.app',
      redirect: 'example.com',
      redirectStatusCode: 307,
    })
  })

  it('accepts a multi-label public suffix domain — acme.co.uk is a real domain', async () => {
    seedHost('mine', { subdomain: 'mine' })
    mockProjectDomainStatus.mockResolvedValue({
      state: 'serving',
      domain: 'acme.co.uk',
      verification: [],
      conflicts: [],
    })
    const response = await POST(post({ hostId: 'mine', domain: 'acme.co.uk' }))
    expect(response.status).toBe(200)
    expect(docs.get('hosts/mine')?.['cname']).toBe('acme.co.uk')
  })
})


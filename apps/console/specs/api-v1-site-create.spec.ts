/**
 * @jest-environment node
 *
 * Pragma must stay in the FIRST block comment — behind the license header it is
 * silently ignored, and this suite needs `Request`/`Response`.
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
 * AGL-2465 — `POST /v1/sites`.
 *
 * Everything downstream of a site was automatable and creating the site was
 * not: `handleSites` 405'd every non-GET, so an agency onboarding a client
 * could push its datasets, contacts and media over `/v1` and still had to open
 * a browser to make the site those things go in.
 *
 * The blocker was never the endpoint, it was replay-safety. `hosts/create`
 * mints its `hostId` with `createResourceUid()`, so a POST that succeeded
 * server-side but lost its response created a SECOND site on retry — and site
 * creation is the most expensive object here to duplicate: a `hostLimit` slot,
 * a `hostIndex` write, and `syncOrgAuthProjections` across every member. The
 * only thing preventing it was accidental (the retry reused the same subdomain
 * and 409'd on uniqueness), and a client generating a subdomain per attempt
 * lost even that.
 *
 * ## What each block has to prove, and what would make it lie
 *
 * - **The replay returns the SAME site and creates only one.** Asserting a
 *   `200` on the second call is satisfied by a handler that creates a second
 *   site and reports it cheerfully, so the host-document COUNT is asserted
 *   alongside the id. The negative control is the same pair of calls with no
 *   key, which must create two — without it, a handler that refuses every
 *   second POST would pass.
 * - **The stored response, not a fresh read.** The replay is asserted after
 *   the site has been deleted underneath it. A lookup-based implementation
 *   passes the plain replay test and falls through to a second create here.
 * - **A deterministic 400 never takes the key.** Asserted by fixing the body
 *   and retrying with the SAME key, which must then create — the published
 *   contract, and the thing that makes a key safe to generate per logical
 *   operation rather than per attempt.
 * - **Every conditional refusal releases it.** Quota, subdomain and budget
 *   refusals all clear on their own, so the retry that should finally succeed
 *   must not be answered with a replay of the refusal (AGL-2296).
 * - **The gate is wired.** The negative control leads: the same request with
 *   the scope succeeds. `sites:read` is tried explicitly, because a create
 *   gated on the read scope would pass a test that only checks "some scope is
 *   required".
 * - **The budget is per ORG.** A key has no uid and no stable IP, so the
 *   console's per-uid limiter has no translation. The limiter key is asserted
 *   literally — a budget keyed on the API key would let one org mint ten keys
 *   and multiply a name-grab across a global subdomain namespace.
 */

interface Doc {
  path: string
  data: Record<string, unknown>
}

const mockDocs = new Map<string, Record<string, unknown>>()
let mockOrg: Record<string, unknown> = { plan: 'business', hosts: {} }
let mockScopes: string[] = ['sites:write']
let mockRateCalls: Array<{ key: string; limit?: number; windowMs?: number }> = []
let mockRateRefuse = new Set<string>()
let mockRegisterCalls: Array<[string, string, string]> = []
/** Armed by the race tests; fires once, between the pre-check and the transaction. */
let mockBeforeTransaction: (() => void) | null = null

const docsUnder = (collection: string): Doc[] =>
  [...mockDocs.entries()]
    .filter(([path]) => path.startsWith(`${collection}/`) && path.split('/').length === 2)
    .map(([path, data]) => ({ path, data }))

function snapshotFor(path: string) {
  return {
    id: path.slice(path.lastIndexOf('/') + 1),
    ref: mockDocRef(path),
    exists: mockDocs.has(path),
    data: () => mockDocs.get(path),
    get: (field: string) => mockDocs.get(path)?.[field],
  }
}

function mockDocRef(path: string): any {
  return {
    path,
    id: path.slice(path.lastIndexOf('/') + 1),
    collection: (name: string) => mockCollectionRef(`${path}/${name}`),
    get: async () => snapshotFor(path),
    /**
     * Rejects when the document already exists — that rejection IS the
     * idempotency dedupe primitive, so a double that overwrote instead would
     * make every replay test pass for the wrong reason.
     */
    create: async (data: Record<string, unknown>) => {
      if (mockDocs.has(path)) throw new Error(`ALREADY_EXISTS: ${path}`)
      mockDocs.set(path, { ...data })
    },
    set: async (data: Record<string, unknown>, options?: { merge?: boolean }) => {
      mockDocs.set(path, {
        ...(options?.merge ? (mockDocs.get(path) ?? {}) : {}),
        ...data,
      })
    },
    delete: async () => {
      mockDocs.delete(path)
    },
  }
}

function query(collection: string, filters: Array<[string, unknown]>): any {
  const matches = () =>
    docsUnder(collection).filter((doc) =>
      filters.every(([field, value]) => doc.data[field] === value),
    )
  return {
    where: (field: string, _op: string, value: unknown) =>
      query(collection, [...filters, [field, value]]),
    limit: () => query(collection, filters),
    count: () => ({ get: async () => ({ data: () => ({ count: matches().length }) }) }),
    get: async () => {
      const found = matches()
      return {
        empty: found.length === 0,
        docs: found.map((doc) => snapshotFor(doc.path)),
      }
    },
  }
}

function mockCollectionRef(path: string): any {
  return {
    path,
    doc: (id: string) => mockDocRef(`${path}/${id}`),
    where: (field: string, _op: string, value: unknown) => query(path, [[field, value]]),
    count: () => query(path, []).count(),
  }
}

const mockFirestore: any = {
  collection: (name: string) => mockCollectionRef(name),
  /**
   * The batched, projected read the site list issues. The field mask is
   * APPLIED rather than ignored: the list case below asserts the whole
   * resource, so a projection that dropped one of its fields must show up
   * here as a `null`, not as a document that happens to carry everything.
   */
  getAll: async (...args: any[]) => {
    const last = args[args.length - 1]
    const options =
      last && typeof last === 'object' && 'fieldMask' in last ? last : undefined
    const refs = options ? args.slice(0, -1) : args
    return refs.map((ref: any) => {
      const snapshot = snapshotFor(ref.path)
      if (!options?.fieldMask) return snapshot
      const stored = mockDocs.get(ref.path)
      const projected =
        stored === undefined
          ? undefined
          : Object.fromEntries(
              options.fieldMask
                .filter((field: string) => field in stored)
                .map((field: string) => [field, stored[field]]),
            )
      return { ...snapshot, data: () => projected }
    })
  },
  /** Resolves with the updateFunction's value, as the real one does. */
  runTransaction: async <T,>(work: (tx: any) => Promise<T>): Promise<T> => {
    // The race window, staged: a one-shot hook that fires after the caller's
    // out-of-transaction pre-check and before the transaction body, which is
    // exactly where a competing create commits (AGL-2465). Nothing else in
    // this file uses it, so it is inert unless a test arms it.
    const arrive = mockBeforeTransaction
    mockBeforeTransaction = null
    if (arrive) arrive()
    const tx = {
      /**
       * Overloaded exactly as the real `Transaction.get` is — a document
       * reference or a QUERY. `claimHostForOrg` re-reads subdomain uniqueness
       * inside the transaction (AGL-2465), so a doc-only double would throw
       * and every create here would 500. A query has no `path`.
       */
      get: async (target: any) =>
        target?.path ? snapshotFor(target.path) : await target.get(),
      set: (
        ref: { path: string },
        data: Record<string, unknown>,
        options?: { merge?: boolean },
      ) => {
        const prior = options?.merge ? (mockDocs.get(ref.path) ?? {}) : {}
        const merged: Record<string, unknown> = { ...prior, ...data }
        // Deep-merge the `hosts` map specifically: `claimHostForOrg` relies on
        // `set(…, { merge: true })` adding one key without dropping the rest,
        // and a shallow double would hide a directory it had clobbered.
        if (options?.merge && prior['hosts'] && data['hosts']) {
          merged['hosts'] = {
            ...(prior['hosts'] as object),
            ...(data['hosts'] as object),
          }
        }
        mockDocs.set(ref.path, merged)
      },
      update: (ref: { path: string }, patch: Record<string, unknown>) => {
        mockDocs.set(ref.path, { ...(mockDocs.get(ref.path) ?? {}), ...patch })
      },
    }
    return await work(tx)
  },
}

jest.mock('@aglyn/tenant-data-admin', () => {
  const apiHttp = jest.requireActual(
    '../../../libs/tenant/data/admin/src/lib/server/api-http',
  )
  return {
    __esModule: true,
    ...apiHttp,
    verifyApiKey: async () => ({ orgId: 'org-1', keyId: 'key-1', scopes: mockScopes }),
    getOrgDoc: async () => mockOrg,
    lockdownRefusal: async () => null,
    registerOrgHost: async (orgId: string, hostId: string, subdomain: string) => {
      mockRegisterCalls.push([orgId, hostId, subdomain])
      const org = mockDocs.get(`orgs/${orgId}`) ?? {}
      mockDocs.set(`orgs/${orgId}`, {
        ...org,
        hosts: { ...((org['hosts'] as object) ?? {}), [hostId]: true },
      })
      mockDocs.set(`hostIndex/${hostId}`, { orgId, subdomain })
    },
    consumeRateLimit: async (
      key: string,
      options?: { limit?: number; windowMs?: number },
    ) => {
      mockRateCalls.push({ key, limit: options?.limit, windowMs: options?.windowMs })
      const allowed = !mockRateRefuse.has(key)
      return {
        allowed,
        limit: options?.limit ?? 120,
        remaining: allowed ? 119 : 0,
        resetMs: Date.now() + (options?.windowMs ?? 60_000),
        degraded: false,
        contended: false,
      }
    },
    firebaseAdmin: {
      app: () => ({ firestore: () => mockFirestore }),
      firestore: { FieldValue: { increment: (n: number) => n, serverTimestamp: () => 'NOW' } },
    },
  }
})

jest.mock('@aglyn/aglyn/server', () => ({
  __esModule: true,
  ...jest.requireActual('../../../libs/aglyn/src/lib/app-utils/plan-entitlements'),
  ...jest.requireActual('../../../libs/aglyn/src/lib/app-utils/host-naming'),
  ...jest.requireActual('../../../libs/aglyn/src/lib/app-utils/create-resource-uid'),
  // The REAL claim primitive. Stubbing it would make every replay assertion
  // below a test of the stub.
  ...jest.requireActual('../../../libs/aglyn/src/lib/app-utils/api-idempotency'),
  PLATFORM_BRAND_NAME: 'Aglyn',
}))

jest.mock('firebase-admin/firestore', () => ({
  __esModule: true,
  FieldPath: { documentId: () => '__name__' },
  Timestamp: class {},
}))

import { GET, POST } from '../app/api/v1/[[...route]]/route'

const routeContext = (segments: string[]) => ({
  params: Promise.resolve({ route: segments }),
})

const create = (
  body: Record<string, unknown>,
  idempotencyKey?: string,
): Promise<Response> => {
  const headers: Record<string, string> = {
    authorization: 'Bearer k',
    'content-type': 'application/json',
  }
  if (idempotencyKey) headers['Idempotency-Key'] = idempotencyKey
  return POST(
    new Request('https://app.aglyn.com/api/v1/sites', {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
    }),
    routeContext(['sites']),
  )
}

/** Host documents that actually exist — the count a duplicate would move. */
const hostDocs = () => docsUnder('hosts')

const good = { displayName: 'Demo Bakery', subdomain: 'demo-bakery' }

beforeEach(() => {
  mockDocs.clear()
  mockOrg = { plan: 'business', hosts: {} }
  mockScopes = ['sites:write']
  mockRateCalls = []
  mockRateRefuse = new Set()
  mockRegisterCalls = []
  mockBeforeTransaction = null
  mockDocs.set('orgs/org-1', { plan: 'business', hosts: {} })
})

/** A competitor commits the same subdomain inside the race window. */
const competitorTakes = (subdomain: string, id = 'rival-host') => {
  mockBeforeTransaction = () => {
    mockDocs.set(`hosts/${id}`, { subdomain, orgId: 'org-other', displayName: 'Rival' })
  }
}

describe('losing the subdomain race is a 409, not a duplicate (AGL-2465)', () => {
  /**
   * The idempotency key closes the RETRY shape. It cannot close two DIFFERENT
   * attempts racing — different keys, or the keyless console path — because
   * they hash to different digests and neither is a replay of the other. What
   * stops those is the uniqueness re-read inside `claimHostForOrg`'s
   * transaction; these tests drive the handler's half of it.
   */
  it('answers 409 subdomain_taken when the name is taken mid-flight', async () => {
    competitorTakes('demo-bakery')
    const res = await create(good, 'key-a')
    const body = await res.json()

    expect(res.status).toBe(409)
    expect(body.error.code).toBe('subdomain_taken')
    // The verdict is the STORED state: the rival's document, and nothing else.
    expect(hostDocs()).toHaveLength(1)
    expect(hostDocs()[0].path).toBe('hosts/rival-host')
    // No projection fan-out for a site that was never created.
    expect(mockRegisterCalls).toEqual([])
  })

  it('is a 409, NOT the quota 403 — the org had room to spare', async () => {
    competitorTakes('demo-bakery')
    const body = await (await create(good, 'key-a')).json()
    expect(body.error.code).not.toBe('site_quota')
    expect(body.error.message).toContain('taken')
  })

  it('releases the key, so the retry under a NEW name still succeeds', async () => {
    competitorTakes('demo-bakery')
    expect((await create(good, 'key-a')).status).toBe(409)
    // Same key, corrected name — a burnt key would replay the 409 forever.
    const retry = await create(
      { displayName: 'Demo Bakery', subdomain: 'demo-bakery-2' },
      'key-a',
    )
    expect(retry.status).toBe(201)
    expect((await retry.json()).subdomain).toBe('demo-bakery-2')
  })

  it('and the org directory never claimed a slot for the loser', async () => {
    competitorTakes('demo-bakery')
    await create(good, 'key-a')
    expect(mockDocs.get('orgs/org-1')?.['hosts']).toEqual({})
  })
})

describe('POST /v1/sites provisions a site (AGL-2465)', () => {
  it('creates one, and returns 201 with the site object', async () => {
    const res = await create(good, 'key-a')
    const body = await res.json()

    expect(res.status).toBe(201)
    expect(body).toMatchObject({
      object: 'site',
      displayName: 'Demo Bakery',
      subdomain: 'demo-bakery',
    })
    expect(typeof body.id).toBe('string')
    expect(hostDocs()).toHaveLength(1)
    // The routing mirror and the member projections, not just the host doc.
    expect(mockRegisterCalls).toEqual([['org-1', body.id, 'demo-bakery']])
    expect(mockDocs.get(`hostIndex/${body.id}`)).toEqual({
      orgId: 'org-1',
      subdomain: 'demo-bakery',
    })
    // The org directory claim, which is what makes a concurrent create lose.
    expect((mockDocs.get('orgs/org-1')?.['hosts'] as object)[body.id]).toBe(true)
  })
})

describe('the replay is the point (AGL-2465)', () => {
  it('replays the SAME site on a retry, and creates only one', async () => {
    const first = await create(good, 'key-a')
    const firstBody = await first.json()

    // The retry an integrator makes after a dropped connection: same key, and
    // — the case that used to be unprotected — a DIFFERENT subdomain, so the
    // accidental uniqueness 409 cannot be what saves us.
    const second = await create(
      { displayName: 'Demo Bakery', subdomain: 'demo-bakery-2' },
      'key-a',
    )
    const secondBody = await second.json()

    expect(first.status).toBe(201)
    // 200 rather than 201, so a client can tell a replay from a create.
    expect(second.status).toBe(200)
    expect(secondBody.id).toBe(firstBody.id)
    expect(secondBody.subdomain).toBe('demo-bakery')
    // THE ASSERTION THAT MATTERS. A handler that cheerfully created a second
    // site and echoed it back would satisfy every status check above.
    expect(hostDocs()).toHaveLength(1)
    expect(mockRegisterCalls).toHaveLength(1)
  })

  it('THE NEGATIVE CONTROL: without a key, two POSTs really do create two', async () => {
    // Without this, a handler that refused every second POST — or one that
    // deduplicated on the subdomain — would pass the replay test above.
    await create(good)
    await create({ displayName: 'Demo Bakery', subdomain: 'demo-bakery-2' })

    expect(hostDocs()).toHaveLength(2)
  })

  it('replays from the STORED response, so it survives the site being deleted', async () => {
    const first = await create(good, 'key-a')
    const firstBody = await first.json()

    // The site is deleted underneath the key — the exact case a lookup-based
    // implementation gets wrong: it finds nothing and falls through to a
    // SECOND create.
    mockDocs.delete(`hosts/${firstBody.id}`)

    const replay = await create(good, 'key-a')
    expect(replay.status).toBe(200)
    expect((await replay.json()).id).toBe(firstBody.id)
    expect(hostDocs()).toHaveLength(0)
  })

  it('answers a still-in-flight key with 409 idempotency_in_progress', async () => {
    // A claim that was taken and never settled — a crashed first attempt.
    // Fails CLOSED: better a retryable 409 than a second site.
    const first = await create(good, 'key-a')
    await first.json()
    const claimPath = [...mockDocs.keys()].find((path) =>
      path.startsWith('apiIdempotency/'),
    )
    mockDocs.set(claimPath as string, {
      ...(mockDocs.get(claimPath as string) as object),
      status: 'pending',
      response: undefined,
      responseStatus: undefined,
    })
    delete (mockDocs.get(claimPath as string) as Record<string, unknown>)['response']

    const second = await create(good, 'key-a')
    expect(second.status).toBe(409)
    expect((await second.json()).error.code).toBe('idempotency_in_progress')
    expect(hostDocs()).toHaveLength(1)
  })
})

describe('which refusals take the key, and which give it back (AGL-2465)', () => {
  it('a validation 400 never takes the key at all', async () => {
    const bad = await create({ displayName: '', subdomain: 'NOPE!' }, 'key-a')
    expect(bad.status).toBe(400)
    const badBody = await bad.json()
    expect(badBody.error.code).toBe('validation_failed')
    expect(Object.keys(badBody.error.fields)).toEqual(['displayName', 'subdomain'])
    expect(mockDocs.has('apiIdempotency')).toBe(false)

    // The published contract: fix the body, retry with the SAME key, get a
    // site. A 400 that burned the key would answer this with a replay.
    const fixed = await create(good, 'key-a')
    expect(fixed.status).toBe(201)
    expect(hostDocs()).toHaveLength(1)
  })

  it('refuses a reserved subdomain, and still has not taken the key', async () => {
    const res = await create({ displayName: 'Demo', subdomain: 'admin' }, 'key-a')
    expect(res.status).toBe(400)
    expect((await res.json()).error.fields.subdomain).toMatch(/reserved/i)

    const fixed = await create(good, 'key-a')
    expect(fixed.status).toBe(201)
  })

  it('releases the key on a quota refusal, so the added-sites retry succeeds', async () => {
    // A BUSINESS org — it must keep API access throughout, or the 403 under
    // test is the `apiAccess` entitlement gate rather than the site quota,
    // and the retry would fail for the wrong reason. Business `hostLimit` is
    // 10, so ten existing sites is exactly at the ceiling.
    const hosts: Record<string, boolean> = {}
    for (let index = 0; index < 10; index += 1) {
      hosts[`host-${index}`] = true
      mockDocs.set(`hosts/host-${index}`, {
        orgId: 'org-1',
        subdomain: `taken-${index}`,
      })
    }
    mockOrg = { plan: 'business', hosts }
    mockDocs.set('orgs/org-1', mockOrg)

    const refused = await create(good, 'key-a')
    expect(refused.status).toBe(403)
    const refusedBody = await refused.json()
    expect(refusedBody.error.code).toBe('site_quota')
    expect(refusedBody.error.message).toMatch(/Site limit reached \(10\)/)
    expect(hostDocs()).toHaveLength(10)

    // Extra sites bought (`seatAddons.hosts`, the add-on the Billing page
    // sells). The same key must now CREATE, not replay the 403.
    mockOrg = { plan: 'business', hosts, seatAddons: { hosts: 5 } }
    mockDocs.set('orgs/org-1', mockOrg)
    const after = await create(good, 'key-a')
    expect(after.status).toBe(201)
    expect(hostDocs()).toHaveLength(11)
  })

  it('releases the key when the subdomain is taken, and names alternatives', async () => {
    mockDocs.set('hosts/host-other', { orgId: 'org-9', subdomain: 'demo-bakery' })

    const refused = await create(good, 'key-a')
    expect(refused.status).toBe(409)
    const body = await refused.json()
    expect(body.error.code).toBe('subdomain_taken')
    expect(body.error.message).toMatch(/demo-bakery-2/)

    // Freed upstream; the retry that should now succeed must not replay.
    mockDocs.delete('hosts/host-other')
    const after = await create(good, 'key-a')
    expect(after.status).toBe(201)
  })
})

describe('the create budget is per ORG, not per key (AGL-2465)', () => {
  it('spends a durable per-org budget, keyed literally', async () => {
    await create(good, 'key-a')
    expect(mockRateCalls).toContainEqual({
      key: 'apiv1-site-create:org-1',
      limit: 10,
      windowMs: 60 * 60 * 1000,
    })
  })

  it('refuses over budget with Retry-After, creates nothing, and frees the key', async () => {
    mockRateRefuse = new Set(['apiv1-site-create:org-1'])
    const refused = await create(good, 'key-a')

    expect(refused.status).toBe(429)
    expect(Number(refused.headers.get('Retry-After'))).toBeGreaterThan(0)
    // A 429 that still provisioned would be the bug wearing a status code.
    expect(hostDocs()).toHaveLength(0)
    expect(mockRegisterCalls).toHaveLength(0)

    mockRateRefuse = new Set()
    const after = await create(good, 'key-a')
    expect(after.status).toBe(201)
  })
})

describe('the scope gate is wired (AGL-2465)', () => {
  it('THE CONTROL: the same request with sites:write succeeds', async () => {
    mockScopes = ['sites:write']
    expect((await create(good, 'key-a')).status).toBe(201)
  })

  it('refuses a key without sites:write', async () => {
    mockScopes = ['sites:read', 'datasets:write']
    const res = await create(good, 'key-a')

    expect(res.status).toBe(403)
    const body = await res.json()
    expect(body.error.type).toBe('insufficient_scope')
    expect(body.error.code).toBe('sites:write')
    expect(hostDocs()).toHaveLength(0)
    // The refusal must not have spent the org's CREATE budget — otherwise an
    // unauthorized caller can starve the org from outside it. (The per-key
    // request limiter above dispatch is a different budget and does run.)
    expect(mockRateCalls.map((call) => call.key)).not.toContain(
      'apiv1-site-create:org-1',
    )
  })

  it('sites:read alone is not enough — a create is not a read', async () => {
    mockScopes = ['sites:read']
    const res = await create(good, 'key-a')
    expect(res.status).toBe(403)
    expect((await res.json()).error.code).toBe('sites:write')
  })

  it('still lists with sites:read, so the write gate did not break the read', async () => {
    mockScopes = ['sites:read']
    mockOrg = { plan: 'business', hosts: { 'host-1': true } }
    mockDocs.set('hosts/host-1', { subdomain: 'demo', displayName: 'Demo' })

    const res = await GET(
      new Request('https://app.aglyn.com/api/v1/sites', {
        headers: { authorization: 'Bearer k' },
      }),
      routeContext(['sites']),
    )

    expect(res.status).toBe(200)
    expect((await res.json()).data).toEqual([
      { id: 'host-1', object: 'site', displayName: 'Demo', subdomain: 'demo', domain: null },
    ])
  })
})

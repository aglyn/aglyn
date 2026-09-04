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
 * The free plan's `hostLimit: 1` must be a HARD CAP under concurrency, not
 * only in the sequential case (AGL-2063).
 *
 * The free/hobby tier hard-caps, so that it always actually stays free.
 *
 * `/api/hosts/create` is the ONLY route in the product that mints a
 * `hosts/{id}` document — client creation is `allow create: if false` in
 * `cloud/firebase-firestore.rules`. It counted the org's sites with an
 * aggregation query and then wrote the new site with an unconditional `.set()`
 * on a fresh random id, so the count and the write were two separate steps
 * with a window between them. Concurrent POSTs all read the same count, all
 * passed the quota, and all created — the create-time-quota shape this
 * codebase keeps relearning. Each extra site carries
 * `INFRA_COGS_PER_SITE_USD` a month against an org with no invoice.
 *
 * ## Why the assertions are shaped this way
 *
 * A test that POSTs once and expects 403 proves only that a constant exists.
 * These drive the RACE: several creates are put in flight against the same
 * org and the suite asserts how many 200s came back and how many `hosts/*`
 * documents exist afterwards. The inverse fixture (a plan with room) is
 * asserted too, so a route that simply refused everything could not pass.
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
  const makeDoc = (path: string) => ({
    path,
    id: path.split('/').pop(),
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
      return { empty: docs.length === 0, docs: docs.map(([path]) => makeDoc(path)) }
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

/**
 * Stands in for `FreeWorkspaceCapError` — the class the route's catch arm
 * discriminates on (AGL-2265).
 *
 * Declared here rather than reached through `jest.requireActual`, because the
 * defining file imports `firebase-admin.ts`, which initializes the admin app
 * on load.
 */
class MockFreeWorkspaceCapError extends Error {
  limit: number
  held: number
  constructor(limit: number, held: number) {
    super(`Free workspace ceiling reached: ${held} of ${limit}`)
    this.name = 'FreeWorkspaceCapError'
    this.limit = limit
    this.held = held
  }
}

/** What `ensureOrgForUser` does when a create arrives with no `orgId`. */
const mockEnsureOrgForUser = jest.fn(async () => ({
  orgId: 'org-1',
  member: { role: 'owner' },
}))

jest.mock('@aglyn/tenant-data-admin', () => ({
  /*
   * The site's sending-domain CLAIM, made at creation so the mail label is
   * pinned from the name the site was created under.
   *
   * Stubbed to a no-op here: these specs are about the host-creation
   * transaction, and the claim is deliberately best-effort and after it — a
   * create must not fail because a mail claim did. What the claim actually
   * does is proved in `host-sending-domain.spec.ts`.
   */
  ensureHostSendingDomain: async () => ({
    domain: null,
    label: null,
    created: false,
    error: null,
  }),
  __esModule: true,
  firebaseAdmin: {
    app: () => ({
      auth: () => ({ verifyIdToken: mockVerifyIdToken }),
      firestore: () => mockMakeFirestore(),
    }),
    firestore: {
      FieldValue: { serverTimestamp: () => '__now__' },
    },
  },
  isImpersonationSession: () => false,
  emailUnverifiedResponse: () =>
    Response.json({ error: 'unverified' }, { status: 403 }),
  resolveOrgMembership: async (_uid: string, orgId: string) => ({
    orgId,
    member: { role: 'owner' },
  }),
  ensureOrgForUser: () => mockEnsureOrgForUser(),
  /**
   * The AGL-2265 ceiling refusal, MODELED rather than stubbed.
   *
   * The route's catch arm BRANCHES on this return value, and both lazy stubs
   * read green while removing a guard. A constant `null` sends a real ceiling
   * refusal into the generic "Site creation failed" 500, which any assertion
   * looser than an exact status still accepts. A constant `Response` is worse:
   * every unrelated fault in the handler would answer 403 and this file's
   * quota assertions would report a working cap over a crashing route.
   *
   * So it discriminates on what the real one discriminates on — that error
   * class and nothing else — and answers with the same status and `code`.
   */
  freeWorkspaceCapRefusalResponse: (error: unknown) =>
    error instanceof MockFreeWorkspaceCapError
      ? Response.json(
          {
            error:
              `You already have ${error.held} free workspaces, which is the ` +
              `limit of ${error.limit}.`,
            code: 'free_workspace_limit',
            limit: error.limit,
            held: error.held,
          },
          { status: 403 },
        )
      : null,
  // The route writes the new site's first activity entry (AGL-118). The real
  // one swallows its own failures and resolves with nothing, and the route
  // does not branch on it, so a no-op IS the contract. Named explicitly
  // because this factory is a closed world: an absent export is `undefined`,
  // and the route throws on the success path this file's controls depend on.
  logHostActivity: async () => undefined,
  lockdownRefusal: async () => null,
  registerOrgHost: async () => undefined,
  /**
   * Models the REAL function (AGL-2350): it delegates to the same granular
   * resolver production calls, so a member's role, custom role and overrides
   * decide the answer rather than a convenient constant. `null` custom role
   * because this spec stores no `orgs/{id}/roles` docs and its members carry
   * no `roleId`.
   */
  memberHasOrgPermission: async (
    _orgId: string,
    member: Record<string, unknown> | null | undefined,
    permission: string,
  ) => mockHasOrgPermission(member as never, permission as never, null),
  // The AGL-1968 rate limiter. Always allows here: this spec is about the
  // AGL-2063 quota transaction, and a limiter that could refuse would make
  // the concurrency assertions below depend on which racer burnt the last
  // token. The limiter's own refusal arms are driven in
  // `host-create-rate-limit.spec.ts`.
  consumeRateLimit: async () => ({
    allowed: true,
    limit: 20,
    remaining: 19,
    resetMs: Date.now() + 60 * 60 * 1000,
    degraded: false,
  }),
}))

const { POST } = require('../app/api/hosts/create/route') as {
  POST: (request: Request) => Promise<Response>
}

const ORG = 'org-1'

const create = (subdomain: string) =>
  POST(
    new Request('https://console.aglyn.com/api/hosts/create', {
      method: 'POST',
      headers: {
        authorization: 'Bearer token',
        'content-type': 'application/json',
      },
      body: JSON.stringify({ displayName: 'Site', subdomain, orgId: ORG }),
    }),
  )

/**
 * The same create with NO `orgId` — the shape that makes the route auto-create
 * the workspace through `ensureOrgForUser`, and so the only shape that can
 * reach the free-workspace ceiling.
 */
const createWithoutOrg = (subdomain: string) =>
  POST(
    new Request('https://console.aglyn.com/api/hosts/create', {
      method: 'POST',
      headers: {
        authorization: 'Bearer token',
        'content-type': 'application/json',
      },
      body: JSON.stringify({ displayName: 'Site', subdomain }),
    }),
  )

const siteCount = () =>
  [...mockDocs.keys()].filter(
    (path) => path.startsWith('hosts/') && path.split('/').length === 2,
  ).length

beforeEach(() => {
  mockDocs = new Map()
  mockTxChain = Promise.resolve()
  mockEnsureOrgForUser.mockClear()
})

describe('a free org cannot exceed hostLimit, however many creates race', () => {
  it('lets the FIRST site through — the guard is not simply "no"', async () => {
    mockDocs.set(`orgs/${ORG}`, { plan: 'free' })
    const response = await create('alpha')
    expect(response.status).toBe(200)
    expect(siteCount()).toBe(1)
    // And the directory claim the next attempt will be refused by.
    expect(mockDocs.get(`orgs/${ORG}`)?.['hosts']).toEqual(
      expect.objectContaining({}),
    )
  })

  it('refuses the SECOND, sequentially', async () => {
    mockDocs.set(`orgs/${ORG}`, { plan: 'free' })
    expect((await create('alpha')).status).toBe(200)
    const second = await create('beta')
    expect(second.status).toBe(403)
    expect(String((await second.json()).error)).toContain('Site limit reached')
    expect(siteCount()).toBe(1)
  })

  it('THE FAIL-OPEN: six simultaneous creates still yield exactly one site', async () => {
    // Before the transaction every one of these read `count: 0`, passed the
    // quota, and wrote its own random host id — six sites on a plan that
    // includes one, each costing INFRA_COGS_PER_SITE_USD a month.
    mockDocs.set(`orgs/${ORG}`, { plan: 'free' })
    const responses = await Promise.all(
      ['one-a', 'two-a', 'six-a', 'ten-a', 'sev-a', 'fiv-a'].map((name) => create(name)),
    )
    expect(responses.filter((r) => r.status === 200)).toHaveLength(1)
    expect(responses.filter((r) => r.status === 403)).toHaveLength(5)
    expect(siteCount()).toBe(1)
  })

  it('GUARD IS LIVE: the same six all land on a plan that includes six', async () => {
    // The inverse fixture. Without it the assertion above is satisfied by a
    // route that refuses every concurrent create, which would be a different
    // bug wearing the same green.
    mockDocs.set(`orgs/${ORG}`, {
      plan: 'free',
      entitlements: { hostLimit: 6 },
    })
    const responses = await Promise.all(
      ['one-b', 'two-b', 'six-b', 'ten-b', 'sev-b', 'fiv-b'].map((name) => create(name)),
    )
    expect(responses.filter((r) => r.status === 200)).toHaveLength(6)
    expect(siteCount()).toBe(6)
  })

  it('counts sites that predate the directory map', async () => {
    // The map is authoritative for concurrency; the aggregation is
    // authoritative for history. An org whose only site was created before
    // `orgs/{id}.hosts` existed must still read as one site, not zero.
    mockDocs.set(`orgs/${ORG}`, { plan: 'free' })
    mockDocs.set('hosts/legacy-1', { orgId: ORG, subdomain: 'legacy' })
    const response = await create('another')
    expect(response.status).toBe(403)
    expect(siteCount()).toBe(1)
  })

  it('an org with no plan is capped as free, not left unmetered', async () => {
    mockDocs.set(`orgs/${ORG}`, {})
    expect((await create('alpha')).status).toBe(200)
    expect((await create('beta')).status).toBe(403)
  })
})

/**
 * The OTHER free-tier ceiling this one route can hit (AGL-2265).
 *
 * A create that carries no `orgId` makes a workspace on its way to making a
 * site, so the free-workspace ceiling is refused from inside `hosts/create`
 * and arrives as a thrown `FreeWorkspaceCapError`, not a return value. The
 * route turns it back into the ceiling's own 403 in its catch block — one
 * line, sitting next to the generic 500, which is exactly where a guard goes
 * quiet without anything going red.
 */
describe('the free WORKSPACE ceiling refuses from here too', () => {
  it('answers the ceiling’s own 403, not "Site creation failed"', async () => {
    mockDocs.set(`orgs/${ORG}`, { plan: 'free' })
    mockEnsureOrgForUser.mockRejectedValueOnce(
      new MockFreeWorkspaceCapError(3, 3),
    )

    const response = await createWithoutOrg('gamma')

    expect(response.status).toBe(403)
    await expect(response.json()).resolves.toMatchObject({
      code: 'free_workspace_limit',
      limit: 3,
      held: 3,
    })
    expect(siteCount()).toBe(0)
  })

  it('does NOT launder an unrelated fault into a ceiling refusal', async () => {
    // The inverse fixture. Without it the assertion above is satisfied by a
    // catch block that answers 403 to everything, which would report a
    // working ceiling over a route that had stopped working at all.
    mockDocs.set(`orgs/${ORG}`, { plan: 'free' })
    mockEnsureOrgForUser.mockRejectedValueOnce(new Error('firestore is down'))
    const logged = jest.spyOn(console, 'error').mockImplementation(() => undefined)

    try {
      const response = await createWithoutOrg('delta')

      expect(response.status).toBe(500)
      await expect(response.json()).resolves.toMatchObject({
        error: 'Site creation failed',
      })
      expect(siteCount()).toBe(0)
    } finally {
      logged.mockRestore()
    }
  })
})

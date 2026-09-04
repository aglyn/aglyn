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
 * AGL-1360: WEBHOOK_MAX_PER_HOST enforced in /api/hosts/resources.
 *
 * The card used to enforce the cap by counting the rows it held from a
 * Firestore listener. The console runs `persistentLocalCache`, so that count
 * could be arbitrarily old and low and a site could exceed the cap. These
 * assertions are all about the half a stale client cannot be trusted with:
 * the route never receives a count, so there is no stale number for it to
 * believe — it reads the collection itself, every time.
 *
 * The REAL `checkQuota`/`checkEntitlement` are wired in on purpose (only
 * `pluginRequestFromWeb` is faked), and the created docs are asserted by
 * payload, so a route that stopped calling the cap would fail here.
 */

const mockVerifyIdToken = jest.fn()
const mockCreate = jest.fn()

interface FakeWebhook {
  name?: string
  deletedAt?: unknown
  [field: string]: unknown
}

const state: {
  memberRoles: Record<string, string>
  org: Record<string, unknown>
  webhooks: Array<FakeWebhook>
  /** Field masks the route asked for, so we can prove it read the server. */
  selects: Array<Array<string>>
} = { memberRoles: {}, org: {}, webhooks: [], selects: [] }

const snapshotOf = (data: Record<string, unknown> | null) => ({
  exists: data !== null,
  data: () => data ?? undefined,
  get: (field: string) => (data ?? {})[field],
})

const webhooksCollection = () => ({
  select: (...fields: Array<string>) => {
    state.selects.push(fields)
    return {
      get: async () => ({
        docs: state.webhooks.map((hook, index) => ({
          id: `hook-${index}`,
          get: (field: string) => hook[field],
        })),
      }),
    }
  },
  count: () => ({
    get: async () => ({ data: () => ({ count: state.webhooks.length }) }),
  }),
  doc: () => ({ create: (...args: unknown[]) => mockCreate(...args) }),
})

/**
 * A faithful-enough `runTransaction` (AGL-2231). The route now counts and
 * creates inside one transaction, so a double that lacked this would fail for
 * the wrong reason — and one that ran the body without modelling Firestore's
 * rules would hide a regression that reorders the reads after the write.
 *
 * Two real semantics are modelled on purpose:
 *  - **reads must precede writes.** A `get` after a `create` throws, exactly as
 *    the server does.
 *  - **the write is deferred to a successful commit.** A body that returns a
 *    refusal (or throws) after buffering a create must persist nothing.
 *
 * Retries are NOT modelled here — a single-threaded route test has nothing to
 * contend with. The contention case has its own suite,
 * `host-resource-cap-is-atomic.spec.ts`, whose double does model them.
 */
const runTransaction = async (body: (tx: any) => Promise<any>) => {
  const buffered: Array<() => unknown> = []
  const tx = {
    get: (query: any) => {
      if (buffered.length) {
        throw new Error('Firestore transactions cannot read after a write')
      }
      return query.get()
    },
    create: (ref: any, data: unknown) => {
      buffered.push(() => ref.create(data))
    },
  }
  const result = await body(tx)
  for (const write of buffered) write()
  return result
}

/**
 * `after()` from `next/server` is how this route schedules post-response work
 * (AGL-2346), and outside a real request scope Next's own `after` throws — so
 * a direct handler invocation needs a double. This one records every scheduled
 * callback AND runs it inline, leaving every existing assertion (all of which
 * observe the effect) unchanged, while `mockAfterScheduled` becomes the
 * evidence that the work was SCHEDULED rather than fired and forgotten. Revert
 * the route to a bare `void promise` and this array stays empty.
 */
const mockAfterScheduled: Array<() => unknown> = []
jest.mock('next/server', () => ({
  after: (work: () => unknown) => {
    mockAfterScheduled.push(work)
    return work()
  },
}))

jest.mock('@aglyn/tenant-data-admin', () => ({
  __esModule: true,
  firebaseAdmin: {
    app: () => ({
      auth: () => ({
        verifyIdToken: (...args: unknown[]) => mockVerifyIdToken(...args),
      }),
      firestore: () => ({
        runTransaction: (body: (tx: any) => Promise<any>) =>
          runTransaction(body),
        collection: () => ({
          doc: () => ({
            get: async () => snapshotOf({ memberRoles: state.memberRoles }),
            collection: () => webhooksCollection(),
          }),
        }),
      }),
    }),
  },
  getOrgForHost: async () => ({ org: state.org }),
  // The route writes the site's own audit entry for a create (AGL-118). The
  // real one swallows its own failures and resolves with nothing, and the
  // route does not branch on it, so a no-op IS the contract rather than a
  // convenience. Named explicitly because this factory is a closed world: an
  // absent export is `undefined`, the route throws on the success path, and
  // the resulting 500 reads exactly like the cap under test regressing.
  logHostActivity: async () => undefined,
  isImpersonationSession: () => false,
  emailUnverifiedResponse: () =>
    Response.json({ error: 'Verify your email' }, { status: 403 }),
  // Lockdown (AGL-1501): the verdict's own logic is unit-tested in
  // libs/tenant/data/admin lockdown.spec.ts; this mirror keeps its contract
  // observable here — staff bypass, suspended org/host => locked (423).
  getLockdownVerdict: async (options: Record<string, any>) =>
    options?.staff === true
      ? null
      : options?.org?.suspendedAt != null
        ? { scope: 'org', reason: 'manual' }
        : options?.host?.suspendedAt != null
          ? { scope: 'host', reason: 'manual' }
          : null,
  lockdownJsonResponse: (state: Record<string, unknown>) =>
    Response.json({ error: 'locked', ...state }, { status: 423 }),
}))

jest.mock('@aglyn/aglyn/server', () => ({
  __esModule: true,
  // The REAL entitlement/quota rules and the REAL cap constant — a spec that
  // stubbed them would pass against a route that never enforced anything.
  ...jest.requireActual('../../../libs/aglyn/src/lib/app-utils/plan-entitlements'),
  // The REAL node codec (AGL-1151). The route under test compresses any
  // `nodes` it writes, and this factory is a CLOSED WORLD — an absent export
  // throws inside the route and its own catch answers 500, which reads
  // exactly like the behaviour under test regressing.
  ...jest.requireActual('../../../libs/aglyn/src/lib/app-utils/stored-nodes'),
  ...jest.requireActual('../../../libs/aglyn/src/lib/app-utils/actions'),
  // The REAL host-role gate (AGL-2334). These routes ask
  // `hostRoleCanWrite` whether the caller may write at all, and this factory
  // is a CLOSED WORLD — anything it does not name is `undefined`, so leaving
  // it out makes the route throw and every assertion below read a 500 as if
  // the behaviour under test had regressed. Stubbed `() => true` it would be
  // worse: the suite would pass against a route that admits anybody.
  ...jest.requireActual('../../../libs/aglyn/src/lib/app-utils/organizations'),
  createResourceUid: () => 'generated-id',
  nameSearchKey: (value: string) => value.toLowerCase(),
  pluginRequestFromWeb: async (request: Request) => ({
    method: request.method,
    body: await request.json().catch(() => ({})),
    headers: {
      authorization: request.headers.get('authorization') ?? undefined,
    },
  }),
}))

// The workspace alias, not a relative path: a static import that reaches into
// another project's source crosses the nx boundary and fails
// `@nx/enforce-module-boundaries`. The `requireActual` strings above are
// runtime lookups inside a mock factory, so they stay as-is.
import { WEBHOOK_MAX_PER_HOST } from '@aglyn/aglyn/app-utils/actions'
import { POST } from '../app/api/hosts/resources/route'

const createWebhook = (body: Record<string, unknown> = {}) =>
  POST(
    new Request('https://app.aglyn.com/api/hosts/resources', {
      method: 'POST',
      headers: { authorization: 'Bearer tok' },
      body: JSON.stringify({
        hostId: 'host-1',
        resource: 'webhook',
        data: {
          name: 'Ship notifications',
          direction: 'outbound',
          url: 'https://example.com/hooks/aglyn',
          secret: 'deadbeef',
          enabled: true,
        },
        ...body,
      }),
    }),
  )

/** `n` live webhooks as the SERVER sees them. */
const liveWebhooks = (n: number): Array<FakeWebhook> =>
  Array.from({ length: n }, (_, index) => ({ name: `hook ${index}` }))

describe('webhook cap is enforced server-side (AGL-1360)', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    state.memberRoles = { 'user-1': 'admin' }
    // Business plan: `webhooks` is a paid entitlement, so every cap
    // assertion below needs an org that actually has the feature.
    state.org = { plan: 'business' }
    state.webhooks = []
    state.selects = []
    mockVerifyIdToken.mockResolvedValue({ uid: 'user-1', email_verified: true })
  })

  it('creates a webhook under the cap', async () => {
    state.webhooks = liveWebhooks(WEBHOOK_MAX_PER_HOST - 1)
    const response = await createWebhook()
    expect(response.status).toBe(200)
    expect(mockCreate).toHaveBeenCalledTimes(1)
  })

  it('refuses the create at the cap even though the client sent no count', async () => {
    // THE bug. The client believed there were zero webhooks (a stale
    // `persistentLocalCache` snapshot) and asked for one more. The request
    // body carries no count at all, so the only number in play is the one
    // the route read for itself.
    state.webhooks = liveWebhooks(WEBHOOK_MAX_PER_HOST)
    const response = await createWebhook()
    expect(response.status).toBe(403)
    expect((await response.json()).error).toContain(
      String(WEBHOOK_MAX_PER_HOST),
    )
    expect(mockCreate).not.toHaveBeenCalled()
  })

  it('refuses past the cap, so an over-cap host cannot grow further', async () => {
    state.webhooks = liveWebhooks(WEBHOOK_MAX_PER_HOST + 3)
    expect((await createWebhook()).status).toBe(403)
    expect(mockCreate).not.toHaveBeenCalled()
  })

  it('cannot be talked out of the count by anything in the body', async () => {
    // A hostile client controls the whole payload. None of these are inputs
    // to the decision — there is no count parameter to poison.
    state.webhooks = liveWebhooks(WEBHOOK_MAX_PER_HOST)
    const response = await createWebhook({
      count: 0,
      used: 0,
      data: { name: 'x', direction: 'outbound', url: 'https://e.com/h', count: 0 },
    })
    expect(response.status).toBe(403)
    expect(mockCreate).not.toHaveBeenCalled()
  })

  it('counts LIVE webhooks only, so a soft delete frees a slot', async () => {
    // Delete stamps `deletedAt` rather than removing the doc. Counting the
    // whole collection would be the AGL-1173 screens bug, one cap over:
    // a host at the cap could never create another webhook again.
    state.webhooks = [
      ...liveWebhooks(WEBHOOK_MAX_PER_HOST - 1),
      { name: 'retired', deletedAt: { seconds: 1 } },
      { name: 'also retired', deletedAt: { seconds: 2 } },
    ]
    expect((await createWebhook()).status).toBe(200)
    expect(mockCreate).toHaveBeenCalledTimes(1)
    // Read from the server with a field mask, not from a client number.
    expect(state.selects).toContainEqual(['deletedAt'])
  })

  it('strips a client-sent deletedAt, closing the create-hidden bypass', async () => {
    // Otherwise the cap is decorative: create N webhooks that each carry
    // `deletedAt` (counting zero every time), then clear the field with the
    // update that legitimately stays client-side.
    const response = await createWebhook({
      data: {
        name: 'sneaky',
        direction: 'outbound',
        url: 'https://example.com/h',
        deletedAt: { seconds: 1 },
      },
    })
    expect(response.status).toBe(200)
    expect(mockCreate.mock.calls[0][0]).not.toHaveProperty('deletedAt')
  })

  it('refuses a plan without the webhooks entitlement, under the cap', async () => {
    state.org = { plan: 'free' }
    state.webhooks = []
    const response = await createWebhook()
    expect(response.status).toBe(403)
    expect((await response.json()).error).toContain('plan')
    expect(mockCreate).not.toHaveBeenCalled()
  })

  it('refuses a viewer — the cap is not the only thing the client asserted', async () => {
    state.memberRoles = { 'user-1': 'viewer' }
    expect((await createWebhook()).status).toBe(403)
    expect(mockCreate).not.toHaveBeenCalled()
  })

  it('401s an unauthenticated caller', async () => {
    const response = await POST(
      new Request('https://app.aglyn.com/api/hosts/resources', {
        method: 'POST',
        body: JSON.stringify({ hostId: 'host-1', resource: 'webhook', data: {} }),
      }),
    )
    expect(response.status).toBe(401)
    expect(mockCreate).not.toHaveBeenCalled()
  })

  it('refuses while the owning org is suspended — 423, the distinct lockdown status (AGL-1501)', async () => {
    state.org = { plan: 'business', suspendedAt: { seconds: 1 } }
    expect((await createWebhook()).status).toBe(423)
    expect(mockCreate).not.toHaveBeenCalled()
  })
})

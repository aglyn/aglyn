/**
 * @jest-environment node
 *
 * Pragma must stay in the FIRST block comment — behind the license header it
 * is silently ignored, and this suite needs `Request`/`Response`.
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
 * The console plugin API dispatcher bounds console writes.
 *
 * `apps/console/app/api/[...pluginApi]/route.ts` is the single chokepoint
 * every plugin's console handler passes through — marketplace installs and
 * publishes, `ai/assist`, gift cards, POS orders, refunds, the email list
 * previews and the suppression writes — and it applied no rate limit of any
 * kind. Its sibling in `apps/tenant` has had one since AGL-1770, and two
 * plugin docblocks claimed that limiter covered these routes; it never did,
 * because it is installed in the other dispatcher.
 *
 * **The assertion surface is `runLegacyHandler`, not the status code.** A 429
 * on its own would not prove the handler stopped running — and "the handler
 * never runs" is the entire claim, because the handler is what spends the
 * contact scan, the bundle verify or the paid model call.
 *
 * The real limiter is used here, driven against a fake Firestore, so "the
 * limiter engages" means a counter genuinely crossed a cap rather than a stub
 * saying it did.
 */

/** Requests that reached the plugin handler. */
let mockHandlerCalls: number
/** Dispatcher path the fake route registry is asked for. */
let mockPath: string
/**
 * Transactions the limiter opened. The counter is an atomic increment plus a
 * read-back (AGL-2416), never `runTransaction`, and that property is what
 * stops a contended key producing a retry storm and a bodyless 504. It is
 * asserted rather than assumed on every path below.
 */
let mockTransactionOpens: number
/** Set to a gRPC error to make the counter's read-back fail. */
let mockReadBackError: unknown

/**
 * A counting Firestore stand-in — the same shape the tenant limiter's suite
 * uses. Module-scoped so every request in a test shares one durable counter,
 * which is the property that makes the limiter global in production.
 */
const rateLimitDocs = new Map<string, Record<string, unknown>>()
const fakeFirestore = {
  collection: (name: string) => ({
    doc: (id: string) => ({
      path: `${name}/${id}`,
      // The sentinel's real `operand` is applied, so mutating the production
      // call to `increment(0)` changes what this store holds instead of being
      // silently absorbed.
      set: async (value: Record<string, unknown>) => {
        const path = `${name}/${id}`
        const prior = rateLimitDocs.get(path) ?? {}
        const next: Record<string, unknown> = { ...prior }
        for (const [field, raw] of Object.entries(value)) {
          const operand = (raw as { operand?: unknown })?.operand
          next[field] =
            typeof operand === 'number'
              ? (Number(prior[field]) || 0) + operand
              : raw
        }
        rateLimitDocs.set(path, next)
      },
      get: async () => {
        if (mockReadBackError) throw mockReadBackError
        const path = `${name}/${id}`
        return {
          exists: rateLimitDocs.has(path),
          get: (field: string) => rateLimitDocs.get(path)?.[field],
        }
      },
    }),
  }),
  // Present so the limiter COULD open one. A store that simply lacked the
  // method would make every "no transaction" assertion below vacuous — the
  // call would throw and the limiter would degrade to its in-process
  // fallback, which is a false green.
  runTransaction: async (fn: (tx: unknown) => Promise<number>) => {
    mockTransactionOpens += 1
    const tx = {
      get: async (ref: { path: string }) => ({
        exists: rateLimitDocs.has(ref.path),
        get: (field: string) => rateLimitDocs.get(ref.path)?.[field],
      }),
      set: (ref: { path: string }, value: Record<string, unknown>) => {
        rateLimitDocs.set(ref.path, {
          ...(rateLimitDocs.get(ref.path) ?? {}),
          ...value,
        })
      },
    }
    return fn(tx)
  },
}

jest.mock(
  '../../../libs/tenant/data/admin/src/lib/server/firebase-admin',
  () => ({
    __esModule: true,
    firebaseAdmin: {
      app: () => ({ firestore: () => fakeFirestore }),
      // The counter reaches for the `FieldValue.increment` sentinel off this
      // namespace. Without it the call throws and the limiter silently
      // degrades to its per-instance fallback, which is a false GREEN for
      // every durability assertion in this file.
      firestore: Object.assign(() => fakeFirestore, {
        FieldValue: { increment: (n: number) => ({ operand: n }) },
      }),
    },
  }),
)

jest.mock('@aglyn/tenant-data-admin', () => {
  // The REAL limiter and the REAL policy, so this suite pins behavior rather
  // than a stub. Only the surrounding gates are stubbed to "allow", which is
  // what puts every request on the path the limiter guards.
  const real = jest.requireActual(
    '../../../libs/tenant/data/admin/src/lib/server/console-api-rate-limit',
  )
  // The email-verification trio the dispatcher gates on (AGL-2589), REAL: a
  // stubbed predicate on a security control makes every request below pass
  // for a reason this file is not testing.
  const gate = jest.requireActual(
    '../../../libs/tenant/data/admin/src/lib/server/firebase-admin',
  )
  return {
    __esModule: true,
    emailUnverifiedResponse: gate.emailUnverifiedResponse,
    isEmailVerified: gate.isEmailVerified,
    isImpersonationSession: gate.isImpersonationSession,
    filterEnabledPluginsByReleaseFlags: jest.fn(async (ids: string[]) => [
      ...ids,
    ]),
    featureLockdownRefusal: jest.fn(async () => null),
    lockdownRefusal: jest.fn(async () => null),
    getHostDisabledPlugins: jest.fn(async () => []),
    getHostDocAdmin: jest.fn(async () => ({ id: 'host-1' })),
    getOrgForHost: jest.fn(async () => ({
      orgId: 'org-1',
      org: { enabledPlugins: ['email', 'marketing'] },
    })),
    firebaseAdmin: {
      app: () => ({
        auth: () => ({
          // The uid IS the bearer token here, so a test can hand the
          // dispatcher a second operator by changing one string.
          verifyIdToken: async (token: string) => {
            if (!token || token === 'bad') throw new Error('not a token')
            // Verified, because the operators this file counts requests for
            // are — the verification gate (AGL-2589) sits ahead of the
            // limiter and would otherwise refuse every one of them.
            return { uid: token, staff: false, email_verified: true }
          },
        }),
      }),
    },
    consoleApiRateLimitRefusal: real.consoleApiRateLimitRefusal,
  }
})

jest.mock('@aglyn/aglyn/server', () => ({
  __esModule: true,
  // The real policy modules: the ceiling, the key and the machine-path
  // exemptions are the things under test, and `lockdownIntentForMethod` is
  // what decides a read from a write.
  ...jest.requireActual('../../../libs/aglyn/src/lib/app-utils/lockdown'),
  ...jest.requireActual(
    '../../../libs/aglyn/src/lib/app-utils/plugin-api-rate-limit',
  ),
  ...jest.requireActual(
    '../../../libs/aglyn/src/lib/plugin-manager/enabled-plugins',
  ),
  lockdownFeaturesForPluginApiPath: jest.fn(() => []),
  pluginIdForRegisteredApiPath: jest.fn(() => 'email'),
  resolvePluginApiRoute: jest.fn(() => ({ path: mockPath })),
  runLegacyHandler: jest.fn(async () => {
    mockHandlerCalls += 1
    return Response.json({ ok: true }, { status: 200 })
  }),
}))

jest.mock('../utils/remote-server-bundles', () => ({
  __esModule: true,
  ensureRemoteServerBundles: jest.fn(async () => undefined),
}))

jest.mock('../utils/server-plugin-loader', () => ({
  __esModule: true,
  serverPluginLoader: {
    ensureAll: jest.fn(async () => undefined),
    pluginIdForApiPath: jest.fn(() => 'email'),
  },
}))

import { GET, POST } from '../app/api/[...pluginApi]/route'
import { CONSOLE_API_RATE_LIMIT } from '@aglyn/aglyn/server'

const params = Promise.resolve({ pluginApi: ['email', 'list-members-add'] })

/** The console request: a bearer token, a site, and a list to write to. */
function listAddPost(
  uid: string,
  body: Record<string, unknown> = { hostId: 'host-1', listId: 'list-1' },
) {
  return new Request('https://app.aglyn.com/api/email/list-members-add', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${uid}`,
      'x-forwarded-for': '9.9.9.9',
    },
    body: JSON.stringify(body),
  })
}

beforeEach(() => {
  mockHandlerCalls = 0
  mockPath = 'email/list-members-add'
  mockTransactionOpens = 0
  mockReadBackError = undefined
  rateLimitDocs.clear()
})

describe('console plugin API dispatcher — write rate limit', () => {
  it('stops a console route running unbounded', async () => {
    const statuses: number[] = []
    for (let i = 0; i < CONSOLE_API_RATE_LIMIT + 3; i += 1) {
      statuses.push((await POST(listAddPost('user-1'), { params })).status)
    }

    // Before this, every one of these 123 requests reached the handler and
    // spent a contact scan. The handler now runs exactly the budget.
    expect(mockHandlerCalls).toBe(CONSOLE_API_RATE_LIMIT)
    expect(statuses.filter((s) => s === 429)).toHaveLength(3)
    expect(statuses[CONSOLE_API_RATE_LIMIT - 1]).toBe(200)
    expect(statuses[CONSOLE_API_RATE_LIMIT]).toBe(429)

    // The DURABLE counter did the refusing, not the in-process fallback.
    // Without this the suite would pass just as happily if the Firestore mock
    // never took: `consumeRateLimit` fails soft, so a broken fake would send
    // every call to the in-memory limiter and produce the same 120/429 shape
    // — and every `rateLimitDocs.size === 0` assertion below would then be
    // vacuous. One key, one window, one bucket document.
    expect(rateLimitDocs.size).toBe(1)
    expect([...rateLimitDocs.values()][0].count).toBe(
      CONSOLE_API_RATE_LIMIT + 3,
    )
  })

  it('answers a refused request with Retry-After', async () => {
    for (let i = 0; i < CONSOLE_API_RATE_LIMIT; i += 1) {
      await POST(listAddPost('user-1'), { params })
    }
    const refused = await POST(listAddPost('user-1'), { params })

    expect(refused.status).toBe(429)
    expect(Number(refused.headers.get('Retry-After'))).toBeGreaterThan(0)
  })

  it('leaves a second operator in the same workspace unaffected', async () => {
    for (let i = 0; i < CONSOLE_API_RATE_LIMIT + 5; i += 1) {
      await POST(listAddPost('user-1'), { params })
    }
    mockHandlerCalls = 0

    const colleague = await POST(listAddPost('user-2'), { params })

    // The property a per-site key would have cost: one operator's runaway tab
    // does not lock their colleagues out of the console.
    expect(colleague.status).toBe(200)
    expect(mockHandlerCalls).toBe(1)
  })

  it('gives one operator one budget across every site they can reach', async () => {
    // A different `hostId` on every request. If the site were in the key this
    // would mint a fresh bucket per call and never refuse — the multiplication
    // hole, free to exploit because the caller supplies the field.
    for (let i = 0; i < CONSOLE_API_RATE_LIMIT; i += 1) {
      await POST(
        listAddPost('user-1', { hostId: `host-${i}`, listId: 'list-1' }),
        { params },
      )
    }
    mockHandlerCalls = 0

    const refused = await POST(
      listAddPost('user-1', { hostId: 'host-999', listId: 'list-1' }),
      { params },
    )

    expect(refused.status).toBe(429)
    expect(mockHandlerCalls).toBe(0)
    expect(rateLimitDocs.size).toBe(1)
  })

  it('counts a caller that sends no credential, so the limiter cannot be switched off', async () => {
    const anonymous = () =>
      new Request('https://app.aglyn.com/api/email/list-members-add', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-forwarded-for': '4.4.4.4',
        },
        body: JSON.stringify({ hostId: 'host-1', listId: 'list-1' }),
      })

    for (let i = 0; i < CONSOLE_API_RATE_LIMIT; i += 1) {
      await POST(anonymous(), { params })
    }
    mockHandlerCalls = 0

    const refused = await POST(anonymous(), { params })
    expect(refused.status).toBe(429)
    expect(mockHandlerCalls).toBe(0)
  })

  it('does not limit reads', async () => {
    for (let i = 0; i < CONSOLE_API_RATE_LIMIT + 10; i += 1) {
      const response = await GET(
        new Request(
          'https://app.aglyn.com/api/email/list-members-add?hostId=host-1',
          { headers: { authorization: 'Bearer user-1' } },
        ),
        { params },
      )
      expect(response.status).toBe(200)
    }
    expect(mockHandlerCalls).toBe(CONSOLE_API_RATE_LIMIT + 10)
    // No transaction was spent: a durable limiter in front of a GET would be
    // the only Firestore work the request does.
    expect(rateLimitDocs.size).toBe(0)
  })

  it('does not limit a chunked cron sweep', async () => {
    mockPath = 'lists/materialize'
    const sweepParams = Promise.resolve({ pluginApi: ['lists', 'materialize'] })

    // `sweepConsoleCron` follows `nextCursor` up to fifty POSTs per route per
    // run, from one Cloud Functions address with no uid and no hostId, and the
    // key carries no path — so three such routes on one beat is 150 requests
    // against a single bucket. A console-sized ceiling would shred the sweep.
    for (let i = 0; i < CONSOLE_API_RATE_LIMIT + 10; i += 1) {
      const response = await POST(
        new Request('https://app.aglyn.com/api/lists/materialize', {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            'x-cron-secret': 'secret',
            'x-forwarded-for': '3.3.3.3',
          },
          body: JSON.stringify({ cursor: String(i) }),
        }),
        { params: sweepParams },
      )
      expect(response.status).toBe(200)
    }

    expect(mockHandlerCalls).toBe(CONSOLE_API_RATE_LIMIT + 10)
    expect(rateLimitDocs.size).toBe(0)
  })

  it('spends no transaction on a path that does not resolve to a handler', async () => {
    const { resolvePluginApiRoute } = jest.requireMock('@aglyn/aglyn/server')
    resolvePluginApiRoute.mockReturnValueOnce(undefined)

    const response = await POST(listAddPost('user-1'), { params })

    // Limiting before route resolution would turn a free 404 into a Firestore
    // transaction — a cheaper amplification than the one being closed.
    expect(response.status).toBe(404)
    expect(rateLimitDocs.size).toBe(0)
  })

  it('opens no transaction, so a contended key cannot start a retry storm', async () => {
    for (let i = 0; i < CONSOLE_API_RATE_LIMIT + 3; i += 1) {
      await POST(listAddPost('user-1'), { params })
    }

    // AGL-2416: `set({count: increment(1)}, {merge: true})` plus a read-back.
    // A read-modify-write `runTransaction` on one hot document is what turned
    // two concurrent requests into a bodyless 504 with no `Retry-After`, and
    // the console surface must not reintroduce it by wrapping the counter.
    expect(mockTransactionOpens).toBe(0)
  })

  it('refuses a contended counter rather than degrading to a per-instance cap', async () => {
    // `ABORTED` — the store is up and this one document is hot. Degrading here
    // would let a caller widen its own cap just by going concurrent.
    mockReadBackError = Object.assign(new Error('aborted'), { code: 10 })

    const refused = await POST(listAddPost('user-1'), { params })

    expect(refused.status).toBe(429)
    expect(mockHandlerCalls).toBe(0)
    expect(Number(refused.headers.get('Retry-After'))).toBeGreaterThan(0)
    expect(mockTransactionOpens).toBe(0)
  })

  it('fails soft when the store is unreachable', async () => {
    // `UNAVAILABLE` — not contention. A Firestore blip must not take the
    // console's whole write surface down, including the operator's own
    // recovery tools, over volume the outage has already stopped.
    mockReadBackError = Object.assign(new Error('unavailable'), { code: 14 })

    const response = await POST(listAddPost('user-1'), { params })

    expect(response.status).toBe(200)
    expect(mockHandlerCalls).toBe(1)
  })
})

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
 * THE 1,000-MESSAGE BURST (AGL-2409).
 *
 * `/api/billing/usage-email` read `orgs` with `.limit(1000)` and then looped
 * with `await sendEmail` inside — one invocation, up to a thousand messages,
 * as fast as Resend accepts them, from a domain whose steady-state volume is a
 * few hundred a day. Same key, same From address and same `p=reject` DMARC
 * record as every customer's password resets.
 *
 * Three properties are asserted:
 *
 *  1. It sends at most a CHUNK per invocation and hands back a cursor, so the
 *     sweep is resumable instead of all-or-nothing.
 *  2. Every send declares `priority: 'bulk'`. That is what makes it refusable
 *     by the platform governor at all — a summary sent as `transactional`
 *     would be exempt, and this burst would still exist.
 *  3. A governor refusal STOPS the run and reports `done: true`, leaving the
 *     unreached rollups unstamped so the next hourly firing mails them.
 *     `done: false` would send the workflow's cursor loop straight back into a
 *     window that is still full.
 *
 * No real mail: `sendEmail` is a recorder, and `global.fetch` throws on
 * everything so a future edit that reintroduces a live send fails here.
 */

export {}

/** Every message the route handed the sender, in order. */
const mockSent: Array<Record<string, any>> = []
/** Queue of results the recorder returns; defaults to a successful send. */
let mockResults: Array<Record<string, any>> = []
/** Rollups stamped `emailedAt`, so "not stamped" is checkable. */
const mockStamped: string[] = []

jest.mock('@aglyn/shared-util-email', () => ({
  // The REAL module spread in: `rateLimitedRetryAtMs` is how the route
  // recognises a deferral, and a closed-world factory that omitted it would
  // make the deferral branch unreachable — the guard dead, the file green.
  ...jest.requireActual('@aglyn/shared-util-email'),
  isEmailConfigured: () => true,
  sendEmail: async (message: Record<string, unknown>) => {
    mockSent.push(message)
    return mockResults.shift() ?? { sent: true, id: 'email_1' }
  },
}))

jest.mock('../utils/cron-auth', () => ({
  __esModule: true,
  isCronAuthorized: () => true,
}))

jest.mock('../app/api/_lib/render-system-email', () => ({
  __esModule: true,
  loadSystemEmail: async () => null,
  renderLoadedSystemEmail: () => null,
}))

jest.mock('@aglyn/tenant-data-admin', () => ({
  __esModule: true,
  findUserByUidAcrossPools: async (uid: string) => ({
    record: { email: `${uid}@example.com` },
  }),
  meterOrgEmail: async () => undefined,
  meterPlatformEmail: async () => undefined,
  firebaseAdmin: {
    app: () => ({ firestore: () => mockFirestore(), auth: () => ({}) }),
    firestore: { FieldValue: { serverTimestamp: () => 'server-time' } },
  },
}))

// NOT mocked: the route imports the suppression gate through its LEAF entry
// point precisely so the barrel mock above cannot replace it.
jest.mock('@aglyn/tenant-data-admin/server/email-suppression', () => ({
  __esModule: true,
  isEmailSuppressed: async () => false,
}))

/** How many orgs the sweep universe holds. */
let mockOrgCount = 0

function mockFirestore(): any {
  const orgDocs = Array.from({ length: mockOrgCount }, (_, index) => {
    // Zero-padded so lexical id order — which `selectCronChunk` sorts by — is
    // also numeric order, and "the second chunk" means what it reads like.
    const id = `org-${String(index).padStart(3, '0')}`
    return {
      id,
      get: (field: string) =>
        ({ plan: 'starter', ownerUid: `owner-${id}`, name: id })[field],
      data: () => ({ plan: 'starter', ownerUid: `owner-${id}` }),
      ref: {
        collection: () => ({
          doc: () => ({
            get: async () => ({
              exists: true,
              get: (field: string) =>
                field === 'emailedAt'
                  ? mockStamped.includes(id)
                    ? 'stamped'
                    : undefined
                  : 0,
              ref: {
                set: async () => {
                  mockStamped.push(id)
                },
              },
            }),
          }),
        }),
      },
    }
  })
  return {
    collection: (name: string) =>
      name === 'orgs'
        ? { limit: () => ({ get: async () => ({ docs: orgDocs }) }) }
        : { doc: () => ({ get: async () => ({ exists: false }) }) },
  }
}

import {
  POST as usageEmailCron,
  USAGE_EMAIL_CHUNK_SIZE,
} from '../app/api/billing/usage-email/route'

const originalFetch = global.fetch

function post(body?: unknown) {
  return usageEmailCron(
    new Request('https://app.aglyn.com/api/billing/usage-email', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    }),
  )
}

beforeEach(() => {
  mockSent.length = 0
  mockStamped.length = 0
  mockResults = []
  mockOrgCount = 0
  process.env.CRON_SECRET = 'cron-secret'
  global.fetch = (async (url: any) => {
    throw new Error(`Blocked outbound request in a spec: ${String(url)}`)
  }) as any
  jest.spyOn(console, 'error').mockImplementation(() => undefined)
  jest.spyOn(console, 'warn').mockImplementation(() => undefined)
})

afterEach(() => {
  global.fetch = originalFetch
  jest.restoreAllMocks()
})

describe('every summary declares itself BULK', () => {
  it('sends with priority bulk — which is what makes it refusable at all', async () => {
    mockOrgCount = 2
    await post()
    expect(mockSent).toHaveLength(2)
    for (const message of mockSent) {
      expect(message['priority']).toBe('bulk')
    }
  })

  /**
   * The anti-vacuity control. Without it, a route that sent nothing at all
   * would satisfy the `priority` assertion above for the wrong reason.
   */
  it('PREMISE: it really does mail every org with a rollup', async () => {
    mockOrgCount = 3
    const body = await (await post()).json()
    expect(mockSent).toHaveLength(3)
    expect(Object.keys(body.orgs)).toHaveLength(3)
  })
})

describe('the sweep is chunked and resumable', () => {
  it('sends at most one chunk per invocation and hands back a cursor', async () => {
    mockOrgCount = USAGE_EMAIL_CHUNK_SIZE + 5
    const body = await (await post()).json()

    expect(mockSent).toHaveLength(USAGE_EMAIL_CHUNK_SIZE)
    expect(body.done).toBe(false)
    expect(body.nextCursor).toBeTruthy()
    expect(body.total).toBe(USAGE_EMAIL_CHUNK_SIZE + 5)
  })

  it('resumes strictly after the cursor and finishes', async () => {
    mockOrgCount = USAGE_EMAIL_CHUNK_SIZE + 5
    const first = await (await post()).json()
    mockSent.length = 0

    const second = await (await post({ cursor: first.nextCursor })).json()
    expect(mockSent).toHaveLength(5)
    expect(second.done).toBe(true)
    expect(second.nextCursor).toBeNull()
  })

  it('finishes in one call when the sweep fits', async () => {
    mockOrgCount = 3
    const body = await (await post()).json()
    expect(body.done).toBe(true)
    expect(body.nextCursor).toBeNull()
  })
})

describe('a governor refusal', () => {
  it('STOPS the run, reports done, and leaves the rest unstamped', async () => {
    mockOrgCount = 5
    mockResults = [
      { sent: true, id: 'email_1' },
      { sent: false, reason: 'rate-limited', retryAtMs: 1_755_104_400_000 },
      // Never reached: the counter only goes up, so every later send in this
      // window would be refused too.
      { sent: true, id: 'email_3' },
    ]

    const body = await (await post()).json()

    expect(mockSent).toHaveLength(2)
    expect(body.deferred).toBe(1)
    // `done: true`, NOT false: the workflow's cursor loop would otherwise
    // re-POST straight back into a full window, up to its 50-chunk limit, and
    // go red on a governor working exactly as designed.
    expect(body.done).toBe(true)
    expect(body.nextCursor).toBeNull()
    // Only the org that actually received mail is stamped. `emailedAt` is the
    // idempotence key, so the next hourly run mails the other four.
    expect(mockStamped).toEqual(['org-000'])
  })

  /**
   * The case the `done: true` override exists for, and the ONLY one that
   * distinguishes it: a sweep that has NOT finished its chunk AND was
   * refused. With `done: chunk.done` this answers `false` with a cursor, and
   * the workflow's loop re-POSTs immediately into a window that is still
   * full — 50 chunks, then a red job, on a governor working as designed.
   */
  it('reports done even when the CHUNK is unfinished', async () => {
    mockOrgCount = USAGE_EMAIL_CHUNK_SIZE + 5
    mockResults = [
      { sent: true, id: 'email_1' },
      { sent: false, reason: 'rate-limited', retryAtMs: 1_755_104_400_000 },
    ]

    const body = await (await post()).json()

    expect(mockSent).toHaveLength(2)
    expect(body.deferred).toBe(1)
    expect(body.done).toBe(true)
    expect(body.nextCursor).toBeNull()
  })

  it('keeps going past an ordinary per-org failure', async () => {
    mockOrgCount = 3
    mockResults = [
      { sent: false, reason: 'rejected', status: 422 },
      { sent: true, id: 'email_2' },
      { sent: true, id: 'email_3' },
    ]

    const body = await (await post()).json()
    expect(mockSent).toHaveLength(3)
    expect(body.deferred).toBeUndefined()
    expect(body.done).toBe(true)
  })
})

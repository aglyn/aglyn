/**
 * @jest-environment node
 *
 * Pragma must stay in the FIRST block comment — behind the license header it is
 * silently ignored.
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
 * The boundary between Support's two channels (AGL-1158).
 *
 * Splitting tickets and the forum into separate pages makes their DIFFERENT
 * visibility rules the interesting part, and a component-level check is not
 * where they live: `supportTickets` and `forumThreads` are both absent from
 * the Firestore rules by design, so these two routes are the entire boundary.
 *
 * Four properties, each of which has already been a bug or is one line from
 * becoming one:
 *
 * 1. **Tickets are gated on the ladder, not on "paid".** Starter is a PAID
 *    plan with no first-response commitment, so any `plan !== 'free'` check
 *    admits it — which is precisely what AGL-1103 found and fixed.
 * 2. **The forum is open to every tier including Free.** A tier with no ticket
 *    channel whose forum was also shut would have no support channel at all.
 * 3. **A ticket is private to its org; a forum thread is not.** The asymmetry
 *    is deliberate and is asserted in both directions, so removing either
 *    check fails here rather than being discovered by a customer.
 * 4. **The tier cannot be escalated by query parameter.** `orgId` arrives from
 *    the browser. If naming another org's id granted that org's plan, the
 *    ladder would be advisory.
 *
 * The ladder itself is the REAL `support-tiers` module, not a stub — a stubbed
 * gate proves only that the test agrees with itself.
 */

const mockVerifyIdToken = jest.fn()
const mockNotifyStaff = jest.fn()

/** Collection path → docId → data. Subcollections are `a/{id}/b` paths. */
let store: Record<string, Record<string, any>>
let autoId = 0

const stamp = (ms: number) => ({ toMillis: () => ms })

function snapshot(id: string, data: any) {
  return {
    id,
    exists: Boolean(data),
    data: () => data,
    get: (key: string) => data?.[key],
  }
}

function makeQuery(path: string, filter: ((doc: any) => boolean) | null): any {
  const self: any = {
    where: (field: string, _op: string, value: unknown) =>
      makeQuery(path, (doc) => (filter ? filter(doc) : true) && doc?.[field] === value),
    orderBy: () => makeQuery(path, filter),
    limit: () => self,
    get: async () => {
      const docs = Object.entries(store[path] ?? {})
        .filter(([, data]) => (filter ? filter(data) : true))
        .map(([id, data]) => snapshot(id, data))
      return { docs, empty: docs.length === 0, size: docs.length }
    },
  }
  return self
}

function docRef(path: string, id: string): any {
  return {
    id,
    get: async () => snapshot(id, store[path]?.[id]),
    set: async (data: any, options?: { merge?: boolean }) => {
      store[path] = store[path] ?? {}
      store[path][id] = options?.merge
        ? { ...(store[path][id] ?? {}), ...data }
        : data
    },
    collection: (sub: string) => collectionRef(`${path}/${id}/${sub}`),
  }
}

function collectionRef(path: string): any {
  const query = makeQuery(path, null)
  return {
    ...query,
    doc: (id?: string) => docRef(path, id ?? `auto-${(autoId += 1)}`),
    add: async (data: any) => {
      const id = `auto-${(autoId += 1)}`
      store[path] = store[path] ?? {}
      store[path][id] = data
      return { id }
    },
  }
}

/**
 * Membership, modelled the way `resolveOrgMembership` actually behaves: the
 * requested org is honoured ONLY when `orgs/{orgId}/members/{uid}` exists,
 * and a request for an org the caller does not belong to resolves to nothing
 * rather than falling back to one they do. Read from
 * `libs/tenant/data/admin/src/lib/server/organizations.ts` — property 4 below
 * is only meaningful because the route trusts exactly this contract.
 */
const MEMBERSHIPS: Record<string, string[]> = {
  'user-free': ['org-free'],
  'user-starter': ['org-starter'],
  'user-pro': ['org-pro'],
  'user-other': ['org-other'],
}
const ORG_PLANS: Record<string, string> = {
  'org-free': 'free',
  'org-starter': 'starter',
  'org-pro': 'pro',
  'org-other': 'pro',
}

jest.mock('@aglyn/tenant-data-admin', () => ({
  __esModule: true,
  firebaseAdmin: {
    app: () => ({
      auth: () => ({
        verifyIdToken: (...args: unknown[]) => mockVerifyIdToken(...args),
      }),
      firestore: () => ({
        collection: (name: string) => (global as any).__collectionRef(name),
      }),
    }),
    firestore: {
      FieldValue: {
        serverTimestamp: () => ({ toMillis: () => 1_700_000_000_000 }),
        increment: (value: number) => ({ __increment: value }),
      },
      Timestamp: { fromMillis: (ms: number) => ({ toMillis: () => ms }) },
    },
  },
  isImpersonationSession: () => false,
  emailUnverifiedResponse: () =>
    Response.json(
      { error: 'Verify your email to continue', reason: 'email-unverified' },
      { status: 403 },
    ),
  notifyStaff: (...args: unknown[]) => mockNotifyStaff(...args),
  getOrgForUser: async (uid: string, orgId?: string | null) => {
    const mine = MEMBERSHIPS[uid] ?? []
    const resolved = orgId ?? mine[0] ?? null
    if (!resolved || !mine.includes(resolved)) return null
    return {
      orgId: resolved,
      org: { $id: resolved, plan: ORG_PLANS[resolved] },
      member: { $id: uid },
    }
  },
}))

jest.mock('@aglyn/aglyn/server', () => {
  // The REAL ladder. Stubbing `supportForPlan` here would make every
  // assertion below a tautology — the gate under test IS that function.
  const tiers = jest.requireActual('@aglyn/aglyn/app-utils/support-tiers')
  return {
    __esModule: true,
    ...tiers,
    pluginRequestFromWeb: async (request: Request) => {
      const url = new URL(request.url)
      const raw = await request.text().catch(() => '')
      return {
        method: request.method,
        query: Object.fromEntries(url.searchParams.entries()),
        body: raw ? JSON.parse(raw) : undefined,
        headers: {
          authorization: request.headers.get('authorization') ?? undefined,
        },
      }
    },
  }
})

// Exposed on `global` so the module factory above (hoisted, and forbidden from
// closing over anything but `mock*` bindings) can reach the fake store.
;(global as any).__collectionRef = (name: string) => collectionRef(name)

import { GET as forumGet, PATCH as forumPatch, POST as forumPost } from '../app/api/support/forum/route'
import { GET as ticketsGet, POST as ticketsPost } from '../app/api/support/tickets/route'

type Handler = (request: Request) => Promise<Response>

const call = (
  handler: Handler,
  path: string,
  init: { method: string; token?: string; query?: Record<string, string>; body?: unknown },
) => {
  const url = new URL(`https://app.aglyn.com${path}`)
  for (const [key, value] of Object.entries(init.query ?? {})) {
    url.searchParams.set(key, value)
  }
  return handler(
    new Request(url, {
      method: init.method,
      headers: init.token ? { authorization: `Bearer ${init.token}` } : {},
      ...(init.body === undefined ? {} : { body: JSON.stringify(init.body) }),
    }),
  )
}

const signedInAs = (uid: string, extra: Record<string, unknown> = {}) =>
  mockVerifyIdToken.mockResolvedValue({ uid, email_verified: true, email: `${uid}@example.com`, ...extra })

beforeEach(() => {
  jest.clearAllMocks()
  autoId = 0
  store = {
    supportTickets: {
      'ticket-pro': {
        orgId: 'org-pro',
        subject: 'Pro workspace ticket',
        status: 'open',
        createdAt: stamp(1_700_000_000_000),
        updatedAt: stamp(1_700_000_000_000),
      },
    },
    forumThreads: {
      'thread-1': {
        title: 'How do I bind a dataset?',
        body: 'Asking for a friend.',
        category: 'Building',
        authorId: 'user-pro',
        authorName: 'Pro Person',
        replyCount: 0,
        createdAt: stamp(1_700_000_000_000),
        updatedAt: stamp(1_700_000_000_000),
      },
    },
    users: {},
    profiles: {},
  }
})

describe('tickets are gated on the ladder, not on "paid" (AGL-1103/AGL-1158)', () => {
  it('refuses a FREE org', async () => {
    signedInAs('user-free')
    const response = await call(ticketsPost, '/api/support/tickets', {
      method: 'POST',
      token: 'tok',
      body: { orgId: 'org-free', subject: 'Help', body: 'Please' },
    })
    expect(response.status).toBe(403)
  })

  it('refuses a STARTER org — paid, and still forum-only', async () => {
    // The case a `plan !== 'free'` check gets wrong, and the reason this test
    // exists at all. Starter pays us; we have committed nothing in return.
    signedInAs('user-starter')
    const response = await call(ticketsPost, '/api/support/tickets', {
      method: 'POST',
      token: 'tok',
      body: { orgId: 'org-starter', subject: 'Help', body: 'Please' },
    })
    expect(response.status).toBe(403)
    expect((await response.json()).error).toMatch(/Pro/)
  })

  it('admits a PRO org and stamps the commitment onto the ticket', async () => {
    signedInAs('user-pro')
    const response = await call(ticketsPost, '/api/support/tickets', {
      method: 'POST',
      token: 'tok',
      body: { orgId: 'org-pro', subject: 'Help', body: 'Please' },
    })
    expect(response.status).toBe(200)
    const { ticketId } = await response.json()
    const created = store['supportTickets'][ticketId]
    // Frozen at OPEN time, never re-derived: a later downgrade must not
    // retire a breach that already happened.
    expect(created.supportTier).toBe('standard')
    expect(created.responseDueAt).not.toBeNull()
    expect(created.orgId).toBe('org-pro')
  })
})

describe('the forum is open to every tier (AGL-1103/AGL-1158)', () => {
  it.each([
    ['user-free', 'org-free'],
    ['user-starter', 'org-starter'],
    ['user-pro', 'org-pro'],
  ])('serves threads to %s', async (uid, orgId) => {
    signedInAs(uid)
    const response = await call(forumGet, '/api/support/forum', {
      method: 'GET',
      token: 'tok',
      query: { orgId },
    })
    expect(`${uid}: ${response.status}`).toBe(`${uid}: 200`)
    expect((await response.json()).threads).toHaveLength(1)
  })

  it('lets a Free org post a thread — its only support channel', async () => {
    signedInAs('user-free')
    const response = await call(forumPost, '/api/support/forum', {
      method: 'POST',
      token: 'tok',
      body: { orgId: 'org-free', title: 'Hello', body: 'First post', category: 'General' },
    })
    expect(response.status).toBe(200)
  })
})

describe('a ticket is private to its org; a thread is not (AGL-1158)', () => {
  it('403s a member of another org reading a ticket', async () => {
    // The private half of the boundary. `user-other` is a legitimate, verified,
    // PRO-plan customer — the only thing standing between them and another
    // organization's support thread is this check.
    signedInAs('user-other')
    const response = await call(ticketsGet, '/api/support/tickets', {
      method: 'GET',
      token: 'tok',
      query: { orgId: 'org-other', ticketId: 'ticket-pro' },
    })
    expect(response.status).toBe(403)
  })

  it('never lists another org’s tickets', async () => {
    signedInAs('user-other')
    const response = await call(ticketsGet, '/api/support/tickets', {
      method: 'GET',
      token: 'tok',
      query: { orgId: 'org-other' },
    })
    expect(response.status).toBe(200)
    expect((await response.json()).tickets).toEqual([])
  })

  it('DOES serve a thread authored in another org — the forum is cross-org', async () => {
    // Asserted deliberately, in the same file as the check above, so the
    // asymmetry is a recorded decision. A forum whose threads were org-scoped
    // would be a per-workspace notepad shared with nobody.
    signedInAs('user-other')
    const response = await call(forumGet, '/api/support/forum', {
      method: 'GET',
      token: 'tok',
      query: { orgId: 'org-other', threadId: 'thread-1' },
    })
    expect(response.status).toBe(200)
    const payload = await response.json()
    expect(payload.thread.title).toBe('How do I bind a dataset?')
    // Converted to millis like every other post (AGL-1158) — the detail read
    // used to hand back a raw Firestore timestamp, which renders as
    // "Invalid Date" the moment the opening post shows a time.
    expect(typeof payload.thread.createdAt).toBe('number')
  })

  it('lets another org reply to a thread', async () => {
    signedInAs('user-other')
    const response = await call(forumPatch, '/api/support/forum', {
      method: 'PATCH',
      token: 'tok',
      body: { orgId: 'org-other', threadId: 'thread-1', body: 'Try a binding.' },
    })
    expect(response.status).toBe(200)
  })
})

describe('the tier cannot be escalated by query parameter (AGL-1147/AGL-1158)', () => {
  it('does not grant a Starter caller Pro’s ticket channel by naming Pro’s org', async () => {
    // `orgId` comes from the browser. Membership is re-resolved server-side,
    // so naming an org the caller does not belong to resolves to NOTHING —
    // and `supportForPlan(null)` fails closed to the forum-only tier rather
    // than to whatever was asked for.
    signedInAs('user-starter')
    const response = await call(ticketsPost, '/api/support/tickets', {
      method: 'POST',
      token: 'tok',
      body: { orgId: 'org-pro', subject: 'Help', body: 'Please' },
    })
    expect(response.status).toBe(403)
  })

  it('does not expose another org’s ticket list by naming that org', async () => {
    signedInAs('user-starter')
    const response = await call(ticketsGet, '/api/support/tickets', {
      method: 'GET',
      token: 'tok',
      query: { orgId: 'org-pro' },
    })
    expect(response.status).toBe(200)
    // No membership → no org → the route declines to list anything at all,
    // rather than listing the requested org's.
    expect((await response.json()).tickets).toEqual([])
  })
})

describe('both channels refuse an unauthenticated caller', () => {
  it.each([
    ['tickets', ticketsGet, '/api/support/tickets'],
    ['forum', forumGet, '/api/support/forum'],
  ])('%s 401s with no token', async (_name, handler, path) => {
    const response = await call(handler as Handler, path as string, { method: 'GET' })
    expect(response.status).toBe(401)
  })
})

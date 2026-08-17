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
 * A staff retarget must not mint a site from a mistyped id (AGL-1763).
 *
 * The interesting assertion is not the 404 — it is the SELF-POISONING the 404
 * prevents, which is why one test replays the sequence end to end: typo, then
 * the same subdomain requested for the site that should have had it. Under the
 * merge-set that shape ended in a 409 blamed on a document no console surface
 * can render, because the uniqueness query filters on `subdomain` alone and the
 * phantom carried exactly that field.
 *
 * Counting what LANDED, not what the handler returned: every assertion reads
 * the in-memory store by document path and checks each stored field
 * individually (AGL-1711). The fake's `update()` reproduces Firestore's
 * reject-on-missing with the real gRPC `NOT_FOUND` code — a fake that created
 * on update would pass against the broken code exactly as happily as against
 * the fix.
 *
 * No Stripe path is reachable from this route, and nothing here touches
 * `fetch`.
 */

// A module, not a script — without this the const declarations below collide
// with the other console route specs' identical globals under `tsc`.
export {}

/** gRPC `Status.NOT_FOUND`, the code Firestore rejects a missing update with. */
const GRPC_NOT_FOUND = 5

/** Every document, keyed by `collection/id`. */
let docs = new Map<string, Record<string, unknown>>()
/** Appended `adminAudit` rows, in order. */
let audit: Record<string, unknown>[] = []
/**
 * Fires immediately before an `update()` resolves its target, so a test can
 * delete the document in the exact mid-handler window the race needs.
 */
let onUpdate: ((path: string) => void) | null = null

const mockVerifyIdToken = jest.fn()

/**
 * In-memory Firestore: doc get/set/update plus the single-field equality query
 * the uniqueness check runs.
 */
function mockMakeFirestore() {
  const doc = (path: string) => ({
    id: path.split('/').pop(),
    get: async () => ({
      exists: docs.has(path),
      id: path.split('/').pop(),
      data: () => docs.get(path),
      get: (field: string) => (docs.get(path) ?? {})[field],
    }),
    set: async (
      data: Record<string, unknown>,
      options?: { merge?: boolean },
    ) => {
      docs.set(path, options?.merge ? { ...docs.get(path), ...data } : { ...data })
      return undefined
    },
    // Faithful to the real thing: rejects rather than creating. Everything
    // this spec claims rests on it.
    update: async (data: Record<string, unknown>) => {
      onUpdate?.(path)
      if (!docs.has(path)) {
        const error: Error & { code?: number } = new Error(
          `5 NOT_FOUND: no entity to update: ${path}`,
        )
        error.code = GRPC_NOT_FOUND
        throw error
      }
      docs.set(path, { ...docs.get(path), ...data })
      return undefined
    },
  })
  return {
    collection: (name: string) => ({
      doc: (id: string) => doc(`${name}/${id}`),
      add: async (data: Record<string, unknown>) => {
        if (name === 'adminAudit') audit.push({ ...data })
        docs.set(`${name}/auto-${docs.size}`, { ...data })
        return { id: `auto-${docs.size}` }
      },
      where: (field: string, _op: string, value: unknown) => ({
        limit: (count: number) => ({
          get: async () => {
            const matched = [...docs.entries()]
              .filter(
                ([path, data]) =>
                  path.startsWith(`${name}/`) && data[field] === value,
              )
              .slice(0, count)
            return {
              empty: matched.length === 0,
              docs: matched.map(([path, data]) => ({
                id: path.split('/').pop(),
                data: () => data,
                get: (key: string) => data[key],
              })),
            }
          },
        }),
      }),
    }),
  }
}

/**
 * The REAL helper, reached by its own module path so the barrel — and
 * firebase-admin behind it — stays out of this suite. Stubbing it would turn
 * every claim below into a claim about the stub.
 */
const mockUpdateExisting = jest.requireActual(
  '../../../../../../libs/tenant/data/admin/src/lib/server/update-existing',
).updateExisting

/** The real subdomain grammar and reserved list, not a re-typed copy. */
const mockHostNaming = jest.requireActual(
  '../../../../../../libs/aglyn/src/lib/app-utils/host-naming',
)

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
  updateExisting: (...args: unknown[]) => mockUpdateExisting(...args),
}))

jest.mock('firebase-admin/firestore', () => ({
  __esModule: true,
  FieldValue: { serverTimestamp: () => '__now__' },
}))

jest.mock('@aglyn/aglyn/server', () => ({
  __esModule: true,
  SUBDOMAIN_PATTERN: mockHostNaming.SUBDOMAIN_PATTERN,
  isBlockedSubdomain: mockHostNaming.isBlockedSubdomain,
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
  return new Request('https://app.aglyn.com/api/admin/host', {
    method: 'POST',
    headers: {
      authorization: 'Bearer staff-token',
      'content-type': 'application/json',
    },
    body: JSON.stringify(body),
  })
}

/** A real site, with the fields the console lists actually scope by. */
function seedHost(id = 'host-real', subdomain = 'oldname') {
  docs.set(`hosts/${id}`, {
    displayName: 'Real Site',
    orgId: 'org-7',
    subdomain,
  })
  docs.set(`hostIndex/${id}`, { orgId: 'org-7', subdomain })
}

beforeEach(() => {
  docs = new Map()
  audit = []
  onUpdate = null
  mockVerifyIdToken.mockReset()
  mockVerifyIdToken.mockResolvedValue({
    uid: 'staff-1',
    email_verified: true,
    staff: true,
    staffRole: 'super',
  })
  jest.spyOn(console, 'error').mockImplementation(() => undefined)
})

afterEach(() => jest.restoreAllMocks())

describe('the staff retarget refuses an unknown site (AGL-1763)', () => {
  it('404s a mistyped hostId and writes NOTHING', async () => {
    seedHost()
    const response = await POST(
      post({ hostId: 'host-relal', action: 'set-subdomain', subdomain: 'newname' }),
    )
    expect(response.status).toBe(404)
    await expect(response.json()).resolves.toEqual({ error: 'No such site' })
    // The phantom, under either collection: no document at all.
    expect(docs.has('hosts/host-relal')).toBe(false)
    expect(docs.has('hostIndex/host-relal')).toBe(false)
    // And the real site is untouched, field by field.
    expect(docs.get('hosts/host-real')).toEqual({
      displayName: 'Real Site',
      orgId: 'org-7',
      subdomain: 'oldname',
    })
    // No audit row: nothing happened, so claiming one did would be its own lie.
    expect(audit).toHaveLength(0)
  })

  it('SELF-POISONING: the real site can still claim the subdomain afterwards', async () => {
    // The failure this exists to stop, replayed in order. Before the fix the
    // typo minted `hosts/host-relal` = { subdomain: 'newname', updatedAt },
    // which the uniqueness query then matched — so the second call, the
    // legitimate one, came back 409 pointing at a document no list can show.
    seedHost()
    const typo = await POST(
      post({ hostId: 'host-relal', action: 'set-subdomain', subdomain: 'newname' }),
    )
    expect(typo.status).toBe(404)

    const legitimate = await POST(
      post({ hostId: 'host-real', action: 'set-subdomain', subdomain: 'newname' }),
    )
    expect(legitimate.status).toBe(200)
    await expect(legitimate.json()).resolves.toEqual({
      ok: true,
      subdomain: 'newname',
    })
    expect(docs.get('hosts/host-real')?.['subdomain']).toBe('newname')
  })

  it('retargets a real site, every stored field asserted individually', async () => {
    seedHost()
    const response = await POST(
      post({ hostId: 'host-real', action: 'set-subdomain', subdomain: 'newname' }),
    )
    expect(response.status).toBe(200)

    const host = docs.get('hosts/host-real') as Record<string, unknown>
    expect(host['subdomain']).toBe('newname')
    expect(host['updatedAt']).toBe('__now__')
    // The update must PATCH, not replace: fields it never mentions survive.
    expect(host['displayName']).toBe('Real Site')
    expect(host['orgId']).toBe('org-7')

    const index = docs.get('hostIndex/host-real') as Record<string, unknown>
    expect(index['subdomain']).toBe('newname')
    expect(index['orgId']).toBe('org-7')

    expect(audit).toHaveLength(1)
    expect(audit[0]['actorUid']).toBe('staff-1')
    expect(audit[0]['action']).toBe('host.set-subdomain')
    expect(audit[0]['target']).toBe('hosts/host-real')
    expect(audit[0]['before']).toEqual({ subdomain: 'oldname' })
    expect(audit[0]['after']).toEqual({ subdomain: 'newname' })
  })

  it('rebuilds a MISSING routing mirror with its orgId, not subdomain alone', async () => {
    // A host predating the AGL-628 mirror, or one a partial erasure left
    // without it. Creating the index row here is legitimate — it is a pure
    // projection of a host proven to exist — but a `{ subdomain }`-only row
    // would not be: `resolveOrgIdForHost` returns null without `orgId`, and
    // null is the pre-billing FAIL-OPEN, so the stub hands a paid site every
    // feature unmetered.
    seedHost()
    docs.delete('hostIndex/host-real')

    const response = await POST(
      post({ hostId: 'host-real', action: 'set-subdomain', subdomain: 'newname' }),
    )
    expect(response.status).toBe(200)
    const index = docs.get('hostIndex/host-real') as Record<string, unknown>
    expect(index['subdomain']).toBe('newname')
    expect(index['orgId']).toBe('org-7')
  })

  it('SECOND LINE: the site erased between the check and the write is not reborn', async () => {
    // The window the existence read cannot close, opened at exactly the right
    // moment: the host passes the guard and is gone by the time the write
    // lands. `update()` is the only thing standing here — a merge-set would
    // recreate it from the patch.
    seedHost()
    onUpdate = (path) => {
      if (path === 'hosts/host-real') docs.delete(path)
    }

    const response = await POST(
      post({ hostId: 'host-real', action: 'set-subdomain', subdomain: 'newname' }),
    )
    expect(response.status).toBe(404)
    // Not resurrected, and nothing downstream ran on a site that is gone.
    expect(docs.has('hosts/host-real')).toBe(false)
    expect(docs.get('hostIndex/host-real')?.['subdomain']).toBe('oldname')
    expect(audit).toHaveLength(0)
  })

  it('NEGATIVE CONTROL: a non-super staff actor is refused before any read', async () => {
    seedHost()
    mockVerifyIdToken.mockResolvedValue({
      uid: 'staff-2',
      email_verified: true,
      staff: true,
      staffRole: 'support',
    })
    const response = await POST(
      post({ hostId: 'host-real', action: 'set-subdomain', subdomain: 'newname' }),
    )
    expect(response.status).toBe(403)
    expect(docs.get('hosts/host-real')?.['subdomain']).toBe('oldname')
  })

  it('NEGATIVE CONTROL: a real site keeps working when the subdomain is unchanged', async () => {
    // Guards against a fix that 404s or 409s on the no-op resubmit — the
    // uniqueness query matches the site itself, which is allowed.
    seedHost()
    const response = await POST(
      post({ hostId: 'host-real', action: 'set-subdomain', subdomain: 'oldname' }),
    )
    expect(response.status).toBe(200)
    expect(docs.get('hosts/host-real')?.['subdomain']).toBe('oldname')
  })
})

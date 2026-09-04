/**
 * @jest-environment node
 *
 * Pragma must stay in the FIRST block comment — behind the license header it is
 * silently ignored and the suite runs on jsdom, where `Request` is not a
 * constructor and every case here fails identically.
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
 * `/api/hosts/members` — who can reach a site, and whether the record of that
 * changing is one a client may decline to write (AGL-118).
 *
 * These three entries used to be appended by the members card, in the browser,
 * after this route had answered. That is the shape of the bug this whole issue
 * opened on: the uid written was whatever the card's own session held rather
 * than the one the route verified, and any OTHER caller of this endpoint
 * changed who can reach a site and recorded nothing at all.
 *
 * So there are two properties here, and the second is the one a half-finished
 * migration breaks:
 *
 *  1. the route writes the entry, at the write that actually grants or
 *     removes access; and
 *  2. the card does NOT, so one act does not become two rows.
 *
 * Assertions are on the WRITTEN ENTRY — the arguments handed to the logger —
 * never on the response or on anything rendered.
 */

// A module, not a script — without this the const declarations below collide
// with the other console route specs' identical globals under `tsc`.
export {}

import { readFileSync } from 'node:fs'

const mockVerifyIdToken = jest.fn()
const mockLogHostActivity = jest.fn(async (..._args: unknown[]) => undefined)
const mockGrantHostAccess = jest.fn(async (..._args: unknown[]) => undefined)
const mockRevokeHostAccess = jest.fn(async (..._args: unknown[]) => undefined)
const mockFindUserByEmail = jest.fn()
const mockCollaboratorSeatRefusal = jest.fn(
  async (..._args: unknown[]): Promise<Response | null> => null,
)
/** Lazy so the hoisted mock factory never touches a const in its TDZ. */
const mockHostData = jest.fn()

/** Every document, keyed by path — the roster is read AND written here. */
let docs = new Map<string, Record<string, unknown>>()

jest.mock('@aglyn/tenant-data-admin', () => ({
  __esModule: true,
  firebaseAdmin: {
    app: () => ({
      auth: () => ({
        verifyIdToken: (...args: unknown[]) => mockVerifyIdToken(...args),
      }),
      firestore: () => mockMakeFirestore(),
    }),
    firestore: { FieldValue: { serverTimestamp: () => '__now__' } },
  },
  getOrgForHost: async () => ({
    orgId: 'org-1',
    org: { ownerUid: 'owner-1' },
  }),
  lockdownRefusal: async () => null,
  isImpersonationSession: () => false,
  emailUnverifiedResponse: () =>
    Response.json({ error: 'Verify your email' }, { status: 403 }),
  findUserByEmailAcrossPools: (...args: unknown[]) => mockFindUserByEmail(...args),
  grantHostAccess: (...args: unknown[]) => mockGrantHostAccess(...args),
  revokeHostAccess: (...args: unknown[]) => mockRevokeHostAccess(...args),
  collaboratorSeatRefusal: (...args: unknown[]) =>
    mockCollaboratorSeatRefusal(...args),
  collaboratorSeatRefusalResponse: (error: unknown) =>
    (error as { __seatRefusal?: boolean })?.__seatRefusal
      ? Response.json({ error: 'No collaborator seats left' }, { status: 403 })
      : null,
  // CAPTURED, not stubbed away — it is the subject. Named explicitly because
  // this factory is a closed world: an absent export is `undefined`, the
  // route throws into its own catch, and every case here reads as a 500 that
  // looks exactly like the member operation itself regressing.
  logHostActivity: (...args: unknown[]) => mockLogHostActivity(...args),
}))

jest.mock('@aglyn/aglyn/server', () => ({
  __esModule: true,
  createResourceUid: () => 'generated-id',
  pluginRequestFromWeb: async (request: Request) => ({
    method: request.method,
    query: {},
    body: await request.json().catch(() => ({})),
    headers: { authorization: request.headers.get('authorization') ?? undefined },
  }),
}))

jest.mock('@aglyn/tenant-runtime/org-permissions', () => ({
  __esModule: true,
  resolveOrgPermissions: async () => ({ permissions: { manageMembers: false } }),
}))

function mockMakeFirestore(): any {
  const doc = (path: string) => ({
    path,
    id: path.split('/').pop(),
    get: async () => ({
      exists: path === 'hosts/host-1' ? true : docs.has(path),
      get: (field: string) =>
        (path === 'hosts/host-1' ? mockHostData() : (docs.get(path) ?? {}))[field],
      data: () => (path === 'hosts/host-1' ? mockHostData() : docs.get(path)),
    }),
    set: async (data: Record<string, unknown>) => {
      docs.set(path, { ...data })
      return undefined
    },
    update: async (data: Record<string, unknown>) => {
      docs.set(path, { ...docs.get(path), ...data })
      return undefined
    },
    delete: async () => {
      docs.delete(path)
      return undefined
    },
    collection: (name: string) => makeCollection(`${path}/${name}`),
  })
  const makeCollection = (prefix: string) => ({
    doc: (id: string) => doc(`${prefix}/${id}`),
    add: async (data: Record<string, unknown>) => {
      docs.set(`${prefix}/auto-${docs.size}`, { ...data })
      return { id: `auto-${docs.size}` }
    },
    where: (field: string, _op: string, value: unknown) => ({
      limit: () => ({
        get: async () => {
          const matched = [...docs.entries()].filter(
            ([path, data]) => path.startsWith(`${prefix}/`) && data[field] === value,
          )
          return {
            empty: matched.length === 0,
            docs: matched.map(([path, data]) => ({
              id: path.split('/').pop(),
              data: () => data,
            })),
          }
        },
      }),
    }),
  })
  return { collection: (name: string) => makeCollection(name) }
}

const { POST, PATCH, DELETE } = require('./route') as Record<
  'POST' | 'PATCH' | 'DELETE',
  (request: Request) => Promise<Response>
>

function call(
  handler: (request: Request) => Promise<Response>,
  method: string,
  body: unknown,
) {
  return handler(
    new Request('https://app.aglyn.com/api/hosts/members', {
      method,
      headers: { authorization: 'Bearer tok' },
      body: JSON.stringify(body),
    }),
  )
}

/** The single call's arguments, so each case names what it is asserting. */
function entry() {
  const args = mockLogHostActivity.mock.calls[0] as unknown as [
    string,
    { uid: string; email: string | null },
    string,
    Record<string, unknown>,
  ]
  return { hostId: args[0], actor: args[1], action: args[2], target: args[3] }
}

beforeEach(() => {
  jest.clearAllMocks()
  docs = new Map()
  mockVerifyIdToken.mockResolvedValue({
    uid: 'u-1',
    email: 'admin@example.test',
    email_verified: true,
  })
  mockHostData.mockReturnValue({ memberRoles: { 'u-1': 'admin' }, orgId: 'org-1' })
  mockFindUserByEmail.mockResolvedValue({ record: { uid: 'uid-9', displayName: 'Nine' } })
  mockCollaboratorSeatRefusal.mockResolvedValue(null)
  // Re-armed every case, not merely cleared. `clearAllMocks` forgets the
  // CALLS and keeps the IMPLEMENTATION, so the seat-refusal rejection below
  // would otherwise leak forward and turn a later 200 into a 403 — a failure
  // that reads as the route refusing a legitimate role change.
  mockGrantHostAccess.mockResolvedValue(undefined)
  mockRevokeHostAccess.mockResolvedValue(undefined)
  jest.spyOn(console, 'error').mockImplementation(() => undefined)
})

afterEach(() => jest.restoreAllMocks())

describe('every membership change reaches the log, from the server (AGL-118)', () => {
  it('THE CONTROL — adding a member with an account writes one entry', async () => {
    // First, because every "writes nothing" case below also passes against a
    // route that logs nothing at all, in any branch, forever.
    const response = await call(POST, 'POST', {
      hostId: 'host-1',
      email: 'nine@example.test',
      role: 'editor',
    })

    expect(response.status).toBe(200)
    // The roster row really landed — otherwise this is asserting the log of a
    // grant that did not happen.
    expect(docs.get('hosts/host-1/members/uid-9')).toMatchObject({
      email: 'nine@example.test',
      role: 'editor',
      status: 'active',
    })

    expect(mockLogHostActivity).toHaveBeenCalledTimes(1)
    const { hostId, actor, action, target } = entry()
    expect(hostId).toBe('host-1')
    // The uid this route VERIFIED off the token. The card used to write
    // whatever its own session held, which is the same value only when the
    // caller is a browser — and this endpoint has other callers.
    expect(actor).toEqual({ uid: 'u-1', email: 'admin@example.test' })
    expect(action).toBe('Added member')
    expect(target).toEqual({
      type: 'member',
      id: 'uid-9',
      name: 'nine@example.test',
    })
  })

  it('says INVITED, not added, for an address with no account', async () => {
    // Different words because they are different facts: this person holds a
    // pending grant on an org invite and cannot reach the site until they
    // accept. One action string for both would make the feed say somebody has
    // access who does not.
    mockFindUserByEmail.mockResolvedValue(null)

    await call(POST, 'POST', {
      hostId: 'host-1',
      email: 'stranger@example.test',
      role: 'viewer',
    })

    expect(entry().action).toBe('Invited member')
  })

  it('writes NOTHING when the seat cap refuses the add', async () => {
    mockCollaboratorSeatRefusal.mockResolvedValue(
      Response.json({ error: 'No seats' }, { status: 403 }),
    )

    expect(
      (await call(POST, 'POST', { hostId: 'host-1', email: 'a@b.test' })).status,
    ).toBe(403)

    expect(mockLogHostActivity).not.toHaveBeenCalled()
  })

  it('writes NOTHING when the seat cap refuses from inside the grant', async () => {
    // The hard cap is raised as an exception from inside `grantHostAccess`'s
    // own transaction, which lands in the route's catch and answers 403. The
    // roster write never runs, and neither may the entry — a row here would
    // record access somebody was refused.
    mockGrantHostAccess.mockRejectedValue(
      Object.assign(new Error('seats'), { __seatRefusal: true }),
    )

    expect(
      (await call(POST, 'POST', { hostId: 'host-1', email: 'a@b.test' })).status,
    ).toBe(403)

    expect(mockLogHostActivity).not.toHaveBeenCalled()
    expect(docs.get('hosts/host-1/members/uid-9')).toBeUndefined()
  })

  it('writes NOTHING for an address already on the roster', async () => {
    docs.set('hosts/host-1/members/uid-9', {
      email: 'nine@example.test',
      role: 'viewer',
    })

    expect(
      (
        await call(POST, 'POST', {
          hostId: 'host-1',
          email: 'nine@example.test',
        })
      ).status,
    ).toBe(409)

    expect(mockLogHostActivity).not.toHaveBeenCalled()
  })

  it('records a role change, and names the role it became', async () => {
    docs.set('hosts/host-1/members/uid-9', {
      email: 'nine@example.test',
      role: 'viewer',
      uid: 'uid-9',
    })

    expect(
      (
        await call(PATCH, 'PATCH', {
          hostId: 'host-1',
          memberId: 'uid-9',
          role: 'admin',
        })
      ).status,
    ).toBe(200)

    // The GRANT is what moves `memberRoles`, which is what the rules read.
    expect(mockGrantHostAccess).toHaveBeenCalled()
    expect(mockLogHostActivity).toHaveBeenCalledTimes(1)
    // An entry saying only that access changed cannot answer the question it
    // is read for.
    expect(entry().action).toBe('Changed member role to admin')
    expect(entry().target).toEqual({
      type: 'member',
      id: 'uid-9',
      name: 'nine@example.test',
    })
  })

  it('writes NOTHING when the role change names an unknown member', async () => {
    expect(
      (
        await call(PATCH, 'PATCH', {
          hostId: 'host-1',
          memberId: 'ghost',
          role: 'admin',
        })
      ).status,
    ).toBe(404)

    expect(mockLogHostActivity).not.toHaveBeenCalled()
  })

  it('records a removal, naming the address that no longer has access', async () => {
    docs.set('hosts/host-1/members/uid-9', {
      email: 'nine@example.test',
      role: 'editor',
      uid: 'uid-9',
    })

    expect(
      (await call(DELETE, 'DELETE', { hostId: 'host-1', memberId: 'uid-9' }))
        .status,
    ).toBe(200)

    expect(mockRevokeHostAccess).toHaveBeenCalledWith('org-1', 'uid-9', 'host-1')
    expect(mockLogHostActivity).toHaveBeenCalledTimes(1)
    expect(entry().action).toBe('Removed member')
    // The email is read off the snapshot taken BEFORE the delete, which is
    // the only place it still exists. A route that composed the entry
    // afterwards would leave the feed naming an id nobody can resolve.
    expect(entry().target).toEqual({
      type: 'member',
      id: 'uid-9',
      name: 'nine@example.test',
    })
  })

  it('writes NOTHING when the owner cannot be removed', async () => {
    docs.set('hosts/host-1/members/owner-1', {
      email: 'owner@example.test',
      uid: 'owner-1',
    })

    expect(
      (await call(DELETE, 'DELETE', { hostId: 'host-1', memberId: 'owner-1' }))
        .status,
    ).toBe(400)

    expect(mockLogHostActivity).not.toHaveBeenCalled()
    expect(docs.get('hosts/host-1/members/owner-1')).toBeDefined()
  })

  it('writes NOTHING when the caller is not allowed to manage members', async () => {
    mockHostData.mockReturnValue({ memberRoles: { 'u-1': 'editor' }, orgId: 'org-1' })

    expect(
      (await call(POST, 'POST', { hostId: 'host-1', email: 'a@b.test' })).status,
    ).toBe(403)

    expect(mockLogHostActivity).not.toHaveBeenCalled()
  })
})

describe('one writer, so one act is one row', () => {
  it('the members card no longer appends its own entry', () => {
    /*
     * A source assertion, because the failure it guards is invisible from
     * either side alone: the route logs correctly, the card logs correctly,
     * and the customer's feed shows every membership change TWICE. Neither a
     * route test nor a component test can see that, because each is right.
     *
     * The card keeps every other behaviour — it is only the audit append that
     * moved behind the Admin SDK.
     */
    const card = readFileSync(
      require.resolve('../../../../components/host-members-card.component'),
      'utf8',
    )
    expect(card).not.toContain('useHostActivityLogger')
    expect(card).not.toContain('logActivity(')
  })
})

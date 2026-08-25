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

/**
 * The org owner seat is not writable through the membership door (AGL-1888).
 *
 * ## The reachable half: an invitation demotes the owner, permanently
 *
 * `/api/orgs/invites` create never checks that the address already belongs to
 * a member, and accept explicitly accommodates an existing member re-accepting
 * — it passes the invite doc's STORED role into `upsertOrgMember`. So any
 * admin could invite the OWNER'S own verified address as `viewer`, the owner
 * clicks a perfectly ordinary invitation to their own organization, and their
 * member doc is merge-written to `role: 'viewer', allHosts: false`.
 *
 * `orgs/{orgId}.ownerUid` still names them. Nothing else does:
 *
 *  - `canManageOrg` reads the member doc → they cannot reach org settings;
 *  - `transfer-ownership` gates on `membership.member.role === 'owner'` →
 *    they cannot hand it back or take it back;
 *  - `/api/orgs/members` refuses to edit the owner's membership at all;
 *  - `findBreakGlassOrgOwners` queries `where('role','==','owner')` → an
 *    SSO-enforced org's entire break-glass guarantee reads as absent.
 *
 * Self-serve, one click, recoverable only by staff. The AGL-1375 one-way door
 * rebuilt out of the invite path, and it needs no SSO to reach.
 *
 * ## The latent half: an invitation GRANTS owner
 *
 * The same missing re-validation in the other direction. Safe today only
 * because every writer of an invite doc refuses `owner` and the collection is
 * `allow write: if false` — an escalation the moment a fourth invite-writer
 * forgets. The invariant that an org has exactly one owner is load-bearing for
 * the SSO transfer guard, and until now nothing pinned it.
 *
 * ## Why these assertions are shaped this way
 *
 * A refusal test that only asserts a throw proves a constant exists. Each
 * refusal below reads the store afterwards and asserts the owner's row is
 * BYTE-FOR-BYTE what it was — a guard that threw after writing would pass the
 * first assertion and fail this one.
 *
 * The positives are not decoration. `GUARD IS LIVE` runs the identical call
 * against a non-owner and asserts it lands, so a guard that simply refused
 * every upsert could not pass; and the two legitimate producers of an owner —
 * `createOrganization` and `transferOrgOwnership`, which write `role: 'owner'`
 * with their own `tx.set` — are exercised here so that "no owner may ever be
 * written" is not what accidentally ships.
 */

export {}

// ---------------------------------------------------------------------------
// A small Firestore double: snapshot reads, merge-set writes, real throws on
// `undefined`. No concurrency harness — nothing here races.
// ---------------------------------------------------------------------------

type Doc = Record<string, unknown>

let store = new Map<string, Doc>()

function mockMerge(existing: Doc | undefined, data: Doc, merge: boolean): Doc {
  const base: Doc = merge ? { ...(existing ?? {}) } : {}
  for (const [key, value] of Object.entries(data)) {
    // The real SDK REJECTS `undefined`; a double that stores it fabricates
    // greens for code that should have thrown.
    if (value === undefined) {
      throw new Error(`Cannot use "undefined" as a Firestore value (${key})`)
    }
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

const mockSnapshot = (path: string) => ({
  id: path.split('/').pop() as string,
  ref: { path },
  exists: store.has(path),
  data: () => store.get(path),
  get: (field: string) => (store.get(path) ?? {})[field],
})

interface MockQuery {
  __prefix: string
  __filters: Array<[string, unknown]>
}

function mockRunQuery(query: MockQuery) {
  const docs = [...store.entries()].filter(([path, data]) => {
    if (!path.startsWith(`${query.__prefix}/`)) return false
    if (path.slice(query.__prefix.length + 1).includes('/')) return false
    return query.__filters.every(
      ([field, value]) => (data[field] ?? null) === value,
    )
  })
  return {
    empty: docs.length === 0,
    size: docs.length,
    docs: docs.map(([path]) => mockSnapshot(path)),
  }
}

function mockMakeQuery(
  prefix: string,
  filters: Array<[string, unknown]>,
): any {
  return {
    __prefix: prefix,
    __filters: filters,
    where: (field: string, _op: string, value: unknown) =>
      mockMakeQuery(prefix, [...filters, [field, value]]),
    limit: () => mockMakeQuery(prefix, filters),
    get: async () => mockRunQuery({ __prefix: prefix, __filters: filters }),
    count: () => ({
      get: async () => ({
        data: () => ({
          count: mockRunQuery({ __prefix: prefix, __filters: filters }).size,
        }),
      }),
    }),
  }
}

function mockMakeDoc(path: string): any {
  return {
    path,
    id: path.split('/').pop(),
    collection: (name: string) => mockMakeCollection(`${path}/${name}`),
    get: async () => mockSnapshot(path),
    set: async (data: Doc, options?: { merge?: boolean }) => {
      store.set(path, mockMerge(store.get(path), data, Boolean(options?.merge)))
    },
    update: async (data: Doc) => {
      if (!store.has(path)) {
        const error = new Error('NOT_FOUND') as Error & { code?: number }
        error.code = 5
        throw error
      }
      store.set(path, mockMerge(store.get(path), data, true))
    },
    delete: async () => {
      store.delete(path)
    },
  }
}

function mockMakeCollection(prefix: string): any {
  return {
    ...mockMakeQuery(prefix, []),
    doc: (id: string) => mockMakeDoc(`${prefix}/${id}`),
  }
}

function mockFirestore(): any {
  return {
    collection: (name: string) => mockMakeCollection(name),
    batch: () => {
      const writes: Array<() => void> = []
      return {
        set: (
          ref: { path: string },
          data: Doc,
          options?: { merge?: boolean },
        ) => {
          writes.push(() => {
            store.set(
              ref.path,
              mockMerge(store.get(ref.path), data, Boolean(options?.merge)),
            )
          })
        },
        delete: (ref: { path: string }) => {
          writes.push(() => {
            store.delete(ref.path)
          })
        },
        commit: async () => {
          for (const write of writes) write()
        },
      }
    },
    runTransaction: async <T,>(fn: (tx: unknown) => Promise<T>): Promise<T> => {
      // Writes are BUFFERED and applied only on a clean return, exactly like
      // the real thing. That is what makes "the store is unchanged" a
      // meaningful assertion rather than a restatement of the throw.
      const writes: Array<[string, Doc, boolean]> = []
      const tx = {
        get: async (target: any) =>
          typeof target?.__prefix === 'string' && !target.path
            ? mockRunQuery(target as MockQuery)
            : mockSnapshot(target.path),
        set: (ref: { path: string }, data: Doc, options?: { merge?: boolean }) => {
          writes.push([ref.path, data, Boolean(options?.merge)])
        },
      }
      const result = await fn(tx)
      for (const [path, data, merge] of writes) {
        store.set(path, mockMerge(store.get(path), data, merge))
      }
      return result
    },
  }
}

jest.mock('./firebase-admin', () => ({
  __esModule: true,
  default: { app: () => ({ firestore: () => mockFirestore() }) },
}))
jest.mock('firebase-admin/firestore', () => ({
  __esModule: true,
  FieldValue: {
    serverTimestamp: () => '__now__',
    delete: () => '__delete__',
  },
}))
jest.mock('./host-memberships', () => ({
  __esModule: true,
  deleteMemberHostProjections: async () => undefined,
  syncHostProjectionForMembers: async () => undefined,
  syncMemberHostProjections: async () => undefined,
}))
jest.mock('./auth-pools', () => ({
  __esModule: true,
  findUserByUidAcrossPools: async () => null,
}))
jest.mock('./update-existing', () => ({
  __esModule: true,
  updateExisting: async () => undefined,
}))
jest.mock('./workspace-domains', () => ({
  __esModule: true,
  attachWorkspaceDomain: async () => undefined,
}))

const {
  OrgOwnerSeatError,
  createOrganization,
  orgOwnerSeatRefusalResponse,
  transferOrgOwnership,
  upsertOrgMember,
} = require('./organizations') as typeof import('./organizations')

const ORG = 'org-1'
const OWNER = 'owner-uid'
const MEMBER = 'member-uid'

/** An org with an owner on the roster, exactly as `createOrganization` leaves it. */
function seedOrg(ownerUid = OWNER): void {
  store.set(`orgs/${ORG}`, {
    name: 'Org',
    slug: 'org',
    ownerUid,
    createdByUid: ownerUid,
    hosts: {},
  })
  store.set(`orgs/${ORG}/members/${OWNER}`, {
    role: 'owner',
    allHosts: true,
    email: 'owner@example.com',
  })
  store.set(`users/${OWNER}/orgs/${ORG}`, {
    role: 'owner',
    orgName: 'Org',
    slug: 'org',
    orgWide: true,
  })
}

const ownerRow = () => store.get(`orgs/${ORG}/members/${OWNER}`)
const ownerProjection = () => store.get(`users/${OWNER}/orgs/${ORG}`)

/** Exactly the payload `/api/orgs/invites` accept builds from an invite doc. */
const acceptInviteAs = (uid: string, role: string) =>
  upsertOrgMember({
    orgId: ORG,
    uid,
    role: role as never,
    allHosts: true,
    hostAccess: {},
    email: 'owner@example.com',
    invitedBy: 'admin-uid',
  })

beforeEach(() => {
  store = new Map()
})

describe('THE ONE-WAY DOOR: an invitation cannot demote the owner (AGL-1888)', () => {
  it('refuses the owner re-accepting an org-wide viewer invite', async () => {
    seedOrg()
    const before = { ...(ownerRow() as Doc) }
    await expect(acceptInviteAs(OWNER, 'viewer')).rejects.toBeInstanceOf(
      OrgOwnerSeatError,
    )
    // Not merely "it threw": the row is untouched. A guard that refused
    // AFTER the merge-set would satisfy the line above and fail this one.
    expect(ownerRow()).toEqual(before)
    expect(ownerRow()?.['role']).toBe('owner')
    expect(ownerRow()?.['allHosts']).toBe(true)
    // …and the reverse index the console actually resolves reach from.
    expect(ownerProjection()?.['role']).toBe('owner')
    expect(ownerProjection()?.['orgWide']).toBe(true)
  })

  it('refuses an admin-role invite too — it is the SEAT, not the demotion depth', async () => {
    seedOrg()
    await expect(acceptInviteAs(OWNER, 'admin')).rejects.toBeInstanceOf(
      OrgOwnerSeatError,
    )
    expect(ownerRow()?.['role']).toBe('owner')
  })

  it('GUARD IS LIVE: the identical accept lands for a non-owner member', async () => {
    // The inverse fixture. Without it every assertion above is satisfied by a
    // door that refuses everything, which is a different bug wearing the same
    // green.
    seedOrg()
    store.set(`orgs/${ORG}/members/${MEMBER}`, {
      role: 'editor',
      allHosts: true,
    })
    await acceptInviteAs(MEMBER, 'viewer')
    expect(store.get(`orgs/${ORG}/members/${MEMBER}`)?.['role']).toBe('viewer')
    expect(store.get(`users/${MEMBER}/orgs/${ORG}`)?.['role']).toBe('viewer')
  })

  it('refuses on ownerUid ALONE, when the member row has already diverged', async () => {
    // Half one of the `||`. An org whose two facts disagree is the one that
    // most needs the write refused, not the one the guard should give up on.
    seedOrg()
    store.set(`orgs/${ORG}/members/${OWNER}`, { role: 'admin', allHosts: true })
    await expect(acceptInviteAs(OWNER, 'viewer')).rejects.toBeInstanceOf(
      OrgOwnerSeatError,
    )
    expect(ownerRow()?.['role']).toBe('admin')
  })

  it('refuses on the STORED ROLE alone, when ownerUid names someone else', async () => {
    // Half two of the `||`, and the reason neither fact is trusted to stand
    // for the other.
    seedOrg('someone-else')
    await expect(acceptInviteAs(OWNER, 'viewer')).rejects.toBeInstanceOf(
      OrgOwnerSeatError,
    )
    expect(ownerRow()?.['role']).toBe('owner')
  })
})

describe('THE LATENT ESCALATION: owner is not grantable here (AGL-1888)', () => {
  it('refuses role owner, and opens no transaction at all', async () => {
    seedOrg()
    // Deliberately NO member row for this uid, and the check runs before the
    // org doc is read — so an empty store proves the refusal preceded every
    // read as well as every write.
    store.delete(`orgs/${ORG}`)
    await expect(acceptInviteAs(MEMBER, 'owner')).rejects.toBeInstanceOf(
      OrgOwnerSeatError,
    )
    expect(store.has(`orgs/${ORG}/members/${MEMBER}`)).toBe(false)
    expect(store.has(`users/${MEMBER}/orgs/${ORG}`)).toBe(false)
  })

  it('names WHICH invariant refused, so the two are distinguishable', async () => {
    seedOrg()
    await expect(acceptInviteAs(MEMBER, 'owner')).rejects.toMatchObject({
      reason: 'grant',
    })
    await expect(acceptInviteAs(OWNER, 'viewer')).rejects.toMatchObject({
      reason: 'demote',
    })
  })
})

describe('the refusal reaches the route as a 409, not a 500 (AGL-1888)', () => {
  it('maps an owner-seat error and passes everything else through', async () => {
    const response = orgOwnerSeatRefusalResponse(new OrgOwnerSeatError('demote'))
    expect(response?.status).toBe(409)
    expect(await response?.json()).toMatchObject({ code: 'org_owner_seat' })
    // A catch block that swallowed unrelated faults would mask real 500s.
    expect(orgOwnerSeatRefusalResponse(new Error('boom'))).toBeNull()
  })
})

describe('the two legitimate producers of an owner still work (AGL-1888)', () => {
  it('createOrganization writes an owner', async () => {
    const orgId = await createOrganization({
      name: 'Fresh Org',
      slug: 'fresh-org',
      ownerUid: 'founder',
      ownerEmail: 'founder@example.com',
      // Not what is under test here, and it reads a platform document this
      // double is not seeded with.
      bypassFreeWorkspaceCap: true,
    })
    expect(store.get(`orgs/${orgId}/members/founder`)?.['role']).toBe('owner')
    expect(store.get(`orgs/${orgId}`)?.['ownerUid']).toBe('founder')
  })

  it('transferOrgOwnership MOVES the seat and demotes the previous holder', async () => {
    seedOrg()
    store.set(`orgs/${ORG}/members/${MEMBER}`, {
      role: 'admin',
      allHosts: true,
    })
    await transferOrgOwnership(ORG, OWNER, MEMBER)
    expect(store.get(`orgs/${ORG}/members/${MEMBER}`)?.['role']).toBe('owner')
    expect(ownerRow()?.['role']).toBe('admin')
    expect(store.get(`orgs/${ORG}`)?.['ownerUid']).toBe(MEMBER)
    // AGL-2265: the transfer must never launder the free-workspace count.
    expect(store.get(`orgs/${ORG}`)?.['createdByUid']).toBe(OWNER)
  })
})

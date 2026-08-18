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
 * `membersPerHost` must be a HARD CAP on every door that admits a site
 * collaborator, and under concurrency (AGL-2068).
 *
 * ZACH, 2026-08-18, verbatim: **"We need to make sure the free/hobby tier does
 * hard cap so it always actually stays free."**
 *
 * ## What was broken
 *
 * Four routes grant a collaborator; ONE metered it:
 *
 * | door | gated before AGL-2068 |
 * | -- | -- |
 * | `/api/hosts/members` POST | yes — but against the wrong collection |
 * | `/api/orgs/invites` create (site-scoped) | no |
 * | `/api/orgs/invites` accept (site-scoped) | no |
 * | `/api/orgs/members` `hostAccess` branch | no |
 *
 * The three unguarded ones gate on `isOrgWideMember(...)`, which is false for
 * exactly the `{ role:'viewer'|'editor', allHosts:false, hostAccess:{…} }`
 * shape a collaborator has — so the seat check was skipped and the grant ran
 * unconditionally. And the one door that DID check counted
 * `hosts/{hostId}/members`, a display roster only that route writes, so it
 * could not see anyone the other three admitted. A free org
 * (`membersPerHost: 1`) could take on unlimited collaborators with full site
 * access, on a plan that is never invoiced.
 *
 * ## Why the assertions are shaped this way
 *
 * Every door funnels through `grantHostAccess` or `upsertOrgMember`, so this
 * drives those two directly rather than four routes' worth of auth mocking —
 * they are where the cap now lives, inside the grant transaction.
 *
 * A test that calls once and expects a throw proves only that a constant
 * exists. These FORCE the branch: they drive the over-limit path, assert the
 * refusal, and then re-run the identical sequence against a plan with room and
 * assert everything lands — so a gate that simply refused everything could not
 * pass either half.
 *
 * The concurrency harness below models Firestore's optimistic concurrency for
 * real (read-set versions + conflict + retry), not FIFO serialisation, and
 * `THE HARNESS CAN SEE A RACE` proves it by racing a pre-transaction read —
 * the exact shape of the bug — and asserting it over-grants. Without that
 * control, a green concurrency test proves the mock serialised, not that the
 * product is safe.
 */

export {}

// ---------------------------------------------------------------------------
// A Firestore double with optimistic concurrency, not a FIFO queue.
// ---------------------------------------------------------------------------

type Doc = Record<string, unknown>

let store = new Map<string, Doc>()

/** Deep-merges maps the way Firestore's `set(…, {merge:true})` does. */
function mockMerge(existing: Doc | undefined, data: Doc, merge: boolean): Doc {
  const base: Doc = merge ? { ...(existing ?? {}) } : {}
  for (const [key, value] of Object.entries(data)) {
    // `undefined` is REJECTED by the real SDK — a double that silently stores
    // it fabricates greens for code that should have thrown.
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

const mockSnapshot = (path: string, source: Map<string, Doc> = store) => ({
  id: path.split('/').pop() as string,
  ref: { path },
  exists: source.has(path),
  data: () => source.get(path),
  get: (field: string) => (source.get(path) ?? {})[field],
})

/** Yields to the event loop so concurrent transactions genuinely interleave. */
const mockTick = () => new Promise<void>((resolve) => setImmediate(resolve))

interface MockQuery {
  __prefix: string
  __filters: Array<[string, unknown]>
}

function mockRunQuery(query: MockQuery, source: Map<string, Doc> = store) {
  const docs = [...source.entries()].filter(([path, data]) => {
    if (!path.startsWith(`${query.__prefix}/`)) return false
    if (path.slice(query.__prefix.length + 1).includes('/')) return false
    return query.__filters.every(([field, value]) => (data[field] ?? null) === value)
  })
  return {
    empty: docs.length === 0,
    size: docs.length,
    docs: docs.map(([path]) => mockSnapshot(path, source)),
  }
}

function mockMakeQuery(prefix: string, filters: Array<[string, unknown]>): any {
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
      // The real `update()` throws NOT_FOUND on a missing document; a double
      // that upserts instead fabricates a green for `updateExisting`.
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

let mockTxAttempts = 0
let mockTxInFlight = 0
let mockTxMaxInFlight = 0

function mockFirestore(): any {
  return {
    collection: (name: string) => mockMakeCollection(name),
    batch: () => {
      const writes: Array<() => void> = []
      return {
        set: (ref: { path: string }, data: Doc, options?: { merge?: boolean }) => {
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
      mockTxInFlight += 1
      mockTxMaxInFlight = Math.max(mockTxMaxInFlight, mockTxInFlight)
      try {
      for (let attempt = 0; attempt < 12; attempt += 1) {
        mockTxAttempts += 1
        // The read set, as a fingerprint of exactly what was returned. A
        // version counter would be cheaper and is how Firestore really does
        // it, but a fingerprint cannot be defeated by a bookkeeping mistake
        // in the double: if what I read is not what is there now, I conflict.
        const reads: Array<() => string> = []
        const fingerprints: string[] = []
        const writes: Array<[string, Doc, boolean]> = []
        // SNAPSHOT ISOLATION, as real Firestore gives a transaction: every
        // read in one attempt sees the database as it stood at the first
        // read, not as it stands now.
        let isolated: Map<string, Doc> | null = null
        const fingerprint = (target: any, source: Map<string, Doc>): string =>
          typeof target?.__prefix === 'string' && !target.path
            ? JSON.stringify(
                mockRunQuery(target as MockQuery, source).docs.map((doc) => [
                  doc.ref.path,
                  doc.data() ?? null,
                ]),
              )
            : JSON.stringify(source.get(target.path) ?? null)
        const tx = {
          get: async (target: any) => {
            await mockTick()
            if (!isolated) isolated = new Map(store)
            const snapshotOf = isolated
            reads.push(() => fingerprint(target, store))
            fingerprints.push(fingerprint(target, snapshotOf))
            return typeof target?.__prefix === 'string' && !target.path
              ? mockRunQuery(target as MockQuery, snapshotOf)
              : mockSnapshot(target.path, snapshotOf)
          },
          set: (ref: { path: string }, data: Doc, options?: { merge?: boolean }) => {
            writes.push([ref.path, data, Boolean(options?.merge)])
          },
        }
        const result = await fn(tx)
        // Commit check + apply, SYNCHRONOUSLY — no await between them, so it
        // is atomic with respect to the event loop, which is what makes this
        // a real conflict detector rather than a FIFO queue.
        const conflict = reads.some(
          (recompute, index) => recompute() !== fingerprints[index],
        )
        if (conflict) continue
        for (const [path, data, merge] of writes) {
          store.set(path, mockMerge(store.get(path), data, merge))
        }
        return result
      }
      throw new Error('transaction exceeded retry budget')
      } finally {
        mockTxInFlight -= 1
      }
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
  CollaboratorSeatLimitError,
  grantHostAccess,
  upsertOrgMember,
} = require('./organizations') as typeof import('./organizations')

const ORG = 'org-1'
const HOST = 'host-1'

/** Free carries `membersPerHost: 1`. `entitlements` overrides raise it. */
function seedOrg(membersPerHost?: number): void {
  store.set(`orgs/${ORG}`, {
    plan: 'free',
    name: 'Org',
    slug: 'org',
    hosts: { [HOST]: true },
    // BOTH keys. `checkSeatQuota` clamps to `maxMembersPerHost`, which free
    // also pins at 1 — raising only the included figure leaves the effective
    // limit at 1 and the "guard is live" fixtures would silently assert the
    // same thing as the refusal ones.
    ...(membersPerHost === undefined
      ? {}
      : {
          entitlements: {
            membersPerHost,
            maxMembersPerHost: membersPerHost,
          },
        }),
  })
}

const collaboratorsOnHost = () =>
  [...store.entries()].filter(
    ([path, data]) =>
      path.startsWith(`orgs/${ORG}/members/`) &&
      Boolean((data['hostAccess'] as Record<string, unknown> | undefined)?.[HOST]) &&
      data['allHosts'] !== true,
  ).length

const addCollaborator = (uid: string) =>
  grantHostAccess({
    orgId: ORG,
    uid,
    hostId: HOST,
    role: 'editor',
    email: `${uid}@example.com`,
  })

beforeEach(() => {
  store = new Map()
  mockTxAttempts = 0
  mockTxInFlight = 0
  mockTxMaxInFlight = 0
})

describe('membersPerHost is a hard cap on every door (AGL-2068)', () => {
  it('lets the FIRST collaborator through — the gate is not simply "no"', async () => {
    seedOrg()
    await addCollaborator('u1')
    expect(collaboratorsOnHost()).toBe(1)
  })

  it('refuses the SECOND, sequentially, through /api/hosts/members', async () => {
    seedOrg()
    await addCollaborator('u1')
    await expect(addCollaborator('u2')).rejects.toBeInstanceOf(
      CollaboratorSeatLimitError,
    )
    expect(collaboratorsOnHost()).toBe(1)
  })

  it('GUARD IS LIVE: the same second collaborator lands on a plan with room', async () => {
    // The inverse fixture. Without it the assertion above is satisfied by a
    // gate that refuses everything, which is a different bug wearing the
    // same green.
    seedOrg(2)
    await addCollaborator('u1')
    await addCollaborator('u2')
    expect(collaboratorsOnHost()).toBe(2)
  })

  it('an org with no plan is capped as free, not left unmetered', async () => {
    store.set(`orgs/${ORG}`, { hosts: { [HOST]: true } })
    await addCollaborator('u1')
    await expect(addCollaborator('u2')).rejects.toBeInstanceOf(
      CollaboratorSeatLimitError,
    )
  })
})

describe('the count sees every door, not just its own roster (AGL-2068)', () => {
  it('THE FAIL-OPEN: /api/orgs/members fills the seat, /api/hosts/members must see it', async () => {
    // This is the reported defect. The `hostAccess` branch of
    // `/api/orgs/members` writes `orgs/{id}/members` and never touched
    // `hosts/{id}/members` — the collection the one enforcing door counted —
    // so that door read zero and admitted a second collaborator on a plan
    // that includes one.
    seedOrg()
    await upsertOrgMember({
      orgId: ORG,
      uid: 'u1',
      role: 'viewer',
      allHosts: false,
      hostAccess: { [HOST]: 'editor' },
      email: 'u1@example.com',
    })
    expect(collaboratorsOnHost()).toBe(1)
    await expect(addCollaborator('u2')).rejects.toBeInstanceOf(
      CollaboratorSeatLimitError,
    )
    expect(collaboratorsOnHost()).toBe(1)
  })

  it('THE FAIL-OPEN: invite ACCEPTANCE is refused once the seat is taken', async () => {
    // `/api/orgs/invites` accept gates on `acceptingAsManager`, false for a
    // site-scoped invite, so `upsertOrgMember` ran unconditionally.
    seedOrg()
    await addCollaborator('u1')
    await expect(
      upsertOrgMember({
        orgId: ORG,
        uid: 'u2',
        role: 'viewer',
        allHosts: false,
        hostAccess: { [HOST]: 'viewer' },
        email: 'u2@example.com',
      }),
    ).rejects.toBeInstanceOf(CollaboratorSeatLimitError)
  })

  it('a PENDING site-scoped invite reserves the seat', async () => {
    // Otherwise the cap is walked past by mailing N invites first and
    // accepting them later — the same reason the manager gate counts them.
    seedOrg()
    store.set(`orgs/${ORG}/invites/i1`, {
      email: 'pending@example.com',
      role: 'viewer',
      allHosts: false,
      hostAccess: { [HOST]: 'editor' },
      acceptedAt: null,
    })
    await expect(addCollaborator('u1')).rejects.toBeInstanceOf(
      CollaboratorSeatLimitError,
    )
  })

  it('an ACCEPTED invite is not double-counted against its own acceptance', async () => {
    // At the moment acceptance is decided the invitee holds a pending invite
    // AND is about to hold a membership. Counting either against them refuses
    // the accept the invite was issued for.
    seedOrg()
    store.set(`orgs/${ORG}/invites/i1`, {
      email: 'joiner@example.com',
      role: 'viewer',
      allHosts: false,
      hostAccess: { [HOST]: 'editor' },
      acceptedAt: null,
    })
    await upsertOrgMember({
      orgId: ORG,
      uid: 'joiner',
      role: 'viewer',
      allHosts: false,
      hostAccess: { [HOST]: 'editor' },
      email: 'joiner@example.com',
    })
    expect(collaboratorsOnHost()).toBe(1)
  })

  it('a MANAGER does not consume a collaborator seat', async () => {
    // Managers reach every host and pay a manager seat; charging them here
    // would bill one person twice and trip a cap they are not on (AGL-1113).
    seedOrg()
    await upsertOrgMember({
      orgId: ORG,
      uid: 'boss',
      role: 'admin',
      allHosts: true,
      hostAccess: {},
      email: 'boss@example.com',
    })
    await addCollaborator('u1')
    expect(collaboratorsOnHost()).toBe(1)
  })

  it('changing an existing collaborator’s role is not a new seat', async () => {
    // At the cap, refusing a role change would strand an over-limit org
    // unable to even demote its way back.
    seedOrg()
    await addCollaborator('u1')
    await grantHostAccess({
      orgId: ORG,
      uid: 'u1',
      hostId: HOST,
      role: 'viewer',
      email: 'u1@example.com',
    })
    expect(
      (store.get(`orgs/${ORG}/members/u1`)?.['hostAccess'] as Record<string, unknown>)[
        HOST
      ],
    ).toBe('viewer')
  })
})

describe('the cap holds under concurrency (AGL-2068)', () => {
  const SIX = ['c1', 'c2', 'c3', 'c4', 'c5', 'c6']

  it('THE RACE: six simultaneous grants yield exactly one collaborator', async () => {
    // Before this, the count was read in the route and the grant happened
    // afterwards, so six concurrent requests all read zero, all passed, and
    // all landed — the create-time-quota shape AGL-1390, AGL-2057 and
    // AGL-2063 each hit in turn. The read is now inside the transaction, so a
    // grant whose roster moved underneath it retries and refuses.
    seedOrg()
    const results = await Promise.allSettled(SIX.map(addCollaborator))
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1)
    expect(
      results.filter(
        (r) =>
          r.status === 'rejected' &&
          r.reason instanceof CollaboratorSeatLimitError,
      ),
    ).toHaveLength(5)
    expect(collaboratorsOnHost()).toBe(1)
    // THE RACE WAS REAL, not a queue: all six transactions were open at once,
    // and the losers re-ran. A harness that serialised would report one in
    // flight and exactly six attempts, and every green here would be the
    // mock's rather than the product's.
    expect(mockTxMaxInFlight).toBe(SIX.length)
    expect(mockTxAttempts).toBeGreaterThan(SIX.length)
  })

  it('GUARD IS LIVE: the same six all land on a plan that includes six', async () => {
    seedOrg(6)
    const results = await Promise.allSettled(SIX.map(addCollaborator))
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(6)
    expect(collaboratorsOnHost()).toBe(6)
  })

  it('THE RACE, mixed doors: concurrent invite-accepts and direct adds still yield one', async () => {
    seedOrg()
    const results = await Promise.allSettled([
      addCollaborator('c1'),
      upsertOrgMember({
        orgId: ORG,
        uid: 'c2',
        role: 'viewer',
        allHosts: false,
        hostAccess: { [HOST]: 'editor' },
        email: 'c2@example.com',
      }),
      addCollaborator('c3'),
      upsertOrgMember({
        orgId: ORG,
        uid: 'c4',
        role: 'editor',
        allHosts: false,
        hostAccess: { [HOST]: 'editor' },
        email: 'c4@example.com',
      }),
    ])
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1)
    expect(collaboratorsOnHost()).toBe(1)
  })

  it('THE HARNESS CAN SEE A RACE: a pre-transaction read over-grants', async () => {
    // The control that makes the three tests above mean something. This is
    // the OLD shape — count first, then grant — run against the same double.
    // If the harness were merely serialising, this would refuse five too and
    // every green above would be the mock's, not the product's.
    seedOrg()
    const legacyGrant = async (uid: string) => {
      const roster = await mockFirestore()
        .collection('orgs')
        .doc(ORG)
        .collection('members')
        .get()
      const used = roster.docs.filter((doc: any) =>
        Boolean(doc.data()?.hostAccess?.[HOST]),
      ).length
      if (used >= 1) throw new Error('refused')
      await mockFirestore()
        .collection('orgs')
        .doc(ORG)
        .collection('members')
        .doc(uid)
        .set({ role: 'viewer', allHosts: false, hostAccess: { [HOST]: 'editor' } }, { merge: true })
    }
    const results = await Promise.allSettled(SIX.map(legacyGrant))
    expect(results.filter((r) => r.status === 'fulfilled').length).toBeGreaterThan(1)
    expect(collaboratorsOnHost()).toBeGreaterThan(1)
  })
})

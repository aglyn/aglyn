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
 * `managersPerOrg` must be a HARD CAP on every door that admits a manager,
 * and under concurrency (AGL-2068, on the manager key).
 *
 * ## What was broken
 *
 * Four doors admit a manager, and all four read the roster, decided, and then
 * wrote — with nothing between the read and the write:
 *
 * | door | transaction | counted pending invites |
 * | -- | -- | -- |
 * | `/api/orgs/invites` create | no | yes |
 * | `/api/orgs/invites` accept | no | NO |
 * | `/api/orgs/members` upsert | no | NO |
 * | `/api/auth/sso-jit` | no | NO |
 *
 * So N concurrent accepts all measured the same roster, all passed, and all
 * landed. And three of the four enforced against a strictly smaller
 * population than the door that ISSUES the invitations, which means the cap
 * could also be walked past sequentially: mail out N invitations, which the
 * create door charges for, then have them all accepted by doors that cannot
 * see them.
 *
 * ## Why the assertions are shaped this way
 *
 * Three of the four doors funnel through `upsertOrgMember`, so this drives it
 * directly rather than three routes' worth of auth mocking — it is where the
 * cap now lives, inside the grant transaction. The fourth writes an invite
 * document and is covered by `managerSeatRefusal`, the pre-flight.
 *
 * A test that calls once and expects a throw proves only that a constant
 * exists. These FORCE the branch: they drive the over-limit path, assert the
 * refusal, then re-run the identical sequence against a plan with room and
 * assert everything lands — so a gate that simply refused everything could
 * not pass either half.
 *
 * The concurrency harness models Firestore's optimistic concurrency for real
 * (read-set fingerprints + conflict + retry), not FIFO serialisation, and
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

const { ManagerSeatLimitError, upsertOrgMember } =
  require('./organizations') as typeof import('./organizations')

const ORG = 'org-1'

/**
 * Free carries `managersPerOrg: 1`. `entitlements` overrides raise it.
 *
 * BOTH keys. `checkSeatQuota` clamps to `maxManagersPerOrg`, which free also
 * pins at 1 — raising only the included figure leaves the effective limit at
 * 1 and every "guard is live" fixture would silently assert the same thing as
 * the refusal ones.
 */
function seedOrg(managersPerOrg?: number): void {
  store.set(`orgs/${ORG}`, {
    plan: 'free',
    name: 'Org',
    slug: 'org',
    ...(managersPerOrg === undefined
      ? {}
      : {
          entitlements: {
            managersPerOrg,
            maxManagersPerOrg: managersPerOrg,
          },
        }),
  })
}

/** Rows on the roster that consume a MANAGER seat, counted from the store. */
const managersInOrg = () =>
  [...store.entries()].filter(
    ([path, data]) =>
      path.startsWith(`orgs/${ORG}/members/`) && data['allHosts'] === true,
  ).length

/** A pending invitation, as the invite-create door writes one. */
const seedPendingInvite = (email: string, allHosts = true) =>
  store.set(`orgs/${ORG}/invites/inv-${email}`, {
    email,
    role: 'editor',
    allHosts,
    hostAccess: {},
    acceptedAt: null,
  })

/**
 * The three transactional doors, which differ only in who is calling: invite
 * ACCEPT passes the accepter's own address, `/api/orgs/members` an admin's
 * chosen target, SSO-JIT the asserted identity. All three land here.
 */
const addManager = (uid: string, email = `${uid}@example.com`) =>
  upsertOrgMember({
    orgId: ORG,
    uid,
    role: 'editor',
    allHosts: true,
    hostAccess: {},
    email,
  })

beforeEach(() => {
  store = new Map()
  mockTxAttempts = 0
  mockTxInFlight = 0
  mockTxMaxInFlight = 0
})

describe('the premise: free really is one manager seat', () => {
  it('is 1/1, so the refusal fixtures below are not asserting nothing', () => {
    seedOrg()
    expect(managersInOrg()).toBe(0)
  })
})

describe('managersPerOrg is a hard cap on every door (AGL-2068)', () => {
  it('CONTROL: a single add under the cap lands', async () => {
    seedOrg()
    await addManager('u1')
    expect(managersInOrg()).toBe(1)
  })

  it('refuses the SECOND, sequentially', async () => {
    seedOrg()
    await addManager('u1')
    await expect(addManager('u2')).rejects.toBeInstanceOf(ManagerSeatLimitError)
    expect(managersInOrg()).toBe(1)
  })

  it('GUARD IS LIVE: the same second manager lands on a plan with room', async () => {
    seedOrg(2)
    await addManager('u1')
    await addManager('u2')
    expect(managersInOrg()).toBe(2)
  })

  it('an org with no plan is capped as free, not left unmetered', async () => {
    store.set(`orgs/${ORG}`, { name: 'Org', slug: 'org' })
    await addManager('u1')
    await expect(addManager('u2')).rejects.toBeInstanceOf(ManagerSeatLimitError)
  })

  it('a site-scoped COLLABORATOR does not consume a manager seat', async () => {
    // The other side of the AGL-1113 split: charging them here would bill one
    // person twice and trip a cap they are not on.
    seedOrg()
    await upsertOrgMember({
      orgId: ORG,
      uid: 'collab',
      role: 'editor',
      allHosts: false,
      hostAccess: { 'host-1': 'editor' },
      email: 'collab@example.com',
    })
    await addManager('u1')
    expect(managersInOrg()).toBe(1)
  })
})

describe('pending invites hold a manager seat at EVERY door (AGL-2068)', () => {
  /**
   * The invite-create door counted these and the three that actually GRANT
   * access did not, so the cap was enforced against a different population
   * depending on which door was used. A cap that only bites on acceptance is
   * walked past by mailing the invitations first.
   */
  it('THE FAIL-OPEN: a pending invite reserves the seat against a direct add', async () => {
    seedOrg()
    seedPendingInvite('invited@example.com')
    await expect(addManager('u1')).rejects.toBeInstanceOf(ManagerSeatLimitError)
    expect(managersInOrg()).toBe(0)
  })

  it('GUARD IS LIVE: the same add lands once that invite is accepted away', async () => {
    seedOrg()
    seedPendingInvite('invited@example.com')
    store.set(`orgs/${ORG}/invites/inv-invited@example.com`, {
      email: 'invited@example.com',
      role: 'editor',
      allHosts: true,
      hostAccess: {},
      acceptedAt: '__now__',
    })
    await addManager('u1')
    expect(managersInOrg()).toBe(1)
  })

  it('a SITE-SCOPED pending invite is not a manager seat', async () => {
    seedOrg()
    seedPendingInvite('scoped@example.com', false)
    await addManager('u1')
    expect(managersInOrg()).toBe(1)
  })

  it('an accepter is not charged for the invite they are consuming', async () => {
    // At the instant acceptance is decided the invitee holds a pending invite
    // AND is about to hold a membership. Counted plainly they are refused
    // their own invitation on an org sitting exactly on its cap.
    seedOrg()
    seedPendingInvite('joiner@example.com')
    await addManager('joiner', 'joiner@example.com')
    expect(managersInOrg()).toBe(1)
  })
})

describe('the cap holds under concurrency (AGL-2068)', () => {
  const SIX = ['c1', 'c2', 'c3', 'c4', 'c5', 'c6']

  it('THE RACE: six simultaneous accepts yield exactly one manager', async () => {
    seedOrg()
    const results = await Promise.allSettled(SIX.map((uid) => addManager(uid)))
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1)
    expect(managersInOrg()).toBe(1)
    // The race was REAL — the six overlapped rather than queueing, so the
    // single winner is the cap holding and not the harness serialising.
    expect(mockTxMaxInFlight).toBeGreaterThan(1)
  })

  it('GUARD IS LIVE: the same six all land on a plan that includes six', async () => {
    seedOrg(6)
    const results = await Promise.allSettled(SIX.map((uid) => addManager(uid)))
    expect(results.filter((r) => r.status === 'rejected')).toHaveLength(0)
    expect(managersInOrg()).toBe(6)
  })

  it('THE RACE, against a seat a pending invite already holds', async () => {
    seedOrg(2)
    seedPendingInvite('invited@example.com')
    const results = await Promise.allSettled(SIX.map((uid) => addManager(uid)))
    // Two seats, one already spoken for by the invitation.
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1)
    expect(managersInOrg()).toBe(1)
  })

  it('THE HARNESS CAN SEE A RACE: a pre-transaction read over-grants', async () => {
    // The negative control. This reproduces the OLD shape — measure the
    // roster, then write through a separate call — and asserts it lets more
    // than one through. Without it, a green race above would prove the mock
    // serialised rather than that the product is safe.
    seedOrg()
    const raced = SIX.map(async (uid) => {
      const members = mockRunQuery({
        __prefix: `orgs/${ORG}/members`,
        __filters: [],
      })
      await mockTick()
      if (members.size >= 1) throw new Error('refused')
      store.set(`orgs/${ORG}/members/${uid}`, {
        role: 'editor',
        allHosts: true,
        hostAccess: {},
      })
    })
    await Promise.allSettled(raced)
    expect(managersInOrg()).toBeGreaterThan(1)
  })
})

describe('THE GRANDFATHER: an over-cap org keeps every manager it has', () => {
  /**
   * The cap binds ADMISSION, never ACCESS. An org that drops to a smaller
   * plan, or one whose managers predate the cap, keeps them — this is about
   * refusing the NEXT one, not ejecting anyone.
   */
  const seedOverCap = () => {
    seedOrg(3)
    for (const uid of ['a', 'b', 'c']) {
      store.set(`orgs/${ORG}/members/${uid}`, {
        role: 'editor',
        allHosts: true,
        hostAccess: {},
        email: `${uid}@example.com`,
      })
    }
    // The plan shrinks under them.
    store.set(`orgs/${ORG}`, {
      plan: 'free',
      name: 'Org',
      slug: 'org',
      entitlements: { managersPerOrg: 1, maxManagersPerOrg: 1 },
    })
  }

  it('nobody is removed, and the refusal says how many are retained', async () => {
    seedOverCap()
    const error = await addManager('d').catch((e) => e)
    expect(error).toBeInstanceOf(ManagerSeatLimitError)
    expect(error.retainedOverCap).toBe(2)
    expect(managersInOrg()).toBe(3)
  })

  it('an EXISTING manager can still be rewritten while over cap', async () => {
    // Re-saving a seat somebody already holds is not an admission. Charging
    // it would strand an over-cap org unable to even demote its way back.
    seedOverCap()
    await upsertOrgMember({
      orgId: ORG,
      uid: 'a',
      role: 'admin',
      allHosts: true,
      hostAccess: {},
      email: 'a@example.com',
      title: 'Head of Ops',
    })
    expect(store.get(`orgs/${ORG}/members/a`)?.['title']).toBe('Head of Ops')
    expect(managersInOrg()).toBe(3)
  })

  it('GUARD IS LIVE: raising the plan admits the next one', async () => {
    seedOverCap()
    store.set(`orgs/${ORG}`, {
      plan: 'free',
      name: 'Org',
      slug: 'org',
      entitlements: { managersPerOrg: 4, maxManagersPerOrg: 4 },
    })
    await addManager('d')
    expect(managersInOrg()).toBe(4)
  })
})

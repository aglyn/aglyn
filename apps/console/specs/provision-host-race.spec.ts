/**
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
 * Two concurrent site provisions must not both land on one subdomain
 * (AGL-2465, the AGL-1848 shape).
 *
 * `POST /v1/sites` shipped with an idempotency key, which closes the RETRY
 * shape: the same attempt replayed under the same key returns the original
 * site. What a key cannot close is two DIFFERENT attempts racing — different
 * keys, or the console path, which has no key at all. Both callers check
 * uniqueness with `findSubdomainConflict`, a plain query OUTSIDE any
 * transaction, and then `claimHostForOrg` wrote the `subdomain` field
 * unconditionally inside its transaction. Two callers therefore both passed
 * the availability read and both created a host on ONE subdomain.
 *
 * That is not a cosmetic duplicate. `*.aglyn.app` is one global namespace and
 * every resolution path is `where('subdomain','==',…).limit(1)`
 * (`apps/tenant/utils/get-host.ts`, `use-host-resolution.ts`): with two
 * matching host documents, WHICH site answers the address is undefined. The
 * rename route's own docblock already names this outcome "a live-site
 * takeover".
 *
 * ## Why these assertions read the STORED DOCUMENTS
 *
 * A duplicate-provisioning bug returns success twice, so an HTTP status or a
 * returned `hostId` proves nothing. Every verdict below counts the host
 * documents that carry the subdomain.
 *
 * ## Why the fake serializes transactions
 *
 * Firestore transactions are serializable: a transaction whose reads are
 * invalidated by a concurrent commit is retried against fresh data. Modelling
 * that as "one transaction body at a time, reading committed state, buffering
 * its own writes until commit" is the honest reduction — it is exactly the
 * isolation the real service provides, and it is what makes an in-transaction
 * re-read able to see the winner. A fake that ran both bodies against a shared
 * snapshot would manufacture a failure the real database does not have; a fake
 * that applied writes as they were issued would let a transaction read its own
 * uncommitted work, which the real one never does.
 *
 * The uniqueness read HAS to be the transaction's, not the pre-check's. The
 * pre-check stays because it is what produces the friendly `suggestions`
 * payload, and because removing it would reorder the console route's refusals
 * (see `provision-host.ts` — lockdown and the rate limiter sit between the
 * pre-check and the claim, and that order decides which refusals burn a
 * limiter token).
 */

import { claimHostForOrg, findSubdomainConflict } from '../utils/server/provision-host'

const mockDocs = new Map<string, Record<string, unknown>>()
let mockRegisterCalls: Array<[string, string, string]> = []

interface Doc {
  path: string
  data: Record<string, unknown>
}

const docsUnder = (collection: string): Doc[] =>
  [...mockDocs.entries()]
    .filter(
      ([path]) => path.startsWith(`${collection}/`) && path.split('/').length === 2,
    )
    .map(([path, data]) => ({ path, data }))

function snapshotFor(
  path: string,
  source: Map<string, Record<string, unknown>> = mockDocs,
) {
  return {
    id: path.slice(path.lastIndexOf('/') + 1),
    path,
    exists: source.has(path),
    data: () => source.get(path),
    get: (field: string) => source.get(path)?.[field],
  }
}

/**
 * A query object. `__collection` and `__filters` are exposed so the
 * transaction's `get` can tell a query from a document reference — the real
 * `Transaction.get` is overloaded on exactly that distinction.
 */
function query(collection: string, filters: Array<[string, unknown]>): any {
  const matches = (source: Map<string, Record<string, unknown>>): Doc[] =>
    [...source.entries()]
      .filter(
        ([path]) =>
          path.startsWith(`${collection}/`) && path.split('/').length === 2,
      )
      .map(([path, data]) => ({ path, data }))
      .filter((doc) => filters.every(([field, value]) => doc.data[field] === value))
  return {
    __query: true,
    __run: (source: Map<string, Record<string, unknown>>) => {
      const found = matches(source)
      return {
        empty: found.length === 0,
        docs: found.map((doc) => snapshotFor(doc.path, source)),
      }
    },
    where: (field: string, _op: string, value: unknown) =>
      query(collection, [...filters, [field, value]]),
    limit: () => query(collection, filters),
    count: () => ({
      get: async () => ({ data: () => ({ count: matches(mockDocs).length }) }),
    }),
    get: async () => query(collection, filters).__run(mockDocs),
  }
}

function mockDocRef(path: string): any {
  return {
    path,
    id: path.slice(path.lastIndexOf('/') + 1),
    get: async () => snapshotFor(path),
    set: async (data: Record<string, unknown>, options?: { merge?: boolean }) => {
      mockDocs.set(path, {
        ...(options?.merge ? (mockDocs.get(path) ?? {}) : {}),
        ...data,
      })
    },
    delete: async () => {
      mockDocs.delete(path)
    },
  }
}

function mockCollectionRef(path: string): any {
  return {
    path,
    doc: (id: string) => mockDocRef(`${path}/${id}`),
    where: (field: string, _op: string, value: unknown) =>
      query(path, [[field, value]]),
    count: () => query(path, []).count(),
  }
}

/**
 * Serializes transaction bodies and buffers their writes, so a transaction
 * reads COMMITTED state and its own writes become visible only at commit.
 */
let txQueue: Promise<unknown> = Promise.resolve()
/** Counts transaction bodies that actually ran — a mutation that skips the
 *  transaction entirely would otherwise look identical to one that runs it. */
let txRuns = 0

const mockFirestore: any = {
  collection: (name: string) => mockCollectionRef(name),
  runTransaction: async <T,>(work: (tx: any) => Promise<T>): Promise<T> => {
    const run = txQueue.then(async () => {
      txRuns += 1
      const buffered: Array<[string, Record<string, unknown>, boolean]> = []
      const tx = {
        get: async (target: any) => {
          if (target?.__query) return target.__run(mockDocs)
          return snapshotFor(target.path)
        },
        set: (
          ref: { path: string },
          data: Record<string, unknown>,
          options?: { merge?: boolean },
        ) => {
          buffered.push([ref.path, data, options?.merge === true])
        },
      }
      const result = await work(tx)
      for (const [path, data, merge] of buffered) {
        const prior = merge ? (mockDocs.get(path) ?? {}) : {}
        const merged: Record<string, unknown> = { ...prior, ...data }
        if (merge && prior['hosts'] && data['hosts']) {
          merged['hosts'] = {
            ...(prior['hosts'] as object),
            ...(data['hosts'] as object),
          }
        }
        mockDocs.set(path, merged)
      }
      return result
    })
    txQueue = run.catch(() => undefined)
    return (await run) as T
  },
}

jest.mock('@aglyn/tenant-data-admin', () => ({
  __esModule: true,
  registerOrgHost: async (orgId: string, hostId: string, subdomain: string) => {
    mockRegisterCalls.push([orgId, hostId, subdomain])
    const org = mockDocs.get(`orgs/${orgId}`) ?? {}
    mockDocs.set(`orgs/${orgId}`, {
      ...org,
      hosts: { ...((org['hosts'] as object) ?? {}), [hostId]: true },
    })
    mockDocs.set(`hostIndex/${hostId}`, { orgId, subdomain })
  },
  firebaseAdmin: {
    app: () => ({ firestore: () => mockFirestore }),
    firestore: {
      FieldValue: { serverTimestamp: () => 'NOW', increment: (n: number) => n },
    },
  },
}))

const ORG = 'org-1'
const SUB = 'client-site'

beforeEach(() => {
  mockDocs.clear()
  mockRegisterCalls = []
  txQueue = Promise.resolve()
  txRuns = 0
  // Business plan: hostLimit is high enough that the QUOTA is never what
  // refuses a second site here. If the quota were the thing saying no, these
  // tests would pass without any uniqueness guard at all.
  mockDocs.set(`orgs/${ORG}`, { plan: 'business', hosts: {} })
})

/** Host documents carrying a given subdomain — the verdict, in stored state. */
const hostsOn = (subdomain: string): Doc[] =>
  docsUnder('hosts').filter((doc) => doc.data['subdomain'] === subdomain)

/**
 * One caller's provisioning attempt, in the order BOTH real callers use:
 * out-of-transaction uniqueness pre-check, then the claim.
 */
async function provision(subdomain: string, displayName = 'Client Site') {
  const conflict = await findSubdomainConflict(mockFirestore, subdomain)
  if (conflict) return { refused: 'subdomain_taken' as const }
  const claim = await claimHostForOrg({
    firestore: mockFirestore,
    orgId: ORG,
    displayName,
    subdomain,
    org: mockDocs.get(`orgs/${ORG}`),
  })
  if (claim.allowed) return { hostId: claim.hostId }
  return { refused: claim.conflict ? ('subdomain_taken' as const) : ('quota' as const) }
}

describe('one caller, the ordinary path (AGL-2465)', () => {
  it('creates exactly one site, and it carries the subdomain', async () => {
    const result = await provision(SUB)
    expect(result.hostId).toBeTruthy()
    expect(hostsOn(SUB)).toHaveLength(1)
    expect(hostsOn(SUB)[0].path).toBe(`hosts/${result.hostId}`)
  })

  it('a SEQUENTIAL second attempt is refused by the pre-check, and creates nothing', async () => {
    await provision(SUB)
    const second = await provision(SUB)
    expect(second.refused).toBe('subdomain_taken')
    expect(hostsOn(SUB)).toHaveLength(1)
  })
})

describe('THE RACE: two attempts that both pass the availability read (AGL-2465)', () => {
  /**
   * The exact AGL-1848 window, staged deterministically: both callers run the
   * out-of-transaction pre-check while the subdomain is genuinely free, and
   * only then does either transaction open. Nothing here is contrived — it is
   * the interleaving the pre-check cannot exclude, because it is not part of
   * the transaction that writes.
   */
  it('both pass the pre-check, and still only ONE host document is created', async () => {
    const firstFree = await findSubdomainConflict(mockFirestore, SUB)
    const secondFree = await findSubdomainConflict(mockFirestore, SUB)
    // The premise of the race: at pre-check time the name really was free for
    // both. If this ever fails, the test below is proving something else.
    expect(firstFree).toBeNull()
    expect(secondFree).toBeNull()

    const first = await claimHostForOrg({
      firestore: mockFirestore,
      orgId: ORG,
      displayName: 'First',
      subdomain: SUB,
      org: mockDocs.get(`orgs/${ORG}`),
    })
    const second = await claimHostForOrg({
      firestore: mockFirestore,
      orgId: ORG,
      displayName: 'Second',
      subdomain: SUB,
      org: mockDocs.get(`orgs/${ORG}`),
    })

    expect(hostsOn(SUB)).toHaveLength(1)
    expect(first.allowed).toBe(true)
    expect(second.allowed).toBe(false)
    // Refused for the RIGHT reason. Without this the test would pass if the
    // quota happened to refuse the second one, which is a different guard and
    // would not hold on a plan with room to spare.
    expect(second.conflict).toBe(true)
    expect(second.limit).toBeUndefined()
  })

  it('the loser creates NO host document at all — not an orphan without a subdomain', async () => {
    await provision(SUB)
    mockRegisterCalls = []
    const before = docsUnder('hosts').length
    const loser = await claimHostForOrg({
      firestore: mockFirestore,
      orgId: ORG,
      displayName: 'Second',
      subdomain: SUB,
      org: mockDocs.get(`orgs/${ORG}`),
    })
    expect(loser.allowed).toBe(false)
    // The whole `hosts` collection, not just the ones on this subdomain: a
    // transaction that wrote the document and only omitted the subdomain would
    // still have consumed a hostLimit slot and left a site nobody can reach.
    expect(docsUnder('hosts')).toHaveLength(before)
    // And no projection fan-out: `registerOrgHost` writes hostIndex and runs
    // syncOrgAuthProjections across every member.
    expect(mockRegisterCalls).toEqual([])
  })

  it('the loser does not consume a hostLimit slot in the org directory', async () => {
    const winner = await provision(SUB)
    await claimHostForOrg({
      firestore: mockFirestore,
      orgId: ORG,
      displayName: 'Second',
      subdomain: SUB,
      org: mockDocs.get(`orgs/${ORG}`),
    })
    const directory = mockDocs.get(`orgs/${ORG}`)?.['hosts'] as Record<string, unknown>
    expect(Object.keys(directory)).toEqual([winner.hostId])
  })

  it('CONCURRENTLY, through the same order both real callers use', async () => {
    const [a, b] = await Promise.all([provision(SUB, 'A'), provision(SUB, 'B')])
    expect(hostsOn(SUB)).toHaveLength(1)
    const outcomes = [a, b].map((r) => (r.hostId ? 'created' : r.refused)).sort()
    expect(outcomes).toEqual(['created', 'subdomain_taken'])
  })

  it('THREE concurrent attempts still yield exactly one', async () => {
    const results = await Promise.all([
      provision(SUB, 'A'),
      provision(SUB, 'B'),
      provision(SUB, 'C'),
    ])
    expect(hostsOn(SUB)).toHaveLength(1)
    expect(results.filter((r) => r.hostId)).toHaveLength(1)
  })

  it('NEGATIVE CONTROL: concurrent attempts on DIFFERENT subdomains both succeed', async () => {
    const [a, b] = await Promise.all([provision('site-one'), provision('site-two')])
    expect(a.hostId).toBeTruthy()
    expect(b.hostId).toBeTruthy()
    expect(a.hostId).not.toBe(b.hostId)
    expect(hostsOn('site-one')).toHaveLength(1)
    expect(hostsOn('site-two')).toHaveLength(1)
    // The guard must refuse a COLLISION, not concurrency itself. A transaction
    // that simply serialized everything into one winner would pass every test
    // above and fail this one.
    expect(docsUnder('hosts')).toHaveLength(2)
  })
})

describe('the guard is the TRANSACTION\'s read, not the pre-check (AGL-2465)', () => {
  it('refuses even when the pre-check is never called at all', async () => {
    await provision(SUB)
    // No `findSubdomainConflict` anywhere in this attempt. An API client that
    // reaches `claimHostForOrg` by any route — including a future caller that
    // forgets the pre-check — is still refused.
    const direct = await claimHostForOrg({
      firestore: mockFirestore,
      orgId: ORG,
      displayName: 'Direct',
      subdomain: SUB,
      org: mockDocs.get(`orgs/${ORG}`),
    })
    expect(direct.allowed).toBe(false)
    expect(direct.conflict).toBe(true)
    expect(hostsOn(SUB)).toHaveLength(1)
  })

  it('the transaction really runs — one body per attempt', async () => {
    txRuns = 0
    await provision('a-site')
    await claimHostForOrg({
      firestore: mockFirestore,
      orgId: ORG,
      displayName: 'B',
      subdomain: 'a-site',
      org: mockDocs.get(`orgs/${ORG}`),
    })
    expect(txRuns).toBe(2)
  })

  it('the quota refusal is still distinguishable from a collision', async () => {
    // hostLimit 1 on free: the SECOND site, on a free subdomain, is refused by
    // the quota — and must not claim to be a subdomain collision.
    mockDocs.set(`orgs/${ORG}`, { plan: 'free', hosts: {} })
    await provision(SUB)
    const quota = await claimHostForOrg({
      firestore: mockFirestore,
      orgId: ORG,
      displayName: 'Second',
      subdomain: 'a-totally-different-name',
      org: mockDocs.get(`orgs/${ORG}`),
    })
    expect(quota.allowed).toBe(false)
    expect(quota.conflict).toBeFalsy()
    expect(quota.limit).toBe(1)
  })
})

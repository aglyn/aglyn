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
 * `/api/hosts/import` holds `screensPerHost` under CONCURRENCY (AGL-2370), and
 * bounds `kind: 'error'` however the screen arrived (AGL-2093).
 *
 * The third and fourth doors in the arc AGL-2231 and AGL-2369 closed at the
 * two single-screen ends. This route had the same count-then-await-then-write
 * shape: `screenCapRefusal` counted with a plain `.get()`, `resourceCapRefusal`
 * then did more un-transacted reads, and only after all of it did a
 * `batch.commit()` land. Two imports of `k` screens each into a host holding
 * `prior` both computed `next = prior + k <= limit`, both passed, and both
 * landed at `prior + 2k`.
 *
 * ## The issue said this one could not be a transaction. It can
 *
 * AGL-2370 filed it as needing a per-host LEASE with a TTL and an orphan story,
 * on the route's own note that "the route commits in chunks of 400, so it is
 * NOT atomic once it starts". That note is true of the WHOLE bundle and says
 * nothing about the cap, because `screensPerHost` is a statement about ONE
 * collection. The leg that writes that collection is bounded by the bundle
 * format — `EXPORT_COLLECTION_LIMITS.screens` screens, at most one version
 * each, plus the host patch — which is 401 writes against Firestore's ceiling
 * of 500. `writes the screens leg fits inside one transaction` below asserts
 * that arithmetic from the real constants, so raising the export limit fails
 * this suite rather than failing a customer's commit.
 *
 * ## What the double models, and why a global lock would have been cheating
 *
 * `screen-kind-cap-is-atomic.spec.ts` serializes transactions with one global
 * lock, which is sound there because that route's own cap read is the thing
 * being serialized. It is NOT sufficient here, and the difference is the trap
 * that produces a false green in exactly this shape of test:
 *
 *   **the screens a concurrent import creates are documents this transaction
 *   never read.** Under a per-document version double they cannot conflict
 *   with anything — every id the loser read is untouched — so the loser
 *   commits on a stale count and the suite reports a race it did not run.
 *
 * So the fake below tracks **query ranges**: `tx.get(query)` records the
 * collection the query scanned, and a commit aborts when anything in a scanned
 * collection changed since the read. That is what Firestore's pessimistic
 * query lock actually gives you, and it is the only model under which the
 * defect is visible. `RANGE_TRACKING` can be switched off per test, and
 * `the naive per-document double reports a false green` uses it as the negative
 * control: with only document versions the broken behaviour passes.
 *
 * ## Both halves, always
 *
 * A cap suite asserting only "the second one is refused" also passes against a
 * route that refuses everything, which is the likeliest way a cap fix goes
 * wrong. Every case here pins the pair: the permitted import LANDS every
 * document, the one past the cap writes NOTHING, and the concurrent pair
 * asserts the exact survivor count rather than "not both".
 */

const mockVerifyIdToken = jest.fn()
const mockServerTimestamp = Symbol('serverTimestamp')

type Doc = Record<string, unknown>

/** The owning org, swapped per test — the plan IS the variable. */
let mockOrg: Doc

/**
 * Whether the transaction double tracks the QUERY RANGES a body read, or only
 * the documents it touched by id.
 *
 * `true` is Firestore. `false` is the negative control — see the suite doc and
 * `the naive per-document double reports a false green`.
 */
let RANGE_TRACKING = true

/** An in-memory Firestore keyed by collection PATH. */
const store = new Map<string, Map<string, Doc>>()

/**
 * A monotonic version per collection PATH, bumped by every write into it.
 *
 * This is the whole mechanism: a transaction that scanned `hosts/h/screens`
 * records the version it saw, and any commit into that path afterwards makes
 * the record stale. A NEW document — the case a per-document model is blind to
 * — bumps it exactly like an overwrite does.
 */
const collectionVersion = new Map<string, number>()
const bump = (path: string) =>
  collectionVersion.set(path, (collectionVersion.get(path) ?? 0) + 1)
const versionOf = (path: string) => collectionVersion.get(path) ?? 0

/** Transaction attempts across the suite, including retries. */
let attempts = 0

const seed = (collectionPath: string, id: string, data: Doc) => {
  if (!store.has(collectionPath)) store.set(collectionPath, new Map())
  store.get(collectionPath).set(id, data)
}

const commitWrite = (path: string, data: Doc, merge: boolean) => {
  const lastSlash = path.lastIndexOf('/')
  const collectionPath = path.slice(0, lastSlash)
  const id = path.slice(lastSlash + 1)
  if (!store.has(collectionPath)) store.set(collectionPath, new Map())
  const existing = store.get(collectionPath).get(id)
  // `merge: false` REPLACES and `merge: true` merges — modelled, because the
  // route relies on both and a double that treated them alike would let a
  // clobbering import pass.
  store
    .get(collectionPath)
    .set(id, merge ? { ...(existing ?? {}), ...data } : { ...data })
  bump(collectionPath)
}

const snapshotOf = (path: string, id: string, data: Doc | undefined) => ({
  id,
  exists: data !== undefined,
  ref: docRef(path, id),
  data: () => data,
  get: (field: string) => (data ?? {})[field],
})

function collectionRef(path: string): any {
  const ref: any = {
    path,
    /** Marks this reference as a QUERY the transaction scanned. */
    __queryPath: path,
    limit: () => ref,
    where: () => ref,
    select: () => ref,
    // The flat platform caps ask `count()` first and only pay for the id scan
    // when the answer says a refusal is possible (AGL-2266). A double without
    // it makes the route throw, and every assertion here would read the crash
    // as the cap misfiring.
    count: () => ({
      get: async () => ({
        data: () => ({ count: (store.get(path) ?? new Map()).size }),
      }),
    }),
    get: async () => ({
      docs: [...(store.get(path) ?? new Map()).entries()].map(([id, data]) =>
        snapshotOf(path, id, data),
      ),
    }),
    doc: (id: string) => docRef(path, id),
    add: async () => undefined,
  }
  return ref
}

function docRef(collectionPath: string, id: string): any {
  return {
    id,
    path: `${collectionPath}/${id}`,
    __collectionPath: collectionPath,
    get: async () =>
      snapshotOf(
        collectionPath,
        id,
        (store.get(collectionPath) ?? new Map()).get(id),
      ),
    collection: (name: string) =>
      collectionRef(`${collectionPath}/${id}/${name}`),
  }
}

/**
 * A transaction that RETRIES on a conflict with what it read.
 *
 * Optimistic rather than a global lock, on purpose: a lock would serialize the
 * bodies and hide whether the route's count is inside one. Here two bodies
 * genuinely interleave — each `await tx.get` yields — and the loser is caught
 * at COMMIT by the versions it recorded, which is the property Firestore
 * actually provides and the property the fix leans on.
 */
const mockRunTransaction = async (body: (tx: any) => Promise<any>) => {
  for (let attempt = 0; attempt < 8; attempt += 1) {
    attempts += 1
    const readVersions = new Map<string, number>()
    const readDocs = new Map<string, unknown>()
    const buffered: Array<{ path: string; data: Doc; merge: boolean }> = []
    const result = await body({
      get: async (ref: any) => {
        if (buffered.length) {
          throw new Error('Firestore transactions cannot read after a write')
        }
        if (ref.__queryPath !== undefined) {
          // A QUERY: the lock covers everything it scanned, present or not.
          if (RANGE_TRACKING && !readVersions.has(ref.__queryPath)) {
            readVersions.set(ref.__queryPath, versionOf(ref.__queryPath))
          }
        } else {
          readDocs.set(
            ref.path,
            (store.get(ref.__collectionPath) ?? new Map()).get(ref.id),
          )
        }
        return ref.get()
      },
      set: (ref: any, data: Doc, options?: { merge?: boolean }) => {
        buffered.push({
          path: ref.path,
          data,
          merge: Boolean(options?.merge),
        })
      },
    })
    const rangeConflict = [...readVersions.entries()].some(
      ([path, seen]) => versionOf(path) !== seen,
    )
    const docConflict = [...readDocs.entries()].some(([path, seen]) => {
      const lastSlash = path.lastIndexOf('/')
      const current = (store.get(path.slice(0, lastSlash)) ?? new Map()).get(
        path.slice(lastSlash + 1),
      )
      return current !== seen
    })
    if (rangeConflict || docConflict) continue
    for (const write of buffered) {
      commitWrite(write.path, write.data, write.merge)
    }
    return result
  }
  throw new Error('Transaction failed after too many retries')
}

const mockFirestore = {
  collection: (name: string) => collectionRef(name),
  batch: () => {
    const queued: Array<{ path: string; data: Doc; merge: boolean }> = []
    return {
      set: (ref: any, data: Doc, options?: { merge?: boolean }) => {
        queued.push({ path: ref.path, data, merge: Boolean(options?.merge) })
      },
      commit: async () => {
        for (const write of queued) {
          commitWrite(write.path, write.data, write.merge)
        }
      },
    }
  },
  runTransaction: (body: (tx: any) => Promise<any>) => mockRunTransaction(body),
}

jest.mock('@aglyn/tenant-data-admin', () => ({
  __esModule: true,
  firebaseAdmin: {
    app: () => ({
      auth: () => ({
        verifyIdToken: (...args: unknown[]) => mockVerifyIdToken(...args),
      }),
      firestore: () => mockFirestore,
    }),
    firestore: { FieldValue: { serverTimestamp: () => mockServerTimestamp } },
  },
  getOrgForHost: async () => ({ orgId: 'org-1', org: mockOrg }),
  isImpersonationSession: () => false,
  lockdownRefusal: async () => null,
  emailUnverifiedResponse: () =>
    Response.json({ error: 'Verify your email' }, { status: 403 }),
}))

jest.mock('@aglyn/aglyn/server', () => ({
  __esModule: true,
  // The REAL plan table, the REAL page-claim rule, the REAL slot list and the
  // REAL error-screen bound. Stubbing any of them would let this suite pass
  // against a route enforcing nothing, which IS the bug.
  ...jest.requireActual('../../../libs/aglyn/src/lib/app-utils/plan-entitlements'),
  ...jest.requireActual('../../../libs/aglyn/src/lib/app-utils/screen-route'),
  ...jest.requireActual('../../../libs/aglyn/src/lib/app-utils/collection-kind'),
  ...jest.requireActual('../../../libs/aglyn/src/lib/app-utils/dataset-models'),
  ...jest.requireActual('../../../libs/aglyn/src/lib/app-utils/scope-tokens'),
  ...jest.requireActual('../../../libs/aglyn/src/lib/app-utils/name-search'),
  ...jest.requireActual('../../../libs/aglyn/src/lib/app-utils/binding-tokens'),
  ...jest.requireActual('../../../libs/aglyn/src/lib/app-utils/stored-nodes'),
  // The REAL flat platform caps (AGL-2266) — the import route reads both.
  ...jest.requireActual('../../../libs/aglyn/src/lib/app-utils/actions'),
  ...jest.requireActual(
    '../../../libs/aglyn/src/lib/app-utils/collection-entries',
  ),
  ...jest.requireActual(
    '../../../libs/aglyn/src/lib/foundation/definitions/platform.types',
  ),
  pluginRequestFromWeb: async (request: Request) => ({
    method: request.method,
    query: {},
    body: await request.json().catch(() => ({})),
    headers: {
      authorization: request.headers.get('authorization') ?? undefined,
    },
  }),
}))

import { POST as IMPORT_POST } from '../app/api/hosts/import/route'
import {
  EXPORT_COLLECTION_LIMITS,
  SITE_EXPORT_FORMAT,
  SITE_EXPORT_VERSION,
} from '../app/api/_lib/site-export'
import {
  ERROR_SCREEN_MAX_PER_HOST,
  PLAN_ENTITLEMENTS,
  SCREEN_KIND_ERROR,
} from '@aglyn/aglyn/server'

/**
 * Firestore's hard ceiling on writes in one transaction. A literal, because
 * the number is the SDK's and not ours — if it ever moves, this suite should
 * be the thing that has to be re-reasoned rather than a constant that quietly
 * agrees with itself.
 */
const FIRESTORE_TRANSACTION_WRITE_LIMIT = 500

const PRO_SCREEN_CAP = PLAN_ENTITLEMENTS.pro.screensPerHost

const ids = (count: number, prefix: string) =>
  Array.from({ length: count }, (_unused, index) => `${prefix}-${index + 1}`)

const screenItem = (id: string, extra: Doc = {}) => ({
  $id: id,
  displayName: `Page ${id}`,
  kind: 'page',
  slug: `/${id}`,
  ...extra,
})

const seedHost = (options: { screens?: string[] } = {}) => {
  store.clear()
  collectionVersion.clear()
  attempts = 0
  const existing = options.screens ?? []
  seed('hosts', 'host-1', {
    memberRoles: { 'user-1': 'admin' },
    orgId: 'org-1',
    displayName: 'Acme',
    screens: Object.fromEntries(existing.map((id) => [id, `/${id}`])),
  })
  for (const id of existing) {
    seed('hosts/host-1/screens', id, {
      displayName: `Page ${id}`,
      kind: 'page',
      slug: `/${id}`,
    })
  }
}

/**
 * `hostPatch: false` produces a bundle carrying NOTHING about the host.
 *
 * That is not a contrived shape — a bundle whose host settings match the
 * target's carries no exportable field the import would change — and it is the
 * shape that isolates what serializes this route. When a bundle DOES patch the
 * host, the transaction's read of `hosts/{hostId}` conflicts on its own and
 * the race is caught even by a per-document model. That is real protection and
 * it is also incidental: it disappears with the host patch, while
 * `screensPerHost` does not. So every test below that is about the LOCK uses a
 * bundle with no host patch, and the count is left to defend itself.
 */
const bundleOf = (
  items: Array<Doc & { $id: string }>,
  options: { routed?: boolean; hostPatch?: boolean } = {},
) => ({
  format: SITE_EXPORT_FORMAT,
  version: SITE_EXPORT_VERSION,
  host:
    options.hostPatch === false
      ? {}
      : {
          displayName: 'Acme',
          screens:
            options.routed === false
              ? {}
              : Object.fromEntries(
                  items.map((item) => [String(item.$id), `/${item.$id}`]),
                ),
        },
  screens: items,
  collections: [],
})

const runImport = async (bundle: unknown) => {
  const response = await IMPORT_POST(
    new Request('https://app.aglyn.com/api/hosts/import', {
      method: 'POST',
      headers: { authorization: 'Bearer tok' },
      body: JSON.stringify({ hostId: 'host-1', bundle }),
    }),
  )
  return { status: response.status, body: await response.json() }
}

/** Screen documents the store actually holds. */
const storedScreens = () => [...(store.get('hosts/host-1/screens') ?? []).keys()]

beforeEach(() => {
  jest.clearAllMocks()
  RANGE_TRACKING = true
  mockVerifyIdToken.mockResolvedValue({ uid: 'user-1', email_verified: true })
  mockOrg = { plan: 'pro' }
})

describe('the screens leg is atomic (AGL-2370)', () => {
  /**
   * The arithmetic AGL-2370's "cannot be a transaction" rests on, checked
   * against the real constants rather than asserted in prose.
   *
   * FORCED RED: raise `EXPORT_COLLECTION_LIMITS.screens` to 300 — 601 writes —
   * and this fails naming the number. That is the only way the transaction
   * shape can stop being viable, and it now fails the build instead of a
   * customer's restore.
   */
  it('writes the screens leg inside one transaction', () => {
    const screenWrites = EXPORT_COLLECTION_LIMITS.screens * 2 + 1
    expect(screenWrites).toBeLessThanOrEqual(FIRESTORE_TRANSACTION_WRITE_LIMIT)
  })

  /**
   * The whole defect, both halves.
   *
   * FORCED RED: hoist the count back out of the transaction — give
   * `screenCapRefusal` the plain `.get()` it had, and read it before
   * `runTransaction` — and both imports land 40 screens for 120 total, over a
   * cap of 100.
   */
  it('refuses the second of two concurrent imports that would overshoot', async () => {
    seedHost({ screens: ids(PRO_SCREEN_CAP - 40, 'held') })
    // NO host patch: the count has to defend itself. See `bundleOf`.
    const first = runImport(
      bundleOf(ids(40, 'first').map((id) => screenItem(id)), {
        hostPatch: false,
      }),
    )
    const second = runImport(
      bundleOf(ids(40, 'second').map((id) => screenItem(id)), {
        hostPatch: false,
      }),
    )
    const [a, b] = await Promise.all([first, second])

    const statuses = [a.status, b.status].sort()
    expect(statuses).toEqual([200, 403])
    // The EXACT survivor count, not "fewer than both": a route that refused
    // everything would pass a looser assertion.
    expect(storedScreens()).toHaveLength(PRO_SCREEN_CAP)
    // And the refusal is the screen cap's, not a generic failure.
    const refused = a.status === 403 ? a : b
    expect(String(refused.body.error)).toContain(`of ${PRO_SCREEN_CAP}`)
    // At least one retry happened — the loser re-read rather than being
    // refused on its first, already-correct count.
    expect(attempts).toBeGreaterThan(2)
  })

  /**
   * THE NEGATIVE CONTROL.
   *
   * With the double tracking only the documents each body touched by id — the
   * per-document model this repo has been bitten by before — the race is
   * INVISIBLE: neither import read the other's new screen ids, so nothing
   * conflicts, both commit, and the host lands 40 over its cap. The suite
   * above would be reporting a green it did not earn.
   *
   * Asserted rather than described, so a later edit that quietly drops range
   * tracking from the fake turns THIS test red instead of leaving the real one
   * silently toothless.
   */
  it('the naive per-document double reports a false green', async () => {
    RANGE_TRACKING = false
    seedHost({ screens: ids(PRO_SCREEN_CAP - 40, 'held') })
    const [a, b] = await Promise.all([
      runImport(
        bundleOf(ids(40, 'first').map((id) => screenItem(id)), {
          hostPatch: false,
        }),
      ),
      runImport(
        bundleOf(ids(40, 'second').map((id) => screenItem(id)), {
          hostPatch: false,
        }),
      ),
    ])
    expect([a.status, b.status]).toEqual([200, 200])
    expect(storedScreens()).toHaveLength(PRO_SCREEN_CAP + 40)
  })

  /** The permitted half: one import at the cap still lands everything. */
  it('lands the last import that fits', async () => {
    seedHost({ screens: ids(PRO_SCREEN_CAP - 40, 'held') })
    const result = await runImport(
      bundleOf(ids(40, 'fresh').map((id) => screenItem(id))),
    )
    expect(result.status).toBe(200)
    expect(storedScreens()).toHaveLength(PRO_SCREEN_CAP)
  })

  /**
   * A refused import writes no HOST PATCH either — and the case that proves it
   * has to be the racing one.
   *
   * The obvious version of this test seeds a host already at its cap and
   * asserts the host document is untouched. That test cannot fail: the
   * pre-check outside the transaction refuses such a bundle before the route
   * reaches any write at all, so batching the patch early would pass it just as
   * happily. Written and confirmed green against the mutation before being
   * replaced — a guard whose subject never reaches the code under test is the
   * shape this repo keeps finding.
   *
   * The LOSER of a race is the one import that passes the pre-check and is
   * refused by the transaction, which is the only path where the ordering of
   * the host patch is observable. Its routing entries must not be in the map:
   * a site advertising routes for screens it does not hold is the half-restored
   * state the refusal exists to prevent.
   *
   * FORCED RED: move the host patch back out of the transaction — batch and
   * commit it before the screens leg — and the loser's ten routes land on a
   * site that has none of their screens.
   */
  it('writes no host patch for the loser of a race', async () => {
    seedHost({ screens: ids(PRO_SCREEN_CAP - 40, 'held') })
    const [a, b] = await Promise.all([
      runImport(bundleOf(ids(40, 'first').map((id) => screenItem(id)))),
      runImport(bundleOf(ids(40, 'second').map((id) => screenItem(id)))),
    ])
    const statuses = [a.status, b.status].sort()
    expect(statuses).toEqual([200, 403])

    const routed = Object.keys(
      (store.get('hosts').get('host-1').screens ?? {}) as Record<string, string>,
    )
    const winner = a.status === 200 ? 'first' : 'second'
    const loser = winner === 'first' ? 'second' : 'first'
    expect(routed.filter((id) => id.startsWith(winner))).toHaveLength(40)
    expect(routed.filter((id) => id.startsWith(loser))).toHaveLength(0)
    expect(storedScreens()).toHaveLength(PRO_SCREEN_CAP)
  })

  /** An UNLIMITED plan lands all of them — the cap fix did not become a wall. */
  it('lets an unlimited plan land both concurrent imports', async () => {
    mockOrg = { plan: 'business' }
    seedHost({ screens: ids(10, 'held') })
    const [a, b] = await Promise.all([
      runImport(
        bundleOf(ids(40, 'first').map((id) => screenItem(id)), {
          hostPatch: false,
        }),
      ),
      runImport(
        bundleOf(ids(40, 'second').map((id) => screenItem(id)), {
          hostPatch: false,
        }),
      ),
    ])
    expect([a.status, b.status]).toEqual([200, 200])
    expect(storedScreens()).toHaveLength(90)
  })
})

describe("a bundle's kind: 'error' screens are bounded (AGL-2093)", () => {
  /**
   * The issue, exactly: a crafted bundle declaring `kind: 'error'` on every
   * screen used to be excluded from `screensPerHost` wholesale, without ever
   * passing the four-slot bound and without ever binding a slot.
   *
   * FORCED RED: drop the `exemptionSpent` clause from `billableScreenIds` and
   * all 60 land unbilled on a plan of 100 with 90 held.
   */
  it('refuses a bundle that mints unbilled error screens past the slot bound', async () => {
    seedHost({ screens: ids(PRO_SCREEN_CAP - 10, 'held') })
    const result = await runImport(
      bundleOf(
        ids(60, 'err').map((id) => screenItem(id, { kind: SCREEN_KIND_ERROR })),
        { routed: false },
      ),
    )
    expect(result.status).toBe(403)
    expect(String(result.body.error)).toContain(`of ${PRO_SCREEN_CAP}`)
    expect(storedScreens()).toHaveLength(PRO_SCREEN_CAP - 10)
  })

  /**
   * The other half, and the reason the bound is a number rather than a refusal
   * of the kind: a real site's four designed error screens restore.
   *
   * The host is seeded at the cap MINUS four so the exempt four cost nothing
   * and land, which is the property AGL-2092 promised and this issue is about
   * making true end to end.
   */
  it('restores the four error screens a real bundle carries', async () => {
    seedHost({ screens: ids(PRO_SCREEN_CAP - 4, 'held') })
    const result = await runImport(
      bundleOf(
        ids(ERROR_SCREEN_MAX_PER_HOST, 'err').map((id) =>
          screenItem(id, { kind: SCREEN_KIND_ERROR }),
        ),
        { routed: false },
      ),
    )
    expect(result.status).toBe(200)
    expect(storedScreens()).toHaveLength(PRO_SCREEN_CAP)
  })

  /**
   * The bound is on the COUNT and not on the bundle: a host already holding
   * its four error screens cannot be given a fifth by import either, because
   * the fifth is billable and the host is at its plan.
   */
  it('counts the fifth error screen against the plan', async () => {
    seedHost({ screens: ids(PRO_SCREEN_CAP, 'held') })
    for (const id of ids(ERROR_SCREEN_MAX_PER_HOST, 'held-err')) {
      seed('hosts/host-1/screens', id, { kind: SCREEN_KIND_ERROR })
    }
    const result = await runImport(
      bundleOf([screenItem('fifth-err', { kind: SCREEN_KIND_ERROR })], {
        routed: false,
      }),
    )
    expect(result.status).toBe(403)
    expect(storedScreens()).toHaveLength(
      PRO_SCREEN_CAP + ERROR_SCREEN_MAX_PER_HOST,
    )
  })
})

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
 * THE FREE-WORKSPACE CEILING (AGL-2265).
 *
 * Three groups of case, and the middle one is the whole issue:
 *
 * 1. The PURE decision, including the loading state. A limit that has not
 *    loaded must be answered against the compiled-in default — never as zero
 *    (which refuses every signup on the platform during a Firestore blip) and
 *    never as no-limit (which makes a blip the way through the control).
 * 2. The CREATE-TIME evaluation, driven through the real `createOrganization`
 *    against an in-memory Firestore. It runs the laundering sequence — hold
 *    three, hand one to an alt account, create a fourth — and it also runs the
 *    NEGATIVE control: with the creator attribution stripped, the same
 *    sequence succeeds. Without that second case this file would pass just as
 *    happily if the union that defeats laundering were quietly reduced to the
 *    ownership query.
 * 3. The STAFF CONTROL taking effect, in-process, with no restart of anything.
 *
 * The Firestore double models the two behaviours the control depends on:
 * `set(…, { merge: true })`, and a transaction that ABORTS AND RE-RUNS when a
 * document it read has moved. It deliberately does NOT invalidate a QUERY read
 * when a new matching document appears — real Firestore gives no such promise
 * to a server transaction, which is exactly why the control writes a per-owner
 * marker document. Making the double generous there would let this file
 * certify a concurrency guarantee the product does not have.
 */

const mockAttachWorkspaceDomain = jest.fn(async () => ({ ok: true }))

jest.mock('./workspace-domains', () => ({
  __esModule: true,
  attachWorkspaceDomain: (...args: unknown[]) =>
    (mockAttachWorkspaceDomain as any)(...args),
}))

jest.mock('./firebase-admin', () => {
  const app = {
    firestore: () => (globalThis as any).__freeWorkspaceCapDb,
    auth: () => ({}),
  }
  const admin = { app: () => app }
  return { __esModule: true, default: admin, firebaseAdmin: admin }
})

import {
  countFreeWorkspacesForOwner,
  DEFAULT_FREE_WORKSPACE_CAP,
  FREE_WORKSPACE_CAP_CONFIG_DOC,
  freeWorkspaceCapConfigWrite,
  freeWorkspaceCapVerdict,
  freeWorkspaceMarkerDocId,
  FreeWorkspaceCapError,
  invalidateFreeWorkspaceCapConfigCache,
  normalizeFreeWorkspaceCapConfig,
  readFreeWorkspaceCapConfig,
} from './free-workspace-cap'
import { createOrganization } from './organizations'
import { RATE_LIMIT_COLLECTION } from './rate-limit-store'

// ---------------------------------------------------------------------------
// In-memory Firestore — documents, single-field equality queries, versioned
// optimistic concurrency. Modelled on the double in `email-send-rate.spec.ts`.
// ---------------------------------------------------------------------------

const docs = new Map<string, Record<string, any>>()
const versions = new Map<string, number>()
/** Set between a transaction's reads and its commit, to force interleaving. */
let afterRead: (() => Promise<void>) | null = null
let aborts = 0
/**
 * Paths whose reads throw. A predicate rather than a flag because the
 * interesting outage is a partial one: the CONFIG document is unreachable
 * while the org documents are fine, which is precisely the state that decides
 * whether "we do not know the ceiling" is answered as zero, as no-ceiling, or
 * as the built-in default.
 */
let failReadsMatching: RegExp | null = null

function readFails(path: string): boolean {
  return Boolean(failReadsMatching && failReadsMatching.test(path))
}

function writeDoc(path: string, value: Record<string, any>, merge: boolean) {
  docs.set(path, merge ? { ...(docs.get(path) ?? {}), ...value } : { ...value })
  versions.set(path, (versions.get(path) ?? 0) + 1)
}

function snapshot(path: string) {
  const data = docs.get(path)
  return {
    id: path.split('/').pop() as string,
    exists: data !== undefined,
    data: () => data,
    get: (field: string) => data?.[field],
  }
}

function docRef(path: string): any {
  return {
    path,
    id: path.split('/').pop(),
    get: async () => {
      if (readFails(path)) throw new Error('UNAVAILABLE')
      return snapshot(path)
    },
    set: async (value: any, options?: { merge?: boolean }) =>
      writeDoc(path, value, Boolean(options?.merge)),
    collection: (child: string) => collectionRef(`${path}/${child}`),
  }
}

interface FakeQuery {
  __collection: string
  __filters: Array<[string, unknown]>
  __limit: number
  where: (field: string, op: string, value: unknown) => FakeQuery
  limit: (n: number) => FakeQuery
  get: () => Promise<{ docs: any[]; empty: boolean; size: number }>
}

function runQuery(query: FakeQuery) {
  const prefix = `${query.__collection}/`
  const matched: any[] = []
  for (const [path, data] of docs) {
    // Only DIRECT children — `orgs/x/members/y` is not an `orgs` document.
    if (!path.startsWith(prefix)) continue
    if (path.slice(prefix.length).includes('/')) continue
    if (query.__filters.every(([field, value]) => data?.[field] === value)) {
      matched.push(snapshot(path))
    }
  }
  return matched.slice(0, query.__limit)
}

function makeQuery(collection: string, filters: Array<[string, unknown]>, max: number) {
  const query: FakeQuery = {
    __collection: collection,
    __filters: filters,
    __limit: max,
    where: (field: string, _op: string, value: unknown) =>
      makeQuery(collection, [...filters, [field, value]], max),
    limit: (n: number) => makeQuery(collection, filters, n),
    get: async () => {
      if (readFails(collection)) throw new Error('UNAVAILABLE')
      const found = runQuery(query)
      return { docs: found, empty: found.length === 0, size: found.length }
    },
  }
  return query
}

function collectionRef(name: string): any {
  return {
    doc: (id: string) => docRef(`${name}/${id}`),
    where: (field: string, op: string, value: unknown) =>
      makeQuery(name, [], Number.MAX_SAFE_INTEGER).where(field, op, value),
    limit: (n: number) => makeQuery(name, [], n),
    add: async (value: any) => {
      writeDoc(`${name}/auto-${docs.size}`, value, false)
    },
  }
}

const firestore: any = {
  collection: (name: string) => collectionRef(name),
  runTransaction: async (body: (tx: any) => Promise<any>) => {
    for (let attempt = 0; attempt < 6; attempt += 1) {
      const readVersions = new Map<string, number>()
      const writes: Array<{ path: string; value: any; merge: boolean }> = []
      const tx = {
        get: async (target: any) => {
          // A query read tracks NOTHING — see the header note. A document read
          // tracks its version, which is what makes the marker contend.
          if (target?.__collection) return target.get()
          readVersions.set(target.path, versions.get(target.path) ?? 0)
          if (readFails(target.path)) throw new Error('UNAVAILABLE')
          return snapshot(target.path)
        },
        set: (ref: any, value: any, options?: any) => {
          writes.push({ path: ref.path, value, merge: Boolean(options?.merge) })
        },
        delete: (ref: any) => {
          writes.push({ path: ref.path, value: null, merge: false })
        },
      }
      // A callback that THROWS is a decision, not contention: Firestore does
      // not retry it, and neither does this.
      const result = await body(tx)
      if (afterRead && attempt === 0) {
        const hook = afterRead
        afterRead = null
        await hook()
      }
      const stale = [...readVersions.entries()].some(
        ([path, version]) => (versions.get(path) ?? 0) !== version,
      )
      if (stale) {
        aborts += 1
        continue
      }
      for (const write of writes) {
        if (write.value === null) docs.delete(write.path)
        else writeDoc(write.path, write.value, write.merge)
      }
      return result
    }
    const error: any = new Error('ABORTED')
    error.code = 10
    throw error
  },
}
;(globalThis as any).__freeWorkspaceCapDb = firestore

const OWNER = 'uid-owner'
const ALT = 'uid-alt'
const CONFIG_PATH = `${RATE_LIMIT_COLLECTION}/${FREE_WORKSPACE_CAP_CONFIG_DOC}`
const MARKER_PATH = `${RATE_LIMIT_COLLECTION}/${freeWorkspaceMarkerDocId(OWNER)}`

beforeEach(() => {
  docs.clear()
  versions.clear()
  afterRead = null
  aborts = 0
  failReadsMatching = null
  invalidateFreeWorkspaceCapConfigCache()
  mockAttachWorkspaceDomain.mockClear()
  jest.spyOn(console, 'error').mockImplementation(() => undefined)
})

afterEach(() => {
  jest.restoreAllMocks()
})

/** Creates a workspace the way `/api/orgs/create` does. */
function create(slug: string, ownerUid = OWNER, bypass = false) {
  return createOrganization({
    name: slug,
    slug,
    ownerUid,
    ownerEmail: `${ownerUid}@example.com`,
    bypassFreeWorkspaceCap: bypass,
  })
}

/** The org documents that exist, by id. */
function orgDocs(): Array<[string, Record<string, any>]> {
  return [...docs.entries()]
    .filter(([path]) => path.startsWith('orgs/') && !path.slice(5).includes('/'))
    .map(([path, data]) => [path.slice(5), data])
}

// ---------------------------------------------------------------------------
// 1. The pure decision — including the state where nothing has loaded
// ---------------------------------------------------------------------------

describe('freeWorkspaceCapVerdict', () => {
  it('allows under the limit and refuses AT it', () => {
    expect(freeWorkspaceCapVerdict({ held: 2, limit: 3 }).allowed).toBe(true)
    expect(freeWorkspaceCapVerdict({ held: 3, limit: 3 }).allowed).toBe(false)
    expect(freeWorkspaceCapVerdict({ held: 9, limit: 3 }).allowed).toBe(false)
  })

  it('reports the numbers it decided with, so a refusal can be explained', () => {
    const verdict = freeWorkspaceCapVerdict({ held: 3, limit: 3 })
    expect(verdict).toMatchObject({ limit: 3, held: 3, remaining: 0 })
  })

  // THE LOADING TRAP. `checkQuota(undefined)` answering as the free tier is a
  // bug this codebase has shipped once already. An unready config here must
  // behave as the compiled-in default — which means it must neither permit the
  // fourth workspace nor refuse the first.
  describe('a limit that has NOT loaded', () => {
    it('does not permit past the built-in default', () => {
      const verdict = freeWorkspaceCapVerdict({ held: 3, ready: false })
      expect(verdict.allowed).toBe(false)
      expect(verdict.limit).toBe(DEFAULT_FREE_WORKSPACE_CAP)
      expect(verdict.ready).toBe(false)
    })

    it('does not deny inside the built-in default either', () => {
      expect(freeWorkspaceCapVerdict({ held: 0, ready: false }).allowed).toBe(true)
      expect(freeWorkspaceCapVerdict({ held: 2, ready: false }).allowed).toBe(true)
    })

    it('ignores any number that happens to be in the field', () => {
      // A stand-in config must not be able to smuggle a ceiling in — neither a
      // generous one nor a zero.
      expect(
        freeWorkspaceCapVerdict({ held: 20, limit: 50, ready: false }).limit,
      ).toBe(DEFAULT_FREE_WORKSPACE_CAP)
      expect(
        freeWorkspaceCapVerdict({ held: 1, limit: 0, ready: false }).allowed,
      ).toBe(true)
    })
  })

  it('never reads a broken stored number as a ceiling of zero', () => {
    for (const limit of [0, -4, Number.NaN, undefined, null] as any[]) {
      const verdict = freeWorkspaceCapVerdict({ held: 0, limit })
      expect(verdict.allowed).toBe(true)
      expect(verdict.limit).toBe(DEFAULT_FREE_WORKSPACE_CAP)
    }
  })

  it('grants everything when staff switch the ceiling OFF', () => {
    const verdict = freeWorkspaceCapVerdict({ held: 99, limit: 3, enabled: false })
    expect(verdict.allowed).toBe(true)
    expect(verdict.disabled).toBe(true)
  })
})

describe('the stored configuration', () => {
  it('is Zach’s 3 when nothing has ever been written', () => {
    const config = normalizeFreeWorkspaceCapConfig(null, { ready: true })
    expect(config.limit).toBe(DEFAULT_FREE_WORKSPACE_CAP)
    expect(config.enabled).toBe(true)
    expect(config.ready).toBe(true)
  })

  it('only an explicit false disables it — a half-written doc stays ON', () => {
    expect(normalizeFreeWorkspaceCapConfig({} as any).enabled).toBe(true)
    expect(normalizeFreeWorkspaceCapConfig({ enabled: false }).enabled).toBe(false)
  })

  it('NEVER carries expiresAt — the TTL policy would delete the ceiling', () => {
    const write = freeWorkspaceCapConfigWrite({
      limit: 7,
      enabled: true,
      actorEmail: 'staff@aglyn.com',
      note: 'agency beta',
      now: 1_700_000_000_000,
    })
    expect(Object.keys(write)).not.toContain('expiresAt')
    expect(write).toMatchObject({ limit: 7, enabled: true, note: 'agency beta' })
  })

  it('reads a stored ceiling, and marks it READY', async () => {
    writeDoc(CONFIG_PATH, { limit: 8, enabled: true }, false)
    const config = await readFreeWorkspaceCapConfig({ firestore })
    expect(config.limit).toBe(8)
    expect(config.ready).toBe(true)
  })

  it('an unreachable store gives the default AND says it is not ready', async () => {
    failReadsMatching = new RegExp(FREE_WORKSPACE_CAP_CONFIG_DOC)
    const config = await readFreeWorkspaceCapConfig({ firestore })
    // Not zero (an outage must not refuse every signup) and not unlimited (an
    // outage must not be the way through the control).
    expect(config.limit).toBe(DEFAULT_FREE_WORKSPACE_CAP)
    expect(config.ready).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// 2. What the count includes
// ---------------------------------------------------------------------------

describe('countFreeWorkspacesForOwner', () => {
  it('counts free workspaces the account owns', async () => {
    writeDoc('orgs/a', { ownerUid: OWNER, createdByUid: OWNER }, false)
    writeDoc('orgs/b', { ownerUid: OWNER, createdByUid: OWNER }, false)
    expect((await countFreeWorkspacesForOwner({ uid: OWNER, firestore })).held).toBe(2)
  })

  it('does NOT count paid workspaces — an agency pays and is unaffected', async () => {
    writeDoc('orgs/a', { ownerUid: OWNER, createdByUid: OWNER, plan: 'pro' }, false)
    writeDoc('orgs/b', { ownerUid: OWNER, createdByUid: OWNER, plan: 'business' }, false)
    writeDoc('orgs/c', { ownerUid: OWNER, createdByUid: OWNER }, false)
    expect((await countFreeWorkspacesForOwner({ uid: OWNER, firestore })).held).toBe(1)
  })

  it('counts a paid workspace again once its subscription is dead', async () => {
    writeDoc(
      'orgs/a',
      { ownerUid: OWNER, createdByUid: OWNER, plan: 'pro', billingStatus: 'canceled' },
      false,
    )
    expect((await countFreeWorkspacesForOwner({ uid: OWNER, firestore })).held).toBe(1)
  })

  it('does NOT count somebody else’s workspace the account was invited to', async () => {
    writeDoc('orgs/theirs', { ownerUid: 'uid-someone-else' }, false)
    writeDoc('orgs/theirs/members/uid-owner', { role: 'admin' }, false)
    // The membership reverse index too — the count must never read it.
    writeDoc(`users/${OWNER}/orgs/theirs`, { role: 'admin' }, false)
    expect((await countFreeWorkspacesForOwner({ uid: OWNER, firestore })).held).toBe(0)
  })

  it('counts an org in BOTH sets exactly once', async () => {
    writeDoc('orgs/a', { ownerUid: OWNER, createdByUid: OWNER }, false)
    const count = await countFreeWorkspacesForOwner({ uid: OWNER, firestore })
    expect(count.held).toBe(1)
    expect(count.orgIds).toEqual(['a'])
  })

  it('counts a workspace the account CREATED but no longer owns', async () => {
    writeDoc('orgs/a', { ownerUid: ALT, createdByUid: OWNER }, false)
    expect((await countFreeWorkspacesForOwner({ uid: OWNER, firestore })).held).toBe(1)
  })
})

// ---------------------------------------------------------------------------
// 3. Create time — the cap, the laundering, and the negative control
// ---------------------------------------------------------------------------

describe('createOrganization enforces the ceiling', () => {
  it('admits the first three and refuses the fourth', async () => {
    await create('one')
    await create('two')
    await create('three')
    await expect(create('four')).rejects.toBeInstanceOf(FreeWorkspaceCapError)
    expect(orgDocs()).toHaveLength(3)
  })

  it('the refusal carries the numbers, not just a no', async () => {
    await create('one')
    await create('two')
    await create('three')
    const error = await create('four').catch((caught) => caught)
    expect(error).toMatchObject({ limit: 3, held: 3 })
  })

  it('stamps createdByUid, which nothing else may ever write', async () => {
    await create('one')
    expect(orgDocs()[0][1]).toMatchObject({ ownerUid: OWNER, createdByUid: OWNER })
  })

  // ------------------------------------------------------------------
  // THE LAUNDERING SEQUENCE, run exactly.
  //
  // Deletion is not the cheap way past a holdings cap — deleting really does
  // give up the workspace. Ownership TRANSFER is: free, instant, reversible.
  // Lower the count, create, put it back.
  // ------------------------------------------------------------------
  describe('the transfer laundering sequence', () => {
    async function holdThreeThenHandOneAway() {
      await create('one')
      await create('two')
      await create('three')
      const [thirdId] = orgDocs()[2]
      // Exactly what `transferOrgOwnership` does to the org doc: it moves
      // `ownerUid` and touches nothing else.
      writeDoc(`orgs/${thirdId}`, { ownerUid: ALT }, true)
      return thirdId
    }

    it('refuses the fourth even with one workspace parked on an alt account', async () => {
      const parked = await holdThreeThenHandOneAway()
      // The ownership query now returns TWO. The account is still attributed
      // three, and this is the assertion the whole issue turns on.
      await expect(create('four')).rejects.toBeInstanceOf(FreeWorkspaceCapError)
      // …and taking it back leaves them on three, never four.
      writeDoc(`orgs/${parked}`, { ownerUid: OWNER }, true)
      expect((await countFreeWorkspacesForOwner({ uid: OWNER, firestore })).held).toBe(3)
      expect(orgDocs()).toHaveLength(3)
    })

    // THE NEGATIVE CONTROL. Strip the creator attribution and the identical
    // sequence goes through. Without this case, reducing the count to the
    // ownership query alone — which is what the code did before AGL-2265, and
    // what a future cleanup would find tempting — would break nothing above.
    it('WOULD succeed if the count were ownership alone (proving the union is load-bearing)', async () => {
      const parked = await holdThreeThenHandOneAway()
      const before = docs.get(`orgs/${parked}`) as Record<string, any>
      delete before.createdByUid
      writeDoc(`orgs/${parked}`, before, false)
      await expect(create('four')).resolves.toEqual(expect.any(String))
      expect(orgDocs()).toHaveLength(4)
    })
  })

  it('DELETING a workspace does free a slot — that decrement is honest', async () => {
    await create('one')
    await create('two')
    await create('three')
    const [erased] = orgDocs()[0]
    docs.delete(`orgs/${erased}`)
    await expect(create('four')).resolves.toEqual(expect.any(String))
  })

  it('three PAID workspaces leave the free allowance untouched', async () => {
    for (const slug of ['one', 'two', 'three']) await create(slug)
    for (const [id] of orgDocs()) writeDoc(`orgs/${id}`, { plan: 'pro' }, true)
    await expect(create('four')).resolves.toEqual(expect.any(String))
  })

  it('never counts a DIFFERENT account’s workspaces against this one', async () => {
    for (const slug of ['a1', 'a2', 'a3']) await create(slug, ALT)
    await expect(create('mine')).resolves.toEqual(expect.any(String))
  })

  it('staff provisioning on a customer’s behalf is exempt', async () => {
    await create('one')
    await create('two')
    await create('three')
    await expect(create('four', OWNER, true)).resolves.toEqual(expect.any(String))
    // And the bypass writes no marker — it is not a creation the ceiling saw.
    expect(docs.get(MARKER_PATH)?.creates).toBe(3)
  })

  // ------------------------------------------------------------------
  // Concurrency. Two requests in flight together both observe three free
  // workspaces; the marker document is the only thing that makes them
  // contend, and the double refuses to invalidate a query read for them.
  // ------------------------------------------------------------------
  it('refuses a fourth that races a third — the per-owner marker contends', async () => {
    await create('one')
    await create('two')
    // Park a competing creation between the racing transaction's reads and
    // its commit, exactly as a second request would arrive.
    afterRead = async () => {
      await create('three')
    }
    await expect(create('three-b')).rejects.toBeInstanceOf(FreeWorkspaceCapError)
    expect(aborts).toBeGreaterThan(0)
    expect(orgDocs()).toHaveLength(3)
  })

  // THE LOADING DEFAULT, on the real path. Staff had raised the ceiling to 9;
  // the config document then becomes unreadable. The create path must not read
  // "unknown" as "no ceiling" (which would make a Firestore blip the way
  // through), and must not read it as zero either — the first workspace of the
  // day still has to be creatable.
  describe('when the ceiling itself cannot be read', () => {
    beforeEach(() => {
      writeDoc(CONFIG_PATH, { limit: 9, enabled: true }, false)
      invalidateFreeWorkspaceCapConfigCache()
    })

    it('does not permit past the built-in default', async () => {
      await create('one')
      await create('two')
      await create('three')
      failReadsMatching = new RegExp(FREE_WORKSPACE_CAP_CONFIG_DOC)
      invalidateFreeWorkspaceCapConfigCache()
      await expect(create('four')).rejects.toBeInstanceOf(FreeWorkspaceCapError)
    })

    it('does not refuse inside the built-in default either', async () => {
      failReadsMatching = new RegExp(FREE_WORKSPACE_CAP_CONFIG_DOC)
      invalidateFreeWorkspaceCapConfigCache()
      await expect(create('one')).resolves.toEqual(expect.any(String))
      await expect(create('two')).resolves.toEqual(expect.any(String))
    })
  })
})

// ---------------------------------------------------------------------------
// 4. The staff control, taking effect
// ---------------------------------------------------------------------------

describe('the staff console control', () => {
  it('a raised limit admits the fourth workspace — no redeploy, no restart', async () => {
    await create('one')
    await create('two')
    await create('three')
    await expect(create('four')).rejects.toBeInstanceOf(FreeWorkspaceCapError)

    // Precisely what the route writes, into precisely the document it writes
    // to, followed by the cache invalidation the route performs.
    writeDoc(
      CONFIG_PATH,
      freeWorkspaceCapConfigWrite({
        limit: 5,
        enabled: true,
        actorEmail: 'staff@aglyn.com',
        note: 'agency beta',
      }) as Record<string, any>,
      true,
    )
    invalidateFreeWorkspaceCapConfigCache()

    await expect(create('four')).resolves.toEqual(expect.any(String))
    await expect(create('five')).resolves.toEqual(expect.any(String))
    await expect(create('six')).rejects.toBeInstanceOf(FreeWorkspaceCapError)
  })

  it('a LOWERED limit removes nothing — it only stops the next one', async () => {
    await create('one')
    await create('two')
    await create('three')
    writeDoc(CONFIG_PATH, { limit: 1, enabled: true }, false)
    invalidateFreeWorkspaceCapConfigCache()
    await expect(create('four')).rejects.toBeInstanceOf(FreeWorkspaceCapError)
    // All three survive. A rule that retroactively took a customer's
    // workspaces away would be worse than the gap it closes.
    expect(orgDocs()).toHaveLength(3)
  })

  it('switching the ceiling OFF lets creation through again', async () => {
    await create('one')
    await create('two')
    await create('three')
    writeDoc(CONFIG_PATH, { limit: 3, enabled: false }, false)
    invalidateFreeWorkspaceCapConfigCache()
    await expect(create('four')).resolves.toEqual(expect.any(String))
  })

  it('does not cache a DEGRADED read — the next create tries the store again', async () => {
    failReadsMatching = new RegExp(FREE_WORKSPACE_CAP_CONFIG_DOC)
    expect((await readFreeWorkspaceCapConfig()).ready).toBe(false)
    failReadsMatching = null
    writeDoc(CONFIG_PATH, { limit: 9, enabled: true }, false)
    const config = await readFreeWorkspaceCapConfig()
    expect(config.limit).toBe(9)
    expect(config.ready).toBe(true)
  })
})

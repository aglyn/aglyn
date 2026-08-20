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

import { FieldValue } from 'firebase-admin/firestore'
import {
  consumeRateLimit,
  currentRateLimitDegradation,
  DEGRADATION_DOC_PREFIX,
  RATE_LIMIT_COLLECTION,
  recordSignupRefusal,
  resetRateLimitDegradationForTests,
  SIGNUP_REFUSAL_DOC_PREFIX,
} from './rate-limit-store'

/**
 * A Firestore stand-in with REAL semantics for the two shapes this module
 * uses, because an unfaithful one fabricates both false greens and false
 * reds here.
 *
 * ## Why it models a document VERSION
 *
 * The counter used to be `runTransaction(read, write)`. A double that simply
 * runs the callback inline has no read set and no version, so no two
 * transactions can ever conflict — and a contention test written against it
 * passes under the OLD code as readily as the new, proving nothing. This one
 * stamps a version on every write, records the versions a transaction READ,
 * and aborts the attempt if any of them moved before the commit. That is the
 * optimistic-concurrency rule Firestore actually applies, and it is what lets
 * `contentionNegativeControl` below go red on demand.
 *
 * ## Why writes carry the real `operand`
 *
 * `FieldValue.increment(n)` is applied by reading `operand` off the sentinel
 * rather than assuming `+1`, so mutating the production call to
 * `increment(0)` — or to a plain assignment — changes what this store holds
 * and fails the assertions, instead of being silently absorbed.
 *
 * Every read and write yields to the event loop first, so concurrent callers
 * really do interleave rather than running to completion one at a time.
 */
function fakeFirestore() {
  /** path → fields. Exposed: several tests assert on the stored document. */
  const docs = new Map<string, Record<string, unknown>>()
  /** path → monotonic version, bumped by every write. */
  const versions = new Map<string, number>()
  let failNext = false
  const counts = { reads: 0, writes: 0, aborts: 0 }
  /** Ordered op log — lets a test assert the WRITE precedes the READ. */
  const log: string[] = []

  /** One round trip. `setImmediate` so concurrent callers interleave. */
  const hop = () => new Promise((resolve) => setImmediate(resolve))

  function applyWrite(
    path: string,
    value: Record<string, unknown>,
    merge: boolean,
  ) {
    const prior = docs.get(path) ?? {}
    const next: Record<string, unknown> = merge ? { ...prior } : {}
    for (const [field, raw] of Object.entries(value)) {
      if (raw instanceof FieldValue) {
        const operand = (raw as unknown as { operand?: unknown }).operand
        if (typeof operand !== 'number') {
          throw new Error(`unsupported sentinel on ${field}`)
        }
        next[field] = (Number(prior[field]) || 0) + operand
      } else {
        next[field] = raw
      }
    }
    docs.set(path, next)
    versions.set(path, (versions.get(path) ?? 0) + 1)
  }

  function snapshot(path: string) {
    const data = docs.get(path)
    return {
      exists: docs.has(path),
      get: (field: string) => data?.[field],
    }
  }

  function docRef(path: string) {
    return {
      path,
      set: async (value: Record<string, unknown>, options?: { merge?: boolean }) => {
        await hop()
        if (failNext) throw new Error('firestore unavailable')
        counts.writes += 1
        log.push('write')
        applyWrite(path, value, options?.merge === true)
      },
      get: async () => {
        await hop()
        if (failNext) throw new Error('firestore unavailable')
        counts.reads += 1
        log.push('read')
        return snapshot(path)
      },
    }
  }

  const api = {
    docs,
    versions,
    counts,
    log,
    failFrom: () => {
      failNext = true
    },
    recover: () => {
      failNext = false
    },
    collection: (name: string) => ({
      doc: (id: string) => docRef(`${name}/${id}`),
    }),
    runTransaction: async (
      fn: (tx: unknown) => Promise<number>,
      options?: { maxAttempts?: number },
    ) => {
      if (failNext) throw new Error('firestore unavailable')
      // Firestore's own default. The production counter no longer opens a
      // transaction at all, but the degradation and signup-refusal markers
      // still do, and the negative control below deliberately does.
      const maxAttempts = options?.maxAttempts ?? 5
      for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
        const readVersions = new Map<string, number>()
        const pending: Array<[string, Record<string, unknown>, boolean]> = []
        const tx = {
          get: async (ref: { path: string }) => {
            await hop()
            counts.reads += 1
            readVersions.set(ref.path, versions.get(ref.path) ?? 0)
            return snapshot(ref.path)
          },
          set: (
            ref: { path: string },
            value: Record<string, unknown>,
            opts?: { merge?: boolean },
          ) => {
            pending.push([ref.path, value, opts?.merge === true])
          },
        }
        const result = await fn(tx)
        // The commit is its own round trip, which is the window another
        // writer slips through.
        await hop()
        const stale = [...readVersions].some(
          ([path, version]) => (versions.get(path) ?? 0) !== version,
        )
        if (stale) {
          counts.aborts += 1
          continue
        }
        for (const [path, value, merge] of pending) applyWrite(path, value, merge)
        counts.writes += 1
        return result
      }
      // gRPC ABORTED — what Firestore returns once a transaction has lost its
      // optimistic race too many times.
      throw Object.assign(new Error('too much contention'), { code: 10 })
    },
  }
  return api
}

describe('consumeRateLimit (AGL-794)', () => {
  const opts = (firestore: unknown, now: number) => ({
    firestore,
    limit: 3,
    windowMs: 1000,
    now,
  })

  it('counts across calls and denies past the limit', async () => {
    const firestore = fakeFirestore()
    const results = []
    for (let i = 0; i < 4; i += 1) {
      results.push(await consumeRateLimit('ip-1', opts(firestore, 10_000)))
    }
    expect(results.map((r) => r.allowed)).toEqual([true, true, true, false])
    expect(results.map((r) => r.remaining)).toEqual([2, 1, 0, 0])
    expect(results.every((r) => !r.degraded)).toBe(true)
  })

  it('keeps separate budgets per key', async () => {
    const firestore = fakeFirestore()
    for (let i = 0; i < 3; i += 1) {
      await consumeRateLimit('ip-1', opts(firestore, 10_000))
    }
    // A different caller is unaffected by the first one exhausting its window.
    const other = await consumeRateLimit('ip-2', opts(firestore, 10_000))
    expect(other.allowed).toBe(true)
    expect(other.remaining).toBe(2)
  })

  it('starts a fresh window once the old one elapses', async () => {
    const firestore = fakeFirestore()
    for (let i = 0; i < 4; i += 1) {
      await consumeRateLimit('ip-1', opts(firestore, 10_000))
    }
    const next = await consumeRateLimit('ip-1', opts(firestore, 11_200))
    expect(next.allowed).toBe(true)
    expect(next.remaining).toBe(2)
  })

  // The whole reason this exists: a per-instance Map does NOT survive a cold
  // start, so the durable counter must be keyed only by (key, window) and not
  // by anything instance-local.
  it('survives a simulated cold start', async () => {
    const firestore = fakeFirestore()
    await consumeRateLimit('ip-1', opts(firestore, 10_000))
    await consumeRateLimit('ip-1', opts(firestore, 10_000))
    // New "instance" — same backing store, no in-process state carried over.
    jest.resetModules()
    const fresh = await consumeRateLimit('ip-1', opts(firestore, 10_000))
    expect(fresh.allowed).toBe(true)
    expect(fresh.remaining).toBe(0)
    const overflow = await consumeRateLimit('ip-1', opts(firestore, 10_000))
    expect(overflow.allowed).toBe(false)
  })

  it('writes an expiry so buckets can be TTL-swept', async () => {
    const firestore = fakeFirestore()
    await consumeRateLimit('ip-1', opts(firestore, 10_000))
    const [[path, doc]] = [...firestore.docs.entries()]
    expect(path.startsWith(`${RATE_LIMIT_COLLECTION}/`)).toBe(true)
    expect(doc['expiresAt']).toBeInstanceOf(Date)
  })

  it('never puts the raw key in the document id', async () => {
    const firestore = fakeFirestore()
    // Keys carry client IPs, which are personal data and must not sit in
    // plaintext document ids.
    await consumeRateLimit('unlock:host:screen:203.0.113.7', opts(firestore, 0))
    const [path] = [...firestore.docs.keys()]
    expect(path).not.toContain('203.0.113.7')
    expect(path).not.toContain('unlock:host')
  })

  it('degrades to the in-memory limiter when the store is unavailable', async () => {
    const firestore = fakeFirestore()
    firestore.failFrom()
    const result = await consumeRateLimit('ip-degraded', opts(firestore, 10_000))
    // Fails SOFT, not open: still answers, still counts, but says the cap
    // held for this instance only. Failing open would let an attacker disable
    // brute-force protection by inducing a storage error.
    expect(result.degraded).toBe(true)
    expect(result.allowed).toBe(true)
    expect(result.limit).toBe(3)
  })
})

/**
 * `degraded: true` used to exist only in a `console.error` (AGL-1679). A
 * Firestore blip therefore dropped every durable limiter — auth, password
 * reset, and the public REST API's per-key quota — to a per-instance cap for
 * as long as it lasted, and the only record was a log line in a retention
 * window measured in hours. Fail-soft is defensible only if the fallback is
 * findable afterwards.
 */
describe('AGL-1679 · a degraded window leaves a durable record', () => {
  const opts = (firestore: unknown, now: number) => ({
    firestore,
    limit: 3,
    windowMs: 1000,
    now,
  })

  /** The marker is written fire-and-forget; let its microtasks land. */
  /**
   * Drain the queues until the fire-and-forget markers have committed.
   *
   * One `setTimeout(0)` was enough while the double ran transactions inline.
   * It no longer is: `fakeFirestore` yields on every read and on the commit,
   * so a marker takes several turns to land, and a single tick made these
   * assertions race the write they were checking for. Draining both the
   * timer and check phases repeatedly is deterministic where a longer single
   * wait would only be luckier.
   */
  const settle = async () => {
    for (let i = 0; i < 10; i += 1) {
      await new Promise((resolve) => setImmediate(resolve))
      await new Promise((resolve) => setTimeout(resolve, 0))
    }
  }

  const markers = (firestore: ReturnType<typeof fakeFirestore>) =>
    [...firestore.docs.entries()].filter(([path]) =>
      path.startsWith(`${RATE_LIMIT_COLLECTION}/${DEGRADATION_DOC_PREFIX}`),
    )

  beforeEach(() => {
    resetRateLimitDegradationForTests()
    jest.spyOn(console, 'error').mockImplementation(() => undefined)
  })

  afterEach(() => {
    jest.restoreAllMocks()
    resetRateLimitDegradationForTests()
  })

  it('writes a summary of the episode once the store comes back', async () => {
    const firestore = fakeFirestore()
    firestore.failFrom()
    await consumeRateLimit('ip-1', opts(firestore, 10_000))
    await consumeRateLimit('ip-2', opts(firestore, 10_400))
    await consumeRateLimit('ip-1', opts(firestore, 10_800))

    // Nothing durable exists yet — the store was the thing that was down, so
    // a marker written DURING the window is the one write guaranteed to fail.
    expect(markers(firestore)).toHaveLength(0)
    expect(currentRateLimitDegradation()?.count).toBe(3)

    firestore.recover()
    await consumeRateLimit('ip-1', opts(firestore, 11_000))
    await settle()

    const found = markers(firestore)
    expect(found).toHaveLength(1)
    const [, marker] = found[0]
    expect(marker['calls']).toBe(3)
    expect(marker['episodes']).toBe(1)
    expect(marker['firstAtMs']).toBe(10_000)
    expect(marker['lastAtMs']).toBe(10_800)
    // Swept by the TTL policy already configured on this collection, so the
    // record needs no new collection, rule or policy of its own.
    expect(marker['expiresAt']).toBeInstanceOf(Date)
    // Episode closed: a later healthy call must not write a second marker.
    expect(currentRateLimitDegradation()).toBeNull()
  })

  it('writes nothing at all when the store never failed', async () => {
    const firestore = fakeFirestore()
    await consumeRateLimit('ip-1', opts(firestore, 10_000))
    await consumeRateLimit('ip-1', opts(firestore, 10_100))
    await settle()
    expect(markers(firestore)).toHaveLength(0)
    expect(currentRateLimitDegradation()).toBeNull()
  })

  it('logs once per episode, not once per refused call', async () => {
    // The REST API calls this on every request (AGL-1679), so a per-call
    // `console.error` during an outage is a log flood that buries the signal.
    const firestore = fakeFirestore()
    firestore.failFrom()
    for (let i = 0; i < 25; i += 1) {
      await consumeRateLimit('ip-1', opts(firestore, 10_000 + i))
    }
    expect(console.error).toHaveBeenCalledTimes(1)

    // …and once more if it is still going a minute later.
    await consumeRateLimit('ip-1', opts(firestore, 10_000 + 60_001))
    expect(console.error).toHaveBeenCalledTimes(2)
  })
})

describe('recordSignupRefusal (AGL-1907)', () => {
  /**
   * Drain the queues until the fire-and-forget markers have committed.
   *
   * One `setTimeout(0)` was enough while the double ran transactions inline.
   * It no longer is: `fakeFirestore` yields on every read and on the commit,
   * so a marker takes several turns to land, and a single tick made these
   * assertions race the write they were checking for. Draining both the
   * timer and check phases repeatedly is deterministic where a longer single
   * wait would only be luckier.
   */
  const settle = async () => {
    for (let i = 0; i < 10; i += 1) {
      await new Promise((resolve) => setImmediate(resolve))
      await new Promise((resolve) => setTimeout(resolve, 0))
    }
  }
  const refusalDocs = (firestore: ReturnType<typeof fakeFirestore>) =>
    [...firestore.docs.entries()].filter(([path]) =>
      path.startsWith(`${RATE_LIMIT_COLLECTION}/${SIGNUP_REFUSAL_DOC_PREFIX}`),
    )

  it('writes a minute-bucketed marker carrying the reason', async () => {
    const firestore = fakeFirestore()
    recordSignupRefusal('uid', { firestore, now: 1_755_100_830_000 })
    await settle()

    const entries = refusalDocs(firestore)
    expect(entries).toHaveLength(1)
    const [path, doc] = entries[0]
    // Bucketed DOWN to the minute — 830_000ms lands in the 800_000 bucket.
    expect(path).toBe(
      `${RATE_LIMIT_COLLECTION}/${SIGNUP_REFUSAL_DOC_PREFIX}1755100800000`,
    )
    expect(doc['refusals']).toBe(1)
    expect(doc['byReason']).toEqual({ uid: 1 })
  })

  it('merges concurrent instances into one bucket and sums per reason', async () => {
    const firestore = fakeFirestore()
    for (let i = 0; i < 3; i += 1) {
      recordSignupRefusal('uid', { firestore, now: 1_755_100_800_000 + i })
      await settle()
    }
    for (let i = 0; i < 2; i += 1) {
      recordSignupRefusal('ip', { firestore, now: 1_755_100_820_000 + i })
      await settle()
    }

    const entries = refusalDocs(firestore)
    expect(entries).toHaveLength(1)
    expect(entries[0][1]['refusals']).toBe(5)
    expect(entries[0][1]['byReason']).toEqual({ uid: 3, ip: 2 })
  })

  it('stamps refusedAtMs — NOT lastAtMs, which would blind the AGL-1693 probe', async () => {
    // The rate-limiter health check queries this same collection with
    // `where('lastAtMs','>=',cutoff).orderBy(...).limit(N)`. A refusal marker
    // carrying `lastAtMs` would be swept into that result and, under a flood,
    // could fill the limit and push the real degradation markers out of it.
    const firestore = fakeFirestore()
    recordSignupRefusal('ip', { firestore, now: 1_755_100_830_000 })
    await settle()

    const doc = refusalDocs(firestore)[0][1]
    expect(doc['refusedAtMs']).toBe(1_755_100_830_000)
    expect(doc['lastAtMs']).toBeUndefined()
    expect(Object.keys(doc)).not.toContain('lastAtMs')
  })

  it('never throws when the store is down — the 429 still ships', async () => {
    const firestore = fakeFirestore()
    firestore.failFrom()
    expect(() =>
      recordSignupRefusal('uid', { firestore, now: 1_755_100_800_000 }),
    ).not.toThrow()
    await settle()
    expect(refusalDocs(firestore)).toHaveLength(0)
  })

  it('carries a TTL so markers do not accumulate forever', async () => {
    const firestore = fakeFirestore()
    recordSignupRefusal('uid', { firestore, now: 1_755_100_800_000 })
    await settle()
    const expiresAt = refusalDocs(firestore)[0][1]['expiresAt'] as Date
    expect(expiresAt).toBeInstanceOf(Date)
    expect(expiresAt.getTime()).toBe(
      1_755_100_800_000 + 7 * 24 * 60 * 60 * 1000,
    )
  })

  it('stores no identifiers — no uid, no IP, no key', async () => {
    // The body this feeds is public. Nothing but counts may reach it.
    const firestore = fakeFirestore()
    recordSignupRefusal('ip', { firestore, now: 1_755_100_800_000 })
    await settle()
    expect(Object.keys(refusalDocs(firestore)[0][1]).sort()).toEqual([
      'byReason',
      'expiresAt',
      'firstRefusedAtMs',
      'refusals',
      'refusedAtMs',
    ])
  })
})

/**
 * AGL-2404 — a contended key must produce a DECISION, not a held function.
 *
 * Measured against production on 2026-08-19 at `/api/protection/unlock`:
 * sequential traffic refused cleanly (10 × 404, then 429 with `Retry-After`),
 * but **two** concurrent requests on one key were already enough for one of
 * them to die at ~10.3 s as a bodyless 504 — the account-default function
 * ceiling. The cap itself never broke: a follow-up sequential probe in the
 * same window showed exactly 10 admitted before the 429, so the timed-out
 * transactions committed nothing. The defect is the refusal mechanism.
 */
describe('AGL-2404 · a contended counter refuses instead of hanging', () => {
  const opts = (firestore: unknown, extra?: Record<string, unknown>) => ({
    firestore,
    limit: 10,
    windowMs: 60_000,
    now: 10_000,
    budgetMs: 25,
    ...extra,
  })

  /**
   * A store that is UP but whose write for this doc never settles. Since
   * AGL-2416 the counter is `set` + `get` rather than a transaction, so the
   * hang has to be staged on the write — the round trip that now happens
   * first.
   */
  function hangingFirestore() {
    return {
      collection: () => ({
        doc: (id: string) => ({
          path: id,
          set: () => new Promise(() => undefined),
          get: () => new Promise(() => undefined),
        }),
      }),
    }
  }

  /** A store that rejects with a gRPC status code. */
  function codeFirestore(code: number) {
    const reject = () => Promise.reject(Object.assign(new Error('x'), { code }))
    return {
      collection: () => ({
        doc: (id: string) => ({ path: id, set: reject, get: reject }),
      }),
    }
  }

  beforeEach(() => {
    resetRateLimitDegradationForTests()
    jest.spyOn(console, 'error').mockImplementation(() => undefined)
  })
  afterEach(() => {
    jest.restoreAllMocks()
    resetRateLimitDegradationForTests()
  })

  it('answers within its budget when the transaction never settles', async () => {
    // Without the wall-clock bound this call cannot fail — it can only hang
    // until the platform kills the request, which is the 504. The assertion
    // that matters is that it RETURNS at all.
    const started = Date.now()
    const result = await consumeRateLimit('unlock:h:s:ip', opts(hangingFirestore()))
    expect(Date.now() - started).toBeLessThan(2_000)
    expect(result.contended).toBe(true)
    expect(result.allowed).toBe(false)
    // A refusal a caller can turn into a real 429 + Retry-After: the window
    // end is preserved so `X-RateLimit-Reset` stays honest.
    expect(result.resetMs).toBe(60_000)
    expect(result.limit).toBe(10)
  })

  it('fails CLOSED on contention — going concurrent must not widen the cap', async () => {
    // The fail-soft path answers from a per-instance Map that starts empty,
    // so degrading here would hand a caller a fresh budget per instance for
    // the price of racing itself. That is the AGL-794 defect, re-entered
    // through the back door.
    const result = await consumeRateLimit('unlock:h:s:ip', opts(codeFirestore(10)))
    expect(result.allowed).toBe(false)
    expect(result.contended).toBe(true)
    expect(result.degraded).toBe(false)
  })

  it('treats DEADLINE_EXCEEDED as contention too', async () => {
    const result = await consumeRateLimit('apiv1:k', opts(codeFirestore(4)))
    expect(result.contended).toBe(true)
    expect(result.degraded).toBe(false)
  })

  it('does not record contention as a degradation', async () => {
    // `/api/health/rate-limits` asks one question: did the durable store stop
    // answering? A contended document is the store working, so a contention
    // marker in that feed would answer it wrongly and mask a real outage.
    const firestore = hangingFirestore()
    for (let i = 0; i < 5; i += 1) {
      await consumeRateLimit('unlock:h:s:ip', opts(firestore))
    }
    expect(currentRateLimitDegradation()).toBeNull()
  })

  it('still fails SOFT when the store itself is unreachable', async () => {
    // The other half of the classification: an outage is NOT contention, and
    // must keep the pre-existing posture so a Firestore blip never locks real
    // visitors out of a customer's site.
    const down = {
      collection: () => ({
        doc: (id: string) => ({
          path: id,
          set: () => Promise.reject(new Error('firestore unavailable')),
          get: () => Promise.reject(new Error('firestore unavailable')),
        }),
      }),
    }
    const result = await consumeRateLimit('form:h:ip', opts(down))
    expect(result.degraded).toBe(true)
    expect(result.contended).toBe(false)
    expect(result.allowed).toBe(true)
    expect(currentRateLimitDegradation()?.count).toBe(1)
  })

  it('opens NO transaction, so there is no retry storm left to bound', async () => {
    // What the old bound was for: the counter was a read-modify-write
    // transaction, whose default 5 attempts behind a growing backoff is how
    // one hot document became ten seconds of held function. AGL-2416 removed
    // the read set, so the retry loop it was capping no longer exists. This
    // asserts the removal rather than the cap — if a transaction ever comes
    // back to this path, its retries need bounding again and this goes red.
    const opened: unknown[] = []
    const firestore = fakeFirestore()
    const wrapped = {
      ...firestore,
      runTransaction: (...args: unknown[]) => {
        opened.push(args)
        return (firestore.runTransaction as any)(...args)
      },
    }
    const result = await consumeRateLimit('apiv1:k', opts(wrapped))

    expect(result.allowed).toBe(true)
    expect(opened).toHaveLength(0)
    // …and it costs exactly what the transaction cost: one write, one read.
    expect(firestore.counts.writes).toBe(1)
    expect(firestore.counts.reads).toBe(1)
  })
})

/**
 * AGL-2416 — the counter's storage shape.
 *
 * Measured in production on 2026-08-19 against `/api/protection/unlock` with
 * a fresh key each time: sequential traffic refused cleanly at the 10th
 * attempt, but **two** concurrent requests on one key already produced a 504,
 * and 4 and 5 concurrent produced two each. Two is not attack-shaped — it is
 * a double-submit, a mobile retry, or two visitors behind one NAT. And the
 * published 120/min per API key is not reachable *without* concurrency, so an
 * integration built to the documented budget met this by design.
 *
 * The cause was the counter being a read-modify-write `runTransaction` on a
 * single document per (key, window): optimistic concurrency, one hot doc, so
 * writers abort each other. This block asserts the replacement, and — first —
 * that the double it is asserted against can produce contention at all.
 */
describe('AGL-2416 · the counter is an atomic increment, not a read-modify-write', () => {
  const opts = (firestore: unknown, extra?: Record<string, unknown>) => ({
    firestore,
    limit: 10,
    windowMs: 60_000,
    now: 10_000,
    ...extra,
  })

  const burst = (n: number, run: (i: number) => Promise<unknown>) =>
    Promise.all(Array.from({ length: n }, (_unused, i) => run(i)))

  // The fail-soft case below opens a degradation episode. Left standing it
  // would leak into whatever runs next, so it is closed here rather than
  // relying on test order.
  beforeEach(() => {
    resetRateLimitDegradationForTests()
    jest.spyOn(console, 'error').mockImplementation(() => undefined)
  })
  afterEach(() => {
    jest.restoreAllMocks()
    resetRateLimitDegradationForTests()
  })

  /**
   * The counter EXACTLY as it was before this change, driven through the same
   * double: read the count, add one, write it back, inside a transaction
   * capped at the 3 attempts AGL-2404 set.
   */
  function legacyReadModifyWrite(
    firestore: ReturnType<typeof fakeFirestore>,
    path = `${RATE_LIMIT_COLLECTION}/legacy_10000`,
  ) {
    return firestore.runTransaction(
      async (tx: any) => {
        const snapshot = await tx.get({ path })
        const next = ((snapshot.exists ? snapshot.get('count') : 0) ?? 0) + 1
        tx.set({ path }, { count: next }, { merge: true })
        return next
      },
      { maxAttempts: 3 },
    )
  }

  /**
   * NEGATIVE CONTROL, and the reason the rest of this block means anything.
   *
   * A Firestore double that runs `runTransaction` inline has no read set and
   * no document version, so no two transactions can ever conflict — and every
   * assertion below would pass just as happily against the OLD code. This
   * test drives the OLD shape through the SAME double and requires it to
   * contend: transactions abort, and some exhaust their attempts and reject
   * with gRPC `ABORTED`. If this ever goes green, the double has stopped
   * modelling contention and the greens beneath it are worthless.
   */
  it('NEGATIVE CONTROL — the read-modify-write it replaced really does contend here', async () => {
    const firestore = fakeFirestore()
    const settled = await Promise.allSettled(
      Array.from({ length: 8 }, () => legacyReadModifyWrite(firestore)),
    )

    expect(firestore.counts.aborts).toBeGreaterThan(0)
    const rejected = settled.filter((r) => r.status === 'rejected')
    expect(rejected.length).toBeGreaterThan(0)
    expect((rejected[0] as PromiseRejectedResult).reason.code).toBe(10)
  })

  it('reaches a decision for every caller in a concurrent burst', async () => {
    const firestore = fakeFirestore()
    const results = (await burst(8, () =>
      consumeRateLimit('apiv1:key', opts(firestore)),
    )) as Array<Awaited<ReturnType<typeof consumeRateLimit>>>

    // The old shape, at this concurrency, aborted and rejected (above). Not
    // one caller here is refused on contention or dropped to the fallback.
    expect(results.every((r) => r.contended === false)).toBe(true)
    expect(results.every((r) => r.degraded === false)).toBe(true)
    expect(firestore.counts.aborts).toBe(0)
    // Every increment landed: 8 requests, 8 counted.
    const [counter] = [...firestore.docs.values()]
    expect(counter['count']).toBe(8)
  })

  it('holds at higher concurrency than the limit itself', async () => {
    const firestore = fakeFirestore()
    const results = (await burst(24, () =>
      consumeRateLimit('apiv1:key', opts(firestore)),
    )) as Array<Awaited<ReturnType<typeof consumeRateLimit>>>

    expect(results.every((r) => r.contended === false)).toBe(true)
    const [counter] = [...firestore.docs.values()]
    expect(counter['count']).toBe(24)
  })

  it('CANNOT over-admit: going concurrent never widens the cap', async () => {
    const firestore = fakeFirestore()
    const results = (await burst(24, () =>
      consumeRateLimit('apiv1:key', opts(firestore)),
    )) as Array<Awaited<ReturnType<typeof consumeRateLimit>>>

    // The property the whole limiter exists for. Racing yourself must never
    // buy more than the limit — that was the AGL-794 defect, and trading a
    // transaction for an atomic increment must not reintroduce it.
    expect(results.filter((r) => r.allowed).length).toBeLessThanOrEqual(10)
  })

  it('the cap still holds under the production measurement shape', async () => {
    // AGL-2416's own method: burst on a fresh key, then keep probing
    // SEQUENTIALLY inside the same window and count total admissions. On
    // production this admitted exactly 10 and refused the 11th.
    const firestore = fakeFirestore()
    const results = (await burst(4, () =>
      consumeRateLimit('unlock:h:s:ip', opts(firestore)),
    )) as Array<Awaited<ReturnType<typeof consumeRateLimit>>>
    let admitted = results.filter((r) => r.allowed).length

    for (let i = 0; i < 20; i += 1) {
      const next = await consumeRateLimit('unlock:h:s:ip', opts(firestore))
      if (next.allowed) admitted += 1
    }

    // At most the limit, and — because the burst was small and the counter
    // monotonic — exactly it here. No free guesses, no over-count.
    expect(admitted).toBe(10)
  })

  it('may refuse EARLY under concurrency, and never late — the documented cost', async () => {
    // The trade this change makes. The read-back can observe other writers'
    // increments, so at the window's edge concurrent callers can all see the
    // post-burst total and all be refused. "Exactly `limit` admitted" becomes
    // "at most `limit`", short by at most `concurrency - 1`.
    const firestore = fakeFirestore()
    for (let i = 0; i < 9; i += 1) {
      await consumeRateLimit('apiv1:key', opts(firestore))
    }

    const results = (await burst(4, () =>
      consumeRateLimit('apiv1:key', opts(firestore)),
    )) as Array<Awaited<ReturnType<typeof consumeRateLimit>>>
    const admitted = results.filter((r) => r.allowed).length

    // One slot was left. Never more than one is handed out…
    expect(admitted).toBeLessThanOrEqual(1)
    // …and the shortfall is bounded by the concurrency, not unbounded.
    expect(admitted).toBeGreaterThanOrEqual(1 - (4 - 1))
  })

  it('writes BEFORE it reads — the ordering that stops it under-counting', async () => {
    // Read-then-write is a read-modify-write again, only without the
    // transaction that made it safe: two callers would both read N and both
    // report N + 1, and the cap would leak by exactly the concurrency.
    const firestore = fakeFirestore()
    await consumeRateLimit('apiv1:key', opts(firestore))
    expect(firestore.log).toEqual(['write', 'read'])
  })

  it('a call abandoned on its budget has already counted — over, never under', async () => {
    // The transaction this replaced committed nothing when it timed out,
    // which is how AGL-2416 could observe "10 admitted, 11th refused" after a
    // burst of 504s. The increment now lands first, so an abandoned caller
    // spends the slot it was refused for. Asserted rather than left to be
    // discovered: it is a real semantic change, and it errs in the only safe
    // direction — the counter over-counts, so nobody buys budget by timing
    // out.
    const docs = new Map<string, Record<string, unknown>>()
    const slowReadBack = {
      collection: () => ({
        doc: (id: string) => ({
          path: id,
          set: async (value: Record<string, unknown>) => {
            const operand = (value['count'] as { operand: number }).operand
            docs.set(id, {
              count: (Number(docs.get(id)?.['count']) || 0) + operand,
            })
          },
          // The write landed; the read-back never returns.
          get: () => new Promise(() => undefined),
        }),
      }),
    }

    const result = await consumeRateLimit(
      'apiv1:key',
      opts(slowReadBack, { budgetMs: 25 }),
    )
    expect(result.contended).toBe(true)
    expect(result.allowed).toBe(false)
    expect([...docs.values()][0]?.['count']).toBe(1)
  })

  it('fails SOFT, not OPEN, when the store accepts the write and shows no count', async () => {
    // The one branch that exists because the store is misbehaving. Reading
    // the absent count as 0 would mean "no requests yet" and admit everyone —
    // fail-open, from the failure path.
    const blind = {
      collection: () => ({
        doc: (id: string) => ({
          path: id,
          set: async () => undefined,
          get: async () => ({ exists: false, get: () => undefined }),
        }),
      }),
    }
    const result = await consumeRateLimit('apiv1:key', opts(blind))
    expect(result.degraded).toBe(true)
    expect(result.contended).toBe(false)
  })
})

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
 * The lockdown verdict (AGL-1501), and above all THE UN-PANIC INVARIANT:
 * a platform-wide lockdown must never lock out the staff who can lift it.
 * The `staff: true` cases below are the proof this brief demanded — if one
 * of them goes red, do not ship the change that did it.
 */

type Doc = Record<string, unknown>

const store = new Map<string, Doc>()
let reads = 0
let failReads = false

const db = {
  collection: (name: string) => ({
    doc: (id: string) => ({
      async get() {
        reads += 1
        if (failReads) throw new Error('firestore unavailable')
        const data = store.get(`${name}/${id}`)
        return {
          exists: data !== undefined,
          data: () => data,
        }
      },
    }),
  }),
}

jest.mock('./firebase-admin', () => ({
  __esModule: true,
  default: {
    app: () => ({ firestore: () => db }),
  },
}))

import {
  featureLockdownRefusal,
  getFeatureLockdown,
  getLockdownVerdict,
  getDomainLockdown,
  getPlatformLockdown,
  getUserLockdown,
  invalidateDomainLockdownCache,
  invalidateFeatureLockdownCache,
  invalidatePlatformLockdownCache,
  invalidateUserLockdownCache,
  lockdownJsonResponse,
  resetTakedownLedger,
  USER_LOCKDOWN_CACHE_MAX,
} from './lockdown'

const NOW = 1_755_000_000_000

beforeEach(() => {
  store.clear()
  reads = 0
  failReads = false
  invalidatePlatformLockdownCache()
  invalidateFeatureLockdownCache()
  invalidateDomainLockdownCache()
  resetTakedownLedger()
  invalidateUserLockdownCache()
})

const lockPlatform = (over: Doc = {}) =>
  store.set('lockdowns/platform', {
    scope: 'platform',
    reason: 'security',
    atMs: NOW,
    actorUid: 'staff-1',
    ...over,
  })

const lockUser = (uid: string, over: Doc = {}) =>
  store.set(`lockdowns/user--${uid}`, {
    scope: 'user',
    reason: 'manual',
    atMs: NOW,
    ...over,
  })

const lockFeature = (feature: string, over: Doc = {}) =>
  store.set(`lockdowns/feature--${feature}`, {
    scope: 'feature',
    feature,
    reason: 'security',
    atMs: NOW,
    ...over,
  })

// AGL-2016: the contact line on these notices is operator configuration, not
// a constant. This is the AGLYN-OPERATED shape — the self-host and
// unconfigured shapes are proved at the source, in
// libs/aglyn/src/lib/app-utils/{lockdown,media-quarantine}.spec.ts.
beforeEach(() => {
  process.env.NEXT_PUBLIC_OPERATOR_NAME = 'Aglyn LLC'
  process.env.NEXT_PUBLIC_OPERATOR_SUPPORT_EMAIL = 'support@aglyn.com'
})
afterEach(() => {
  delete process.env.NEXT_PUBLIC_OPERATOR_NAME
  delete process.env.NEXT_PUBLIC_OPERATOR_SUPPORT_EMAIL
})

describe('THE UN-PANIC INVARIANT: staff bypass every scope, always', () => {
  it('a PLATFORM lockdown leaves a staff caller a null verdict', async () => {
    lockPlatform()
    await expect(
      getLockdownVerdict({ staff: true, uid: 'staff-1', nowMs: NOW }),
    ).resolves.toBeNull()
  })

  it('staff bypass org, host and user scopes too — even all at once', async () => {
    lockPlatform()
    lockUser('staff-1')
    await expect(
      getLockdownVerdict({
        staff: true,
        uid: 'staff-1',
        org: { suspendedAt: { seconds: 1 } },
        host: { suspendedAt: NOW },
        nowMs: NOW,
      }),
    ).resolves.toBeNull()
  })

  it('the staff verdict performs NO reads, so it cannot depend on one failing', async () => {
    lockPlatform()
    failReads = true
    await expect(
      getLockdownVerdict({ staff: true, uid: 'staff-1', nowMs: NOW }),
    ).resolves.toBeNull()
    expect(reads).toBe(0)
  })

  it('...while the same platform lockdown DOES lock a non-staff caller', async () => {
    lockPlatform()
    const verdict = await getLockdownVerdict({
      staff: false,
      uid: 'customer-1',
      nowMs: NOW,
    })
    expect(verdict?.scope).toBe('platform')
    expect(verdict?.reason).toBe('security')
  })
})

describe('scope targeting', () => {
  it('a user lockdown hits only that user', async () => {
    lockUser('bad-actor')
    const locked = await getLockdownVerdict({ uid: 'bad-actor', nowMs: NOW })
    expect(locked?.scope).toBe('user')
    await expect(
      getLockdownVerdict({ uid: 'innocent', nowMs: NOW }),
    ).resolves.toBeNull()
  })

  it('an org lockdown resolves from the passed org doc without a read', async () => {
    const verdict = await getLockdownVerdict({
      org: { suspendedAt: { seconds: 1 }, suspendedReasonCode: 'billing' },
      nowMs: NOW,
    })
    expect(verdict?.scope).toBe('org')
    expect(verdict?.reason).toBe('billing')
  })

  it('platform outranks a narrower scope in the reported verdict', async () => {
    lockPlatform({ reason: 'maintenance' })
    const verdict = await getLockdownVerdict({
      org: { suspendedAt: { seconds: 1 }, suspendedReasonCode: 'billing' },
      nowMs: NOW,
    })
    expect(verdict?.scope).toBe('platform')
    expect(verdict?.reason).toBe('maintenance')
  })

  it('an expired lockdown restores access with no staff action', async () => {
    lockPlatform({ reason: 'maintenance', untilMs: NOW - 1 })
    await expect(getLockdownVerdict({ nowMs: NOW })).resolves.toBeNull()
  })
})

describe('fail-open on infrastructure error', () => {
  it('an unreachable Firestore is an outage, not a lockdown', async () => {
    failReads = true
    await expect(
      getLockdownVerdict({ uid: 'customer-1', nowMs: NOW }),
    ).resolves.toBeNull()
    await expect(getPlatformLockdown()).resolves.toBeNull()
    await expect(getUserLockdown('customer-1')).resolves.toBeNull()
  })
})

/**
 * AGL-1621 — "fail closed for takedown scopes only".
 *
 * The whole feature is two assertions that must BOTH hold: an ordinary lock
 * still releases when Firestore is unreachable, and a takedown-class lock
 * does not. Everything else here defends the DEFAULT, which is the property
 * a future refactor will quietly break: anything not explicitly classified
 * as a takedown fails open, exactly as it does today.
 *
 * Note the shape every case follows — observe the lock through a SUCCESSFUL
 * read first, then fail the reads. That is not test scaffolding, it is the
 * mechanism: the classification lives on the document, so a process that
 * has never read the document has nothing to classify. A case that skipped
 * the first read would be asserting a guarantee this does not make.
 */
describe('AGL-1621 · fail closed for TAKEDOWNS only', () => {
  /** Observe current state through a successful read, then cut Firestore. */
  const observeThenFail = async (read: () => Promise<unknown>) => {
    await read()
    failReads = true
    invalidatePlatformLockdownCache()
    invalidateUserLockdownCache()
    invalidateDomainLockdownCache()
    invalidateFeatureLockdownCache()
  }

  describe('the two assertions the feature reduces to', () => {
    it('an ORDINARY lock FAILS OPEN when Firestore is unreachable', async () => {
      lockPlatform({ reason: 'maintenance' })
      await observeThenFail(getPlatformLockdown)

      await expect(getPlatformLockdown()).resolves.toBeNull()
      await expect(
        getLockdownVerdict({ uid: 'customer-1', nowMs: NOW }),
      ).resolves.toBeNull()
    })

    it('a TAKEDOWN lock HOLDS when Firestore is unreachable', async () => {
      lockPlatform({ reason: 'security', enforcement: 'takedown' })
      await observeThenFail(getPlatformLockdown)

      const held = await getPlatformLockdown()
      expect(held).toMatchObject({ scope: 'platform', enforcement: 'takedown' })
      await expect(
        getLockdownVerdict({ uid: 'customer-1', nowMs: NOW }),
      ).resolves.toMatchObject({ enforcement: 'takedown' })
    })
  })

  describe('the DEFAULT is fail-open — the safety property', () => {
    it('an UNCLASSIFIED lock fails open (every lock written before this field existed)', async () => {
      // Deliberately no `enforcement` key at all: this is byte-for-byte the
      // document shape the panic button has been writing since AGL-1501.
      lockPlatform({ reason: 'security' })
      await observeThenFail(getPlatformLockdown)
      await expect(getPlatformLockdown()).resolves.toBeNull()
    })

    it('a lock classified with an UNREADABLE value fails open, never closed', async () => {
      // The direction that matters: a value this build cannot interpret —
      // an older deploy meeting a class a newer one invented, or simple
      // corruption — must land on the AVAILABLE answer.
      for (const junk of ['TAKEDOWN', 'takedown ', 'legal', true, 1, null, {}]) {
        store.clear()
        invalidatePlatformLockdownCache()
        resetTakedownLedger()
        failReads = false
        lockPlatform({ reason: 'security', enforcement: junk })
        await observeThenFail(getPlatformLockdown)
        await expect(getPlatformLockdown()).resolves.toBeNull()
      }
    })

    it('`security` alone does NOT make a lock fail closed — the class is never inferred', async () => {
      // The specific heuristic this design rejects. Most `security` locks
      // are precautionary holds during an investigation; if `reason` could
      // imply the class, every one of them would fail closed and a
      // Firestore blip would be an outage.
      lockPlatform({ reason: 'security' })
      await observeThenFail(getPlatformLockdown)
      await expect(getPlatformLockdown()).resolves.toBeNull()
    })

    it('a NEVER-OBSERVED takedown fails open — the stated limit of the guarantee', async () => {
      // A cold process has nothing remembered, so it cannot enforce. This
      // is asserted rather than left implicit: someone will eventually read
      // "takedowns fail closed" and assume it covers this. It does not.
      lockPlatform({ reason: 'security', enforcement: 'takedown' })
      failReads = true
      await expect(getPlatformLockdown()).resolves.toBeNull()
    })
  })

  describe('a held takedown still releases', () => {
    it('an EXPIRED takedown stops holding even while Firestore is down', async () => {
      // A dead-man expiry must not become un-liftable by being classified.
      //
      // This case drives the WALL CLOCK rather than the fixture's `NOW`,
      // because the held-takedown expiry check runs on `Date.now()` like
      // every cache in this module — an `untilMs` built from `NOW` (a fixed
      // 2025 constant) is already long past by real time, and the case
      // would pass for the wrong reason.
      const realNow = Date.now()
      const clock = jest.spyOn(Date, 'now').mockReturnValue(realNow)
      try {
        lockPlatform({
          reason: 'security',
          enforcement: 'takedown',
          untilMs: realNow + 60_000,
        })
        await observeThenFail(getPlatformLockdown)

        // Still inside the window: held.
        await expect(
          getLockdownVerdict({ uid: 'customer-1', nowMs: realNow }),
        ).resolves.toMatchObject({ enforcement: 'takedown' })

        // Past the window: released, with no write and no successful read.
        clock.mockReturnValue(realNow + 61_000)
        invalidatePlatformLockdownCache()
        // Asserted at the READER, not only through the verdict:
        // `resolveLockdown` filters expired states on its own, so a verdict
        // of null would stay null even if the ledger held the entry
        // forever. This is the assertion that can actually see the ledger's
        // own expiry check — and the entry being dropped is what stops a
        // long outage from accumulating dead takedowns.
        await expect(getPlatformLockdown()).resolves.toBeNull()
        await expect(
          getLockdownVerdict({ uid: 'customer-1', nowMs: realNow + 61_000 }),
        ).resolves.toBeNull()
      } finally {
        clock.mockRestore()
      }
    })

    it('a LIFT retires the hold — a later outage does not resurrect it', async () => {
      lockPlatform({ reason: 'security', enforcement: 'takedown' })
      await getPlatformLockdown()

      // Staff lift: the doc goes away and the acting process re-reads.
      store.delete('lockdowns/platform')
      invalidatePlatformLockdownCache()
      await expect(getPlatformLockdown()).resolves.toBeNull()

      // Firestore now fails. The takedown was released, so nothing holds.
      failReads = true
      invalidatePlatformLockdownCache()
      await expect(getPlatformLockdown()).resolves.toBeNull()
    })

    it('a takedown DOWNGRADED to an ordinary lock stops holding', async () => {
      lockPlatform({ reason: 'security', enforcement: 'takedown' })
      await getPlatformLockdown()

      lockPlatform({ reason: 'maintenance' })
      invalidatePlatformLockdownCache()
      await getPlatformLockdown()

      failReads = true
      invalidatePlatformLockdownCache()
      await expect(getPlatformLockdown()).resolves.toBeNull()
    })
  })

  describe('every scope this module READS carries the class', () => {
    it('USER: takedown holds, ordinary fails open', async () => {
      lockUser('u-take', { enforcement: 'takedown' })
      lockUser('u-plain')
      await getUserLockdown('u-take')
      await getUserLockdown('u-plain')
      failReads = true
      invalidateUserLockdownCache()

      await expect(getUserLockdown('u-take')).resolves.toMatchObject({
        enforcement: 'takedown',
      })
      await expect(getUserLockdown('u-plain')).resolves.toBeNull()
    })

    it('FEATURE: takedown holds, ordinary fails open', async () => {
      lockFeature('uploads', { enforcement: 'takedown' })
      lockFeature('checkout')
      await getFeatureLockdown('uploads')
      await getFeatureLockdown('checkout')
      failReads = true
      invalidateFeatureLockdownCache()

      await expect(getFeatureLockdown('uploads')).resolves.toMatchObject({
        enforcement: 'takedown',
      })
      await expect(getFeatureLockdown('checkout')).resolves.toBeNull()
    })

    it('DOMAIN: takedown holds, ordinary fails open — the hijack/dispute scope', async () => {
      store.set('lockdowns/domain--seized.example', {
        scope: 'domain',
        reason: 'security',
        enforcement: 'takedown',
        atMs: NOW,
      })
      store.set('lockdowns/domain--ordinary.example', {
        scope: 'domain',
        reason: 'maintenance',
        atMs: NOW,
      })
      await getDomainLockdown('seized.example')
      await getDomainLockdown('ordinary.example')
      failReads = true
      invalidateDomainLockdownCache()

      await expect(getDomainLockdown('seized.example')).resolves.toMatchObject({
        enforcement: 'takedown',
      })
      await expect(getDomainLockdown('ordinary.example')).resolves.toBeNull()
    })

    it('one subject holding does not make another subject hold', async () => {
      lockUser('u-take', { enforcement: 'takedown' })
      await getUserLockdown('u-take')
      await getUserLockdown('u-never-locked')
      failReads = true
      invalidateUserLockdownCache()

      await expect(getUserLockdown('u-take')).resolves.toMatchObject({
        enforcement: 'takedown',
      })
      await expect(getUserLockdown('u-never-locked')).resolves.toBeNull()
    })
  })

  describe('the un-panic invariant is untouched', () => {
    it('staff still bypass a HELD takedown — the operator who must lift it', async () => {
      // If a fail-closed lock could lock out staff, a Firestore incident
      // during a takedown would leave nobody able to release it.
      lockPlatform({ reason: 'security', enforcement: 'takedown' })
      await observeThenFail(getPlatformLockdown)
      await expect(
        getLockdownVerdict({ staff: true, uid: 'staff-1', nowMs: NOW }),
      ).resolves.toBeNull()
    })
  })
})

describe('platform cache', () => {
  it('caches within the TTL and re-reads after invalidation', async () => {
    lockPlatform()
    await getPlatformLockdown()
    const after = reads
    await getPlatformLockdown()
    expect(reads).toBe(after)

    store.delete('lockdowns/platform')
    invalidatePlatformLockdownCache()
    await expect(getPlatformLockdown()).resolves.toBeNull()
    expect(reads).toBe(after + 1)
  })

  it('a malformed platform doc is refused, not guessed at', async () => {
    store.set('lockdowns/platform', { reason: 'not-a-reason' })
    await expect(getPlatformLockdown()).resolves.toBeNull()
  })
})

describe('FEATURE scope (AGL-1510) — one capability off, everything else serving', () => {
  it('a locked feature refuses with the distinct feature 423 body', async () => {
    lockFeature('uploads')
    const refusal = await featureLockdownRefusal({
      feature: 'uploads',
      nowMs: NOW,
    })
    expect(refusal?.status).toBe(423)
    const body = await (refusal as Response).json()
    expect(body).toMatchObject({
      error: 'locked',
      scope: 'feature',
      feature: 'uploads',
      reason: 'security',
    })
  })

  it('NON-INTERFERENCE: an uploads lock leaves every other feature serving', async () => {
    lockFeature('uploads')
    for (const feature of [
      'signups',
      'checkout',
      'marketplace-installs',
      'ai-assist',
    ] as const) {
      await expect(
        featureLockdownRefusal({ feature, nowMs: NOW }),
      ).resolves.toBeNull()
    }
  })

  it('a feature lock implies NOTHING about the scope verdict', async () => {
    lockFeature('uploads')
    lockFeature('checkout')
    // The scope resolver never consults feature docs — org-scoped routes
    // keep serving during a feature lock.
    await expect(
      getLockdownVerdict({ uid: 'customer-1', nowMs: NOW }),
    ).resolves.toBeNull()
  })

  it('a PLATFORM lock implies every feature — composition, not ranking', async () => {
    lockPlatform({ reason: 'maintenance' })
    for (const feature of ['signups', 'uploads', 'checkout'] as const) {
      const refusal = await featureLockdownRefusal({ feature, nowMs: NOW })
      expect(refusal?.status).toBe(423)
      expect((await (refusal as Response).json()).scope).toBe('platform')
    }
    // The platform-scope staff bypass is UNCHANGED — even on checkout,
    // whose feature-stage bypass is withheld.
    await expect(
      featureLockdownRefusal({ feature: 'checkout', staff: true, nowMs: NOW }),
    ).resolves.toBeNull()
  })

  it('staff bypass EXACTLY where designed: uploads/installs/ai yes, checkout NO', async () => {
    for (const feature of [
      'uploads',
      'marketplace-installs',
      'ai-assist',
    ] as const) {
      lockFeature(feature)
      invalidateFeatureLockdownCache()
      // Staff verify the fix through the lock…
      await expect(
        featureLockdownRefusal({ feature, staff: true, nowMs: NOW }),
      ).resolves.toBeNull()
      // …customers wait for the lift.
      const refusal = await featureLockdownRefusal({ feature, nowMs: NOW })
      expect(refusal?.status).toBe(423)
    }
    // A staff checkout session is still a real charge — no bypass.
    lockFeature('checkout')
    invalidateFeatureLockdownCache()
    const refusal = await featureLockdownRefusal({
      feature: 'checkout',
      staff: true,
      nowMs: NOW,
    })
    expect(refusal?.status).toBe(423)
    expect((await (refusal as Response).json()).feature).toBe('checkout')
  })

  it('EXPIRY restores the feature with no staff action and NO write', async () => {
    lockFeature('signups', { untilMs: NOW + 60_000 })
    expect(
      (await featureLockdownRefusal({ feature: 'signups', nowMs: NOW }))?.status,
    ).toBe(423)
    invalidateFeatureLockdownCache()
    await expect(
      featureLockdownRefusal({ feature: 'signups', nowMs: NOW + 60_001 }),
    ).resolves.toBeNull()
    // The doc is still there — nothing wrote; the expiry alone restored it.
    expect(store.has('lockdowns/feature--signups')).toBe(true)
  })

  it('a malformed feature doc is refused, not guessed at', async () => {
    store.set('lockdowns/feature--uploads', {
      scope: 'feature',
      feature: 'not-a-real-feature',
      reason: 'security',
    })
    await expect(getFeatureLockdown('uploads')).resolves.toBeNull()
  })

  it('fails open on an unreachable Firestore — an outage is not a lockdown', async () => {
    failReads = true
    await expect(getFeatureLockdown('uploads')).resolves.toBeNull()
    await expect(
      featureLockdownRefusal({ feature: 'uploads', nowMs: NOW }),
    ).resolves.toBeNull()
  })

  it('caches within the TTL and re-reads after invalidation', async () => {
    lockFeature('uploads')
    await getFeatureLockdown('uploads')
    const after = reads
    await getFeatureLockdown('uploads')
    expect(reads).toBe(after)

    store.delete('lockdowns/feature--uploads')
    invalidateFeatureLockdownCache()
    await expect(getFeatureLockdown('uploads')).resolves.toBeNull()
    expect(reads).toBe(after + 1)
  })
})

describe('USER cache (AGL-1522) — one read per uid per TTL window, not one per call', () => {
  it('N session verifications within the TTL cost ONE user read (+1 platform), and every one still refuses the locked user', async () => {
    lockUser('bad-actor')
    for (let i = 0; i < 20; i++) {
      const verdict = await getLockdownVerdict({
        uid: 'bad-actor',
        nowMs: NOW,
      })
      // The refusal survives the cache: every verification refuses, not
      // just the one that paid the read.
      expect(verdict?.scope).toBe('user')
    }
    // 1 × `lockdowns/platform` + 1 × `lockdowns/user--bad-actor`. The
    // uncached shape measured 21 here (one user read per call).
    expect(reads).toBe(2)
  })

  it('concurrent verifications of one uid coalesce into ONE in-flight read', async () => {
    lockUser('bad-actor')
    const results = await Promise.all([
      getUserLockdown('bad-actor'),
      getUserLockdown('bad-actor'),
      getUserLockdown('bad-actor'),
    ])
    expect(reads).toBe(1)
    for (const state of results) expect(state?.scope).toBe('user')
  })

  it('the cache EXPIRES — the staleness bound is the TTL, not forever', async () => {
    // The plant this spec exists to catch: a cache that never expires makes
    // the staleness unbounded, and a freshly locked user's other-process
    // sessions would never see the lock at all.
    const spy = jest.spyOn(Date, 'now')
    try {
      spy.mockReturnValue(NOW)
      // Not locked yet — the null verdict is what gets cached.
      await expect(getUserLockdown('u1')).resolves.toBeNull()
      lockUser('u1')
      // INSIDE the window the stale null still serves, with no read: this is
      // the documented ≤15s bound, pinned as intentional. 15_000 is written
      // out on purpose — WIDENING the TTL loosens the documented staleness
      // bound and should turn this spec red too.
      spy.mockReturnValue(NOW + 15_000 - 1)
      await expect(getUserLockdown('u1')).resolves.toBeNull()
      expect(reads).toBe(1)
      // AT the boundary the entry is dead: the lock is visible.
      spy.mockReturnValue(NOW + 15_000)
      const state = await getUserLockdown('u1')
      expect(reads).toBe(2)
      expect(state?.scope).toBe('user')
    } finally {
      spy.mockRestore()
    }
  })

  it('invalidation after the admin write collapses staleness to the write moment', async () => {
    // What /api/admin/lockdown does after a user lock/unlock: the acting
    // process refuses immediately instead of waiting out the TTL.
    await expect(getUserLockdown('u1')).resolves.toBeNull()
    lockUser('u1')
    invalidateUserLockdownCache('u1')
    const state = await getUserLockdown('u1')
    expect(state?.scope).toBe('user')
    // …and the UNLOCK direction readmits just as immediately.
    store.delete('lockdowns/user--u1')
    invalidateUserLockdownCache('u1')
    await expect(getUserLockdown('u1')).resolves.toBeNull()
  })

  it('invalidating one uid leaves every other entry cached', async () => {
    await getUserLockdown('u1')
    await getUserLockdown('u2')
    const before = reads
    invalidateUserLockdownCache('u1')
    await getUserLockdown('u2')
    expect(reads).toBe(before)
    await getUserLockdown('u1')
    expect(reads).toBe(before + 1)
  })

  it('an EXPIRED user lock restores access even when served from the cache', async () => {
    lockUser('u1', { untilMs: NOW + 60_000 })
    const during = await getLockdownVerdict({ uid: 'u1', nowMs: NOW })
    expect(during?.scope).toBe('user')
    const after = reads
    // Same cached state, later nowMs: activity is evaluated per call, so
    // expiry needs neither a staff action nor a fresh read.
    await expect(
      getLockdownVerdict({ uid: 'u1', nowMs: NOW + 60_001 }),
    ).resolves.toBeNull()
    expect(reads).toBe(after)
  })

  it('staff verdicts still perform NO reads and warm NO cache', async () => {
    lockUser('staff-1')
    await expect(
      getLockdownVerdict({ staff: true, uid: 'staff-1', nowMs: NOW }),
    ).resolves.toBeNull()
    expect(reads).toBe(0)
  })

  it('the LRU bound holds: a uid scan cannot balloon the cache, and evicts oldest-first', async () => {
    await getUserLockdown('first')
    for (let i = 0; i < USER_LOCKDOWN_CACHE_MAX; i += 1) {
      await getUserLockdown(`scan-${i}`)
    }
    const before = reads
    // 'first' was the least recently used entry — evicted, so it re-reads…
    await getUserLockdown('first')
    expect(reads).toBe(before + 1)
    // …while the scan's most recent uid is still cached.
    await getUserLockdown(`scan-${USER_LOCKDOWN_CACHE_MAX - 1}`)
    expect(reads).toBe(before + 1)
  })
})

describe('lockdownJsonResponse — the distinct API refusal', () => {
  it('returns 423 with the sanitized machine-readable body', async () => {
    const response = lockdownJsonResponse({
      scope: 'org',
      reason: 'billing',
      atMs: NOW,
      actorUid: 'staff-1',
    })
    expect(response.status).toBe(423)
    expect(response.headers.get('Cache-Control')).toBe('no-store')
    const body = await response.json()
    expect(body.error).toBe('locked')
    expect(body.scope).toBe('org')
    expect(body.reason).toBe('billing')
    expect(body.contact).toBe('support@aglyn.com')
    // Never the staff actor or internal rationale.
    expect(JSON.stringify(body)).not.toContain('staff-1')
  })

  it('a maintenance window carries Retry-After', () => {
    const response = lockdownJsonResponse({
      scope: 'platform',
      reason: 'maintenance',
      untilMs: Date.now() + 600_000,
    })
    const retryAfter = Number(response.headers.get('Retry-After'))
    expect(retryAfter).toBeGreaterThanOrEqual(60)
    expect(retryAfter).toBeLessThanOrEqual(600)
  })
})

/**
 * READ-ONLY mode at the verdict (AGL-1511). Two properties matter more than
 * the rest and both are asserted directly rather than inferred from a green
 * suite: a WRITE is still refused, and STAFF are still never refused.
 */
describe('AGL-1511 · read-only discrimination', () => {
  const readOnlyOrg = {
    suspendedAt: { seconds: 1 },
    suspendedReasonCode: 'maintenance',
    suspendedMode: 'read-only',
  }

  it('refuses a write and passes a read on the same org', async () => {
    expect(
      await getLockdownVerdict({
        uid: 'u1',
        org: readOnlyOrg,
        intent: 'write',
        nowMs: NOW,
      }),
    ).not.toBeNull()
    expect(
      await getLockdownVerdict({
        uid: 'u1',
        org: readOnlyOrg,
        intent: 'read',
        nowMs: NOW,
      }),
    ).toBeNull()
  })

  it('derives the intent from the request method when given one', async () => {
    for (const method of ['GET', 'HEAD', 'OPTIONS']) {
      expect(
        await getLockdownVerdict({
          uid: 'u1',
          org: readOnlyOrg,
          request: { method },
          nowMs: NOW,
        }),
      ).toBeNull()
    }
    for (const method of ['POST', 'PATCH', 'DELETE']) {
      expect(
        await getLockdownVerdict({
          uid: 'u1',
          org: readOnlyOrg,
          request: { method },
          nowMs: NOW,
        }),
      ).not.toBeNull()
    }
  })

  it('refuses when NEITHER request nor intent was declared — the fail-safe', async () => {
    // A chokepoint that forgot to say what it was doing must refuse during a
    // migration, not wave the write through. This assertion is the whole
    // reason the default is `write` and not `read`.
    expect(
      await getLockdownVerdict({ uid: 'u1', org: readOnlyOrg, nowMs: NOW }),
    ).not.toBeNull()
  })

  it('a FULL lock still refuses reads — read-only changed nothing for it', async () => {
    expect(
      await getLockdownVerdict({
        uid: 'u1',
        org: { suspendedAt: { seconds: 1 } },
        intent: 'read',
        nowMs: NOW,
      }),
    ).not.toBeNull()
  })

  it('STAFF WRITES BYPASS READ-ONLY, with zero Firestore reads', async () => {
    // The un-panic invariant's read-only half, and the entire point of the
    // mode: staff perform the maintenance while the world reads. Asserted
    // with the read counter because a bypass that depended on a read
    // succeeding would not be one.
    lockPlatform({ mode: 'read-only', reason: 'maintenance' })
    const before = reads
    expect(
      await getLockdownVerdict({
        staff: true,
        uid: 'u1',
        org: readOnlyOrg,
        intent: 'write',
        nowMs: NOW,
      }),
    ).toBeNull()
    expect(reads).toBe(before)
  })

  it('a wider read-only platform lock never softens a full org lock', async () => {
    lockPlatform({ mode: 'read-only', reason: 'maintenance' })
    const state = await getLockdownVerdict({
      uid: 'u1',
      org: { suspendedAt: { seconds: 1 }, suspendedReasonCode: 'security' },
      intent: 'read',
      nowMs: NOW,
    })
    // The org's FULL security takedown is what answers, so the read is
    // refused — the platform's gentler window does not readmit anyone.
    expect(state?.scope).toBe('org')
    expect(state?.reason).toBe('security')
  })

  it('puts the mode on the wire and lets a caller substitute visitor copy', async () => {
    const state = await getLockdownVerdict({
      org: readOnlyOrg,
      intent: 'write',
      nowMs: NOW,
    })
    const body = await lockdownJsonResponse(state as never).json()
    expect(body.mode).toBe('read-only')
    expect(body.title).toBe('Changes are temporarily paused')
    // Same wire shape, other words — the tenant's visitor pause.
    const visitor = await lockdownJsonResponse(state as never, {
      notice: { title: 'Temporarily paused', body: 'Try again shortly.' },
    }).json()
    expect(visitor.error).toBe('locked')
    expect(visitor.mode).toBe('read-only')
    expect(visitor.title).toBe('Temporarily paused')
    expect(visitor.message).toBe('Try again shortly.')
  })

  it('omits `mode` entirely from a full lock’s body', async () => {
    const state = await getLockdownVerdict({
      org: { suspendedAt: { seconds: 1 } },
      intent: 'write',
      nowMs: NOW,
    })
    const body = await lockdownJsonResponse(state as never).json()
    expect('mode' in body).toBe(false)
  })
})

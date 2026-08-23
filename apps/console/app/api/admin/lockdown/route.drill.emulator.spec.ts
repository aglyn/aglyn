/**
 * @jest-environment node
 */

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
 * THE PANIC-BUTTON DRILL (AGL-1621), layer 1: the reader convergence.
 *
 * The launch-day runbook's rollback step quotes propagation numbers that
 * were measured once, by hand, on a build three promotions old. Numbers
 * obtained that way rot silently and cannot be re-obtained under pressure,
 * so this file replaces the hand-drill with a REPEATABLE one: it drives the
 * REAL panic-button route against a REAL Firestore, with a REAL wall clock,
 * and prints the measured figures the runbook should quote.
 *
 * ## What is actually being measured, and why it is not "the drill"
 *
 * Tenant propagation is TWO cache layers in series, and only the first one
 * is measurable here:
 *
 *   layer 1 — the verdict READER's in-process cache. `PLATFORM_TTL_MS` in
 *             libs/tenant/data/admin/src/lib/server/lockdown.ts, shared by
 *             the platform, feature, user and domain readers. THIS FILE.
 *   layer 2 — the tenant middleware's per-isolate memo of the verdict route
 *             (`LOCKDOWN_VERDICT_TTL_MS`, apps/tenant/middleware.ts).
 *             Measured by apps/tenant/specs/lockdown-middleware-propagation.
 *
 * They compose. Neither file may quote its own number as the propagation of
 * the system; the runbook quotes the sum, and says so.
 *
 * ## The measurement method, stated so it can be repeated
 *
 * The lock is written to Firestore DIRECTLY, not through the route, for the
 * two "other process" measurements. That is not a shortcut — it is the only
 * faithful model of production. The console and the tenant are separate
 * Vercel deployments in separate processes, so the tenant NEVER receives the
 * console's `invalidatePlatformLockdownCache()` call. A measurement taken
 * through the route in this process would observe the acting process's
 * invalidation and report ~0ms, which is the one number the operator will
 * never experience. Both are reported: the acting process's (immediate) and
 * every other process's (TTL-bounded), because they are different facts.
 *
 * Resolution is the poll interval (POLL_MS). Figures are floors, not
 * ceilings: the emulator's Firestore round trip is faster than production's,
 * so the TTL dominates here even more cleanly than it does live.
 *
 * ## Running it
 *
 *   npm run firebase:emulate      # auth 9099, firestore 8082
 *   npm run seed:e2e
 *   FIRESTORE_EMULATOR_HOST=localhost:8082 \
 *   FIREBASE_AUTH_EMULATOR_HOST=localhost:9099 \
 *     npx jest -c apps/console/jest.config.ts \
 *       --testPathPatterns route.drill.emulator --runInBand
 *
 * Skipped unless both emulator hosts are set, so a normal `jest` run is
 * unaffected and this can never reach production. It is deliberately slow —
 * it spends real seconds waiting for real TTLs, because that IS the
 * measurement.
 */

import { request as httpRequest } from 'node:http'
import * as admin from '@aglyn/tenant-data-admin'
import { getApps, initializeApp } from 'firebase-admin/app'
import { getAuth } from 'firebase-admin/auth'
import { getFirestore, type Firestore } from 'firebase-admin/firestore'

const EMULATED =
  Boolean(process.env.FIRESTORE_EMULATOR_HOST) &&
  Boolean(process.env.FIREBASE_AUTH_EMULATOR_HOST)

const SUPER_UID = 'lockdown-drill-super'
const SUPER_EMAIL = 'lockdown-drill-super@aglyn.test'
const SUPPORT_UID = 'lockdown-drill-support'
const SUPPORT_EMAIL = 'lockdown-drill-support@aglyn.test'
const PLAIN_UID = 'lockdown-drill-plain'
const PLAIN_EMAIL = 'lockdown-drill-plain@aglyn.test'
const PASSWORD = 'E2e-Password-1'

/** Poll cadence for every convergence measurement; also its resolution. */
const POLL_MS = 250
/** Ceiling on a single convergence wait. Well past PLATFORM_TTL_MS (15s). */
const CONVERGE_TIMEOUT_MS = 40_000

if (EMULATED && !getApps().length) {
  initializeApp({ projectId: 'aglyn-main' })
}

const describeEmulated = EMULATED ? describe : describe.skip

/** Everything measured, printed as one table at the end of the run. */
const measurements: Array<{
  what: string
  direction: 'lock' | 'lift'
  ms: number
  note: string
}> = []

function record(
  what: string,
  direction: 'lock' | 'lift',
  ms: number,
  note: string,
): void {
  measurements.push({ what, direction, ms, note })
}

describeEmulated('lockdown panic-button drill (emulator)', () => {
  let db: Firestore
  let route: {
    GET: (request: Request) => Promise<Response>
    POST: (request: Request) => Promise<Response>
  }
  let superToken: string
  let supportToken: string
  let plainToken: string

  beforeAll(async () => {
    db = getFirestore()
    const auth = getAuth()
    for (const [uid, email, claims] of [
      [SUPER_UID, SUPER_EMAIL, { staff: true, staffRole: 'super' }],
      [SUPPORT_UID, SUPPORT_EMAIL, { staff: true, staffRole: 'support' }],
      [PLAIN_UID, PLAIN_EMAIL, {}],
    ] as const) {
      try {
        await auth.getUser(uid)
      } catch {
        await auth.createUser({
          uid,
          email,
          password: PASSWORD,
          emailVerified: true,
        })
      }
      await auth.setCustomUserClaims(uid, claims as object)
      // Start from a known state. A previous run that failed midway through
      // the user-scope case leaves its subject DISABLED, and the next run
      // then dies at sign-in with `USER_DISABLED` — a drill that cannot be
      // re-run after it fails is not a drill anybody will re-run.
      await auth.updateUser(uid, { disabled: false })
    }
    superToken = await mintIdToken(SUPER_EMAIL)
    supportToken = await mintIdToken(SUPPORT_EMAIL)
    plainToken = await mintIdToken(PLAIN_EMAIL)
    route = (await import('./route')) as typeof route
    await clearAllDrillState(db)
  }, 120_000)

  afterAll(async () => {
    await clearAllDrillState(db)
    if (measurements.length) {
      console.log(
        '\nAGL-1621 LAYER-1 MEASUREMENTS (verdict reader, real Firestore)\n' +
          measurements
            .map(
              (m) =>
                `  ${m.direction.toUpperCase().padEnd(4)} ${m.what.padEnd(38)}` +
                `${String(m.ms).padStart(6)}ms  ${m.note}`,
            )
            .join('\n') +
          `\n  (resolution ±${POLL_MS}ms; layer 2 is the tenant middleware ` +
          `memo, measured separately)\n`,
      )
    }
  }, 60_000)

  // ---------------------------------------------------------------- scopes

  it('accepts exactly the six scopes the resolver has', async () => {
    // The runbook must name the same set the operator will see on the page.
    // Asserted through the ROUTE, not by reading the union type: a scope the
    // type allows but the writer rejects is not a scope you can press.
    const accepted: string[] = []
    for (const scope of [
      'platform',
      'org',
      'host',
      'domain',
      'user',
      'feature',
      'asset',
      'nonsense',
    ]) {
      const response = await route.GET(
        new Request(
          `http://localhost/api/admin/lockdown?scope=${scope}&targetId=x`,
          { headers: { authorization: `Bearer ${superToken}` } },
        ),
      )
      const body = (await response.json()) as { error?: string }
      if (!(response.status === 400 && body.error === 'Unknown scope')) {
        accepted.push(scope)
      }
    }
    expect(accepted.sort()).toEqual([
      'domain',
      'feature',
      'host',
      'org',
      'platform',
      'user',
    ])
  }, 60_000)

  // ------------------------------------------------------- negative controls

  it('refuses a non-staff caller, and a staff caller who is not super', async () => {
    const forPlain = await post(route, plainToken, {
      action: 'lock',
      scope: 'feature',
      targetId: 'signups',
      reason: 'drill',
    })
    expect(forPlain.status).toBe(403)

    const forSupport = await post(route, supportToken, {
      action: 'lock',
      scope: 'feature',
      targetId: 'signups',
      reason: 'drill',
    })
    expect(forSupport.status).toBe(403)
    expect((forSupport.body as { error: string }).error).toMatch(/super/i)

    // ...and nothing was written by either refusal.
    expect(await lockExists(db, 'feature--signups')).toBe(false)
  }, 60_000)

  it('refuses a platform lock without the type-to-confirm phrase', async () => {
    const wrong = await post(route, superToken, {
      action: 'lock',
      scope: 'platform',
      reason: 'drill',
      confirm: 'lock platform',
    })
    expect(wrong.status).toBe(400)
    expect(await lockExists(db, 'platform')).toBe(false)
  }, 60_000)

  // --------------------------------------------------- platform round trip

  it('platform: normal -> locked -> normal, with both propagation numbers', async () => {
    // ---- 1. NORMAL. Prove the un-locked state before locking anything;
    // a drill that only ever observes the locked state proves half of it.
    admin.invalidatePlatformLockdownCache()
    expect(await admin.getPlatformLockdown()).toBeNull()
    expect(
      await admin.getLockdownVerdict({ uid: 'visitor-uid' }),
    ).toBeNull()

    // ---- 2. LOCK, through the real route, and time the button press.
    const pressedAt = Date.now()
    const locked = await post(route, superToken, {
      action: 'lock',
      scope: 'platform',
      reason: 'security',
      message: 'AGL-1621 drill',
      confirm: 'LOCK PLATFORM',
    })
    const pressMs = Date.now() - pressedAt
    expect(locked.status).toBe(200)

    // AGL-1571: the route states a VERIFIED post-condition rather than
    // letting the console assume the click landed.
    const body = locked.body as {
      verified: { locked: boolean; reason: string | null }
      confirmed: boolean
    }
    expect(body.verified.locked).toBe(true)
    expect(body.confirmed).toBe(true)
    record('button press -> durable + verified', 'lock', pressMs, 'route POST')

    // ---- 3. The ACTING process refuses immediately: the route invalidated
    // its own cache, and this spec shares that process.
    const actingAt = Date.now()
    expect(await admin.getPlatformLockdown()).not.toBeNull()
    record(
      'acting process (console) sees lock',
      'lock',
      Date.now() - actingAt,
      'route invalidates its own cache',
    )

    // ---- 4. EVERY OTHER process converges on the TTL. Model it honestly:
    // prime a cache with the CURRENT state, then change Firestore behind it
    // without invalidating — which is exactly what the tenant deployment
    // experiences, since it never hears about the console's write.
    await clearAllDrillState(db)
    admin.invalidatePlatformLockdownCache()
    expect(await admin.getPlatformLockdown()).toBeNull() // primed "unlocked"

    const writtenAt = Date.now()
    await writeLockDirect(db, 'platform', { reason: 'security' })
    const lockConverge = await convergeMs(
      async () => (await admin.getPlatformLockdown()) !== null,
      writtenAt,
    )
    record(
      'other process (tenant) sees lock',
      'lock',
      lockConverge,
      'PLATFORM_TTL_MS, no invalidation',
    )
    expect(lockConverge).toBeLessThan(CONVERGE_TIMEOUT_MS)

    // ---- 5. THE LIFT, measured the same way and in the same direction of
    // honesty. A panic button nobody can prove they can release is not one
    // anybody will press.
    const liftedAt = Date.now()
    await deleteLockDirect(db, 'platform')
    const liftConverge = await convergeMs(
      async () => (await admin.getPlatformLockdown()) === null,
      liftedAt,
    )
    record(
      'other process (tenant) sees lift',
      'lift',
      liftConverge,
      'PLATFORM_TTL_MS, no invalidation',
    )

    // ---- 6. BACK TO NORMAL, asserted the same way it was asserted in (1).
    expect(await admin.getPlatformLockdown()).toBeNull()
    expect(await admin.getLockdownVerdict({ uid: 'visitor-uid' })).toBeNull()
  }, 180_000)

  it('platform: the lift is verified by the route, not assumed', async () => {
    await post(route, superToken, {
      action: 'lock',
      scope: 'platform',
      reason: 'security',
      confirm: 'LOCK PLATFORM',
    })
    const unpressedAt = Date.now()
    const lifted = await post(route, superToken, {
      action: 'unlock',
      scope: 'platform',
    })
    const liftPressMs = Date.now() - unpressedAt
    expect(lifted.status).toBe(200)
    const body = lifted.body as {
      verified: { locked: boolean }
      confirmed: boolean
    }
    // The AGL-1571 failure mode: believing a lock is lifted when it is not.
    expect(body.verified.locked).toBe(false)
    expect(body.confirmed).toBe(true)
    expect(await lockExists(db, 'platform')).toBe(false)
    record('button press -> lifted + verified', 'lift', liftPressMs, 'route POST')
  }, 120_000)

  it('platform: a verified staff claim bypasses the lock (the un-panic invariant)', async () => {
    await post(route, superToken, {
      action: 'lock',
      scope: 'platform',
      reason: 'security',
      confirm: 'LOCK PLATFORM',
    })
    expect(await admin.getLockdownVerdict({ staff: true })).toBeNull()
    expect(await admin.getLockdownVerdict({ staff: false })).not.toBeNull()
    // ...and the operator can still reach the button that lifts it.
    const lifted = await post(route, superToken, {
      action: 'unlock',
      scope: 'platform',
    })
    expect(lifted.status).toBe(200)
  }, 120_000)

  // ---------------------------------------------------- feature round trip

  it('feature: kills one capability, leaves the others serving', async () => {
    await clearAllDrillState(db)
    admin.invalidateFeatureLockdownCache()
    admin.invalidatePlatformLockdownCache()

    // NORMAL first, at every key.
    for (const key of [
      'signups',
      'uploads',
      'checkout',
      'marketplace-installs',
      'ai-assist',
    ] as const) {
      expect(await admin.featureLockdownRefusal({ feature: key })).toBeNull()
    }

    const locked = await post(route, superToken, {
      action: 'lock',
      scope: 'feature',
      targetId: 'checkout',
      reason: 'billing',
      message: 'AGL-1621 drill',
    })
    expect(locked.status).toBe(200)
    expect((locked.body as { confirmed: boolean }).confirmed).toBe(true)

    // The locked capability refuses with the distinct 423...
    const refusal = await admin.featureLockdownRefusal({ feature: 'checkout' })
    expect(refusal).not.toBeNull()
    expect(refusal?.status).toBe(423)
    // `Retry-After` is emitted ONLY when the lock carries an expiry. A lock
    // armed without one refuses with no hint of when to come back — which is
    // a second, quieter reason the runbook tells the operator to set the
    // dead-man expiry, beyond the lock releasing itself.
    expect(refusal?.headers.get('retry-after')).toBeNull()
    await post(route, superToken, {
      action: 'lock',
      scope: 'feature',
      targetId: 'checkout',
      reason: 'billing',
      untilMs: Date.now() + 30 * 60_000,
    })
    const withExpiry = await admin.featureLockdownRefusal({
      feature: 'checkout',
    })
    expect(Number(withExpiry?.headers.get('retry-after'))).toBeGreaterThan(0)

    // ...while everything else is untouched. This is the property that makes
    // FEATURE the right first reach in the runbook.
    for (const key of ['signups', 'uploads', 'ai-assist'] as const) {
      expect(await admin.featureLockdownRefusal({ feature: key })).toBeNull()
    }

    // The per-feature staff bypass matrix, as shipped: withheld on checkout
    // (a staff checkout session is a real charge), granted on uploads.
    expect(
      await admin.featureLockdownRefusal({ feature: 'checkout', staff: true }),
    ).not.toBeNull()
    await post(route, superToken, {
      action: 'lock',
      scope: 'feature',
      targetId: 'uploads',
      reason: 'security',
    })
    expect(
      await admin.featureLockdownRefusal({ feature: 'uploads', staff: true }),
    ).toBeNull()

    // LIFT both, and prove NORMAL again.
    for (const key of ['checkout', 'uploads'] as const) {
      const lifted = await post(route, superToken, {
        action: 'unlock',
        scope: 'feature',
        targetId: key,
      })
      expect(lifted.status).toBe(200)
      expect((lifted.body as { confirmed: boolean }).confirmed).toBe(true)
    }
    admin.invalidateFeatureLockdownCache()
    for (const key of ['checkout', 'uploads'] as const) {
      expect(await admin.featureLockdownRefusal({ feature: key })).toBeNull()
    }
  }, 180_000)

  it('feature: a platform lock implies every feature (composition, not ranking)', async () => {
    await clearAllDrillState(db)
    admin.invalidateFeatureLockdownCache()
    admin.invalidatePlatformLockdownCache()
    await post(route, superToken, {
      action: 'lock',
      scope: 'platform',
      reason: 'security',
      confirm: 'LOCK PLATFORM',
    })
    for (const key of ['signups', 'checkout', 'ai-assist'] as const) {
      expect(
        await admin.featureLockdownRefusal({ feature: key }),
      ).not.toBeNull()
    }
    await post(route, superToken, { action: 'unlock', scope: 'platform' })
  }, 120_000)

  it('feature: other processes converge on the same TTL as platform', async () => {
    await clearAllDrillState(db)
    admin.invalidateFeatureLockdownCache()
    admin.invalidatePlatformLockdownCache()
    expect(await admin.getFeatureLockdown('signups')).toBeNull() // primed

    const writtenAt = Date.now()
    // NOTE the `feature` field. `normalizeLockdownDoc` refuses a feature doc
    // whose key is absent or not in the enum, WHOLE — so a hand-written
    // feature lock that omits it is a doc that exists in Firestore and
    // enforces nothing. Worth knowing before someone writes one by hand
    // during an incident because the console is the thing that is down.
    await writeLockDirect(db, 'feature--signups', {
      reason: 'security',
      feature: 'signups',
    })
    const converge = await convergeMs(
      async () => (await admin.getFeatureLockdown('signups')) !== null,
      writtenAt,
    )
    record(
      'other process sees FEATURE lock',
      'lock',
      converge,
      'PLATFORM_TTL_MS, shared by all four doc scopes',
    )
    await deleteLockDirect(db, 'feature--signups')
  }, 120_000)

  // ------------------------------------------------------- org/host/domain

  it('org and host: the lock rides the shipped suspendedAt carrier', async () => {
    await clearAllDrillState(db)
    const orgId = await anyDocId(db, 'orgs')
    const hostId = await anyDocId(db, 'hosts')

    // NORMAL: the verdict is null for a caller in an unsuspended org.
    const orgBefore = await readDoc(db, 'orgs', orgId)
    expect(await admin.getLockdownVerdict({ org: orgBefore })).toBeNull()

    const locked = await post(route, superToken, {
      action: 'lock',
      scope: 'org',
      targetId: orgId,
      reason: 'manual',
      message: 'AGL-1621 drill',
    })
    expect(locked.status).toBe(200)
    expect((locked.body as { confirmed: boolean }).confirmed).toBe(true)

    // The carrier is the AGL-202 field every shipped reader already honours,
    // not a second parallel flag.
    const orgAfter = await readDoc(db, 'orgs', orgId)
    expect(orgAfter?.['suspendedAt']).toBeTruthy()
    expect(await admin.getLockdownVerdict({ org: orgAfter })).not.toBeNull()
    // Org/host carry no reader cache: the caller hands in the doc it already
    // loaded, so these two scopes propagate at the caller's own read.
    expect(await admin.getLockdownVerdict({ org: orgAfter, staff: true }))
      .toBeNull()

    const hostLocked = await post(route, superToken, {
      action: 'lock',
      scope: 'host',
      targetId: hostId,
      reason: 'manual',
    })
    expect(hostLocked.status).toBe(200)
    const hostAfter = await readDoc(db, 'hosts', hostId)
    expect(hostAfter?.['suspendedAt']).toBeTruthy()
    // NOT the customer-writable maintenance switch.
    expect(hostAfter?.['maintenance']).not.toBe(true)

    // LIFT both and prove the carrier is genuinely cleared.
    for (const [scope, targetId, collection] of [
      ['org', orgId, 'orgs'],
      ['host', hostId, 'hosts'],
    ] as const) {
      const lifted = await post(route, superToken, {
        action: 'unlock',
        scope,
        targetId,
      })
      expect(lifted.status).toBe(200)
      expect((lifted.body as { confirmed: boolean }).confirmed).toBe(true)
      const after = await readDoc(db, collection, targetId)
      expect(after?.['suspendedAt'] ?? null).toBeNull()
    }
    expect(
      await admin.getLockdownVerdict({
        org: await readDoc(db, 'orgs', orgId),
      }),
    ).toBeNull()
  }, 180_000)

  it('domain: locks one name without taking the site down', async () => {
    await clearAllDrillState(db)
    admin.invalidateDomainLockdownCache()
    const name = 'drill.example.com'
    expect(await admin.getDomainLockdown(name)).toBeNull()

    const locked = await post(route, superToken, {
      action: 'lock',
      scope: 'domain',
      targetId: name,
      reason: 'security',
    })
    expect(locked.status).toBe(200)
    expect((locked.body as { confirmed: boolean }).confirmed).toBe(true)
    admin.invalidateDomainLockdownCache()
    expect(await admin.getDomainLockdown(name)).not.toBeNull()
    // Keyed on the NAME: case and padding must not open a hole.
    expect(await admin.getDomainLockdown(`  ${name.toUpperCase()} `))
      .not.toBeNull()

    const lifted = await post(route, superToken, {
      action: 'unlock',
      scope: 'domain',
      targetId: name,
    })
    expect(lifted.status).toBe(200)
    admin.invalidateDomainLockdownCache()
    expect(await admin.getDomainLockdown(name)).toBeNull()
  }, 120_000)

  // ------------------------------------------------------------------ user

  it('user: disables the account and revokes refresh tokens, and undoes both', async () => {
    await clearAllDrillState(db)
    const auth = getAuth()
    const before = await auth.getUser(PLAIN_UID)
    expect(before.disabled).toBe(false)
    admin.invalidateUserLockdownCache()
    expect(await admin.getUserLockdown(PLAIN_UID)).toBeNull()

    const locked = await post(route, superToken, {
      action: 'lock',
      scope: 'user',
      targetId: PLAIN_UID,
      reason: 'manual',
    })
    expect(locked.status).toBe(200)
    expect((locked.body as { confirmed: boolean }).confirmed).toBe(true)
    expect((await auth.getUser(PLAIN_UID)).disabled).toBe(true)
    expect(await admin.getUserLockdown(PLAIN_UID)).not.toBeNull()
    expect(
      await admin.getLockdownVerdict({ uid: PLAIN_UID }),
    ).not.toBeNull()
    // The un-panic invariant, at the user scope too.
    expect(
      await admin.getLockdownVerdict({ uid: PLAIN_UID, staff: true }),
    ).toBeNull()

    // An operator may not lock themselves out by their own uid.
    const selfLock = await post(route, superToken, {
      action: 'lock',
      scope: 'user',
      targetId: SUPER_UID,
      reason: 'manual',
    })
    expect(selfLock.status).toBeGreaterThanOrEqual(400)

    const lifted = await post(route, superToken, {
      action: 'unlock',
      scope: 'user',
      targetId: PLAIN_UID,
    })
    expect(lifted.status).toBe(200)
    expect((lifted.body as { confirmed: boolean }).confirmed).toBe(true)
    expect((await auth.getUser(PLAIN_UID)).disabled).toBe(false)
    expect(await admin.getUserLockdown(PLAIN_UID)).toBeNull()
    expect(await admin.getLockdownVerdict({ uid: PLAIN_UID })).toBeNull()
  }, 180_000)

  // ------------------------------------------------------------- direction

  it('read-only mode refuses writes and passes reads', async () => {
    await clearAllDrillState(db)
    admin.invalidatePlatformLockdownCache()
    await post(route, superToken, {
      action: 'lock',
      scope: 'platform',
      reason: 'maintenance',
      mode: 'read-only',
      confirm: 'LOCK PLATFORM',
    })
    expect(
      await admin.getLockdownVerdict({ intent: 'write' }),
    ).not.toBeNull()
    expect(await admin.getLockdownVerdict({ intent: 'read' })).toBeNull()
    // Unstated intent must refuse: the safe default is the whole point.
    expect(await admin.getLockdownVerdict({})).not.toBeNull()
    await post(route, superToken, { action: 'unlock', scope: 'platform' })
  }, 120_000)

  it('every lock and every lift lands in adminAudit', async () => {
    await clearAllDrillState(db)
    const before = (
      await db.collection('adminAudit').where('scope', '==', 'feature').get()
    ).size
    await post(route, superToken, {
      action: 'lock',
      scope: 'feature',
      targetId: 'ai-assist',
      reason: 'security',
    })
    await post(route, superToken, {
      action: 'unlock',
      scope: 'feature',
      targetId: 'ai-assist',
    })
    const after = (
      await db.collection('adminAudit').where('scope', '==', 'feature').get()
    ).size
    // Both directions, not just the lock: a lift that leaves no trace is how
    // "who un-paused checkout, and when" becomes unanswerable after the fact.
    expect(after - before).toBeGreaterThanOrEqual(2)
  }, 120_000)
})

// ------------------------------------------------------------------ helpers

/**
 * Wait until `predicate` holds, and return ms elapsed since `fromMs`. The
 * poll interval is the measurement's resolution.
 */
async function convergeMs(
  predicate: () => Promise<boolean>,
  fromMs: number,
): Promise<number> {
  const deadline = fromMs + CONVERGE_TIMEOUT_MS
  for (;;) {
    if (await predicate()) return Date.now() - fromMs
    if (Date.now() > deadline) {
      throw new Error(
        `lockdown did not converge within ${CONVERGE_TIMEOUT_MS}ms — this is ` +
          'a FAILED drill, not a slow one',
      )
    }
    await new Promise((resolve) => setTimeout(resolve, POLL_MS))
  }
}

async function post(
  route: { POST: (request: Request) => Promise<Response> },
  token: string,
  body: Record<string, unknown>,
): Promise<{ status: number; body: unknown }> {
  const response = await route.POST(
    new Request('http://localhost/api/admin/lockdown', {
      method: 'POST',
      headers: {
        authorization: `Bearer ${token}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify(body),
    }),
  )
  return { status: response.status, body: await response.json() }
}

/** Write a lockdown doc WITHOUT the route, i.e. without cache invalidation. */
async function writeLockDirect(
  db: Firestore,
  docId: string,
  fields: Record<string, unknown>,
): Promise<void> {
  await db
    .collection('lockdowns')
    .doc(docId)
    .set({ ...fields, atMs: Date.now(), by: SUPER_UID })
}

async function deleteLockDirect(db: Firestore, docId: string): Promise<void> {
  await db.collection('lockdowns').doc(docId).delete()
}

async function lockExists(db: Firestore, docId: string): Promise<boolean> {
  return (await db.collection('lockdowns').doc(docId).get()).exists
}

async function readDoc(
  db: Firestore,
  collection: string,
  id: string,
): Promise<Record<string, unknown> | undefined> {
  return (await db.collection(collection).doc(id).get()).data()
}

async function anyDocId(db: Firestore, collection: string): Promise<string> {
  const snapshot = await db.collection(collection).limit(1).get()
  if (snapshot.empty) {
    throw new Error(
      `no ${collection} in the emulator — run \`npm run seed:e2e\` first`,
    )
  }
  return snapshot.docs[0].id
}

/** Leave the emulator as the drill found it: no locks, no suspensions. */
async function clearAllDrillState(db: Firestore): Promise<void> {
  const locks = await db.collection('lockdowns').get()
  await Promise.all(locks.docs.map((doc) => doc.ref.delete()))
  for (const collection of ['orgs', 'hosts']) {
    const snapshot = await db
      .collection(collection)
      .where('suspendedAt', '!=', null)
      .get()
      .catch(() => null)
    if (!snapshot) continue
    await Promise.all(
      snapshot.docs.map((doc) =>
        doc.ref.update({
          suspendedAt: null,
          suspendedReasonCode: null,
          suspendedMessage: null,
          suspendedUntilMs: null,
          suspendedMode: null,
        }),
      ),
    )
  }
  admin.invalidatePlatformLockdownCache()
}

async function mintIdToken(email: string): Promise<string> {
  const [hostname, port] = String(
    process.env.FIREBASE_AUTH_EMULATOR_HOST,
  ).split(':')
  const payload = JSON.stringify({
    email,
    password: PASSWORD,
    returnSecureToken: true,
  })
  const body = await new Promise<string>((resolve, reject) => {
    const request = httpRequest(
      {
        hostname,
        port: Number(port),
        path:
          '/identitytoolkit.googleapis.com/v1/' +
          'accounts:signInWithPassword?key=fake',
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(payload),
        },
      },
      (response) => {
        let chunks = ''
        response.on('data', (chunk) => (chunks += chunk))
        response.on('end', () => resolve(chunks))
      },
    )
    request.on('error', reject)
    request.write(payload)
    request.end()
  })
  const data = JSON.parse(body) as { idToken?: string }
  if (!data.idToken) throw new Error(`Auth emulator sign-in failed: ${body}`)
  return data.idToken
}

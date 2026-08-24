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
 * AGL-1627 against a REAL Firestore: the beacon's lockdown gate, observed as
 * documents rather than as calls on a double.
 *
 * `analytics-collect.spec.ts` mocks `@aglyn/tenant-data-admin` wholesale —
 * including `getSiteLockdown`, the verdict this gate turns on — so it can
 * only ever prove that the route does what the double was told to say. That
 * spec's own header records the trap: a missing export there becomes a
 * TypeError inside the route's try/catch, a silently skipped gate that every
 * assertion still passes.
 *
 * This one removes the double. The lockdown is written where production
 * writes it (`suspendedAt`/`suspendedMode` on the host document, the carrier
 * `normalizeHostLockdown` reads), the real `getSiteLockdown` resolves it, and
 * the assertion is the state of `hosts/{id}/analytics/{day}` in the database
 * afterwards — the increment that reaches the dashboard, the bandwidth
 * ceiling and, through `report-usage`, the invoice.
 *
 * Skipped unless FIRESTORE_EMULATOR_HOST is set — the same convention as the
 * `*.emulator.spec.ts` files in `libs/tenant/data/admin`. Start the emulator,
 * then:
 *
 *   FIRESTORE_EMULATOR_HOST=127.0.0.1:8082 \
 *     npx jest -c apps/tenant/jest.config.ts \
 *       --runTestsByPath apps/tenant/specs/analytics-collect-lockdown.emulator.spec.ts
 */

import { getApps, initializeApp } from 'firebase-admin/app'
import { type Firestore, getFirestore } from 'firebase-admin/firestore'

const EMULATED = Boolean(process.env.FIRESTORE_EMULATOR_HOST)

if (EMULATED && !getApps().length) {
  initializeApp({ projectId: 'aglyn-main' })
}

/**
 * Nothing here may reach a real bucket. A developer machine holds a real
 * service-account credential, and `FIRESTORE_EMULATOR_HOST` redirects
 * Firestore only.
 */
jest.mock('firebase-admin/storage', () => ({
  getStorage: () => {
    throw new Error('BLOCKED: this spec must never reach Cloud Storage')
  },
}))

/**
 * The host automations the beacon fires. Stubbed because this spec is about
 * the Firestore counters; whether the event fired is asserted here through
 * this stub, and in full in `analytics-collect.spec.ts`.
 */
const emitted: Array<{ hostId: string; event: string }> = []
jest.mock('@aglyn/tenant-runtime', () => ({
  emitHostEvent: async (hostId: string, event: string) => {
    emitted.push({ hostId, event })
    return { alerts: [] }
  },
}))

/** Prefixed so a shared emulator makes it obvious whose rows these are. */
const HOST_ID = 'e2e-agl1627-beacon-host'
const DAY = new Date().toISOString().slice(0, 10)

const describeEmulated = EMULATED ? describe : describe.skip

describeEmulated('the beacon against a real Firestore (AGL-1627)', () => {
  let db: Firestore

  const hostRef = () => db.collection('hosts').doc(HOST_ID)
  const dayRef = () => hostRef().collection('analytics').doc(DAY)

  /** The counter as the dashboard, the ceiling and the invoice would read it. */
  const total = async (): Promise<number> => {
    const snapshot = await dayRef().get()
    return snapshot.exists ? Number(snapshot.get('total') ?? 0) : 0
  }

  /**
   * A fresh module instance per beacon. The gate memoizes its verdict per
   * host for 60 s, so a re-used instance would answer from the memo and the
   * lock under test would never be read at all.
   */
  const fire = async (ip: string): Promise<number> => {
    let status = 0
    await jest.isolateModulesAsync(async () => {
      // `isolateModulesAsync` hands back a FRESH module registry, so
      // `firebase-admin/app` inside it is a different module instance with
      // its own empty app store — the app initialized at the top of this file
      // is invisible here, and every Firestore call would throw `app/no-app`
      // into the route's outer try/catch and 204 as if nothing were wrong.
      const admin = await import('firebase-admin/app')
      if (!admin.getApps().length) admin.initializeApp({ projectId: 'aglyn-main' })
      const route = await import('../app/api/analytics/collect/route')
      const response = await route.POST(
        new Request('https://site.aglyn.app/api/analytics/collect', {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            // Distinct per call: the route's per-instance rate limiter is
            // keyed by IP, and a repeated address would start refusing.
            'x-forwarded-for': ip,
            'user-agent': 'agl1627-emulator-spec',
          },
          body: JSON.stringify({ hostId: HOST_ID, path: '/' }),
        }),
      )
      status = response.status
    })
    return status
  }

  const clearLock = () =>
    hostRef().set(
      { name: 'AGL-1627 emulator fixture', suspendedAt: null, suspendedMode: null },
      { merge: true },
    )

  beforeAll(async () => {
    db = getFirestore()
    // The spoof gate refuses a host that does not exist, so the fixture host
    // is a real document — as it is in production.
    await clearLock()
    await dayRef().delete()
  })

  afterAll(async () => {
    await dayRef().delete()
    await hostRef().delete()
  })

  beforeEach(() => {
    emitted.length = 0
  })

  it('CONTROL — with no lock the beacon really does increment the day doc', async () => {
    const before = await total()
    expect(await fire('203.0.113.1')).toBe(204)
    // The write this whole issue is about, observed as a document rather than
    // as a call on a double.
    expect(await total()).toBe(before + 1)
    expect(emitted).toEqual([{ hostId: HOST_ID, event: 'pageView' }])
  })

  it('a FULL lock stops the increment reaching Firestore at all', async () => {
    const before = await total()
    await hostRef().set(
      { suspendedAt: Date.now(), suspendedReasonCode: 'security' },
      { merge: true },
    )
    expect(await fire('203.0.113.2')).toBe(204)
    // Not "the mock was not called" — the counter in the database did not
    // move. Absent `suspendedMode` is `full` by the fail-safe default.
    expect(await total()).toBe(before)
    expect(emitted).toEqual([])
    await clearLock()
  })

  it('a READ-ONLY lock keeps the meter running and silences the automations', async () => {
    const before = await total()
    await hostRef().set(
      {
        suspendedAt: Date.now(),
        suspendedMode: 'read-only',
        suspendedReasonCode: 'maintenance',
      },
      { merge: true },
    )
    expect(await fire('203.0.113.3')).toBe(204)
    // The decision, both halves, against the real carrier document: the site
    // is still serving so the meter still counts, and the visitor-triggered
    // automation dispatch does not fire.
    expect(await total()).toBe(before + 1)
    expect(emitted).toEqual([])
    await clearLock()
  })

  it('lifting the lock restores both halves', async () => {
    const before = await total()
    expect(await fire('203.0.113.4')).toBe(204)
    expect(await total()).toBe(before + 1)
    expect(emitted).toEqual([{ hostId: HOST_ID, event: 'pageView' }])
  })
})

/**
 * @jest-environment node
 *
 * Pragma must stay in the FIRST block comment — behind the license header it
 * is silently ignored and this runs on jsdom.
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
 * AGL-1513 part 2 against a REAL Firestore.
 *
 * `admin-user-device-signout.spec.ts` and `device-revoke-route.spec.ts` both
 * drive their routes against a Firestore DOUBLE, and that double implements
 * `{ merge: true }` ITSELF — so "the row is stamped, not replaced" is a
 * property those suites assert about code they also wrote. The same is true of
 * `runTransaction`, which the double reduces to "call the callback". A green
 * there only proves the route asked for a merge; it cannot prove a merge is
 * what a database does with the write.
 *
 * This one removes the double. The device row is written where
 * `recordDeviceAndMaybeAlert` writes it, `revokeDeviceSession` runs its real
 * transaction against the emulator, and the assertions are the state of
 * `users/{uid}/devices/{deviceId}` afterwards — plus the verdict the session
 * boundary would reach from what is actually stored.
 *
 * Skipped unless FIRESTORE_EMULATOR_HOST is set — the same convention as the
 * other `*.emulator.spec.ts` files. Start the emulator, then:
 *
 *   FIRESTORE_EMULATOR_HOST=127.0.0.1:8082 \
 *     npx jest -c apps/console/jest.config.ts \
 *       --runTestsByPath apps/console/specs/device-registry.emulator.spec.ts
 */

import { getApps, initializeApp } from 'firebase-admin/app'
import { type Firestore, getFirestore } from 'firebase-admin/firestore'

const EMULATED = Boolean(process.env.FIRESTORE_EMULATOR_HOST)

if (EMULATED && !getApps().length) {
  initializeApp({ projectId: 'aglyn-main' })
}

/**
 * Nothing here may reach a real bucket or a real Identity Toolkit. A developer
 * machine holds a real service-account credential, and
 * `FIRESTORE_EMULATOR_HOST` redirects Firestore ONLY — a stray
 * `revokeRefreshTokens` would land on production auth.
 */
jest.mock('firebase-admin/storage', () => ({
  getStorage: () => {
    throw new Error('BLOCKED: this spec must never reach Cloud Storage')
  },
}))

/** Every pool-tagged call the helper makes, so the auth half is still pinned. */
const authCalls: string[] = []
jest.mock('@aglyn/tenant-data-admin', () => ({
  __esModule: true,
  authForPool: (tenantId: string | null) => ({
    revokeRefreshTokens: async (uid: string) => {
      authCalls.push(`${String(tenantId ?? 'PROJECT')}:revoke:${uid}`)
    },
  }),
  invalidateTokenRevocationCache: (uid: string, tenantId?: unknown) => {
    authCalls.push(`${String(tenantId ?? 'PROJECT')}:invalidate:${uid}`)
  },
}))

import { deviceRevocationRefuses } from '../app/api/_lib/device-revocation'
import {
  readDeviceRows,
  revokeDeviceSession,
} from '../app/api/_lib/device-registry'

/** Prefixed so a shared emulator makes it obvious whose rows these are. */
const UID = 'e2e-agl1513-device-owner'
const DEVICE_ID = 'e2e-agl1513-stolen-laptop'
const OTHER_DEVICE_ID = 'e2e-agl1513-phone'
const TENANT = 'aglyn-org-y5v14'

const describeEmulated = EMULATED ? describe : describe.skip

describeEmulated('the device registry against a real Firestore (AGL-1513)', () => {
  let db: Firestore

  beforeAll(() => {
    db = getFirestore()
  })

  beforeEach(async () => {
    authCalls.length = 0
    const devices = db.collection('users').doc(UID).collection('devices')
    const existing = await devices.get()
    await Promise.all(existing.docs.map((doc) => doc.ref.delete()))
    // Exactly the shape `recordDeviceAndMaybeAlert` writes.
    await devices.doc(DEVICE_ID).set({
      deviceName: 'Chrome on macOS',
      userAgent: 'Mozilla/5.0 (Macintosh) Chrome/140',
      ip: '203.0.113.7',
      location: 'Dallas, TX',
      createdAt: 1_700_000_000_000,
      lastSeenAt: 1_700_000_100_000,
    })
    await devices.doc(OTHER_DEVICE_ID).set({
      deviceName: 'Safari on iPhone',
      ip: '198.51.100.4',
      createdAt: 1_700_000_000_000,
      lastSeenAt: 1_700_000_050_000,
    })
  })

  afterAll(async () => {
    const devices = db.collection('users').doc(UID).collection('devices')
    const existing = await devices.get()
    await Promise.all(existing.docs.map((doc) => doc.ref.delete()))
  })

  it('stamps the row in place, keeping every descriptive field', async () => {
    const nowMs = 1_700_000_500_000
    const outcome = await revokeDeviceSession({
      firestore: db as any,
      uid: UID,
      deviceId: DEVICE_ID,
      tenantId: TENANT,
      revokedBy: 'staff',
      actorUid: 'staff-1',
      nowMs,
    })
    expect(outcome).toEqual({ existed: true, revokedAt: nowMs })

    const stored = (
      await db.doc(`users/${UID}/devices/${DEVICE_ID}`).get()
    ).data() as Record<string, unknown>

    expect(stored['revokedAt']).toBe(nowMs)
    expect(stored['revokedBy']).toBe('staff')
    expect(stored['revokedByUid']).toBe('staff-1')
    // THE ASSERTION THE DOUBLE CANNOT MAKE. A `set` without `{ merge: true }`
    // replaces the document in a real Firestore, and every one of these fields
    // would be gone — the device would still be refused, and the list the
    // owner is sent to by a security email would show a nameless, placeless
    // row they cannot recognise.
    expect(stored['deviceName']).toBe('Chrome on macOS')
    expect(stored['ip']).toBe('203.0.113.7')
    expect(stored['location']).toBe('Dallas, TX')
    expect(stored['createdAt']).toBe(1_700_000_000_000)
    expect(stored['lastSeenAt']).toBe(1_700_000_100_000)

    // The auth half, in the pool it was told to use.
    expect(authCalls).toEqual([
      `${TENANT}:revoke:${UID}`,
      `${TENANT}:invalidate:${UID}`,
    ])
  })

  it('leaves the account’s other devices untouched', async () => {
    await revokeDeviceSession({
      firestore: db as any,
      uid: UID,
      deviceId: DEVICE_ID,
      tenantId: null,
      revokedBy: 'owner',
      nowMs: 1_700_000_500_000,
    })
    const other = (
      await db.doc(`users/${UID}/devices/${OTHER_DEVICE_ID}`).get()
    ).data() as Record<string, unknown>
    // The stamp is per-device even though the token revocation is not: this is
    // what lets the owner sign back in on their phone and keep working.
    expect(other['revokedAt']).toBeUndefined()
  })

  it('does not revoke anything for a device that is not there', async () => {
    const outcome = await revokeDeviceSession({
      firestore: db as any,
      uid: UID,
      deviceId: 'e2e-agl1513-no-such-device',
      tenantId: TENANT,
      revokedBy: 'staff',
      nowMs: 1_700_000_500_000,
    })
    expect(outcome.existed).toBe(false)
    // The dangerous failure mode: a mistyped device id that nevertheless ends
    // every session on a customer's account.
    expect(authCalls).toEqual([])
    // And it must not conjure the document it failed to find.
    expect(
      (await db.doc(`users/${UID}/devices/e2e-agl1513-no-such-device`).get())
        .exists,
    ).toBe(false)
  })

  it('reads back as a signed-out row rather than disappearing', async () => {
    const nowMs = 1_700_000_500_000
    await revokeDeviceSession({
      firestore: db as any,
      uid: UID,
      deviceId: DEVICE_ID,
      tenantId: TENANT,
      revokedBy: 'staff',
      actorUid: 'staff-1',
      nowMs,
    })
    const rows = await readDeviceRows(db as any, UID)
    // Both devices, newest first. A revoked row that vanished would make the
    // same browser read as BRAND NEW on its next sign-in.
    expect(rows.map((row) => row.id)).toEqual([DEVICE_ID, OTHER_DEVICE_ID])
    const revoked = rows.find((row) => row.id === DEVICE_ID)
    expect(revoked?.revokedAtMs).toBe(nowMs)
    expect(revoked?.revokedBy).toBe('staff')
    expect(revoked?.deviceName).toBe('Chrome on macOS')
    expect(rows.find((row) => row.id === OTHER_DEVICE_ID)?.revokedAtMs).toBe(
      null,
    )
  })

  it('is what the session boundary would refuse — and what it would admit', async () => {
    const nowMs = 1_700_000_500_000
    await revokeDeviceSession({
      firestore: db as any,
      uid: UID,
      deviceId: DEVICE_ID,
      tenantId: TENANT,
      revokedBy: 'staff',
      nowMs,
    })
    // Read the epoch back out of the database rather than reusing `nowMs`:
    // the gate's input is what Firestore stored, not what we passed in.
    const storedRevokedAt = Number(
      (
        (await db.doc(`users/${UID}/devices/${DEVICE_ID}`).get()).data() as
          | Record<string, unknown>
          | undefined
      )?.['revokedAt'] ?? 0,
    )

    // The stolen laptop: it holds a credential minted BEFORE the revocation
    // and cannot mint another, because `auth_time` moves only when somebody
    // actually authenticates.
    expect(deviceRevocationRefuses(storedRevokedAt, nowMs - 60_000)).toBe(true)
    // The owner, signing in again on that same browser afterwards. This is the
    // direction that makes the control survivable: without it, revoking the
    // device you are sitting at would be a permanent lockout.
    expect(deviceRevocationRefuses(storedRevokedAt, nowMs + 60_000)).toBe(false)
    // The untouched phone reads 0 and refuses nobody.
    const untouched = Number(
      (
        (await db.doc(`users/${UID}/devices/${OTHER_DEVICE_ID}`).get()).data() as
          | Record<string, unknown>
          | undefined
      )?.['revokedAt'] ?? 0,
    )
    expect(deviceRevocationRefuses(untouched, nowMs - 60_000)).toBe(false)
  })
})

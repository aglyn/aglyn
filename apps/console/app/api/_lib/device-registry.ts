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
 * The device registry, read and revoked from more than one door (AGL-1513).
 *
 * AGL-1959 built both halves inside `/api/account/devices` and its `revoke/`
 * sibling, which was right while the owner was the only caller. AGL-1513 part 2
 * asked for the STAFF lever — "my laptop was stolen" arrives at support at
 * least as often as it arrives at the Security tab — and a second
 * implementation of "stamp the row, then revoke in the owning pool" is the
 * shape that drifts: the day one of them forgets `authForPool` it becomes
 * AGL-2005 again, a 200 that revoked nothing.
 *
 * So the mechanics live here and both doors call them. What each door decides
 * for itself is who may ask: the owner's route takes the uid off its own
 * verified token and refuses a uid parameter outright, and the staff route
 * demands `staffRole === 'super'` and writes an `adminAudit` row. That
 * asymmetry is the point — the same write, two very different authorisations.
 *
 * ## What a revocation actually reaches, restated because it is easy to
 * ## overstate from either side
 *
 * `revokeRefreshTokens` is account-wide; Firebase offers nothing narrower. The
 * per-device part is the `revokedAt` EPOCH, compared at the session boundary
 * against when the presented credential was issued (see `device-revocation.ts`).
 * Together they mean: everybody signs out once, the owner signs back in and
 * keeps working, and the evicted device stays refused — because the one thing
 * it cannot do is produce a newer `auth_time`.
 *
 * Dropping the account-wide revoke to make this "true" single-session
 * revocation was considered and rejected under AGL-1513, on measurement rather
 * than taste: the device epoch is enforced at the session MINT and the
 * cross-subdomain EXCHANGE, and an already-signed-in browser passes through
 * neither. Without the account-wide revoke it would keep refreshing ID tokens
 * from its own refresh token and keep opening all 117 Bearer-token console API
 * routes indefinitely — not for an hour, indefinitely. That is not a narrower
 * control, it is no control.
 */

import { authForPool, invalidateTokenRevocationCache } from '@aglyn/tenant-data-admin'

/**
 * `users/{uid}/devices/{deviceId}`.
 *
 * Declared HERE and re-exported by `security-alerts.ts`, rather than the other
 * way round, and the direction is load-bearing. `security-alerts` reaches the
 * email renderer, which builds its default brand tokens at MODULE scope — so
 * importing one constant from it drags the whole mail stack into every caller,
 * and into every spec that loads one. AGL-2190 records that trap: it does not
 * fail an assertion, it fails the SUITE at load, three requires deep. The staff
 * user-detail page has no business loading an email renderer to list devices.
 */
export const DEVICES_COLLECTION = 'devices'

/**
 * Enough history to recognise a stranger, bounded so one account cannot make
 * this an expensive read. Unchanged from AGL-2318's `DEVICE_LIMIT`.
 */
export const DEVICE_LIST_LIMIT = 50

/** One row of sign-in history, as every surface renders it. */
export interface DeviceRow {
  id: string
  deviceName: string | null
  userAgent: string | null
  location: string | null
  ip: string | null
  firstSeenMs: number | null
  lastSeenMs: number | null
  /** Set once this device has been signed out (AGL-1959). */
  revokedAtMs: number | null
  /** `owner` or `staff` — who ended it (AGL-1513). */
  revokedBy: string | null
  /** Recorded without an email because it overlapped a known device. */
  alertSuppressedAtMs: number | null
}

/** Minimal shape of the Admin SDK Firestore handle these helpers need. */
type FirestoreLike = {
  collection: (path: string) => any
  runTransaction: <T>(fn: (tx: any) => Promise<T>) => Promise<T>
}

/**
 * A device id addresses a document inside one user's subcollection, and
 * `.doc()` resolves a SLASHED id as a nested path — so this check is not
 * cosmetic. Shared, because the two doors must refuse the same ids.
 */
export function isValidDeviceId(deviceId: unknown): deviceId is string {
  return (
    typeof deviceId === 'string' &&
    deviceId.length > 0 &&
    deviceId.length <= 200 &&
    !deviceId.includes('/')
  )
}

/**
 * Read one account's sign-in history, newest first.
 *
 * THROWS rather than answering `[]`. Both callers render a security surface,
 * and an empty list on a failed read says "nothing else has signed in" — the
 * one wrong answer neither of them may give.
 */
export async function readDeviceRows(
  firestore: FirestoreLike,
  uid: string,
  limit: number = DEVICE_LIST_LIMIT,
): Promise<DeviceRow[]> {
  const devices = firestore.collection('users').doc(uid).collection(DEVICES_COLLECTION)
  const snapshot = await devices
    .orderBy('lastSeenAt', 'desc')
    .limit(limit)
    .get()
    // Devices recorded before `lastSeenAt` existed still have to appear: an
    // ordering that silently drops rows would make a review surface answer
    // "you have never signed in from anywhere else".
    .catch(() => devices.limit(limit).get())

  return (snapshot.docs as Array<{ id: string; data: () => unknown }>)
    .map((doc) => {
      const data = (doc.data() ?? {}) as Record<string, unknown>
      return {
        id: doc.id,
        deviceName:
          typeof data['deviceName'] === 'string' ? data['deviceName'] : null,
        // The full string as well as the summary: "Chrome on Windows" is what
        // someone reads, and the raw agent is what they compare when two rows
        // summarise the same.
        userAgent:
          typeof data['userAgent'] === 'string' ? data['userAgent'] : null,
        location: typeof data['location'] === 'string' ? data['location'] : null,
        ip: typeof data['ip'] === 'string' ? data['ip'] : null,
        firstSeenMs: Number(data['createdAt'] ?? 0) || null,
        lastSeenMs: Number(data['lastSeenAt'] ?? 0) || null,
        // A revoked device keeps its row rather than disappearing: deleting it
        // would hide the device and revoke nothing, and the same browser would
        // then read as BRAND NEW on its next sign-in.
        revokedAtMs: Number(data['revokedAt'] ?? 0) || null,
        revokedBy:
          typeof data['revokedBy'] === 'string' ? data['revokedBy'] : null,
        alertSuppressedAtMs: Number(data['alertSuppressedAt'] ?? 0) || null,
      }
    })
    .sort((a, b) => (b.lastSeenMs ?? 0) - (a.lastSeenMs ?? 0))
}

/** What `revokeDeviceSession` did. `existed: false` means nothing was ended. */
export interface DeviceRevocationOutcome {
  existed: boolean
  /** Epoch ms stamped on the row; 0 when nothing was stamped. */
  revokedAt: number
}

/**
 * Stamp one device's row and revoke the account's refresh tokens, in that
 * order.
 *
 * ## Why the stamp goes first
 *
 * If `revokeRefreshTokens` fails we have still refused the device at our own
 * boundary and the caller can retry. The reverse order would end every session
 * and leave no record of why — the row would still read as live, and the
 * person would revoke it again.
 *
 * ## Why the row is stamped and never deleted
 *
 * A delete hides the device and revokes nothing (the browser still holds a
 * 14-day `__session` cookie and a refresh token), and it would make that same
 * browser read as brand new on its next sign-in, mailing the owner a fresh
 * "new device" alert about the stranger they just evicted.
 *
 * ## Pool
 *
 * `authForPool(tenantId)`, never the bare project auth. AGL-2005 measured the
 * other choice on production: a `revokeRefreshTokens` dated 2026-08-14 sitting
 * on a project-pool ghost while the real SSO account's `tokensValidAfterTime`
 * never moved.
 */
export async function revokeDeviceSession(options: {
  firestore: FirestoreLike
  uid: string
  deviceId: string
  /** GCIP tenant the uid lives in, or null for the project pool. */
  tenantId: string | null
  /** Who ended it. Rendered on the row and audited. */
  revokedBy: 'owner' | 'staff'
  /** The acting staff uid, when this was not the owner's own click. */
  actorUid?: string | null
  nowMs: number
}): Promise<DeviceRevocationOutcome> {
  const { firestore, uid, deviceId, tenantId, revokedBy, nowMs } = options
  const ref = firestore
    .collection('users')
    .doc(uid)
    .collection(DEVICES_COLLECTION)
    .doc(deviceId)

  const existed = await firestore.runTransaction(async (tx: any) => {
    const snapshot = await tx.get(ref)
    if (!snapshot.exists) return false
    tx.set(
      ref,
      {
        revokedAt: nowMs,
        revokedBy,
        // Only when there is one. A `revokedByUid: null` on an owner's own
        // click would be a field claiming a staff member was involved.
        ...(options.actorUid ? { revokedByUid: options.actorUid } : {}),
      },
      { merge: true },
    )
    return true
  })

  if (!existed) return { existed: false, revokedAt: 0 }

  // The only lever that reaches the refresh token in the other browser's
  // storage. Firebase has no per-device revocation, so this ends every session
  // on the account — every surface that offers this says so in those words
  // rather than implying a narrower effect than it has.
  await authForPool(tenantId).revokeRefreshTokens(uid)
  // AGL-1881. Without this the process that just served the click keeps
  // serving the revoked token from its own 15s cache.
  invalidateTokenRevocationCache(uid, tenantId)

  return { existed: true, revokedAt: nowMs }
}

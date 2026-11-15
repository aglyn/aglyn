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

import type { Firestore } from 'firebase-admin/firestore'
import { isEditHintDeviceId } from './edit-hint-token'

/**
 * Console sign-out ends the site edit bar in THAT browser (AGL-1842
 * follow-on).
 *
 * The `.aglyn.app` hint cookies live on a registrable domain the console
 * cannot write, so clearing them at sign-out is best-effort at most: a tab
 * closed mid-sign-out never gets there. The ending therefore happens on the
 * server. Sign-out writes one document per browser,
 * `users/{uid}/editHintEnds/{did}` with `endedAt`, where `did` is the
 * console's `aglyn_device` id for that browser. Every hint and every
 * edit-access token minted from that browser carries the same `did` and the
 * time its console session was last proven live; the exchange and
 * `/api/edit-context` refuse anything dated before `endedAt`.
 *
 * Per browser, by construction: another browser has another `did`, so the
 * same person signed in elsewhere keeps their bar. Signing back in here mints
 * a newer hint and the bar returns, with nothing to undo. One document per
 * browser the person has signed out of, overwritten each time, so it needs no
 * expiry; `eraseUser`'s `recursiveDelete(users/{uid})` takes it with the
 * account.
 *
 * Admin SDK only. The collection has no rules match, so clients can neither
 * read nor write it.
 *
 * Two other endings reach the bar without writing anything new (AGL-1842,
 * "sign out everywhere" and removing a device): a device signed out from the
 * device list ends that browser through its own `devices/{did}.revokedAt`
 * stamp, read beside this record, and an account-wide sign-out ends every
 * browser through the account's `tokensValidAfterTime`
 * ({@link accountEndRefuses}).
 */
export const EDIT_HINT_ENDS_COLLECTION = 'editHintEnds'

type FirestoreLike = Pick<Firestore, 'collection'>

function endDoc(firestore: FirestoreLike, uid: string, did: string) {
  return firestore
    .collection('users')
    .doc(uid)
    .collection(EDIT_HINT_ENDS_COLLECTION)
    .doc(did)
}

/** Records that `uid` signed out of the console in browser `did`. */
export async function recordEditHintEnded(
  firestore: FirestoreLike,
  uid: string,
  did: string,
  nowMs: number = Date.now(),
): Promise<boolean> {
  if (!uid || !isEditHintDeviceId(did)) return false
  await endDoc(firestore, uid, did).set({ endedAt: nowMs })
  return true
}

/**
 * `users/{uid}/devices/{did}`, the console's sign-in history row for the same
 * browser (`device-registry.ts` in the console names it `DEVICES_COLLECTION`).
 * Its `revokedAt` is stamped when that one device is signed out from the
 * Recent sign-ins list or by staff. Read here, never written: the ending it
 * records is reused as it stands, with no second write at revoke time.
 */
export const EDIT_HINT_DEVICES_COLLECTION = 'devices'

function epochField(snapshot: { exists: boolean; get: (field: string) => unknown }, field: string): number {
  if (!snapshot.exists) return 0
  const value = Number(snapshot.get(field) ?? 0)
  return Number.isFinite(value) && value > 0 ? value : 0
}

/**
 * When browser `did` was last ended for `uid`; 0 if never. The later of two
 * records, read side by side:
 *
 * - its console sign-out (`editHintEnds/{did}.endedAt`, written by
 *   `DELETE /api/auth/session`);
 * - that device being signed out from the device list
 *   (`devices/{did}.revokedAt`). The hint's `did` IS the device row's id: both
 *   are the browser's `aglyn_device` cookie. So removing a device ends that
 *   device's bar, and no other device's, through this record alone.
 *
 * Signing out EVERYWHERE is account-wide and lives on the account instead
 * (`tokensValidAfterTime`); see {@link accountEndRefuses}.
 */
export async function readEditHintEndedAt(
  firestore: FirestoreLike,
  uid: string,
  did: string,
): Promise<number> {
  if (!uid || !isEditHintDeviceId(did)) return 0
  const [ended, device] = await Promise.all([
    endDoc(firestore, uid, did).get(),
    firestore
      .collection('users')
      .doc(uid)
      .collection(EDIT_HINT_DEVICES_COLLECTION)
      .doc(did)
      .get(),
  ])
  return Math.max(epochField(ended, 'endedAt'), epochField(device, 'revokedAt'))
}

/**
 * Does a sign-out at `endedAtMs` end a credential whose session was proven
 * live at `provenAtMs`? An undateable credential cannot be shown to postdate
 * the sign-out, so it is refused, the same safe direction as device
 * revocation.
 */
export function editHintEndRefuses(
  endedAtMs: number,
  provenAtMs: number | null | undefined,
): boolean {
  if (!endedAtMs) return false
  const proven = Number(provenAtMs ?? 0)
  if (!Number.isFinite(proven) || proven <= 0) return true
  return proven <= endedAtMs
}

/**
 * Does the account's own revocation epoch end a credential proven live at
 * `provenAtMs`?
 *
 * "Sign out everywhere", a password reset, a lock, a disable or a demotion
 * all end every session through `revokeRefreshTokens`, which moves the
 * account's `tokensValidAfterTime`. Every browser's hint and edit token
 * proven live before that moment is refused, on every browser at once, and
 * nothing extra is written: the epoch is the record. A hint minted after it
 * came from a session that passed the same revocation check, so signing back
 * in restores the bar with nothing to undo.
 *
 * Whole seconds on both sides, the same comparison `revocationRefuses` makes
 * for ID tokens: `tokensValidAfterTime` has second granularity, so comparing
 * milliseconds would refuse a hint minted in the same second on one process
 * and admit it on the next.
 *
 * @param validAfter - `tokensValidAfterTime` as the Admin SDK returns it (an
 *   RFC-1123 string) or as epoch ms; absent when never revoked
 */
export function accountEndRefuses(
  validAfter: string | number | null | undefined,
  provenAtMs: number | null | undefined,
): boolean {
  const validAfterMs =
    typeof validAfter === 'string' ? Date.parse(validAfter) : Number(validAfter ?? 0)
  if (!Number.isFinite(validAfterMs) || validAfterMs <= 0) return false
  const proven = Number(provenAtMs ?? 0)
  if (!Number.isFinite(proven) || proven <= 0) return true
  return Math.floor(proven / 1000) < Math.floor(validAfterMs / 1000)
}

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

/** When `uid` last signed out of the console in browser `did`; 0 if never. */
export async function readEditHintEndedAt(
  firestore: FirestoreLike,
  uid: string,
  did: string,
): Promise<number> {
  if (!uid || !isEditHintDeviceId(did)) return 0
  const snapshot = await endDoc(firestore, uid, did).get()
  if (!snapshot.exists) return 0
  const endedAt = Number(snapshot.get('endedAt') ?? 0)
  return Number.isFinite(endedAt) && endedAt > 0 ? endedAt : 0
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

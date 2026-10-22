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
 * The user-scope lockdown CORE (AGL-1501), beside the org and host cores in
 * `org-lockdown.ts`: the staff panic button and the page screen's automatic
 * security hold (AGL-3450) lock an account through this one function, so the
 * two cannot drift.
 *
 * A user lock is three effects, not a flag write:
 *
 *  1. `lockdowns/user--{uid}` — what every lockdown verdict reads;
 *  2. Firebase Auth `disabled` — no new sign-in;
 *  3. refresh-token revocation, pool-aware — the session cookie dies at its
 *     next `verifySessionCookie(…, true)` exchange and the SDK at its next
 *     token refresh. The project-pool revoke would silently miss an
 *     SSO-tenant account, so it runs on the account's own pool.
 *
 * The caller has already checked the account exists and is not staff, and
 * writes the audit row and the owner notice.
 */

import {
  type LockdownEnforcement,
  LOCKDOWNS_COLLECTION,
  userLockdownDocId,
} from '@aglyn/aglyn/server'
import {
  authForPool,
  invalidateTokenRevocationCache,
  invalidateUserLockdownCache,
} from '@aglyn/tenant-data-admin'

export interface UserLockdownWrite {
  reason: string
  message?: string
  untilMs?: number
  enforcement?: LockdownEnforcement
}

export async function applyUserLockdown(options: {
  firestore: FirebaseFirestore.Firestore
  uid: string
  /** The account's auth pool (`findUserByUidAcrossPools(uid).tenantId`). */
  tenantId: string | null | undefined
  action: 'lock' | 'unlock'
  lock?: UserLockdownWrite
  /** Who placed it — a staff uid, or a `system:` actor. */
  actorUid: string
  nowMs?: number
}): Promise<void> {
  const { firestore, uid, action } = options
  const ref = firestore.collection(LOCKDOWNS_COLLECTION).doc(userLockdownDocId(uid))
  const pool = authForPool(options.tenantId)
  if (action === 'lock') {
    const lock = options.lock ?? { reason: 'manual' }
    await ref.set({
      scope: 'user',
      // Stored ONLY for takedowns (AGL-1621), same discipline as `mode`:
      // a standard lock's document stays byte-identical to one written
      // before the field existed, so absent keeps meaning fail-open.
      ...(lock.enforcement === 'takedown' ? { enforcement: lock.enforcement } : {}),
      reason: lock.reason,
      ...(lock.message ? { message: lock.message } : {}),
      ...(lock.untilMs !== undefined ? { untilMs: lock.untilMs } : {}),
      atMs: options.nowMs ?? Date.now(),
      actorUid: options.actorUid,
    })
    // The logout is real: disable stops new sign-ins, the revoke kills
    // the session cookie at its next `verifySessionCookie(…, true)`
    // exchange and the SDK's next token refresh. Pool-scoped — the
    // project-pool revoke would silently miss an SSO-tenant account.
    await pool.updateUser(uid, { disabled: true })
    await pool.revokeRefreshTokens(uid)
    invalidateTokenRevocationCache(uid, options.tenantId ?? null)
  } else {
    await ref.delete()
    await pool.updateUser(uid, { disabled: false })
  }
  // The process that took the action refuses (or readmits) this uid NOW;
  // other processes converge within the reader's 15s TTL (AGL-1522). The
  // hard kill never rode that cache — the disable + revoke above stand
  // on their own.
  invalidateUserLockdownCache(uid)
}

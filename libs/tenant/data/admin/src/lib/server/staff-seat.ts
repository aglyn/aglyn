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
 * Platform staff take none of a customer's seats (AGL-3466).
 *
 * A roster row or invite for an account holding the `staff` claim is stamped
 * `staffSeat: true` when the server writes it, and every seat counter skips a
 * stamped entry (`usesCustomerSeat`). This module answers the two questions
 * the writers ask — is this account staff, is this address staff's — and
 * takes the stamp off again when the claim is revoked.
 *
 * Every lookup FAILS TOWARDS A SEAT. An auth lookup that throws, or an
 * account that cannot be found, answers "not staff", so the row it decides
 * takes a seat like any other. The opposite failure would hand a free seat to
 * whoever the lookup could not see.
 */

import { FieldValue } from 'firebase-admin/firestore'
import {
  findUserByEmailAcrossPools,
  findUserByUidAcrossPools,
} from './auth-pools'
import firebaseAdmin from './firebase-admin'

/** Firestore's hard cap on writes in one batched commit. */
const FIRESTORE_BATCH_LIMIT = 500

/** Whether an auth record's claims carry `staff: true`. */
export function claimsHoldStaff(
  record: { customClaims?: Record<string, unknown> | null } | null | undefined,
): boolean {
  return record?.customClaims?.['staff'] === true
}

/** Whether the account `uid` holds the `staff` claim right now. */
export async function isStaffAccount(uid: string): Promise<boolean> {
  if (!uid) return false
  try {
    const found = await findUserByUidAcrossPools(uid)
    return claimsHoldStaff(found?.record)
  } catch (error) {
    console.error('[staff-seat] staff lookup by uid failed', error)
    return false
  }
}

/**
 * Whether the account holding `email` holds the `staff` claim right now.
 *
 * Used when an INVITE is sent, before anyone has accepted it, so the invite
 * reserves no seat. It is not trusted at acceptance: the account that accepts
 * is checked again by uid, so stamping an invite to a staff address can never
 * become a free seat for whoever else ends up accepting it.
 */
export async function isStaffAddress(email: string): Promise<boolean> {
  const address = typeof email === 'string' ? email.trim().toLowerCase() : ''
  if (!address) return false
  try {
    const found = await findUserByEmailAcrossPools(address)
    return claimsHoldStaff(found?.record)
  } catch (error) {
    console.error('[staff-seat] staff lookup by email failed', error)
    return false
  }
}

/**
 * Take the staff stamp off every row and pending invite an account holds,
 * for when its `staff` claim is revoked.
 *
 * The rows come from the `users/{uid}/orgs` reverse index, never a
 * collection-group scan of every workspace's roster. Invites are found by
 * address, because they have no uid until accepted.
 *
 * It frees no access and adds no check: a former staff member who stays on
 * a roster now takes a seat like anyone else, and a workspace that is over
 * its cap because of it keeps everyone it has. Seat caps bind admission,
 * never access.
 *
 * @returns how many rows and invites were unstamped, for the audit row.
 */
export async function clearStaffSeatStamps(
  uid: string,
  email?: string | null,
  db: FirebaseFirestore.Firestore = firebaseAdmin.app().firestore(),
): Promise<{ members: number; invites: number }> {
  const refs: FirebaseFirestore.DocumentReference[] = []
  let members = 0
  let invites = 0
  if (uid) {
    const memberships = await db.collection('users').doc(uid).collection('orgs').get()
    const rows = await Promise.all(
      memberships.docs.map((membership) =>
        db.collection('orgs').doc(membership.id).collection('members').doc(uid).get(),
      ),
    )
    for (const row of rows) {
      if (row.exists && row.get('staffSeat') !== undefined) {
        refs.push(row.ref)
        members += 1
      }
    }
  }
  const address = typeof email === 'string' ? email.trim().toLowerCase() : ''
  if (address) {
    const pending = await db
      .collectionGroup('invites')
      .where('email', '==', address)
      .where('acceptedAt', '==', null)
      .get()
    for (const invite of pending.docs) {
      if (invite.get('staffSeat') !== undefined) {
        refs.push(invite.ref)
        invites += 1
      }
    }
  }
  for (let i = 0; i < refs.length; i += FIRESTORE_BATCH_LIMIT) {
    const batch = db.batch()
    for (const ref of refs.slice(i, i + FIRESTORE_BATCH_LIMIT)) {
      batch.update(ref, { staffSeat: FieldValue.delete() })
    }
    await batch.commit()
  }
  return { members, invites }
}

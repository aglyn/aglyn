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

import {
  CRM_COLLECTIONS,
  type CrmActivity,
  type CrmEmailDeliveryState,
  isCrmEmailDeliveryState,
  nextCrmEmailDeliveryState,
} from '@aglyn/aglyn/server'
import { FieldValue } from 'firebase-admin/firestore'

/**
 * The activity row a one-to-one email is logged as, on the server side
 * (AGL-2615): where it lives, how it is written, and how the delivery
 * webhook moves its state.
 *
 * Two writers log a sent email — the console's `crm/email-send` route and
 * the `sendEmail` automation step — and one reader advances it, the Resend
 * event webhook. The reader has to find the row from nothing but the tags
 * on the message, so the id is minted BEFORE the send and stamped on it,
 * and the row is written only after the provider accepted the message. A
 * row written first would be an "email" on the timeline for a message that
 * never left.
 *
 * Firestore is a parameter throughout, as in `crm-records.ts`: the callers
 * hold one, and a module that reached for the Admin app itself would drag
 * it into every spec that only wants the arithmetic.
 */

/** `orgs/{orgId}/crmActivities/{activityId}`. */
export function crmActivityRef(
  firestore: FirebaseFirestore.Firestore,
  orgId: string,
  activityId: string,
): FirebaseFirestore.DocumentReference {
  return firestore
    .collection('orgs')
    .doc(orgId)
    .collection(CRM_COLLECTIONS.activities)
    .doc(activityId)
}

/**
 * A fresh reference for the row a send is about to earn — `doc()` with no
 * id mints one locally and reads nothing, so the id can ride the message
 * as a tag before anything is written.
 */
export function newCrmActivityRef(
  firestore: FirebaseFirestore.Firestore,
  orgId: string,
): FirebaseFirestore.DocumentReference {
  return firestore
    .collection('orgs')
    .doc(orgId)
    .collection(CRM_COLLECTIONS.activities)
    .doc()
}

/**
 * Writes the row a sent email is logged as, stamped with the server clock.
 *
 * `set` rather than `add`, because the id was minted ahead of the send and
 * is already on the message; a second id here would be the one the webhook
 * could not find.
 */
export async function writeCrmEmailActivity(
  ref: FirebaseFirestore.DocumentReference,
  activity: CrmActivity,
): Promise<void> {
  await ref.set({
    ...activity,
    createdAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
  })
}

/**
 * Which delivery state one normalized delivery event moves a row to, or
 * `null` for an event that moves nothing.
 *
 * Takes the log's own vocabulary (`EmailDeliveryEventType`) rather than the
 * provider's wire strings: `normalizeResendDeliveryEvents` is the one place
 * that reads those, and this module must not become a second. The five
 * states the timeline shows share the log's names exactly, so the mapping
 * is membership; `delayed` and `failed` are the log's own and the row keeps
 * whatever it held.
 */
export function crmEmailDeliveryStateForEvent(
  type: string | null | undefined,
): CrmEmailDeliveryState | null {
  return isCrmEmailDeliveryState(type) ? type : null
}

export type CrmEmailDeliveryOutcome =
  /** The row moved to the incoming state. */
  | 'advanced'
  /** The row already held this state or a later one; nothing written. */
  | 'unchanged'
  /** No email activity by that id in that org; nothing written. */
  | 'missing'
  /** The read or the write threw; logged, and nothing is promised. */
  | 'failed'

/**
 * One delivery event, onto the activity row it names (AGL-2615).
 *
 * A TRANSACTION, because the rule is "keep the later state" and two events
 * for one message routinely arrive together — `delivered` and `opened`
 * within the same second from a mail client that fetches images on
 * receipt. Two plain read-then-writes interleaved would let the earlier
 * event land last and print "Delivered" over an open that already
 * happened; inside a transaction the second read sees the first write and
 * `nextCrmEmailDeliveryState` answers "unchanged".
 *
 * A row that is not an email activity is left alone: the tag named it, but
 * a delivery state on a call log would be a chip the timeline has no way to
 * explain. **Never throws** — the webhook answers the provider 200 whatever
 * happens here, so a failure is logged and reported rather than raised.
 */
export async function recordCrmEmailDelivery(
  firestore: FirebaseFirestore.Firestore,
  input: {
    orgId: string
    activityId: string
    state: CrmEmailDeliveryState
    /** When the provider says it happened, epoch ms. */
    atMs: number
  },
): Promise<CrmEmailDeliveryOutcome> {
  const { orgId, activityId, state } = input
  if (!orgId || !activityId) return 'missing'
  const ref = crmActivityRef(firestore, orgId, activityId)
  try {
    return await firestore.runTransaction(async (transaction) => {
      const snapshot = await transaction.get(ref)
      if (!snapshot.exists || snapshot.get('kind') !== 'email') return 'missing'
      const current = snapshot.get('deliveryState')
      const next = nextCrmEmailDeliveryState(current, state)
      if (next === current) return 'unchanged'
      transaction.update(ref, {
        deliveryState: next,
        deliveryAtMs: Number.isFinite(input.atMs) ? input.atMs : Date.now(),
        updatedAt: FieldValue.serverTimestamp(),
      })
      return 'advanced'
    })
  } catch (error) {
    console.error('[crm] email delivery state write failed', orgId, activityId, error)
    return 'failed'
  }
}

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
 * WHAT A METERED TURN OWES THE CHARGE PATH (AGL-3011).
 *
 * The meter's two writers call this once their batch has committed. It reads
 * what the charge needs — the org's plan and its Stripe customer — and hands
 * it to `maybeChargeAiOverage`.
 *
 * ## Why the reads live here and not in the meter
 *
 * `assist-usage.ts` deliberately keeps the admin lib's `firebase-admin`
 * module out of its import graph, so that every unit test touching a counter
 * does not drag a cert credential, RTDB and AppCheck along with it. This
 * module is loaded through a dynamic import from there, exactly as the
 * allotment alerts are, so the meter's graph is unchanged and the cost of
 * these reads is paid only on a turn that could produce a charge.
 *
 * ## Why the reads are affordable
 *
 * Nothing here runs before the cutover month — the caller checks that first,
 * and so does `maybeChargeAiOverage`. Once charging is on, two reads on a
 * metered turn sit beside a model call that costs orders of magnitude more.
 *
 * ## Why losing this is survivable
 *
 * It runs off the request's await path, so a killed process can drop it. The
 * money is still bounded: the gate refuses at the unpaid limit whether or
 * not a charge ever ran, the next turn tries again, and the reconcile sweep
 * finishes anything left half-done.
 */

import { firebaseAdmin, readOrgBilling } from '@aglyn/tenant-data-admin'
import { maybeChargeAiOverage } from './ai-overage-charge'
import { aiOverageBillsByInvoice } from './ai-overage-cutover'

/**
 * Charges the workspace's accrued overage if it has reached the threshold.
 *
 * Returns quietly on every "nothing to do" — before the cutover, no org
 * document, no Stripe customer — because this is called after every metered
 * turn and a thrown error on the ordinary path would fill the logs with the
 * ordinary path.
 */
export async function chargeAccruedAiOverage(
  firestore: FirebaseFirestore.Firestore,
  orgId: string,
  month: string,
  now = new Date(),
): Promise<void> {
  if (!aiOverageBillsByInvoice(month)) return
  const orgSnapshot = await firestore.collection('orgs').doc(orgId).get()
  if (!orgSnapshot.exists) return
  const billing = await readOrgBilling(orgId)
  const stripeCustomerId = String(billing?.stripeCustomerId ?? '') || null
  await maybeChargeAiOverage(firestore, {
    orgId,
    org: (orgSnapshot.data() ?? {}) as never,
    month,
    stripeCustomerId,
    now,
  })
}

/**
 * The same, for a caller that has no Firestore handle of its own — the
 * close-out sweep and the staff route, which run outside a metered turn.
 */
export function aiOverageFirestore(): FirebaseFirestore.Firestore {
  return firebaseAdmin.app().firestore()
}

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
 * CLOSING A MONTH OF AI OVERAGE (AGL-3011).
 *
 * Charging as usage accrues always leaves a remainder: the part of a month
 * that never reached the threshold before the month ended. This settles it,
 * and does the two other things a month's end is the right moment for.
 *
 * Run from the platform's closed-month usage sweep through the metered-line
 * seam — the one job that already knows every workspace, its month and its
 * Stripe customer — rather than from a cron of its own. A second schedule
 * for the same fact is a second schedule to keep in step, and the sweep that
 * closes the month is by definition on time for this.
 *
 * ## Three things, in order
 *
 * 1. **Reconcile.** A claim that never reported an outcome is asked about in
 *    Stripe, and either recorded or released. It comes first because a stuck
 *    open charge blocks the close-out behind it.
 * 2. **Close out.** Whatever is left unbilled is invoiced, however small —
 *    down to Stripe's minimum, below which it is carried rather than sent as
 *    an invoice nobody can pay.
 * 3. **Correct the ladder.** A month that ended with an AI charge unpaid is
 *    taken back off the workspace's qualifying months. A month in which a
 *    workspace both paid an invoice and left an AI charge unpaid is not
 *    evidence of the thing the ladder measures.
 *
 * Idempotent, because the sweep calls it every day the month is closed: the
 * reconcile is a no-op once the charge is settled, the close-out claims
 * nothing once there is nothing unbilled, and the month is dropped from the
 * ladder only while it is on it.
 */

import type { PluginMeteredLineMonthContext } from '@aglyn/aglyn/plugin-manager/plugin-metered-lines'
import {
  closeOutAiOverage,
  reconcileAiOverageCharge,
} from './ai-overage-charge'
import {
  AI_OVERAGE_CHARGES_SUBCOLLECTION,
  readAiOverageMonthLedger,
} from './ai-overage-ledger'
import { dropAiOverageQualifyingMonth } from './ai-overage-standing-writes'
import { aiOverageFirestore } from './ai-overage-trigger'

/** How many of a month's charge rows the close-out will look at. */
const CHARGE_SCAN = 100

/** What the close-out did, for the sweep's log and the specs. */
export interface AiOverageCloseResult {
  reconciled: number
  closedOutUsd: number
  droppedFromLadder: boolean
}

/**
 * Settles one workspace's closed month.
 *
 * Errors are the caller's to isolate — the registry logs and continues — but
 * each step is attempted independently so one workspace's failed Stripe call
 * does not cost it the ladder correction it also needed.
 */
export async function closeAiOverageMonth(
  context: PluginMeteredLineMonthContext,
  now = new Date(),
): Promise<AiOverageCloseResult> {
  const firestore = aiOverageFirestore()
  const orgRef = firestore.collection('orgs').doc(context.orgId)
  const usageSnapshot = await orgRef
    .collection('assistUsage')
    .doc(context.month)
    .get()
  const ledger = readAiOverageMonthLedger(
    usageSnapshot.exists ? (usageSnapshot.data() ?? null) : null,
  )
  const result: AiOverageCloseResult = {
    reconciled: 0,
    closedOutUsd: 0,
    droppedFromLadder: false,
  }
  // A month that never sold any overage has nothing here at all, and asking
  // Stripe about it would be a round trip per workspace per day.
  if (!ledger.charges && !ledger.invoicedUsd && !ledger.open) {
    return result
  }

  // 1. An open claim that never reported. `since` is on the open slot, so
  //    its age is known without a second read.
  if (ledger.open) {
    const open = usageSnapshot.get('overageInvoiceOpen') as
      | { since?: unknown }
      | null
      | undefined
    const since = Date.parse(String(open?.since ?? ''))
    const claimedAgeMs = Number.isFinite(since)
      ? Math.max(0, now.getTime() - since)
      : Number.MAX_SAFE_INTEGER
    const reconciled = await reconcileAiOverageCharge(firestore, {
      orgId: context.orgId,
      month: context.month,
      chargeId: ledger.open.chargeId,
      claimedAgeMs,
    })
    if (reconciled.resolved) result.reconciled = 1
  }

  // 2. The remainder.
  const closed = await closeOutAiOverage(firestore, {
    orgId: context.orgId,
    org: context.org as never,
    month: context.month,
    stripeCustomerId: context.stripeCustomerId,
    now,
  })
  if (closed.charged) {
    const after = await orgRef.collection('assistUsage').doc(context.month).get()
    result.closedOutUsd =
      readAiOverageMonthLedger(after.data() ?? null).invoicedUsd - ledger.invoicedUsd
  }

  // 3. The ladder. Read AFTER the two steps above, so a charge they settled
  //    is not counted as unpaid.
  if (await aiOverageMonthLeftUnpaid(orgRef, context.month)) {
    await dropAiOverageQualifyingMonth(firestore, context.orgId, context.month)
    result.droppedFromLadder = true
  }
  return result
}

/**
 * Did this month end with an AI overage charge still unpaid?
 *
 * `failed` and `open` both count; `void` does not — an invoice written off
 * is a decision that the money is not owed, not a debt the workspace left.
 * A `claimed` row that survived the reconcile above counts too: something
 * claimed the money and never billed it, which is exactly the state that
 * should not raise a ceiling.
 */
async function aiOverageMonthLeftUnpaid(
  orgRef: FirebaseFirestore.DocumentReference,
  month: string,
): Promise<boolean> {
  const charges = await orgRef
    .collection(AI_OVERAGE_CHARGES_SUBCOLLECTION)
    .where('month', '==', month)
    .limit(CHARGE_SCAN)
    .get()
  return charges.docs.some((doc) =>
    ['claimed', 'open', 'failed'].includes(String(doc.get('status') ?? '')),
  )
}

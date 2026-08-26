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

import { orgCogsInputFrom, orgMonthlyCogsUsd } from '@aglyn/aglyn/server'
import { firebaseAdmin } from '@aglyn/tenant-data-admin'

/**
 * The org's latest MEASURED monthly cost, for `checkDiscountMargin`'s
 * `measuredCogsUsd` (AGL-1120).
 *
 * Extracted from `api/admin/org-discount/route.ts` when the retention funnel
 * became a second discount-minting path (AGL-2118). Two copies of "what does
 * this org cost us" is how the browser preview and the enforcing route came to
 * price the same org differently once already — the comment inside about one
 * shared field list (AGL-1134) is the scar from that.
 *
 * Reads the newest `orgs/{id}/usage/{month}` rollup and prices ALL SIX metered
 * dimensions through `orgMonthlyCogsUsd` — the metering estimate on the
 * document itself covers only storage, page views and form submissions.
 *
 * PLUS Aglyn Assist provider spend for that same month (AGL-2280), read live
 * from `orgs/{id}/assistUsage/{month}.estCostUsd`. Assist cost had five
 * writers and two readers — the budget alert and the billing card — and
 * neither of them is the margin model, so the one cost line that can actually
 * clear the $2/site floor never reached the discount guardrail at all. the * standing constraint is that Assist must not eat margins; a guardrail that
 * cannot see Assist cannot enforce it.
 *
 * SAME MONTH as the rollup, not "now". The cron writes the CLOSED month, so
 * pairing its rollup with the current month's Assist spend would report two
 * different periods as one figure — the exact mistake `/api/billing/
 * usage-budget` refuses one field over.
 *
 * The live read wins over any `assistCostUsd` the rollup itself carries: the
 * rollup is a snapshot taken when the cron ran, and Assist keeps spending
 * after it.
 *
 * Returns null when there is no rollup, which is the honest answer:
 * `checkDiscountMargin` then falls back to the flat per-site estimate rather
 * than treating "not measured" as "costs nothing".
 *
 * BEST-EFFORT BY DESIGN. A missing index or a read failure must not block the
 * caller — the flat floor still applies, and it is the floor, not this, that
 * decides every org today (the largest real org measured $0.0000054 against a
 * $4.00 two-site floor).
 */
export async function latestMeasuredCogsUsd(
  orgId: string,
): Promise<number | null> {
  try {
    const orgRef = firebaseAdmin
      .app()
      .firestore()
      .collection('orgs')
      .doc(orgId)
    const snapshot = await orgRef
      .collection('usage')
      .orderBy('month', 'desc')
      .limit(1)
      .get()
    const rollup = snapshot.docs[0]
    if (!rollup) return null
    // The rollup's own month, so the Assist figure covers the same period the
    // six meters do. `month` is written on every rollup; the id is the same
    // string and is the fallback for a document written before it was.
    const month = String(rollup.get('month') ?? rollup.id)
    const assist = await orgRef.collection('assistUsage').doc(month).get()
    const assistCostUsd = Number(assist.get('estCostUsd') ?? 0)
    const { measuredUsd } = orgMonthlyCogsUsd(
      {
        // One shared list of priced fields (AGL-1134) rather than a copy per
        // call site.
        ...orgCogsInputFrom(rollup.data()),
        // Live, and therefore last — see the note above about the snapshot
        // going stale between cron runs.
        ...(Number.isFinite(assistCostUsd) && assistCostUsd > 0
          ? { assistCostUsd }
          : {}),
      },
      // Site count comes from `checkDiscountMargin`, which applies the flat
      // floor itself — passing 0 here keeps this the MEASURED half only, so
      // the floor is not applied twice.
      0,
    )
    return Number.isFinite(measuredUsd) ? measuredUsd : null
  } catch (error) {
    console.error('[org-cogs] usage rollup read failed', orgId, error)
    return null
  }
}

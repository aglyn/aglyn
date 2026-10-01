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
  liveMeterReading,
  pluginCostAxes,
} from '@aglyn/aglyn/plugin-manager/plugin-usage-axes'
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
 * Reads the newest `orgs/{id}/usage/{month}` rollup and prices every metered
 * dimension through `orgMonthlyCogsUsd` — the platform's own and each one a
 * plugin declares (`plugin-usage-axes.ts`) — where the metering estimate on
 * the document itself covers only storage, page views and form submissions.
 *
 * PLUS the LIVE reading of each cost axis a plugin declares one for, for that
 * same month: today the AI plugin's provider spend, which is what the tokens
 * cost us rather than what they drew (AGL-3015), and the one cost line that
 * can clear the $2/site floor on its own. A guardrail that could not see it
 * could not keep it from eating the margin (AGL-2280).
 *
 * SAME MONTH as the rollup, not "now". The cron writes the CLOSED month, so
 * pairing its rollup with the current month's live reading would report two
 * different periods as one figure — the exact mistake `/api/billing/
 * usage-budget` refuses one field over.
 *
 * The live reading wins over the figure the rollup itself carries: the
 * rollup is a snapshot taken when the cron ran, and the meter keeps counting
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
    // The LIVE reading of each cost axis a plugin declares one for, from the
    // same month — the AI plugin's provider spend, what the tokens cost us
    // rather than what they drew (AGL-3015).
    const live: Record<string, number> = {}
    for (const axis of pluginCostAxes()) {
      if (!axis.live) continue
      const snapshot = await orgRef.collection(axis.live.collection).doc(month).get()
      const reading = liveMeterReading(snapshot, axis.live)
      if (reading !== undefined) live[axis.fields[0]!] = reading
    }
    const { measuredUsd } = orgMonthlyCogsUsd(
      {
        // One shared list of priced fields (AGL-1134) rather than a copy per
        // call site.
        ...orgCogsInputFrom(rollup.data()),
        // Live, and therefore last — see the note above about the snapshot
        // going stale between cron runs.
        ...live,
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

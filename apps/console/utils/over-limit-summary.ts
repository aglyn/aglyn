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
'use client'

import { PLAN_ENTITLEMENTS, type OrgPlan } from '@aglyn/aglyn'
import {
  collection,
  getCountFromServer,
  getDocsFromServer,
  type Firestore,
} from 'firebase/firestore'
import fetchSeatCounts from './fetch-seat-counts'
import { overLimitRows, overLimitSummaryLine } from './over-limit'

/**
 * Roles that count as holding a site — the same set `use-org-hosts` filters
 * the membership mirror on. Declared rather than imported as a value: the
 * `@aglyn/aglyn` barrel is already pulled in for `PLAN_ENTITLEMENTS`, but the
 * hook's own comment is right that this is a small closed set, and keeping the
 * two identical is the point.
 */
const HOST_ACCESS_ROLES = new Set(['admin', 'editor', 'author', 'viewer'])

/**
 * Sites the user holds in this org, counted once from the membership mirror.
 *
 * Only used when the caller has no host list already loaded — the Billing page
 * does (`useOrgHosts`), the Settings page does not and should not mount a live
 * host listener just to warn about a downsell. Returns null when the read
 * fails: an unanswerable count is not zero (see `fetchSeatCounts`).
 */
async function countOrgSites(
  firestore: Firestore,
  uid: string | undefined,
  orgId: string,
): Promise<number | null> {
  if (!uid) return null
  try {
    const snapshot = await getDocsFromServer(
      collection(firestore, 'users', uid, 'hostMemberships'),
    )
    return snapshot.docs.filter((row) => {
      const value = row.data() as { orgId?: string; role?: string }
      if (value.orgId !== orgId) return false
      return value.role === undefined || HOST_ACCESS_ROLES.has(value.role)
    }).length
  } catch {
    return null
  }
}

/**
 * What the org will be over on a target plan (AGL-483): sites, team seats and
 * datasets.
 *
 * Downgrades never delete anything, but the customer is entitled to know what
 * they will be over BEFORE they choose. Shared (AGL-2154) because the same
 * plan change was warned about from the plan grid and said nothing from the
 * retention funnel and the org-deletion downsell — the paths where the
 * customer is least attached and most likely to be surprised later.
 *
 * Both counts return null on failure and are REPORTED as unchecked rather than
 * omitted, so the summary can never read as a clean bill of health it did not
 * earn: the reassuring failure is the dangerous one here.
 *
 * The COUNTING is here; the COMPARISON is in `over-limit.ts`, shared with the
 * server-side downgrade refusal. This surface tells the customer what a plan
 * change would leave them over; `/api/billing/subscription` refuses the change
 * while it would. A refusal that disagreed with the warning that preceded it
 * would be worse than either alone, so there is one rule and two readers.
 */
export async function overLimitSummary(options: {
  firestore: Firestore
  user: { uid?: string; getIdToken?: () => Promise<string> } | null | undefined
  orgId: string | null | undefined
  targetPlan: OrgPlan
  /**
   * Sites the caller already has in hand. `undefined` means "count them" —
   * `null` means the caller knows it cannot answer.
   */
  siteCount?: number | null
}): Promise<string[]> {
  const { firestore, user, orgId, targetPlan } = options
  // An unknown plan is refused BEFORE the counts, so a typo costs no reads.
  // The comparison itself lives in `over-limit.ts`; this is existence only.
  if (!PLAN_ENTITLEMENTS[targetPlan] || !orgId) return []
  const [seatCounts, datasetCount, siteCount] = await Promise.all([
    fetchSeatCounts(user, orgId),
    getCountFromServer(collection(firestore, 'orgs', orgId, 'datasets'))
      .then((snapshot) => snapshot.data().count)
      .catch(() => null),
    options.siteCount === undefined
      ? countOrgSites(firestore, user?.uid, orgId)
      : Promise.resolve(options.siteCount),
  ])
  // An unanswerable count is NOT "you are under the limit" — `overLimitRows`
  // emits a row for it rather than omitting it, so the confirmation cannot
  // read as a clean bill of health it never earned.
  //
  // Every row measures what the plan INCLUDES (`hostLimit`, `managersPerOrg`,
  // `datasetsPerOrg`), never the purchase CEILING (`maxDatasetsPerOrg` and
  // friends) — the two are far apart, Starter includes 3 datasets and sells up
  // to 10, and measuring against the ceiling printed a number the word
  // "includes" makes false while clearing an org that a plan change strands.
  return overLimitRows(
    {
      siteCount,
      managerSeats: seatCounts == null ? null : seatCounts.managerSeats,
      datasetCount,
    },
    targetPlan,
  ).map((row) => overLimitSummaryLine(row, targetPlan))
}

export default overLimitSummary

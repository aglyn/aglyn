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
 * The org-scoped GA user properties (AGL-1852), decided in one pure function
 * so a spec can pin the clearing semantics — the `internal-traffic.ts`
 * shape, for the same reason: the wrong direction here is expensive and
 * invisible in reports.
 *
 * `org_plan` and `org_role` are what let ANY behaviour split by who pays:
 * "activation rate of paying orgs", the checkout-abandoner audience by tier.
 * Both are non-identifying account attributes — a tier name and a role word
 * — beside the opaque-uid `user_id` the console has set since AGL-118.
 *
 * ## The clearing rule is the load-bearing half
 *
 * The console does not remount across a re-auth (AGL-664), and user
 * properties PERSIST on the GA user until overwritten. A staff member
 * signing out of a Pro workspace followed by a free-tier customer on the
 * same document would otherwise keep reporting `org_plan: 'pro'` — so every
 * unknown resolves to an explicit `null` (Firebase's "unset"), never to a
 * stale carry-over. Same discipline as the AGL-1582 `traffic_type` stamp.
 *
 * `plan` is passed by the caller from `useOrgPlans`, which already owns the
 * two semantics that matter: an enterprise override reads "enterprise", and
 * an org doc with NO `plan` field means FREE — a paid plan is the only thing
 * the webhook writes. While the plan read is still in flight the value is
 * `undefined`, and that maps to null too: "not loaded" must not report as
 * anything (see the loading-default lore — a default answers a question).
 */
// The index signature is what `firebase/analytics`' `setUserProperties`
// accepts (`CustomParams`); the named keys are the contract.
export interface OrgAnalyticsUserProperties
  extends Record<string, string | null> {
  org_plan: string | null
  org_role: string | null
}

export function buildOrgUserProperties(input: {
  /** The active workspace's uid, or null/undefined outside org scope. */
  orgId?: string | null
  /** The membership role in that workspace, from the reverse-index mirror. */
  role?: string | null
  /** `useOrgPlans` answer for that org; undefined while loading/failed. */
  plan?: string | null
}): OrgAnalyticsUserProperties {
  if (!input.orgId) {
    return { org_plan: null, org_role: null }
  }
  return {
    org_plan: input.plan ?? null,
    org_role: input.role ?? null,
  }
}

export default buildOrgUserProperties

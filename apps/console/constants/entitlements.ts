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
  type AglynOrgBilling,
  checkEntitlement,
  checkQuota,
  checkSeatQuota,
  type SeatKind,
  type SeatQuotaResult,
  type OrgFeatureFlags,
} from '@aglyn/aglyn'

/**
 * The console's feature-gate key — the org flag name itself (AGL-2079).
 *
 * This was a hand-written kebab-case union of 20 names plus a `FEATURE_KEYS`
 * map onto `OrgFeatureFlags`. The indirection bought nothing and cost the
 * thing that matters: the union covered 20 of the 34 flags, so the commerce
 * and enterprise flags (`ssoEnabled`, `whiteLabel`, `contentGating`,
 * `giftCards`, …) were structurally invisible to anything that enumerated it
 * and had to be checked ad hoc through `checkEntitlement`. A second list of
 * the same names can only ever drift from the first.
 *
 * Aliased to `keyof OrgFeatureFlags` so it cannot: adding a flag to the type
 * adds it here, and no rename is needed on either side.
 */
export type Entitlement = keyof OrgFeatureFlags

/**
 * Resolves through the plan/override model (`resolveOrgEntitlements`,
 * AGL-38/247). The old dark-launch rule ("no plan = every feature") let
 * plan-less orgs reach paid features while paid orgs were gated — orgs
 * without a plan now resolve as `free`, and a dead subscription
 * (canceled/unpaid/incomplete) downgrades a paid plan to `free` inside
 * `resolveEffectivePlan`. Loading states should pass the org doc only
 * once it has resolved (undefined org still checks as free).
 */
export function hasEntitlement(
  feature: Entitlement,
  org?: Partial<AglynOrgBilling> | null,
): boolean {
  return checkEntitlement(org, feature)
}

/** Quota gate on the same effective-plan resolution (AGL-247). */
export function checkOrgQuota(
  org: Partial<AglynOrgBilling> | null | undefined,
  quota: Parameters<typeof checkQuota>[1],
  currentUsage: number,
): ReturnType<typeof checkQuota> {
  return checkQuota(org, quota, currentUsage)
}

/** Seat quota (AGL-112) on the same effective-plan resolution. */
export function checkOrgSeatQuota(
  org: Partial<AglynOrgBilling> | null | undefined,
  kind: SeatKind,
  currentUsage: number,
): SeatQuotaResult {
  return checkSeatQuota(org, kind, currentUsage)
}

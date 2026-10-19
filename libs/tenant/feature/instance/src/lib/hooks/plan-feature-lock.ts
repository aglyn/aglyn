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
  checkEntitlement,
  planLabelGrantingFeature,
  type OrgFeatureFlags,
} from '@aglyn/aglyn'

/**
 * A plan-gated feature as a console surface draws it: on, locked with the
 * plan that unlocks it, or not yet known.
 */
export interface PlanFeatureLock {
  /** The plan doc has settled. NEVER refuse before this is true. */
  ready: boolean
  /** The plan (or a purchased add-on, or an override) includes the feature. */
  entitled: boolean
  /**
   * `ready && !entitled`: the one state in which a control is drawn disabled
   * with an upgrade path. A pending plan draws nothing locked, because
   * `checkEntitlement(undefined)` answers with the FREE tier and a paying
   * workspace would see its own feature refused while its doc loads.
   */
  locked: boolean
  /** The cheapest plan carrying the feature ("Business"), if any plan does. */
  planLabel: string | undefined
  /**
   * The console's plan grid (`/{org}/billing#plans`), or its add-ons section
   * for a feature no plan carries. Undefined until the org slug is known.
   */
  upgradeHref: string | undefined
}

/**
 * The lock state for one feature, from an org billing doc the caller already
 * holds: the console's `useCurrentOrg()`, or a plugin's `useOrgPlan`.
 *
 * Free sees what the paid plans add instead of a console with pieces missing,
 * so every surface that gates on a plan feature draws its control from this
 * one answer: disabled, with the plan that includes it and a link to buy it.
 *
 * `planLabel` is derived from `PLAN_ENTITLEMENTS` on every call, so a notice
 * can never name a tier that no longer carries the feature.
 */
export function resolvePlanFeatureLock(input: {
  org: unknown
  ready: boolean
  feature: keyof OrgFeatureFlags
  orgSlug: string | null | undefined
}): PlanFeatureLock {
  const { org, ready, feature, orgSlug } = input
  const entitled = checkEntitlement(org as never, feature)
  const planLabel = planLabelGrantingFeature(feature)
  return {
    ready,
    entitled,
    locked: ready === true && !entitled,
    planLabel,
    upgradeHref: orgSlug
      ? `/${orgSlug}/billing#${planLabel ? 'plans' : 'addons'}`
      : undefined,
  }
}

/**
 * The one sentence a locked control carries, on hover and for a screen
 * reader: "Scheduled publishing is included from Business."
 */
export function planLockReason(
  subject: string,
  planLabel: string | undefined,
): string {
  return planLabel
    ? `${subject} is included from ${planLabel}.`
    : `${subject} is a paid add-on.`
}

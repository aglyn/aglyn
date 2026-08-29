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
  planGrantingFeature,
  type OrgFeatureFlags,
} from '@aglyn/aglyn'

/**
 * The shell's feature-flag gate for plugin surfaces (AGL-2484).
 *
 * `ConsoleExtension` has always been documented as gated by the shell —
 * "the shell owns rendering and applies the feature-flag gate, so extensions
 * cannot bypass entitlements". Nothing applied it. The plugin route resolved
 * `entitled` and passed it to the extension as a PROP, and the widget slot
 * did not resolve it at all, so enforcement of a paid feature depended on
 * each extension choosing to enforce it against itself. One first-party page
 * (`workflows-console-page.tsx`) never reads the prop.
 *
 * This function is the gate, in one place, so the two console surfaces that
 * render extension code cannot answer the question differently.
 *
 * THREE states, not two. `checkEntitlement(undefined)` resolves the FREE
 * tier, which means "the org doc has not arrived yet" and "the org is not
 * entitled" are the same value — the AGL-1380 defect that told paying orgs
 * across twelve surfaces that the feature they bought was not on their plan.
 * So an unsettled org is `pending`: the shell renders neither the surface nor
 * a claim about the plan. Refusal is only ever spoken from a settled read.
 */
export type ExtensionEntitlement = 'entitled' | 'blocked' | 'pending'

export function resolveExtensionEntitlement(
  featureFlag: keyof OrgFeatureFlags | undefined,
  org: unknown,
  orgReady: boolean,
): ExtensionEntitlement {
  // An extension that declares no flag is not plan-gated; it renders for
  // everyone, and must not be held behind the org read.
  if (featureFlag === undefined || featureFlag === null) return 'entitled'
  // `strictNullChecks` is off repo-wide, so this is an explicit comparison
  // rather than a truthiness test — `undefined` here means "unknown", and
  // unknown must never resolve to "ready".
  if (orgReady !== true) return 'pending'
  return checkEntitlement(org as never, featureFlag) === true
    ? 'entitled'
    : 'blocked'
}

/**
 * The refusal sentence for a `blocked` plugin surface (owner feedback: the
 * Events page told an org an upgrade would include it, which is never true).
 *
 * "`${title}` is not included in your current plan" implies a HIGHER plan
 * would include it — true for most gated features, but `eventCalendar` is
 * `false` on every one of the eight plans (`PLAN_ENTITLEMENTS`) and is sold
 * instead as a per-org add-on, so that sentence is a standing lie for it no
 * matter which plan the org is on. `planGrantingFeature` is the same ladder
 * walk `planLabelGrantingFeature` already trusts elsewhere to answer "which
 * plan carries this" — its `undefined` answer means no plan does, which is
 * exactly the condition that makes the "upgrade" framing wrong.
 */
export function blockedExtensionNotice(
  title: string,
  featureFlag: keyof OrgFeatureFlags | undefined,
): string {
  const grantedByAPlan =
    featureFlag != null && planGrantingFeature(featureFlag) !== undefined
  return grantedByAPlan
    ? `${title} is not included in your current plan. Manage your plan and ` +
        'add-ons from Billing.'
    : `${title} isn't included in any plan — it's a paid add-on. Manage ` +
        'your plan and add-ons from Billing.'
}

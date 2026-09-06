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
  planLabelGrantingFeature,
  type ConsoleUpgradeNotice,
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
 * Several gates as one verdict (AGL-2611): an extension's flag AND a
 * section's or a widget's own, the way `resolveExtensionPermission` ANDs
 * the extension's permission with a surface's.
 *
 * `blocked` outranks `pending` outranks `entitled`, and the order is the
 * whole function. A settled refusal is a refusal whatever else is still
 * loading; an unsettled read holds the surface shut even beside a flag that
 * has already answered yes, because rendering on the answered half would
 * paint a paid section for the one paint the other half took to say no.
 * Declaring nothing composes as `entitled`, so a surface that names no
 * flag of its own inherits its extension's verdict unchanged.
 */
export function composeExtensionEntitlements(
  ...verdicts: readonly ExtensionEntitlement[]
): ExtensionEntitlement {
  if (verdicts.includes('blocked')) return 'blocked'
  if (verdicts.includes('pending')) return 'pending'
  return 'entitled'
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
  // The tier that carries it, named — the "Included from Starter" affordance
  // every other gated console surface ends its refusal with, derived from
  // the same ladder walk so it can never name a plan that no longer grants
  // the feature.
  return grantedByAPlan
    ? `${title} is not included in your current plan. Manage your plan and ` +
        `add-ons from Billing. Included from ${planLabelGrantingFeature(
          featureFlag,
        )}.`
    : `${title} isn't included in any plan — it's a paid add-on. Manage ` +
        'your plan and add-ons from Billing.'
}

/**
 * Fragment ids on the billing page that sell something, and so are worth
 * scrolling a refused reader to. Kept as a literal list rather than derived,
 * because the thing being guarded against is a value that resolves to no
 * element — a list built from the page could not tell the difference.
 */
const BILLING_UPGRADE_ANCHORS: readonly string[] = [
  'addons',
  'register-seats',
  'collaborator-seats',
]

/**
 * The billing fragment an extension asked to link to, or `undefined`.
 *
 * The extension names it; this decides whether it is real. An unrecognized
 * value degrades to the plain Billing link, which is why the return is a
 * bare fragment id and never a URL: the caller owns the route, so no value
 * arriving here can move the destination off the console's billing page.
 */
export function resolveUpgradeNoticeAnchor(
  notice: ConsoleUpgradeNotice | undefined,
): string | undefined {
  const anchor = notice?.billingAnchor
  return typeof anchor === 'string' && BILLING_UPGRADE_ANCHORS.includes(anchor)
    ? anchor
    : undefined
}

/**
 * The sentence a blocked org reads: the extension's own, when it supplied
 * one, else `blockedExtensionNotice`.
 *
 * TWO layers, not two mechanisms. `blockedExtensionNotice` is derived — it
 * walks `PLAN_ENTITLEMENTS` and is therefore right about every feature
 * without being told anything, which is why it stays the floor and no
 * surface bypasses it. What it cannot know is a specific price or which
 * billing card sells it, because those live nowhere in the entitlement
 * tables. An extension that knows its own commercial terms may say them
 * instead, and one that says nothing keeps the derived sentence.
 *
 * Read only once `resolveExtensionEntitlement` has already answered
 * `blocked` (AGL-2484): this phrases a refusal, it never decides one.
 */
export function upgradeNoticeMessage(
  notice: ConsoleUpgradeNotice | undefined,
  surfaceTitle: string,
  featureFlag: keyof OrgFeatureFlags | undefined,
): string {
  const message = notice?.message
  return typeof message === 'string' && message.trim()
    ? message
    : blockedExtensionNotice(surfaceTitle, featureFlag)
}

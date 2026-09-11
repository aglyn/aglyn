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
  RELEASE_FLAGS,
  type ConsoleNavSection,
  type OrgFeatureFlags,
  type ReleaseFlagKey,
  type ResolvedConsoleNavSection,
} from '@aglyn/aglyn'
import {
  composeExtensionEntitlements,
  resolveExtensionEntitlement,
} from './extension-entitlement'

/**
 * The release flag a nav tab id names, if any — the gate the nav strip
 * applies, looked up the same way by the page that serves the tab's URL so
 * a deep link leaks nothing the strip hides.
 */
export function releaseFlagForNavTab(
  navTabId: string | undefined,
): ReleaseFlagKey | undefined {
  if (!navTabId) return undefined
  return RELEASE_FLAGS.find((flag) => flag.navTabId === navTabId)?.key
}

export interface HubSectionVerdicts {
  /** `useReleaseFlags().flags` — the per-flag rollout state. */
  flags: Readonly<Record<ReleaseFlagKey, { released: boolean }>>
  /** `useReleaseFlags().isStaff` — the bypass `FeatureGate` honors. */
  isStaff: boolean
  /** The org billing doc the entitlement is judged from, and whether it settled. */
  org: unknown
  orgReady: boolean
  /**
   * The entitlement the hub's EXTENSION declares, when it declares one. A
   * section inside a surface the plan lacks is locked whatever it declares
   * itself, so the rail never draws a section open beside the notice that
   * refuses it.
   */
  featureFlag?: keyof OrgFeatureFlags
}

/**
 * A hub's declared sections with the shell's answers filled in: an absolute
 * href, the release verdict this viewer gets, and the plan verdict the org
 * gets (AGL-2501, AGL-2611).
 *
 * Shared by the two shells that mount a plugin hub — the site route and the
 * organization-level CRM route (AGL-2630) — so the rail each draws is
 * resolved by one rule. `visible` is `released || isStaff`, the same reading
 * `FeatureGate` uses, so the rail offers exactly what the gate admits; a
 * plugin cannot compute this for itself, because release flags are
 * `scope:app`, and a rail that guessed would link into the shell's own
 * "coming soon" notice. `locked` is the entitlement verdict and nothing
 * else — the extension's flag and the section's own, composed the way the
 * page body composes them — `blocked`, never `pending`, so an unsettled org
 * draws no lock, the same three-state care the page body takes. Staff draw
 * the locks a member draws: the plan is a fact about the workspace.
 */
export function resolveHubSections(
  sections: readonly ConsoleNavSection[] | undefined,
  basePath: string | undefined,
  verdicts: HubSectionVerdicts,
): readonly ResolvedConsoleNavSection[] | undefined {
  if (!sections?.length || !basePath) return undefined
  const { flags, isStaff, org, orgReady, featureFlag } = verdicts
  const surface = resolveExtensionEntitlement(featureFlag, org, orgReady)
  return sections.map((section) => {
    const flagKey = releaseFlagForNavTab(section.navTabId)
    return {
      id: section.id,
      label: section.label,
      href: `${basePath}/${section.id}`,
      visible: flagKey ? flags[flagKey].released || isStaff : true,
      locked:
        composeExtensionEntitlements(
          surface,
          resolveExtensionEntitlement(section.featureFlag, org, orgReady),
        ) === 'blocked',
    }
  })
}

/**
 * Where a bare hub URL lands: the FIRST section this reader may OPEN —
 * released, and on the plan (AGL-2501, AGL-2611).
 *
 * Skipping past a flagged-off or locked first section is the rule: a bare
 * hub URL on a plan that lacks its first section lands on the next section
 * the plan has rather than on an upgrade notice, and a redirect into a
 * section the gate would refuse answers the nav tab with a "coming soon"
 * notice.
 * `undefined` when nothing is open to this reader — every section locked,
 * as the whole CRM is on a plan without it — which the shell renders as the
 * hub's upgrade notice beside the rail rather than looping.
 */
export function hubLandingHref(
  sections: readonly ResolvedConsoleNavSection[] | undefined,
): string | undefined {
  return sections?.find((section) => section.visible && !section.locked)?.href
}

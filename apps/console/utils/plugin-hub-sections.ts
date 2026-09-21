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
import {
  resolveExtensionPermission,
  type PermissionAnswers,
} from './extension-permission'

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
  /**
   * Where a section's own `permission` key is looked up (AGL-3080) — the
   * shell's `useOrgPermissions()`, passed whole because the two key spaces
   * are answered separately and `loaded` is what tells `pending` from
   * `refused`.
   *
   * Omitted, every section resolves as it did before this gate existed: the
   * hubs that declare no section permission are unaffected, and a caller
   * that forgets to pass it cannot silently OPEN a gated section — a
   * declared key with no answers to check it against is `pending`, which
   * hides the section rather than offering it.
   */
  permission?: PermissionAnswers
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
 *
 * The third gate is the section's own `permission` (AGL-3080), and it is the
 * one gate that SUBTRACTS the tab rather than locking it: a plan is something
 * the workspace can buy and a permission is not, so a locked-looking tab
 * would send a member to Billing to fix a thing only an owner can grant.
 * `refused` carries the reason out, so a deep link into a hidden section is
 * answered with the refusal that applies rather than with the release flag's
 * "coming soon".
 */
export function resolveHubSections(
  sections: readonly ConsoleNavSection[] | undefined,
  basePath: string | undefined,
  verdicts: HubSectionVerdicts,
): readonly ResolvedConsoleNavSection[] | undefined {
  if (!sections?.length || !basePath) return undefined
  const { flags, isStaff, org, orgReady, featureFlag, permission } = verdicts
  const surface = resolveExtensionEntitlement(featureFlag, org, orgReady)
  const answers: PermissionAnswers = permission ?? {
    can: () => false,
    permissions: undefined,
    loaded: false,
  }
  return sections.map((section) => {
    const flagKey = releaseFlagForNavTab(section.navTabId)
    const released = flagKey ? flags[flagKey].released || isStaff : true
    /*
     * The permission gate, resolved for the rail exactly as the page body
     * resolves it (AGL-3080). A section this refuses is HIDDEN rather than
     * locked: `locked` draws a tab that links to the notice selling the
     * plan, and a permission is not something the reader can buy — offering
     * it would send a member to Billing to fix a thing only an owner can
     * grant. `pending` hides it too, because the permission map answers as
     * an admin's until the member read lands, so drawing on it would offer
     * a seller's tab to every member for the paint before it vanished.
     */
    const permitted = resolveExtensionPermission(
      section.permission ? [section.permission] : [],
      answers,
    )
    return {
      id: section.id,
      label: section.label,
      href: `${basePath}/${section.id}`,
      visible: released && permitted === 'granted',
      locked:
        composeExtensionEntitlements(
          surface,
          resolveExtensionEntitlement(section.featureFlag, org, orgReady),
        ) === 'blocked',
      refused: permitted === 'refused',
      landsOnQuery: section.landsOnQuery,
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
 * `undefined` when nothing is open to this reader — every section locked, as
 * the whole CRM is on a plan without it, or every section refused, as a
 * seller-only hub is to a member — which the shell renders as the hub's own
 * notice beside the rail rather than looping.
 */
export function hubLandingHref(
  sections: readonly ResolvedConsoleNavSection[] | undefined,
  search?: URLSearchParams | null,
): string | undefined {
  const open = (section: ResolvedConsoleNavSection) =>
    section.visible && !section.locked
  /*
   * A marker somebody else is holding wins over the bare rule (AGL-3080):
   * a seller returning from Stripe Connect wants Payouts and a buyer
   * returning from checkout wants what they now own, and neither is the
   * section a bare hub URL lands on. Presence only — the value is the third
   * party's business, and reading it would make a marker we cannot see
   * ahead of time into a routing decision.
   *
   * Still `open`: a claim does not lift a gate. A section the reader may
   * not open is not landed on, and the bare rule takes over, which is the
   * same answer they would get typing the hub's address by hand.
   */
  if (search) {
    const claimed = sections?.find(
      (section) =>
        open(section) &&
        section.landsOnQuery?.some((key) => search.has(key)),
    )
    if (claimed) return claimed.href
  }
  return sections?.find(open)?.href
}

/**
 * A hub redirect with the incoming query carried across — the client-side
 * twin of `sectionIndexTarget` (AGL-3080).
 *
 * A redirect that drops the query silently deletes information somebody else
 * put in the URL, and the generic plugin routes redirect a bare hub address
 * in the browser rather than on the server. Carried WHOLE rather than by an
 * allow-list, for the reason the server helper carries it whole: a marker
 * nothing routes on today still survives the hop.
 */
export function hubRedirectTarget(
  href: string,
  search?: URLSearchParams | null,
): string {
  const query = search?.toString()
  return query ? `${href}?${query}` : href
}

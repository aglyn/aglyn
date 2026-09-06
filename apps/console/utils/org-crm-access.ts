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

import type { OrgPermission } from '@aglyn/aglyn'

/**
 * WHO MAY OPEN THE ORGANIZATION-LEVEL CRM.
 *
 * The org CRM hub (`/[orgSlug]/crm`, AGL-2630) is the one surface in the
 * product that deliberately reads ACROSS the host boundary: every section
 * lists every site's records at once, and the contacts section answers which
 * of an organization's sites know a given person, which is a fact about every
 * site at once. Every other CRM surface is scoped by `visibleTo` and proves
 * itself per document. This one does not — its listeners carry no scope
 * clause — so this decision is the whole of what keeps it from becoming the
 * leak the per-host work closed. It was written for the read-only address
 * book that lived at `/[orgSlug]/contacts` and it is unchanged by the hub
 * that replaced it: the reasoning below is about REACH, and a hub that can
 * also write makes it more load-bearing, not less.
 *
 * ## A ROLE IS NOT A REACH, and that is the defect this exists to avoid
 *
 * A SITE COLLABORATOR is a real `orgs/{orgId}/members/{uid}` document —
 * `grantHostAccess` writes one, which is how they get into the console at all
 * — carrying `role: 'editor'` with `allHosts: false` and a `hostAccess` map
 * naming their sites. They are frequently a single client of an agency, or a
 * contractor hired for one microsite.
 *
 * `resolveOrgPermissions` reads the ROLE and nothing else, so
 * `DEFAULT_ROLE_PERMISSIONS.editor` hands that collaborator
 * `data.manage: true`. A gate written as `can('data.manage')` therefore
 * ADMITS them — it reads like an org-level check and is not one. That shape
 * has already shipped once: `/api/resources/erase` gated on the writer role
 * set and let a collaborator destroy datasets across the whole org, including
 * ones the rules forbade them to read.
 *
 * So reach is checked FIRST and separately, and it is checked as reach:
 * `isOrgWideMembership`, the same predicate `OrgGuard` and the nav strip use.
 * A permission cannot substitute for it and no permission grant can restore
 * it.
 *
 * ## The permission half, and why it is `data.manage`
 *
 * `data.manage` is the catalog key whose subject is exactly this data: the
 * Firestore rules place contacts in the org-shared data block and gate their
 * writes on `canWriteOrgData()` — owner, admin, editor — which is the
 * population `data.manage` defaults to. It is also the key the CRM plugin
 * declares for its SITE hub, so the two CRM surfaces name one permission
 * rather than two, and an owner revoking it closes both.
 *
 * The site hub stops there, deliberately: a collaborator holding
 * `data.manage` may open their own site's CRM, where the listener filters on
 * `visibleTo` and the rules prove the same predicate per document. This
 * surface adds the reach requirement on top, because it is the one that has
 * no such filter to fall back on.
 *
 * ## Guards are not the boundary
 *
 * The rules are. `canReadScoped()` short-circuits on `isOrgWideMember()` and
 * otherwise demands `visibleTo.hasAny(scopeTokens)`, and Firestore refuses a
 * LIST it cannot prove per document — so the unfiltered org-wide queries this
 * hub runs are answered with `permission-denied` for a scoped collaborator
 * whatever the console decides. This function makes the console HONEST about
 * that, one layer earlier and with an explanation attached.
 */
export type OrgCrmAccess =
  /** Org-wide reach and the permission. Render the surface. */
  | 'granted'
  /** A settled "no". Render the refusal. */
  | 'refused'
  /** Nothing has settled yet. Render neither — see below. */
  | 'pending'
  /**
   * The permission read FAILED. Distinct from `pending` because a caller that
   * treats them alike spins forever on an answer that is never coming, and
   * distinct from `refused` because telling a legitimate admin they have no
   * access is a support ticket rather than a refusal.
   */
  | 'unavailable'

/** The permission both CRM surfaces name. */
export const ORG_CRM_PERMISSION: OrgPermission = 'data.manage'

export interface OrgCrmAccessInput {
  /**
   * `useOrgReach().orgWide` — false ONLY for a resolved scoped membership.
   * It fails OPEN while memberships load, which is why {@link reachReady}
   * has to be consulted before it is believed.
   */
  orgWide: boolean
  /** `useOrgReach().ready`. */
  reachReady: boolean
  /** `useOrgPermissions().can`. */
  can: (permission: OrgPermission) => boolean
  /** `useOrgPermissions().loaded` — true ONLY when the read answered. */
  permissionsLoaded: boolean
  /** `useOrgPermissions().errored` — the member read failed. */
  permissionsErrored: boolean
}

/**
 * The verdict, from reach and permission in that order.
 *
 * ## Why reach is evaluated before the permission and not alongside it
 *
 * Not for speed. A scoped collaborator gets `refused` without the permission
 * read having to answer at all, which means the refusal cannot be softened by
 * a permission map — including the PERMISSIVE ADMIN MAP `useOrgPermissions`
 * publishes while loading. Written as a single `orgWide && can(...)` the
 * loading window would still refuse, but a later reordering or a `loaded`
 * check moved one line would quietly turn the collaborator case into a
 * grant, and nothing about the expression would look wrong.
 *
 * ## Both unsettled reads hold, and neither guesses
 *
 * `orgWide` fails open and the permission map loads permissive, so the two
 * inputs that could produce a false grant are exactly the two that are held
 * behind a readiness flag. `pending` renders no data and no refusal.
 */
export function resolveOrgCrmAccess(input: OrgCrmAccessInput): OrgCrmAccess {
  const {
    orgWide,
    reachReady,
    can,
    permissionsLoaded,
    permissionsErrored,
  } = input
  // Unresolved reach is not org-wide reach. `orgWide` reads TRUE until
  // memberships land, so believing it here would admit a collaborator for
  // every render before their membership arrives — the frame people
  // screenshot.
  if (!reachReady) return 'pending'
  // THE BOUNDARY. A scoped member is refused here and no permission is
  // consulted, because no permission grants reach.
  if (!orgWide) return 'refused'
  if (permissionsErrored) return 'unavailable'
  if (!permissionsLoaded) return 'pending'
  return can(ORG_CRM_PERMISSION) === true ? 'granted' : 'refused'
}

/**
 * What a refused reader is told.
 *
 * Two audiences reach this copy and they need different sentences, so the
 * reason is a parameter rather than one apologetic string. A collaborator is
 * not missing a permission — they are looking at a page about sites they do
 * not hold, and offering them "ask an admin for access" invites a request
 * that would have to be answered by widening their whole membership.
 */
export function orgCrmRefusalNotice(reason: 'scoped' | 'permission'): string {
  return reason === 'scoped'
    ? 'This page covers every site in the organization. Your access is ' +
        "limited to the sites you've been added to — open the CRM from " +
        'one of those sites to see the people it holds.'
    : "You don't have permission to see the organization's CRM. An " +
        'organization owner or admin can grant it from Team.'
}

export default resolveOrgCrmAccess

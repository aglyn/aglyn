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
 * Multi-tenant organizations (AGL-233, docs/MULTI_TENANT_FIRESTORE.md):
 * the org is the tenant boundary — one subscription, one workspace
 * subdomain, one isolation subtree. Billing fields mirror `AglynOrgBilling`
 * so the plan/entitlement resolvers work on either doc during the
 * transition; org-keyed billing lands with AGL-237.
 */

import type { ITimestamp } from '@aglyn/shared-util-timestamp'
import type {
  OrgEntitlements,
  OrgPlan,
  OrgSeatAddons,
  OrgSubscription,
} from './org-billing.types'
import type {
  AglynDocument,
  HostUid,
  OrgUid,
  ScopeToken,
  UserUid,
} from './platform.types'

export type { OrgUid } from './platform.types'
/** Workspace subdomain label: `{slug}.aglyn.com` (Slack-style). */
export type OrgSlug = string

/** Org-wide roles, strongest to weakest. */
export type OrgRole = 'owner' | 'admin' | 'editor' | 'viewer'

/** Per-host refinement for editor/viewer members ("3 of 15 sites"). */
export type HostAccessRole = 'admin' | 'editor' | 'viewer'

export interface AglynOrganization extends AglynDocument {
  $id: OrgUid
  name?: string
  slug?: OrgSlug
  /** Creator; ownership can move without re-keying anything. */
  ownerUid?: UserUid
  /** Directory of the org's hosts (mirrors AglynOrgBilling.hosts). */
  hosts?: Record<HostUid, true>

  // Billing (mirrors AglynOrgBilling; source of truth moves here with AGL-237)
  plan?: OrgPlan
  entitlements?: OrgEntitlements
  /**
   * Per-org plugin switchboard (AGL-416): ids of plugins the workspace
   * loads (see plugin-manager/enabled-plugins). Absent = all first-party
   * plugins; always-on ids (base components) are unioned in regardless.
   */
  enabledPlugins?: string[]
  seatAddons?: OrgSeatAddons
  stripeCustomerId?: string
  subscription?: OrgSubscription
  suspendedAt?: ITimestamp | null
  suspendedReason?: string
  erasureRequestedAt?: ITimestamp | null
  /**
   * Scope applied to newly created datasets and media when nobody chooses
   * (AGL-1048). `'org'` — the default and today's behavior — shares them
   * with every site. `'host'` starts them private to the site they were
   * created in, which is what an agency running client sites wants: safe
   * by default rather than safe by discipline.
   *
   * Only meaningful when there IS a site in context. Created from the org
   * Media or Data page there is no host to scope to, so those stay `'org'`
   * either way.
   */
  defaultResourceScope?: 'org' | 'host'
}

/**
 * `orgs/{orgId}/members/{uid}` — THE authorization doc: rules resolve a
 * request with this single read. Owner/admin span every host; editor and
 * viewer see `hostAccess` (or `allHosts`).
 */
export interface AglynOrgMember extends AglynDocument {
  $id: UserUid
  role?: OrgRole
  /**
   * Custom role reference (AGL-243): id of an `orgs/{orgId}/roles` doc
   * whose permission map overrides the org role's defaults.
   */
  roleId?: string
  /** Per-member permission overrides (AGL-243); win over every layer. */
  permissions?: Record<string, boolean>
  /** Org-wide host access shortcut; otherwise `hostAccess` decides. */
  allHosts?: boolean
  hostAccess?: Record<HostUid, HostAccessRole>
  /**
   * Denormalized reach as scope tokens (AGL-1038), so rules can intersect
   * it with a resource's `visibleTo` — they cannot derive it from
   * `hostAccess` because the rules language has no `.map()`. Written only
   * by `syncOrgAuthProjections`; never edit it by hand.
   */
  scopeTokens?: ScopeToken[]
  /** Denormalized for member lists without N user lookups. */
  displayName?: string
  email?: string
  invitedBy?: UserUid
  joinedAt?: ITimestamp
  /**
   * Denormalized org suspension flag (AGL-210) so host writes stay a
   * single rules read; maintained by the staff suspension API.
   */
  orgSuspended?: boolean
}

/** `orgs/{orgId}/invites/{inviteId}` — pending email invites. */
export interface AglynOrgInvite extends AglynDocument {
  $id: string
  email?: string
  role?: OrgRole
  allHosts?: boolean
  hostAccess?: Record<HostUid, HostAccessRole>
  invitedBy?: UserUid
  createdAt?: ITimestamp
  acceptedAt?: ITimestamp | null
  acceptedBy?: UserUid
}

/**
 * `orgSlugs/{slug}` — transactional uniqueness reservation; created and
 * deleted only by the org APIs (Admin SDK), publicly readable so the
 * console can resolve a workspace subdomain client-side.
 */
export interface OrgSlugReservation {
  orgId: OrgUid
}

/**
 * `hostIndex/{hostId}` — server-written host → org resolver so the tenant
 * renderer and middleware find a host's org without scanning.
 */
export interface HostIndexEntry {
  orgId: OrgUid
  subdomain?: string
}

/**
 * `users/{uid}/orgs/{orgId}` — reverse index for "my organizations",
 * maintained transactionally with the member doc by the membership API.
 */
export interface UserOrgMembership extends AglynDocument {
  $id: OrgUid
  role?: OrgRole
  orgName?: string
  slug?: OrgSlug
}

/**
 * `users/{uid}/hostMemberships/{hostId}` — reverse index of the sites a user
 * can reach, mirroring `hosts/{hostId}.memberRoles` (AGL-844). Denormalizes the
 * host name so the site switcher and subdomain→id routing query a user's own
 * sites, ordered and name-prefix-searched, without scanning the `hosts`
 * collection. Admin-SDK-maintained beside `memberRoles`; a best-effort
 * convenience index, never an authorization source (the rules still gate host
 * reads on `memberRoles`). NOT named `hosts` — that would collide with the
 * top-level `hosts` collection for collection-group rules/indexes.
 */
export interface UserHostMembership extends AglynDocument {
  $id: HostUid
  orgId?: OrgUid
  subdomain?: string
  displayName?: string
  nameLower?: string
  role?: HostAccessRole
  updatedAt?: ITimestamp
}

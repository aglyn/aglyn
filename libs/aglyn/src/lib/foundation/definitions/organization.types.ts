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
 * subdomain, one isolation subtree. Billing fields mirror `AglynTenant`
 * so the plan/entitlement resolvers work on either doc during the
 * transition; org-keyed billing lands with AGL-237.
 */

import type { ITimestamp } from '@aglyn/shared-util-timestamp'
import type {
  AglynDocument,
  HostUid,
  TenantEntitlements,
  TenantPlan,
  TenantSeatAddons,
  TenantSubscription,
  UserUid,
} from './workspace.types'

export type OrgUid = string
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
  /** Directory of the org's hosts (mirrors AglynTenant.hosts). */
  hosts?: Record<HostUid, true>

  // Billing (mirrors AglynTenant; source of truth moves here with AGL-237)
  plan?: TenantPlan
  entitlements?: TenantEntitlements
  seatAddons?: TenantSeatAddons
  stripeCustomerId?: string
  subscription?: TenantSubscription
  suspendedAt?: ITimestamp | null
  suspendedReason?: string
  erasureRequestedAt?: ITimestamp | null
}

/**
 * `orgs/{orgId}/members/{uid}` — THE authorization doc: rules resolve a
 * request with this single read. Owner/admin span every host; editor and
 * viewer see `hostAccess` (or `allHosts`).
 */
export interface AglynOrgMember extends AglynDocument {
  $id: UserUid
  role?: OrgRole
  /** Org-wide host access shortcut; otherwise `hostAccess` decides. */
  allHosts?: boolean
  hostAccess?: Record<HostUid, HostAccessRole>
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

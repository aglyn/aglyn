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
 * Organization helpers (AGL-233): slug policy for workspace subdomains
 * (`{slug}.aglyn.com`) and role math shared by the org APIs, the console
 * UI, and the Firestore rules' mental model. See
 * docs/MULTI_TENANT_FIRESTORE.md.
 */

import type {
  AglynOrgMember,
  HostAccessRole,
  HostUid,
  OrgRole,
} from '../foundation'
import {
  generateSubdomain,
  isBlockedSubdomain,
  SUBDOMAIN_PATTERN,
} from './host-naming'

/** Same lexical policy as host subdomains: 3–30 lowercase/digits/dashes. */
export const ORG_SLUG_PATTERN = SUBDOMAIN_PATTERN

/**
 * Org workspace slugs ride the host reserved/profanity blocklist plus
 * console-specific labels the workspace router must own.
 */
const RESERVED_ORG_ONLY = new Set(['staff', 'org', 'orgs', 'workspace'])

export function isBlockedOrgSlug(slug: string): boolean {
  return RESERVED_ORG_ONLY.has(slug.toLowerCase()) || isBlockedSubdomain(slug)
}

export function isValidOrgSlug(slug: string): boolean {
  return ORG_SLUG_PATTERN.test(slug) && !isBlockedOrgSlug(slug)
}

/** Best-effort slug from an org name; '' when nothing usable remains. */
export function generateOrgSlug(name: string): string {
  const slug = generateSubdomain(name)
  return slug && !isBlockedOrgSlug(slug) ? slug : ''
}

export const ORG_ROLES: readonly OrgRole[] = [
  'owner',
  'admin',
  'editor',
  'viewer',
]

const ORG_ROLE_WEIGHT: Record<OrgRole, number> = {
  owner: 3,
  admin: 2,
  editor: 1,
  viewer: 0,
}

export function isOrgRole(value: unknown): value is OrgRole {
  return typeof value === 'string' && value in ORG_ROLE_WEIGHT
}

export function orgRoleAtLeast(
  role: OrgRole | null | undefined,
  minimum: OrgRole,
): boolean {
  if (!role || !(role in ORG_ROLE_WEIGHT)) return false
  return ORG_ROLE_WEIGHT[role] >= ORG_ROLE_WEIGHT[minimum]
}

/** Org settings, members, invites, host creation: admin and owner. */
export function canManageOrg(role: OrgRole | null | undefined): boolean {
  return orgRoleAtLeast(role, 'admin')
}

/**
 * The member's effective role on one host, or null for no access.
 * Owner/admin span every host; editor/viewer resolve through `allHosts`
 * (mapped to their org role) or the per-host access map.
 */
export function hostRoleFor(
  member: Partial<AglynOrgMember> | null | undefined,
  hostId: HostUid,
): HostAccessRole | null {
  const role = member?.role
  if (!isOrgRole(role)) return null
  if (role === 'owner' || role === 'admin') return 'admin'
  const explicit = member?.hostAccess?.[hostId]
  if (explicit) return explicit
  return member?.allHosts ? role : null
}

/** Whether the member may mutate a host's content (admin or editor on it). */
export function canWriteHost(
  member: Partial<AglynOrgMember> | null | undefined,
  hostId: HostUid,
): boolean {
  const role = hostRoleFor(member, hostId)
  return role === 'admin' || role === 'editor'
}

/**
 * The `memberRoles` projection stamped onto host docs so Firestore rules
 * authorize host content with the single host-doc read they already do
 * (docs/MULTI_TENANT_FIRESTORE.md §5). Recomputed by the membership API
 * whenever a member changes; owner/admin appear on every host.
 */
export function projectHostMemberRoles(
  members: ReadonlyArray<Partial<AglynOrgMember> & { $id: string }>,
  hostId: HostUid,
): Record<string, HostAccessRole> {
  const projection: Record<string, HostAccessRole> = {}
  for (const member of members) {
    const role = hostRoleFor(member, hostId)
    if (role) projection[member.$id] = role
  }
  return projection
}

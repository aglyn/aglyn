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
  type OrgRole,
  resolveRolePermissions,
  type TenantPermissionSet,
} from '@aglyn/aglyn'
import {
  resolveOrgIdForHost,
  resolveOrgMembership,
} from '@aglyn/tenant-data-admin'

export type { TenantPermissionSet }

export interface ResolvedOrgPermissions {
  /** Org the permissions were resolved in (null before the first org). */
  orgId: string | null
  role: OrgRole | null
  /** Owner/admin of the org — full account-level control. */
  isOwner: boolean
  permissions: TenantPermissionSet
}

/** Org roles map onto the built-in permission sets key-for-key. */
const ORG_ROLE_PERMISSION_BASE: Record<OrgRole, 'admin' | 'editor' | 'viewer'> =
  {
    owner: 'admin',
    admin: 'admin',
    editor: 'editor',
    viewer: 'viewer',
  }

const ALL_TRUE: TenantPermissionSet = resolveRolePermissions('admin')
const NONE: TenantPermissionSet = resolveRolePermissions('viewer')

/**
 * Org-role permission resolver (AGL-238, replacing the manager-seat
 * resolver from AGL-108): the user's role in the relevant org decides the
 * permission flags. Accounts with no org yet resolve as owners with full
 * access — the org is created on first need — and lookup errors fail OPEN
 * for the same reason the old resolver did: these flags are a product-tier
 * boundary, not the security boundary (host access rides the memberRoles
 * rules projection; org APIs re-check membership server-side).
 */
export async function resolveOrgPermissions(
  uid: string,
  context: { orgId?: string | null; hostId?: string | null } = {},
): Promise<ResolvedOrgPermissions> {
  try {
    const orgId =
      context.orgId ??
      (context.hostId ? await resolveOrgIdForHost(context.hostId) : null)
    const membership = await resolveOrgMembership(uid, orgId)
    if (!membership) {
      // No org at all → fresh account, acts as its future org's owner.
      // An org WAS targeted but the uid is not on the roster → no access.
      return orgId
        ? { orgId, role: null, isOwner: false, permissions: NONE }
        : { orgId: null, role: null, isOwner: true, permissions: ALL_TRUE }
    }
    const role = membership.member.role
    return {
      orgId: membership.orgId,
      role,
      isOwner: role === 'owner' || role === 'admin',
      permissions: resolveRolePermissions(ORG_ROLE_PERMISSION_BASE[role]),
    }
  } catch (error) {
    console.error('org-permissions resolve failed (failing open)', error)
    return { orgId: null, role: null, isOwner: true, permissions: ALL_TRUE }
  }
}

export default resolveOrgPermissions

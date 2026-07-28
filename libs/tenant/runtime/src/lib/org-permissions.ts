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
  hostRoleFor,
  isOrgWideMember,
  type OrgRole,
  resolveRolePermissions,
  type OrgPermissionSet,
} from '@aglyn/aglyn/server'
import {
  resolveOrgIdForHost,
  resolveOrgMembership,
} from '@aglyn/tenant-data-admin'

export type { OrgPermissionSet }

export interface ResolvedOrgPermissions {
  /** Org the permissions were resolved in (null before the first org). */
  orgId: string | null
  role: OrgRole | null
  /** Owner/admin of the org — full account-level control. */
  isOwner: boolean
  permissions: OrgPermissionSet
  /**
   * The member's reach across the org (AGL-1026). `false` for a site
   * collaborator, whose membership exists only to carry access to named
   * sites — anything org-wide (the roster, billing, the shared CRM) is not
   * theirs to see, and callers that answer org-level questions must say so.
   */
  orgWide: boolean
  /**
   * Their role on the host in context, when one was given. Null means they
   * have no access to THAT site even though they are on the org roster.
   */
  hostRole: 'admin' | 'editor' | 'viewer' | null
}

/** Org roles map onto the built-in permission sets key-for-key. */
const ORG_ROLE_PERMISSION_BASE: Record<OrgRole, 'admin' | 'editor' | 'viewer'> =
  {
    owner: 'admin',
    admin: 'admin',
    editor: 'editor',
    viewer: 'viewer',
  }

const ALL_TRUE: OrgPermissionSet = resolveRolePermissions('admin')
const NONE: OrgPermissionSet = resolveRolePermissions('viewer')

/**
 * Permissions that are about the ORG, not about a site (AGL-1026).
 *
 * The permission set mixes the two: `editHosts` and `installPlugins` are
 * things you do to a site, while creating sites, paying for them, publishing
 * as the org and changing the roster are things you do to the workspace. A
 * site collaborator can be an admin OF THEIR SITE — that is the whole point of
 * the role — so their host role has to grant the site-level keys while these
 * stay off regardless of it.
 */
const ORG_LEVEL_PERMISSIONS = [
  'createHosts',
  'editBilling',
  'manageMembers',
  // Publishing is org-owned since AGL-652 — a listing carries the workspace's
  // name and takes its money, so a contractor on one site does not ship one.
  'publishToCommunity',
] as const

/** On the roster but with no standing here — or not on it at all. */
const DENIED: ResolvedOrgPermissions = {
  orgId: null,
  role: null,
  isOwner: false,
  permissions: NONE,
  orgWide: false,
  hostRole: null,
}

/**
 * Org-role permission resolver (AGL-238, replacing the manager-seat
 * resolver from AGL-108): the user's role in the relevant org decides the
 * permission flags. Accounts with no org yet resolve as owners with full
 * access — the org is created on first need. A lookup error fails CLOSED
 * when a specific org/host was targeted (AGL-506) — routes like hosts/members
 * OR these flags into an auth decision, so a transient error must not hand
 * out manageMembers. Only the context-free fresh-account case keeps the
 * owner default.
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
        ? { ...DENIED, orgId }
        : {
            orgId: null,
            role: null,
            isOwner: true,
            permissions: ALL_TRUE,
            orgWide: true,
            hostRole: null,
          }
    }
    const role = membership.member.role
    // Owner/admin, `allHosts`, and the legacy pre-`allHosts` shape all read
    // as org-wide; `isOrgWideMember` owns that call so this gate, the
    // `scopeTokens` projection and the rules cannot drift apart (AGL-1038).
    const orgWide = isOrgWideMember(membership.member)
    const hostRole = context.hostId
      ? hostRoleFor(membership.member, context.hostId)
      : null

    // A site collaborator's permissions are their HOST role's, never their org
    // role's (AGL-1026). The membership doc exists to carry site access, so
    // reading `role` off it and stopping there answered an org-level question
    // with a site-level fact: an "editor on one site" resolved as an editor of
    // every site in the org. When a host is named and they have no access to
    // it, that is simply no access — being on the roster is not a grant.
    if (!orgWide) {
      if (context.hostId && !hostRole) return { ...DENIED, orgId: membership.orgId }
      return {
        orgId: membership.orgId,
        role,
        isOwner: false,
        // With no host in context there is nothing to scope to, so a scoped
        // member gets the floor rather than their site role — the caller is
        // asking an org-wide question they have no standing to answer.
        permissions: {
          ...resolveRolePermissions(hostRole ?? 'viewer'),
          ...Object.fromEntries(
            ORG_LEVEL_PERMISSIONS.map((key) => [key, false]),
          ),
        },
        orgWide: false,
        hostRole,
      }
    }
    return {
      orgId: membership.orgId,
      role,
      isOwner: role === 'owner' || role === 'admin',
      permissions: resolveRolePermissions(ORG_ROLE_PERMISSION_BASE[role]),
      orgWide: true,
      hostRole: hostRole ?? ORG_ROLE_PERMISSION_BASE[role],
    }
  } catch (error) {
    // Fail CLOSED when a specific org/host was targeted (AGL-506): a lookup
    // error must never grant full permissions for a real org. Only the
    // context-free fresh-account case keeps the owner default.
    if (context.orgId || context.hostId) {
      console.error('org-permissions resolve failed (failing closed)', error)
      return { ...DENIED, orgId: context.orgId ?? null }
    }
    console.error('org-permissions resolve failed (no org targeted)', error)
    return {
      orgId: null,
      role: null,
      isOwner: true,
      permissions: ALL_TRUE,
      orgWide: true,
      hostRole: null,
    }
  }
}

export default resolveOrgPermissions

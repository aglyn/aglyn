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
  type HostAccessRole,
  hostRoleFor,
  isOrgWideMember,
  type OrgRole,
  resolveRolePermissions,
  toLegacyPermissions,
  type OrgPermissionSet,
  type ResolvedOrgPermissionSet,
  listPluginPermissionKeys,
  ORG_ROLE_TIER,
} from '@aglyn/aglyn/server'
import {
  resolveMemberOrgPermissions,
  resolveOrgIdForHost,
  resolveOrgMembership,
} from '@aglyn/tenant-data-admin'

export type { OrgPermissionSet, ResolvedOrgPermissionSet }

export interface ResolvedOrgPermissions {
  /** Org the permissions were resolved in (null before the first org). */
  orgId: string | null
  role: OrgRole | null
  /** Owner/admin of the org — full account-level control. */
  isOwner: boolean
  /**
   * Widened past the legacy six (AGL-2474) so a route can read a
   * plugin-declared key such as `permissions.managePos` without a cast.
   */
  permissions: ResolvedOrgPermissionSet
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
  /**
   * The caller's role ON the host in context, or null. Spelled as the shared
   * `HostAccessRole` since AGL-2334 rather than repeated inline: the union
   * gained `author`, and a hand-copied duplicate is a tripwire that fires as
   * a type error somewhere unrelated instead of a decision made here.
   */
  hostRole: HostAccessRole | null
}

/** Org roles map onto the built-in permission sets key-for-key. */
// Which host-role permission set each ORG role resolves to. `author` is
// deliberately absent as a VALUE here (AGL-2334): it is a per-site grant, so
// no org role maps onto it and `hostRoleFor` can never produce one for an
// `allHosts` member. Kept as the narrow union so that stays enforced.
// One table, shared with the console since AGL-2474 (`ORG_ROLE_TIER`): a
// second copy here is how the client and the server come to disagree about
// what an owner is. The local NAME stays — `org-permissions-client-server-
// agree.spec.ts` matches on this expression's source text.
const ORG_ROLE_PERMISSION_BASE: Record<OrgRole, 'admin' | 'editor' | 'viewer'> =
  ORG_ROLE_TIER as Record<OrgRole, 'admin' | 'editor' | 'viewer'>

// EVALUATED PER CALL, not once at module load (AGL-2474). Plugins register
// their permission keys at module scope (`registerCommerceApi`), and whether
// that has happened by the time THIS module is first imported is import-order
// luck. Snapshotting here produced a map with no plugin keys at all, so an
// owner on the fresh-account path read `managePos === undefined` — falsy, and
// denied — while an identical owner resolved a millisecond later through the
// membership path got `true`. The cost is one small object per call.
const allTrue = (): ResolvedOrgPermissionSet => resolveRolePermissions('admin')
const none = (): ResolvedOrgPermissionSet => resolveRolePermissions('viewer')

/**
 * Per-member overrides for PLUGIN-declared keys (AGL-2474). The dotted
 * granular catalog that `toLegacyPermissions` translates knows nothing about
 * them, so without this pass a plugin key could not be revoked from a member
 * who has it by tier default, nor granted to one who does not — the override
 * map on the member doc is already typed `Record<string, boolean>` and has
 * always been able to CARRY the key; nothing read it.
 */
function pluginPermissionOverrides(
  overrides: Record<string, boolean> | null | undefined,
): Record<string, boolean> {
  const applied: Record<string, boolean> = {}
  if (!overrides) return applied
  for (const key of listPluginPermissionKeys()) {
    const value = overrides[key]
    if (typeof value === 'boolean') applied[key] = value
  }
  return applied
}

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
  'publishToMarketplace',
] as const

/** On the roster but with no standing here — or not on it at all. */
const denied = (): ResolvedOrgPermissions => ({
  orgId: null,
  role: null,
  isOwner: false,
  permissions: none(),
  orgWide: false,
  hostRole: null,
})

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
        ? { ...denied(), orgId }
        : {
            orgId: null,
            role: null,
            isOwner: true,
            permissions: allTrue(),
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
      if (context.hostId && !hostRole) return { ...denied(), orgId: membership.orgId }
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
          // Plugin-key overrides apply to a collaborator TOO (AGL-2474).
          // Their six built-in keys are deliberately their HOST role's and
          // not their org role's, but a plugin key revoked on the member doc
          // is a revocation either way — skipping it here would mean an admin
          // could take `managePos` off an org-wide member and silently fail to
          // take it off the contractor actually standing at the register.
          // ORG_LEVEL_PERMISSIONS still wins above for the keys it names.
          ...pluginPermissionOverrides(
            membership.member.permissions as Record<string, boolean>,
          ),
        },
        orgWide: false,
        hostRole,
      }
    }
    // Custom role + per-member overrides, which this resolver used to drop
    // (AGL-2350). `resolveRolePermissions(tier)` alone is the BUILT-IN role's
    // defaults, so every refinement `custom-roles.md` sells was invisible to
    // the server while the console applied it — a permission granted by a
    // custom role showed in the UI and 403'd on POST, and one revoked by an
    // override was hidden in the UI and still succeeded on POST.
    //
    // OVERLAID, never substituted: `resolveRolePermissions` also mixes in
    // plugin-declared keys (AGL-435) that the granular catalog knows nothing
    // about, so replacing the map wholesale would silently strip them.
    const granular = await resolveMemberOrgPermissions(
      membership.orgId,
      membership.member,
    )
    return {
      orgId: membership.orgId,
      role,
      isOwner: role === 'owner' || role === 'admin',
      permissions: {
        ...resolveRolePermissions(ORG_ROLE_PERMISSION_BASE[role]),
        ...toLegacyPermissions(granular, role),
        // LAST, so a per-member override wins (AGL-2474). The legacy spread
        // above rebuilds all six keys from the dotted catalog every time and
        // would otherwise stomp nothing here — but plugin keys are absent from
        // that catalog entirely, so they have to be laid back on explicitly.
        ...pluginPermissionOverrides(
          membership.member.permissions as Record<string, boolean>,
        ),
      },
      orgWide: true,
      hostRole: hostRole ?? ORG_ROLE_PERMISSION_BASE[role],
    }
  } catch (error) {
    // Fail CLOSED when a specific org/host was targeted (AGL-506): a lookup
    // error must never grant full permissions for a real org. Only the
    // context-free fresh-account case keeps the owner default.
    if (context.orgId || context.hostId) {
      console.error('org-permissions resolve failed (failing closed)', error)
      return { ...denied(), orgId: context.orgId ?? null }
    }
    console.error('org-permissions resolve failed (no org targeted)', error)
    return {
      orgId: null,
      role: null,
      isOwner: true,
      permissions: allTrue(),
      orgWide: true,
      hostRole: null,
    }
  }
}

export default resolveOrgPermissions

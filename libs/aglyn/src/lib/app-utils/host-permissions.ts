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

import type {
  AglynOrgMember,
  HostAccessRole,
  HostPermissionKey,
  HostUid,
} from '../foundation'
import { listPluginOrgPermissions } from '../plugin-manager/plugin-entitlements'
import { hostRoleFor, isOrgWideMember } from './organizations'
import { resolveOrgPermissions, type AglynOrgCustomRole } from './org-permissions'

/**
 * Catalog keys a site collaborator holds PER SITE (AGL-2984), resolved on one
 * of two axes.
 *
 * A plugin that declares a catalog key with `hostRoleDefaults` makes it a
 * per-site key. For the people whose membership spans the workspace, the key
 * is an ordinary catalog key: their org role's default, refined by a custom
 * role and by per-member overrides, the same on every site. A site
 * collaborator has no org standing to refine — their membership exists only
 * to carry access to named sites — so for them the key is decided PER SITE,
 * from the host role they hold there, refined by `hostPermissions[hostId]` on
 * their member document.
 *
 * Which axis applies is `isOrgWideMember`, the predicate the rules projection
 * and the scope resolver already share. A collaborator asked about a site
 * they were never granted resolves to nothing, and so does one whose request
 * names no site at all: there is no host role to read a default from, and
 * guessing one would let a request reach around the per-site toggle by
 * omitting the site.
 */

/** The catalog keys a collaborator can hold per site, in catalog order. */
export function hostPermissionKeys(): HostPermissionKey[] {
  return listPluginOrgPermissions()
    .filter((permission) => permission.hostRoleDefaults !== undefined)
    .map((permission) => permission.key)
}

/** What a host role grants for every per-site key, before any toggle. */
export function hostRolePermissionDefaults(
  role: HostAccessRole,
): Record<HostPermissionKey, boolean> {
  const defaults: Record<HostPermissionKey, boolean> = {}
  for (const permission of listPluginOrgPermissions()) {
    if (!permission.hostRoleDefaults) continue
    defaults[permission.key] = permission.hostRoleDefaults[role] === true
  }
  return defaults
}

/** Every per-site key, refused. */
function noHostPermissions(): Record<HostPermissionKey, boolean> {
  return Object.fromEntries(hostPermissionKeys().map((key) => [key, false]))
}

/**
 * A collaborator's verdict on ONE site for every per-site key, or null where
 * they have no access to that site at all. An absent toggle reads as the host
 * role's default, which is what makes a member document written before
 * `hostPermissions` existed resolve exactly as it did before.
 */
export function resolveCollaboratorHostPermissions(
  member: Partial<AglynOrgMember> | null | undefined,
  hostId: HostUid | null | undefined,
): Record<HostPermissionKey, boolean> | null {
  if (!member || !hostId) return null
  const role = hostRoleFor(member, hostId)
  if (!role) return null
  const merged = hostRolePermissionDefaults(role)
  const toggles = member.hostPermissions?.[hostId]
  if (toggles) {
    for (const key of Object.keys(merged)) {
      const value = toggles[key]
      if (typeof value === 'boolean') merged[key] = value
    }
  }
  return merged
}

/**
 * A member's verdict for every per-site key, on whichever axis their
 * membership is on.
 *
 * `customRole` is the member's custom role document when they carry a
 * `roleId` and the caller has it in hand, and is ignored for a collaborator,
 * whose org role is a seat-accounting fact rather than a grant. `hostId` is
 * the site the request is about; an org-wide member resolves the same on
 * every site and with none named.
 */
export function resolveMemberHostPermissions(options: {
  member: Partial<AglynOrgMember> | null | undefined
  customRole?: AglynOrgCustomRole | null
  hostId?: HostUid | null
}): Record<HostPermissionKey, boolean> {
  const { member, customRole, hostId } = options
  if (!member) return noHostPermissions()
  if (isOrgWideMember(member)) {
    const granted = resolveOrgPermissions(member, customRole ?? null)
    return Object.fromEntries(
      hostPermissionKeys().map((key) => [key, granted[key] === true]),
    )
  }
  return resolveCollaboratorHostPermissions(member, hostId) ?? noHostPermissions()
}

/**
 * The `memberPermissions` projection stamped on a host document beside
 * `memberRoles`: every member who can reach the site, with the verdict for
 * every per-site key they hold ON it. Org-wide members are resolved against
 * the custom roles the caller loaded (one read per distinct role, as
 * `syncOrgAuthProjections` already does for `resolvedPermissions`);
 * collaborators against their host role. A member who cannot reach the site
 * has no entry, matching `projectHostMemberRoles`.
 */
export function projectHostMemberPermissions(
  members: ReadonlyArray<Partial<AglynOrgMember> & { $id: string }>,
  hostId: HostUid,
  customRoles: ReadonlyMap<string, AglynOrgCustomRole | null>,
): Record<string, Record<HostPermissionKey, boolean>> {
  const projection: Record<string, Record<HostPermissionKey, boolean>> = {}
  for (const member of members) {
    if (!hostRoleFor(member, hostId)) continue
    projection[member.$id] = resolveMemberHostPermissions({
      member,
      customRole: member.roleId ? (customRoles.get(member.roleId) ?? null) : null,
      hostId,
    })
  }
  return projection
}

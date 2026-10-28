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
  OrgRole,
} from '../foundation'
import { listPluginOrgPermissions } from '../plugin-manager/plugin-entitlements'
import { refinePermissionMap } from '../plugin-manager/plugin-permissions'
import { hostRoleFor, isOrgWideMember } from './organizations'
import {
  ORG_PERMISSION_REFINEMENTS,
  ORG_PERMISSIONS,
  resolveOrgPermissions,
  type AglynOrgCustomRole,
  type OrgPermissionDefinition,
} from './org-permissions'
import { orgRoleTier } from './org-roles'

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

/*
 * A SITE NARROWS A WORKSPACE-WIDE MEMBER (AGL-4047).
 *
 * An editor who works across the workspace can be given Viewer or Author
 * access to one site (`hostAccess[hostId]`, which `hostRoleFor` reads ahead
 * of `allHosts`). That narrowed their content rights there and nothing else,
 * so a key the workspace grants an editor, such as working a site's
 * register, still held on the site they were narrowed on.
 *
 * A plugin marks the keys a site CAN narrow with `narrowsPerSite`, and
 * whether each one does is a control with three layers, the nearest set one
 * winning (`siteNarrowingChoices`):
 *
 *   - the member's own choice (`member.siteNarrowing[key]`);
 *   - else their custom role's (`customRole.siteNarrowing[key]`);
 *   - else the built-in role's default the declaration names.
 *
 * `true` is "Follow the site role", `false` is "Keep this permission". On a
 * site that narrows the member, each key that follows the site role is
 * decided for that site:
 *
 *   1. the site's own verdict for the key (`hostPermissions[hostId][key]`),
 *      when the site set one;
 *   2. else, for a key that refines another key that also follows the site
 *      role, that key's verdict on this site, never more than the workspace
 *      grants;
 *   3. else the narrower access's default for the key, never more than the
 *      workspace grants;
 *
 * and a key they keep is the workspace's verdict, as everywhere else. A finer
 * key they hold on the site (one the site grants, or one they keep and the
 * workspace grants) brings the key it refines on this site with it, unless
 * the site refuses that key, because a refining key is never held without
 * it. The other finer keys do not follow that implied grant: allowing "sell"
 * on a site is not allowing refunds.
 *
 * A member whose access to every site matches their workspace role (the
 * owner and admins always do), one who keeps every key a site can narrow,
 * and a site collaborator, whose keys come from their site role already, all
 * resolve exactly as before.
 */

/** Host roles from the widest down, for "is this site's access narrower?". */
const HOST_ROLE_RANK: Readonly<Record<HostAccessRole, number>> = {
  admin: 3,
  editor: 2,
  author: 1,
  viewer: 0,
}

/** How one site narrows a workspace-wide member: the access they hold there, the site's verdicts, and which keys follow it. */
export interface SiteNarrowing {
  /** Their role on the site, narrower than their workspace role. */
  role: HostAccessRole
  /** `hostPermissions[hostId]`: the verdicts the site set for them. */
  grants: Readonly<Partial<Record<string, unknown>>>
  /**
   * Every key a site can narrow, `true` where it follows the site role for
   * this member and `false` where they keep it (`siteNarrowingChoices`).
   */
  narrows: Readonly<Record<string, boolean>>
}

/** The catalog keys a site CAN narrow (`narrowsPerSite`), in catalog order. */
export function siteNarrowedPermissionKeys(): string[] {
  return ORG_PERMISSIONS.filter((definition) => definition.narrowsPerSite).map(
    (definition) => definition.key,
  )
}

/**
 * Could any site narrow a member of this org role? Not the owner or an
 * admin, who are admins of every site, and not a role whose site access has
 * nothing narrower below it (a viewer). The editors' control is the one that
 * changes anything; the role editor says so beside it.
 */
export function roleCanBeNarrowed(role: string | null | undefined): boolean {
  if (role === 'owner' || role === 'admin') return false
  return HOST_ROLE_RANK[orgRoleTier(role) as HostAccessRole] > 0
}

/**
 * Whether each key a site can narrow follows the site role for this member
 * (`true`) or is kept (`false`): their own choice, else their custom role's
 * (when they carry its id and it was supplied), else the built-in role's
 * default.
 */
export function siteNarrowingChoices(
  member: (Partial<AglynOrgMember> & { roleId?: string | null }) | null | undefined,
  customRole?: Pick<AglynOrgCustomRole, 'siteNarrowing'> | null,
): Record<string, boolean> {
  const role = (member?.role ?? 'viewer') as OrgRole
  const own = member?.siteNarrowing ?? {}
  const fromRole = member?.roleId ? (customRole?.siteNarrowing ?? {}) : {}
  const out: Record<string, boolean> = {}
  for (const definition of ORG_PERMISSIONS) {
    if (!definition.narrowsPerSite) continue
    const key = definition.key
    const mine = own[key]
    const theirRole = fromRole[key]
    out[key] =
      typeof mine === 'boolean'
        ? mine
        : typeof theirRole === 'boolean'
          ? theirRole
          : definition.narrowsPerSite[role] === true
  }
  return out
}

/**
 * Is this member's access to this site narrower than their workspace role?
 * The cheap half of `siteNarrowingFor`, which needs no custom role: a caller
 * that has to read one asks this first, and reads nothing for everyone else.
 */
export function siteMayNarrow(
  member: Partial<AglynOrgMember> | null | undefined,
  hostId: HostUid | null | undefined,
): HostAccessRole | null {
  if (!member || !hostId || !isOrgWideMember(member)) return null
  const role = hostRoleFor(member, hostId)
  if (!role) return null
  const workspaceRole = orgRoleTier(member.role) as HostAccessRole
  if (HOST_ROLE_RANK[role] >= HOST_ROLE_RANK[workspaceRole]) return null
  return role
}

/**
 * How this site narrows this member, or null where it does not: a member
 * who is not workspace-wide, has no access to the site, whose access there
 * is as wide as their workspace role (owners and admins always), or who
 * keeps every key a site can narrow. `customRole` is their custom role
 * document when they carry a `roleId`; without it, only their own choices
 * and the built-in defaults decide.
 */
export function siteNarrowingFor(
  member: Partial<AglynOrgMember> | null | undefined,
  hostId: HostUid | null | undefined,
  customRole?: Pick<AglynOrgCustomRole, 'siteNarrowing'> | null,
): SiteNarrowing | null {
  const role = siteMayNarrow(member, hostId)
  if (!role) return null
  const narrows = siteNarrowingChoices(member, customRole)
  if (!Object.values(narrows).some(Boolean)) return null
  return { role, grants: member?.hostPermissions?.[hostId as HostUid] ?? {}, narrows }
}

/** The keys that follow the site role under a narrowing, in catalog order; none without one. */
export function narrowedPermissionKeysOf(narrowing: SiteNarrowing | null | undefined): string[] {
  if (!narrowing) return []
  return siteNarrowedPermissionKeys().filter((key) => narrowing.narrows[key] === true)
}

/** What a site access holds by default for a key: its site default, else its tier's (Author on the Viewer tier). */
function narrowedDefault(definition: OrgPermissionDefinition, role: HostAccessRole): boolean {
  const site = definition.hostRoleDefaults?.[role]
  if (typeof site === 'boolean') return site
  return definition.roleDefaults[orgRoleTier(role)] === true
}

/**
 * A workspace-wide member's resolved map with the keys that follow the site
 * role decided for that site (see above). With no narrowing it is the map
 * as given, so every resolver can call it unconditionally.
 */
export function narrowPermissionsToSite<T extends Record<string, boolean>>(
  granted: T,
  narrowing: SiteNarrowing | null | undefined,
): T {
  if (!narrowing) return granted
  const definitions = ORG_PERMISSIONS.filter((definition) => definition.narrowsPerSite)
  if (!definitions.length) return granted
  const narrowable = new Set(definitions.map((definition) => definition.key))
  const follows = (key: string): boolean => narrowing.narrows[key] === true
  // A finer key's broader key, among the keys a site can narrow.
  const broader = new Map<string, string>()
  for (const [key, parent, kind] of ORG_PERMISSION_REFINEMENTS) {
    if (kind !== 'follows' && narrowable.has(key) && narrowable.has(parent)) broader.set(key, parent)
  }
  const siteVerdict = (key: string): boolean | undefined => {
    const value = narrowing.grants[key]
    return typeof value === 'boolean' ? value : undefined
  }
  const depth = (key: string): number => {
    const seen = new Set<string>()
    let steps = 0
    for (let current = key; broader.has(current) && !seen.has(current); steps += 1) {
      seen.add(current)
      current = broader.get(current) as string
    }
    return steps
  }
  const out: Record<string, boolean> = { ...granted }
  for (const definition of [...definitions].sort((a, b) => depth(a.key) - depth(b.key))) {
    const key = definition.key
    const workspace = granted[key] === true
    // Kept: the workspace's verdict, as on every other site.
    if (!follows(key)) {
      out[key] = workspace
      continue
    }
    const own = siteVerdict(key)
    const parent = broader.get(key)
    if (own !== undefined) out[key] = own
    else if (parent && follows(parent)) out[key] = out[parent] === true && workspace
    else out[key] = workspace && narrowedDefault(definition, narrowing.role)
  }
  for (const definition of definitions) {
    const key = definition.key
    const held = follows(key) ? siteVerdict(key) === true : granted[key] === true
    if (!held) continue
    const seen = new Set<string>()
    for (let parent = broader.get(key); parent && !seen.has(parent); parent = broader.get(parent)) {
      seen.add(parent)
      // A kept broader key is the workspace's verdict already.
      if (!follows(parent) || siteVerdict(parent) === false) break
      out[parent] = true
    }
  }
  return refinePermissionMap(out, ORG_PERMISSION_REFINEMENTS) as T
}

/**
 * A member's verdict for every per-site key, on whichever axis their
 * membership is on.
 *
 * `customRole` is the member's custom role document when they carry a
 * `roleId` and the caller has it in hand, and is ignored for a collaborator,
 * whose org role is a seat-accounting fact rather than a grant. `hostId` is
 * the site the request is about; an org-wide member resolves the same on
 * every site and with none named, except on a site that narrows them.
 *
 * An org-wide member's map also carries every key a site can narrow
 * (AGL-4047), decided for `hostId`, so the site's `memberPermissions`
 * projection answers the rules what the server answers. A collaborator's
 * map does not: their register and waivers keys come from their site role
 * and their own overrides, which the rules read from their member document
 * as before.
 */
export function resolveMemberHostPermissions(options: {
  member: Partial<AglynOrgMember> | null | undefined
  customRole?: AglynOrgCustomRole | null
  hostId?: HostUid | null
}): Record<HostPermissionKey, boolean> {
  const { member, customRole, hostId } = options
  if (!member) return noHostPermissions()
  if (isOrgWideMember(member)) {
    const granted = narrowPermissionsToSite(
      resolveOrgPermissions(member, customRole ?? null),
      siteNarrowingFor(member, hostId, customRole ?? null),
    )
    return Object.fromEntries(
      [...hostPermissionKeys(), ...siteNarrowedPermissionKeys()].map((key) => [key, granted[key] === true]),
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

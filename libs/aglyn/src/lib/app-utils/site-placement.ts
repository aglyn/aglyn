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

import type { AglynOrgMember, HostAccessRole } from '../foundation'
import { hostStampedSitePermission, resolveMemberHostPermissions, siteMayNarrow } from './host-permissions'
import type { AglynOrgCustomRole } from './org-permissions'
import { hostRoleFor, isOrgWideMember } from './organizations'

/*
 * A RESOURCE PLACED ON ONE SITE ANSWERS TO THAT SITE (AGL-4047).
 *
 * The workspace's shared resources carry `visibleTo`, and one placed on exactly
 * one site belongs to it. Where a plugin decides a resource's writes that way,
 * its keys come in pairs: a workspace key, and a site key that follows it for a
 * member of the whole workspace, which a site can narrow and raise
 * (`narrowsPerSite`, `raisesPerSite`), and which a site collaborator holds by
 * their site role. The verdict:
 *
 *   - the workspace key admits, unless a site narrows the member on the one site
 *     the resource sits on;
 *   - else, on that one site, the site key.
 *
 * Placed on every site, on several, or on all sites except some, the workspace key
 * alone: no one site can be asked, and a security rule cannot look through a list
 * of them.
 *
 * The rules ask the same thing in their own words, so these are kept in step with
 * them, placement test included.
 */

/**
 * Where a resource sits: the fields of its document that decide it. A whole
 * document, never `visibleTo` alone, so no caller can answer without the marker.
 */
export type ScopePlaced = Readonly<{ visibleTo?: unknown; scopeMode?: unknown; scopeExcept?: unknown }>

/**
 * The one site a resource is placed on, or `null` for every site, several, or
 * none.
 *
 * `null` for a document shared with all sites except some, however few it reaches
 * today. Its list can shrink to one site while it still belongs to the whole
 * workspace, and the next new site joins it, so that one site never comes to
 * answer for it. Read as the rules' `scopePlacement` reads it: either key present
 * is marked, so a stored null or half a marker fails closed.
 */
export function oneSitePlacement(placed: ScopePlaced | null | undefined): string | null {
  if (!placed || placed.scopeMode !== undefined || placed.scopeExcept !== undefined) return null
  const { visibleTo } = placed
  if (!Array.isArray(visibleTo) || visibleTo.length !== 1) return null
  const [token] = visibleTo as unknown[]
  const match = typeof token === 'string' ? /^host:([^:/]+)$/.exec(token) : null
  return match ? match[1] : null
}

/**
 * The verdict for a resource placed as `placed` says: see above. `site` is asked
 * only when the workspace key did not settle it, so a door pays for reading the
 * site only then.
 */
export function placementVerdict<T extends boolean | Promise<boolean>>(input: {
  member: Partial<AglynOrgMember> | null | undefined
  placed: ScopePlaced | null | undefined
  workspace: boolean
  site: (hostId: string) => T
}): boolean | T {
  const hostId = oneSitePlacement(input.placed)
  if (!hostId) return input.workspace
  if (input.workspace && !siteMayNarrow(input.member, hostId)) return true
  return input.site(hostId)
}

/**
 * The site key as the site's stamp gives it, read as the rules read it:
 * `memberPermissions[uid][key]`, else, on a site the projection has not reached
 * since the key existed, the site role's preset, unless someone decided against
 * this member in a way the stamp would carry: a custom role, or their own
 * workspace key refused. Those wait for the stamp, so nobody refused regains it
 * from `memberRoles`.
 */
export function stampedPlacementKey(
  stamps: { memberPermissions?: unknown; memberRoles?: unknown } | null | undefined,
  uid: string,
  key: string,
  preset: Readonly<Partial<Record<HostAccessRole, boolean>>>,
  member: (Partial<AglynOrgMember> & { roleId?: unknown; permissions?: unknown }) | null | undefined,
  workspaceKey: string,
): boolean {
  const stamp = (stamps?.memberPermissions as Record<string, Record<string, unknown> | undefined> | undefined)?.[uid]?.[key]
  if (typeof stamp === 'boolean') return stamp
  if (member?.roleId != null || (member?.permissions as Record<string, unknown> | undefined)?.[workspaceKey] === false) return false
  return hostStampedSitePermission({ memberRoles: stamps?.memberRoles }, uid, key, preset)
}

/** The site key from the membership alone, by the function the site's stamp is written from. */
export function resolvedPlacementKey(
  member: Partial<AglynOrgMember> | null | undefined,
  hostId: string,
  key: string,
  customRole?: AglynOrgCustomRole | null,
): boolean {
  if (!member || !hostRoleFor(member, hostId)) return false
  return resolveMemberHostPermissions({ member, customRole: customRole ?? null, hostId })[key] === true
}

/**
 * Whether deleting a resource is out of this member's reach whatever they hold:
 * they do not reach every site, and it is placed on every site, on several, or on
 * all sites except some. It belongs to the whole workspace.
 */
export function deleteBeyondReach(
  member: Partial<AglynOrgMember> | null | undefined,
  placed: ScopePlaced | null | undefined,
): boolean {
  return !isOrgWideMember(member) && oneSitePlacement(placed) === null
}

/** The refusal for it, which names the reach it takes because no permission decides it. */
export function deleteBeyondReachRefusal(label: string): string {
  return `This ${label.toLowerCase()} is shared beyond one site, so deleting it takes access to every site in the workspace.`
}

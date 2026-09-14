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
import { hostRoleFor, isOrgWideMember } from './organizations'
import {
  ORG_PERMISSIONS,
  resolveOrgPermissions,
  type AglynOrgCustomRole,
} from './org-permissions'

/**
 * Who may open an AI door (AGL-2927), resolved on ONE of two axes.
 *
 * The org catalog carries `ai.use` and `ai.generate` for the people whose
 * membership spans the workspace: their org role's default, refined by a
 * custom role and by per-member overrides, exactly like every other key in
 * `ORG_PERMISSIONS`. A site collaborator has no org standing to refine —
 * their membership exists only to carry access to named sites — so for them
 * the same two keys are decided PER SITE, from the host role they hold
 * there, refined by `hostPermissions[hostId]` on their member document.
 *
 * Which axis applies is `isOrgWideMember`, the predicate the rules
 * projection and the scope resolver already share. A collaborator asked
 * about a site they were never granted resolves to nothing, and a
 * collaborator whose request names no site at all resolves to nothing too:
 * there is no host role to read a default from, and guessing one would let a
 * request reach around the per-site toggle by omitting the site.
 */
export type AiPermission = HostPermissionKey

/** The catalog's two AI keys, in the order the editors render them. */
export const AI_PERMISSION_KEYS: readonly AiPermission[] = ['ai.use', 'ai.generate']

export function isAiPermission(value: unknown): value is AiPermission {
  return value === 'ai.use' || value === 'ai.generate'
}

/** One AI key that moved, and the direction it moved in. */
export interface AiPermissionChange {
  permission: AiPermission
  granted: boolean
}

/**
 * The AI keys whose value moved between two maps, in catalog order — what
 * the activity log records one row each for (AGL-2929).
 *
 * A key the new map leaves unset is not a change: on a role it defers to
 * the base role, on a site toggle to the host role, and neither is a grant
 * or a revocation of its own. A key set for the first time is a change,
 * because the verdict it produces is no longer the default's.
 */
export function aiPermissionChanges(
  before: Partial<Record<AiPermission, boolean>> | null | undefined,
  after: Partial<Record<AiPermission, boolean>> | null | undefined,
): AiPermissionChange[] {
  const changes: AiPermissionChange[] = []
  for (const key of AI_PERMISSION_KEYS) {
    const next = after?.[key]
    if (typeof next !== 'boolean') continue
    if (before?.[key] === next) continue
    changes.push({ permission: key, granted: next })
  }
  return changes
}

/** The catalog label for an AI key — the word a refusal names. */
export function aiPermissionLabel(permission: AiPermission): string {
  return (
    ORG_PERMISSIONS.find((definition) => definition.key === permission)?.label ??
    permission
  )
}

const BOTH: Record<AiPermission, boolean> = { 'ai.use': true, 'ai.generate': true }
const NEITHER: Record<AiPermission, boolean> = {
  'ai.use': false,
  'ai.generate': false,
}

/**
 * What a collaborator's HOST role grants before any per-site override. The
 * three roles that may change content may also ask a model to change it;
 * a viewer who cannot edit has nothing for a generation to land on and
 * would spend the workspace's credits producing it anyway.
 */
export const HOST_ROLE_AI_PERMISSIONS: Record<
  HostAccessRole,
  Record<AiPermission, boolean>
> = {
  admin: BOTH,
  editor: BOTH,
  author: BOTH,
  viewer: NEITHER,
}

/**
 * A collaborator's AI permissions on ONE site, or null where they have no
 * access to that site at all. Absent keys read as the host role's default,
 * which is what makes a member document written before `hostPermissions`
 * existed resolve exactly as it did before.
 */
export function resolveCollaboratorAiPermissions(
  member: Partial<AglynOrgMember> | null | undefined,
  hostId: HostUid | null | undefined,
): Record<AiPermission, boolean> | null {
  if (!member || !hostId) return null
  const role = hostRoleFor(member, hostId)
  if (!role) return null
  const merged = { ...HOST_ROLE_AI_PERMISSIONS[role] }
  const overrides = member.hostPermissions?.[hostId]
  if (overrides) {
    for (const key of AI_PERMISSION_KEYS) {
      const value = overrides[key]
      if (typeof value === 'boolean') merged[key] = value
    }
  }
  return merged
}

/**
 * The AI verdict for a member, on whichever axis their membership is on.
 *
 * `customRole` is the member's custom role document when they carry a
 * `roleId` and the caller has it in hand — the server reads it once, the
 * console reads it beside the member doc — and is ignored for a
 * collaborator, whose org role is a seat-accounting fact rather than a
 * grant. `hostId` is the site the request is about; an org-wide member
 * resolves the same on every site and with none named.
 */
export function resolveAiPermissions(options: {
  member: Partial<AglynOrgMember> | null | undefined
  customRole?: AglynOrgCustomRole | null
  hostId?: HostUid | null
}): Record<AiPermission, boolean> {
  const { member, customRole, hostId } = options
  if (!member) return NEITHER
  if (isOrgWideMember(member)) {
    const granted = resolveOrgPermissions(member, customRole ?? null)
    return { 'ai.use': granted['ai.use'], 'ai.generate': granted['ai.generate'] }
  }
  return resolveCollaboratorAiPermissions(member, hostId) ?? NEITHER
}

/**
 * The `memberPermissions` projection stamped on a host document beside
 * `memberRoles` (AGL-2927): every member who can reach the site, with the
 * AI verdict they hold ON it. Org-wide members are resolved against the
 * custom roles the caller loaded (one read per distinct role, as
 * `syncOrgAuthProjections` already does for `resolvedPermissions`);
 * collaborators against their host role. A member who cannot reach the site
 * has no entry, matching `projectHostMemberRoles`.
 */
export function projectHostMemberAiPermissions(
  members: ReadonlyArray<Partial<AglynOrgMember> & { $id: string }>,
  hostId: HostUid,
  customRoles: ReadonlyMap<string, AglynOrgCustomRole | null>,
): Record<string, Record<AiPermission, boolean>> {
  const projection: Record<string, Record<AiPermission, boolean>> = {}
  for (const member of members) {
    if (!hostRoleFor(member, hostId)) continue
    projection[member.$id] = resolveAiPermissions({
      member,
      customRole: member.roleId ? (customRoles.get(member.roleId) ?? null) : null,
      hostId,
    })
  }
  return projection
}

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
  canManageOrg,
  CONSOLE_USER_TYPE_LABELS,
  consoleUserType,
  isStaffSeat,
} from '@aglyn/aglyn/app-utils/organizations'
import type { MobileApiClient } from '@aglyn/mobile-plugin-host'

/*==========================================
 * THE TEAM, THROUGH THE CONSOLE'S OWN ROUTES.
 *
 * The console's Members card (`org-members-card.component.tsx`) reads the
 * roster from `GET /api/orgs/members` and, for an owner or admin, the
 * pending invites from `GET /api/orgs/invites`; every change is a POST to
 * one of the two with an `action`. These are the same requests with the
 * same bodies, so the routes' own gates (members.manage, seat quota, the
 * owner's row, lockdown) refuse the app exactly as they refuse the console.
 *
 * Adding someone is the console's two steps: a silent `upsert` by email,
 * which adds an existing account at once; its 404 ("no account with that
 * identity") is the normal way into an invite, and any other refusal is
 * real and stops there.
 *=========================================*/

export type AssignableRole = 'admin' | 'editor' | 'viewer'
export type SiteRole = 'admin' | 'editor' | 'author' | 'viewer'

/** The roles the console's pickers offer: never `owner`, which only a handoff moves. */
export const ASSIGNABLE_ROLES: readonly AssignableRole[] = ['admin', 'editor', 'viewer']

/** Per-site roles, weakest first, as the console's access editor offers them. */
export const SITE_ROLE_OPTIONS: ReadonlyArray<SiteRole | 'none'> = ['none', 'viewer', 'author', 'editor', 'admin']

/** What each per-site role means, in the console's words. */
export const SITE_ROLE_HINTS: Record<SiteRole | 'none', string> = {
  none: 'No access to this site',
  viewer: 'Can look, cannot change anything',
  author: 'Can edit content, cannot publish it',
  editor: 'Can edit content and publish it',
  admin: 'Full control of the site, including its people',
}

export interface OrgMember {
  $id: string
  role?: string
  allHosts?: boolean
  hostAccess?: Record<string, string>
  email?: string
  displayName?: string
  title?: string
  photoURL?: string
  staffSeat?: boolean
}

export interface OrgInvite {
  $id: string
  email?: string
  role?: string
  allHosts?: boolean
  hostAccess?: Record<string, string>
  handoff?: unknown
  staffSeat?: boolean
}

/** Who may change the team: owners and admins, as the console's `canManageOrg` decides. */
export const canManageTeam = (role: string | null | undefined) => canManageOrg(role as never)

/** A member's row is changeable only when the reader manages the team and the row is not the owner's. */
export const canEditMember = (readerRole: string | null | undefined, member: Pick<OrgMember, 'role'>) =>
  canManageTeam(readerRole) && member.role !== 'owner'

export const memberName = (member: Pick<OrgMember, '$id' | 'displayName' | 'email'>) =>
  member.displayName || member.email || member.$id

/** `All sites`, or how many sites a member was given by name. */
export function memberAccessLabel(member: Pick<OrgMember, 'role' | 'allHosts' | 'hostAccess'>): string {
  if (member.role === 'owner' || member.role === 'admin' || member.allHosts) return 'All sites'
  const count = Object.keys(member.hostAccess ?? {}).length
  return `${count} site${count === 1 ? '' : 's'}`
}

/** `Manager`, `Collaborator`…, the seat a member's reach makes them. */
export function memberTypeLabel(member: OrgMember | OrgInvite): string {
  return CONSOLE_USER_TYPE_LABELS[consoleUserType(member as never)]
}

export const isStaffMember = (member: OrgMember | OrgInvite) => isStaffSeat(member as never)

export async function listMembers(api: MobileApiClient, orgId: string): Promise<OrgMember[]> {
  const payload = await api.request<{ members?: OrgMember[] }>('/api/orgs/members', { method: 'GET', query: { orgId } })
  return payload?.members ?? []
}

export async function listInvites(api: MobileApiClient, orgId: string): Promise<OrgInvite[]> {
  const payload = await api.request<{ invites?: OrgInvite[] }>('/api/orgs/invites', { method: 'GET', query: { orgId } })
  return payload?.invites ?? []
}

export interface InviteInput {
  email: string
  role: AssignableRole
  allHosts: boolean
  hostAccess: Record<string, SiteRole>
}

/** Adds an existing account, or invites a new one. */
export async function addOrInvite(
  api: MobileApiClient,
  orgId: string,
  input: InviteInput,
): Promise<{ kind: 'added' } | { kind: 'invited'; emailed: boolean }> {
  const email = input.email.trim().toLowerCase()
  const access = input.role === 'admin' || input.allHosts ? {} : { hostAccess: input.hostAccess }
  try {
    await api.request('/api/orgs/members', {
      method: 'POST',
      body: { orgId, action: 'upsert', email, role: input.role, allHosts: input.allHosts, ...access },
    })
    return { kind: 'added' }
  } catch (error) {
    if ((error as { status?: number })?.status !== 404) throw error
  }
  const invited = await api.request<{ emailed?: boolean }>('/api/orgs/invites', {
    method: 'POST',
    body: { orgId, action: 'create', email, role: input.role, allHosts: input.allHosts, ...access },
  })
  return { kind: 'invited', emailed: Boolean(invited?.emailed) }
}

/** A new role; the member's reach is sent as it stands, as the console's role picker does. */
export function changeRole(api: MobileApiClient, orgId: string, member: OrgMember, role: AssignableRole) {
  return api.request('/api/orgs/members', {
    method: 'POST',
    body: {
      orgId,
      action: 'upsert',
      uid: member.$id,
      role,
      allHosts: member.allHosts === true,
      hostAccess: member.hostAccess ?? {},
    },
  })
}

/** A member's site access, as the console's Site access dialog saves it. */
export function setSiteAccess(
  api: MobileApiClient,
  orgId: string,
  member: OrgMember,
  access: { allHosts: boolean; hostAccess: Record<string, string> },
) {
  return api.request('/api/orgs/members', {
    method: 'POST',
    body: {
      orgId,
      action: 'upsert',
      uid: member.$id,
      role: member.role ?? 'viewer',
      allHosts: access.allHosts,
      hostAccess: access.hostAccess,
    },
  })
}

export function removeMember(api: MobileApiClient, orgId: string, uid: string) {
  return api.request('/api/orgs/members', { method: 'POST', body: { orgId, action: 'remove', uid } })
}

export function revokeInvite(api: MobileApiClient, orgId: string, inviteId: string) {
  return api.request('/api/orgs/invites', { method: 'POST', body: { orgId, action: 'revoke', inviteId } })
}

export function resendInvite(api: MobileApiClient, orgId: string, inviteId: string) {
  return api.request<{ emailed?: boolean }>('/api/orgs/invites', {
    method: 'POST',
    body: { orgId, action: 'resend', inviteId },
  })
}

/** A plausible address, as the console's inline check reads one. */
export const isEmailAddress = (value: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim())

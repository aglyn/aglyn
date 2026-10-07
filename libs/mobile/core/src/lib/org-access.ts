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

import { isOrgWideMember, memberScopeTokens } from '@aglyn/aglyn/app-utils/organizations'
import { useMemo } from 'react'
import { useLiveDoc } from './live-doc'

/*==========================================
 * WHO IS READING (AGL-3622).
 *
 * The signed-in person's own member row (`orgs/{orgId}/members/{uid}`,
 * which the rules let a member read), and what the console derives from it
 * with the same core functions: whether the member reaches the whole
 * workspace, and the scope tokens the rules admit their reads by. A screen
 * offers an action only when this says the console would, and the rule or
 * route behind it decides anyway: the app never holds a permission the
 * console does not.
 *=========================================*/

export type MobileOrgRole = 'owner' | 'admin' | 'editor' | 'viewer'

export interface MobileOrgAccess {
  loaded: boolean
  /** The member row, as `{ $id, ...data }`, or null for a non-member. */
  member: (Record<string, unknown> & { $id: string }) | null
  role: MobileOrgRole | null
  /** Owner, admin, every site, or a legacy member with no site list. */
  orgWide: boolean
  /** The scope tokens the rules admit this member's reads by. */
  tokens: readonly string[]
  /** The member's role on each site they were given by name. */
  hostAccess: Readonly<Record<string, string>>
}

const LOADING: MobileOrgAccess = {
  loaded: false,
  member: null,
  role: null,
  orgWide: false,
  tokens: [],
  hostAccess: {},
}

const ROLES = new Set<MobileOrgRole>(['owner', 'admin', 'editor', 'viewer'])

/** What a member row grants, the way the console reads it. */
export function orgAccessFromMember(
  member: (Record<string, unknown> & { $id: string }) | null,
): MobileOrgAccess {
  if (!member) return { ...LOADING, loaded: true }
  const typed = member as Parameters<typeof isOrgWideMember>[0]
  const role = typeof member['role'] === 'string' && ROLES.has(member['role'] as MobileOrgRole)
    ? (member['role'] as MobileOrgRole)
    : null
  const hostAccess = member['hostAccess']
  return {
    loaded: true,
    member,
    role,
    orgWide: isOrgWideMember(typed),
    tokens: memberScopeTokens(typed),
    hostAccess:
      hostAccess && typeof hostAccess === 'object' ? (hostAccess as Record<string, string>) : {},
  }
}

/** The signed-in member's access to the picked workspace, live. */
export function useOrgAccess(firestore: unknown, orgId: string | null, uid: string | null): MobileOrgAccess {
  const member = useLiveDoc<Record<string, unknown>>(
    firestore,
    orgId && uid ? ['orgs', orgId, 'members', uid] : null,
  )
  return useMemo(
    () => (member.ready ? orgAccessFromMember(member.data) : LOADING),
    [member.ready, member.data],
  )
}

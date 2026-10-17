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
import { resolveOrgPermissions } from '@aglyn/aglyn/app-utils/org-permissions'
import { useMemo } from 'react'
import { useLiveDoc } from './live-doc'

/*
 * WHO IS READING (AGL-3622): the signed-in person's own member row
 * (`orgs/{orgId}/members/{uid}`, which the rules let a member read), and
 * what the console derives from it. A screen offers an action only when
 * this says the console would, and the rule or route behind it decides
 * anyway: the app never holds a permission the console does not.
 */

export type MobileOrgRole = 'owner' | 'admin' | 'editor' | 'viewer'

export interface MobileOrgAccess {
  loaded: boolean
  role: MobileOrgRole | null
  /** Owner, admin, every site, or a legacy member with no site list. */
  orgWide: boolean
  /** The scope tokens the rules admit this member's reads by. */
  tokens: readonly string[]
  /** The org permission keys this member holds (`data.manage`, `members.manage`, …). */
  permissions: Readonly<Record<string, boolean>>
  /** The member's role on each site they were given by name. */
  hostAccess: Readonly<Record<string, string>>
}

const NONE: MobileOrgAccess = {
  loaded: false,
  role: null,
  orgWide: false,
  tokens: [],
  permissions: {},
  hostAccess: {},
}

/** What a member row grants, the way the console reads it. */
export function orgAccessFromMember(member: Record<string, unknown> | null): MobileOrgAccess {
  if (!member) return { ...NONE, loaded: true }
  const typed = member as Parameters<typeof isOrgWideMember>[0] & {
    resolvedPermissions?: Record<string, boolean>
  }
  const role = (typeof member['role'] === 'string' ? member['role'] : null) as MobileOrgRole | null
  return {
    loaded: true,
    role,
    orgWide: isOrgWideMember(typed),
    tokens: memberScopeTokens(typed),
    permissions: typed.resolvedPermissions ?? resolveOrgPermissions(typed as never),
    hostAccess: (member['hostAccess'] as Record<string, string> | undefined) ?? {},
  }
}

/** The signed-in member's access to the picked workspace, live. */
export function useOrgAccess(
  firestore: unknown,
  orgId: string | null,
  uid: string | null,
): MobileOrgAccess {
  const member = useLiveDoc<Record<string, unknown>>(
    firestore,
    orgId && uid ? ['orgs', orgId, 'members', uid] : null,
  )
  return useMemo(
    () => (member.ready ? orgAccessFromMember(member.data) : NONE),
    [member.ready, member.data],
  )
}

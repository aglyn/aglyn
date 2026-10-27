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

'use client'

import { type AglynOrgCustomRole, isOrgWideMember, resolveOrgPermissions } from '@aglyn/aglyn'
import { useFirestore, useFirestoreDoc, useUser } from '@aglyn/tenant-feature-instance'
import { doc } from 'firebase/firestore'

/** A membership document, as the permission resolver reads one. */
type MemberRecord = NonNullable<Parameters<typeof resolveOrgPermissions>[0]>

/**
 * Whether the signed-in member may file a privacy erasure, and whether that
 * is known yet (AGL-4047): "Privacy requests" (`org.privacy`) over the whole
 * workspace, the key `/api/crm/erase-person` asks. On for owners and admins
 * by default; a custom role or an override can hand it to another org-wide
 * member or take it from an admin. A site collaborator never files one.
 *
 * Read off the member's own membership document and their custom role when
 * they hold one, both of which the rules let a member read, the way the
 * consent-group cards answer their own key. `ready` separates "no" from "not
 * yet", so the item disables with a reason instead of vanishing.
 */
export function useCanErasePeople(orgId: string | undefined): { canErase: boolean; ready: boolean } {
  const firestore = useFirestore()
  const { data: user } = useUser()
  const uid = user?.uid ?? ''
  const memberRead = useFirestoreDoc<MemberRecord>(
    () => (orgId && uid ? doc(firestore, 'orgs', orgId, 'members', uid) : null),
    [firestore, orgId, uid],
  )
  const member = memberRead.status === 'success' ? memberRead.data : undefined
  const roleId = typeof member?.roleId === 'string' ? member.roleId : ''
  const roleRead = useFirestoreDoc<AglynOrgCustomRole>(
    () => (orgId && roleId ? doc(firestore, 'orgs', orgId, 'roles', roleId) : null),
    [firestore, orgId, roleId],
  )
  const ready =
    Boolean(orgId && uid) && memberRead.status !== 'loading' && (!roleId || roleRead.status !== 'loading')
  const granted = resolveOrgPermissions(
    member ?? null,
    roleId && roleRead.status === 'success' ? (roleRead.data ?? null) : null,
  )
  return { canErase: Boolean(member) && isOrgWideMember(member) && granted['org.privacy'] === true, ready }
}

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

import {
  type AglynOrgCustomRole,
  type OrgPermission,
  orgPermissionLabel,
  resolveOrgPermissions,
} from '@aglyn/aglyn'
import {
  useFirestore,
  useFirestoreDoc,
  useUser,
} from '@aglyn/tenant-feature-instance'
import { doc } from 'firebase/firestore'

/**
 * What a member needs to change anything about the org's consent groups: the
 * declaration itself (`/api/orgs/consent-groups`) or the switch over how its
 * sites treat each other's confirmations (`/api/orgs/settings`). Both routes
 * ask for the org-settings permission and for the permission that opens this
 * console, so both cards ask the same question.
 */
export const CONSENT_GROUP_REQUIRED_PERMISSIONS: readonly OrgPermission[] = [
  'org.settings',
  'data.manage',
]

/** A membership document, as the permission resolver reads one. */
type MemberRecord = NonNullable<Parameters<typeof resolveOrgPermissions>[0]>

/** Whether the signed-in member may change consent groups, once known. */
export interface ConsentGroupAccess {
  /** The label of the first permission they lack, or `null` when they hold both. */
  missing: string | null
  /** False until their membership (and custom role, if any) has been read. */
  ready: boolean
}

/**
 * Which permission the signed-in member lacks to change consent groups — its
 * label, or `null` when they hold both — and whether that is known yet.
 *
 * Read off the member's own membership document, and their custom role when
 * they hold one, both of which the rules let a member read. The shell's
 * permission map carries the legacy keys and the plugin-declared ones, not
 * these two, and the CRM's org settings cards answer the same question the
 * same way. `ready` separates "no" from "not yet", so a control disables with
 * a reason instead of hiding until the read lands. A membership that cannot
 * be read resolves no permission at all; the route decides either way.
 *
 * Handed no org, it opens no read and stays not ready — which is how a card
 * handed the answer by its section avoids a second listen on the same
 * membership.
 */
export function useConsentGroupAccess(
  orgId: string | undefined,
): ConsentGroupAccess {
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
  // A reference that is never built stays `loading`, so a member with no
  // custom role has nothing left to wait for.
  const ready =
    Boolean(orgId && uid) &&
    memberRead.status !== 'loading' &&
    (!roleId || roleRead.status !== 'loading')
  const granted = resolveOrgPermissions(
    member ?? null,
    roleId && roleRead.status === 'success' ? (roleRead.data ?? null) : null,
  )
  const lacking = CONSENT_GROUP_REQUIRED_PERMISSIONS.find(
    (key) => granted[key] !== true,
  )
  return { missing: lacking ? orgPermissionLabel(lacking) : null, ready }
}

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

import { holdsStampedSiteKey } from '@aglyn/aglyn/app-utils/host-permissions'
import { type AglynOrgCustomRole, resolveOrgPermissions } from '@aglyn/aglyn/app-utils/org-permissions'
import { isOrgWideMember } from '@aglyn/aglyn/app-utils/organizations'
import { useFirestore, useFirestoreDoc, useUser } from '@aglyn/tenant-feature-instance'
import { doc } from 'firebase/firestore'
import { CRM_MOVE_STAGES_PERMISSION, CRM_MOVE_STAGES_SITE_ROLE_PRESET } from '../model/crm-permissions'
import { useCrmOrgMount } from './use-crm-org-mount'

/** A membership document, as the permission resolver reads one. */
type MemberRecord = NonNullable<Parameters<typeof resolveOrgPermissions>[0]>

/**
 * Whether the signed-in member is known NOT to hold "Move contacts and deals
 * between stages" where a stage route would ask it (AGL-4047), so a stage
 * control switches off with the permission named beside it.
 *
 * Read as the routes read it. Given a site: the site's `memberPermissions`
 * stamp, else the preset of the member's site role. Given none, beneath the org
 * hub's mount: the catalog's verdict for an org-wide member, off their own
 * membership document and custom role.
 *
 * `true` only once the answer is known, so nobody sees a control flash off
 * while it loads. A reader with no membership in the org is staff, whom the org
 * doors admit: there the server answers. A deal's route also asks "Manage
 * data", which the CRM's pages have already asked by the time this is drawn.
 */
export function useStageMoveBlocked(hostId: string | null | undefined): boolean {
  const firestore = useFirestore()
  const { data: user } = useUser()
  const uid = user?.uid ?? ''
  const site = hostId || ''
  const orgId = useCrmOrgMount()?.orgId ?? ''
  const hostRead = useFirestoreDoc<{ memberRoles?: unknown; memberPermissions?: unknown }>(
    () => (site ? doc(firestore, 'hosts', site) : null),
    [firestore, site],
  )
  const memberRead = useFirestoreDoc<MemberRecord>(
    () => (!site && orgId && uid ? doc(firestore, 'orgs', orgId, 'members', uid) : null),
    [firestore, site, orgId, uid],
  )
  const member = memberRead.status === 'success' ? memberRead.data : undefined
  const roleId = !site && typeof member?.roleId === 'string' ? member.roleId : ''
  const roleRead = useFirestoreDoc<AglynOrgCustomRole>(
    () => (orgId && roleId ? doc(firestore, 'orgs', orgId, 'roles', roleId) : null),
    [firestore, orgId, roleId],
  )
  if (!uid) return false
  if (site) {
    return (
      hostRead.status === 'success' &&
      !holdsStampedSiteKey(hostRead.data, uid, CRM_MOVE_STAGES_PERMISSION, CRM_MOVE_STAGES_SITE_ROLE_PRESET)
    )
  }
  if (!member || (roleId && roleRead.status === 'loading')) return false
  const granted = resolveOrgPermissions(member, roleId && roleRead.status === 'success' ? (roleRead.data ?? null) : null)
  return !(isOrgWideMember(member) && granted[CRM_MOVE_STAGES_PERMISSION] === true)
}

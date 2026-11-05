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

import { useFirestore, useFirestoreDoc, useUser } from '@aglyn/tenant-feature-instance'
import { doc } from 'firebase/firestore'
import { MARKETING_SITE_PERMISSIONS } from '../model/marketing-permissions'

/** What the rule reads off a membership document. */
export interface CampaignContainerMember {
  role?: unknown
  resolvedPermissions?: Readonly<Record<string, unknown>>
  permissions?: Readonly<Record<string, unknown>>
}

/**
 * The rules' answer for writing a campaign container (AGL-4047), `canWriteCampaignContainers`:
 * "Run email campaigns" as written on `resolvedPermissions`, or, for a member the
 * projection never stamped, on their own `permissions`; else their workspace
 * role's default. The workspace's verdict, not a site's, because a container is
 * the workspace's document.
 */
export function holdsCampaignContainers(member: CampaignContainerMember): boolean {
  const stamped = (member.resolvedPermissions ?? member.permissions)?.['marketing.campaigns']
  if (typeof stamped === 'boolean') return stamped
  const defaults: Readonly<Record<string, boolean>> | undefined = MARKETING_SITE_PERMISSIONS[0]?.roleDefaults
  return defaults?.[String(member.role ?? '')] === true
}

/**
 * Whether the member is known not to hold it, so creating or editing a campaign
 * switches off with the permission named instead of failing on save. `false`
 * until the read lands, and for a reader with no membership, who is staff.
 */
export function useCampaignContainersBlocked(orgId: string | null | undefined): boolean {
  const firestore = useFirestore()
  const { data: user } = useUser()
  const uid = user?.uid ?? ''
  const { data: member, status } = useFirestoreDoc<CampaignContainerMember>(
    () => (orgId && uid ? doc(firestore, 'orgs', orgId, 'members', uid) : null),
    [firestore, orgId, uid],
  )
  return status === 'success' && Boolean(member) && !holdsCampaignContainers(member as CampaignContainerMember)
}

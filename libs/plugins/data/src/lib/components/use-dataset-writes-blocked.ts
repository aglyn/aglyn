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
  type OrgPermission,
  permissionRefusalText,
  resolveOrgPermissions,
} from '@aglyn/aglyn/app-utils/org-permissions'
import { useFirestore, useFirestoreDoc, useUser } from '@aglyn/tenant-feature-instance'
import { doc } from 'firebase/firestore'

/** What the doors read off a membership document. */
type DatasetWriter = NonNullable<Parameters<typeof resolveOrgPermissions>[0]> & {
  resolvedPermissions?: Readonly<Record<string, unknown>>
  permissions?: Readonly<Record<string, unknown>>
}

/** Creating, editing and sharing datasets, and every record write. */
export const DATASETS_WRITE_PERMISSION: OrgPermission = 'data.manage'
/** Deleting a whole dataset, which the erase route asks. */
export const DATASETS_DELETE_PERMISSION: OrgPermission = 'org.eraseRecords'

export const DATASETS_WRITE_REFUSAL = permissionRefusalText(DATASETS_WRITE_PERMISSION)
export const DATASETS_DELETE_REFUSAL = permissionRefusalText(DATASETS_DELETE_PERMISSION)

/**
 * A member's answer for a dataset key (AGL-4047), as the rules' `canWriteOrgDatasets`
 * and the routes' `memberHasOrgPermission` read it: the decision written on
 * `resolvedPermissions`, or, for a member the projection never stamped, on their
 * own `permissions`; else their workspace role's default. A workspace key: no
 * site narrows it, so a site's Data page asks the same thing as the workspace's.
 */
export function holdsDatasetPermission(member: DatasetWriter, permission: OrgPermission): boolean {
  const stamped = (member.resolvedPermissions ?? member.permissions)?.[permission]
  if (typeof stamped === 'boolean') return stamped
  return resolveOrgPermissions(member)[permission] === true
}

/**
 * Which dataset writes the signed-in member is known not to hold, so those
 * controls switch off with the permission named rather than failing on save.
 * Neither is blocked until the read lands, nor for a reader with no membership,
 * who is staff. Not a security boundary: the rules and routes refuse regardless.
 */
export function useDatasetWritesBlocked(orgId: string | null | undefined): {
  writes: boolean
  deletes: boolean
} {
  const firestore = useFirestore()
  const { data: user } = useUser()
  const uid = (user as { uid?: string } | undefined)?.uid ?? ''
  const { data: member, status } = useFirestoreDoc<DatasetWriter>(
    () => (orgId && uid ? doc(firestore, 'orgs', orgId, 'members', uid) : null),
    [firestore, orgId, uid],
  )
  if (status !== 'success' || !member) return { writes: false, deletes: false }
  return {
    writes: !holdsDatasetPermission(member, DATASETS_WRITE_PERMISSION),
    deletes: !holdsDatasetPermission(member, DATASETS_DELETE_PERMISSION),
  }
}

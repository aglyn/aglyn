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
  type AglynOrgCustomRole,
  type OrgPermission,
  permissionRefusalText,
  resolveOrgPermissions,
} from '@aglyn/aglyn/app-utils/org-permissions'
import { siteMayNarrow } from '@aglyn/aglyn/app-utils/host-permissions'
import { isOrgWideMember } from '@aglyn/aglyn/app-utils/organizations'
import {
  deleteBeyondReach,
  deleteBeyondReachRefusal,
  oneSitePlacement,
  placementVerdict,
  resolvedPlacementKey,
} from '@aglyn/aglyn/app-utils/site-placement'
import type { AglynOrgMember } from '@aglyn/aglyn/foundation/definitions/organization.types'
import { useFirestore, useFirestoreDoc, useUser } from '@aglyn/tenant-feature-instance'
import { doc } from 'firebase/firestore'
import {
  DATA_ERASE_PERMISSION,
  DATA_EXPORT_PERMISSION,
  DATA_MANAGE_PERMISSION,
  DATA_SITE_DELETE_PERMISSION,
  DATA_SITE_MANAGE_PERMISSION,
  DATA_VIEW_RECORDS_PERMISSION,
} from '../model/dataset-access'

/** What the doors read off a membership document. */
type DatasetWriter = NonNullable<Parameters<typeof resolveOrgPermissions>[0]> & {
  resolvedPermissions?: Readonly<Record<string, unknown>>
  permissions?: Readonly<Record<string, unknown>>
}

/** Creating, editing and sharing datasets, and every record write. */
export const DATASETS_WRITE_PERMISSION: OrgPermission = DATA_MANAGE_PERMISSION
/** Deleting a whole dataset, which the erase route asks. */
export const DATASETS_DELETE_PERMISSION: OrgPermission = DATA_ERASE_PERMISSION

export const DATASETS_WRITE_REFUSAL = permissionRefusalText(DATASETS_WRITE_PERMISSION)
export const DATASETS_DELETE_REFUSAL = permissionRefusalText(DATASETS_DELETE_PERMISSION)
export const DATASETS_VIEW_RECORDS_REFUSAL = permissionRefusalText(DATA_VIEW_RECORDS_PERMISSION)
export const DATASETS_EXPORT_REFUSAL = permissionRefusalText(DATA_EXPORT_PERMISSION)

/**
 * A member's answer for a dataset key (AGL-4047), as the rules' `memberKeyOrOverride`
 * and the routes' `memberHasOrgPermission` read it: the decision written on
 * `resolvedPermissions`, or, for a member the projection never stamped, on their
 * own `permissions`; else their workspace role's default.
 */
export function holdsDatasetPermission(member: DatasetWriter, permission: OrgPermission): boolean {
  const stamped = (member.resolvedPermissions ?? member.permissions)?.[permission]
  if (typeof stamped === 'boolean') return stamped
  return resolveOrgPermissions(member)[permission] === true
}

/** What the signed-in member is known not to be able to do with a dataset, and why. */
export interface DatasetAccessBlocked {
  /** Making a new dataset: "Manage data". */
  creates: boolean
  /** Changing this dataset's schema or records, or importing into it. */
  writes: boolean
  writesReason: string
  /** Deleting this dataset. */
  deletes: boolean
  deletesReason: string
  /** Reading this dataset's records. */
  records: boolean
  /** Taking this dataset's records out as a file. */
  exports: boolean
}

const NOTHING_BLOCKED: DatasetAccessBlocked = {
  creates: false,
  writes: false,
  writesReason: DATASETS_WRITE_REFUSAL,
  deletes: false,
  deletesReason: DATASETS_DELETE_REFUSAL,
  records: false,
  exports: false,
}

/**
 * The verdict for a member and a dataset placed at `visibleTo`, as the rule's
 * `canWriteDatasetOn` and the routes' `memberMayActOnDataset` give it, resolved
 * from what the site's stamp is written from. `customRole` is the member's custom
 * role when they carry one and it was read.
 */
export function datasetAccessBlocked(
  member: DatasetWriter,
  visibleTo: unknown,
  customRole?: AglynOrgCustomRole | null,
): DatasetAccessBlocked {
  const seat = member as Partial<AglynOrgMember>
  const site = oneSitePlacement(visibleTo)
  const writes = placementVerdict<boolean>({
    member: seat,
    visibleTo,
    workspace: holdsDatasetPermission(member, DATA_MANAGE_PERMISSION),
    site: (hostId) => resolvedPlacementKey(seat, hostId, DATA_SITE_MANAGE_PERMISSION, customRole),
  })
  const deletes = placementVerdict<boolean>({
    member: seat,
    visibleTo,
    workspace: holdsDatasetPermission(member, DATA_ERASE_PERMISSION),
    site: (hostId) => resolvedPlacementKey(seat, hostId, DATA_SITE_DELETE_PERMISSION, customRole),
  })
  const beyond = deleteBeyondReach(seat, visibleTo)
  return {
    creates: !holdsDatasetPermission(member, DATA_MANAGE_PERMISSION),
    writes: !writes,
    writesReason: site ? permissionRefusalText(DATA_SITE_MANAGE_PERMISSION) : DATASETS_WRITE_REFUSAL,
    deletes: beyond || !deletes,
    deletesReason: beyond
      ? deleteBeyondReachRefusal('dataset')
      : site
        ? permissionRefusalText(DATA_SITE_DELETE_PERMISSION)
        : DATASETS_DELETE_REFUSAL,
    records: !holdsDatasetPermission(member, DATA_VIEW_RECORDS_PERMISSION),
    exports: !holdsDatasetPermission(member, DATA_EXPORT_PERMISSION),
  }
}

/**
 * Which dataset controls switch off with the reason named rather than failing on
 * save, for the dataset placed at `visibleTo`. Nothing is blocked until the reads
 * land, nor for a reader with no membership, who is staff. Not a security
 * boundary: the rules and routes refuse regardless.
 *
 * Costs the membership the page already reads, and one read of a custom role
 * only for a member of the whole workspace whom the site decides.
 */
export function useDatasetWritesBlocked(
  orgId: string | null | undefined,
  visibleTo?: unknown,
): DatasetAccessBlocked {
  const firestore = useFirestore()
  const { data: user } = useUser()
  const uid = (user as { uid?: string } | undefined)?.uid ?? ''
  const { data: member, status } = useFirestoreDoc<DatasetWriter>(
    () => (orgId && uid ? doc(firestore, 'orgs', orgId, 'members', uid) : null),
    [firestore, orgId, uid],
  )
  const seat = (status === 'success' ? member : null) as (DatasetWriter & { roleId?: unknown }) | null | undefined
  const site = oneSitePlacement(visibleTo)
  // Only someone the site decides: narrowed on it, or on a role wider or narrower here.
  const siteDecides =
    Boolean(seat && site) &&
    isOrgWideMember(seat as Partial<AglynOrgMember>) &&
    (Boolean(siteMayNarrow(seat as Partial<AglynOrgMember>, site)) || !holdsDatasetPermission(seat as DatasetWriter, DATA_MANAGE_PERMISSION))
  const roleId = siteDecides && typeof seat?.roleId === 'string' ? seat.roleId : ''
  const role = useFirestoreDoc<AglynOrgCustomRole>(
    () => (orgId && roleId ? doc(firestore, 'orgs', orgId, 'roles', roleId) : null),
    [firestore, orgId, roleId],
  )
  if (!seat || (roleId && role.status === 'loading')) return NOTHING_BLOCKED
  return datasetAccessBlocked(seat, visibleTo, roleId && role.status === 'success' ? (role.data ?? null) : null)
}

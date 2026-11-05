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

import type { ScopePlaced } from '@aglyn/aglyn/app-utils/site-placement'
import type { AglynOrgMember } from '@aglyn/aglyn/foundation/definitions/organization.types'
import { memberHasOrgPermission } from '@aglyn/tenant-data-admin'
import { memberMayActOnPlaced, placedRefusalPermission } from '@aglyn/tenant-data-admin/server/placement-access'
import {
  DATA_ERASE_PERMISSION,
  DATA_MANAGE_PERMISSION,
  DATA_SITE_DELETE_PERMISSION,
  DATA_SITE_MANAGE_PERMISSION,
  DATA_SITE_ROLE_PRESET,
} from '../model/dataset-access'

/** A dataset act and the two keys that decide it. */
const ACTS = {
  write: { workspaceKey: DATA_MANAGE_PERMISSION, siteKey: DATA_SITE_MANAGE_PERMISSION },
  delete: { workspaceKey: DATA_ERASE_PERMISSION, siteKey: DATA_SITE_DELETE_PERMISSION },
} as const

/** The key a refusal names: the site's on a one-site dataset, else the workspace's. */
export function datasetRefusalPermission(act: keyof typeof ACTS, dataset: ScopePlaced | null | undefined): string {
  return placedRefusalPermission(dataset, ACTS[act].workspaceKey, ACTS[act].siteKey)
}

/** May this member write or delete this dataset, as its document places it? The routes' `canWriteDatasetOn`. */
export async function memberMayActOnDataset(input: {
  firestore: FirebaseFirestore.Firestore
  orgId: string
  uid: string
  member: Partial<AglynOrgMember>
  dataset: ScopePlaced | null | undefined
  act: keyof typeof ACTS
}): Promise<boolean> {
  const { act, dataset, ...rest } = input
  const { workspaceKey, siteKey } = ACTS[act]
  return memberMayActOnPlaced({
    ...rest,
    placed: dataset,
    workspace: await memberHasOrgPermission(input.orgId, input.member, workspaceKey as never),
    workspaceKey,
    siteKey,
    sitePreset: DATA_SITE_ROLE_PRESET,
  })
}

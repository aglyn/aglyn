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

import { parseTransferResourceKey } from '@aglyn/aglyn/data-transfer'
import type { AglynOrgMember } from '@aglyn/aglyn/foundation/definitions/organization.types'
import type {
  TransferImportAccessSubject,
  TransferImportAccessVerdict,
} from '@aglyn/aglyn/plugin-manager/plugin-transfer-resources'
import { firebaseAdmin } from '@aglyn/tenant-data-admin/server/firebase-admin'
import { datasetRefusalPermission, memberMayActOnDataset } from '../server/dataset-access.server'

/**
 * Who may import into one dataset (AGL-4047): whoever may write it, by where it
 * is placed. A dataset the member cannot see, or that is gone, is the resource's
 * own 404 once the engine reads it, so it answers here as the workspace key does.
 */
export async function datasetImportAccess(subject: TransferImportAccessSubject): Promise<TransferImportAccessVerdict> {
  const firestore = firebaseAdmin.app().firestore() as unknown as FirebaseFirestore.Firestore
  const datasetId = parseTransferResourceKey(subject.resource).instance ?? ''
  const dataset = datasetId
    ? await firestore.collection('orgs').doc(subject.orgId).collection('datasets').doc(datasetId).get()
    : null
  const placed = dataset?.exists ? dataset.data() : undefined
  const allowed = await memberMayActOnDataset({
    firestore,
    orgId: subject.orgId,
    uid: subject.uid,
    member: subject.member as Partial<AglynOrgMember>,
    dataset: placed,
    act: 'write',
  })
  return allowed ? { allowed: true } : { allowed: false, permission: datasetRefusalPermission('write', placed) }
}

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

/**
 * Resolves a dataset by its human name: console-created docs store it as
 * `displayName` (AGL-536); the `name` fallback covers pre-migration docs.
 */
export async function findDatasetByName(
  datasetsRef: FirebaseFirestore.CollectionReference,
  datasetName: string,
): Promise<FirebaseFirestore.QueryDocumentSnapshot | undefined> {
  const byDisplayName = await datasetsRef
    .where('displayName', '==', datasetName)
    .limit(1)
    .get()
  if (!byDisplayName.empty) return byDisplayName.docs[0]
  return (
    await datasetsRef.where('name', '==', datasetName).limit(1).get()
  ).docs[0]
}

/**
 * Id-first dataset resolution (AGL-556): a `datasetId` binding is a
 * direct doc get — display names never enter into it, so renamed
 * datasets keep receiving records. When the id is absent or doesn't
 * resolve, the human-name query (AGL-536 semantics) is the legacy
 * fallback. Returns undefined when neither resolves; callers still own
 * the `deletedAt` check.
 */
export async function resolveDatasetDoc(
  datasetsRef: FirebaseFirestore.CollectionReference,
  binding: { datasetId?: string | null; datasetName?: string | null },
): Promise<FirebaseFirestore.DocumentSnapshot | undefined> {
  const datasetId = binding.datasetId?.trim()
  if (datasetId) {
    const datasetDoc = await datasetsRef.doc(datasetId).get()
    if (datasetDoc.exists) return datasetDoc
  }
  const datasetName = binding.datasetName?.trim()
  if (!datasetName) return undefined
  return findDatasetByName(datasetsRef, datasetName)
}

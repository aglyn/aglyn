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

import * as Aglyn from '@aglyn/aglyn/server'

/**
 * Resolves a dataset by its human name: console-created docs store it as
 * `displayName` (AGL-536); the `name` fallback covers pre-migration docs.
 *
 * `scope` narrows the candidates to what one host may see (AGL-1039). It
 * is applied INSIDE the query rather than to the result, which is what
 * makes the collision case come out right: when a host-scoped dataset and
 * an org-wide one share a display name, an unscoped `limit(1)` would pick
 * one arbitrarily and a post-filter would then reject it — reading as
 * "no such dataset" when a perfectly visible one exists.
 */
export async function findDatasetByName(
  datasetsRef: FirebaseFirestore.CollectionReference,
  datasetName: string,
  scope?: (query: FirebaseFirestore.Query) => FirebaseFirestore.Query,
): Promise<FirebaseFirestore.QueryDocumentSnapshot | undefined> {
  const narrow = scope ?? ((query: FirebaseFirestore.Query) => query)
  const byDisplayName = await narrow(
    datasetsRef.where('displayName', '==', datasetName),
  )
    .limit(1)
    .get()
  if (!byDisplayName.empty) return byDisplayName.docs[0]
  return (
    await narrow(datasetsRef.where('name', '==', datasetName)).limit(1).get()
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
  hostId: string,
): Promise<FirebaseFirestore.DocumentSnapshot | undefined> {
  // `hostId` is required rather than optional on purpose (AGL-1039): every
  // caller here writes records into whatever comes back, and an optional
  // scope is one a future caller forgets to pass. The Admin SDK ignores
  // rules, so this is the only thing standing between a client site and
  // another client's dataset.
  const orgScoped = datasetsRef.parent?.parent?.id === 'orgs'
  const datasetId = binding.datasetId?.trim()
  if (datasetId) {
    const datasetDoc = await datasetsRef.doc(datasetId).get()
    if (
      datasetDoc.exists &&
      (!orgScoped ||
        Aglyn.visibleToHost(datasetDoc.get('visibleTo'), hostId))
    ) {
      return datasetDoc
    }
    // A hit this host cannot see is NOT a reason to fall through to the
    // name lookup — that would answer "which dataset is called X" for a
    // binding that already named a specific one.
    if (datasetDoc.exists) return undefined
  }
  const datasetName = binding.datasetName?.trim()
  if (!datasetName) return undefined
  return findDatasetByName(
    datasetsRef,
    datasetName,
    orgScoped
      ? (query) =>
          query.where(
            'visibleTo',
            'array-contains-any',
            Aglyn.scopeTokensForHost(hostId),
          )
      : undefined,
  )
}

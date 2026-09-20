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
  datasetDisplayName,
  effectiveDatasetModel,
  type HostDataset,
  type HostDatasetRecord,
  REPEAT_MAX_RECORDS,
  type RepeatableDataset,
  scopeTokensForHost,
  visibleToHost,
} from '@aglyn/aglyn'
import type { RepeatRowsAnswer } from '@aglyn/aglyn/app-utils/repeat-sources'
import { repeatRecordsFromPages } from '@aglyn/tenant-runtime/repeat-record-pages'
import {
  collection,
  doc,
  type DocumentReference,
  type DocumentSnapshot,
  documentId,
  type Firestore,
  getDoc,
  getDocs,
  limit,
  orderBy,
  query,
  type QuerySnapshot,
  where,
} from 'firebase/firestore'

export interface DatasetRepeatRowsRequest {
  firestore: Firestore
  /** `['orgs', orgId]` — where the site's organization keeps its datasets. */
  scope: readonly [string, string]
  /** The site the canvas edits. */
  hostId: string
  /** The dataset key exactly as the node stores it: an id or a display name. */
  key: string
}

/**
 * A dataset's rows for the besigner's canvas preview, read the way the
 * published page's composition reads them (`getDatasets` in the tenant
 * runtime), with the client SDK instead of the Admin one (AGL-3111).
 *
 * - The key resolves as the page resolves it: an id first, then a display
 *   name within what this site may see. An id that exists but that this site
 *   cannot see does not fall through to the name — that would answer "which
 *   dataset is called X" for a key that already named a specific one.
 * - A dataset shared with other sites but not this one, or deleted, answers
 *   `missing`: the page renders the element once, as written.
 * - The rows are the two bounded reads and the one ordering rule the page
 *   uses, {@link repeatRecordsFromPages}, so a canvas copy is a row the page
 *   renders.
 * - One reference hop (AGL-180) is loaded as the page loads it, so
 *   `{{item.author.name}}` previews too.
 */
export async function readDatasetRepeatRows(
  request: DatasetRepeatRowsRequest,
): Promise<RepeatRowsAnswer> {
  const { firestore, scope, hostId } = request
  const key = request.key.trim()
  if (!key) return { status: 'missing' }
  const datasets = collection(firestore, scope[0], scope[1], 'datasets')
  const usable = (snapshot: DocumentSnapshot | undefined) =>
    Boolean(snapshot?.exists()) &&
    !snapshot?.get('deletedAt') &&
    visibleToHost(snapshot?.get('visibleTo'), hostId)

  let dataset: DocumentSnapshot | undefined
  let resolvedById = false
  if (!key.includes('/')) {
    const byId = await getDoc(doc(datasets, key))
    if (byId.exists()) {
      resolvedById = true
      dataset = usable(byId) ? byId : undefined
    }
  }
  if (!resolvedById) {
    const byName = await getDocs(
      query(
        datasets,
        where('visibleTo', 'array-contains-any', scopeTokensForHost(hostId)),
        where('displayName', '==', key),
        limit(1),
      ),
    )
    dataset = byName.docs.find((snapshot) => usable(snapshot))
  }
  if (!dataset) return { status: 'missing' }

  const load = async (snapshot: DocumentSnapshot): Promise<RepeatableDataset> => ({
    records: await readRepeatRows(snapshot.ref),
    model: effectiveDatasetModel(snapshot.data() as HostDataset),
  })
  const rows = await load(dataset)
  const rowsByKey: Record<string, RepeatableDataset> = {
    [key]: rows,
    [dataset.id]: rows,
  }

  const targets = new Set<string>()
  for (const fieldId of rows.model?.order ?? []) {
    const field = rows.model?.fields[fieldId]
    const targetId =
      field?.type === 'reference' ? field.reference?.datasetId : undefined
    if (targetId && !targetId.includes('/') && !rowsByKey[targetId]) {
      targets.add(targetId)
    }
  }
  await Promise.all(
    [...targets].map(async (targetId) => {
      // Per target, like the page: a hop that cannot be read leaves its
      // tokens literal without costing the rows it hangs off.
      try {
        const target = await getDoc(doc(datasets, targetId))
        if (usable(target)) rowsByKey[targetId] = await load(target)
      } catch (error) {
        console.error(error)
      }
    }),
  )

  return {
    status: 'ready',
    label: datasetDisplayName(dataset.data() as HostDataset) || key,
    rowsByKey,
  }
}

/** Both bounded reads, the second only when the first came back short. */
async function readRepeatRows(
  datasetRef: DocumentReference,
): Promise<Array<Record<string, unknown>>> {
  const records = collection(datasetRef, 'records')
  const page = (snapshot: QuerySnapshot) =>
    snapshot.docs.map((record) => ({
      id: record.id,
      data: record.data() as HostDatasetRecord,
    }))
  const byOrder = await getDocs(
    query(records, orderBy('order'), limit(REPEAT_MAX_RECORDS)),
  )
  const byId =
    byOrder.docs.length < REPEAT_MAX_RECORDS
      ? await getDocs(
          query(records, orderBy(documentId()), limit(REPEAT_MAX_RECORDS)),
        )
      : undefined
  return repeatRecordsFromPages(page(byOrder), byId ? page(byId) : [])
}

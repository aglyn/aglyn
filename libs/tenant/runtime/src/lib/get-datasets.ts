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
import { orgDataQueryForHost } from '@aglyn/tenant-data-admin'
import {
  PUBLISHED_SITE_DATA_TTL_SECONDS,
  tenantDataTag,
  withRenderCache,
} from '@aglyn/tenant-data-admin/render-cache'
import { FieldPath } from 'firebase-admin/firestore'

/**
 * The single worst read amplifier of the compose bundle (AGL-1302): the
 * datasets query PLUS a records subquery per dataset, on every render of
 * every path. Records are already mapped to plain values before return, so
 * the cached shape is byte-identical to what repeatable expansion consumed
 * before. Backstop only; the publish path busts the tag — see PUBLISHED_SITE_DATA_TTL_SECONDS.
 */
const DATASETS_TTL_SECONDS = PUBLISHED_SITE_DATA_TTL_SECONDS

/**
 * Fetches the host's datasets with their records for repeatable expansion
 * (AGL-103), keyed by BOTH dataset id and display name (editors type the
 * friendly name into the Repeat attribute). Records are editor-ordered and
 * capped at the repeat bound. Fail-open: on error an empty map is returned
 * and repeatable containers render their template untouched.
 *
 * Scoped to what THIS host may see (AGL-1039). It used to load every
 * dataset the org owned for whichever host was rendering, which — because
 * the map is keyed by `displayName` as well as id — let a client site bind
 * a repeatable to `products` and publicly render the agency's internal
 * `products`. The Admin SDK does not evaluate rules, so AGL-1041 does not
 * cover this path; the filter has to live here.
 */
export async function getDatasets(options: {
  hostId: string
}): Promise<Record<string, Aglyn.RepeatableDataset>> {
  try {
    return await withRenderCache({
      key: ['tenant-datasets', options.hostId],
      revalidate: DATASETS_TTL_SECONDS,
      tags: [tenantDataTag(options.hostId)],
      read: () => readDatasets(options),
    })
  } catch (error) {
    console.error(error)
    return readDatasets(options)
  }
}

async function readDatasets(options: {
  hostId: string
}): Promise<Record<string, Aglyn.RepeatableDataset>> {
  const datasets: Record<string, Aglyn.RepeatableDataset> = {}
  try {
    // Datasets are org-scoped (AGL-237); the helper falls back to the host
    // path for hosts not yet org-wired, and narrows the org path to this
    // host's scope tokens. The cap applies AFTER the scope filter, so a
    // host still sees up to 50 of the datasets it may actually use rather
    // than 50 of the org's and then nothing.
    const { query } = await orgDataQueryForHost(options.hostId, 'datasets')
    const snapshot = await query.limit(50).get()
    await Promise.all(
      snapshot.docs.map(async (docSnapshot) => {
        const records = await readRepeatRecords(docSnapshot.ref)
        const dataset: Aglyn.RepeatableDataset = {
          records,
          model: Aglyn.effectiveDatasetModel(
            docSnapshot.data() as Aglyn.HostDataset,
          ),
        }
        datasets[docSnapshot.id] = dataset
        const displayName = docSnapshot.get('displayName')
        if (typeof displayName === 'string' && displayName.trim()) {
          datasets[displayName.trim()] = dataset
        }
      }),
    )
  } catch (error) {
    console.error(error)
  }
  return datasets
}

/**
 * The records a repeat renders, in the order it renders them.
 *
 * The rows a repeat shows are the ones `sortDatasetRecords` puts first: every
 * record with an editor `order`, ascending, then the records without one —
 * forms and Actions append those — by document id. A `limit()` with no
 * `orderBy` cannot find them: Firestore answers it in document-id order, so on
 * a dataset past the bound it reads an arbitrary sample, and sorting that
 * sample afterwards only makes it look ordered.
 *
 * `orderBy('order')` reads the first group, and matches only documents that
 * carry the field. When it comes back short, every ordered record is already
 * in hand — so at most that many rows of the first page by document id can be
 * ordered, and the rest of that page is exactly the first unordered records.
 * Two bounded reads, never a walk of the collection.
 */
async function readRepeatRecords(
  datasetRef: FirebaseFirestore.DocumentReference,
): Promise<Array<Record<string, unknown>>> {
  const recordsRef = datasetRef.collection('records')
  const byOrder = await recordsRef
    .orderBy('order')
    .limit(Aglyn.REPEAT_MAX_RECORDS)
    .get()
  const snapshots = [...byOrder.docs]
  if (byOrder.docs.length < Aglyn.REPEAT_MAX_RECORDS) {
    const held = new Set(byOrder.docs.map((snapshot) => snapshot.id))
    const byId = await recordsRef
      .orderBy(FieldPath.documentId())
      .limit(Aglyn.REPEAT_MAX_RECORDS)
      .get()
    snapshots.push(...byId.docs.filter((snapshot) => !held.has(snapshot.id)))
  }
  return (
    Aglyn.sortDatasetRecords(
      snapshots.map((snapshot) => ({
        $id: snapshot.id,
        ...(snapshot.data() as Aglyn.HostDatasetRecord),
      })),
    )
      .slice(0, Aglyn.REPEAT_MAX_RECORDS)
      // `$id` rides inside the value map so incoming reference hops (AGL-180)
      // can resolve rows; the model carries field configs.
      .map((record) => ({ ...(record.values ?? {}), $id: record.$id }))
  )
}

export default getDatasets

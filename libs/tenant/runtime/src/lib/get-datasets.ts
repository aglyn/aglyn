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
 * The render path's largest read (AGL-1302): up to two pages of records per
 * dataset a page repeats over. Records are mapped to plain values before
 * return, so the cached shape is what repeatable expansion consumes. Backstop
 * only; the publish path busts the tag — see PUBLISHED_SITE_DATA_TTL_SECONDS.
 */
const DATASETS_TTL_SECONDS = PUBLISHED_SITE_DATA_TTL_SECONDS

/**
 * The datasets a page repeats over, with their records, for repeatable
 * expansion (AGL-103).
 *
 * `keys` are the page's repeat keys (`repeatDatasetKeys`), each a dataset id or
 * a display name — editors type the friendly name into the Repeat attribute.
 * The map answers under every key exactly as written, and under every loaded
 * dataset's id, which is how a reference hop (AGL-180) finds its target.
 * Records are editor-ordered and capped at the repeat bound.
 *
 * Only the datasets the page names are read. A site may see thousands of
 * datasets, and a read of "the site's datasets" can only ever be a bounded
 * page of them, so a repeat bound to one outside that page rendered its
 * template once with nothing to say why.
 *
 * Fail-open, per key: a key that cannot be read is left out, and its
 * repeatable renders its template untouched, without costing the others.
 *
 * Scoped to what THIS host may see (AGL-1039): a display name resolves inside
 * the host's scope, and an id outside it resolves to nothing. The Admin SDK
 * does not evaluate rules, so AGL-1041 does not cover this path; the filter
 * has to live here.
 */
export async function getDatasets(options: {
  hostId: string
  keys: readonly string[]
}): Promise<Record<string, Aglyn.RepeatableDataset>> {
  const keys = [
    ...new Set(options.keys.map((key) => key.trim()).filter(Boolean)),
  ].sort()
  if (!keys.length) return {}
  try {
    return await withRenderCache({
      key: ['tenant-datasets', options.hostId, ...keys],
      revalidate: DATASETS_TTL_SECONDS,
      tags: [tenantDataTag(options.hostId)],
      read: () => readDatasets(options.hostId, keys),
    })
  } catch (error) {
    console.error(error)
    return readDatasets(options.hostId, keys)
  }
}

async function readDatasets(
  hostId: string,
  keys: readonly string[],
): Promise<Record<string, Aglyn.RepeatableDataset>> {
  const datasets: Record<string, Aglyn.RepeatableDataset> = {}
  try {
    const { ref, query } = await orgDataQueryForHost(hostId, 'datasets')
    // The same visibility rule `resolveDatasetDoc` applies: a keyed read
    // bypasses the scoped query, so the scope is checked on the document.
    const orgScoped = ref.parent?.parent?.id === 'orgs'
    const usable = (snapshot: FirebaseFirestore.DocumentSnapshot | undefined) =>
      Boolean(snapshot?.exists) &&
      !snapshot?.get('deletedAt') &&
      (!orgScoped || Aglyn.visibleToHost(snapshot?.get('visibleTo'), hostId))

    const loads = new Map<string, Promise<Aglyn.RepeatableDataset>>()
    const load = (snapshot: FirebaseFirestore.DocumentSnapshot) => {
      let dataset = loads.get(snapshot.id)
      if (!dataset) {
        dataset = readRepeatRecords(snapshot.ref).then((records) => ({
          records,
          model: Aglyn.effectiveDatasetModel(
            snapshot.data() as Aglyn.HostDataset,
          ),
        }))
        loads.set(snapshot.id, dataset)
      }
      return dataset
    }

    // An id first, then a display name. An id that exists but that this host
    // cannot see does not fall through to the name: that would answer "which
    // dataset is called X" for a key that already named a specific one.
    const resolveKey = async (key: string) => {
      if (!key.includes('/')) {
        const byId = await ref.doc(key).get()
        if (byId.exists) return usable(byId) ? byId : undefined
      }
      const byName = await query.where('displayName', '==', key).limit(1).get()
      return byName.docs.find((snapshot) => usable(snapshot))
    }

    const resolved = await Promise.all(
      keys.map(async (key) => {
        try {
          const snapshot = await resolveKey(key)
          if (!snapshot) return undefined
          const dataset = await load(snapshot)
          datasets[key] = dataset
          datasets[snapshot.id] = dataset
          return dataset
        } catch (error) {
          console.error(error)
          return undefined
        }
      }),
    )

    // One reference hop (AGL-180): `{{item.author.name}}` reads the target's
    // rows by id, so the target has to be loaded even though no repeat names it.
    const targets = new Set<string>()
    for (const dataset of resolved) {
      for (const fieldId of dataset?.model?.order ?? []) {
        const field = dataset?.model?.fields[fieldId]
        const targetId =
          field?.type === 'reference' ? field.reference?.datasetId : undefined
        if (targetId && !targetId.includes('/') && !datasets[targetId]) {
          targets.add(targetId)
        }
      }
    }
    await Promise.all(
      [...targets].map(async (targetId) => {
        try {
          const target = await ref.doc(targetId).get()
          if (usable(target)) datasets[targetId] = await load(target)
        } catch (error) {
          console.error(error)
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

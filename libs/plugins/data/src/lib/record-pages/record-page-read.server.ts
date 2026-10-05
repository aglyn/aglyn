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

import { type RepeatableDataset, visibleToHost } from '@aglyn/aglyn/server'
import { firebaseAdmin, orgDataQueryForHost } from '@aglyn/tenant-data-admin'
import {
  PUBLISHED_SITE_DATA_TTL_SECONDS,
  tenantDataTag,
  withRenderCache,
} from '@aglyn/tenant-data-admin/render-cache'
import {
  datasetFilterValuePath,
  type DatasetModel,
  effectiveDatasetModel,
  repeatRowsModelOf,
} from '../model/dataset-models'
import {
  datasetDisplayName,
  type HostDataset,
  type HostDatasetRecord,
  sortDatasetRecords,
} from '../model/datasets'
import {
  DATASET_RECORD_PAGES_COLLECTION,
  type DatasetRecordPageBinding,
  RECORD_PAGES_MAX_PER_SITE,
  parseRecordPageBinding,
  recordAddressOf,
  referencedRecordIds,
} from './record-pages'

/**
 * A site's record templates (AGL-3475), read once per render cache window and
 * dropped with everything else the site caches under `tenant-data:{hostId}`,
 * which every binding change busts.
 *
 * Asked on every request no published page claims, so it is one small cached
 * read, bounded by {@link RECORD_PAGES_MAX_PER_SITE}. A site with none caches
 * the empty list, which is the answer for almost every site.
 */
export async function readSiteRecordPageBindings(
  hostId: string,
): Promise<DatasetRecordPageBinding[]> {
  const read = async () => {
    const snapshot = await firebaseAdmin
      .app()
      .firestore()
      .collection('hosts')
      .doc(hostId)
      .collection(DATASET_RECORD_PAGES_COLLECTION)
      .limit(RECORD_PAGES_MAX_PER_SITE)
      .get()
    return snapshot.docs
      .map((doc) => parseRecordPageBinding(doc.id, doc.data()))
      .filter((binding): binding is DatasetRecordPageBinding => binding != null)
  }
  try {
    return await withRenderCache({
      key: ['tenant-record-pages', 'v1', hostId],
      revalidate: PUBLISHED_SITE_DATA_TTL_SECONDS,
      tags: [tenantDataTag(hostId)],
      read,
    })
  } catch (error) {
    console.error('record page bindings: cached read failed', error)
    return read()
  }
}

/** A dataset this site may see, with its model, or `null`. */
export interface SiteDataset {
  id: string
  name: string
  model: DatasetModel
  ref: FirebaseFirestore.DocumentReference
}

/**
 * The dataset a binding names, when THIS site may see it — the rule the
 * published repeat reader applies (`visibleTo`, AGL-1039), checked on the
 * document because a keyed read bypasses the scoped query. A deleted dataset,
 * or one no longer shared with the site, is `null`, and its record pages stop
 * serving rather than serving what the site may no longer show.
 */
export async function readSiteDataset(
  hostId: string,
  datasetId: string,
): Promise<SiteDataset | null> {
  if (!datasetId || datasetId.includes('/')) return null
  const { ref } = await orgDataQueryForHost(hostId, 'datasets')
  const snapshot = await ref.doc(datasetId).get()
  const orgScoped = ref.parent?.parent?.id === 'orgs'
  if (
    !snapshot.exists ||
    snapshot.get('deletedAt') ||
    (orgScoped && !visibleToHost(snapshot.get('visibleTo'), hostId))
  ) {
    return null
  }
  const data = snapshot.data() as HostDataset
  return {
    id: snapshot.id,
    name: datasetDisplayName(data),
    model: effectiveDatasetModel(data),
    ref: snapshot.ref,
  }
}

/** One routed record, ready for the template: its row and its one hop. */
export interface RecordPageRecord {
  dataset: { id: string; name: string; model: DatasetModel }
  /** The record's values, with `$id` inside like a repeated row. */
  record: Record<string, unknown>
  /** The datasets its reference fields point into, for one-hop tokens. */
  datasetsByKey: Record<string, RepeatableDataset>
  /** The record's write time, for the sitemap's and the head's dates. */
  updatedAt?: unknown
}

/** How many records the indexed lookup reads for one address. */
const ADDRESS_LOOKUP_LIMIT = 10

/**
 * The record a binding serves at `address`, or `null` — an unknown address,
 * a dataset the site may not see, a slug field the model no longer has.
 *
 * Found through `filterValues.<slugField>`, the equality index every record
 * write keeps (AGL-3321): a page address is stored normalized, which is
 * exactly the key a plain text value's entry holds, so the lookup needs no
 * index of its own. The candidates are then matched on the stored value
 * itself, and when two records share an address the one first in the
 * dataset's own order serves — the order a repeat lists them in.
 */
export async function readRecordPageRecord(
  hostId: string,
  binding: DatasetRecordPageBinding,
  address: string,
): Promise<RecordPageRecord | null> {
  const read = () => readRecordUncached(hostId, binding, address)
  try {
    // `null` is not cached (the cache stores only a defined answer), so an
    // address that starts existing is found on its next request.
    return (
      (await withRenderCache({
        key: [
          'tenant-record-page',
          'v1',
          hostId,
          binding.datasetId,
          binding.slugField,
          address,
        ],
        revalidate: PUBLISHED_SITE_DATA_TTL_SECONDS,
        tags: [tenantDataTag(hostId)],
        read: async () => (await read()) ?? undefined,
      })) ?? null
    )
  } catch (error) {
    console.error('record page: cached read failed', error)
    return read()
  }
}

async function readRecordUncached(
  hostId: string,
  binding: DatasetRecordPageBinding,
  address: string,
): Promise<RecordPageRecord | null> {
  const dataset = await readSiteDataset(hostId, binding.datasetId)
  if (!dataset) return null
  const field = dataset.model.fields[binding.slugField]
  const path = datasetFilterValuePath(binding.slugField)
  if (!field || field.type !== 'text' || !path) return null
  const snapshot = await dataset.ref
    .collection('records')
    .where(path, '==', address)
    .limit(ADDRESS_LOOKUP_LIMIT)
    .get()
  const [match] = sortDatasetRecords(
    snapshot.docs
      .map((doc) => ({ $id: doc.id, ...(doc.data() as HostDatasetRecord) }))
      .filter((record) => recordAddressOf(record.values, binding.slugField) === address),
  )
  if (!match) return null
  const record = { ...(match.values ?? {}), $id: match.$id }
  return {
    dataset: { id: dataset.id, name: dataset.name, model: dataset.model },
    record,
    datasetsByKey: await readReferenceHops(hostId, dataset.model, record),
    updatedAt: (match as { updatedAt?: unknown }).updatedAt,
  }
}

/**
 * The records a routed record's reference fields point at, keyed by the
 * dataset each lives in — just those records, by id, rather than the first
 * hundred rows a repeat would read. A target the site may not see is left
 * out, and its token stays as written, as in a repeat.
 */
async function readReferenceHops(
  hostId: string,
  model: DatasetModel,
  record: Record<string, unknown>,
): Promise<Record<string, RepeatableDataset>> {
  const wanted = referencedRecordIds(repeatRowsModelOf(model), record)
  const answer: Record<string, RepeatableDataset> = {}
  await Promise.all(
    [...wanted].map(async ([datasetId, ids]) => {
      try {
        const target = await readSiteDataset(hostId, datasetId)
        if (!target) return
        const docs = await Promise.all(
          [...ids].map((id) => target.ref.collection('records').doc(id).get()),
        )
        answer[datasetId] = {
          records: docs
            .filter((doc) => doc.exists)
            .map((doc) => ({
              ...((doc.data() as HostDatasetRecord).values ?? {}),
              $id: doc.id,
            })),
        }
      } catch (error) {
        console.error('record page: reference hop failed', error)
      }
    }),
  )
  return answer
}

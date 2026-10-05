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

import type { PluginLivePathsReader } from '@aglyn/aglyn/plugin-manager/plugin-live-paths'
import { firebaseAdmin } from '@aglyn/tenant-data-admin'
import { FieldPath } from 'firebase-admin/firestore'
import { readSiteDataset } from './record-page-read.server'
import {
  DATASET_RECORD_PAGES_COLLECTION,
  type DatasetRecordPageBinding,
  RECORD_PAGES_MAX_PER_SITE,
  parseRecordPageBinding,
  recordAddressOf,
  recordPagePath,
} from './record-pages'

/**
 * How many record pages one cache drop names per record template.
 *
 * A services or locations dataset fits inside it whole; a larger one names
 * its first records by id and says it was cut short, and the rest refresh on
 * their next visit through the host's data tag, which every drop busts first.
 */
export const RECORD_PAGE_DROP_LIMIT = 200

/**
 * A site's record templates read straight from Firestore, uncached — for the
 * console's publish paths, which must see a binding the moment it is written,
 * and which run outside the tenant's render cache anyway.
 */
export async function readRecordPageBindingsUncached(
  hostId: string,
): Promise<DatasetRecordPageBinding[]> {
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

/**
 * One template's record pages, by the records' addresses: at most
 * {@link RECORD_PAGE_DROP_LIMIT}, and `truncated` when there were more. A
 * dataset the site may no longer see names none.
 */
export async function recordPagePathsOf(
  hostId: string,
  binding: DatasetRecordPageBinding,
): Promise<{ paths: string[]; truncated: boolean }> {
  const dataset = await readSiteDataset(hostId, binding.datasetId)
  if (!dataset) return { paths: [], truncated: false }
  const rows = await dataset.ref
    .collection('records')
    .orderBy(FieldPath.documentId())
    .limit(RECORD_PAGE_DROP_LIMIT + 1)
    .select(`values.${binding.slugField}`)
    .get()
  const paths = new Set<string>()
  for (const row of rows.docs.slice(0, RECORD_PAGE_DROP_LIMIT)) {
    const address = recordAddressOf(row.get('values'), binding.slugField)
    if (address) paths.add(recordPagePath(binding.base, address))
  }
  return { paths: [...paths], truncated: rows.docs.length > RECORD_PAGE_DROP_LIMIT }
}

/**
 * The record pages a dataset's change makes stale on one site: every page of
 * every template there that renders the dataset.
 */
export async function recordPagePathsForDataset(
  hostId: string,
  datasetId: string,
): Promise<{ paths: string[]; truncated: boolean }> {
  const bindings = (await readRecordPageBindingsUncached(hostId)).filter(
    (binding) => binding.datasetId === datasetId,
  )
  const answers = await Promise.all(
    bindings.map((binding) => recordPagePathsOf(hostId, binding)),
  )
  return {
    paths: [...new Set(answers.flatMap((answer) => answer.paths))],
    truncated: answers.some((answer) => answer.truncated),
  }
}

/**
 * The record pages a publish makes stale (AGL-3475), answered on the
 * platform's live-paths seam: the pages drawn by the screens being published,
 * or by every record template on the site for a whole-site publish.
 */
export const recordPageLivePaths: PluginLivePathsReader = async ({ hostId, screenIds }) => {
  const bindings = (await readRecordPageBindingsUncached(hostId)).filter(
    (binding) => !screenIds || screenIds.includes(binding.screenId),
  )
  const answers = await Promise.all(
    bindings.map((binding) => recordPagePathsOf(hostId, binding)),
  )
  return [...new Set(answers.flatMap((answer) => answer.paths))]
}

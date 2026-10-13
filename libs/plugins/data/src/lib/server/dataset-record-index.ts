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

import { visibleToHost } from '@aglyn/aglyn/app-utils/scope-tokens'
import type {
  PluginIndexedRecord,
  PluginRecordIndex,
} from '@aglyn/aglyn/plugin-manager/plugin-record-index'
import { firebaseAdmin } from '@aglyn/tenant-data-admin/server/firebase-admin'
import { scopedToHost } from '@aglyn/tenant-data-admin/server/organizations'
import { datasetIndexedRecord } from '../model/dataset-record'
import {
  DATASET_RECORD_PAGES_COLLECTION,
  type DatasetRecordPageBinding,
  RECORD_PAGES_MAX_PER_SITE,
  parseRecordPageBinding,
} from '../record-pages/record-pages'

/**
 * The data plugin's `dataset` index (AGL-3080): the workspace's datasets, as
 * another surface reads them — an AI job drafting an automation that names a
 * dataset, a planner listing what a site already has — without knowing where
 * they are stored or what a deleted one looks like.
 *
 * Datasets belong to the ORGANIZATION (`orgId` required; a scope with none
 * answers nothing). Narrowed to a site (`hostId`), only the datasets shared
 * with it are answered — the site Data page's rule. A deleted dataset is left
 * out of every answer.
 *
 * Each record is `datasetIndexedRecord`'s (`model/dataset-record.ts`): the
 * name, the fields and the scope tokens, never a record of the dataset.
 *
 * Narrowed to a site, each also says where its records have pages of their
 * own on THAT site (AGL-3747), as `facts.recordPage`: the template screen,
 * the base and the address field of the site's record template for it
 * (AGL-3475), `null` where the site keeps none. A planner reads it to link a list's cards to
 * record pages made before its plan; one small read of the site's record
 * templates, bounded by `RECORD_PAGES_MAX_PER_SITE`, per answer.
 */

function datasets(orgId: string) {
  return firebaseAdmin.app().firestore().collection('orgs').doc(orgId).collection('datasets')
}

/** What `facts.recordPage` says of one dataset's record pages on a site. */
export interface DatasetIndexedRecordPage {
  screenId: string
  base: string
  slugField: string
}

/**
 * The site's record templates by the dataset they render, the first in the
 * site's order where a dataset has more than one.
 */
async function siteRecordPages(hostId: string): Promise<Map<string, DatasetIndexedRecordPage>> {
  const snapshot = await firebaseAdmin
    .app()
    .firestore()
    .collection('hosts')
    .doc(hostId)
    .collection(DATASET_RECORD_PAGES_COLLECTION)
    .limit(RECORD_PAGES_MAX_PER_SITE)
    .get()
  const pages = new Map<string, DatasetIndexedRecordPage>()
  for (const doc of snapshot.docs) {
    const binding: DatasetRecordPageBinding | null = parseRecordPageBinding(doc.id, doc.data())
    if (!binding || pages.has(binding.datasetId)) continue
    pages.set(binding.datasetId, { screenId: binding.screenId, base: binding.base, slugField: binding.slugField })
  }
  return pages
}

/** A record with its record page on the site, where one is kept. */
function withRecordPage(
  record: PluginIndexedRecord,
  pages: ReadonlyMap<string, DatasetIndexedRecordPage>,
): PluginIndexedRecord {
  return { ...record, facts: { ...record.facts, recordPage: pages.get(record.id) ?? null } }
}

export const datasetRecordIndex: PluginRecordIndex = {
  async list({ orgId, hostId, limit }) {
    if (!orgId || limit <= 0) return { records: [], truncated: false }
    const collection = datasets(orgId)
    const query = hostId ? scopedToHost(collection, hostId) : collection
    // One more than asked, so `truncated` is a fact rather than a guess;
    // deleted datasets are filtered after the read.
    const snapshot = await query.limit(limit + 1).get()
    const records = snapshot.docs
      .map((doc) => datasetIndexedRecord(doc.id, doc.data()))
      .filter((record): record is PluginIndexedRecord => record !== null)
      .slice(0, limit)
    if (!hostId || !records.length) return { records, truncated: snapshot.size > limit }
    const pages = await siteRecordPages(hostId)
    return { records: records.map((record) => withRecordPage(record, pages)), truncated: snapshot.size > limit }
  },
  async get({ orgId, hostId, id }) {
    if (!orgId || !id) return null
    const snapshot = await datasets(orgId).doc(id).get()
    const record = snapshot.exists ? datasetIndexedRecord(snapshot.id, snapshot.data()) : null
    if (!record || !hostId) return record
    if (!visibleToHost(record.facts['visibleTo'] as string[], hostId)) return null
    return withRecordPage(record, await siteRecordPages(hostId))
  },
}

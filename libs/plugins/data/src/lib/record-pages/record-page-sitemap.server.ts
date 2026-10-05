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
  SCREEN_KIND_TEMPLATE,
  isHostPluginEnabled,
  isScreenIndexable,
} from '@aglyn/aglyn/server'
import type {
  PluginSitemapChild,
  PluginSitemapListing,
  PluginSitemapReader,
  PluginSitemapUrl,
} from '@aglyn/aglyn/plugin-manager/plugin-sitemap-readers'
import { firebaseAdmin } from '@aglyn/tenant-data-admin'
import { FieldPath } from 'firebase-admin/firestore'
import { BUNDLE_ID } from '../constants/bundle-common'
import { humanizeDatasetFieldId } from '../model/dataset-models'
import {
  readSiteDataset,
  readSiteRecordPageBindings,
  type SiteDataset,
} from './record-page-read.server'
import {
  type DatasetRecordPageBinding,
  recordAddressOf,
  recordPagePath,
} from './record-pages'

/** The sitemap family record pages are listed in: `records-{key}`. */
export const RECORD_PAGES_SITEMAP_SECTION = 'records'

/**
 * A binding's child key: its base with each `/` as `--`, which a base segment
 * can never hold (`services/residential` → `services--residential`), so the
 * key names exactly one base.
 */
export function recordPagesSitemapKey(base: string): string {
  return base.replace(/\//g, '--')
}

/** A template whose record pages a crawler may be told about, with its dataset. */
interface ListedTemplate {
  binding: DatasetRecordPageBinding
  dataset: SiteDataset
}

/**
 * The site's record templates whose pages are public: the site runs Data, the
 * page is a published template whose visibility lets it be indexed, and the
 * dataset is still shared with the site. Exactly what the resolver serves,
 * minus the pages a search engine must not be handed.
 */
async function listedTemplates(hostId: string): Promise<ListedTemplate[]> {
  const bindings = await readSiteRecordPageBindings(hostId)
  if (!bindings.length) return []
  const firestore = firebaseAdmin.app().firestore()
  const hostRef = firestore.collection('hosts').doc(hostId)
  const host = (await hostRef.get()).data() as Record<string, any> | undefined
  const orgId = typeof host?.['orgId'] === 'string' ? host['orgId'] : ''
  const org = orgId
    ? ((await firestore.collection('orgs').doc(orgId).get()).data() as
        | Record<string, any>
        | undefined)
    : undefined
  if (!isHostPluginEnabled(org, host, BUNDLE_ID)) return []
  const listed = await Promise.all(
    bindings.map(async (binding): Promise<ListedTemplate | null> => {
      const screen = (
        await hostRef.collection('screens').doc(binding.screenId).get()
      ).data() as Record<string, any> | undefined
      if (
        !screen ||
        screen['deletedAt'] ||
        screen['kind'] !== SCREEN_KIND_TEMPLATE ||
        !screen['versionId'] ||
        !isScreenIndexable(screen as never)
      ) {
        return null
      }
      const dataset = await readSiteDataset(hostId, binding.datasetId)
      return dataset ? { binding, dataset } : null
    }),
  )
  return listed.filter((entry): entry is ListedTemplate => entry != null)
}

const recordCount = async (dataset: SiteDataset): Promise<number> =>
  (await dataset.ref.collection('records').count().get()).data().count

/**
 * Record pages in the sitemap (AGL-3475): one child per record template, sized
 * by its dataset's record count and paged by record id, so a page number names
 * the same records on every fetch. A record with no address has no page and
 * is left out of the file that would have held it.
 */
export const recordPagesSitemapReader: PluginSitemapReader = {
  async children({ hostId }): Promise<PluginSitemapChild[]> {
    const templates = await listedTemplates(hostId)
    return Promise.all(
      templates.map(async ({ binding, dataset }) => ({
        key: recordPagesSitemapKey(binding.base),
        urls: await recordCount(dataset),
      })),
    )
  },

  async urls({ hostId, key, page, perPage }): Promise<PluginSitemapUrl[]> {
    const template = (await listedTemplates(hostId)).find(
      ({ binding }) => recordPagesSitemapKey(binding.base) === key,
    )
    if (!template) return []
    const { binding, dataset } = template
    const rows = await dataset.ref
      .collection('records')
      .orderBy(FieldPath.documentId())
      .offset((Math.max(1, page) - 1) * perPage)
      .limit(perPage)
      .select(`values.${binding.slugField}`, 'updatedAt', 'createdAt')
      .get()
    const urls: PluginSitemapUrl[] = []
    for (const row of rows.docs) {
      const address = recordAddressOf(row.get('values'), binding.slugField)
      if (!address) continue
      urls.push({
        path: recordPagePath(binding.base, address),
        lastmod: row.get('updatedAt') ?? row.get('createdAt'),
      })
    }
    return urls
  },

  async listings({ hostId }): Promise<PluginSitemapListing[]> {
    const templates = await listedTemplates(hostId)
    return Promise.all(
      templates.map(async ({ binding, dataset }) => ({
        name:
          dataset.name ||
          humanizeDatasetFieldId(binding.base.split('/').pop() ?? binding.base),
        base: binding.base,
        count: await recordCount(dataset),
      })),
    )
  },
}

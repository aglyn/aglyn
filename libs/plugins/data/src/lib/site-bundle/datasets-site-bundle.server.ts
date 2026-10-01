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
  datasetIntegrityFields,
  effectiveDatasetModel,
  validateDocument,
} from '@aglyn/aglyn/app-utils/dataset-models'
import { checkDatasetQuota } from '@aglyn/aglyn/app-utils/plan-entitlements'
import { hostScopeToken, newResourceScopeFields } from '@aglyn/aglyn/app-utils/scope-tokens'
import type {
  SiteBundleImportRequest,
  SiteBundleItem,
  SiteBundleReportRow,
  SiteBundleRequest,
  SiteBundleRestoreRequest,
} from '@aglyn/aglyn/plugin-manager/plugin-site-bundle'
import { firebaseAdmin, scopedToHost } from '@aglyn/tenant-data-admin'

/**
 * A site's datasets in its whole-site backup (AGL-163), answered by the plugin
 * that keeps them (AGL-3080).
 *
 * Datasets are ORG-owned (AGL-237) and shared with sites by scope, so a site's
 * backup carries the datasets that site may see (AGL-1046) — each with its
 * records — and a restore writes them back into the owning organization,
 * scoped to the site it restores into.
 */

/** The records one dataset carries in a bundle, and the most a restore writes back. */
export const DATASET_BUNDLE_RECORD_LIMIT = 1000

/**
 * The keys a restore writes back on a dataset (AGL-1382): every key a live
 * dataset carries, because the restore writes with `merge: false` and a key
 * left off is ERASED. `visibleTo` is never on it — the restore assigns a fresh
 * scope for the site it restores into, since a bundle is portable and an
 * embedded `['org']` would publish one organization's data across another's
 * whole client roster.
 */
export const DATASET_RESTORE_FIELDS: readonly string[] = [
  'displayName',
  // Pre-AGL-536 human name, still read as a fallback by site search.
  'name',
  'fields',
  // The typed DatasetModel, and exactly what `effectiveDatasetModel` reads
  // below. Drop it and every restored dataset silently degrades to the
  // derived all-text v1 model, losing types, `required`, `validation`,
  // `default` and every `reference` link (AGL-180).
  'model',
  'names',
  'description',
  'source',
  'installedFrom',
  'detachedFrom',
]

/**
 * The keys a restore writes back on a record. `order` is what
 * `sortDatasetRecords` sorts by, so dropping it reorders every repeatable on
 * the restored site. The integrity index is DERIVED on the way in, never
 * carried (see {@link importSiteDatasets}).
 */
export const RECORD_RESTORE_FIELDS: readonly string[] = ['values', 'order']

/** One of a bundle's documents, reduced to the keys a restore may write. */
function restorable(fields: readonly string[], input: SiteBundleItem): Record<string, unknown> {
  const allowed = new Set(fields)
  const out: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(input ?? {})) {
    // Only `undefined` is absence — Firestore rejects it outright.
    if (allowed.has(key) && value !== undefined) out[key] = value
  }
  return out
}

/** The ids a bundle would write — distinct, since two items sharing one are one document. */
function bundleIds(items: readonly SiteBundleItem[]): Set<string> {
  const ids = new Set<string>()
  for (const item of items) if (item?.$id) ids.add(String(item.$id))
  return ids
}

const datasetsOf = (orgId: string) =>
  firebaseAdmin.app().firestore().collection('orgs').doc(orgId).collection('datasets')

/**
 * The site's share: the datasets the site may see, each with its records.
 *
 * A site with no organization genuinely has no datasets — a known-empty
 * answer. Everything else THROWS: a catch-all would ship a silently empty,
 * still-successful "backup" that nobody discovers until they restore it. An
 * export that fails loudly is recoverable; one that lies is not.
 *
 * `visibleTo` is stripped on the way out. Its `host:` tokens name sites of
 * THIS organization, so they are noise at best and a dangling reference once
 * the bundle is restored elsewhere; the restore assigns a fresh scope.
 */
export async function exportSiteDatasets({
  hostId,
  orgId,
  limit,
}: SiteBundleRequest): Promise<SiteBundleItem[]> {
  if (!orgId) return []
  const snapshot = await scopedToHost(datasetsOf(orgId), hostId).limit(limit).get()
  const live = snapshot.docs.filter((doc) => !doc.get('deletedAt'))
  return Promise.all(
    live.map(async (doc) => {
      const { visibleTo: _visibleTo, ...data } = doc.data()
      const records = await doc.ref.collection('records').limit(DATASET_BUNDLE_RECORD_LIMIT).get()
      return {
        $id: doc.id,
        ...data,
        records: records.docs.map((record) => ({ $id: record.id, ...record.data() })),
      }
    }),
  )
}

/**
 * Refuse a bundle that would put the workspace over the datasets it may hold
 * (AGL-1403) — decided before the restore writes anything.
 *
 * Datasets are SOLD: the plan includes some and the workspace buys more as
 * add-ons, so `checkDatasetQuota` decides, never the plan's included number —
 * a workspace that paid for extra datasets is entitled to them, and refusing
 * its own backup after taking its money for the room would be wrong.
 *
 * A restore is identified by id COLLISION, never by the bundle's own claim of
 * where it came from (an unsigned string in a file the metered party
 * uploads). The meter is per organization, so a collision here means the
 * WORKSPACE already holds the dataset: restoring into a sibling site of the
 * same workspace rewrites datasets it already pays for and raises nothing,
 * while a copy into a different workspace collides on nothing and is refused
 * when it lands that workspace over. What is refused is the RAISE, never the
 * state of being over — a workspace already over its limit may still restore
 * its own backup.
 */
export async function siteDatasetsRefusal({
  orgId,
  org,
  items,
}: SiteBundleRestoreRequest): Promise<string | null> {
  const bundled = bundleIds(items)
  if (!orgId || !bundled.size) return null
  if (!Number.isFinite(checkDatasetQuota(org as any, 0).limit)) return null

  // A field mask with no fields projects to the document id alone.
  const held = await datasetsOf(orgId).select().get()
  const existing = new Set(held.docs.map((doc) => doc.id))
  const next = new Set([...existing, ...bundled]).size
  // `allowed` asks "may I add one more to N", so the post state N is checked
  // as `N - 1` — the idiom the dataset routes' own bulk paths use.
  const quota = checkDatasetQuota(org as any, next - 1)
  if (next <= existing.size || quota.allowed) return null

  return (
    `This backup holds ${bundled.size} datasets and this workspace ` +
    `has ${existing.size}, which would put it at ${next} of ${quota.limit} ` +
    'datasets. Nothing was imported — ' +
    (quota.upgradeRequired
      ? 'upgrade in Billing.'
      : `add extra datasets for $${quota.addonPriceUsd}/mo each, or ` +
        'upgrade in Billing.')
  )
}

/**
 * Writes the bundle's datasets into the owning organization, scoped to the
 * site restored into (AGL-237, AGL-1046), each with its records.
 *
 * Non-conforming records are restored AND reported (AGL-182): data is never
 * silently dropped, and the report tells the owner what to fix. A bundle from
 * before typed models validates through the derived text model, as the live
 * migration does, so everything in it passes.
 */
export async function importSiteDatasets(
  request: SiteBundleImportRequest,
): Promise<SiteBundleReportRow[]> {
  const { hostId, orgId, items, write, stamps } = request
  if (!orgId) return []
  // Through the scoped-create gate (AGL-1478, AGL-1484): a restore CREATES
  // datasets, and a dataset is born scoped to the site it lands in.
  const scope = newResourceScopeFields([hostScopeToken(hostId)])
  const report: SiteBundleReportRow[] = []
  for (const item of items) {
    if (!item?.$id) continue
    const path = `orgs/${orgId}/datasets/${String(item.$id)}`
    await write(path, { ...restorable(DATASET_RESTORE_FIELDS, item), ...stamps(), ...scope })
    const model = effectiveDatasetModel(item)
    await ensureCustomFieldTypes(model, request)
    const records: SiteBundleItem[] = Array.isArray(item['records']) ? item['records'] : []
    for (const record of records.slice(0, DATASET_BUNDLE_RECORD_LIMIT)) {
      if (!record?.$id) continue
      const errors = validateDocument(model, record['values'] ?? {})
      if (Object.keys(errors).length) {
        report.push({ datasetId: String(item.$id), recordId: String(record.$id), errors })
      }
      await write(`${path}/records/${String(record.$id)}`, {
        ...restorable(RECORD_RESTORE_FIELDS, record),
        ...stamps(),
        // DERIVED here rather than carried in the bundle. The integrity
        // index the delete check queries must describe the values just
        // restored, and a bundle written before the field existed carries
        // none — accepting the bundle's copy would restore records the check
        // cannot reach. Records keep their original ids, so the ids it holds
        // still resolve.
        ...datasetIntegrityFields(model, record['values'] ?? {}),
      })
    }
  }
  return report
}

/**
 * Loads the plugins that register custom field types before a record is
 * validated against `model` (AGL-434). A type is registered when its plugin's
 * server surface loads, and `validateDocument` answers "no error" for a type
 * nobody registered — right for a plugin that is absent, wrong for one not yet
 * loaded. Only a model that names a custom type pays for the load.
 */
async function ensureCustomFieldTypes(
  model: ReturnType<typeof effectiveDatasetModel>,
  request: Pick<SiteBundleImportRequest, 'loadPluginSurfaces'>,
): Promise<void> {
  const usesCustomType = (model?.order ?? []).some((fieldId) =>
    Boolean(model?.fields?.[fieldId]?.customType),
  )
  if (usesCustomType) await request.loadPluginSurfaces()
}

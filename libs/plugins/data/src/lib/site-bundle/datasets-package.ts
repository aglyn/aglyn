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

import type {
  PluginSiteBundleSectionPackage,
  SiteBundleItem,
  SiteBundleItemReference,
} from '@aglyn/aglyn/plugin-manager/plugin-site-bundle'

/**
 * A site's datasets as site package items (AGL-3533).
 *
 * A dataset names other datasets through its model's `reference` fields —
 * the dataset a reference column points into. Those are the dependencies a
 * package lists, and the ids a dataset kept beside an existing one (or mapped
 * onto one the site already holds) has to move. Records keep their own ids
 * under whichever dataset they land in, so the record ids a reference cell
 * holds still resolve and nothing inside a record is rewritten.
 *
 * Pure and light: the declarations register these at boot, ahead of the
 * section's Admin-SDK half, which loads on first use.
 */

/** The package kind a dataset is listed as, as `plugins.config.json` declares it. */
export const DATASET_PACKAGE_KIND = 'dataset'

type ModelField = { type?: unknown; reference?: { datasetId?: unknown } & Record<string, unknown> }

function modelFields(item: SiteBundleItem): Record<string, ModelField> {
  const fields = (item?.['model'] as { fields?: unknown } | undefined)?.fields
  return fields && typeof fields === 'object' ? (fields as Record<string, ModelField>) : {}
}

/** The datasets this one's reference fields point into. */
export function datasetPackageDependencies(item: SiteBundleItem): SiteBundleItemReference[] {
  const seen = new Set<string>()
  for (const field of Object.values(modelFields(item))) {
    const target = field?.type === 'reference' ? field.reference?.datasetId : undefined
    if (typeof target === 'string' && target && target !== item['$id']) seen.add(target)
  }
  return [...seen].map((id) => ({ kind: DATASET_PACKAGE_KIND, id }))
}

/**
 * The dataset with each reference field moved to its target's new id. A
 * target whose reference is dropped turns the field into plain text, which
 * keeps every value it holds readable rather than pointing at nothing.
 */
export function remapDatasetPackageIds(
  item: SiteBundleItem,
  idMap: ReadonlyMap<string, string | null>,
): SiteBundleItem {
  const fields = modelFields(item)
  let changed = false
  const next: Record<string, ModelField> = {}
  for (const [fieldId, field] of Object.entries(fields)) {
    const target = field?.type === 'reference' ? field.reference?.datasetId : undefined
    const key = `${DATASET_PACKAGE_KIND}/${String(target)}`
    if (typeof target !== 'string' || !idMap.has(key)) {
      next[fieldId] = field
      continue
    }
    changed = true
    const moved = idMap.get(key)
    if (moved) {
      next[fieldId] = { ...field, reference: { ...field.reference, datasetId: moved } }
    } else {
      const { reference: _dropped, ...rest } = field
      next[fieldId] = { ...rest, type: 'text' }
    }
  }
  if (!changed) return item
  return { ...item, model: { ...(item['model'] as object), fields: next } }
}

/** The section's package hooks, as the declarations register them. */
export const datasetsSitePackage: PluginSiteBundleSectionPackage = {
  dependencies: datasetPackageDependencies,
  remapIds: remapDatasetPackageIds,
}

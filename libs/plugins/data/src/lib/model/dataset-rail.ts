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

import { nameSearchKey } from '@aglyn/aglyn/app-utils/name-search'
import { describeSharing } from '@aglyn/aglyn/app-utils/scope-tokens'
import { type DatasetModel, datasetPickerLabels, effectiveDatasetModel, formatDatasetValue } from './dataset-models'
import { datasetDisplayName, type HostDataset } from './datasets'

/**
 * The Data page's rail of datasets (AGL-4047): one tab per dataset, a second
 * line that tells same-named ones apart, a search over the names, and groups
 * by sharing once there are many. Pure, so the card and its specs read the
 * same answers.
 */

/** A dataset as the rail reads it: its document, with the facts it shows. */
export type DatasetRailEntry = HostDataset & {
  $id: string
  name?: unknown
  source?: { listingId?: unknown; version?: unknown } | null
  createdAt?: unknown
  scopeMode?: unknown
  scopeExcept?: unknown
}

/** Past this many datasets the rail groups them by who they are shared with, and offers the Shared with filter. */
export const DATASET_RAIL_GROUP_AT = 10

/** How many field names the second line names, in a grouped rail. */
const RAIL_FIELD_NAMES = 3

/** `1 field`, `5 fields`. */
export function datasetFieldCount(dataset: DatasetRailEntry): string {
  const count = effectiveDatasetModel(dataset).order.length
  return `${count} ${count === 1 ? 'field' : 'fields'}`
}

/** Who a dataset is shared with, named where `hostNames` has the site: `Bakery only`, `All sites`, `3 sites`. */
export function datasetSharingLabel(
  dataset: DatasetRailEntry,
  hostNames: Readonly<Record<string, string>>,
): string {
  return describeSharing(dataset as unknown as Readonly<Record<string, unknown>>, hostNames)
}

/**
 * The tab's second line. Ungrouped it says who the dataset is shared with and
 * how many fields it has, which is what tells the same name on two sites
 * apart: `Bakery only · 5 fields`. In a group, whose heading already says who
 * it is shared with, it names the first fields instead:
 * `5 fields · Name, Description, Duration`.
 */
export function datasetRailSecondary(
  dataset: DatasetRailEntry,
  options: { hostNames: Readonly<Record<string, string>>; grouped: boolean },
): string {
  const fields = datasetFieldCount(dataset)
  if (!options.grouped) return `${datasetSharingLabel(dataset, options.hostNames)} · ${fields}`
  const model = effectiveDatasetModel(dataset)
  const names = model.order
    .slice(0, RAIL_FIELD_NAMES)
    .map((id) => model.fields[id]?.name ?? id)
    .filter(Boolean)
  return names.length ? `${fields} · ${names.join(', ')}` : fields
}

/** A dataset's name for the rail and the page: its display name, or a stand-in when it has none. */
export function datasetRailName(dataset: DatasetRailEntry): string {
  return datasetDisplayName(dataset) || 'Untitled dataset'
}

/** Datasets in name order, then id, so two of one name keep their places. */
export function sortDatasetsByName<T extends DatasetRailEntry>(datasets: readonly T[]): T[] {
  return [...datasets].sort(
    (a, b) =>
      nameSearchKey(datasetRailName(a)).localeCompare(nameSearchKey(datasetRailName(b))) ||
      a.$id.localeCompare(b.$id),
  )
}

/**
 * Whether a dataset's name starts with what was typed, normalized the way the
 * stored `nameLower` is, so the loaded-list search and the query that replaces
 * it answer alike.
 */
export function datasetNameMatches(dataset: DatasetRailEntry, typed: string): boolean {
  const key = nameSearchKey(typed)
  return !key || nameSearchKey(datasetDisplayName(dataset)).startsWith(key)
}

/** One group of the rail: its heading, with how many it holds, and its datasets in name order. */
export interface DatasetRailGroup {
  label: string
  datasets: DatasetRailEntry[]
}

/**
 * The rail's groups by who each dataset is shared with: `Bakery only (6)`.
 * Groups run in heading order, datasets in name order within each.
 */
export function groupDatasetsBySharing(
  datasets: readonly DatasetRailEntry[],
  hostNames: Readonly<Record<string, string>>,
): DatasetRailGroup[] {
  const groups = new Map<string, DatasetRailEntry[]>()
  for (const dataset of datasets) {
    const label = datasetSharingLabel(dataset, hostNames)
    groups.set(label, [...(groups.get(label) ?? []), dataset])
  }
  return [...groups.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([label, members]) => ({ label: `${label} (${members.length})`, datasets: sortDatasetsByName(members) }))
}

/** Where a dataset came from: the marketplace listing it was installed from, or `--` for one made here. */
export function datasetSourceLabel(dataset: DatasetRailEntry): string {
  if (!dataset.source?.listingId) return '--'
  const version = Number(dataset.source.version)
  return Number.isFinite(version) && version > 0 ? `Marketplace, version ${version}` : 'Marketplace'
}

/** When a dataset was created, as a date, or `--` where it was never stamped (a site backup restore stamps none). */
export function datasetCreatedLabel(dataset: DatasetRailEntry, locale?: string): string {
  const at = dataset.createdAt as { toDate?: () => Date; seconds?: number } | null | undefined
  const date =
    typeof at?.toDate === 'function'
      ? at.toDate()
      : typeof at?.seconds === 'number'
        ? new Date(at.seconds * 1000)
        : null
  if (!date || Number.isNaN(date.getTime())) return '--'
  return date.toLocaleDateString(locale, { month: 'short', day: 'numeric', year: 'numeric' })
}

/**
 * A record's own page's heading (AGL-4047): the first field, in the model's
 * order, that shows a value — a reference names an id, so it is passed over —
 * or a stand-in when none does.
 */
export function datasetRecordTitle(model: DatasetModel, values: Readonly<Record<string, unknown>> | undefined): string {
  for (const fieldId of model.order) {
    const field = model.fields[fieldId]
    if (!field || field.type === 'reference') continue
    const shown = formatDatasetValue(field, values?.[fieldId]).trim()
    if (shown) return shown
  }
  return 'Untitled record'
}

/**
 * The picker labels for a list of datasets (AGL-4047), through the pure
 * `datasetPickerLabels`: the name alone unless it collides in the list.
 */
export function datasetPickerLabelsOf(
  datasets: readonly DatasetRailEntry[],
  hostNames: Readonly<Record<string, string>> = {},
): Record<string, string> {
  return datasetPickerLabels(
    datasets.map((dataset) => ({
      id: dataset.$id,
      name: datasetRailName(dataset),
      sharing: datasetSharingLabel(dataset, hostNames),
      fields: effectiveDatasetModel(dataset).order.length,
    })),
  )
}

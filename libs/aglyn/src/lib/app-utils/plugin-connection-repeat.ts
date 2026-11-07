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
  REPEAT_CONNECTION_KEY_PREFIX,
  type RepeatableDataset,
} from './expand-repeatables'
import type { PluginConnectionSiteRecord } from './plugin-connection-records'
import {
  PLUGIN_CONNECTION_ID_PATTERN,
  type PluginConnectionDeclaration,
  type PluginConnectionFieldType,
} from './plugin-connections'

/*
 * REPEATING AN ELEMENT OVER A PLUGIN CONNECTION'S RECORD (AGL-4212).
 *
 * A marketplace plugin that declares a connection gets, per site, the small
 * public record its sync last wrote (`plugin-connection-records.ts`): summary
 * `fields` and a list of `items`. Any element can repeat over that record the
 * way it repeats over a dataset, so an author builds the display from
 * ordinary elements instead of styling one closed block. The node names it
 * under `repeatConnection` (`expand-repeatables.ts`):
 *
 *   - `<pluginIdentity>/<connectionId>` — one row per item;
 *   - `<pluginIdentity>/<connectionId>/fields` — ONE row of the summary
 *     fields, or none before the first sync.
 *
 * `pluginIdentity` is the namespace a bundle publishes under
 * (`<publisher handle>.<manifest id>`), the one name a preset can know.
 *
 * Everything here is pure, and it is the ONE place a record becomes rows: the
 * marketplace's server reader answers the published page with it, and its
 * editor source draws the canvas with it, so the two cannot disagree about a
 * date or a missing field. Reached by path: a published page's own download
 * never asks how rows are made.
 */

/** Which part of a record a repeat reads: its list, or its summary fields. */
export type PluginConnectionRepeatPart = 'items' | 'fields'

/** What a `repeatConnection` value names. */
export interface PluginConnectionRepeatTarget {
  /** `<publisher handle>.<manifest id>`, as the plugin's bundle knows itself. */
  identity: string
  connectionId: string
  part: PluginConnectionRepeatPart
}

/** The last segment that turns a value into the summary row. */
export const PLUGIN_CONNECTION_REPEAT_FIELDS_SEGMENT = 'fields'

/** A publisher handle and a manifest id, dot-joined: no slash, no space. */
const IDENTITY_PATTERN = /^[A-Za-z0-9][\w-]*(?:\.[A-Za-z0-9][\w-]*)+$/

/**
 * The target a `repeatConnection` value (or the `connection:` key
 * `repeatKey` makes of it) names, or `null` when it names none.
 */
export function parsePluginConnectionRepeat(
  value: unknown,
): PluginConnectionRepeatTarget | null {
  if (typeof value !== 'string') return null
  let text = value.trim()
  if (text.startsWith(REPEAT_CONNECTION_KEY_PREFIX)) {
    text = text.slice(REPEAT_CONNECTION_KEY_PREFIX.length).trim()
  }
  const [identity, connectionId, part, ...rest] = text.split('/')
  if (rest.length || !identity || !connectionId) return null
  if (!IDENTITY_PATTERN.test(identity)) return null
  if (!PLUGIN_CONNECTION_ID_PATTERN.test(connectionId)) return null
  if (part !== undefined && part !== PLUGIN_CONNECTION_REPEAT_FIELDS_SEGMENT) {
    return null
  }
  return { identity, connectionId, part: part ? 'fields' : 'items' }
}

/** The `repeatConnection` value that names `target`. */
export function pluginConnectionRepeatValue(
  target: PluginConnectionRepeatTarget,
): string {
  const base = `${target.identity}/${target.connectionId}`
  return target.part === 'fields'
    ? `${base}/${PLUGIN_CONNECTION_REPEAT_FIELDS_SEGMENT}`
    : base
}

/** The declared type of each field of a connection's record. */
export interface PluginConnectionFieldTypes {
  /** The summary fields (`sync.record.fields`). */
  fields: Readonly<Record<string, PluginConnectionFieldType>>
  /** Each item's fields (`sync.record.items.fields`). */
  items: Readonly<Record<string, PluginConnectionFieldType>>
}

/** The field types a connection's declaration gives its record. */
export function pluginConnectionFieldTypes(
  connection: Pick<PluginConnectionDeclaration, 'sync'> | null | undefined,
): PluginConnectionFieldTypes {
  const record = connection?.sync?.record
  const typesOf = (
    declared: Readonly<Record<string, { type: PluginConnectionFieldType }>> | undefined,
  ) => {
    const out: Record<string, PluginConnectionFieldType> = {}
    for (const [field, declaration] of Object.entries(declared ?? {})) {
      out[field] = declaration.type
    }
    return out
  }
  return {
    fields: typesOf(record?.fields),
    items: typesOf(record?.items?.fields),
  }
}

/** What a `datetime` field's readable sibling is suffixed with. */
export const PLUGIN_CONNECTION_ISO_SUFFIX = 'Iso'

const MONTHS = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
] as const

/**
 * A stored `datetime` (epoch ms) as a reader reads it, `Nov 3, 2026`, and as
 * ISO, or `null` for a value that is no instant.
 *
 * The same words `toLocaleDateString('en-US', { month: 'short', day:
 * 'numeric', year: 'numeric', timeZone: 'UTC' })` prints, spelled out here
 * so the server and the editor's browser cannot print them differently.
 */
export function pluginConnectionDate(
  value: unknown,
): { text: string; iso: string } | null {
  const ms =
    typeof value === 'number'
      ? value
      : typeof value === 'string' && value.trim()
        ? Date.parse(value)
        : Number.NaN
  if (!Number.isFinite(ms)) return null
  const date = new Date(ms)
  if (Number.isNaN(date.getTime())) return null
  return {
    text: `${MONTHS[date.getUTCMonth()]} ${date.getUTCDate()}, ${date.getUTCFullYear()}`,
    iso: date.toISOString(),
  }
}

/**
 * One row's values: each declared field the record holds, as it is held —
 * numbers stay numbers, yes/no stays yes/no — except a `datetime`, which
 * becomes its readable date with `<field>Iso` beside it. A field the record
 * leaves empty is absent, so its token prints nothing and an element bound to
 * it alone is left out of that copy.
 */
export function pluginConnectionRepeatRow(
  values: Readonly<Record<string, unknown>> | null | undefined,
  types: Readonly<Record<string, PluginConnectionFieldType>>,
): Record<string, unknown> {
  const row: Record<string, unknown> = {}
  if (!values) return row
  for (const [field, type] of Object.entries(types)) {
    const value = values[field]
    if (value === null || value === undefined || value === '') continue
    if (type === 'datetime') {
      const date = pluginConnectionDate(value)
      if (!date) continue
      row[field] = date.text
      const iso = `${field}${PLUGIN_CONNECTION_ISO_SUFFIX}`
      // A field the plugin declared under that name is its own.
      if (!(iso in types)) row[iso] = date.iso
      continue
    }
    if (typeof value === 'number' && !Number.isFinite(value)) continue
    if (typeof value === 'object') continue
    row[field] = value
  }
  return row
}

/**
 * The rows a repeat over `part` of `record` renders, in the record's order.
 *
 * - `items` — one row per item, each with `$id` its position, which is all
 *   the expansion's copy ids need (the list is rewritten whole by each sync).
 * - `fields` — exactly one row, `$id` `fields`; NONE when the site has no
 *   record yet, so a summary block draws nothing before the first sync.
 */
export function pluginConnectionRepeatRows(
  record: Pick<PluginConnectionSiteRecord, 'fields' | 'items'> | null | undefined,
  types: PluginConnectionFieldTypes,
  part: PluginConnectionRepeatPart,
): RepeatableDataset {
  if (!record) return { records: [] }
  if (part === 'fields') {
    return {
      records: [
        {
          ...pluginConnectionRepeatRow(record.fields, types.fields),
          $id: PLUGIN_CONNECTION_REPEAT_FIELDS_SEGMENT,
        },
      ],
    }
  }
  const items = Array.isArray(record.items) ? record.items : []
  return {
    records: items.map((item, index) => ({
      ...pluginConnectionRepeatRow(item, types.items),
      $id: String(index),
    })),
  }
}

/**
 * Every `{{item.<field>}}` a repeat over `part` can name, in declared order,
 * each `datetime` followed by its `Iso` sibling.
 */
export function pluginConnectionRepeatFieldNames(
  types: PluginConnectionFieldTypes,
  part: PluginConnectionRepeatPart,
): string[] {
  const declared = part === 'fields' ? types.fields : types.items
  const names: string[] = []
  for (const [field, type] of Object.entries(declared)) {
    names.push(field)
    const iso = `${field}${PLUGIN_CONNECTION_ISO_SUFFIX}`
    if (type === 'datetime' && !(iso in declared)) names.push(iso)
  }
  return names
}

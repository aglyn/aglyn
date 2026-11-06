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
  readPluginConnectionPath,
  type PluginConnectionRecordField,
  type PluginConnectionSync,
} from '@aglyn/aglyn/app-utils/plugin-connections'
import type { PluginConnectionRecordDoc, PluginConnectionRecordValue } from '../../model/plugin-connections'

/**
 * HOW A SYNC'S ANSWERS BECOME A SITE'S RECORD (AGL-4194).
 *
 * The provider's answers are untrusted JSON. The record a page renders from
 * is built field by field from the manifest's `sync.record`, so it can only
 * ever hold what was declared, typed as declared and no longer than declared:
 *
 *   - a key the schema does not name is never read, so nothing undeclared
 *     can be copied across, whatever the provider adds to its answer;
 *   - a `map` is a whitelist: a value it does not list is dropped, never
 *     passed through raw;
 *   - a `string` is cut to its `maxLength`; a `url` must be `https` with no
 *     credentials and fit its `maxLength` whole (a cut URL points somewhere
 *     else, so a long one is dropped rather than cut);
 *   - a `datetime` becomes epoch ms; a `number` must be finite;
 *   - a declared field with no usable value is `null`, so every entry has the
 *     same keys and an element can tell "missing" from "zero";
 *   - `items` stops at its `maxItems`, and the whole record stops at
 *     {@link PLUGIN_CONNECTION_RECORD_MAX_BYTES}, dropping trailing items, so
 *     it always fits in one Firestore document with room to spare.
 *
 * Pure: no Firestore, no fetch.
 */

/** The serialized record is kept under this, well inside Firestore's 1 MiB document limit. */
export const PLUGIN_CONNECTION_RECORD_MAX_BYTES = 512 * 1024

/** What one declared sync request answered: its first page (summary fields) and its items across pages. */
export interface PluginConnectionSyncAnswer {
  pages: unknown[]
  items: unknown[]
}

/** Dates outside these bounds are not dates a provider meant (year 1970 to 2200). */
const MIN_DATETIME_MS = 0
const MAX_DATETIME_MS = Date.UTC(2200, 0, 1)

function coerceUrl(value: unknown, maxLength: number): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  if (!trimmed || trimmed.length > maxLength) return null
  let parsed: URL
  try {
    parsed = new URL(trimmed)
  } catch {
    return null
  }
  if (parsed.protocol !== 'https:' || parsed.username || parsed.password) return null
  return trimmed
}

function coerceDatetime(value: unknown): number | null {
  let ms: number
  if (typeof value === 'number') ms = value
  else if (typeof value === 'string' && value.trim()) ms = Date.parse(value.trim())
  else return null
  if (!Number.isFinite(ms) || ms < MIN_DATETIME_MS || ms > MAX_DATETIME_MS) return null
  return Math.trunc(ms)
}

/** One declared field's value out of `source`, or `null` when there is no usable one. */
export function mapPluginConnectionField(
  field: PluginConnectionRecordField,
  source: unknown,
): PluginConnectionRecordValue {
  let value: unknown = readPluginConnectionPath(source, field.path)
  if (value === undefined || value === null) return null
  if (field.map) {
    if (typeof value !== 'string' && typeof value !== 'number' && typeof value !== 'boolean') return null
    const key = String(value)
    if (!Object.prototype.hasOwnProperty.call(field.map, key)) return null
    value = field.map[key]
  }
  switch (field.type) {
    case 'string': {
      if (typeof value !== 'string' && typeof value !== 'number' && typeof value !== 'boolean') return null
      const text = String(value)
      return text.slice(0, field.maxLength ?? 0)
    }
    case 'number': {
      const number = typeof value === 'number' ? value : typeof value === 'string' && value.trim() ? Number(value) : NaN
      return Number.isFinite(number) ? number : null
    }
    case 'boolean':
      if (typeof value === 'boolean') return value
      if (value === 'true') return true
      if (value === 'false') return false
      return null
    case 'datetime':
      return coerceDatetime(value)
    case 'url':
      return coerceUrl(value, field.maxLength ?? 0)
    default:
      return null
  }
}

function mapFields(
  fields: Readonly<Record<string, PluginConnectionRecordField>>,
  source: unknown,
): Record<string, PluginConnectionRecordValue> {
  const out: Record<string, PluginConnectionRecordValue> = {}
  for (const [name, field] of Object.entries(fields)) out[name] = mapPluginConnectionField(field, source)
  return out
}

const byteLength = (value: unknown) => Buffer.byteLength(JSON.stringify(value), 'utf8')

/**
 * The record for one sync: the summary `fields` from each named request's
 * first page, the `items` from the items request, capped to `maxItems` and to
 * {@link PLUGIN_CONNECTION_RECORD_MAX_BYTES}.
 */
export function mapPluginConnectionRecord(
  sync: Pick<PluginConnectionSync, 'record'>,
  answers: Readonly<Record<string, PluginConnectionSyncAnswer>>,
  meta: { listingId: string; connectionId: string; version: string; syncedAtMs: number },
): PluginConnectionRecordDoc {
  const summary = sync.record.fields ?? {}
  const fields: Record<string, PluginConnectionRecordValue> = {}
  for (const [name, field] of Object.entries(summary)) {
    fields[name] = mapPluginConnectionField(field, answers[field.request]?.pages[0])
  }
  const items: Array<Record<string, PluginConnectionRecordValue>> = []
  const declared = sync.record.items
  if (declared) {
    const source = answers[declared.request]?.items ?? []
    for (const item of source.slice(0, declared.maxItems)) {
      items.push(mapFields(declared.fields, item))
    }
  }
  const record: PluginConnectionRecordDoc = { kind: 'record', ...meta, fields, items }
  // The byte ceiling: drop trailing items until the whole record fits.
  while (record.items.length && byteLength(record) > PLUGIN_CONNECTION_RECORD_MAX_BYTES) {
    const over = byteLength(record) - PLUGIN_CONNECTION_RECORD_MAX_BYTES
    const last = byteLength(record.items[record.items.length - 1])
    const drop = Math.min(record.items.length, Math.max(1, Math.ceil(over / Math.max(1, last))))
    record.items.splice(record.items.length - drop)
  }
  return record
}

/** The sync requests the record actually reads, in declared order: an unread one is never sent. */
export function pluginConnectionSyncRequestsRead(sync: PluginConnectionSync): PluginConnectionSync['requests'] {
  const read = new Set<string>()
  for (const field of Object.values(sync.record.fields ?? {})) read.add(field.request)
  if (sync.record.items) read.add(sync.record.items.request)
  return sync.requests.filter((request) => read.has(request.id))
}

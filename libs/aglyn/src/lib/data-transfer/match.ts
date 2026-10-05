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

/*==========================================
 * RECORD MATCHING — which existing record each row of a file is about.
 *
 * The person picks match keys in priority order (the Aglyn id, an external
 * id, an email, a domain, a name…). Each key is a field and a normalizer,
 * so `Jane@Example.com ` and `jane@example.com` are one key and
 * `https://www.example.com/about` and `bob@example.com` share a domain.
 *
 * Matching is pure: the caller asks storage for the records holding the
 * requested key values ({@link matchLookupRequests}), hands the answer back
 * as a {@link MatchLookup}, and gets one outcome per row:
 *
 *  - `new` — no key found a record;
 *  - `matched` — the first key that found anything found exactly one;
 *  - `ambiguous` — it found several, and the person must choose;
 *  - `duplicateInFile` — an earlier row carries the same key value, so
 *    both rows are about one record and the later one is held back.
 *=========================================*/

import { normalizePhone } from '../foundation/definitions/contact.types'
import { foldText } from './similarity'

/** How a key's values are made comparable. */
export type MatchNormalizer =
  | 'exact'
  | 'trim'
  | 'caseless'
  | 'email'
  | 'domain'
  | 'name'
  | 'slug'
  | 'phone'
  | 'externalId'
  | 'aglynId'
  | 'instant'

/** One part of a compound match key: another field, and how its values compare. */
export interface MatchKeyPart {
  fieldId: string
  normalizer: MatchNormalizer
}

/**
 * One match key: a field, and how its values compare. With `with`, a
 * compound key: a row carries it only when every part has a value, and a row
 * and a record share it only when every part agrees — an event's title AND
 * its start, so a weekly class is not one event. A compound key is named by
 * its first field everywhere a key is named.
 */
export interface MatchKeySpec {
  fieldId: string
  normalizer: MatchNormalizer
  with?: readonly MatchKeyPart[]
}

/** What joins the parts of a compound key's value: shown, and never inside a normalized part. */
export const MATCH_KEY_PART_SEPARATOR = ' \u241f '

/**
 * The domain of a web address or email address: lowercased, `www.` and
 * a trailing dot dropped, port and path ignored. `null` when there is none.
 */
export function domainOf(value: unknown): string | null {
  let text = String(value ?? '').trim().toLowerCase()
  if (!text) return null
  const at = text.lastIndexOf('@')
  if (at >= 0 && !text.includes('://')) text = text.slice(at + 1)
  text = text.replace(/^[a-z][a-z0-9+.-]*:\/\//, '').replace(/^[^@/]*@/, '')
  text = (text.split(/[/?#]/)[0] ?? '').replace(/:\d+$/, '').replace(/\.$/, '').replace(/^www\./, '')
  return /^(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z0-9-]{2,}$/.test(text) ? text : null
}

/** A name folded: accents, case, punctuation and spacing do not make a new name. */
export function foldName(value: unknown): string {
  return foldText(value)
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
}

/** A slug folded: lowercase words joined by `-`. */
export function foldSlug(value: unknown): string {
  return foldText(value)
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

/** A value under a normalizer, or `null` when it has no key (blank, unreadable). */
export function normalizeMatchValue(normalizer: MatchNormalizer, value: unknown): string | null {
  if (value === null || value === undefined) return null
  const text = String(value)
  let key: string | null
  switch (normalizer) {
    case 'exact':
      key = text
      break
    case 'trim':
    case 'externalId':
    case 'aglynId':
      key = text.trim()
      break
    case 'caseless':
      key = text.trim().toLowerCase()
      break
    case 'email': {
      const lower = text.trim().toLowerCase()
      key = /^[^\s@]+@[^\s@]+$/.test(lower) ? lower : null
      break
    }
    case 'domain':
      key = domainOf(text)
      break
    case 'name':
      key = foldName(text)
      break
    case 'slug':
      key = foldSlug(text)
      break
    case 'phone':
      key = normalizePhone(text)
      break
    case 'instant':
      key = instantOf(value)
      break
  }
  return key ? key.replaceAll(MATCH_KEY_PART_SEPARATOR, ' ') : null
}

/**
 * A moment to the minute, in UTC (`2026-10-05T14:30Z`), from epoch
 * milliseconds, a `Date`, or any text `Date` reads; `null` when it is none.
 * The file's ISO text and the record's stored milliseconds meet here.
 */
function instantOf(value: unknown): string | null {
  const ms =
    typeof value === 'number'
      ? value
      : value instanceof Date
        ? value.getTime()
        : /^\d{11,}$/.test(String(value).trim())
          ? Number(String(value).trim())
          : Date.parse(String(value).trim())
  if (!Number.isFinite(ms)) return null
  return `${new Date(ms).toISOString().slice(0, 16)}Z`
}

/**
 * A row's (or a record's) value under a key — every part normalized and
 * joined for a compound key — or `null` when any part has none.
 */
export function matchKeyValue(key: MatchKeySpec, values: Readonly<Record<string, unknown>>): string | null {
  const first = normalizeMatchValue(key.normalizer, values[key.fieldId])
  if (!first || !key.with?.length) return first
  const parts = [first]
  for (const part of key.with) {
    const value = normalizeMatchValue(part.normalizer, values[part.fieldId])
    if (!value) return null
    parts.push(value)
  }
  return parts.join(MATCH_KEY_PART_SEPARATOR)
}

/** The key under which a lookup answer is filed. */
export function matchLookupKey(fieldId: string, normalized: string): string {
  return `${fieldId}\u0000${normalized}`
}

/** Field + normalized value → ids of the existing records holding it. */
export type MatchLookup = ReadonlyMap<string, readonly string[]>

/** What the caller must look up: per key, the distinct normalized values the rows carry. */
export interface MatchLookupRequest extends MatchKeySpec {
  values: string[]
}

/** The values each key must be looked up for, distinct, in first-seen order. */
export function matchLookupRequests(
  rows: readonly Readonly<Record<string, unknown>>[],
  keys: readonly MatchKeySpec[],
): MatchLookupRequest[] {
  return keys.map((key) => {
    const values = new Set<string>()
    for (const row of rows) {
      const normalized = matchKeyValue(key, row)
      if (normalized) values.add(normalized)
    }
    return { ...key, values: [...values] }
  })
}

/** Builds a {@link MatchLookup} from records: each record's values under every key. */
export function buildMatchLookup(
  records: Iterable<{ id: string; values: Readonly<Record<string, unknown>> }>,
  keys: readonly MatchKeySpec[],
): Map<string, string[]> {
  const lookup = new Map<string, string[]>()
  for (const record of records) {
    for (const key of keys) {
      const raw = key.normalizer === 'aglynId' && record.values[key.fieldId] === undefined ? record.id : record.values[key.fieldId]
      const values = Array.isArray(raw) ? raw : [raw]
      for (const value of values) {
        const normalized = matchKeyValue(key, { ...record.values, [key.fieldId]: value })
        if (!normalized) continue
        const at = matchLookupKey(key.fieldId, normalized)
        const ids = lookup.get(at) ?? []
        if (!ids.includes(record.id)) ids.push(record.id)
        lookup.set(at, ids)
      }
    }
  }
  return lookup
}

/** Which key found a row's record, and by what value. */
export interface MatchedVia {
  fieldId: string
  value: string
}

/** What a row is about. */
export type RowMatchOutcome =
  | { kind: 'new' }
  | {
      kind: 'matched'
      recordId: string
      via: MatchedVia
      /** Other records a lower-priority key pointed at — worth a warning. */
      alsoMatched?: string[]
    }
  | { kind: 'ambiguous'; recordIds: string[]; via: MatchedVia }
  | { kind: 'duplicateInFile'; firstRow: number; via: MatchedVia }

/**
 * One outcome per row (see the block header). A row is a duplicate when ANY
 * key value it carries was carried by an earlier row; otherwise the keys
 * are tried in order and the first that finds a record decides.
 */
export function matchRows(
  rows: readonly Readonly<Record<string, unknown>>[],
  keys: readonly MatchKeySpec[],
  lookup: MatchLookup,
): RowMatchOutcome[] {
  const firstRowOf = new Map<string, number>()
  return rows.map((row, index) => {
    const carried = keys
      .map((key) => ({ key, value: matchKeyValue(key, row) }))
      .filter((entry): entry is { key: MatchKeySpec; value: string } => Boolean(entry.value))

    const duplicateOf = carried
      .map((entry) => ({ entry, first: firstRowOf.get(matchLookupKey(entry.key.fieldId, entry.value)) }))
      .find((found) => found.first !== undefined)
    for (const entry of carried) {
      const at = matchLookupKey(entry.key.fieldId, entry.value)
      if (!firstRowOf.has(at)) firstRowOf.set(at, index)
    }
    if (duplicateOf) {
      return {
        kind: 'duplicateInFile',
        firstRow: duplicateOf.first as number,
        via: { fieldId: duplicateOf.entry.key.fieldId, value: duplicateOf.entry.value },
      }
    }

    for (let at = 0; at < carried.length; at += 1) {
      const { key, value } = carried[at] as { key: MatchKeySpec; value: string }
      const ids = lookup.get(matchLookupKey(key.fieldId, value)) ?? []
      if (!ids.length) continue
      const via = { fieldId: key.fieldId, value }
      if (ids.length > 1) return { kind: 'ambiguous', recordIds: [...ids], via }
      const recordId = ids[0] as string
      const others = new Set<string>()
      for (const later of carried.slice(at + 1)) {
        for (const id of lookup.get(matchLookupKey(later.key.fieldId, later.value)) ?? []) {
          if (id !== recordId) others.add(id)
        }
      }
      return others.size
        ? { kind: 'matched', recordId, via, alsoMatched: [...others] }
        : { kind: 'matched', recordId, via }
    }
    return { kind: 'new' }
  })
}

/** How many rows had each outcome. */
export function summarizeMatches(outcomes: readonly RowMatchOutcome[]): Record<RowMatchOutcome['kind'], number> {
  const summary = { new: 0, matched: 0, ambiguous: 0, duplicateInFile: 0 }
  for (const outcome of outcomes) summary[outcome.kind] += 1
  return summary
}

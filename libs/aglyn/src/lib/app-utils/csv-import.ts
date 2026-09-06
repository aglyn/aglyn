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

/**
 * READING A SPREADSHEET INTO A CRM COLLECTION — the part that does not care
 * which collection (AGL-2621).
 *
 * The contact import (AGL-2602) settled how a file becomes records: a
 * header row is matched against an alias table to PROPOSE a column → field
 * mapping, the operator corrects it, one line is mapped to a raw row of
 * verbatim strings, and the server judges each row and tallies what it did.
 * A companies file goes through the same three stages with a different
 * field list, so the stages live here, parametric over the field union, and
 * `crm-import.ts` and `crm-company-import.ts` each supply their vocabulary
 * — the fields, their aliases, their labels — and nothing else.
 *
 * ## A custom target is `custom:<key>`
 *
 * A column may also map to a custom field the merchant defined, which has
 * no standard name. The target is one string rather than a discriminated
 * object because it is the VALUE of a select control and travels through a
 * form; the prefix is what tells the two apart on the way back.
 *
 * ## The ceilings are shared numbers
 *
 * One file, one request and one preview are bounded the same way for every
 * collection, because the bounds are about the browser's memory and a
 * console request's budget, not about what the rows hold.
 */

/**
 * The most rows one uploaded file may carry.
 *
 * A bound on the work one import represents and on the memory the browser
 * holds while mapping it — five thousand rows of a wide export is already
 * several megabytes of cells in a tab. A larger list is split and imported
 * in pieces; the drawer says so on the file, before a single row is sent.
 */
export const CSV_IMPORT_MAX_ROWS = 5_000

/**
 * Rows per request.
 *
 * Each row costs the server a lookup and a write, plus whatever a name it
 * has not seen in this request costs to resolve; two hundred of those sit
 * comfortably inside a console request's budget and give the progress bar
 * twenty-five steps on the largest file the drawer accepts.
 */
export const CSV_IMPORT_CHUNK_SIZE = 200

/**
 * The most bytes one request may carry, checked before the body is judged.
 *
 * Two hundred rows of a wide export with long values is well under a
 * megabyte; two megabytes is the line past which a request is not a chunk
 * of a file but something else being pushed through this door.
 */
export const CSV_IMPORT_MAX_BODY_BYTES = 2_000_000

/** How many mapped rows the drawer shows before the operator commits. */
export const CSV_IMPORT_PREVIEW_ROWS = 10

/** The prefix a custom-field target id carries. */
const CUSTOM_TARGET_PREFIX = 'custom:'

/** The custom-field target id for a definition key. */
export function customImportTarget(key: string): `custom:${string}` {
  return `${CUSTOM_TARGET_PREFIX}${key}`
}

/** The definition key a custom target names, or `null` for a standard field. */
export function customImportTargetKey(target: string): string | null {
  return target.startsWith(CUSTOM_TARGET_PREFIX)
    ? target.slice(CUSTOM_TARGET_PREFIX.length)
    : null
}

/**
 * Normalizes a header cell for alias matching.
 *
 * Underscores, dots and hyphens all become one space, so `e-mail`,
 * `email_address` and `Email Address` compare as the words they are. The
 * alias tables are written in the human spelling and pass through the same
 * function, so a table stays readable and the comparison stays exact.
 */
export function importHeaderKey(value: unknown): string {
  return String(value ?? '')
    .trim()
    .toLowerCase()
    .replace(/[_.\-/]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

/** An alias table, normalized once through {@link importHeaderKey}. */
export function importAliasKeys<F extends string>(
  fields: readonly F[],
  aliases: Record<F, readonly string[]>,
): Record<F, ReadonlySet<string>> {
  const keys = {} as Record<F, ReadonlySet<string>>
  for (const field of fields) {
    keys[field] = new Set(aliases[field].map(importHeaderKey))
  }
  return keys
}

/**
 * A proposed mapping from a file's header row.
 *
 * Custom fields win over standard aliases when a header matches a
 * definition's label or key exactly — a merchant who defined a field called
 * "Status" meant THEIR status, not our lifecycle stage. Each target is
 * taken at most once, by the first column that claims it, so a file with two
 * columns named "Email" maps the first and leaves the second for the
 * operator to decide.
 */
export function guessImportMapping<F extends string>(
  columns: readonly string[],
  fields: readonly F[],
  aliasKeys: Record<F, ReadonlySet<string>>,
): Record<number, F>
export function guessImportMapping<F extends string>(
  columns: readonly string[],
  fields: readonly F[],
  aliasKeys: Record<F, ReadonlySet<string>>,
  customFields: readonly { key: string; label: string }[],
): Record<number, F | `custom:${string}`>
export function guessImportMapping<F extends string>(
  columns: readonly string[],
  fields: readonly F[],
  aliasKeys: Record<F, ReadonlySet<string>>,
  customFields: readonly { key: string; label: string }[] = [],
): Record<number, F | `custom:${string}`> {
  const mapping: Record<number, F | `custom:${string}`> = {}
  const taken = new Set<string>()
  const customByHeader = new Map<string, string>()
  for (const field of customFields) {
    customByHeader.set(importHeaderKey(field.label), field.key)
    customByHeader.set(importHeaderKey(field.key), field.key)
  }
  columns.forEach((column, index) => {
    const key = importHeaderKey(column)
    if (!key) return
    const customKey = customByHeader.get(key)
    if (customKey) {
      const target = customImportTarget(customKey)
      if (!taken.has(target)) {
        mapping[index] = target
        taken.add(target)
      }
      return
    }
    for (const field of fields) {
      if (taken.has(field)) continue
      if (aliasKeys[field].has(key)) {
        mapping[index] = field
        taken.add(field)
        return
      }
    }
  })
  return mapping
}

/**
 * One parsed line under a mapping: the cells the mapping selected, under the
 * field they were mapped to, verbatim, with custom values gathered under
 * `custom` by definition key. Empty cells are left absent.
 */
export function mapImportRow<F extends string>(
  cells: readonly string[],
  mapping: Record<number, F | `custom:${string}`>,
): Partial<Record<F, string>> & { custom?: Record<string, string> } {
  const standard: Partial<Record<F, string>> = {}
  const custom: Record<string, string> = {}
  for (const [indexText, target] of Object.entries(mapping)) {
    const value = String(cells[Number(indexText)] ?? '')
    if (!value.trim()) continue
    const customKey = customImportTargetKey(target)
    if (customKey) {
      custom[customKey] = value
    } else {
      standard[target as F] = value
    }
  }
  return Object.keys(custom).length ? { ...standard, custom } : standard
}

/**
 * A tag cell as the tags it names.
 *
 * `|` or `,` separated — the CSV export writes `|`, most other products
 * write `,` — lowercased and trimmed like a record's own tag field, so an
 * imported `VIP` and a typed `vip` are one tag and not two.
 */
export function parseImportTags(value: unknown, max: number): string[] {
  const parts = Array.isArray(value)
    ? value.map((entry) => String(entry ?? ''))
    : String(value ?? '').split(/[|,]/)
  return [
    ...new Set(parts.map((tag) => tag.trim().toLowerCase()).filter(Boolean)),
  ].slice(0, max)
}

/**
 * A yes/no cell as a boolean, or `null` when it is neither.
 *
 * The affirmatives are the ones consent and checkbox columns actually
 * carry; the negatives are listed so that an explicit `no` is a `false`
 * rather than an unreadable value that gets reported as dropped.
 */
export function parseImportFlag(value: unknown): boolean | null {
  if (typeof value === 'boolean') return value
  if (typeof value === 'number') return value === 1 ? true : value === 0 ? false : null
  const text = String(value ?? '')
    .trim()
    .toLowerCase()
  if (['yes', 'y', 'true', '1', 'on', 'subscribed', 'opted in', 'opted-in'].includes(text)) {
    return true
  }
  if (['no', 'n', 'false', '0', 'off', 'unsubscribed', ''].includes(text)) {
    return false
  }
  return null
}

/** A cell as trimmed text capped at `max`, or `undefined` when blank. */
export function importTextValue(value: unknown, max: number): string | undefined {
  const text = String(value ?? '')
    .trim()
    .slice(0, max)
  return text || undefined
}

/** A cell the file carried that could not be read as the field it was mapped to. */
export interface ImportDroppedValue {
  /** The standard field name, or `custom:<key>`. */
  field: string
  value: string
}

/** A CSV cell, quoted only when it has to be. */
export function csvCell(value: unknown): string {
  const text = String(value ?? '')
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text
}

/**
 * A whole CSV — the header, then one line per row — through {@link csvCell}.
 *
 * The one serializer for every CSV the console writes: each CRM section's
 * export, the import's skipped-rows file and every report table's export.
 * Quoting is decided in {@link csvCell} and nowhere else — a cell holding a
 * comma, a quote or a line break is wrapped in quotes with its quotes
 * doubled, no other cell is touched, and a `null` or `undefined` cell is
 * empty rather than the word — so that a report's file and a contacts file
 * open the same way in a spreadsheet.
 */
export function csvDocument(
  header: readonly unknown[],
  rows: readonly (readonly unknown[])[],
): string {
  return [header, ...rows]
    .map((line) => line.map(csvCell).join(','))
    .join('\n')
}

/**
 * The skipped rows as a file the operator can fix and re-import.
 *
 * The original columns verbatim plus a trailing `Skipped because` column,
 * so the file round-trips: correct the cell, delete the last column or
 * leave it unmapped, and import it again.
 */
export function importSkippedCsv<R extends string>(
  columns: readonly string[],
  entries: readonly { cells: readonly string[]; reason: R }[],
  labels: Record<R, string>,
): string {
  return csvDocument(
    [...columns, 'Skipped because'],
    entries.map((entry) => [
      ...columns.map((_column, index) => entry.cells[index] ?? ''),
      labels[entry.reason] ?? entry.reason,
    ]),
  )
}

/**
 * One row the server did not store, by its index in the request. Each
 * collection names the row back to the operator in its own field — an
 * address, a company name — beside these two.
 */
export interface ImportSkippedRow<R extends string> {
  index: number
  reason: R
}

/**
 * What one request did, in the shape every collection's import reports.
 * The drawer sums these across a file; a collection with more to say
 * extends the shape and folds its own field beside {@link mergeImportResults}.
 */
export interface ImportChunkResult<S extends ImportSkippedRow<string>> {
  received: number
  created: number
  merged: number
  skipped: S[]
  /** Unreadable cells, tallied by field. */
  dropped: Record<string, number>
  /** Owner addresses that matched no member of the organization. */
  ownersUnresolved: string[]
}

/** An empty tally, for the drawer to fold chunk results into. */
export function emptyImportResult<
  S extends ImportSkippedRow<string>,
>(): ImportChunkResult<S> {
  return {
    received: 0,
    created: 0,
    merged: 0,
    skipped: [],
    dropped: {},
    ownersUnresolved: [],
  }
}

/**
 * Two results as one.
 *
 * `offset` is where the chunk started in the file, so a skipped row's index
 * comes back as its position in the FILE rather than in the request — which
 * is what the download of skipped rows has to look up.
 */
export function mergeImportResults<S extends ImportSkippedRow<string>>(
  total: ImportChunkResult<S>,
  chunk: Partial<ImportChunkResult<S>>,
  offset = 0,
): ImportChunkResult<S> {
  const dropped = { ...total.dropped }
  for (const [field, count] of Object.entries(chunk.dropped ?? {})) {
    dropped[field] = (dropped[field] ?? 0) + Number(count ?? 0)
  }
  return {
    received: total.received + Number(chunk.received ?? 0),
    created: total.created + Number(chunk.created ?? 0),
    merged: total.merged + Number(chunk.merged ?? 0),
    skipped: [
      ...total.skipped,
      ...(chunk.skipped ?? []).map((entry) => ({
        ...entry,
        index: Number(entry.index) + offset,
      })),
    ],
    dropped,
    ownersUnresolved: [
      ...new Set([...total.ownersUnresolved, ...(chunk.ownersUnresolved ?? [])]),
    ],
  }
}

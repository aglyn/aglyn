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
 * WHAT AN IMPORTED ITEM CHANGES — the two comparisons the site package
 * import shows (AGL-3534), pure so the console, the kit and the native apps
 * read one definition:
 *
 *  - {@link packageJsonDiff}: every leaf that differs between the site's
 *    item and the file's, as before → after rows;
 *  - {@link packageMergeKeys}: the top-level keys of a merged item that
 *    differ, each with what a merge would keep;
 *  - {@link packageRecordDiff} and {@link packageItemChanges}: an item that
 *    holds records (a dataset's rows) compared record by record, and the
 *    whole item's changes with the records set apart.
 *
 * Nothing here imports anything: both are about plain JSON.
 *=========================================*/

/** Whose value one key of a merged item takes. */
export type SitePackageMergeSide = 'site' | 'package'

/** One leaf that differs: where it is, and the two values. */
export interface PackageJsonChange {
  key: string
  label: string
  before: unknown
  after: unknown
}

const isPlain = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value) && Object.getPrototypeOf(value) === Object.prototype

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b)

/** A path as a person reads it: `version › nodes › text › props`. */
function pathLabel(path: readonly string[]): string {
  return path.length ? path.join(' › ') : 'Whole item'
}

/**
 * Every leaf that differs between the site's item and the file's, as
 * before → after rows: objects are walked key by key, a list or a value is
 * compared whole. At most `limit` rows; `more` counts the rest.
 */
export function packageJsonDiff(
  before: unknown,
  after: unknown,
  limit = 200,
): { changes: PackageJsonChange[]; more: number } {
  const changes: PackageJsonChange[] = []
  let more = 0
  const walk = (left: unknown, right: unknown, path: string[]) => {
    if (same(left, right)) return
    if (isPlain(left) && isPlain(right)) {
      const keys = [...new Set([...Object.keys(left), ...Object.keys(right)])].sort()
      for (const key of keys) walk(left[key], right[key], [...path, key])
      return
    }
    if (changes.length >= limit) {
      more += 1
      return
    }
    changes.push({ key: path.join('/') || '$', label: pathLabel(path), before: left, after: right })
  }
  walk(before, after, [])
  return { changes, more }
}

/** One top-level key of a merged item: both values and the default. */
export interface PackageMergeKey {
  key: string
  site: unknown
  file: unknown
  /** What a merge does when the person does not say: the site's value wins when it has one. */
  merged: SitePackageMergeSide
}

const blank = (value: unknown) => value === undefined || value === null || value === ''

/** The keys of a merged item that differ, each with what a merge would keep. */
export function packageMergeKeys(site: unknown, file: unknown): PackageMergeKey[] {
  const left = isPlain(site) ? site : {}
  const right = isPlain(file) ? file : {}
  return Object.keys(right)
    .sort()
    .filter((key) => right[key] !== undefined && !same(left[key], right[key]))
    .map((key) => ({
      key,
      site: left[key],
      file: right[key],
      merged: blank(left[key]) ? 'package' : 'site',
    }))
}

/*==========================================
 * RECORDS
 *=========================================*/

/** One record of an item's list: a document with its own `$id`. */
export type PackageRecord = Record<string, unknown> & { $id: string }

const isRecord = (value: unknown): value is PackageRecord =>
  isPlain(value) && typeof value['$id'] === 'string' && value['$id'] !== ''

/**
 * The key of an item that holds its records — a dataset's `records`, a
 * collection's `entries` — found by shape rather than by kind, so nothing
 * here names a kind a plugin declares: the one list, on either side, whose
 * every element is a document with its own `$id`. The other side holds a
 * list there too, or nothing. `null` when no key qualifies, or when more
 * than one does and neither can be read as the item's records.
 */
export function packageRecordField(...contents: readonly unknown[]): string | null {
  const docs = contents.filter(isPlain)
  const found = new Set<string>()
  for (const doc of docs) {
    for (const [key, value] of Object.entries(doc)) {
      if (Array.isArray(value) && value.length > 0 && value.every(isRecord)) found.add(key)
    }
  }
  const fields = [...found].filter((key) =>
    docs.every((doc) => {
      const value = doc[key]
      return value === undefined || value === null || (Array.isArray(value) && value.every(isRecord))
    }),
  )
  return fields.length === 1 ? (fields[0] as string) : null
}

export type PackageRecordStatus = 'added' | 'removed' | 'changed'

/** One record that differs between the site and the file. */
export interface PackageRecordRow {
  id: string
  status: PackageRecordStatus
  /** The site's copy; `null` for a record only the file holds. */
  site: PackageRecord | null
  /** The file's copy; `null` for a record only the site holds. */
  file: PackageRecord | null
  /** The fields whose values differ, for a changed record. */
  changed: readonly string[]
}

export interface PackageRecordDiff {
  /** The file's added and changed records in its order, then the site's removed ones. */
  rows: PackageRecordRow[]
  /** Every field the rows hold, `$id` aside, in the order they first appear. */
  fields: string[]
  counts: Record<PackageRecordStatus | 'same', number>
}

const recordsOf = (value: unknown): PackageRecord[] => (Array.isArray(value) ? value.filter(isRecord) : [])

/**
 * Two lists of records, matched by `$id`: what the file adds, what it no
 * longer holds, and, for a record on both sides, each field whose value
 * differs. A record the import would leave as it is counts as `same` and
 * has no row.
 */
export function packageRecordDiff(site: unknown, file: unknown): PackageRecordDiff {
  const theirs = new Map(recordsOf(site).map((record) => [record.$id, record]))
  const ours = recordsOf(file)
  const seen = new Set<string>()
  const rows: PackageRecordRow[] = []
  const counts = { added: 0, removed: 0, changed: 0, same: 0 }
  for (const record of ours) {
    if (seen.has(record.$id)) continue
    seen.add(record.$id)
    const existing = theirs.get(record.$id)
    if (!existing) {
      counts.added += 1
      rows.push({ id: record.$id, status: 'added', site: null, file: record, changed: [] })
      continue
    }
    const keys = [...new Set([...Object.keys(existing), ...Object.keys(record)])].filter((key) => key !== '$id')
    const changed = keys.filter((key) => !same(existing[key], record[key])).sort()
    if (!changed.length) {
      counts.same += 1
      continue
    }
    counts.changed += 1
    rows.push({ id: record.$id, status: 'changed', site: existing, file: record, changed })
  }
  for (const [id, record] of theirs) {
    if (seen.has(id)) continue
    counts.removed += 1
    rows.push({ id, status: 'removed', site: record, file: null, changed: [] })
  }
  const fields: string[] = []
  const listed = new Set<string>(['$id'])
  for (const row of rows) {
    for (const record of [row.file, row.site]) {
      for (const key of Object.keys(record ?? {})) {
        if (listed.has(key)) continue
        listed.add(key)
        fields.push(key)
      }
    }
  }
  return { rows, fields, counts }
}

/** One value of one record that differs, in the shape of {@link PackageJsonChange}. */
export interface PackageRecordChange extends PackageJsonChange {
  status: PackageRecordStatus
}

/** An item's changes: its values, and its records set apart when it holds them. */
export interface PackageItemChanges {
  /** The key that holds the records, when the item has them. */
  recordField: string | null
  /** Every value that differs, the records aside. */
  changes: PackageJsonChange[]
  more: number
  /** The records that differ, a value of a changed record to a row; `null` when the item holds none. */
  records: { summary: string; changes: PackageRecordChange[]; more: number } | null
}

const withoutRecords = (content: unknown, field: string | null): unknown => {
  if (!field || typeof content !== 'object' || content === null || Array.isArray(content)) return content
  const rest = { ...(content as Record<string, unknown>) }
  delete rest[field]
  return rest
}

const countOf = (count: number, singular: string, plural = `${singular}s`) =>
  `${count.toLocaleString('en-US')} ${count === 1 ? singular : plural}`

/**
 * What importing an item changes: the leaf-by-leaf diff of everything but
 * its records, and, for an item that holds records, a row per value that
 * differs (a whole record for one only a side holds). At most `limit` rows
 * of each; `more` counts the rest.
 */
export function packageItemChanges(before: unknown, incoming: unknown, limit = 200): PackageItemChanges {
  const existing = before ?? {}
  const recordField = packageRecordField(existing, incoming)
  const values = packageJsonDiff(withoutRecords(existing, recordField), withoutRecords(incoming, recordField), limit)
  if (!recordField) return { recordField, ...values, records: null }
  const recordsIn = (content: unknown) =>
    typeof content === 'object' && content !== null ? (content as Record<string, unknown>)[recordField] : undefined
  const diff = packageRecordDiff(recordsIn(existing), recordsIn(incoming))
  const changes: PackageRecordChange[] = []
  let more = 0
  const add = (change: PackageRecordChange) => {
    if (changes.length >= limit) more += 1
    else changes.push(change)
  }
  for (const row of diff.rows) {
    if (row.status === 'changed') {
      for (const field of row.changed) {
        add({
          key: `${row.id}/${field}`,
          label: `${row.id} › ${field}`,
          status: 'changed',
          before: row.site?.[field],
          after: row.file?.[field],
        })
      }
    } else {
      add({ key: row.id, label: row.id, status: row.status, before: row.site ?? undefined, after: row.file ?? undefined })
    }
  }
  const { added, removed, changed, same: unchanged } = diff.counts
  const summary = [
    countOf(added, 'new record'),
    countOf(changed, 'changed record'),
    `${countOf(removed, 'record')} not in the file`,
    `${unchanged.toLocaleString('en-US')} unchanged`,
  ].join(' · ')
  return { recordField, ...values, records: { summary, changes, more } }
}

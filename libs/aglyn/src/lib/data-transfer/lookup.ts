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
 * LOOKUP COLUMNS — a cell that names another record (AGL-3541).
 *
 * A `lookup` field holds a record of another resource: a contact's company,
 * a deal's contact, a task's owner. A file names that record the way a
 * person would — "Acme", `acme.com`, `ana@acme.com` — or by its Aglyn ID,
 * and the job engine resolves each distinct value through the target's own
 * `lookup` hook. A value that names no record, or several, is the person's
 * to decide: create the record, use a similar one, leave the field blank,
 * or refuse the rows (`TransferLookupChoice`).
 *
 * What a row carries once resolved is the record's id. A value the person
 * chose to CREATE is carried as {@link transferLookupNewValue} — the text
 * behind a marker no Aglyn id can hold — so the plugin that writes the row
 * creates the record (once, however many rows name it) on its own path.
 *=========================================*/

import { textSimilarity } from './similarity'

/** A record a lookup value may mean, offered when the value names none exactly. */
export interface TransferLookupSuggestion {
  recordId: string
  label: string
}

/** Marks a value the person chose to create; no Aglyn id contains a colon. */
export const TRANSFER_LOOKUP_NEW_PREFIX = 'new:'

/** The value a row carries for a record the plugin creates from `name`. */
export function transferLookupNewValue(name: string): string {
  return `${TRANSFER_LOOKUP_NEW_PREFIX}${name.trim()}`
}

/** The name behind a {@link transferLookupNewValue}, or `null` for any other value. */
export function transferLookupNewName(value: unknown): string | null {
  if (typeof value !== 'string' || !value.startsWith(TRANSFER_LOOKUP_NEW_PREFIX)) return null
  const name = value.slice(TRANSFER_LOOKUP_NEW_PREFIX.length).trim()
  return name || null
}

/**
 * The key a lookup value's choice is filed under: the text trimmed and
 * lowercased, so "Acme" and "acme " are one decision.
 */
export function transferLookupKey(value: unknown): string {
  return String(value ?? '').trim().toLowerCase()
}

/**
 * Whether a cell could be an Aglyn id, worth asking the target for by id
 * before reading it as a name: one word of letters, digits, `-` and `_`.
 */
export function mayBeTransferRecordId(value: unknown): boolean {
  return typeof value === 'string' && /^[A-Za-z0-9_-]{6,128}$/.test(value.trim())
}

/**
 * The closest candidates to `value`, best first: at most `limit`, each at
 * least `threshold` similar (`textSimilarity`), one per record.
 */
export function rankTransferLookupSuggestions(
  value: string,
  candidates: readonly TransferLookupSuggestion[],
  options: { limit?: number; threshold?: number } = {},
): TransferLookupSuggestion[] {
  const limit = options.limit ?? 3
  const threshold = options.threshold ?? 0.5
  const seen = new Set<string>()
  return candidates
    .map((candidate) => ({ candidate, score: textSimilarity(value, candidate.label) }))
    .filter((entry) => entry.score >= threshold)
    .sort((a, b) => b.score - a.score)
    .filter((entry) => {
      if (seen.has(entry.candidate.recordId)) return false
      seen.add(entry.candidate.recordId)
      return true
    })
    .slice(0, limit)
    .map((entry) => entry.candidate)
}

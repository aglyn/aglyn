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
 * Normalized search key for a human display name (AGL-835).
 *
 * Firestore has no case-insensitive query, so name search is done by storing
 * a normalized `nameLower` alongside the display name and running a prefix
 * range query against it: `orderBy(nameLower) startAt(q) endAt(q + '')`.
 * For that to match, the stored key and the typed query MUST be normalized the
 * same way — so both the write paths (screen/host creates and renames) and the
 * switcher's query builder run the raw text through this one function.
 *
 * Normalization is deliberately minimal and reversible-in-spirit: lower-case,
 * trim, and collapse internal whitespace. Diacritics are intentionally NOT
 * stripped — a user who types "café" should match the stored "café", and one
 * who types "cafe" is doing a different search; folding accents here would make
 * the prefix range silently disagree with the key. Returns '' for nullish or
 * blank input, which callers treat as "no searchable name / skip the field".
 */
export function nameSearchKey(name: string | null | undefined): string {
  return (name ?? '').trim().replace(/\s+/g, ' ').toLowerCase()
}

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
 * Best-match ranking for the element picker (AGL-2486).
 *
 * The picker searched a pile of fields with no ranking at all, so typing
 * `icon` returned nearly the whole catalogue with the element actually
 * CALLED `Icon` near the bottom — every component whose description merely
 * mentions an icon scored the same as the one named after it.
 *
 * This does not narrow the search: the caller still hands over whatever the
 * fuzzy pass found across every field. It only decides the ORDER, and the
 * rule it enforces is that a hit on the name always outranks a hit in prose.
 */

/** The fields that carry the element's NAME, best first. */
const NAME_KEYS = ['displayName', 'label', 'title'] as const

/**
 * Everything else worth searching. A hit here can never outrank a name hit,
 * which is the whole point — but it still has to COUNT, or the picker would
 * stop finding "the one with the video in it" by typing `video`.
 */
const OTHER_KEYS = [
  'description',
  'subtitle',
  'category',
  'tags',
  'keywords',
  'kind',
  'pluginId',
  '$id',
] as const

/**
 * Match quality, best first. Lower sorts earlier.
 *
 * `FUZZY_ONLY` is the floor: the caller's fuzzy pass matched it but no field
 * literally contains the term (a typo, a transposition). Those keep their
 * incoming order and sit behind every literal hit.
 */
export const PICKER_RANK = {
  EXACT_NAME: 0,
  NAME_PREFIX: 1,
  NAME_WORD_PREFIX: 2,
  NAME_SUBSTRING: 3,
  OTHER_FIELD: 4,
  FUZZY_ONLY: 5,
} as const

export type PickerRank = (typeof PICKER_RANK)[keyof typeof PICKER_RANK]

/** Searchable text of one field: arrays (tags) join, everything else stringifies. */
function fieldText(value: unknown): string {
  if (typeof value === 'string') return value.toLowerCase()
  if (Array.isArray(value)) {
    return value.filter((i) => typeof i === 'string').join(' ').toLowerCase()
  }
  return ''
}

function namesOf(item: unknown): string[] {
  const record = (item ?? {}) as Record<string, unknown>
  return NAME_KEYS.map((key) => fieldText(record[key])).filter(Boolean)
}

function otherTextOf(item: unknown): string {
  const record = (item ?? {}) as Record<string, unknown>
  return OTHER_KEYS.map((key) => fieldText(record[key]))
    .filter(Boolean)
    .join(' ')
}

/** Whether `term` starts a word inside `text` ("Icon button" for `but`). */
function hasWordPrefix(text: string, term: string): boolean {
  let from = text.indexOf(term)
  while (from !== -1) {
    const before = from === 0 ? '' : text[from - 1]
    if (!before || !/[a-z0-9]/.test(before)) return true
    from = text.indexOf(term, from + 1)
  }
  return false
}

function rankOfTerm(item: unknown, term: string): PickerRank {
  const names = namesOf(item)
  if (names.some((name) => name === term)) return PICKER_RANK.EXACT_NAME
  if (names.some((name) => name.startsWith(term))) return PICKER_RANK.NAME_PREFIX
  if (names.some((name) => hasWordPrefix(name, term))) {
    return PICKER_RANK.NAME_WORD_PREFIX
  }
  if (names.some((name) => name.includes(term))) return PICKER_RANK.NAME_SUBSTRING
  if (otherTextOf(item).includes(term)) return PICKER_RANK.OTHER_FIELD
  return PICKER_RANK.FUZZY_ONLY
}

/**
 * How well `item` matches `query`.
 *
 * A multi-word query is scored by its WEAKEST term: "icon button" must not
 * be reported as an exact name match on the strength of `icon` alone.
 */
export function rankPickerItem(item: unknown, query: string): PickerRank {
  const terms = String(query ?? '')
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean)
  if (!terms.length) return PICKER_RANK.FUZZY_ONLY
  // Per-term, the WEAKEST term decides.
  let byTerm: PickerRank = PICKER_RANK.EXACT_NAME
  for (const term of terms) {
    const termRank = rankOfTerm(item, term)
    if (termRank > byTerm) byTerm = termRank
  }
  // The whole query as one phrase can only ever help: `icon button` should
  // read as an exact name match against an element called "Icon button",
  // which per-term scoring alone would grade as a mid-word hit on `button`.
  const byPhrase = terms.length > 1 ? rankOfTerm(item, terms.join(' ')) : byTerm
  return byPhrase < byTerm ? byPhrase : byTerm
}

/** Shortest name, then alphabetical — a stable order inside a rank. */
function tieBreak(a: unknown, b: unknown): number {
  const nameA = namesOf(a)[0] ?? ''
  const nameB = namesOf(b)[0] ?? ''
  return nameA.length - nameB.length || nameA.localeCompare(nameB)
}

/**
 * `items` reordered best-match first. Nothing is dropped — the caller has
 * already decided what matches.
 */
export function rankPickerItems<T>(items: T[], query: string): T[] {
  if (!query || !Array.isArray(items)) return items ?? []
  return items
    .map((item, index) => ({ item, index, rank: rankPickerItem(item, query) }))
    .sort(
      (a, b) =>
        a.rank - b.rank ||
        tieBreak(a.item, b.item) ||
        // Incoming order last, so a fuzzy-only tail keeps the fuzzy
        // matcher's own idea of which typo was closest.
        a.index - b.index,
    )
    .map((i) => i.item)
}

export default rankPickerItems

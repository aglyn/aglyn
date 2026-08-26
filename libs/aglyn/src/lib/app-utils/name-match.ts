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
 * How a name is matched against what somebody typed, and how matches are
 * ordered (AGL-2486).
 *
 * Shared by console global search AND by `useSwitcherCollection`, which backs
 * the site and screen switchers. It lives here rather than in the console
 * because those switchers are in `libs/tenant/feature/instance` and had the
 * SAME defect: both surfaces matched by a Firestore prefix range, so both
 * failed the "Main Layout" case, and both silently omitted any document
 * missing the field they ordered by. One matcher means fixing it once.
 *
 * ## The defect this closes
 *
 * A Firestore PREFIX range over `nameLower` is anchored at the start of the
 * whole string, so it finds "Main Layout" when you type `main` and never when
 * you type `layout`. A footer that admits as much is honest and still
 * unusable.
 *
 * ## Why the matching moved to the client, which is not a cop-out
 *
 * It is the same call `media-search.ts` already made for the DAM, and for the
 * same reason, so this is the repo's existing doctrine rather than a new one:
 *
 * "rich matching is allowed only over a set the UI can truthfully describe"
 *
 * Firestore has no `LIKE` and no full-text index. A word-anywhere match has no
 * server expression at all. The only server-side shape available is the prefix
 * range, and buying it for the eleven collections this now searches would cost
 * a schema field, a backfill of every existing document, and — for the ones
 * that also carry a `where` — a composite index each. `media-search.ts:36-49`
 * declined exactly that trade; the index inventory shows the result, a single
 * `nameLower` composite in the entire repo, on `hostMemberships`.
 *
 * So the set is bounded and named instead: `useGlobalSearch` reads a capped
 * window per collection, this module matches over ALL of it, and
 * `globalSearchScopeMessage` states the bound. The honesty is not decoration —
 * an absent result must not read as "you do not have one" to somebody who is
 * about to create a duplicate.
 *
 * ## What "matches" means, stated once so the caption can quote it
 *
 * A row matches when EVERY word of the query is found somewhere in the row's
 * searchable text. Not a prefix of the whole string, and not a fuzzy distance:
 * both extremes were rejected deliberately.
 *
 * * A prefix of the whole string is the defect above.
 * * Fuzzy (`Fuse`, which the DAM does use) is right for filenames, where a
 *   typo in `mock-hero-noshadow.png` is common and the corpus is one field. It
 *   is wrong here, because the corpus is eleven kinds of object and a loose
 *   match across them produces a palette where the top hit is not the thing
 *   you typed. Deterministic matching also means the caption is exactly true
 *   rather than approximately true, and every case in this file is testable.
 *
 * Ranking then puts the strongest evidence first, because with eleven groups
 * the reader sees perhaps three rows of any one kind.
 */

/**
 * How well a row matched. Higher sorts first.
 *
 * The gaps are wide on purpose: they are ranks, not a tuned scale, and a
 * later contributor adding a case in between should not have to renumber.
 */
export const MATCH_SCORE = {
  /** The name IS the query. */
  exact: 1000,
  /** The name starts with the query — the old prefix behaviour, kept top. */
  namePrefix: 800,
  /** A word inside the name starts with the query: `layout` → "Main Layout". */
  wordPrefix: 600,
  /** The query appears inside the name, mid-word: `ayou` → "Main Layout". */
  substring: 400,
  /** Every query word matched somewhere, but not contiguously. */
  allWords: 200,
  /** Matched only on a secondary field (a slug, a route, an email). */
  secondary: 100,
} as const

/** A word-splitting normaliser shared by the corpus and the query. */
const WORD_SPLIT = /[^\p{L}\p{N}]+/u

/**
 * Lowercase and strip diacritics.
 *
 * `nameSearchKey` (the Firestore write-side key) deliberately PRESERVES
 * diacritics, because a range query must compare against exactly what was
 * stored. This is the client-side matcher and has no such constraint, so it
 * folds them: somebody searching for `Cafe` should find "Café", and on a US
 * keyboard that is the common direction. Folding here cannot desynchronise
 * anything, because nothing normalised by this function is ever written.
 */
export function foldForSearch(value: string | null | undefined): string {
  return String(value ?? '')
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .trim()
}

/** The query's words, folded. An empty query yields an empty list. */
export function searchWords(query: string | null | undefined): string[] {
  return foldForSearch(query).split(WORD_SPLIT).filter(Boolean)
}

/**
 * The text a row is matched against.
 *
 * `name` is what the reader sees and what ranking is computed from. `extra`
 * is everything else that may legitimately be searched for — a page's route,
 * a product's slug, a contact's email — and can only ever produce a
 * `secondary` score, so a slug hit never outranks a name hit.
 */
export interface SearchableText {
  name: string
  extra?: Array<string | null | undefined>
}

/**
 * Score one row against one query, or `null` when it does not match.
 *
 * Total and pure. Every branch is reachable from a real query, which is what
 * makes the caption in `globalSearchScopeMessage` checkable rather than
 * aspirational.
 */
export function scoreMatch(
  text: SearchableText,
  query: string,
): number | null {
  const words = searchWords(query)
  if (words.length === 0) return null

  const name = foldForSearch(text.name)
  const nameWords = name.split(WORD_SPLIT).filter(Boolean)
  // The whole query as one string, so a multi-word query can still be a
  // contiguous phrase match: "main lay" against "Main Layout".
  const phrase = words.join(' ')

  if (name === phrase) return MATCH_SCORE.exact
  if (name.startsWith(phrase)) return MATCH_SCORE.namePrefix
  if (nameWords.some((word) => word.startsWith(phrase))) {
    return MATCH_SCORE.wordPrefix
  }
  if (name.includes(phrase)) return MATCH_SCORE.substring

  // Every word has to land somewhere in the name, which is what stops
  // `layout home` matching "Main Layout" — the reader typed two words and
  // meant both. Word-prefix rather than equality so `lay hom` still works.
  //
  // Note this SUBSUMES the `wordPrefix` branch above for a single-word query:
  // both ask whether some name word starts with the query. That is not
  // redundancy, it is the ordering — a single word reaching here would score
  // `allWords` and sort below genuine word-prefix hits, so the earlier branch
  // is what keeps `layout` → "Main Layout" ranked where a reader expects it.
  // Worth stating because it is a real trap: removing only the `wordPrefix`
  // branch changes RANKING and not matching, so a test asserting merely "this
  // matches" would stay green through it.
  const everyWordInName = words.every((word) =>
    nameWords.some((nameWord) => nameWord.startsWith(word)),
  )
  if (everyWordInName) return MATCH_SCORE.allWords

  // Secondary fields are matched as a flat haystack: they are identifiers
  // (routes, slugs, emails) where the reader is pasting a fragment rather
  // than typing words, so a substring is the right test.
  const extra = (text.extra ?? [])
    .map((value) => foldForSearch(value))
    .filter(Boolean)
  if (extra.length > 0) {
    const haystack = extra.join(' ')
    if (words.every((word) => haystack.includes(word))) {
      return MATCH_SCORE.secondary
    }
  }

  return null
}

/**
 * Rank two scored rows.
 *
 * Score first, then the shorter name, then alphabetical. The length tiebreak
 * is the one that earns its place: at equal score "Blog" and
 * "Blog post archive template" are both word-prefix hits for `blog`, and the
 * shorter name is nearly always the thing meant.
 *
 * Deterministic to the last comparison on purpose — a palette whose row order
 * changes between two identical queries teaches the reader not to trust the
 * first row, which is the row this whole feature exists to put there.
 */
export function compareScored(
  a: { score: number; label: string },
  b: { score: number; label: string },
): number {
  if (a.score !== b.score) return b.score - a.score
  if (a.label.length !== b.label.length) return a.label.length - b.label.length
  return a.label.localeCompare(b.label)
}

/**
 * The shortest query that is allowed to reach Firestore.
 *
 * Read cost, and it is the single cheapest control here. One character
 * matches a large fraction of any collection, so it spends a read in every
 * group to render a list nobody can use. Two is where a query starts carrying
 * information.
 */
export const MIN_QUERY_LENGTH = 2

/** Is this query worth spending reads on? */
export function isSearchableQuery(query: string | null | undefined): boolean {
  return foldForSearch(query).length >= MIN_QUERY_LENGTH
}

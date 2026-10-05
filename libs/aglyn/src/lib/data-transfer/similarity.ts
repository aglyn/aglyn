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
 * TEXT SIMILARITY — how alike two short strings are, from 0 to 1.
 *
 * Used to guess which field a header means and which picklist value an
 * unknown cell was meant to be. Two measures, because they fail
 * differently: an edit distance catches typos (`Emial`), a token set
 * catches reordering and extra words (`Phone (mobile)` vs `Mobile phone`).
 *=========================================*/

/** Letters without their accents, lowercased: `Café` and `cafe` fold together. */
export function foldText(value: unknown): string {
  return String(value ?? '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
}

/**
 * The Damerau–Levenshtein distance (optimal string alignment): the fewest
 * insertions, deletions, substitutions and swaps of two neighbors that turn
 * `a` into `b`. A swap counts once, so `emial` is one edit from `email`.
 */
export function damerauLevenshtein(a: string, b: string): number {
  if (a === b) return 0
  if (!a.length) return b.length
  if (!b.length) return a.length
  const rows = a.length + 1
  const cols = b.length + 1
  const d: number[][] = Array.from({ length: rows }, () => new Array<number>(cols).fill(0))
  const at = (i: number, j: number): number => d[i]?.[j] ?? 0
  for (let i = 0; i < rows; i += 1) (d[i] as number[])[0] = i
  for (let j = 0; j < cols; j += 1) (d[0] as number[])[j] = j
  for (let i = 1; i < rows; i += 1) {
    for (let j = 1; j < cols; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1
      let best = Math.min(at(i - 1, j) + 1, at(i, j - 1) + 1, at(i - 1, j - 1) + cost)
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) {
        best = Math.min(best, at(i - 2, j - 2) + 1)
      }
      ;(d[i] as number[])[j] = best
    }
  }
  return at(a.length, b.length)
}

/** 1 for identical strings, 0 for nothing in common, by edit distance over the longer length. */
export function editSimilarity(a: string, b: string): number {
  const longest = Math.max(a.length, b.length)
  if (!longest) return 1
  return 1 - damerauLevenshtein(a, b) / longest
}

/** The words of a string, folded: letters and digits only. */
export function similarityTokens(value: unknown): string[] {
  return foldText(value)
    .split(/[^a-z0-9]+/)
    .filter(Boolean)
}

/**
 * How much two strings share as sets of words, 0 to 1 (Dice coefficient).
 * Two words count as the same when they are at most one edit apart and at
 * least four letters long, so a typo inside a longer header still counts.
 */
export function tokenSetSimilarity(a: unknown, b: unknown): number {
  const left = [...new Set(similarityTokens(a))]
  const right = [...new Set(similarityTokens(b))]
  if (!left.length && !right.length) return 1
  if (!left.length || !right.length) return 0
  const unused = [...right]
  let shared = 0
  for (const token of left) {
    let found = unused.indexOf(token)
    if (found < 0 && token.length >= 4) {
      found = unused.findIndex(
        (other) => other.length >= 4 && damerauLevenshtein(token, other) <= 1,
      )
    }
    if (found >= 0) {
      shared += 1
      unused.splice(found, 1)
    }
  }
  return (2 * shared) / (left.length + right.length)
}

/**
 * The one score the matchers rank by: the better of the token-set score and
 * the edit score over the strings with their separators removed, so both a
 * reordering and a typo can carry a match.
 */
export function textSimilarity(a: unknown, b: unknown): number {
  const compactA = similarityTokens(a).join('')
  const compactB = similarityTokens(b).join('')
  return Math.max(tokenSetSimilarity(a, b), editSimilarity(compactA, compactB))
}

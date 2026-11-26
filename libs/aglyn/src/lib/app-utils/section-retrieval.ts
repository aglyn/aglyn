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
 * Lexical section retrieval: the scorer the docs answer and a published
 * site's own section index share (AGL-4250).
 *
 * A BM25-flavoured term-frequency score with title and heading boosts. Term
 * frequency saturates quickly (k = 1.2), so one section repeating a word ten
 * times does not drown a section about the actual subject, and a word in the
 * section's title or heading counts for more than one in its body, because
 * those are the author's own statement of topic.
 *
 * `idf` weighs each word by how few sections carry it. The docs corpus is
 * tuned without it (its measured deflection share is pinned in
 * `docs-deflection.spec.ts`); a site's corpus wants it, because the business's
 * own name and its town are on every page and would otherwise outscore the
 * page that actually answers.
 */

/** Words too common in any corpus to carry signal. */
export const RETRIEVAL_STOP_WORDS: ReadonlySet<string> = new Set([
  'a', 'an', 'and', 'are', 'as', 'at', 'be', 'by', 'can', 'do', 'does',
  'for', 'from', 'how', 'i', 'in', 'is', 'it', 'my', 'of', 'on', 'or',
  'that', 'the', 'this', 'to', 'what', 'when', 'where', 'which', 'why',
  'with', 'you', 'your',
])

/** Lowercase word tokens, stop words removed, length >= 2. */
export function retrievalTokens(text: string): string[] {
  return (String(text ?? '').toLowerCase().match(/[\p{L}\p{N}]{2,}/gu) ?? []).filter(
    (token) => !RETRIEVAL_STOP_WORDS.has(token),
  )
}

/** What a section must carry to be scored. */
export interface RetrievableSection {
  title: string
  /** '' for the text before a page's first heading. */
  heading: string
  text: string
}

interface IndexedSection<T extends RetrievableSection> {
  section: T
  bodyTokenCounts: Map<string, number>
  titleTokens: Set<string>
  headingTokens: Set<string>
}

/** A corpus tokenized once, for any number of questions. */
export interface SectionIndex<T extends RetrievableSection> {
  entries: readonly IndexedSection<T>[]
  /** How many sections carry each word, anywhere in them. */
  frequency: ReadonlyMap<string, number>
}

export interface RankedSection<T extends RetrievableSection> {
  section: T
  score: number
}

export function buildSectionIndex<T extends RetrievableSection>(
  sections: readonly T[],
): SectionIndex<T> {
  const frequency = new Map<string, number>()
  const entries = sections.map((section) => {
    const bodyTokenCounts = new Map<string, number>()
    for (const token of retrievalTokens(section.text)) {
      bodyTokenCounts.set(token, (bodyTokenCounts.get(token) ?? 0) + 1)
    }
    const titleTokens = new Set(retrievalTokens(section.title))
    const headingTokens = new Set(retrievalTokens(section.heading))
    for (const token of new Set([...bodyTokenCounts.keys(), ...titleTokens, ...headingTokens])) {
      frequency.set(token, (frequency.get(token) ?? 0) + 1)
    }
    return { section, bodyTokenCounts, titleTokens, headingTokens }
  })
  return { entries, frequency }
}

function scoreEntry<T extends RetrievableSection>(
  entry: IndexedSection<T>,
  queryTokens: readonly string[],
  weight: (token: string) => number,
): number {
  let score = 0
  for (const token of queryTokens) {
    let tokenScore = 0
    const tf = entry.bodyTokenCounts.get(token) ?? 0
    if (tf > 0) tokenScore += (tf * 2.2) / (tf + 1.2)
    if (entry.titleTokens.has(token)) tokenScore += 2.5
    if (entry.headingTokens.has(token)) tokenScore += 2
    score += tokenScore * weight(token)
  }
  return score
}

/**
 * The sections that answer `question`, best first, at most `limit`, each
 * with a score above zero.
 */
export function rankSections<T extends RetrievableSection>(
  index: SectionIndex<T>,
  question: string,
  options: { limit?: number; idf?: boolean } = {},
): RankedSection<T>[] {
  const queryTokens = [...new Set(retrievalTokens(question))]
  if (!queryTokens.length || !index.entries.length) return []
  const total = index.entries.length
  const weight = options.idf
    ? (token: string) => {
        const carrying = index.frequency.get(token) ?? 0
        // BM25's idf, floored at a small positive weight so a word on every
        // page still breaks a tie rather than counting against a section.
        return Math.max(0.1, Math.log(1 + (total - carrying + 0.5) / (carrying + 0.5)))
      }
    : () => 1
  return index.entries
    .map((entry) => ({ section: entry.section, score: scoreEntry(entry, queryTokens, weight) }))
    .filter((ranked) => ranked.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, options.limit ?? 6)
}

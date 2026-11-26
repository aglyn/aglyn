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
  DOCS_SECTION_INDEX,
  type DocsSection,
} from './docs-index.generated'
import { DOCS_BASE_URL } from './docs-help'
import {
  buildSectionIndex,
  rankSections,
  RETRIEVAL_STOP_WORDS,
  retrievalTokens,
  type SectionIndex,
} from './section-retrieval'

/**
 * Lexical docs search (AGL-1860, phase 1) — deliberately no vector store: a
 * BM25-flavoured term-frequency score over the generated docs section index,
 * with title/heading term boosts. Good enough to find the right docs section
 * for a "how do I…" question and cheap enough to run on every request inside
 * an API route.
 *
 * The platform's, and named so (AGL-3080): the console's issue reports
 * deflect to it with no model involved, and the AI plugin grounds its answers
 * in it — one reader among others, not its owner.
 */

/** Words too common in this corpus to carry signal. */
const STOP_WORDS = RETRIEVAL_STOP_WORDS

/** Lowercase word tokens, stop words removed, length >= 2. */
export function tokenize(text: string): string[] {
  return retrievalTokens(text)
}

export interface ScoredSection {
  section: DocsSection
  score: number
}

/**
 * Tokenized once per process — module scope, ~650 sections. The scorer is
 * the shared section scorer (`section-retrieval.ts`, AGL-4250), without its
 * idf weight: the docs' deflection share was measured on raw scores.
 */
let indexed: SectionIndex<DocsSection> | null = null

/**
 * Top-`limit` docs sections for a user question. Returns an empty array when
 * nothing scores above zero — the caller then answers without docs grounding
 * rather than citing an irrelevant page.
 */
export function retrieveDocsSections(
  question: string,
  limit = 6,
  sections: readonly DocsSection[] = DOCS_SECTION_INDEX,
): ScoredSection[] {
  const index =
    sections === DOCS_SECTION_INDEX
      ? (indexed ??= buildSectionIndex(sections))
      : buildSectionIndex(sections)
  return rankSections(index, question, { limit })
}

/**
 * How many indexed sections each token appears in — the raw material for an
 * IDF weight (AGL-2486).
 *
 * Counts SECTIONS, not pages: a term confined to one page but repeated in
 * every section of it is still a specific term, and page-level counting would
 * flatten exactly the distinction the weight exists to make. Derived from the
 * same index the scorer reads, so the two can never disagree about what a
 * token is.
 */
export function docsDocumentFrequency(): {
  frequency: ReadonlyMap<string, number>
  sections: number
} {
  const index = (indexed ??= buildSectionIndex(DOCS_SECTION_INDEX))
  return { frequency: index.frequency, sections: DOCS_SECTION_INDEX.length }
}

/** A letter of any script but Latin: Arabic, Hebrew, Cyrillic, CJK, Devanagari… */
const NON_LATIN_LETTER = /[^\P{L}\p{Script=Latin}]/u

/**
 * Whether a question has to be put into English before the docs can be
 * searched for it (AGL-4075).
 *
 * The docs are written in English and the search matches words, so a
 * question in another language matches nothing by its own words: 17 of 50
 * chat turns in one fortnight were not in English, and none of them was
 * grounded in the docs at all. True for a question with a letter outside the
 * Latin script; for a Latin-script question fewer than half of whose words
 * appear anywhere in the docs ("¿Cómo conecto mi dominio?"); and for one
 * with a word the docs never use and none of English's small words ("how",
 * "do", "my", "the"), which is how a question in French or Portuguese reads
 * when it shares half its words with English ("Comment publier mon site ?").
 * An English question about the product uses the docs' own words, so it is
 * searched as it was asked. A question with no words has nothing to look up.
 */
export function docsLookupNeedsEnglish(question: string): boolean {
  const text = String(question ?? '')
  if (NON_LATIN_LETTER.test(text)) return true
  const tokens = tokenize(text)
  if (!tokens.length) return false
  const { frequency } = docsDocumentFrequency()
  const unknown = tokens.filter((token) => !frequency.has(token)).length
  if (unknown * 2 > tokens.length) return true
  const words = text.toLowerCase().match(/[\p{L}\p{N}]{2,}/gu) ?? []
  return unknown > 0 && !words.some((word) => STOP_WORDS.has(word))
}

/**
 * Public docs-site origin for deep links the assistant hands the user.
 *
 * Configurable (AGL-2016): a self-hoster who publishes the `apps/docs` site on
 * their own domain otherwise had every Assist citation deep-link into
 * `docs.aglyn.com` — our documentation, describing our deployment's flags and
 * plans, cited as if it were theirs.
 *
 * Unlike the operator CONTACT values this keeps our value as the default, and
 * the difference is deliberate: an unset citation origin degrades to a page
 * that genuinely exists and is genuinely about this software, so it is wrong
 * in the way a stale bookmark is wrong. An unset contact address would
 * misroute a legal notice, which is why that one refuses to guess.
 *
 * ⚠️ RE-EXPORTED FROM `DOCS_BASE_URL` RATHER THAN READ AGAIN HERE (AGL-2014).
 * This module had its own `process.env.NEXT_PUBLIC_DOCS_ORIGIN || 'https://
 * docs.aglyn.com'`, which accepted ONLY the canonical name — while
 * `constants/docs-links.ts` also honours the older `NEXT_PUBLIC_AGLYN_DOCS_URL`.
 * So AGL-2186's own defect survived, inverted, in the one file it did not
 * touch: a deployment configured under the older name retargeted every console
 * and besigner help link and left every ASSIST CITATION pointing at
 * `docs.aglyn.com` — our documentation, cited inside their product as theirs.
 * That is the same "one value, two env names" split AGL-733 is the record of.
 * One reader means an operator's docs site cannot be honoured on some surfaces
 * and ignored on others.
 */
export const DOCS_SITE_ORIGIN = DOCS_BASE_URL

/**
 * The grounding block injected into the system prompt: the retrieved
 * sections, each with its citable URL, wrapped so the model can quote and
 * link them. Kept AFTER the stable system prefix so prompt caching of the
 * static prefix survives per-question variation.
 */
export function docsGroundingBlock(scored: readonly ScoredSection[]): string {
  if (!scored.length) return ''
  const parts = scored.map(({ section }) => {
    const url = `${DOCS_SITE_ORIGIN}${section.path}${section.anchor}`
    const heading = section.heading
      ? `${section.title} — ${section.heading}`
      : section.title
    return `<doc url="${url}" title="${heading}">\n${section.text}\n</doc>`
  })
  return `\n\nRelevant documentation sections (cite these URLs when they answer the question):\n${parts.join('\n')}`
}

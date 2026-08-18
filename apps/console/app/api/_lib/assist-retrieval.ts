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
  ASSIST_DOCS_INDEX,
  type AssistDocsSection,
} from '../../../constants/assist-docs-index.generated'

/**
 * Lexical docs retrieval for Aglyn Assist (AGL-1860, phase 1) — deliberately
 * no vector store: a BM25-flavoured term-frequency score over the generated
 * docs section index, with title/heading term boosts. Good enough to ground
 * "how do I…" answers in the right docs section and cheap enough to run on
 * every message inside the API route.
 */

/** Words too common in this corpus to carry signal. */
const STOP_WORDS = new Set([
  'a', 'an', 'and', 'are', 'as', 'at', 'be', 'by', 'can', 'do', 'does',
  'for', 'from', 'how', 'i', 'in', 'is', 'it', 'my', 'of', 'on', 'or',
  'that', 'the', 'this', 'to', 'what', 'when', 'where', 'which', 'why',
  'with', 'you', 'your',
])

/** Lowercase word tokens, stop words removed, length >= 2. */
export function tokenize(text: string): string[] {
  return (text.toLowerCase().match(/[\p{L}\p{N}]{2,}/gu) ?? []).filter(
    (token) => !STOP_WORDS.has(token),
  )
}

export interface ScoredSection {
  section: AssistDocsSection
  score: number
}

/**
 * Score one section against query tokens. Term frequency saturates quickly
 * (BM25-ish k=1.2) so one section mentioning "domain" ten times does not
 * drown a section about the actual task; title and heading hits carry
 * dedicated boosts because those are the docs' own statement of topic.
 */
function scoreSection(
  section: AssistDocsSection,
  queryTokens: readonly string[],
  bodyTokenCounts: Map<string, number>,
  titleTokens: Set<string>,
  headingTokens: Set<string>,
): number {
  let score = 0
  for (const token of queryTokens) {
    const tf = bodyTokenCounts.get(token) ?? 0
    if (tf > 0) score += (tf * 2.2) / (tf + 1.2)
    if (titleTokens.has(token)) score += 2.5
    if (headingTokens.has(token)) score += 2
  }
  return score
}

interface IndexedSection {
  section: AssistDocsSection
  bodyTokenCounts: Map<string, number>
  titleTokens: Set<string>
  headingTokens: Set<string>
}

/** Tokenized once per process — module scope, ~650 sections. */
let indexed: IndexedSection[] | null = null

function buildIndex(sections: readonly AssistDocsSection[]): IndexedSection[] {
  return sections.map((section) => {
    const bodyTokenCounts = new Map<string, number>()
    for (const token of tokenize(section.text)) {
      bodyTokenCounts.set(token, (bodyTokenCounts.get(token) ?? 0) + 1)
    }
    return {
      section,
      bodyTokenCounts,
      titleTokens: new Set(tokenize(section.title)),
      headingTokens: new Set(tokenize(section.heading)),
    }
  })
}

/**
 * Top-`limit` docs sections for a user question. Returns an empty array when
 * nothing scores above zero — the caller then answers without docs grounding
 * rather than citing an irrelevant page.
 */
export function retrieveDocsSections(
  question: string,
  limit = 6,
  sections: readonly AssistDocsSection[] = ASSIST_DOCS_INDEX,
): ScoredSection[] {
  const queryTokens = [...new Set(tokenize(question))]
  if (!queryTokens.length) return []
  const index =
    sections === ASSIST_DOCS_INDEX
      ? (indexed ??= buildIndex(sections))
      : buildIndex(sections)
  return index
    .map((entry) => ({
      section: entry.section,
      score: scoreSection(
        entry.section,
        queryTokens,
        entry.bodyTokenCounts,
        entry.titleTokens,
        entry.headingTokens,
      ),
    }))
    .filter((scored) => scored.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
}

/** Public docs-site origin for deep links the assistant hands the user. */
export const DOCS_SITE_ORIGIN = 'https://docs.aglyn.com'

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

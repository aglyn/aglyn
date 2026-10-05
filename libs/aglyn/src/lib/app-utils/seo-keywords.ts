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
 * Target keywords: the words a site owner wants a page found for, and where
 * the page already says them.
 *
 * The SEO check (`seo-audit.ts`) reports a keyword a page never says, and
 * anything that writes a listing holds its answer to the same count, so
 * "the page says it" means one thing everywhere: the keyword as whole words,
 * in any case, never inside a longer word.
 */

/** Target keywords one page may name. */
export const SEO_MAX_KEYWORDS = 5

/** The longest target keyword text a site's lines run to: a line a page, for a large site. */
export const SEO_KEYWORD_LINES_MAX_CHARS = 3_000

/** The longest one keyword is kept. */
const SEO_KEYWORD_MAX_CHARS = 60

/** Whether, and where, a page already says a target keyword. */
export interface SeoKeywordCoverage {
  keyword: string
  inTitle: boolean
  inDescription: boolean
  inH1: boolean
  inBody: boolean
}

const escapeRegExp = (value: string): string => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/** How many times `keyword` appears in `text` as whole words, any case. */
export function seoKeywordCount(text: string | null | undefined, keyword: string): number {
  const needle = keyword.trim().toLowerCase()
  if (!needle || !text) return 0
  const pattern = new RegExp(
    `(^|[^\\p{L}\\p{N}])${escapeRegExp(needle).replace(/\s+/g, '\\s+')}(?=$|[^\\p{L}\\p{N}])`,
    'giu',
  )
  return [...text.toLowerCase().matchAll(pattern)].length
}

/**
 * Keywords as a person typed them — trimmed, deduplicated — split at
 * {@link SEO_MAX_KEYWORDS}: the ones a page is checked for, and the distinct
 * ones past the limit, which a caller names rather than drops in silence.
 */
export function seoKeywordSplit(raw: unknown): { keywords: string[]; unchecked: string[] } {
  const parts = Array.isArray(raw) ? raw.map(String) : String(raw ?? '').split(/[,\n]/)
  const seen = new Set<string>()
  const keywords: string[] = []
  const unchecked: string[] = []
  for (const part of parts) {
    const keyword = part.replace(/\s+/g, ' ').trim().slice(0, SEO_KEYWORD_MAX_CHARS)
    const key = keyword.toLowerCase()
    if (!keyword || seen.has(key)) continue
    seen.add(key)
    if (keywords.length < SEO_MAX_KEYWORDS) keywords.push(keyword)
    else unchecked.push(keyword)
  }
  return { keywords, unchecked }
}

/** Keywords as a person typed them: trimmed, deduplicated, capped at {@link SEO_MAX_KEYWORDS}. */
export function seoKeywordList(raw: unknown): string[] {
  return seoKeywordSplit(raw).keywords
}

/** How a note names keywords: each quoted, in the order they were typed. */
export function seoQuotedKeywords(keywords: readonly string[]): string {
  return keywords.map((keyword) => `“${keyword}”`).join(', ')
}

/** Where a page already says each target keyword. */
export function seoKeywordCoverage(
  keywords: readonly string[],
  sources: { title?: string | null; description?: string | null; h1?: string | null; body?: string | null },
): SeoKeywordCoverage[] {
  return keywords.map((keyword) => ({
    keyword,
    inTitle: seoKeywordCount(sources.title, keyword) > 0,
    inDescription: seoKeywordCount(sources.description, keyword) > 0,
    inH1: seoKeywordCount(sources.h1, keyword) > 0,
    inBody: seoKeywordCount(sources.body, keyword) > 0,
  }))
}

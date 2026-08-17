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
 * Transform/normalize core for the legal Doc-vs-live drift checker
 * (legal-doc-diff.mjs, AGL-1611).
 *
 * The move to Google Docs (2026-08-13) left `Platform Docs/Legal/*.gdoc` as
 * 169-byte POINTERS — nothing on disk can be diffed against the published
 * pages, so Doc/live drift is invisible. This module restores diffability:
 * it reduces BOTH sides to the same canonical text so that a difference in
 * the comparison is a difference in WORDS, not in markup.
 *
 *   - The live side is the served HTML of `aglyn.com/legal/<slug>`. Text is
 *     taken the way the clickwrap capture does (see
 *     `libs/aglyn/src/lib/app-utils/publisher-agreement.ts`): text content
 *     minus script/style, content block only — first `Last updated: …` line
 *     through the document's own closing `© …` line, which excludes the site
 *     chrome and the "On this page" TOC (both sit outside that span; the
 *     footer has a second `©` line that the FIRST-match rule never reaches).
 *   - The Doc side is the Drive `files.export` of the Doc as `text/plain`.
 *
 * Normalization is deliberately lossy in exactly the places the two
 * renderings legitimately disagree — markdown markers, typographic vs ASCII
 * punctuation, whitespace runs, table drawing — and nowhere else. Folding
 * too little cries wolf on every real check; folding too much (e.g. case)
 * would hide the kind of edit legal review exists to catch.
 */

/**
 * Which Google Doc corresponds to which published page. Keys are the pointer
 * file's base name (`PRIVACY_POLICY` from `PRIVACY_POLICY.md.gdoc`); values
 * are the slug under `aglyn.com/legal/`, or null for internal documents that
 * intentionally have no page. The published set is asserted by
 * `libs/aglyn/src/lib/app-utils/published-legal-pages.ts`
 * (PUBLISHED_LEGAL_PATHS); an unknown pointer name is reported, not guessed,
 * so a new Doc cannot silently go unchecked.
 */
export const DOC_TO_SLUG = Object.freeze({
  ACCEPTABLE_USE_POLICY: 'acceptable-use',
  COOKIE_POLICY: 'cookies',
  COPYRIGHT_DMCA_POLICY: 'dmca',
  DATA_PROCESSING_ADDENDUM: 'dpa',
  END_USER_LICENSE_AGREEMENT: 'eula',
  MARKETPLACE_PUBLISHER_AGREEMENT: 'marketplace-publisher-agreement',
  PRIVACY_POLICY: 'privacy',
  SUBPROCESSORS: 'subprocessors',
  TERMS_OF_SERVICE: 'terms',
  // Internal documents — no published page, and none expected.
  README: null,
  REGISTERED_AGENT_AND_COUNSEL_GUIDE: null,
})

/**
 * Parse a Drive `.gdoc` pointer file's JSON and return its Doc id, or null
 * when the text is not a pointer (not JSON, or no `doc_id`).
 */
export function parseGdocPointer(text) {
  let parsed
  try {
    parsed = JSON.parse(String(text))
  } catch {
    return null
  }
  const docId = parsed?.doc_id
  return typeof docId === 'string' && docId.trim() ? docId.trim() : null
}

/**
 * Map a pointer file name to its published slug.
 *
 * @returns {{ name: string, slug: string | null, known: boolean }}
 *   `known: false` means the name is not in DOC_TO_SLUG at all — a new Doc
 *   the mapping has never heard of, which the caller must surface rather
 *   than skip. `slug: null` with `known: true` is a deliberate internal doc.
 */
export function slugForPointerName(fileName) {
  const name = String(fileName).replace(/\.md\.gdoc$|\.gdoc$/i, '')
  const known = Object.prototype.hasOwnProperty.call(DOC_TO_SLUG, name)
  return { name, slug: known ? DOC_TO_SLUG[name] : null, known }
}

/** Decode the HTML entities the marketing pages actually emit. */
export function decodeHtmlEntities(text) {
  return String(text)
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) =>
      String.fromCodePoint(Number.parseInt(n, 16)),
    )
    .replace(/&nbsp;/g, ' ')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&') // last, so double-encoded entities stay literal
}

/**
 * Reduce served HTML to text with one line per block-level element.
 *
 * Table cells become their own lines (the plain-text export of a Docs table
 * also emits one cell per line, so the two sides align). Inline tags vanish
 * without inserting whitespace — their surrounding text carries the spaces.
 */
export function htmlToBlockLines(html) {
  let s = String(html)
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<script\b[\s\S]*?<\/script\s*>/gi, ' ')
    .replace(/<style\b[\s\S]*?<\/style\s*>/gi, ' ')
    .replace(/<(?:noscript|template|svg|iframe)\b[\s\S]*?<\/(?:noscript|template|svg|iframe)\s*>/gi, ' ')
  // Block-level boundaries become newlines; everything else is inline.
  s = s.replace(
    /<\/?(?:p|h[1-6]|li|ul|ol|tr|td|th|table|thead|tbody|div|section|article|main|aside|header|footer|nav|blockquote|figure|figcaption|pre|dt|dd|dl)\b[^>]*>|<(?:br|hr)\s*\/?>/gi,
    '\n',
  )
  s = s.replace(/<[^>]+>/g, '')
  return decodeHtmlEntities(s)
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
}

/** Split a Drive plain-text export into trimmed, non-empty lines. */
export function docToBlockLines(plainText) {
  return String(plainText)
    .replace(/^\uFEFF/, '')
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
}

/**
 * Fold one line to canonical form: typographic punctuation to ASCII,
 * markdown markers dropped, whitespace runs collapsed. Case is preserved on
 * purpose — a recapitalized defined term is a real edit.
 */
export function normalizeLegalLine(line) {
  let s = String(line)
    .replace(/[\u2018\u2019\u02BC]/g, "'")
    .replace(/[\u201C\u201D]/g, '"')
    .replace(/[\u2013\u2014]/g, '-')
    .replace(/\u2026/g, '...')
    .replace(/[\u00A0\u2000-\u200A\u202F\u3000]/g, ' ')
    .replace(/[\u200B-\u200D\uFEFF]/g, '')
  // Markdown-lite the Doc (or a literal-markdown Doc import) may carry, in
  // syntax the rendered page has already consumed.
  s = s
    .replace(/^#{1,6}\s+/, '')
    .replace(/^[-*+]\s+/, '')
    .replace(/^>\s+/, '')
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/\*([^*]+)\*/g, '$1')
    .replace(/`([^`]*)`/g, '$1')
  // Table drawing: pipes to spaces; a row that was only drawing disappears.
  s = s.replace(/\|/g, ' ')
  s = s.replace(/\s+/g, ' ').trim()
  // Markdown table separator rows (|---|---|) and horizontal rules are
  // layout, not content.
  if (/^[-: ]+$/.test(s) && s.includes('-')) return ''
  return s
}

/**
 * Slice a line list down to the document's content block: the first
 * `Last updated:` line through the first following `©` line, inclusive.
 * Missing markers degrade gracefully (start of text / end of text) and are
 * reported so the verdict can carry the caveat.
 *
 * @returns {{ lines: string[], foundStart: boolean, foundEnd: boolean }}
 */
export function sliceContentBlock(lines) {
  const start = lines.findIndex((l) => /^\**\s*Last updated:/i.test(l))
  const foundStart = start >= 0
  const from = foundStart ? start : 0
  const end = lines.findIndex((l, i) => i > from && /^©/.test(l.trim()))
  const foundEnd = end >= 0
  const to = foundEnd ? end : lines.length - 1
  return { lines: lines.slice(from, to + 1), foundStart, foundEnd }
}

/**
 * Full pipeline for one side. `kind` is 'html' (served page) or 'doc'
 * (Drive plain-text export).
 *
 * @returns {{ text: string, foundStart: boolean, foundEnd: boolean }}
 *   `text` is the canonical content block, newline-joined with a trailing
 *   newline (empty input stays empty).
 */
export function canonicalizeLegal(raw, kind) {
  const blockLines =
    kind === 'html' ? htmlToBlockLines(raw) : docToBlockLines(raw)
  const sliced = sliceContentBlock(blockLines)
  const lines = sliced.lines.map(normalizeLegalLine).filter(Boolean)
  return {
    text: lines.length ? `${lines.join('\n')}\n` : '',
    foundStart: sliced.foundStart,
    foundEnd: sliced.foundEnd,
  }
}

/**
 * Compare one document's two sides.
 *
 * @returns {{
 *   inSync: boolean,
 *   live: ReturnType<typeof canonicalizeLegal>,
 *   doc: ReturnType<typeof canonicalizeLegal>,
 *   caveats: string[],
 * }}
 */
export function compareLegalDocument(liveHtml, docPlainText) {
  const live = canonicalizeLegal(liveHtml, 'html')
  const doc = canonicalizeLegal(docPlainText, 'doc')
  const caveats = []
  if (!live.foundStart) caveats.push('live page has no "Last updated:" line')
  if (!live.foundEnd) caveats.push('live page has no closing "©" line')
  if (!doc.foundStart) caveats.push('Doc has no "Last updated:" line')
  if (!doc.foundEnd) caveats.push('Doc has no closing "©" line')
  return { inSync: live.text === doc.text, live, doc, caveats }
}

/**
 * The drift-checker exit-code convention (same as check-rules-drift):
 *   0 every compared document in sync;
 *   1 at least one DIFFERS — drift wins over cannot-check, both are red and
 *     drift is the more actionable signal;
 *   2 nothing differs but at least one document could not be checked.
 * `skipped` verdicts (internal docs with no page) never affect the code.
 *
 * @param {Array<{ status: 'in-sync'|'differs'|'unreadable'|'skipped' }>} verdicts
 */
export function overallExitCode(verdicts) {
  if (verdicts.some((v) => v.status === 'differs')) return 1
  if (verdicts.some((v) => v.status === 'unreadable')) return 2
  // No comparable documents at all is a cannot-check, not a clean pass — an
  // empty run must never read as "everything is in sync".
  if (!verdicts.some((v) => v.status === 'in-sync')) return 2
  return 0
}

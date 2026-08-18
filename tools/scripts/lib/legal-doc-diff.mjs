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

// ---------------------------------------------------------------------------
// Paste half (AGL-1611 steps 3b–4): turn a Drive `text/markdown` export into
// the ready-to-paste markdown-lite block, and preview the TOC the besigner
// Table-of-contents element will derive from it.
//
// The publish flow itself stays human — legal snapshots are publication-first,
// so nothing here writes to besigner or Firestore. The paste target is the ONE
// Markdown element on each /legal page; its "On this page" aside is NOT pasted
// separately — the mui TOC element derives it from the pasted body's headings
// at render time (AGL-1162), which is why the TOC half of this module is a
// PREVIEW plus an anchor diff rather than a second paste block.
// ---------------------------------------------------------------------------

/**
 * Slice raw markdown LINES (blank lines preserved — they are the dialect's
 * block separators) down to the content block, by the same markers
 * {@link sliceContentBlock} uses on normalized lines: first `Last updated:`
 * line (however emphasised) through the first following `©` line.
 */
export function sliceMarkdownContentBlock(lines) {
  const isStart = (line) => /^[#>\s*_]*Last updated:/i.test(line.trim())
  // A Docs markdown export renders the copyright line italic (`*© …*`,
  // measured on the real EULA Doc, 2026-08-17), so leading emphasis markers
  // and escapes are looked through.
  const isEnd = (line) => /^©/.test(line.trim().replace(/^[\\*_]+/, ''))
  const start = lines.findIndex(isStart)
  const foundStart = start >= 0
  const from = foundStart ? start : 0
  const end = lines.findIndex((l, i) => i > from && isEnd(l))
  const foundEnd = end >= 0
  const to = foundEnd ? end : lines.length - 1
  return { lines: lines.slice(from, to + 1), foundStart, foundEnd }
}

/**
 * Convert a Drive `text/markdown` export of a legal Doc into the besigner
 * markdown-lite dialect, sliced to the content block, ready to paste into the
 * page's Markdown element.
 *
 * The dialect is `libs/aglyn/src/lib/app-utils/markdown-lite.ts`; the
 * transforms below exist because a Docs export legitimately differs from it:
 *
 * - Google backslash-escapes punctuation (`1\.`, `\-`, `\[`); the dialect has
 *   NO escapes, so the backslashes must go or they render as text.
 * - Headings are clamped to `##`/`###` (AGL-1082): `#` becomes `##` — the
 *   same mapping the console HTML-paste path applies to `<h1>` — and
 *   `####`–`######` become `###`. Every renderer reads the level as a
 *   2-or-3 ternary, so an unclamped heading silently renders wrong.
 * - `*`/`+` bullets and `_`-emphasis fold to the `-` and `*` forms the parser
 *   recognises; indentation is dropped because the dialect has no nesting.
 * - Horizontal rules and `~~strikethrough~~` markers vanish — no block or
 *   inline exists for them, so left alone they would render literally.
 *
 * Fenced code blocks pass through VERBATIM: a fence owns its lines
 * (AGL-974), and "unescaping" a snippet would corrupt it.
 *
 * @returns {{ text: string, foundStart: boolean, foundEnd: boolean }}
 */
export function docMarkdownToMarkdownLite(markdown) {
  const rawLines = String(markdown)
    .replace(/^\uFEFF/, '')
    .replace(/\r\n?/g, '\n')
    .split('\n')
  const out = []
  let inFence = false
  for (const raw of rawLines) {
    if (/^```/.test(raw.trim())) {
      inFence = !inFence
      out.push(raw.trim())
      continue
    }
    if (inFence) {
      out.push(raw)
      continue
    }
    let line = raw.replace(/\s+$/, '')
    // Google's escapes: the dialect has none, so `1\.` must become `1.`.
    line = line.replace(/\\([\\`*_{}[\]()#+\-.!|~<>])/g, '$1')
    // Underscore emphasis to the asterisk forms the parser recognises, and
    // strikethrough markers out (no inline exists for them). Conservative:
    // only spans free of inner underscores, so snake_case identifiers in
    // prose survive untouched. Before the block-shape checks, so list items
    // and headings get the same inline folding as prose.
    line = line
      .replace(/__([^_]+)__/g, '**$1**')
      .replace(/(^|[^A-Za-z0-9_])_([^_]+)_(?=$|[^A-Za-z0-9_])/g, '$1*$2*')
      .replace(/~~([^~]+)~~/g, '$1')
    const trimmed = line.trim()
    // Layout, not content: a horizontal rule has no markdown-lite block.
    if (/^(-{3,}|\*{3,}|_{3,})$/.test(trimmed)) continue
    // Headings, clamped to the dialect's 2|3 (AGL-1082).
    const heading = /^(#{1,6})\s+(.*)$/.exec(trimmed)
    if (heading) {
      const level = heading[1].length
      line = `${level <= 2 ? '##' : '###'} ${heading[2]}`
      out.push(line)
      continue
    }
    // Bullets: `* ` and `+ ` fold to `- `; indentation is dropped (the
    // dialect has no nesting — an indented item is a sibling anyway).
    const bullet = /^[-*+]\s+(.*)$/.exec(trimmed)
    if (bullet) {
      out.push(`- ${bullet[1]}`)
      continue
    }
    const ordered = /^(\d+)[.)]\s+(.*)$/.exec(trimmed)
    if (ordered) {
      out.push(`${ordered[1]}. ${ordered[2]}`)
      continue
    }
    out.push(line)
  }
  const sliced = sliceMarkdownContentBlock(out)
  // Collapse the blank-line runs Docs exports love into single separators.
  const text = sliced.lines
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/^\n+|\n+$/g, '')
  return {
    text: text ? `${text}\n` : '',
    foundStart: sliced.foundStart,
    foundEnd: sliced.foundEnd,
  }
}

/** Inline markers stripped, case and punctuation kept — a TOC label. */
function inlineTextOf(line) {
  return line
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/\*([^*]+)\*/g, '$1')
    .replace(/`([^`]*)`/g, '$1')
    .trim()
}

/**
 * MIRROR of `slugifyHeading` + the dedupe loop of `collectMarkdownHeadings`
 * in `libs/aglyn/src/lib/app-utils/markdown-lite.ts` — that TS module is the
 * source of truth (the tenant renderer derives the real anchors from it), but
 * it cannot be imported from a node script, so the algorithm is restated here
 * and PINNED by a test against an anchor measured on the live site
 * (`#1-pre-release-software`, aglyn.com/legal/eula, 2026-08-17). If the TS
 * slugifier ever changes, that test is the tripwire.
 */
export function slugifyHeadingMirror(text) {
  return (
    String(text)
      .normalize('NFKD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'section'
  )
}

/**
 * The TOC the mui Table-of-contents element will derive from a pasted
 * markdown-lite body (AGL-1162): every `##`/`###` heading outside a fence,
 * with its anchor slug, duplicates suffixed `-2`, `-3`, … in document order.
 *
 * @returns {Array<{ level: 2|3, text: string, slug: string }>}
 */
export function collectTocFromMarkdownLite(markdownLiteText) {
  const headings = []
  const used = new Set()
  let inFence = false
  for (const raw of String(markdownLiteText).split('\n')) {
    const line = raw.trim()
    if (/^```/.test(line)) {
      inFence = !inFence
      continue
    }
    if (inFence) continue
    const match = /^(#{2,3})\s+(.*)$/.exec(line)
    if (!match) continue
    const text = inlineTextOf(match[2])
    const base = slugifyHeadingMirror(text)
    let slug = base
    let suffix = 1
    while (used.has(slug)) {
      suffix += 1
      slug = `${base}-${suffix}`
    }
    used.add(slug)
    headings.push({ level: match[1].length === 2 ? 2 : 3, text, slug })
  }
  return headings
}

/**
 * The in-page anchors the live page's TOC links to, in document order,
 * deduplicated. On the /legal pages the only `href="#…"` links are the
 * "On this page" aside's (measured on aglyn.com/legal/eula, 2026-08-17), so
 * this is the live TOC — the baseline a regenerated one is diffed against to
 * make anchor breakage (an inbound deep link dying to a reworded heading)
 * visible before the paste.
 */
export function extractLiveTocAnchors(html) {
  const anchors = []
  const seen = new Set()
  for (const match of String(html).matchAll(/href="#([^"]+)"/g)) {
    const anchor = decodeHtmlEntities(match[1])
    if (seen.has(anchor)) continue
    seen.add(anchor)
    anchors.push(anchor)
  }
  return anchors
}

/**
 * Human-readable TOC preview plus the anchor delta against the live page.
 * Returns printable lines; an empty `liveAnchors` (page unreadable) yields
 * the preview alone.
 */
export function renderTocPreview(headings, liveAnchors = []) {
  const lines = headings.map(
    (h) => `${h.level === 3 ? '    ' : '  '}${h.text}  →  #${h.slug}`,
  )
  if (liveAnchors.length) {
    const next = new Set(headings.map((h) => h.slug))
    const live = new Set(liveAnchors)
    const removed = liveAnchors.filter((a) => !next.has(a))
    const added = headings.map((h) => h.slug).filter((s) => !live.has(s))
    if (!removed.length && !added.length) {
      lines.push('  anchors: unchanged from the live page')
    } else {
      for (const a of removed)
        lines.push(`  anchor REMOVED (inbound links to it break): #${a}`)
      for (const a of added) lines.push(`  anchor added: #${a}`)
    }
  }
  return lines
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

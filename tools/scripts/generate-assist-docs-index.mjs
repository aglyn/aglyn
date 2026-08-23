#!/usr/bin/env node
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
 * Generates the Aglyn Assist docs retrieval index (AGL-1860) from the docs
 * site content. Source of truth: apps/docs/docs — the SAME tree
 * generate-docs-help.mjs reads, split one level finer: one index entry per
 * H2-section (plus one for the page intro before the first H2), each carrying
 * the page path, title, anchor, and the section's plain text. The assist API
 * route runs lexical retrieval over these entries server-side to ground
 * answers in the docs and deep-link `https://docs.aglyn.com{path}{anchor}`.
 *
 * Emits ONE generated file (server-only import — never ship it client-side):
 *
 *   apps/console/constants/assist-docs-index.generated.ts
 *
 * Re-run after editing apps/docs:
 *
 *   node tools/scripts/generate-assist-docs-index.mjs          (write)
 *   node tools/scripts/generate-assist-docs-index.mjs --check  (CI staleness)
 */
import { readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '../..')
const DOCS_ROOT = join(ROOT, 'apps/docs/docs')
const OUT = join(ROOT, 'apps/console/constants/assist-docs-index.generated.ts')

// Same exclusions as generate-docs-help.mjs: chrome / staff-internal routes.
// `staff-console` additionally excluded — customer assist must never cite
// staff-only surfaces.
const EXCLUDE = [/^operations\//, /^staff-console\//, /^intro$/, /^whats-new$/]

/** Max characters of section text kept per entry — retrieval context, not a
 * full mirror; keeps the generated module a bounded size. */
const SECTION_TEXT_CAP = 1800

/** Docusaurus/github-slugger heading slug (matches generate-docs-help.mjs). */
function slugify(heading) {
  return heading
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s-]/gu, '')
    .replace(/ /g, '-')
}

function stripQuotes(value) {
  return value?.replace(/^["']|["']$/g, '')
}

/**
 * Markdown → plain text: code fences and HTML dropped, images gone, links
 * reduced to their label, emphasis / inline-code / heading / admonition
 * markers stripped, HORIZONTAL whitespace collapsed — and LINE BREAKS KEPT.
 *
 * ⚠️ Keeping the newlines is the whole point of this function's second life
 * (AGL-2486). It used to end `.replace(/\s+/g, ' ')`, flattening every
 * section to a single line, which was harmless for as long as this text only
 * ever went into a model's prompt: a model reads a run-on list fine.
 *
 * Retrieval deflection made the same text HUMAN-facing — it is quoted
 * verbatim into the Assist panel — and the flattening showed up immediately
 * as three bullets running together inside one paragraph. The panel renders
 * under `whiteSpace: 'pre-wrap'`, so a newline in the source is a line break
 * on screen; there was simply no newline left to render.
 *
 * The fix belongs HERE rather than in the composer, and that is the load-
 * bearing part. A deflected answer must be a verbatim prefix of `text`, so
 * re-inflating structure downstream would mean editing the quote in transit
 * and forfeiting exactly the property the deflection guard asserts. Making
 * the SOURCE carry the structure keeps the quote verbatim and improves the
 * model's grounding context in the same change.
 *
 * Costs nothing against `SECTION_TEXT_CAP`: a newline replaces a space one
 * for one, so no section truncates at a different point than before.
 *
 * Heading markers (`###`) and Docusaurus admonition fences (`:::info`) are
 * stripped for the same reason the emphasis markers already were — they are
 * markup, not content, and they reach the reader as punctuation. The heading
 * TEXT is kept; only the marker goes.
 */
function plainText(markdown) {
  return markdown
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/<[^>\n]{1,120}>/g, ' ')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/[`*_~]/g, '')
    // Table rule rows (`| --- | --- |`) carry no content — drop the LINE, not
    // just its characters, or the table gains a blank row.
    .replace(/^[ \t]*[|:\- \t]*[|:-]{3,}[|:\- \t]*$/gm, '')
    // Heading markers and admonition fences: markup, not content.
    .replace(/^[ \t]*#{1,6}[ \t]+/gm, '')
    .replace(/^[ \t]*:::[ \t]*\w*[ \t]*/gm, '')
    // Horizontal whitespace only. Leading indentation goes with it: a quote
    // is not the place to reproduce list nesting, and ragged indents read as
    // a rendering fault.
    .replace(/[ \t]+/g, ' ')
    .replace(/^ | $/gm, '')
    // Unwrap BEFORE the blank lines go, never after: a blank line is the only
    // evidence left of where one paragraph ends and the next begins, and
    // collapsing first destroys it — which silently glues a heading onto the
    // step above it and a trailing paragraph onto the last bullet.
    .split('\n')
    .reduce(unwrapWrappedProse, [])
    // Now the blank lines have done their job. Dropping them leaves a stack
    // of lines rather than a page of gaps, and keeps the character cost at
    // parity with the old single-space flattening.
    .filter((line) => line !== '')
    .join('\n')
    .trim()
}

/** A line that opens a new block: a bullet, a numbered step, a table row. */
const BLOCK_START = /^([-*+>|]|\d+[.)]\s)/

/**
 * Rejoin a line onto the previous one when it is a CONTINUATION rather than a
 * new block — the second half of keeping structure (AGL-2486).
 *
 * Preserving every newline is not the same as preserving structure, and the
 * difference is visible the moment a human reads the result. The docs are
 * hard-wrapped at about 95 columns for the benefit of the people editing
 * them, so a paragraph arrives as five lines that mean one. Rendered under
 * `whiteSpace: 'pre-wrap'` those authoring wraps become real line breaks and
 * the quote comes out ragged — mid-sentence breaks in the middle of prose,
 * which reads as a rendering fault rather than as a quote.
 *
 * So a line joins the one above it unless it OPENS something: a bullet, a
 * numbered step, a table row, a block quote, or a paragraph break. A wrapped
 * list item therefore folds back into its bullet, which is the case that
 * makes a naive "join everything" and a naive "join nothing" both wrong.
 */
function unwrapWrappedProse(lines, line) {
  const previous = lines[lines.length - 1]
  if (lines.length && previous && line && !BLOCK_START.test(line)) {
    lines[lines.length - 1] = `${previous} ${line}`
    return lines
  }
  lines.push(line)
  return lines
}

/** One markdown file → array of section entries, or [] when unparseable. */
function readDocSections(absPath, urlPath) {
  const source = readFileSync(absPath, 'utf8')
  const fm = source.match(/^---\n([\s\S]*?)\n---/)
  if (!fm) return []
  const title = stripQuotes(fm[1].match(/^title:\s*(.+)$/m)?.[1])
  if (!title) return []
  const body = source.slice(fm[0].length)

  // Split the body on H2 headings; the run before the first H2 is the intro.
  const entries = []
  const parts = body.split(/^##\s+(.+?)\s*$/m)
  const intro = plainText(parts[0])
  if (intro) {
    entries.push({
      path: urlPath,
      title,
      heading: '',
      anchor: '',
      text: intro.slice(0, SECTION_TEXT_CAP),
    })
  }
  for (let i = 1; i < parts.length; i += 2) {
    const rawHeading = parts[i]
    const explicit = rawHeading.match(/\{#([^}]+)\}\s*$/)
    const heading = rawHeading.replace(/\{#[^}]+\}\s*$/, '').trim()
    const slug = explicit ? explicit[1] : slugify(heading)
    const text = plainText(parts[i + 1] ?? '')
    if (!text && !heading) continue
    entries.push({
      path: urlPath,
      title,
      heading,
      anchor: slug ? `#${slug}` : '',
      text: text.slice(0, SECTION_TEXT_CAP),
    })
  }
  return entries
}

function collectSections() {
  const sections = []
  const walk = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name)
      if (entry.isDirectory()) {
        walk(full)
      } else if (entry.name.endsWith('.md') && !entry.name.startsWith('_')) {
        const rel = full.slice(DOCS_ROOT.length + 1).replace(/\.md$/, '')
        if (EXCLUDE.some((re) => re.test(rel))) continue
        sections.push(...readDocSections(full, `/${rel}`))
      }
    }
  }
  walk(DOCS_ROOT)
  // Stable order: path, then document order is already preserved per file —
  // sort by path only, stably, so regeneration diffs stay minimal.
  return sections.sort((a, b) => a.path.localeCompare(b.path))
}

const LICENSE = `/**
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
 */`

const GENERATED_NOTE = `// GENERATED FILE — do not edit. Regenerate with:
//   node tools/scripts/generate-assist-docs-index.mjs
// Source of truth: apps/docs/docs content sections (AGL-1860).
// SERVER-ONLY: imported by the assist API route; never ship client-side.`

function tsString(value) {
  const escaped = value
    .replace(/\\/g, '\\\\')
    .replace(/'/g, "\\'")
    // ⚠️ A raw newline inside a single-quoted JS string is a SYNTAX ERROR, so
    // this escape is what makes the line-preserving `plainText` above emit a
    // file that parses at all (AGL-2486). Before it, sections were flattened
    // upstream and no newline ever reached here.
    .replace(/\r?\n/g, '\\n')
  return `'${escaped}'`
}

function emit(sections) {
  const rows = sections
    .map(
      (s) =>
        `  { path: ${tsString(s.path)}, title: ${tsString(s.title)}, heading: ${tsString(s.heading)}, anchor: ${tsString(s.anchor)}, text: ${tsString(s.text)} },`,
    )
    .join('\n')
  return `${LICENSE}
${GENERATED_NOTE}

export interface AssistDocsSection {
  /** Docs-site path, e.g. \`/building-sites/besigner/overview\`. */
  path: string
  /** Docs page title. */
  title: string
  /** H2 section heading ('' for the page intro before the first H2). */
  heading: string
  /** Heading anchor including '#', or '' for the page intro. */
  anchor: string
  /** Plain-text section content, capped for retrieval context. */
  text: string
}

export const ASSIST_DOCS_INDEX: readonly AssistDocsSection[] = [
${rows}
]
`
}

const sections = collectSections()
const content = emit(sections)
const check = process.argv.includes('--check')
const current = (() => {
  try {
    return readFileSync(OUT, 'utf8')
  } catch {
    return null
  }
})()

if (current === content) {
  console.log(`assist docs index up to date (${sections.length} sections)`)
} else if (check) {
  console.error(
    `STALE  ${OUT.slice(ROOT.length + 1)}\n\nThe assist docs index is out of date with apps/docs.\nRun: node tools/scripts/generate-assist-docs-index.mjs`,
  )
  process.exit(1)
} else {
  writeFileSync(OUT, content)
  console.log(
    `wrote  ${OUT.slice(ROOT.length + 1)} (${sections.length} sections)`,
  )
}

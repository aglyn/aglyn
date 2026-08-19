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

import { readdirSync, readFileSync } from 'node:fs'
import { join, relative } from 'node:path'

/**
 * Coverage guard for the contextual help system (AGL-605, widened by
 * AGL-2130). Keeps "help everywhere applicable" (AGL-599..601) durable: a new
 * feature page or card that ships without a `help` affordance fails here
 * unless it is explicitly listed as an intentional exception below.
 *
 * ## What AGL-2130 changed, and why the old number was misleading
 *
 * The card check used to ask whether `/\bhelp=/` appeared ANYWHERE in a file
 * that mentions `CardDisplay`. One `help=` in a 900-line page therefore
 * satisfied it for all twelve cards in that page, and the guard reported 89 of
 * 91 files covered — about 98%.
 *
 * Counted per CARD instead, the same tree had **34 headered cards with no
 * help**, across 18 files that the file-level check passed. The two most
 * telling were not obscure: `org-publish-panel` and `staff-user-erase-card`
 * each render the SAME card twice, once working and once refused — and it was
 * the refused branch, the one a reader reaches precisely because they do not
 * have what it takes, that carried no explanation. A file-level check can
 * never see that, because the other branch satisfies it.
 *
 * So the unit is now the card, not the file. Exemptions are per card
 * (`path#header`), each with a reason, each reaped when it stops being needed.
 *
 * ## What this guard still cannot see, deliberately
 *
 * `apps/console/app/(editor)` renders neither `DashboardLayout` nor
 * `CardDisplay` — the besigner, theme editor and preview mount a canvas. Their
 * help is a separate mechanism (`besignerDocsUrl` over its own generated
 * subset in `libs/besigner/feature/designer`), so counting them here would
 * report a hole that is not one. They are guarded on their own side; see
 * `apps/console/specs/besigner-docs-topics.spec.ts`.
 */

const REPO_ROOT = join(__dirname, '../../..')
const CONSOLE_ROOT = join(REPO_ROOT, 'apps/console')

/**
 * Files intentionally exempt from the help requirement. Each entry is a
 * repo-relative path with a reason — the list doubles as the record of
 * deliberate non-help surfaces. Keep reasons specific; if you add a file
 * here, you are asserting help genuinely does not apply.
 */
const EXCEPTIONS: Record<string, string> = {
  'apps/console/components/card-display-form-template.tsx':
    'Infrastructure wrapper — forwards schema-level help via CardDisplayProps, has no header of its own.',
  'apps/console/app/(app)/(home)/page.tsx':
    'Org jump page — navigational workspace picker, not a documented feature surface.',
}

/**
 * Per-CARD exemptions (AGL-2130), keyed `<repo path>#<header text>`. A whole
 * file in `EXCEPTIONS` above says "help does not apply to this surface"; an
 * entry here says "help does not apply to this one card on a surface that
 * otherwise has it".
 *
 * The bar is higher than it looks. A card is exempt when it carries no claim a
 * reader could need explained — a navigation rail, a repeat of a card already
 * explained beside it — and NOT merely because writing the sentence is work.
 * Every entry is re-checked below: one whose card has gained help, or whose
 * header has been renamed away, fails rather than lingering.
 */
const CARD_EXCEPTIONS: Record<string, string> = {
  'apps/console/app/(app)/[orgSlug]/hosts/[host]/admin/page.tsx#"Navigation"':
    'A vertical TabList — the page\'s own navigation rail, not a feature. Its two tabs (Plugins, Danger zone) each open a card that carries its own help, so a help icon here would explain the act of clicking a tab.',
}

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules') continue
      walk(full, out)
    } else if (/\.tsx$/.test(entry.name) && !/\.spec\.tsx$/.test(entry.name)) {
      out.push(full)
    }
  }
  return out
}

function repoPath(abs: string): string {
  return relative(REPO_ROOT, abs)
}

interface Card {
  /** The raw `header=` expression, verbatim — the exemption key. */
  header: string
  hasHeader: boolean
  hasHelp: boolean
  line: number
}

/**
 * Every `<CardDisplay …>` opening tag in a source file.
 *
 * Brace-aware rather than a regex to the first `>`: half the headers in this
 * app are expressions (`header={`Review — v${version}`}`), and a naive scan
 * stops inside them and reports a card with no header at all. Getting this
 * wrong under-reports, which is the direction that makes a guard useless.
 */
function headerKey(tag: string): string {
  const at = /\bheader=/.exec(tag)
  if (!at) return ''
  let cursor = at.index + at[0].length
  if (tag[cursor] === '"' || tag[cursor] === "'") {
    const quote = tag[cursor]
    const end = tag.indexOf(quote, cursor + 1)
    return tag.slice(cursor, end < 0 ? undefined : end + 1)
  }
  if (tag[cursor] !== '{') return ''
  // Balanced, so a header holding a template literal or JSX (several do) is
  // captured whole rather than truncated at its first inner `}` — a truncated
  // key is a key that silently stops matching its exemption.
  let depth = 0
  const start = cursor
  while (cursor < tag.length) {
    if (tag[cursor] === '{') depth += 1
    else if (tag[cursor] === '}') {
      depth -= 1
      if (depth === 0) break
    }
    cursor += 1
  }
  return tag.slice(start, cursor + 1).replace(/\s+/g, ' ').trim()
}

function cardsIn(source: string): Card[] {
  const cards: Card[] = []
  let index = source.indexOf('<CardDisplay')
  while (index >= 0) {
    let depth = 0
    let cursor = index
    while (cursor < source.length) {
      const char = source[cursor]
      if (char === '{') depth += 1
      else if (char === '}') depth -= 1
      else if (char === '>' && depth === 0) break
      cursor += 1
    }
    const tag = source.slice(index, cursor)
    cards.push({
      header: headerKey(tag),
      hasHeader: /\bheader=/.test(tag),
      hasHelp: /\bhelp=/.test(tag),
      line: source.slice(0, index).split('\n').length,
    })
    index = source.indexOf('<CardDisplay', index + 1)
  }
  return cards
}

describe('contextual help coverage', () => {
  const files = [
    ...walk(join(CONSOLE_ROOT, 'app')),
    ...walk(join(CONSOLE_ROOT, 'components')),
  ]

  it('every DashboardLayout page has a help affordance', () => {
    const missing: string[] = []
    for (const file of files) {
      if (!file.endsWith('page.tsx')) continue
      const source = readFileSync(file, 'utf8')
      if (!/\bDashboardLayout\b/.test(source)) continue
      if (/\bhelp=/.test(source)) continue
      const rel = repoPath(file)
      if (rel in EXCEPTIONS) continue
      missing.push(rel)
    }
    if (missing.length) {
      throw new Error(
        `These DashboardLayout pages have no help= prop. Add help="<topic>" (see docs/DOCS_HELP_REGISTRY.md) or add the file to EXCEPTIONS with a reason:\n  ${missing.join('\n  ')}`,
      )
    }
  })

  it('every CardDisplay with a header has a help affordance', () => {
    const missing: string[] = []
    let checked = 0
    for (const file of files) {
      const rel = repoPath(file)
      if (rel in EXCEPTIONS) continue
      const source = readFileSync(file, 'utf8')
      for (const card of cardsIn(source)) {
        // Only cards that render a title can carry a header help icon.
        if (!card.hasHeader) continue
        checked += 1
        if (card.hasHelp) continue
        const key = `${rel}#${card.header}`
        if (key in CARD_EXCEPTIONS) continue
        missing.push(`${rel}:${card.line}  header={${card.header}}`)
      }
    }
    // Anti-vacuity: the card reader is a brace-matching scan over source, so a
    // rename of CardDisplay or a broken matcher turns "nothing is missing"
    // into the answer for an empty population. Asserted BEFORE the finding, so
    // a rotted reader fails as a rotted reader rather than as a pass.
    expect(checked).toBeGreaterThan(50)
    if (missing.length) {
      throw new Error(
        `These CardDisplays render a header but pass no help=. Add help={docsHelp('<topic>')} (see docs/DOCS_HELP_REGISTRY.md), or add "<path>#<header>" to CARD_EXCEPTIONS with a reason:\n  ${missing.join('\n  ')}`,
      )
    }
  })

  it('every CARD_EXCEPTIONS entry is still real and still needed', () => {
    for (const [key, reason] of Object.entries(CARD_EXCEPTIONS)) {
      expect(reason.length).toBeGreaterThan(20)
      const [rel, header] = key.split('#')
      let source: string
      try {
        source = readFileSync(join(REPO_ROOT, rel), 'utf8')
      } catch {
        throw new Error(
          `CARD_EXCEPTIONS names ${rel}, which no longer exists. Remove the stale entry.`,
        )
      }
      const match = cardsIn(source).find((card) => card.header === header)
      if (!match) {
        throw new Error(
          `CARD_EXCEPTIONS names ${key}, but no CardDisplay in that file has that header any more. Remove or re-point the entry — a stale key exempts nothing and hides the next card that needs help.`,
        )
      }
      if (match.hasHelp) {
        throw new Error(
          `CARD_EXCEPTIONS names ${key}, but that card now passes help=. Remove the stale exemption.`,
        )
      }
    }
  })

  it('every EXCEPTIONS entry still exists and still needs the exemption', () => {
    for (const [rel, reason] of Object.entries(EXCEPTIONS)) {
      expect(reason.length).toBeGreaterThan(10)
      let source: string
      try {
        source = readFileSync(join(REPO_ROOT, rel), 'utf8')
      } catch {
        throw new Error(
          `EXCEPTIONS lists ${rel}, which no longer exists. Remove the stale entry.`,
        )
      }
      // A file that now passes help= no longer needs to be exempted.
      if (/\bhelp=/.test(source)) {
        throw new Error(
          `EXCEPTIONS lists ${rel}, but it now passes help= — remove the stale exemption.`,
        )
      }
    }
  })
})

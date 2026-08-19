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

import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { PLUGIN_DOCS, PLUGIN_DOCS_ANCHORS } from './docs-help'

/**
 * Contextual help on the first-party plugin consoles (AGL-2213).
 *
 * `apps/console/specs/help-coverage.spec.ts` walks `apps/console/app` and
 * `apps/console/components`. Products, POS, Bookings, Emails, Data, Contacts,
 * Inbox, Logic, Marketing, Redirects, Workflows, Events and the Marketplace
 * all live in `libs/plugins/*`, which that walk never enters — so it reported
 * full coverage over a tree in which **55 of 55 headered cards had no help
 * affordance at all**.
 *
 * That is the AGL-1074 / AGL-2130 lesson a third time. AGL-1074 was one route
 * standing in for twelve surfaces; AGL-2130 was one file standing in for
 * twelve cards; this is a whole population outside the guard's walk. All three
 * present identically: a green check, because it is looking somewhere else.
 *
 * So this guard's population is the one the other cannot reach, and it checks
 * three different things, because presence alone is the weakest of them:
 *
 *  - every headered card carries help;
 *  - every topic and anchor named actually resolves — an anchor is typed at
 *    the call site, but a `header`-driven card can default one, and a topic
 *    reaching the registry through a variable is not type-checked here;
 *  - every entry in the generated `PLUGIN_TOPICS` subset has a real call site,
 *    which is the rule `BESIGNER_TOPICS` states and the reason eight of its
 *    nine topics were removed: a generated, type-checked promise of a help
 *    link that no surface in the product could follow.
 */

const REPO_ROOT = resolve(__dirname, '../../../../..')

/**
 * Enumerated from `git ls-files`, never a filesystem walk (AGL-2116). A walk
 * sweeps `dist/` and `.next/`, which hold compiled copies of these very
 * components — so the guard would measure whether the reader had built rather
 * than what the repo contains.
 */
function pluginSources(): string[] {
  return execFileSync('git', ['ls-files', 'libs/plugins'], {
    cwd: REPO_ROOT,
    encoding: 'utf8',
  })
    .split('\n')
    .filter((file) => file.endsWith('.tsx') && !file.includes('.spec.'))
}

interface Card {
  file: string
  header: string
  hasHelp: boolean
  line: number
}

/**
 * Every `<CardDisplay …>` opening tag, brace-aware.
 *
 * Scanning to the first `>` stops inside `header={`Products (${n})`}`, which
 * several of these cards use — and a card read as having no header is a card
 * this guard silently stops requiring help for. Under-reporting is the
 * direction that makes a guard useless, so the scan matches braces.
 */
function cardsIn(file: string, source: string): Card[] {
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
    if (/\bheader=/.test(tag)) {
      cards.push({
        file,
        header: (/\bheader=(\{[\s\S]*?\}|"[^"]*"|'[^']*')/.exec(tag)?.[1] ?? '')
          .replace(/\s+/g, ' ')
          .trim(),
        hasHelp: /\bhelp=/.test(tag),
        line: source.slice(0, index).split('\n').length,
      })
    }
    index = source.indexOf('<CardDisplay', index + 1)
  }
  return cards
}

const sources = pluginSources().map((file) => ({
  file,
  source: readFileSync(join(REPO_ROOT, file), 'utf8'),
}))

const cards = sources.flatMap(({ file, source }) => cardsIn(file, source))

/**
 * Every `pluginDocsHelp('topic', …)` call in libs/plugins.
 *
 * The argument list is read by matching parentheses rather than by a regex to
 * the first `)`. A regex written to the multi-line shape silently skips every
 * single-line call and vice versa — and a call this scan does not see is a
 * topic that reads as orphaned and an anchor that is never checked, both of
 * which fail in the direction that looks like a finding rather than a bug in
 * the reader.
 */
const calls = sources.flatMap(({ file, source }) => {
  const found: Array<{ file: string; topic: string; anchor: string }> = []
  for (const match of source.matchAll(
    /pluginDocsHelp\(\s*'([A-Za-z0-9]+)'/g,
  )) {
    let depth = 0
    let cursor = match.index ?? 0
    while (cursor < source.length) {
      const char = source[cursor]
      if (char === '(') depth += 1
      else if (char === ')') {
        depth -= 1
        if (depth === 0) break
      }
      cursor += 1
    }
    const args = source.slice(match.index ?? 0, cursor)
    found.push({
      file,
      topic: match[1],
      anchor: /anchor:\s*'(#[^']*)'/.exec(args)?.[1] ?? '',
    })
  }
  return found
})

describe('plugin console card help (AGL-2213)', () => {
  // Anti-vacuity, asserted before any finding: "nothing is missing" is also
  // the answer for an empty population, so a renamed CardDisplay, a moved
  // directory or a broken tag reader has to fail as itself rather than pass.
  it('reads a real population of plugin cards and help calls', () => {
    expect(sources.length).toBeGreaterThan(50)
    expect(cards.length).toBeGreaterThan(45)
    expect(calls.length).toBeGreaterThan(45)
  })

  it('every headered card in libs/plugins carries a help affordance', () => {
    const missing = cards
      .filter((card) => !card.hasHelp)
      .map((card) => `${card.file}:${card.line}  header=${card.header}`)
    if (missing.length) {
      throw new Error(
        `These plugin console cards render a header and pass no help=. The console's own coverage guard cannot see this tree, so nothing else will tell you.\nAdd help={pluginDocsHelp('<topic>', { anchor })} — see libs/aglyn/src/lib/app-utils/docs-help.ts:\n  ${missing.join('\n  ')}`,
      )
    }
  })

  it('every topic and anchor a plugin card names actually resolves', () => {
    const bad: string[] = []
    for (const call of calls) {
      if (!(call.topic in PLUGIN_DOCS)) {
        bad.push(
          `${call.file}: topic '${call.topic}' is not in PLUGIN_DOCS — add it to PLUGIN_TOPICS in tools/scripts/generate-docs-help.mjs and regenerate`,
        )
        continue
      }
      if (!call.anchor) continue
      const anchors: readonly string[] =
        (PLUGIN_DOCS_ANCHORS as Record<string, readonly string[]>)[
          call.topic
        ] ?? []
      if (!anchors.includes(call.anchor)) {
        bad.push(
          `${call.file}: '${call.topic}' has no heading ${call.anchor} — the reader lands at the top of the page believing they are in the right place`,
        )
      }
    }
    if (bad.length) {
      throw new Error(
        `A plugin card's help link points somewhere that does not exist.\nRegenerate after a docs edit (node tools/scripts/generate-docs-help.mjs):\n  ${bad.join('\n  ')}`,
      )
    }
  })

  it('every generated plugin topic has a real call site', () => {
    const used = new Set(calls.map((call) => call.topic))
    const orphans = Object.keys(PLUGIN_DOCS).filter(
      (topic) => !used.has(topic),
    )
    if (orphans.length) {
      throw new Error(
        `PLUGIN_TOPICS carries topics no plugin surface links to: ${orphans.join(', ')}.\nA topic lands there in the same change that ships the surface linking to it, never ahead of it — the BESIGNER_TOPICS rule, which was written after eight of its nine topics turned out to be a generated promise of a link no surface could follow.\nRemove them from tools/scripts/generate-docs-help.mjs and regenerate.`,
      )
    }
  })
})

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
import { join, relative } from 'node:path'
import { PLUGIN_DOCS_ANCHORS } from '@aglyn/aglyn'
import { DOCS_HELP_ANCHORS } from '../constants/docs-links'

/**
 * A help tooltip that renames itself must deep-link (AGL-1918).
 *
 * `docsHelp(topic)` and `pluginDocsHelp(topic)` default the tooltip's title
 * and excerpt to the docs PAGE's own — so a card that takes the default is
 * making a page-level claim, and landing the reader at the top of that page
 * is exactly right.
 *
 * Overriding `title` is the opposite claim. It says "this control is its own
 * subject", and the excerpt beside it then describes that subject. With no
 * `anchor`, the link still opens the top of the page — and there is nothing
 * on the page about the subject the tooltip just named, because a subject
 * with a section would have had an anchor to point at.
 *
 * That is not hypothetical. Three commerce console cards shipped in
 * v1.0.0-beta.3 in exactly this state: **Gift cards** (AGL-2226), **Stock
 * movements** (AGL-2341) and **Recovery & alerts** (AGL-2227) each promised a
 * tooltip's worth of documentation and opened a Commerce overview that never
 * used the words "gift card", "stock movement" or "back in stock". Every
 * other one of the 47 plugin help calls carried an anchor, so the pattern
 * that distinguishes them is available to a guard.
 *
 * Presence checks cannot see this — `help=` is present, the topic exists, and
 * the destination is a real page. The same family as AGL-1074 and AGL-2200,
 * one level in: the affordance is there and the destination resolves, but it
 * resolves to prose about something else.
 *
 * Source scan rather than an import: these calls live in module scope across
 * `libs/plugins` and the console's components, and importing them would drag
 * the whole UI into a spec that wants to read a declaration.
 */

const REPO_ROOT = join(__dirname, '../../..')

/**
 * Calls whose overridden title is deliberately anchorless, each with the
 * reason. An entry is a claim that the docs page has no heading for the
 * subject AND that this is correct — it is not a place to park a docs gap.
 */
const ANCHORLESS_BY_DESIGN: Record<string, string> = {}

interface HelpCall {
  file: string
  helper: 'docsHelp' | 'pluginDocsHelp'
  topic: string
  title: string | null
  anchor: string | null
}

/** Files that call either helper, from git so an ignored build output cannot
 * enter the population. */
function sourceFiles(): string[] {
  const listed = execFileSync(
    'git',
    [
      'grep',
      '-l',
      '-E',
      // Case-INSENSITIVE on the leading d, because `pluginDocsHelp` spells it
      // with a capital. A `docsHelp\\(` pattern here matches not one call in
      // libs/plugins — the exact half this guard was written for — and reports
      // a clean scan. Verified by the population assertion below.
      '[Dd]ocsHelp\\(',
      '--',
      'apps/console',
      'libs',
    ],
    { cwd: REPO_ROOT, encoding: 'utf8' },
  )
  return listed
    .split('\n')
    .filter((line) => /\.tsx?$/.test(line) && !line.endsWith('.spec.ts') && !line.endsWith('.spec.tsx'))
    .map((line) => join(REPO_ROOT, line))
}

/**
 * Every `docsHelp('topic', { … })` / `pluginDocsHelp('topic', { … })` call
 * with an overrides object.
 *
 * The body is read to the closing brace of the object literal at depth 1 —
 * scanning to the first `}` would stop inside a nested `{ … }` and report an
 * override object that has neither title nor anchor, which under-reports.
 */
function parse(source: string, file: string): HelpCall[] {
  const calls: HelpCall[] = []
  const opener = /\b(pluginDocsHelp|docsHelp)\(\s*'([A-Za-z0-9]+)'\s*,\s*\{/g
  let match: RegExpExecArray | null
  while ((match = opener.exec(source)) !== null) {
    let depth = 1
    let cursor = opener.lastIndex
    while (cursor < source.length && depth > 0) {
      if (source[cursor] === '{') depth += 1
      else if (source[cursor] === '}') depth -= 1
      cursor += 1
    }
    const body = source.slice(opener.lastIndex, cursor - 1)
    calls.push({
      file,
      helper: match[1] as HelpCall['helper'],
      topic: match[2],
      title: /(?:^|[\s,{])title:\s*'((?:[^'\\]|\\.)*)'/.exec(body)?.[1] ?? null,
      anchor: /(?:^|[\s,{])anchor:\s*'(#[^']*)'/.exec(body)?.[1] ?? null,
    })
  }
  return calls
}

const calls: HelpCall[] = sourceFiles().flatMap((file) =>
  parse(readFileSync(file, 'utf8'), relative(REPO_ROOT, file)),
)

const titled = calls.filter((call) => call.title !== null)

describe('a help tooltip that renames itself deep-links (AGL-1918)', () => {
  // Anti-vacuity, first: every finding below is "nothing was wrong" on an
  // empty scan, so a renamed helper or a broken brace reader has to fail as
  // itself rather than as a pass.
  it('reads a real population of help calls', () => {
    expect(calls.length).toBeGreaterThan(150)
    expect(calls.filter((call) => call.anchor).length).toBeGreaterThan(100)
    // Renaming a tooltip is rare and deliberate — seven calls do it at the
    // time of writing, three of which were the AGL-1918 finding. The floor is
    // low on purpose; what it guards against is the scan matching nothing.
    expect(titled.length).toBeGreaterThanOrEqual(5)
    expect(
      calls.some((call) => call.helper === 'pluginDocsHelp'),
    ).toBe(true)
    expect(calls.some((call) => call.helper === 'docsHelp')).toBe(true)
  })

  it('every renamed tooltip names a heading to open', () => {
    const anchorless = titled
      .filter((call) => !call.anchor)
      .map((call) => `${call.file} — '${call.topic}' as “${call.title}”`)
      .filter((entry) => !(entry in ANCHORLESS_BY_DESIGN))
    if (anchorless.length) {
      throw new Error(
        'These help tooltips rename themselves after one control but open the ' +
          'TOP of the docs page, which is a page about something broader. Give ' +
          "the subject a heading in apps/docs, regenerate (node tools/scripts/generate-docs-help.mjs), and pass anchor: '#that-heading' — or add the entry to " +
          `ANCHORLESS_BY_DESIGN with the reason the page has no section for it:\n  ${anchorless.join('\n  ')}`,
      )
    }
  })

  it('every anchor names a heading the topic really has', () => {
    // The typed `DocsHelpAnchor<K>` already makes a bad anchor a compile
    // error. This asserts it independently of tsc, because a `// @ts-expect-error`
    // or an `any`-typed topic silently removes that guarantee.
    const registries: Record<string, Record<string, readonly string[]>> = {
      docsHelp: DOCS_HELP_ANCHORS as unknown as Record<string, readonly string[]>,
      pluginDocsHelp: PLUGIN_DOCS_ANCHORS as unknown as Record<
        string,
        readonly string[]
      >,
    }
    const bad: string[] = []
    for (const call of calls) {
      if (!call.anchor) continue
      const anchors = registries[call.helper][call.topic] ?? []
      if (!anchors.includes(call.anchor)) {
        bad.push(`${call.file} — '${call.topic}' has no heading ${call.anchor}`)
      }
    }
    if (bad.length) {
      throw new Error(
        `A help link points at a docs heading that does not exist, so the reader lands at the top of a long page believing they are in the right place.\nRegenerate after a docs edit (node tools/scripts/generate-docs-help.mjs):\n  ${bad.join('\n  ')}`,
      )
    }
  })

  it('every ANCHORLESS_BY_DESIGN entry is still a real anchorless call', () => {
    for (const [entry, reason] of Object.entries(ANCHORLESS_BY_DESIGN)) {
      expect(reason.length).toBeGreaterThan(20)
      const live = titled.some(
        (call) =>
          !call.anchor &&
          `${call.file} — '${call.topic}' as “${call.title}”` === entry,
      )
      if (!live) {
        throw new Error(
          `ANCHORLESS_BY_DESIGN names ${entry}, which no longer matches an anchorless call. Remove the stale entry — it exempts nothing and hides the next one.`,
        )
      }
    }
  })
})

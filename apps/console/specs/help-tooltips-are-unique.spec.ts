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
import { join } from 'node:path'
import { PLUGIN_DOCS, PLUGIN_DOCS_SECTIONS } from '@aglyn/aglyn'
import {
  DOCS_HELP_EXCERPTS,
  DOCS_HELP_SECTION_EXCERPTS,
} from '../constants/docs-help-excerpts.generated'
import {
  DOCS_HELP_SECTION_TITLES,
  DOCS_HELP_TOPICS,
} from '../constants/docs-help.generated'

/**
 * Every help tooltip says something of its own (AGL-3707).
 *
 * The All Sites page's `?` read "The console tour — Where things live in the
 * Aglyn console app bar and navigation", and so did the notification
 * settings, a site's dashboard and a host's activity card. An `anchor` moved
 * only the link: the tooltip printed the docs PAGE's title and description, so
 * the 21 cards deep-linking 21 sections of the email campaigns page shared one
 * blurb between them. The generator now carries each linked heading and its
 * opening sentence, and this guard holds the result: no two help call sites in
 * different files may resolve to the same title and excerpt.
 *
 * Two call sites in ONE file are allowed to match — that is a card drawn in
 * its loading, unentitled and loaded states, one surface the reader sees once.
 *
 * Source scan rather than a render, for the reason
 * `help-tooltip-title-needs-an-anchor.spec.ts` gives: the calls sit in module
 * scope across `libs/plugins` and the console, and mounting them would drag
 * in the whole UI to read a declaration.
 */

const REPO_ROOT = join(__dirname, '../../..')

/**
 * Cross-file matches that are one surface, each with the reason. Not a place
 * to park two cards that need their own words.
 */
const SAME_SURFACE: Record<string, string> = {
  'apps/console/app/(app)/[orgSlug]/billing/(sections)/invoices/page.tsx + apps/console/app/(app)/[orgSlug]/billing/(sections)/page.tsx':
    'The Outstanding card is drawn on the Billing overview and again on Invoices on purpose, so an unpaid invoice is settled wherever the owner looks.',
  'libs/plugins/crm/src/lib/components/company-detail-page.tsx + libs/plugins/crm/src/lib/components/company-properties-card.tsx':
    "The detail page draws the record header while the company loads; the properties card draws the same header once it has.",
}

interface Tooltip {
  file: string
  line: number
  title: string
  excerpt: string
}

type Sections = Readonly<Record<string, string>>

function consoleTooltip(
  topic: string,
  anchor: string | null,
  title: string | null,
): [string, string] | null {
  const page = (DOCS_HELP_TOPICS as Record<string, { title: string }>)[topic]
  if (!page) return null
  const titles = (DOCS_HELP_SECTION_TITLES as Record<string, Sections>)[topic]
  const excerpts = (DOCS_HELP_SECTION_EXCERPTS as Record<string, Sections>)[
    topic
  ]
  return [
    title ?? (anchor && titles?.[anchor]) ?? page.title,
    (anchor && excerpts?.[anchor]) ??
      (DOCS_HELP_EXCERPTS as Record<string, string>)[topic],
  ]
}

function pluginTooltip(
  topic: string,
  anchor: string | null,
  title: string | null,
): [string, string] | null {
  const page = (
    PLUGIN_DOCS as Record<string, { title: string; excerpt: string }>
  )[topic]
  if (!page) return null
  const section = anchor
    ? (
        PLUGIN_DOCS_SECTIONS as Record<
          string,
          Readonly<Record<string, { title: string; excerpt: string }>>
        >
      )[topic]?.[anchor]
    : undefined
  return [title ?? section?.title ?? page.title, section?.excerpt ?? page.excerpt]
}

/** Comments blanked to spaces, so offsets — and line numbers — survive. */
function withoutComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, (block) => block.replace(/[^\n]/g, ' '))
    .replace(/(^|[^:])\/\/.*$/gm, (line, lead: string) =>
      lead + ' '.repeat(line.length - lead.length),
    )
}

/** The object literal opened just before `from`, read to its closing brace. */
function objectBody(source: string, from: number): [string, number] {
  let depth = 1
  let cursor = from
  while (cursor < source.length && depth > 0) {
    if (source[cursor] === '{') depth += 1
    else if (source[cursor] === '}') depth -= 1
    cursor += 1
  }
  return [source.slice(from, cursor - 1), cursor]
}

/**
 * An override's own words. A literal title is read; an excerpt makes the
 * tooltip the call's own sentence, so the call is compared by its literal
 * opening when there is one and skipped when the excerpt is computed.
 */
function overrides(body: string) {
  const title = /(?:^|[\s,{])title[:=]\s*\{?\s*(['"`])((?:(?!\1)[^\\]|\\.)*)\1/.exec(
    body,
  )?.[2]
  const anchor = /(?:^|[\s,{])anchor[:=]\s*\{?\s*['"](#[^'"]*)['"]/.exec(
    body,
  )?.[1]
  const excerptAt = /(?:^|[\s,{])excerpt[:=]/.exec(body)
  const excerpt = excerptAt
    ? (/^\s*\{?\s*(['"`])((?:(?!\1)[^\\]|\\.)*)\1/.exec(
        body.slice(excerptAt.index + excerptAt[0].length),
      )?.[2] ?? undefined)
    : null
  return { title: title ?? null, anchor: anchor ?? null, excerpt }
}

function scan(file: string): Tooltip[] {
  const source = withoutComments(readFileSync(join(REPO_ROOT, file), 'utf8'))
  const lineOf = (offset: number) => source.slice(0, offset).split('\n').length
  const found: Tooltip[] = []
  const add = (
    resolve: typeof consoleTooltip,
    topic: string,
    body: string,
    offset: number,
  ) => {
    const { title, anchor, excerpt } = overrides(body)
    // A computed excerpt is the call's own, and nothing here can read it.
    if (excerpt === undefined) return
    const resolved = resolve(topic, anchor, title)
    if (!resolved) return
    found.push({
      file,
      line: lineOf(offset),
      title: resolved[0],
      excerpt: excerpt ?? resolved[1],
    })
  }

  const call = /\b(pluginDocsHelp|docsHelp)\(\s*'([A-Za-z0-9]+)'\s*(,\s*\{)?/g
  for (const match of source.matchAll(call)) {
    const start = (match.index ?? 0) + match[0].length
    const [body, end] = match[3] ? objectBody(source, start) : ['', start]
    // `docsHelp(…).href` is a link, not a tooltip.
    if (/^\s*\)\s*\.href/.test(source.slice(end))) continue
    add(
      match[1] === 'pluginDocsHelp' ? pluginTooltip : consoleTooltip,
      match[2],
      body,
      match.index ?? 0,
    )
  }
  for (const match of source.matchAll(/help="([A-Za-z0-9]+)"/g)) {
    add(consoleTooltip, match[1], '', match.index ?? 0)
  }
  const target = /(?:help=\{\{|setHeaderHelp\(\{)\s*topic:\s*'([A-Za-z0-9]+)'/g
  for (const match of source.matchAll(target)) {
    const opened = source.lastIndexOf('{', (match.index ?? 0) + match[0].length)
    const [body] = objectBody(source, opened + 1)
    add(consoleTooltip, match[1], body, match.index ?? 0)
  }
  for (const match of source.matchAll(/<DocsHelpTip\b([^>]*?)>/g)) {
    const topic = /topic=["']([A-Za-z0-9]+)["']/.exec(match[1])?.[1]
    if (topic) add(consoleTooltip, topic, match[1], match.index ?? 0)
  }
  return found
}

const files = execFileSync(
  'git',
  ['grep', '-l', '-E', '[Dd]ocsHelp\\(|help=|DocsHelpTip|setHeaderHelp\\(', '--', 'apps/console', 'libs'],
  { cwd: REPO_ROOT, encoding: 'utf8' },
)
  .split('\n')
  .filter(
    (file) =>
      /\.tsx?$/.test(file) &&
      !/\.(spec|test)\.tsx?$/.test(file) &&
      !file.endsWith('.generated.ts'),
  )

const tooltips = files.flatMap(scan)

describe('every help tooltip says something of its own (AGL-3707)', () => {
  it('reads a real population of help tooltips', () => {
    // Every finding below is "nothing matched" on an empty scan.
    expect(tooltips.length).toBeGreaterThan(200)
    expect(tooltips.some((tip) => tip.file.startsWith('libs/plugins/'))).toBe(
      true,
    )
    expect(tooltips.some((tip) => tip.file.startsWith('apps/console/'))).toBe(
      true,
    )
  })

  it('an anchored tooltip prints its section, not its page', () => {
    // The All Sites page header — the AGL-3707 screenshot.
    const [title, excerpt] =
      consoleTooltip('consoleTour', '#the-sites-list', null) ?? []
    expect(title).toBe('The Sites list')
    expect(excerpt).not.toBe(DOCS_HELP_EXCERPTS.consoleTour)
  })

  it('no two surfaces share a tooltip', () => {
    const byText = new Map<string, Tooltip[]>()
    for (const tip of tooltips) {
      const key = `${tip.title}\n${tip.excerpt}`
      byText.set(key, [...(byText.get(key) ?? []), tip])
    }
    const shared: string[] = []
    for (const [text, tips] of byText) {
      const owners = [...new Set(tips.map((tip) => tip.file))].sort()
      if (owners.length < 2) continue
      if (owners.join(' + ') in SAME_SURFACE) continue
      shared.push(
        `“${text.split('\n')[0]}” — ${tips.map((tip) => `${tip.file}:${tip.line}`).join(', ')}`,
      )
    }
    if (shared.length) {
      throw new Error(
        'These help tooltips print the same title and text on different surfaces, so the ' +
          'reader learns nothing from the second one. Point each at the docs heading that ' +
          "explains THAT card (anchor: '#…' — its heading and opening sentence become the " +
          'tooltip), or give it a title and excerpt of its own:\n  ' +
          shared.join('\n  '),
      )
    }
  })

  it('every SAME_SURFACE entry is still a real match', () => {
    const owners = new Set(
      [...new Set(tooltips.map((tip) => `${tip.title}\n${tip.excerpt}`))].map(
        (text) =>
          [
            ...new Set(
              tooltips
                .filter((tip) => `${tip.title}\n${tip.excerpt}` === text)
                .map((tip) => tip.file),
            ),
          ]
            .sort()
            .join(' + '),
      ),
    )
    for (const [entry, reason] of Object.entries(SAME_SURFACE)) {
      expect(reason.length).toBeGreaterThan(20)
      expect(owners.has(entry)).toBe(true)
    }
  })
})

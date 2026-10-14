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

import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { PLUGIN_DOCS } from '@aglyn/aglyn'
import { PLUGIN_DOCS_SECTION_EXCERPTS } from '@aglyn/aglyn/app-utils/docs-help-sections.generated'
import {
  DOCS_HELP_SECTION_EXCERPTS,
} from '../constants/docs-help-excerpts.generated'
import { DOCS_HELP_TOPICS } from '../constants/docs-help.generated'

/**
 * An anchored tooltip quotes its own section (AGL-3778).
 *
 * The generator matched headings in the page with its front matter removed
 * and then cut each section out of the page WITH it, so every offset was short
 * by the front matter's length: each tooltip printed the tail of the section
 * before, starting mid-word ("Ign in and to allow access."). Nothing failed,
 * because the text was still unique.
 *
 * The property held here: every section excerpt opens with words that really
 * are on its page, in the same case, at the start of a word.
 */

const REPO_ROOT = join(__dirname, '../../..')
const DOCS_ROOT = join(REPO_ROOT, 'apps/docs/docs')

/** A docs page as the generator's plain text sees it: no markup, one line. */
function plainPage(path: string): string | null {
  const candidates = [`${path}.md`, `${path}.mdx`, `${path}/index.md`]
  const file = candidates
    .map((candidate) => join(DOCS_ROOT, candidate))
    .find((candidate) => existsSync(candidate))
  if (!file) return null
  return readFileSync(file, 'utf8')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/\*\*|__/g, '')
    .replace(/(^|[\s(])[*_]([^*_\s][^*_]*?)[*_](?=[\s.,;:!?)]|$)/gm, '$1$2')
    .replace(/`([^`]*)`/g, '$1')
    .replace(/<[^>]+>/g, '')
    .replace(/\s+/g, ' ')
}

/** The excerpt's opening words, which must appear on the page as written. */
function opening(excerpt: string): string {
  return excerpt.split(' ').slice(0, 4).join(' ').replace(/[.…]$/, '')
}

function misplaced(
  topics: Record<string, { readonly path: string }>,
  excerpts: Record<string, Record<string, string> | undefined>,
): string[] {
  const wrong: string[] = []
  for (const [topic, sections] of Object.entries(excerpts)) {
    const path = topics[topic]?.path
    if (!path || !sections) continue
    const page = plainPage(path)
    if (!page) continue
    for (const [anchor, excerpt] of Object.entries(sections)) {
      const words = opening(excerpt)
      // At the start of a word, in the page's own case. The generator
      // capitalizes an opener that starts on a lowercase `value`, so the
      // first letter may differ in case only.
      const pattern = new RegExp(
        `(^|[^\\p{L}\\p{N}])[${words[0].toUpperCase()}${words[0].toLowerCase()}]` +
          words.slice(1).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'),
        'u',
      )
      if (!pattern.test(page)) wrong.push(`${topic} ${anchor}: "${excerpt}"`)
    }
  }
  return wrong
}

describe('anchored help tooltips quote their own section (AGL-3778)', () => {
  it('plugin sections', () => {
    expect(
      misplaced(
        PLUGIN_DOCS as unknown as Record<string, { path: string }>,
        PLUGIN_DOCS_SECTION_EXCERPTS as unknown as Record<string, Record<string, string>>,
      ),
    ).toEqual([])
  })

  it('console sections', () => {
    expect(
      misplaced(
        DOCS_HELP_TOPICS as unknown as Record<string, { path: string }>,
        DOCS_HELP_SECTION_EXCERPTS as unknown as Record<string, Record<string, string>>,
      ),
    ).toEqual([])
  })

  /** And the example the bug report names. */
  it('opens the Discounts card tooltip on its own first sentence', () => {
    expect(
      (PLUGIN_DOCS_SECTION_EXCERPTS as Record<string, Record<string, string>>)
        .discountsAndCoupons['#add-a-discount'],
    ).toMatch(/^The Discounts card takes money off/)
  })
})

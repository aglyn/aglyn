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

import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import yaml from 'js-yaml'

/**
 * Every docs page's front matter is YAML that parses.
 *
 * ## The one that got through
 *
 * A search-oriented rewrite gave eight pages a `title` and a `description`
 * carrying their target query, and eight of those values held a colon:
 *
 * ```yaml
 * title: Aglyn AI: the AI website builder
 * ```
 *
 * In YAML a `: ` inside an unquoted scalar ends the key, so the block does not
 * parse and Docusaurus refuses to load the version at all. That is not a
 * degraded page — it is the whole site failing to build, and it reds `main`
 * for every commit behind it until someone fixes it.
 *
 * ## Why a spec rather than trusting the build
 *
 * The build DOES catch it, in the `production builds` job, several minutes in
 * and behind the app builds. This runs in the test job in milliseconds, and
 * names the file and the reason instead of printing "Error while parsing
 * Markdown front matter" once per page with no path attached — which is what
 * the build printed, eight times, for eight different files.
 *
 * ## Its sibling: braces in the body
 *
 * MDX parses `{` as the start of an expression, so a `{{token}}` in prose is
 * read as JavaScript and fails the same build. Inline code protects it — but
 * only while the code span stays on ONE line, because a span broken across a
 * newline leaves the braces on the second line outside it. That is a real
 * break this tree has taken; a fenced block is the safe way to show a pattern
 * that will not fit a line.
 */

const DOCS = join(__dirname, '..', 'docs')

function* markdownFiles(dir: string): Generator<string> {
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry)
    if (statSync(path).isDirectory()) yield* markdownFiles(path)
    else if (path.endsWith('.md') || path.endsWith('.mdx')) yield path
  }
}

/** The front matter block of a page, or `null` where it has none. */
function frontMatter(source: string): string | null {
  const match = /^---\n([\s\S]*?)\n---/.exec(source)
  return match ? match[1] : null
}

/**
 * Whether a line of prose leaves a `{{` outside an inline code span.
 *
 * Counts the backticks BEFORE the braces: an odd number means they are inside
 * a span that opened on this line, which is the only way they are safe. A span
 * that opened on a PREVIOUS line does not count as protection, and that is the
 * point — it is exactly the case MDX chokes on, and the one this tree took.
 *
 * `{{`, not `{`. A single brace is the heading-anchor syntax — `## Title
 * {#anchor}` — which remark strips before MDX ever sees it, and there are
 * hundreds of them. The token grammar this platform writes everywhere is
 * doubled, so the doubled form is both the real hazard and the one that can be
 * told apart from an anchor.
 */
function bracesOutsideCode(line: string): boolean {
  const at = line.indexOf('{{')
  if (at < 0) return false
  const backticks = (line.slice(0, at).match(/`/g) ?? []).length
  return backticks % 2 === 0
}

describe('every docs page parses', () => {
  const pages = [...markdownFiles(DOCS)]

  it('THE CONTROL: there are pages to read', () => {
    // A sweep over an empty list is green for the wrong reason.
    expect(pages.length).toBeGreaterThan(100)
  })

  it('has front matter that is valid YAML', () => {
    const broken: string[] = []
    for (const page of pages) {
      const block = frontMatter(readFileSync(page, 'utf8'))
      if (block == null) continue
      try {
        yaml.load(block)
      } catch (error) {
        broken.push(
          `${page.slice(page.indexOf('/docs/') + 1)}: ${
            String((error as Error).message).split('\n')[0]
          }`,
        )
      }
    }
    expect(broken).toEqual([])
  })

  it('THE CONTROL: an unquoted colon really is caught', () => {
    // Otherwise the sweep passes because the parser accepts anything.
    expect(() => yaml.load('title: Aglyn AI: the AI website builder')).toThrow()
    expect(() => yaml.load('title: "Aglyn AI: the AI website builder"')).not.toThrow()
  })

  it('leaves no `{{` outside an inline code span', () => {
    const exposed: string[] = []
    for (const page of pages) {
      const source = readFileSync(page, 'utf8')
      const body = source.replace(/^---\n[\s\S]*?\n---/, '')
      let fenced = false
      body.split('\n').forEach((line, index) => {
        if (/^\s*```/.test(line)) fenced = !fenced
        // A fence is MDX-safe whatever is inside it, which is what makes it
        // the right way to show a pattern too long for one line.
        if (fenced || !bracesOutsideCode(line)) return
        exposed.push(`${page.slice(page.indexOf('/docs/') + 1)}:${index + 2}  ${line.trim()}`)
      })
    }
    expect(exposed).toEqual([])
  })

  it('THE CONTROL: it can tell a broken span from an anchor', () => {
    // The two shapes that matter, and the heading anchor it must NOT report.
    expect(bracesOutsideCode('It defaults to `{{page.name}}` today.')).toBe(false)
    expect(bracesOutsideCode('{{site.name}}` — the composition above')).toBe(true)
    expect(bracesOutsideCode('## Choosing a model {#choosing-a-model}')).toBe(false)
  })
})

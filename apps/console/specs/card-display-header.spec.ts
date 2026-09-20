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

/**
 * `CardDisplay` titles its card from `header`. `title` also compiles — it is a
 * valid DOM attribute, so it rides in on `CardProps` — and renders a native
 * browser tooltip instead of a heading. The card then draws with no title and
 * no help icon, which reads as a styling bug rather than a wrong prop.
 *
 * Caught on the Close-account card (AGL-1140), where it survived a clean
 * `tsc`, a passing suite and a production deploy before anyone looked at the
 * card. TypeScript cannot flag this, so a grep does.
 *
 * `libs` is swept too, and that is not tidiness. This sweep read the console's
 * own two directories, so the same defect sat in `libs/plugins/inbox` — both
 * cards of the submission reader — through every run of this green spec: no
 * heading, and content against the card's edges, because a card titled by the
 * wrong prop also never turns its gutters on. A guard that names a bug class
 * has to look everywhere the class can live, and every `libs/**` project is a
 * package a consumer renders.
 */
const ROOTS = [
  join(__dirname, '..', 'app'),
  join(__dirname, '..', 'components'),
  join(__dirname, '..', '..', '..', 'libs'),
]

function* tsxFiles(dir: string): Generator<string> {
  let entries: string[]
  try {
    entries = readdirSync(dir)
  } catch {
    return
  }
  for (const entry of entries) {
    if (entry === 'node_modules' || entry === '.next' || entry === 'dist') continue
    const path = join(dir, entry)
    if (statSync(path).isDirectory()) yield* tsxFiles(path)
    else if (path.endsWith('.tsx')) yield path
  }
}

/**
 * For each `<CardDisplay …>` in one file, the props written ON IT: the text
 * from the tag name to the first `>` that is not inside a JSX expression
 * container, with everything inside `{…}` removed.
 *
 * Both halves of that are what make it a scan rather than a regex, and each
 * was a false offender when it was missing.
 *
 * Ending at the first `>` OF ANY KIND — what the regex here did — stopped the
 * tag inside `actions={<Tooltip …>`, an ordinary shape.
 *
 * Keeping the braces' contents is the subtler one: the tag then still holds
 * `<Tooltip title={…}>` from a card's own `actions` or `HeaderProps.action`,
 * and that nested element's `title` reads as the card's. Both offenders this
 * sweep reported on its first widened run were that, and both cards are
 * correctly written with `header`. A guard that cries wolf gets deleted, which
 * costs more than the bug it was catching.
 */
function cardDisplayProps(source: string): string[] {
  const tags: string[] = []
  for (
    let at = source.indexOf('<CardDisplay');
    at >= 0;
    at = source.indexOf('<CardDisplay', at + 1)
  ) {
    let depth = 0
    let surface = ''
    for (let cursor = at; cursor < source.length; cursor += 1) {
      const character = source[cursor]
      if (character === '{') depth += 1
      else if (character === '}') depth -= 1
      else if (depth === 0) {
        if (character === '>') {
          tags.push(surface)
          break
        }
        surface += character
      }
    }
  }
  return tags
}

describe('CardDisplay is titled with `header`, never `title`', () => {
  it('has no <CardDisplay title=…> in the console or in any lib', () => {
    const offenders: string[] = []
    for (const root of ROOTS) {
      for (const file of tsxFiles(root)) {
        const source = readFileSync(file, 'utf8')
        for (const tag of cardDisplayProps(source)) {
          if (/[\s{]title=/.test(tag)) {
            // Repo-relative, so a `libs` offender reads as one too.
            const cut = Math.max(file.indexOf('/apps/'), file.indexOf('/libs/'))
            offenders.push(cut >= 0 ? file.slice(cut + 1) : file)
          }
        }
      }
    }
    expect(offenders).toEqual([])
  })

  /*
   * The positive control. The sweep above is green when it finds nothing AND
   * when it looks at nothing, and it grew two ways to look at nothing — a root
   * that no longer resolves, and a reader that discards the props it is
   * supposed to read. This pins the reader against both shapes it has to tell
   * apart, so the sweep's silence means the repo is clean.
   */
  it('reads a card’s own props and not a nested element’s', () => {
    expect(cardDisplayProps('<CardDisplay title="Reply">x</CardDisplay>')).toEqual([
      '<CardDisplay title="Reply"',
    ])
    expect(
      cardDisplayProps(
        '<CardDisplay header={"Products"} actions={<Tooltip title="full"><b/></Tooltip>}>x</CardDisplay>',
      ).some((tag) => /[\s{]title=/.test(tag)),
    ).toBe(false)
  })

  it('reaches files under every root it sweeps', () => {
    for (const root of ROOTS) {
      expect([root, [...tsxFiles(root)].length > 0]).toEqual([root, true])
    }
  })
})

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
 */
const ROOTS = ['app', 'components']

function* tsxFiles(dir: string): Generator<string> {
  let entries: string[]
  try {
    entries = readdirSync(dir)
  } catch {
    return
  }
  for (const entry of entries) {
    if (entry === 'node_modules' || entry === '.next') continue
    const path = join(dir, entry)
    if (statSync(path).isDirectory()) yield* tsxFiles(path)
    else if (path.endsWith('.tsx')) yield path
  }
}

describe('CardDisplay is titled with `header`, never `title`', () => {
  it('has no <CardDisplay title=…> anywhere in the console', () => {
    const offenders: string[] = []
    for (const root of ROOTS) {
      for (const file of tsxFiles(join(__dirname, '..', root))) {
        const source = readFileSync(file, 'utf8')
        // Each opening tag, up to the first `>` that is not inside a brace.
        const tags = source.match(/<CardDisplay[\s\S]{0,600}?>/g) ?? []
        for (const tag of tags) {
          if (/[\s{]title=/.test(tag)) {
            offenders.push(file.slice(file.indexOf('/apps/') + 1))
          }
        }
      }
    }
    expect(offenders).toEqual([])
  })
})

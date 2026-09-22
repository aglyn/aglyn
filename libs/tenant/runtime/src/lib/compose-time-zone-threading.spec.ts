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
 * Every composer hands the site's zone on (AGL-3237).
 *
 * ## Why this is a source sweep and not a render test
 *
 * The zone is an OPTIONAL argument with a UTC default, which means a composer
 * that forgets to pass it compiles, lints, and returns a perfectly good page
 * — dated in the wrong zone. This bug shipped twice for exactly that reason.
 * The second time, `composeNodesWithChrome` had been threaded and
 * `composeScreenNodes` had not, so every surface was fixed except the
 * collection TEMPLATE path, which is the one the bug was reported on.
 *
 * A render test would have to build a template screen, a collection source
 * and a host to cover one path, and would still say nothing about the next
 * composer somebody adds. Reading the calls is what generalises: if a file in
 * this directory composes a page, the call carries a zone or this fails and
 * names it.
 *
 * ⚑ The failure it exists to catch is SILENCE, so it must not be silent
 * itself: an empty match set fails rather than passes, or a rename would
 * quietly turn this file into a no-op.
 */
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

const LIB_DIR = join(__dirname)

/** Composer entry points whose callers must pass the zone through. */
const COMPOSERS = ['composeScreenNodes', 'composeNodesWithChrome']

describe('every composer is handed the site time zone (AGL-3237)', () => {
  const files = readdirSync(LIB_DIR).filter(
    (name) => name.startsWith('compose-') && name.endsWith('.ts') && !name.includes('.spec.'),
  )

  it('finds the composer files it is meant to be reading', () => {
    // A rename must break this file loudly rather than empty its own input.
    expect(files.length).toBeGreaterThan(2)
  })

  it.each(COMPOSERS)('passes a zone at every `%s` call site', (composer) => {
    const offenders: string[] = []
    let seen = 0
    for (const name of files) {
      const source = readFileSync(join(LIB_DIR, name), 'utf8')
      // Each call, from its opening brace to the closing one at the same
      // indentation — enough to read the properties it was given.
      const pattern = new RegExp(`await ${composer}\\(\\{[\\s\\S]*?\\n\\s*\\}\\)`, 'g')
      for (const [call] of source.matchAll(pattern)) {
        seen += 1
        if (!call.includes('timeZone')) {
          offenders.push(`${name}: a ${composer}({…}) call passes no timeZone`)
        }
      }
    }
    expect(seen).toBeGreaterThan(0)
    expect(offenders).toEqual([])
  })
})

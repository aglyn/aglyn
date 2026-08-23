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
import {
  COOKIE_WRITERS,
  THIRD_PARTY_COOKIES,
} from './cookie-inventory'

/**
 * A new cookie cannot reach production undeclared (AGL-1918).
 *
 * The Cookie Policy is besigner content on the live site, so no check in this
 * repo can read it. What a check CAN do is refuse the state that makes the
 * policy wrong: a cookie written by code nobody wrote a policy row for.
 *
 * The unit is the WRITING FILE rather than the cookie name, because names are
 * built as often as they are literal — `aglyn_cart_${hostId}` and
 * `aglyn_member_${hostId}` are template strings, so a name-based scan would
 * simply miss the two cookies that reach the most browsers. A file-based scan
 * has the property that matters: adding a `cookies().set(…)` anywhere fails
 * until someone writes down what it sets and how long it lasts, and that is
 * the moment the policy gap is visible.
 *
 * Both directions are asserted. An undeclared writer fails, and so does a
 * declaration whose file no longer writes anything — a stale row in a legal
 * document is the other half of the same defect.
 */

const REPO_ROOT = join(__dirname, '../../..')

/**
 * Every way a cookie is written in this repo.
 *
 * POSIX character classes, not `\s`: `git grep -E` is ERE, where `\s` is not a
 * shorthand. A `document\.cookie\s*=` pattern silently matches nothing, which
 * hid the console's own `aglyn_editor` writer from the first draft of this
 * scan — the under-reporting direction, and the reason the population
 * assertion below names a floor.
 */
const WRITE_PATTERNS = [
  'cookies\\(\\)\\.set\\(',
  '\\.cookies\\.set\\(',
  'document\\.cookie[[:space:]]*=',
  "['\"]Set-Cookie['\"]",
  'Cookies\\.set\\(',
].join('|')

function writersInRepo(): string[] {
  const listed = execFileSync(
    'git',
    ['grep', '-l', '-E', WRITE_PATTERNS, '--', 'apps', 'libs'],
    { cwd: REPO_ROOT, encoding: 'utf8' },
  )
  return listed
    .split('\n')
    .filter((file) => file && !file.includes('.spec.'))
    .sort()
}

const found = writersInRepo()
const declared = Object.keys(COOKIE_WRITERS).sort()

describe('the cookie inventory (AGL-1918)', () => {
  // Anti-vacuity first: "nothing undeclared" is also the answer when the scan
  // matches nothing at all, which is exactly what a bad pattern produces.
  it('finds a real population of cookie writers', () => {
    expect(found.length).toBeGreaterThanOrEqual(10)
    expect(found).toContain('apps/console/app/api/auth/session/route.ts')
    expect(found).toContain(
      'apps/console/components/editor-hint-cookie.component.tsx',
    )
    expect(found).toContain('libs/plugins/commerce/src/lib/server/cart.ts')
  })

  it('every file that writes a cookie is declared', () => {
    const undeclared = found.filter((file) => !(file in COOKIE_WRITERS))
    if (undeclared.length) {
      throw new Error(
        'These files write a cookie and are not in COOKIE_WRITERS. The published Cookie Policy lists the cookies we set, and it is besigner content — nothing here can read it, so an undeclared cookie is a policy that under-reports with no detector.\n' +
          'Declare the cookie in apps/console/constants/cookie-inventory.ts (name, surface, purpose, duration), and raise the Cookie Policy row it needs:\n  ' +
          undeclared.join('\n  '),
      )
    }
  })

  it('every declared writer still writes a cookie', () => {
    const gone = declared.filter((file) => !found.includes(file))
    if (gone.length) {
      throw new Error(
        `These COOKIE_WRITERS entries no longer write a cookie. Remove the entry AND the Cookie Policy row it describes — disclosing a cookie we do not set is the stale half of the same defect:\n  ${gone.join('\n  ')}`,
      )
    }
  })

  it('every declared cookie name is still the name the file produces', () => {
    const stale: string[] = []
    for (const [file, writer] of Object.entries(COOKIE_WRITERS)) {
      const source = readFileSync(join(REPO_ROOT, file), 'utf8')
      for (const cookie of writer.cookies) {
        if (!source.includes(cookie.token)) {
          stale.push(
            `${file}: '${cookie.name}' is declared via ${cookie.token}, which the file no longer contains`,
          )
        }
      }
    }
    if (stale.length) {
      throw new Error(
        `A cookie was renamed without revisiting its inventory entry, so the Cookie Policy now names a cookie nobody sets:\n  ${stale.join('\n  ')}`,
      )
    }
  })

  it('every entry says something a policy row could be written from', () => {
    for (const [file, writer] of Object.entries(COOKIE_WRITERS)) {
      expect(writer.note.length).toBeGreaterThan(20)
      for (const cookie of writer.cookies) {
        expect(`${file} ${cookie.name}`.length).toBeGreaterThan(0)
        expect(cookie.surface.length).toBeGreaterThan(3)
        expect(cookie.purpose.length).toBeGreaterThan(3)
        expect(cookie.duration.length).toBeGreaterThan(2)
      }
      // A `dead` claim is the one that keeps a cookie OUT of the policy, so it
      // has to carry the evidence rather than an assertion.
      if (writer.dead) expect(writer.dead.length).toBeGreaterThan(30)
    }
  })

  it('every third-party integration we disclose is still loaded', () => {
    const missing: string[] = []
    for (const [vendor, entry] of Object.entries(THIRD_PARTY_COOKIES)) {
      const hits = execFileSync(
        'git',
        ['grep', '-l', '--fixed-strings', entry.loaderToken, '--', 'apps', 'libs'],
        { cwd: REPO_ROOT, encoding: 'utf8' },
      ).trim()
      if (!hits) {
        missing.push(
          `${vendor}: nothing imports ${entry.loaderToken} any more, so ${entry.names.join('/')} should come OUT of the Cookie Policy`,
        )
      }
    }
    if (missing.length) throw new Error(missing.join('\n  '))
  })
})

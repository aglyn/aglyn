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
 * No raw `decoded['name']` / `decoded['picture']` reads (AGL-1131).
 *
 * A SAML assertion's mapped attributes arrive under
 * `firebase.sign_in_attributes` and are NEVER promoted to top-level claims.
 * So these reads are permanently empty for every SSO account — not wrong,
 * *absent* — while working perfectly for Google and email/password. Nothing
 * fails, nothing logs; a name is simply blank for the customers on the plan
 * that has SSO.
 *
 * That is why it survived so long, and why one fix was not enough: AGL-1131
 * corrected the two reads in the SSO sign-in path, and five more were found
 * afterwards in org creation, invite acceptance, host creation and two emails
 * — including one that NAMES a workspace from it, and one that opened "Hi
 * there," to every enterprise owner.
 *
 * `resolveIdpDisplayName` / `resolveIdpPhotoUrl` / `resolveIdpPhone` read both
 * locations and accept the spellings different IdPs use.
 */
const FORBIDDEN = [
  /\bdecoded\[['"]name['"]\]/,
  /\bdecoded\[['"]picture['"]\]/,
  /\bdecoded\.name\b/,
]

function* sourceFiles(dir: string): Generator<string> {
  let entries: string[]
  try {
    entries = readdirSync(dir)
  } catch {
    return
  }
  for (const entry of entries) {
    if (entry === 'node_modules' || entry === '.next') continue
    const path = join(dir, entry)
    if (statSync(path).isDirectory()) yield* sourceFiles(path)
    else if (/\.tsx?$/.test(path) && !/\.spec\.tsx?$/.test(path)) yield path
  }
}

describe('raw provider name claims (AGL-1131)', () => {
  it('are never read directly — use resolveIdp* instead', () => {
    const offenders: string[] = []
    for (const file of sourceFiles(join(__dirname, '..', 'app'))) {
      const source = readFileSync(file, 'utf8')
      source.split('\n').forEach((line, index) => {
        // Comments explaining why these are gone name them verbatim.
        const code = line.replace(/\/\/.*$/, '').replace(/^\s*\*.*$/, '')
        for (const pattern of FORBIDDEN) {
          if (pattern.test(code)) {
            offenders.push(`${file.split('/apps/')[1]}:${index + 1}`)
          }
        }
      })
    }
    expect(offenders).toEqual([])
  })
})

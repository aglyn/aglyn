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
 * NO VALUE FROM THE DEVELOPER'S `.env` REACHES A TEST (AGL-690, AGL-1152).
 *
 * nx loads the repo-root `.env` into every task it runs, tests included, so a
 * spec that should fail closed on a missing secret instead passes on the
 * developer's real one — and then fails in CI, which has no `.env`. AGL-689
 * (gated-video tokens signed with a forgeable key) is what that looks like when
 * it ships. `jest.setup.js` deletes the leaked values back out; this is the
 * assertion that it actually does.
 *
 * It went uncaught for a release because the scrubber read `.env` with a regex
 * that stripped one layer of quotes, while dotenv ALSO expands escape sequences
 * inside a double-quoted value. `FIREBASE_PRIVATE_KEY="-----BEGIN…\n…"` loads
 * with real newlines, the raw text spells them `\n`, the equality check failed,
 * and the delete never happened. One variable of seventeen escaped — the only
 * one containing an escape sequence, which is to say the signing key, in a
 * mechanism whose whole purpose is to contain signing keys.
 *
 * Asserted over EVERY key the file defines rather than that one name, because
 * the next secret to gain an escape sequence should fail here on the day it is
 * added and not on the day it is exploited.
 *
 * WHY IT LIVES IN THE TENANT APP. The property is workspace-wide, but
 * `shared-util-fbserver` — where the leak surfaced — has no test target, and
 * the tenant suite runs the shared preset on every gate. The symptom was nine
 * tenant suites failing to LOAD: the private key survived, the single-line
 * client email did not, and `cert()` refuses a partial credential.
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { parse } from 'dotenv'

const repoRoot = join(__dirname, '..', '..', '..')

/** The root `.env`, parsed exactly as nx/dotenv loaded it — or null in CI. */
function rootEnv(): Record<string, string> | null {
  try {
    return parse(readFileSync(join(repoRoot, '.env'), 'utf8'))
  } catch {
    return null // no root .env (CI): nothing was ever leaked
  }
}

describe('test env hermeticity (AGL-690)', () => {
  it('leaks NO value defined by the repo-root .env', () => {
    const parsed = rootEnv()
    if (!parsed) return // CI — the property holds by construction

    // Names only. A failure must not print the secret it just caught.
    const leaked = Object.keys(parsed).filter(
      (key) => process.env[key] === parsed[key],
    )
    expect(leaked).toEqual([])
  })

  it('CONTROL — the .env really does define values, so the check is not vacuous', () => {
    const parsed = rootEnv()
    if (!parsed) return
    // Without this, a `.env` that failed to parse would render the assertion
    // above trivially true and the guard would protect nothing.
    expect(Object.keys(parsed).length).toBeGreaterThan(0)
  })

  it('CONTROL — an escaped multi-line value is among what it must strip', () => {
    const parsed = rootEnv()
    if (!parsed) return
    // The regression was specific to values dotenv expands. If the fixture
    // ever loses its only such value, the general assertion above stops
    // covering the case that actually broke — so say so here rather than
    // quietly narrowing.
    const escaped = Object.keys(parsed).filter((key) =>
      parsed[key].includes('\n'),
    )
    expect(escaped.length).toBeGreaterThan(0)
  })
})

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
 * AGL-2254: SSO enforcement is console-owned, and the script beside it does
 * not claim otherwise.
 *
 * This guard is unusual in what it protects: not a behaviour, but a CLAIM
 * ABOUT a behaviour. `tools/scripts/enforce-sso-signin.mjs` asserted in its
 * header that "`sso.enforced` has no writer in the codebase" for the two
 * weeks after AGL-1210 shipped the writer. Nothing was broken; a reader was.
 * A capability audit grepping for writers of that field found the script's
 * confident denial and filed enterprise SSO enforcement as unbuilt.
 *
 * So both halves are pinned. The route must still own the write and the
 * sweep — if that ever moves back to the CLI the script's new header becomes
 * the false one — and the script must not carry the retracted sentence again.
 */

import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const REPO = join(__dirname, '..', '..', '..')

const ROUTE = readFileSync(
  join(REPO, 'apps/console/app/api/orgs/sso/route.ts'),
  'utf8',
)
const CARD = readFileSync(
  join(REPO, 'apps/console/components/org-sso-card.component.tsx'),
  'utf8',
)
const SCRIPT = readFileSync(
  join(REPO, 'tools/scripts/enforce-sso-signin.mjs'),
  'utf8',
)

describe('AGL-2254 · the console owns SSO enforcement', () => {
  it('read three real, non-empty files', () => {
    for (const text of [ROUTE, CARD, SCRIPT]) {
      expect(text.length).toBeGreaterThan(1000)
    }
  })

  it('the route writes sso.enforced in both directions', () => {
    expect(ROUTE).toContain(`{ sso: { enforced: true } }`)
    expect(ROUTE).toContain(`{ sso: { enforced: false } }`)
  })

  it('enforce-apply sweeps sign-in methods, not just flips the flag', () => {
    // The flag alone is a promise. Existing accounts keep their password and
    // Google logins until `enforceSsoSignInMethods` strips them, so an
    // "enforced" org that never swept is not enforcing anything.
    const block = /if \(action === 'enforce-apply'\)[\s\S]*?\n {4}\}/.exec(ROUTE)
    expect(block).not.toBeNull()
    expect(block?.[0]).toContain('enforced: true')
    expect(block?.[0]).toContain('enforceSsoSignInMethods(')
  })

  it('offers a dry-run rehearsal before the irreversible apply', () => {
    // Unlinking is not reversible — `enforce-off` restores nothing, because
    // no credential was stored to put back. The preview is what makes the
    // apply an informed click.
    const block = /if \(action === 'enforce-preview'\)[\s\S]*?\n {4}\}/.exec(ROUTE)
    expect(block?.[0]).toContain('dryRun: true')
  })

  it('the console renders all three states', () => {
    expect(CARD).toContain('enforce-preview')
    expect(CARD).toContain('enforce-apply')
    expect(CARD).toContain('enforce-off')
  })

  it('the script no longer denies that a writer exists', () => {
    // The retracted sentence, verbatim. Re-adding it re-creates the exact
    // false premise this issue exists for.
    expect(SCRIPT).not.toContain('has no writer in the codebase')
    expect(SCRIPT).not.toContain('This is the ONLY trigger today')
  })

  it('the script names the route that owns the inline call', () => {
    // A pointer, so the next person to move the write has somewhere to look
    // — and so this assertion fails if the route is renamed out from under it.
    expect(SCRIPT).toContain('apps/console/app/api/orgs/sso/route.ts')
  })
})

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
 * `/api/auth/staff-self-check` is reachable from the console (AGL-2119).
 *
 * AGL-1993 built the route and left it as a curl: its only reference in the
 * repo was `apps/docs/docs/staff-console/overview.md`, telling a human to
 * paste their own ID token into a shell. It is the one endpoint whose entire
 * purpose is to be read by a confused person staring at a 404.
 *
 * A CALL-SITE assertion, not a route test. The route's own behaviour was
 * always correct — a spec exercising it would have passed for the whole
 * period nothing in the product could reach it. What has to be pinned is the
 * wire: a component that calls it, and a page that mounts that component.
 */

import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const REPO_ROOT = join(__dirname, '..', '..', '..')
const CARD = join(
  REPO_ROOT,
  'apps/console/components/account-identities-card.component.tsx',
)
const PAGE = join(REPO_ROOT, 'apps/console/app/(app)/manage/user/page.tsx')

/**
 * The file with its comments removed.
 *
 * Asserting "the code does not do X" against raw source is the AGL-2115
 * defect inverted: this spec's own first draft went red because the
 * component's doc comment EXPLAINS that it must not use a bare `getAuth()`
 * and must not link `/admin`. Prose that describes a prohibition is not a
 * violation of it, and a guard that cannot tell them apart is a false RED —
 * which would be "fixed" by deleting the explanation, making the code worse.
 */
function codeOf(file: string): string {
  return readFileSync(file, 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '')
}

function grepFiles(needle: string, ...paths: string[]): string[] {
  try {
    return execFileSync('git', ['grep', '-l', '--', needle, '--', ...paths], {
      cwd: REPO_ROOT,
      encoding: 'utf8',
    })
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean)
  } catch {
    return []
  }
}

describe('AGL-2119 · staff self-check has a console surface', () => {
  it('the route still exists at the path the card calls', () => {
    // The premise. If the route moved, the card fetches a 404 and every
    // assertion below is about a dead string.
    expect(
      readFileSync(
        join(REPO_ROOT, 'apps/console/app/api/auth/staff-self-check/route.ts'),
        'utf8',
      ),
    ).toContain('export { handler as GET }')
  })

  it('a component — not only a doc — calls it', () => {
    // The state this closes: the ONLY reference was the docs page. A guard
    // that accepted any reference would have been green throughout.
    const callers = grepFiles(
      '/api/auth/staff-self-check',
      'apps/console/components',
      'apps/console/app',
      'apps/console/hooks',
      'apps/console/utils',
    ).filter(
      (file) => !file.includes('/app/api/') && !/\.spec\.tsx?$/.test(file),
    )
    expect(
      `callers: ${callers.length ? callers.join(', ') : 'NONE'}`,
    ).toBe(
      'callers: apps/console/components/account-identities-card.component.tsx',
    )
  })

  it('a page mounts the component', () => {
    // Imported AND rendered — a component nothing mounts is the same defect
    // one layer in (the AGL-1947 lesson).
    const page = readFileSync(PAGE, 'utf8')
    expect(page).toContain(
      "from '../../../../components/account-identities-card.component'",
    )
    expect(page).toMatch(/<AccountIdentitiesCard\s*\/>/)
  })

  it('forces a token refresh, because a stale claim is the thing being diagnosed', () => {
    // `getIdToken()` without `true` answers from the cached token, which is
    // exactly the state a person is investigating when a claim granted
    // minutes ago has not appeared. It would report the very absence it was
    // opened to explain.
    expect(readFileSync(CARD, 'utf8')).toContain('getIdToken(true)')
  })

  it('reads the user through the named-app hook, never a bare getAuth', () => {
    // This console is a NAMED Firebase app; `getAuth()` with no argument
    // resolves the default one and would read a different session.
    const card = codeOf(CARD)
    expect(card).toContain('useUser')
    expect(card).not.toMatch(/getAuth\(\s*\)/)
  })

  it('does not advertise the staff console to a customer', () => {
    // StaffGuard answers a non-staff session with a bare 404 on purpose
    // (AGL-847). This card is mounted on every user's own account page, so
    // the staff wording must be conditional on a record that already carries
    // the claim — never rendered unconditionally.
    const card = codeOf(CARD)
    const staffMentions = card.match(/Aglyn staff/g) ?? []
    expect(staffMentions).toHaveLength(1)
    // The single mention sits behind `row.staff`.
    expect(card).toMatch(/row\.staff \?[\s\S]{0,300}Aglyn staff/)
    // And nothing names the staff console's route or invites a customer to it.
    expect(card).not.toContain('/admin')
  })
})

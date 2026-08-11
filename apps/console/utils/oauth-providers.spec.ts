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

import { readdirSync, readFileSync, statSync } from 'fs'
import { join, relative } from 'path'

/**
 * AGL-1415 — the account chooser.
 *
 * Two assertions, and the second is the one that keeps this fixed:
 *
 * 1. The helper really sets `prompt: 'select_account'`. Asserting the
 *    parameter is on the provider — not that some function was called —
 *    is the difference between a control being present and a control
 *    being WIRED.
 * 2. NOTHING ELSE constructs a `GoogleAuthProvider`. There were five
 *    construction sites when this was filed; a fix that patches the one
 *    you happen to open comes straight back the next time someone adds a
 *    sixth. The guard is source-level and asserts at the DECLARATION, so
 *    a new bare construction fails the suite rather than quietly shipping
 *    a flow with no chooser.
 */

const WORKSPACE_ROOT = join(__dirname, '..', '..', '..')
const HELPER = 'apps/console/utils/oauth-providers.ts'
/** Directories with no hand-written source in them. */
const SKIP_DIRS = new Set([
  'node_modules',
  'dist',
  '.next',
  'coverage',
  '.nx',
  'tmp',
  'storybook-static',
])
// All three, not just Google (AGL-1416): the SSO page built its own bare
// `SAMLAuthProvider`, which is why the typed email never became a
// `login_hint` and sign-in was decided by browser account ordering.
const CONSTRUCTION =
  /new\s+(GoogleAuthProvider|SAMLAuthProvider|OAuthProvider)\s*\(/

function sourceFiles(dir: string, found: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (SKIP_DIRS.has(entry)) continue
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) {
      sourceFiles(full, found)
      continue
    }
    if (!/\.tsx?$/.test(entry)) continue
    // Specs are excluded deliberately: a test may construct a bare provider
    // as a FIXTURE to assert something else entirely (as the tenant's
    // auth-persistence spec does), and routing that through the console's
    // helper would be both meaningless and a lint-boundary violation. The
    // guard is about production sign-in paths.
    if (/\.spec\.tsx?$/.test(entry)) continue
    found.push(full)
  }
  return found
}

describe('Google OAuth provider construction (AGL-1415)', () => {
  it('sets prompt=select_account so the account chooser always appears', () => {
    // Required lazily: the guard test below must still run and report every
    // offending site even when the helper does not exist yet.
    const {
      createGoogleOAuthProvider,
      // eslint-disable-next-line @typescript-eslint/no-var-requires
    } = require('./oauth-providers')

    const provider = createGoogleOAuthProvider()

    expect(provider.getCustomParameters()).toEqual(
      expect.objectContaining({ prompt: 'select_account' }),
    )
    expect(provider.providerId).toBe('google.com')
  })

  it('passes the known email as login_hint, keeping the chooser (AGL-1416)', () => {
    const {
      createAuthProvider,
      // eslint-disable-next-line @typescript-eslint/no-var-requires
    } = require('./oauth-providers')

    const google = createAuthProvider(null, 'zach@aglyn.com')
    expect(google.getCustomParameters()).toEqual({
      prompt: 'select_account',
      login_hint: 'zach@aglyn.com',
    })

    // SAML is the flow the hint exists for: without it Google resolves the
    // request against `authuser=0` and answers app_not_configured_for_user.
    const saml = createAuthProvider('saml.aglyn-workspace', 'zach@aglyn.com')
    expect(saml.providerId).toBe('saml.aglyn-workspace')
    expect(saml.getCustomParameters()).toEqual({
      login_hint: 'zach@aglyn.com',
    })
  })

  it('omits login_hint when no email is known', () => {
    const {
      createAuthProvider,
      // eslint-disable-next-line @typescript-eslint/no-var-requires
    } = require('./oauth-providers')

    // "Connect Google" must NOT hint: the whole point is linking a different
    // identity than the one already in session.
    expect(createAuthProvider().getCustomParameters()).toEqual({
      prompt: 'select_account',
    })
    expect(createAuthProvider('saml.acme', '  ').getCustomParameters()).toEqual(
      {},
    )
  })

  it('is the ONLY place that constructs an auth provider', () => {
    const offenders = ['apps', 'libs']
      .flatMap((top) => sourceFiles(join(WORKSPACE_ROOT, top)))
      .filter((file) => CONSTRUCTION.test(readFileSync(file, 'utf8')))
      .map((file) => relative(WORKSPACE_ROOT, file).split('\\').join('/'))
      .filter((file) => file !== HELPER)
      .sort()

    expect(offenders).toEqual([])
  })
})

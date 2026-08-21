/**
 * @jest-environment node
 *
 * Pragma must stay in the FIRST block comment — behind the license header it
 * is silently ignored, the trap every other spec in this directory carries a
 * note about.
 *
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

import { AuthErrorCodes } from 'firebase/auth'

// Statically imported so the nx graph edge is declared and STATIC. The cases
// below re-require the same specifier through `reRequire`; see the note there.
import { AuthErrorMessage } from '@aglyn/shared-data-enums'

/**
 * AGL-2047 — the notice a locked-out person actually sees names the OPERATOR
 * of the deployment they are locked out of.
 *
 * `AuthErrorCodes.USER_DISABLED` is what a user-scope lockdown (AGL-1501)
 * surfaces at sign-in: the Firebase account is disabled, and this one sentence
 * is the whole of the affordance the person has left. It read
 * `Contact support@aglyn.com to restore access.` on every deployment,
 * including self-hosted ones, where Aglyn has no record of the account and
 * only the local operator can lift the lock.
 *
 * The fix landed in `b8eaa741f` (AGL-2196): `@aglyn/shared-data-enums` reads
 * `NEXT_PUBLIC_OPERATOR_SUPPORT_EMAIL` itself rather than calling
 * `operatorIdentity()`. That is what answers AGL-2047's stated blocker —
 * `@aglyn/aglyn` already imports this library, so importing it back would be a
 * project cycle, and the boundary is respected by not crossing it rather than
 * by inverting it.
 *
 * Nothing held it there. `shared-data-enums` has no test target at all, and
 * the nearest indirect guard — the self-host hostname ratchet in
 * `selfhost-hardcoded-hosts.spec.ts` — strips comments, skips specs, and
 * counts `aglyn.(app|com|io)` occurrences, so it would not notice this
 * sentence relapsing to a hardcoded fallback under a different name.
 *
 * ## Why each case gets its own module registry
 *
 * The address is captured into a module-level `const` at import time. It has
 * to be: Next substitutes `process.env.NEXT_PUBLIC_*` textually at build, so
 * there is no later moment at which to read it. A plain import would let every
 * case after the first assert the FIRST one's value and pass for the wrong
 * reason — the shape of green that is worth nothing.
 */

/**
 * `require` behind a non-literal specifier.
 *
 * The indirection is load-bearing for the BUILD, not for this test.
 * `@nx/enforce-module-boundaries` reads a literal specifier inside a callback
 * as a DYNAMIC graph edge, and dynamic edges are transitive: one here would
 * turn every static `@aglyn/shared-data-enums` import in the console app into
 * "a static import of a lazy-loaded library" and redden `console:lint` on
 * hundreds of files that did not change (AGL-949, AGL-2282). Nothing is
 * concealed — the library is statically imported above, so the dependency is
 * already declared and only its KIND was being mis-read.
 */
const reRequire = (id: string): any =>
  (require as unknown as (spec: string) => any)(id)

const VAR = 'NEXT_PUBLIC_OPERATOR_SUPPORT_EMAIL'

/** The `USER_DISABLED` copy as a fresh module load with `VAR` set to `value`. */
function disabledCopyWith(value: string | undefined): string {
  const before = process.env[VAR]
  if (value === undefined) delete process.env[VAR]
  else process.env[VAR] = value

  let copy = ''
  try {
    jest.isolateModules(() => {
      copy = reRequire('@aglyn/shared-data-enums').AuthErrorMessage[
        AuthErrorCodes.USER_DISABLED
      ]
    })
  } finally {
    if (before === undefined) delete process.env[VAR]
    else process.env[VAR] = before
    jest.resetModules()
  }
  return copy
}

describe('USER_DISABLED sign-in copy names the operator (AGL-2047)', () => {
  it('is registered at all — the map still carries the code', () => {
    // Guards the case where the whole entry is dropped and every "does not
    // contain" assertion below passes against `undefined`.
    expect(typeof AuthErrorMessage[AuthErrorCodes.USER_DISABLED]).toBe('string')
  })

  it('names the configured operator address', () => {
    const copy = disabledCopyWith('ops@acme.example')

    expect(copy).toContain('ops@acme.example')
    expect(copy).toContain('restore access')
  })

  it('names no aglyn address on an operator’s own deployment', () => {
    const copy = disabledCopyWith('ops@acme.example')

    // The bug this replaces: the sentence told an operator's own user to email
    // a company that has never heard of them, about a lock only the operator
    // can lift.
    expect(copy.toLowerCase()).not.toContain('aglyn')
  })

  it('names NO address at all when the operator has configured none', () => {
    const copy = disabledCopyWith(undefined)

    // Not a fallback to ours. An unconfigured deployment says "your
    // administrator" — no `@` anywhere, so there is no wrong mailto to click.
    expect(copy).not.toContain('@')
    expect(copy).toContain('restore access')
  })

  it('positive control — our own deployment still prints its address', () => {
    // Stops the case above from being satisfied by de-naming the address for
    // everyone, which would be a real regression for us: `.env.example` sets
    // this variable to exactly this value.
    const copy = disabledCopyWith('support@aglyn.com')

    expect(copy).toContain('support@aglyn.com')
  })
})

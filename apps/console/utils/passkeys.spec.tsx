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

import { readFileSync } from 'fs'
import { join } from 'path'
import { render, screen } from '@testing-library/react'
import { AuthAppErrorCodes, AuthErrorIgnore } from '@aglyn/shared-data-enums'
import AuthErrorAlertComponent from '../components/auth-error-alert.component'

/**
 * AGL-1417 — the passkey button that did nothing.
 *
 * The WebAuthn API WAS called and the promise DID reject; the rejection was
 * deliberately swallowed. `NotAllowedError` is overloaded by the spec: it
 * means *user dismissed*, *timed out*, AND **no discoverable credential
 * matched the RP ID** — the last one on purpose, so a site cannot probe
 * whether a credential exists. Reading all three as "user pressed cancel, say
 * nothing" is what turned "you have no passkey here" into a dead button.
 *
 * Because the browser will not tell us which of the three happened, the copy
 * has to cover both readings honestly. What it must never do is stay silent.
 */

const CONSOLE_ROOT = join(__dirname, '..')

/** The two SIGN-IN ceremony sites. Registration is a separate question. */
const CEREMONY_SITES = [
  'app/(auth)/signin/page.tsx',
  'components/session-reauth-dialog.component.tsx',
]

// eslint-disable-next-line @typescript-eslint/no-var-requires
const passkeys = () => require('./passkeys')

describe('passkey sign-in failures are never silent (AGL-1417)', () => {
  it('has no bare NotAllowedError branch left in either ceremony site', () => {
    // Asserted at the DECLARATION rather than through behaviour: the silent
    // branch was a hand-written name check, and the only durable guarantee
    // that it has not been reintroduced is that the shape is absent.
    const offenders = CEREMONY_SITES.filter((relative) => {
      const source = readFileSync(join(CONSOLE_ROOT, relative), 'utf8')
      // A name comparison against NotAllowedError that is not delegated to
      // the shared describe* helper is the pattern that produced this bug.
      return /['"]NotAllowedError['"]/.test(source)
    })

    expect(offenders).toEqual([])
  })

  it('returns a user-facing failure for EVERY rejection, cancels included', () => {
    const { describePasskeySignInFailure, PasskeyRequestError } = passkeys()

    const cases: unknown[] = [
      Object.assign(new Error('The operation either timed out or was not allowed.'), {
        name: 'NotAllowedError',
      }),
      Object.assign(new Error('aborted'), { name: 'AbortError' }),
      new PasskeyRequestError('rate-limited', 429),
      new PasskeyRequestError('credential-unknown', 400),
      new PasskeyRequestError('credential-cloned', 400),
      new PasskeyRequestError('bad-origin', 400),
      new Error('something nobody predicted'),
      undefined,
      null,
    ]

    for (const caught of cases) {
      const failure = describePasskeySignInFailure(caught)
      expect(failure.code).toBeTruthy()
      expect(failure.message.length).toBeGreaterThan(0)
      // A code the alert suppresses is the same as no message at all.
      expect(AuthErrorIgnore[failure.code]).toBeFalsy()
    }
  })

  it('reads the overloaded cancel as "you may have no passkey here"', () => {
    const { describePasskeySignInFailure } = passkeys()

    const failure = describePasskeySignInFailure(
      Object.assign(new Error('not allowed'), { name: 'NotAllowedError' }),
    )

    expect(failure.code).toBe(AuthAppErrorCodes.PASSKEY_NOT_COMPLETED)
    render(<AuthErrorAlertComponent error={failure as never} />)
    // Both readings, because the browser refuses to tell us which it was.
    expect(screen.getByText(/no passkey/i)).toBeTruthy()
    expect(screen.getByText(/set (one )?up|add one|try again/i)).toBeTruthy()
  })

  it('distinguishes a server refusal from a cancel', () => {
    const { describePasskeySignInFailure, PasskeyRequestError } = passkeys()

    const limited = describePasskeySignInFailure(
      new PasskeyRequestError('rate-limited', 429),
    )
    expect(limited.code).toBe(AuthAppErrorCodes.PASSKEY_SIGNIN_FAILED)
    expect(limited.message).toMatch(/too many/i)

    const cloned = describePasskeySignInFailure(
      new PasskeyRequestError('credential-cloned', 400),
    )
    expect(cloned.message).toMatch(/security/i)
  })

  it('renders something on screen for every failure shape', () => {
    const { describePasskeySignInFailure, PasskeyRequestError } = passkeys()

    for (const caught of [
      Object.assign(new Error('x'), { name: 'NotAllowedError' }),
      new PasskeyRequestError('verification-failed', 400),
      new Error('unclassifiable'),
      null,
    ]) {
      const { container, unmount } = render(
        <AuthErrorAlertComponent
          error={describePasskeySignInFailure(caught) as never}
        />,
      )
      expect(container.textContent.trim().length).toBeGreaterThan(0)
      unmount()
    }
  })
})
